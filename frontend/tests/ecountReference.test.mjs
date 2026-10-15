import test from 'node:test';
import assert from 'node:assert/strict';
import { assertEcountReferenceRequestSize, buildEcountCartonSummary, canonicalEcountVoucher, parseExternalEcountLines, validEcountReferenceResponse } from '../src/utils/ecountReference.mjs';
import { buildPackedCartonShipmentTrace, cartonTraceNotes } from '../src/utils/cartonShipmentTrace.mjs';

const manifest = () => ({orderId:11,wmsVoucherNumber:'WT-11',shipmentReference:'WMS-11',fingerprint:'a'.repeat(64),status:'unlinked',reference:null,blockers:[],
 rows:[{allocationId:1,cartonId:'N1',cartonLineId:5,orderItemId:10,contentRevision:2,itemCode:'00123',productName:'SN item',quantity:2,actualSN:['00-a','00-A'],sourceSKU:'00123-完整'}],
 looseRows:[{orderItemId:11,itemCode:'NO-SN',productName:'散件',quantity:3,actualSN:[]},{orderItemId:12,itemCode:'SN-LOOSE',quantity:1,actualSN:['000loose']}],
 totals:[{itemCode:'00123',quantity:2,boxedQuantity:2,looseQuantity:0,actualSN:['00-a','00-A']},{itemCode:'NO-SN',quantity:3,boxedQuantity:0,looseQuantity:3,actualSN:[]},{itemCode:'SN-LOOSE',quantity:1,boxedQuantity:0,looseQuantity:1,actualSN:['000loose']}],cartonSummary:[{cartonId:'N1',quantity:2}]});

test('date aliases compare as the same original document while invalid dates and literal references are never guessed',()=>{
 for(const value of ['2026 / 10 / 15 - 0001','2026.10.15－01','2026-10-15—1'])assert.equal(canonicalEcountVoucher(value),'2026/10/15-1');
 assert.equal(canonicalEcountVoucher('  ORIGINAL-A  '),'ORIGINAL-A');assert.equal(canonicalEcountVoucher('2026/02/30-1'),'2026/02/30-1');assert.notEqual(canonicalEcountVoucher('2026/02/30-1'),'2026/03/02-1');
});

test('external TSV retains literal item/SN identity and accepts one real SN per quantity-one row',()=>{
 const lines=parseExternalEcountLines('品號\t數量\tSN\n00123\t1\t00-a\n00123\t1\t00-A\nNO-SN\t3\t');
 assert.deepEqual(lines,[{itemCode:'00123',quantity:1,actualSN:['00-a']},{itemCode:'00123',quantity:1,actualSN:['00-A']},{itemCode:'NO-SN',quantity:3}]);
 assert.deepEqual(parseExternalEcountLines('品項\t數量\t序號/批號\n00123\t1,000.00\t\nOTHER\t25.00\t'),[{itemCode:'00123',quantity:1000},{itemCode:'OTHER',quantity:25}]);
 for(const input of ['', 'SKU 10', 'SKU\t-1','SKU\t0','SKU\t1.1','SKU\t1e3','SKU\t2\tSN1','SKU\t1\tCARTON:N1','SKU\t1\tA\nOTHER\t1\tA']) assert.throws(()=>parseExternalEcountLines(input));
 for(const input of ['SKU\t1,00','SKU\t1,000.01','SKU\t1.00001','SKU\t1,000,001.00'])assert.throws(()=>parseExternalEcountLines(input));
 assert.equal(parseExternalEcountLines(Array.from({length:10000},()=>`SKU\t1`).join('\n')).length,10000);
 assert.throws(()=>parseExternalEcountLines(Array.from({length:10001},()=>`SKU\t1`).join('\n')),/10,000/);
});

test('packed export includes boxed and loose actual units with exact SN rows and truthful blank ECOUNT reference',()=>{
 const data=manifest(),table=buildPackedCartonShipmentTrace(data),at=(row,column)=>row[table.headers.indexOf(column)];
 assert.equal(table.rows.length,4);assert.equal(table.rows.reduce((sum,row)=>sum+at(row,'本次數量'),0),6);
 assert.deepEqual(table.rows.map(row=>at(row,'實際SN')).filter(Boolean),['00-a','00-A','000loose']);
 assert.deepEqual(table.rows.map(row=>at(row,'箱號')),['N1','N1','未使用箱號','未使用箱號']);
 assert.equal(at(table.rows[0],'ERP品項編碼'),'00123');assert.equal(at(table.rows[0],'原ECOUNT銷貨單號'),'');
 assert.match(JSON.stringify(table.notes),/不可作為新的銷貨匯入檔/);assert.match(JSON.stringify(table.notes),/不重複扣庫存/);
});

test('packed exporter refuses duplicate/partial SN, lost loose rows and mismatched per-item actual totals',()=>{
 for(const mutate of [data=>data.rows.push({...data.rows[0]}),data=>data.rows[0].actualSN.pop(),data=>data.looseRows.pop(),data=>data.totals[0].quantity++,data=>data.looseRows[1].actualSN=['00-a']]) {
  const data=manifest();mutate(data);assert.throws(()=>buildPackedCartonShipmentTrace(data));
 }
});

test('copy summary is metadata only, and warnings/blockers remain in workbook instructions',()=>{
 const data=manifest();data.reference={companyCode:'COMPANY-01',voucherNumber:'26/10/15-1',confirmedFingerprint:'b'.repeat(64),confirmedAt:'2026-10-15T01:00:00Z',confirmedBy:{id:7,name:'Clerk'}};
 const summary=buildEcountCartonSummary(data);assert.match(summary,/WMS-11/);assert.match(summary,/00123：N1 × 2；此品項合計 2 件/);assert.match(summary,/NO-SN：散件 × 3；此品項合計 3 件/);assert.doesNotMatch(summary,/新增銷貨|扣庫指令/);
 assert.match(JSON.stringify(cartonTraceNotes({referenceWarning:'未匹配原單',blockers:[{message:'尚未裝箱'}]})),/未匹配原單.*尚未裝箱/);
 const notes=Object.fromEntries(cartonTraceNotes({...data,ready:true,status:'manual_checked'}));assert.equal(notes['本次內容指紋'],'a'.repeat(64));assert.equal(notes['人工核對指紋（非官方回執）'],'b'.repeat(64));assert.equal(notes['人工核對時間（非官方回執）'],'2026-10-15T01:00:00Z');assert.equal(notes['可進行人工核對'],'是');
 assert.equal(validEcountReferenceResponse(data,11),true);assert.equal(validEcountReferenceResponse({...data,orderId:12},11),false);assert.equal(validEcountReferenceResponse({...data,fingerprint:'invalid'},11),false);
});

test('large original documents keep all 1040 SN identities and reject oversized UTF-8 bodies without truncating input',()=>{
 const input=Array.from({length:1040},(_,index)=>`00123\t1.00\t000Vendor-${String(index).padStart(4,'0')}`).join('\n');
 const lines=parseExternalEcountLines(input);assert.equal(lines.length,1040);assert.equal(lines[0].actualSN[0],'000Vendor-0000');assert.equal(lines.at(-1).actualSN[0],'000Vendor-1039');
 assert.ok(assertEcountReferenceRequestSize({confirmation:{lines}})<2*1024*1024);
 const body={value:'中'.repeat(800000)};assert.throws(()=>assertEcountReferenceRequestSize(body),/2 MiB/);assert.equal(body.value.length,800000);
 assert.throws(()=>parseExternalEcountLines(body.value),/2 MiB/);assert.equal(body.value.length,800000);
});
