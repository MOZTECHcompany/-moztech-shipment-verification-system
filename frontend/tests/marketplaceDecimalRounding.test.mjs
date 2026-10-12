import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildEcountRows,buildEcountUploadTable,buildMarketplaceAuditRows,prepareEcountFinancials,groupedSalesRecord,parseMarketplaceRows,parseMoneyMinor,formatMinor,ECOUNT_FINANCIAL_VERSION,ECOUNT_ROUNDING_FINANCIAL_VERSION,ECOUNT_ROUNDING_GROUPED_FINANCIAL_VERSION,ECOUNT_GROUPED_MODE} from '../src/utils/marketplaceIntake.mjs';
import {savedBatchTables} from '../src/utils/marketplaceBatchFiles.mjs';
const require=createRequire(import.meta.url),{reconcileSales,HEADERS}=require('../../backend/src/services/erpSalesReceipt.js');

// Synthetic only: these fixtures never call a platform, database or DEV API.
const baseSettings={salesExportMode:ECOUNT_GROUPED_MODE,store:'SYNTHETIC',customerCode:'00020',warehouseCode:'003',date:'2026-10-12',batchSequence:'1',batchNumber:'TEST-ROUND-1012',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,shippingSku:{erpSku:'FREIGHT',confirmed:true,nonStock:true}};
function sourceFixture(entries=[{number:'TEST-DECIMAL',lines:[{id:'L-A',amount:52510,sku:'A'},{id:'L-B',amount:129000,sku:'B'}]}],overrides={}){
 const items=entries.flatMap(o=>o.lines.map((l,n)=>({sourceOrderNumber:o.number,sourceLineId:l.id||`L-${n}`,sku:l.sku||'A',productName:'Synthetic product',kind:l.kind||'single',quantity:l.quantity??1,lineSubtotalMinor:l.amount})));
 const orders=entries.map(o=>({sourcePlatform:'Shopify',sourceOrderNumber:o.number,paymentStatus:'paid',fulfillmentStatus:'unfulfilled',financial:{currency:'TWD',subtotalMinor:o.lines.reduce((s,l)=>s+(l.amount??0),0),shippingMinor:o.shipping??0,totalMinor:o.lines.reduce((s,l)=>s+(l.amount??0),0)+(o.shipping??0),taxMinor:0,refundedMinor:0,outstandingMinor:0}}));
 const settings={...baseSettings,skuMappings:Object.fromEntries([...new Set(items.map(i=>i.sku))].map(sku=>[sku,{erpSku:sku,erpName:'Synthetic product',barcode:`SYNTHETIC-${sku}`,confirmed:true,barcodeConfirmed:true}])),...overrides};
 return {parsed:{platform:'Shopify',orders,items,issues:[],summary:{orderCount:orders.length,totalMinor:orders.reduce((s,o)=>s+o.financial.totalMinor,0)}},settings};
}
function convert(entries,overrides){
 const {parsed,settings}=sourceFixture(entries,overrides),before=JSON.stringify(parsed),out=buildEcountRows(parsed,settings);
 assert.equal(out.ok,true,JSON.stringify(out.issues));assert.equal(JSON.stringify(parsed),before);
 return {...out,platform:'Shopify',settings,orders:parsed.orders,items:parsed.items,batchNumber:settings.batchNumber,prepick:{headers:[],rows:[]}};
}
function stored(r){return {snapshot:r,batch_number:r.batchNumber,orders:r.orders.map(o=>({source_platform:o.sourcePlatform,source_store:r.settings.store,source_order_number:o.sourceOrderNumber,expected_items:r.items.filter(i=>i.sourceOrderNumber===o.sourceOrderNumber).map(i=>({sourceLineId:i.sourceLineId,productCode:r.settings.skuMappings[i.sku].erpSku,productName:i.productName,barcode:r.settings.skuMappings[i.sku].barcode,quantity:i.quantity}))}))};}
function receipt(r){return [HEADERS,...prepareEcountFinancials(r).rows.map(row=>['20261012-TEST-99',r.batchNumber,row[2],row[6],row[7],row[13],row[14],row[12],row[15],row[11],row[19],row[23],row[24],row[23]+row[24],row[11]==='FREIGHT'?'':`SYNTHETIC-${row[11]}`,'',''])];}
function wholeRows(r){for(const row of prepareEcountFinancials(r).rows){for(const n of [23,24])assert.equal(Number.isInteger(row[n]),true);assert.equal(Number.isInteger(row[23]+row[24]),true);}}

test('decimal discount amounts stay exact in parser, source, report and manifest while ERP rows are whole dollars',()=>{
 const common={Name:'TEST-DECIMAL',Id:'1001','Financial Status':'paid','Fulfillment Status':'unfulfilled',Currency:'TWD',Subtotal:'1815.10',Shipping:'0.00',Taxes:'0.00',Total:'1815.10','Discount Amount':'64.90','Refunded Amount':'0.00','Outstanding Balance':'0.00'};
 const parsed=parseMarketplaceRows([{...common,'Lineitem id':'L-A','Lineitem quantity':1,'Lineitem name':'Synthetic A','Lineitem price':'590.00','Lineitem sku':'A','Lineitem discount':'64.90'},{Name:'TEST-DECIMAL','Lineitem id':'L-B','Lineitem quantity':1,'Lineitem name':'Synthetic B','Lineitem price':'1290.00','Lineitem sku':'B','Lineitem discount':'0.00'}],{platform:'Shopify',allowAllOrders:true});
 assert.deepEqual(parsed.issues,[]);assert.equal(parsed.orders[0].financial.totalMinor,181510);assert.equal(parsed.orders[0].financial.discountMinor,6490);
 const audit=buildMarketplaceAuditRows(parsed);assert.equal(audit.rows[0][audit.headers.indexOf('訂單總額（非實收）')],'1815.10');assert.equal(audit.rows[0][audit.headers.indexOf('折扣（來源）')],'64.90');
 const {settings}=sourceFixture(),before=JSON.stringify(parsed),out=buildEcountRows(parsed,settings),r={...out,settings,orders:parsed.orders,items:parsed.items};
 assert.equal(out.ok,true,JSON.stringify(out.issues));assert.equal(JSON.stringify(parsed),before);assert.equal(out.summary.financialVersion,ECOUNT_ROUNDING_FINANCIAL_VERSION);
 assert.deepEqual([out.summary.sourceTotalMinor,out.summary.ecountTotalMinor,out.summary.roundingDeltaMinor],[181510,181500,-10]);
 assert.deepEqual(out.rows.map(row=>[row[23],row[24]]),[[500,25],[1229,61]]);assert.deepEqual(out.rounding.orders[0].lines.map(l=>[l.sourceGrossMinor,l.ecountGrossMinor,l.roundingDeltaMinor]),[[52510,52500,-10],[129000,129000,0]]);
 const get=h=>out.reportRows[0][out.reportHeaders.indexOf(h)];assert.equal(get('訂單總額（非實收）'),'1815.10');assert.equal(get('折扣（來源）'),'64.90');assert.equal(get('ECOUNT含稅銷貨金額'),'1815.00');assert.equal(get('整元尾差（ERP減來源）'),'-0.10');
 const view=prepareEcountFinancials(r);assert.equal(view.financials.version,ECOUNT_ROUNDING_GROUPED_FINANCIAL_VERSION);assert.deepEqual([view.financials.sourceTotalMinor,view.financials.ecountTotalMinor,view.financials.roundingDeltaMinor],[181510,181500,-10]);wholeRows(r);
});

test('half-up .49 .50 .51 and sub-dollar boundaries preserve physical quantities including zero ERP sales',()=>{
 for(const [source,target] of [[0,0],[49,0],[50,100],[51,100],[1049,1000],[1050,1100],[1051,1100]]){
  const r=convert([{number:'TEST-BOUNDARY',lines:[{id:'L-A',amount:source}]}]);
  assert.equal(r.summary.sourceTotalMinor,source);assert.equal(r.summary.ecountTotalMinor,target);assert.equal(r.summary.roundingDeltaMinor,target-source);assert.equal(r.rows[0][19],1);assert.equal(r.orders[0].financial.totalMinor,source);wholeRows(r);
  if(source===0){assert.equal(r.summary.financialVersion,ECOUNT_FINANCIAL_VERSION);assert.equal(r.rounding,undefined);}else assert.equal(r.rounding.orders[0].roundingDeltaMinor,target-source);
 }
});

test('mixed batch rounds each order before aggregation and never nets source receipt fractions against another order',()=>{
 const r=convert([{number:'TEST-A',lines:[{amount:50}]},{number:'TEST-B',lines:[{amount:50}]},{number:'TEST-INTEGER',lines:[{amount:10000}]}]);
 assert.deepEqual([r.summary.sourceTotalMinor,r.summary.ecountTotalMinor,r.summary.roundingDeltaMinor],[10100,10200,100]);assert.equal(prepareEcountFinancials(r).financials.grossMinor,10200);
 assert.deepEqual(r.rounding.orders.map(o=>o.roundingDeltaMinor),[50,50,0]);
 for(const o of r.rounding.orders){assert.equal(o.lines.reduce((s,l)=>s+l.sourceGrossMinor,0),o.sourceTotalMinor);assert.equal(o.lines.reduce((s,l)=>s+l.ecountGrossMinor,0),o.ecountTotalMinor);assert.equal(o.lines.reduce((s,l)=>s+l.roundingDeltaMinor,0),o.roundingDeltaMinor);}wholeRows(r);
});

test('largest remainder uses stable identities, leaves free components free and does not inflate quantity',()=>{
 const entries=[{number:'TEST-REMAINDER',lines:[{id:'L-C',amount:33},{id:'L-B',amount:33},{id:'L-A',amount:33},{id:'L-FREE',amount:0}]}],r=convert(entries),view=prepareEcountFinancials(r);
 assert.deepEqual(r.rounding.orders[0].lines.map(l=>[l.sourceLineId,l.ecountGrossMinor]),[['L-A',100],['L-B',0],['L-C',0],['L-FREE',0]]);
 const reordered=structuredClone(r);reordered.items.reverse();reordered.orders.reverse();reordered.rows.reverse();assert.deepEqual(prepareEcountFinancials(reordered),view);
 const fresh=convert([{...entries[0],lines:[...entries[0].lines].reverse()}]);assert.deepEqual(fresh.rounding,r.rounding);assert.deepEqual(fresh.salesLayout,r.salesLayout);
 assert.equal(r.items.reduce((s,i)=>s+i.quantity,0),4);
 const bundle=convert([{number:'TEST-BUNDLE',lines:[{id:'ANCHOR',amount:49,kind:'bundle_anchor'},{id:'COMPONENT',amount:null,kind:'bundle_component',sku:'B'}]}],{bundleZeroConfirmed:true});assert.equal(bundle.rounding.orders[0].lines.find(l=>l.sourceLineId==='COMPONENT').ecountGrossMinor,0);assert.equal(bundle.summary.physicalQuantity,2);
});

test('many tiny lines retain every source cent and stable top remainders without assigning money to a free line',()=>{
 const lines=[{id:'L-FREE',amount:0},...Array.from({length:999},(_,i)=>({id:`L-${String(i).padStart(4,'0')}`,amount:1}))],r=convert([{number:'TEST-MANY',lines}]);
 assert.equal(r.summary.sourceTotalMinor,999);assert.equal(r.summary.ecountTotalMinor,1000);assert.equal(r.summary.roundingDeltaMinor,1);assert.equal(r.rounding.orders[0].lines.filter(l=>l.ecountGrossMinor===100).length,10);assert.equal(r.rounding.orders[0].lines.find(l=>l.sourceLineId==='L-FREE').ecountGrossMinor,0);assert.equal(r.summary.physicalQuantity,1000);wholeRows(r);
});

test('safe large source amounts use integer rounding and exact decimal trace text; overflowing targets or batches fail closed',()=>{
 const source=9007199254740949,target=9007199254740900,r=convert([{number:'TEST-LARGE',lines:[{id:'L-A',amount:source}]}]);
 assert.equal(parseMoneyMinor(formatMinor(source)),source);
 assert.equal(r.summary.sourceTotalMinor,source);assert.equal(r.summary.ecountTotalMinor,target);assert.equal(r.summary.roundingDeltaMinor,-49);assert.equal(r.reportRows[0][r.reportHeaders.indexOf('訂單總額（非實收）')],'90071992547409.49');assert.equal(buildEcountUploadTable(r).financials.grossMinor,target);wholeRows(r);
 const tables=savedBatchTables(r,'prepick'),trace=tables.find(t=>t.name==='整元尾差對照');assert.ok(trace.rows.flat().includes('90071992547409.49'));
 const largeQuantity=convert([{number:'TEST-LARGE-QUANTITY',lines:[{id:'L-A',amount:source,quantity:450}]}]);assert.equal(prepareEcountFinancials(largeQuantity).financials.grossMinor,target);assert.deepEqual(prepareEcountFinancials(largeQuantity).rows.map(row=>row[19]),[200,200,50]);wholeRows(largeQuantity);
 for(const entries of [[{number:'TEST-OVERFLOW',lines:[{amount:Number.MAX_SAFE_INTEGER}]}],[{number:'TEST-BIG-A',lines:[{amount:5000000000000049}]},{number:'TEST-BIG-B',lines:[{amount:5000000000000049}]}]]){
  const f=sourceFixture(entries),out=buildEcountRows(f.parsed,f.settings);assert.equal(out.ok,false);assert.equal(out.rows.length,0);assert.ok(out.issues.some(i=>i.code==='TWD_ALLOCATION_INVALID'));
 }
});

test('download rejects missing, changed and unknown rounding manifests or source changes even when rounded amounts stay the same',()=>{
 const r=convert(),before=JSON.stringify(r);assert.equal(buildEcountUploadTable(r).financials.grossMinor,181500);assert.equal(JSON.stringify(r),before);
 const changes=[x=>delete x.rounding,x=>x.rounding.policy='truncate',x=>x.rounding.version='unknown',x=>x.rounding.sourceTotalMinor++,x=>x.rounding.orders[0].ecountTotalMinor++,x=>x.rounding.orders[0].lines[0].roundingDeltaMinor++,x=>x.rounding.orders[0].lines[0].quantity++,x=>x.rounding.orders[0].lines.pop(),x=>x.summary.roundingDeltaMinor++,x=>x.summary.sourceTotalMinor++,x=>{x.items[0].lineSubtotalMinor++;x.orders[0].financial.totalMinor++;},x=>x.rows[0][19]++,x=>x.rows[0][23]++];
 for(const change of changes){const bad=structuredClone(r);change(bad);assert.throws(()=>buildEcountUploadTable(bad));}
 const mismatch=sourceFixture();mismatch.parsed.orders[0].financial.totalMinor++;const blocked=buildEcountRows(mismatch.parsed,mismatch.settings);assert.equal(blocked.ok,false);assert.deepEqual(blocked.rows,[]);
});

test('saved trace distinguishes raw source money, ERP source allocation and signed delta without changing legacy allocation names',()=>{
 const r=convert(),tables=savedBatchTables(r,'prepick'),trace=tables.find(t=>t.name==='整元尾差對照');assert.ok(trace.rows.flat().includes('525.10'));assert.ok(trace.rows.flat().includes('1815.10'));assert.ok(trace.rows.flat().includes('-0.10'));
 const group=tables.find(t=>t.name==='彙總銷貨對照');assert.equal(group.rows[0][9],'來源列ERP分配金額');assert.equal(group.rows[1][9],525);
 const manifest=prepareEcountFinancials(r).salesLayout;assert.equal(manifest.lines[0].allocations[0].sourceGrossMinor,52500);assert.equal(Object.hasOwn(manifest.lines[0].allocations[0],'ecountGrossMinor'),false);
 const ungrouped=convert(undefined,{salesExportMode:'order-lines-v1'}),before=JSON.stringify(ungrouped),rebuilt=groupedSalesRecord(ungrouped);assert.equal(prepareEcountFinancials(rebuilt).financials.sourceTotalMinor,181510);assert.deepEqual(rebuilt.rounding,ungrouped.rounding);assert.equal(JSON.stringify(ungrouped),before);
});

test('strict ERP sales receipt accepts the rounded expected rows and persists exact source and rounding evidence',async()=>{
 const r=convert(),before=JSON.stringify(r),data=receipt(r),result=await reconcileSales(data,stored(r));assert.equal(result.receipt.financials.sourceTotalMinor,181510);assert.equal(result.receipt.financials.grossMinor,181500);assert.equal(result.receipt.financials.roundingDeltaMinor,-10);assert.deepEqual(result.receipt.rounding,r.rounding);assert.equal(result.parsed.workOrders.length,1);assert.equal(result.parsed.workOrders[0].items.length,2);assert.equal(JSON.stringify(r),before);
 const sourceAmountReceipt=structuredClone(data);sourceAmountReceipt[1][11]='500.10';sourceAmountReceipt[1][13]='525.10';await assert.rejects(()=>reconcileSales(sourceAmountReceipt,stored(r)),/稅前／營業稅／含稅金額不符/);
 const wrongTax=structuredClone(data);wrongTax[1][12]++;wrongTax[1][13]++;await assert.rejects(()=>reconcileSales(wrongTax,stored(r)),/稅前／營業稅／含稅金額不符/);
 const wrongQuantity=structuredClone(data);wrongQuantity[1][10]++;await assert.rejects(()=>reconcileSales(wrongQuantity,stored(r)),/商品數量不符/);
});

test('decimal shipping joins per-order rounding but remains nonstock and separate from physical picks and logistics receipts',async()=>{
 const r=convert([{number:'TEST-SHIP',shipping:50,lines:[{id:'L-A',amount:52510}]}]),view=prepareEcountFinancials(r);assert.equal(r.summary.sourceTotalMinor,52560);assert.equal(r.summary.ecountTotalMinor,52600);assert.equal(r.summary.roundingDeltaMinor,40);assert.equal(r.summary.physicalQuantity,1);assert.equal(r.rounding.orders[0].lines.reduce((s,l)=>s+l.sourceGrossMinor,0),52560);assert.equal(view.salesLayout.lines.filter(l=>!l.physical).length,1);wholeRows(r);
 const data=receipt(r),sales=await reconcileSales(data,stored(r));assert.equal(sales.parsed.workOrders[0].items.length,1);const logistics=[data[0],...data.slice(1).filter(row=>row[9]!=='FREIGHT')];const restored=await reconcileSales(logistics,stored(r),{logistics:true});assert.equal(restored.receipt.financials,null);assert.equal(restored.receipt.rounding,undefined);await assert.rejects(()=>reconcileSales(logistics,stored(r)),/全部商品與運費/);
});

test('legacy decimal and integer version-two exports remain unchanged and acquire no rounding manifest',()=>{
 const integer=convert([{number:'TEST-INTEGER',lines:[{id:'L-A',amount:119600,quantity:4}]}]),before=JSON.stringify(integer);assert.equal(integer.summary.financialVersion,ECOUNT_FINANCIAL_VERSION);assert.equal(integer.rounding,undefined);assert.equal(buildEcountUploadTable(integer).financials.version,'twd-vat5-product-200-whole-v2');assert.equal(JSON.stringify(integer),before);
 const old=convert([{number:'TEST-OLD',lines:[{id:'L-A',amount:1000}]}],{salesExportMode:'order-lines-v1'});old.summary.financialVersion='twd-vat5-line-v1';old.summary.ecountTotalMinor=1049;old.items[0].lineSubtotalMinor=1049;old.orders[0].financial.totalMinor=1049;old.rows[0][20]=10.49;old.rows[0][21]=10.49;old.rows[0][23]=10.49;old.rows[0][24]=0;const oldBefore=JSON.stringify(old),file=buildEcountUploadTable(old);assert.equal(file.financials.grossMinor,1049);assert.equal(file.financials.version,'twd-vat5-line-v1');assert.equal(file.financials.roundingDeltaMinor,undefined);assert.equal(JSON.stringify(old),oldBefore);
});
