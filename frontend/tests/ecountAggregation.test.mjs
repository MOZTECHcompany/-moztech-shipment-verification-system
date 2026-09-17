import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildEcountRows,buildEcountUploadTable,prepareEcountFinancials,ECOUNT_GROUPED_MODE} from '../src/utils/marketplaceIntake.mjs';
import {savedBatchTables} from '../src/utils/marketplaceBatchFiles.mjs';
const require=createRequire(import.meta.url);
const {reconcileSales,HEADERS}=require('../../backend/src/services/erpSalesReceipt.js');
function fixture(quantities=[45,45,45,45,45,45,45,45,45,45],platform='Shopify'){
 const settings={salesExportMode:ECOUNT_GROUPED_MODE,store:'STORE',customerCode:'00020',warehouseCode:'003',date:'2026-09-17',batchSequence:'1',batchNumber:'TEST-GROUP-0917',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,skuMappings:{SKU:{erpSku:'NEW0012',erpName:'Product',barcode:'0123456789012',confirmed:true,barcodeConfirmed:true}},shippingSku:{erpSku:'SHIP',confirmed:true,nonStock:true}};
 const items=quantities.map((quantity,n)=>({sourceOrderNumber:`O${String(n).padStart(3,'0')}`,sourceLineId:`L${n}`,sku:'SKU',productName:'Product',quantity,lineSubtotalMinor:quantity*(10000+n)}));
 const orders=items.map(i=>({sourcePlatform:platform,sourceOrderNumber:i.sourceOrderNumber,paymentStatus:'paid',fulfillmentStatus:'unfulfilled',financial:{totalMinor:i.lineSubtotalMinor,shippingMinor:0,currency:'TWD'}}));
 const parsed={issues:[],items,orders,summary:{orderCount:orders.length}};
 const out=buildEcountRows(parsed,settings);assert.equal(out.ok,true,JSON.stringify(out.issues));
 return {...out,settings,items,orders,batchNumber:settings.batchNumber,prepick:{headers:[],rows:[]}};
}
function stored(record){return {snapshot:record,batch_number:record.batchNumber,orders:record.orders.map(o=>({source_platform:o.sourcePlatform,source_store:record.settings.store,source_order_number:o.sourceOrderNumber,expected_items:record.items.filter(i=>i.sourceOrderNumber===o.sourceOrderNumber).map(i=>({sourceLineId:i.sourceLineId,productCode:record.settings.skuMappings[i.sku].erpSku,productName:i.productName,barcode:record.settings.skuMappings[i.sku].barcode,quantity:i.quantity}))}))};}
function receipt(record,sn=false){
 let count=0;
 return [HEADERS,...prepareEcountFinancials(record).rows.map(r=>['20260917-99',record.batchNumber,r[2],r[6],r[7],r[13],r[14],r[12],r[15],r[11],r[19],r[23],r[24],Math.round((r[23]+r[24])*100)/100,r[11]==='SHIP'?'':'0123456789012',sn?Array.from({length:r[19]},()=>`SN${String(++count).padStart(10,'0')}`).join(' '):'',''])];
}
test('450 across ten orders exports 200/200/50 with exact gross, stable allocation and 27 columns for all platforms',()=>{
 for(const platform of ['Shopify','SHOPLINE','1Shop']){
  const record=fixture(undefined,platform),before=JSON.stringify(record),view=prepareEcountFinancials(record),file=buildEcountUploadTable(record);
  assert.deepEqual(view.rows.map(r=>r[19]),[200,200,50]);assert.equal(file.headers.length,27);
  assert.equal(view.financials.grossMinor,record.orders.reduce((s,o)=>s+o.financial.totalMinor,0));
  assert.equal(view.financials.netMinor+view.financials.taxMinor,view.financials.grossMinor);
  assert.ok(view.rows.every(r=>r[17]===''&&r[12]===record.batchNumber&&r[15].startsWith('AG-')));
  const sourceTotals=new Map();for(const l of view.salesLayout.lines)for(const a of l.allocations){const s=sourceTotals.get(a.identity[3])||[0,0];s[0]+=a.quantity;s[1]+=a.sourceGrossMinor;sourceTotals.set(a.identity[3],s);}
  for(const i of record.items)assert.deepEqual(sourceTotals.get(i.sourceLineId),[i.quantity,i.lineSubtotalMinor]);
  assert.equal(JSON.stringify(record),before);
  const reordered=structuredClone(record);reordered.rows.reverse();reordered.items.reverse();reordered.orders.reverse();assert.deepEqual(prepareEcountFinancials(reordered),view);
 }
});
test('quantity boundaries, non-divisible prices and deterministic cent remainder',()=>{
 for(const [n,expected] of [[1,[1]],[199,[199]],[200,[200]],[201,[200,1]],[400,[200,200]],[450,[200,200,50]]])assert.deepEqual(prepareEcountFinancials(fixture([n])).rows.map(r=>r[19]),expected);
 const r=fixture([1,1,1]);r.items.forEach((i,n)=>{i.lineSubtotalMinor=[15400,15900,15900][n];r.orders[n].financial.totalMinor=i.lineSubtotalMinor;});
 const out=buildEcountRows({items:r.items,orders:r.orders,issues:[],summary:{}},r.settings),view=prepareEcountFinancials({...r,...out});
 assert.equal(view.rows[0][21],157.33);assert.equal(view.financials.grossMinor,47200);
 const fractional=fixture([3]);fractional.items[0].lineSubtotalMinor=10000;fractional.orders[0].financial.totalMinor=10000;
 const f=buildEcountRows({items:fractional.items,orders:fractional.orders,issues:[],summary:{}},fractional.settings);assert.equal(f.ok,true);assert.equal(prepareEcountFinancials({...fractional,...f}).financials.grossMinor,10000);
});
test('preserves ERP variant suffix, stock/nonstock separation, and saved legacy downloads',()=>{
 const r=fixture([1,2]);r.settings.skuMappings.OTHER={...r.settings.skuMappings.SKU,erpSku:'NEW00122'};r.items[1].sku='OTHER';
 r.orders[0].financial.shippingMinor=8000;r.orders[0].financial.totalMinor+=8000;
 const out=buildEcountRows({items:r.items,orders:r.orders,issues:[],summary:{}},r.settings),record={...r,...out},v=prepareEcountFinancials(record);
 assert.equal(v.rows.length,3);assert.deepEqual(new Set(v.rows.map(r=>r[11])),new Set(['NEW0012','NEW00122','SHIP']));
 assert.equal(v.salesLayout.lines.filter(l=>!l.physical).length,1);
 const old=fixture([1,2]);delete old.settings.salesExportMode;delete old.salesLayout;assert.equal(buildEcountUploadTable(old).rows.length,2);
 const trace=savedBatchTables(record,'prepick').find(t=>t.name==='彙總銷貨對照');assert.ok(trace);assert.equal(trace.rows.length,4);
});
test('modified layout, unknown mode and incompatible source data fail closed',()=>{
 const r=fixture();r.salesLayout.lines[0].allocations[0].quantity++;assert.throws(()=>buildEcountUploadTable(r),/對照不一致/);
 const invalid=fixture();invalid.settings.salesExportMode='other';assert.throws(()=>buildEcountUploadTable(invalid),/未知/);
 const wrong=fixture();wrong.rows[0][6]='004';assert.throws(()=>buildEcountUploadTable(wrong),/客戶、店鋪或倉庫/);
 const serial=fixture();serial.rows[0][17]='SN0000000001';assert.throws(()=>buildEcountUploadTable(serial),/已有序號/);
});
test('grouped ERP receipt restores ten independent orders and all 450 unique SN across a split source line',async()=>{
 const r=fixture(),data=receipt(r,true),result=await reconcileSales(data,stored(r));
 assert.equal(result.parsed.workOrders.length,10);assert.equal(result.receipt.lines.length,3);
 const sn=result.parsed.workOrders.flatMap(o=>o.items.flatMap(i=>i.serials));assert.equal(sn.length,450);assert.equal(new Set(sn).size,450);
 for(const o of result.parsed.workOrders){assert.equal(o.items[0].quantity,45);assert.equal(o.items[0].serials.length,45);}
 const reordered=[data[0],...data.slice(1).reverse()];assert.equal((await reconcileSales(reordered,stored(r))).receipt.fingerprint,result.receipt.fingerprint);
 const noSn=await reconcileSales(receipt(r),stored(r));assert.ok(noSn.parsed.workOrders.every(o=>o.items.every(i=>i.serials.length===0)));
});
test('grouped return rejects duplicate/missing rows, wrong money/quantity/barcode and duplicate or partial SN',async()=>{
 const r=fixture(),base=receipt(r,true);
 for(const change of [d=>d.push(d[1]),d=>d.pop(),d=>d[1][10]++,d=>d[1][12]++,d=>d[1][14]='BAD',d=>d[2][15]=d[1][15],d=>d[2][15]='',d=>d[1][8]='AG-OTHER']){
  const d=structuredClone(base);change(d);await assert.rejects(reconcileSales(d,stored(r)));
 }
 const summary=receipt(r,true);for(const row of summary.slice(1)){row[16]=row[15];row[15]='';}const result=await reconcileSales(summary,stored(r));assert.equal(result.parsed.workOrders.flatMap(o=>o.items.flatMap(i=>i.serials)).length,450);
});
