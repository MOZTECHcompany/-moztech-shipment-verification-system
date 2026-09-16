import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateInclusiveTax,buildEcountRows,buildEcountUploadTable,ECOUNT_FINANCIAL_VERSION} from '../src/utils/marketplaceIntake.mjs';
import {savedBatchTables} from '../src/utils/marketplaceBatchFiles.mjs';
const settings={store:'Store',customerCode:'00020',warehouseCode:'003',date:'2026-09-17',batchSequence:'1',batchNumber:'WMS-20260917-ABCD',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,skuMappings:{NEW0122:{erpSku:'NEW0122',confirmed:true,barcodeConfirmed:false}},projectOwner:'Project owner',salesOwner:'Sales owner',erpStaffCode:'007',erpProjectCode:'P01',erpResponsibilityConfirmed:true};
const parsed={issues:[],summary:{orderCount:1},orders:[{sourcePlatform:'SHOPLINE',sourceOrderNumber:'#001',paymentStatus:'paid',fulfillmentStatus:'unfulfilled',financial:{currency:'TWD',totalMinor:119600}}],items:[{sourceOrderNumber:'#001',sourceLineId:'SL-L01',sku:'NEW0122',productName:'Product',quantity:4,lineSubtotalMinor:119600}]};
const fixture=()=>({...buildEcountRows(parsed,settings),settings,orders:parsed.orders,items:parsed.items,handler:{userId:7,name:'Creator',username:'staff'},batchNumber:settings.batchNumber});
test('line tax uses gross line amount, not rounded unit taxes, while preserving every cent',()=>{
 assert.deepEqual(calculateInclusiveTax(233300,1),{grossMinor:233300,netMinor:222200,taxMinor:11100,netUnitMinor:222200});
 assert.deepEqual(calculateInclusiveTax(119600,4),{grossMinor:119600,netMinor:113900,taxMinor:5700,netUnitMinor:28475});
 for(const gross of [0,1,1049,1050,1051,14600,59000,123456789]){const f=calculateInclusiveTax(gross,3);assert.equal(f.netMinor+f.taxMinor,gross);assert.equal(f.taxMinor%100,0);}
 assert.throws(()=>calculateInclusiveTax(Number.MAX_SAFE_INTEGER+1,1));assert.throws(()=>calculateInclusiveTax(100,0));
});
test('27 column sales output includes net, VAT, responsible codes and immutable source fields; summary stays blank',()=>{
 const r=fixture();assert.equal(r.ok,true);assert.equal(r.summary.financialVersion,ECOUNT_FINANCIAL_VERSION);
 const t=buildEcountUploadTable(r),row=t.rows[0];
 const get=h=>row[t.headers.indexOf(h)];
 assert.equal(get('承辦人'),'007');assert.equal(get('專案'),'P01');assert.equal(get('商城訂單編號'),'#001');assert.equal(get('來源明細號'),'SL-L01');assert.equal(get('品項編碼'),'NEW0122');assert.equal(get('稅前價格'),1139);assert.equal(get('營業稅'),57);assert.equal(get('單價'),284.75);assert.equal(get('單價(含稅)'),299);assert.equal(get('摘要'),'');assert.equal(get('序號/批號'),'');
 assert.equal(buildEcountRows(parsed,{...settings,erpResponsibilityConfirmed:false}).ok,false);
 r.prepick={headers:[],rows:[]};const trace=savedBatchTables(r,'prepick').find(t=>t.name==='金額與追溯').rows.flat();for(const v of ['Creator','Project owner','Sales owner','007','P01'])assert.ok(trace.includes(v));
});
test('legacy blank amounts are corrected only with complete source reconciliation and never mutate saved history',()=>{
 const r=fixture();delete r.summary.financialVersion;for(const i of [20,23,24])r.rows[0][i]='';r.rows[0][17]='SN0000000001';r.rows[0][25]='TEST / hold';const before=JSON.stringify(r);
 const out=buildEcountUploadTable(r);assert.equal(out.financials.recalculatedLegacy,true);assert.equal(out.financials.grossMinor,119600);assert.equal(out.rows[0][13],'SN0000000001');assert.equal(out.rows[0][21],'TEST / hold');assert.equal(JSON.stringify(r),before);
 const bad=structuredClone(r);bad.orders[0].financial.totalMinor++;assert.throws(()=>buildEcountUploadTable(bad),/來源訂單/);
 delete bad.orders;assert.throws(()=>buildEcountUploadTable(bad),/舊批次/);
 r.rows[0][23]=123;assert.throws(()=>buildEcountUploadTable(r),/已有金額/);
});
test('new saved amounts, duplicate sources and batch-total tampering are rejected before download',()=>{
 const r=fixture();r.rows[0][24]=0;assert.throws(()=>buildEcountUploadTable(r),/不一致/);
 const dup=fixture();dup.rows.push([...dup.rows[0]]);assert.throws(()=>buildEcountUploadTable(dup),/重複/);
 const bad=fixture();bad.summary.ecountTotalMinor++;assert.throws(()=>buildEcountUploadTable(bad),/批次不符/);
});
