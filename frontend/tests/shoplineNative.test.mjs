import test from 'node:test';
import assert from 'node:assert/strict';
import {parseUnifiedMarketplace,prepareUnifiedMarketplace} from '../src/utils/unifiedMarketplace.mjs';
import {buildEcountUploadTable,ECOUNT_HEADERS,ECOUNT_UPLOAD_HEADERS} from '../src/utils/marketplaceIntake.mjs';
const table=rows=>{const h=[...new Set(rows.flatMap(Object.keys))];return [h,...rows.map(r=>h.map(k=>r[k]??''))];};
const row=(extra={})=>({'訂單號碼':'#SYN-SL','商品貨號':'00001','商品名稱':'合成商品','數量':1,'商品結帳價':100,'商品類型':'商品','付款狀態':'已付款','送貨狀態':'備貨中','付款方式':'信用卡','訂單狀態':'處理中','訂單小計':100,'運費':0,'優惠折扣':0,'訂單合計':100,'稅費':0,'貨幣':'TWD','已退款金額':0,'附加費':0,'自訂折扣合計':0,'折抵購物金':0,'點數折現':0,'商品折扣金額':'','全單折扣金額':'','折抵購物金分攤':'','點數折現分攤':'',...extra});
const run=rows=>{
 const {parsed,source}=parseUnifiedMarketplace(table(rows));
 const config={store:'SYN',customerCode:'SYN',warehouseCode:'003',date:'2026-09-16',batchSequence:'1',batchNumber:'TEST-NATIVE-SL',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,
 skuMappings:Object.fromEntries(parsed.items.map(i=>[i.sku,{erpSku:'ERP-'+i.sku,confirmed:true,barcode:'SYN-'+i.sku,barcodeConfirmed:true}])),shippingSku:{erpSku:'SYN-SHIP',confirmed:true,nonStock:true}};
 return {source,raw:parsed,...prepareUnifiedMarketplace(parsed,config)};
};
test('native XLS columns reconcile exact product/order discounts, credits and points without second allocation',()=>{
 const common={'訂單小計':249,'優惠折扣':20,'折抵購物金':10,'點數折現':3,'訂單合計':221,'運費':5};
 const result=run([row({...common,'商品折扣金額':10,'全單折扣金額':10,'折抵購物金分攤':4,'點數折現分攤':1}),row({...common,'商品貨號':'00002','商品結帳價':149,'商品類型':'加購品','折抵購物金分攤':6,'點數折現分攤':2})]);
 assert.equal(result.output.ok,true);assert.equal(result.output.summary.ecountTotalMinor,22100);
 assert.deepEqual(result.parsed.items.map(i=>i.lineSubtotalMinor),[7500,14100]);
 assert.equal(result.raw.orders[0].financial.subtotalMinor,24900);
 assert.equal(result.parsed.orders[0].financial.subtotalMinor,21600);
 assert.equal(result.raw.orders[0].financial.creditMinor,1000);
 assert.equal(result.output.rows.length,3);assert.equal(result.prepick.summary.physicalQuantity,2);
 assert.equal(result.parsed.items[0].sourceDiscounts.product,1000);
});
test('native export continuation cells, different prices for one SKU and row order preserve identity',()=>{
 const a=row({'商品結帳價':990,'訂單小計':1880,'訂單合計':1880});
 const b=row({'商品結帳價':890,'訂單小計':'','訂單合計':'','商品類型':'加購品'});
 const p=run([a,b]),q=run([b,a]);assert.equal(p.output.ok,true);
 assert.equal(p.prepick.rows.length,1);assert.equal(p.prepick.rows[0][5],2);
 assert.equal(new Set(p.parsed.items.map(i=>i.sourceLineId)).size,2);
 assert.deepEqual(p.parsed.items.map(i=>i.sourceLineId).sort(),q.parsed.items.map(i=>i.sourceLineId).sort());
});
test('native COD stays unpaid; shipped, partial, refunded and cancelled orders excluded',()=>{
 const p=run([row(),row({'訂單號碼':'COD','付款狀態':'未付款','付款方式':'7-11 取貨付款'}),row({'訂單號碼':'SENT','送貨狀態':'已發貨'}),row({'訂單號碼':'PART','送貨狀態':'部分已發貨'}),row({'訂單號碼':'REFUND','已退款金額':1}),row({'訂單號碼':'CANCEL','訂單狀態':'已取消'})]);
 assert.equal(p.output.ok,true);assert.deepEqual(p.parsed.orders.map(o=>o.sourceOrderNumber),['#SYN-SL','COD']);assert.equal(p.parsed.orders[1].paymentStatus,'pending');
});
test('mismatched, negative, unknown or incomplete financial allocations cannot produce sales rows',()=>{
 for(const extra of [{'折抵購物金':10,'訂單合計':90},{'全單折扣金額':1},{'商品折扣金額':101},{'商品結帳價':'1.234'},{'稅費':5,'訂單合計':105},{'附加費':5,'訂單合計':105},{'商品類型':'組合商品'},{'數量':0}]){
  const p=run([row(extra)]);assert.equal(p.output.ok,false,JSON.stringify(extra));assert.equal(p.output.rows.length,0);
 }
 const missing=row();delete missing['折抵購物金分攤'];assert.throws(()=>run([missing]),/缺少核對欄位/);
 assert.throws(()=>run([row({'單價':100})]),/同時包含/);
});
test('native order-level conflict and ambiguous repeated item block; source attribution retained',()=>{
 const p=run([row({'訂單小計':200,'訂單合計':200}),row({'訂單小計':201,'訂單合計':200})]);assert.equal(p.output.ok,false);
 assert.equal(run([row({'訂單小計':200,'訂單合計':200}),row({'訂單小計':200,'訂單合計':200})]).output.ok,false);
 const a=run([row({'訂單標籤':'團購甲','合作夥伴':'PARTNER','收件人':'SHIPPING-RECIPIENT','信用卡號':'PRIVATE'})]);
 assert.equal(a.raw.orders[0].attribution.orderTags,'團購甲');assert.match(JSON.stringify(a.source),/SHIPPING-RECIPIENT/);assert.doesNotMatch(JSON.stringify(a.source),/PRIVATE/);
});
test('ECOUNT online uploader maps all 27 columns by name and leaves canonical snapshots intact',()=>{
 const conversion=run([row()]),record={...conversion.output,orders:conversion.parsed.orders,items:conversion.parsed.items,settings:conversion.effectiveSettings};const before=JSON.stringify(record);
 const upload=buildEcountUploadTable(record);assert.equal(upload.headers.length,27);
 assert.deepEqual(upload.headers.slice(23),['商城訂單編號','平台','店鋪','來源明細號']);
 assert.equal(upload.headers[15],'數量');assert.equal(upload.headers[17],'單價(含稅)');
 for(let i=0;i<27;i++)assert.equal(upload.rows[0][i],record.rows[0][record.headers.indexOf(ECOUNT_UPLOAD_HEADERS[i])]);
 assert.equal(JSON.stringify(record),before);assert.deepEqual(buildEcountUploadTable({...record,...upload}),upload);
 assert.throws(()=>buildEcountUploadTable({headers:record.headers,rows:[[]]}),/不完整/);
 assert.throws(()=>buildEcountUploadTable({headers:record.headers.map(()=>''),rows:[]}),/格式無效/);
});
