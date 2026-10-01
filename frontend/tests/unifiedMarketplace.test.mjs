import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectMarketplaceRows,parseUnifiedMarketplace,prepareUnifiedMarketplace,buildUnifiedConversion} from '../src/utils/unifiedMarketplace.mjs';
const table=rows=>{const h=[...new Set(rows.flatMap(Object.keys))];return [h,...rows.map(r=>h.map(k=>r[k]??''))];};
const item=(extra={})=>({Name:'SYN-A',Id:'SYN-ID','Financial Status':'paid','Fulfillment Status':'unfulfilled',Currency:'TWD',Subtotal:'100',Shipping:'0',Taxes:'0',Total:'100','Discount Amount':'0','Refunded Amount':'0','Payment Method':'card','Lineitem quantity':'1','Lineitem name':'合成商品','Lineitem price':'100','Lineitem sku':'0001','Lineitem discount':'0',...extra});
const config=(raw,extra={})=>({store:'合成商店',customerCode:'CUST',warehouseCode:'003',date:'2026-09-15',batchSequence:'1',batchNumber:'TEST-SYNTHETIC',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,discountAllocationConfirmed:true,skuMappings:Object.fromEntries(raw.items.map(i=>[i.sku,{erpSku:i.sku,erpName:i.productName,barcode:'SYN-'+i.sku,confirmed:true,barcodeConfirmed:true}])),shippingSku:{erpSku:'SHIPPING',name:'運費',confirmed:true,nonStock:true},...extra});
const run=(rows,extra={})=>{const {parsed}=parseUnifiedMarketplace(table(rows));return prepareUnifiedMarketplace(parsed,config(parsed,extra));};
test('auto detection projects only permitted fields and preserves leading zero SKU',()=>{
 const source=inspectMarketplaceRows(table([item({Email:'PRIVATE',Phone:'PRIVATE','Billing Address1':'PRIVATE'})]));
 assert.equal(source.platform,'Shopify');assert.doesNotMatch(JSON.stringify(source),/PRIVATE|Billing/);assert.match(JSON.stringify(source),/0001/);
 assert.equal(parseUnifiedMarketplace([['Title'],...source.rows]).parsed.orders.length,1);
 assert.throws(()=>inspectMarketplaceRows([['SKU','Total'],['x','1']]),/無法辨識/);
 assert.throws(()=>inspectMarketplaceRows([source.rows[0].concat('Name'),...source.rows.slice(1)]),/重複欄名/);
});
test('paid and Shopify custom COD are eligible; other pending, cancelled, refund, fulfilled are excluded',()=>{
 const rows=[item(),item({Name:'COD','Financial Status':'pending','Payment Method':'custom'}),item({Name:'ATM','Financial Status':'pending','Payment Method':'ATM'}),item({Name:'SENT','Fulfillment Status':'fulfilled'}),item({Name:'REFUND','Financial Status':'refunded','Refunded Amount':'100'}),item({Name:'CANCEL','Cancelled at':'2026-09-15'})];
 const result=run(rows);assert.equal(result.output.ok,true);assert.deepEqual(result.parsed.orders.map(o=>o.sourceOrderNumber),['SYN-A','COD']);assert.equal(result.output.summary.physicalQuantity,2);assert.equal(result.choices.filter(c=>!c.eligible).length,4);
});
test('discount and free shipping preserve source values and exactly match ECOUNT total',()=>{
 const r=item({Subtotal:'70',Shipping:'10',Total:'70','Discount Amount':'40'});
 const result=run([r]);assert.equal(result.output.ok,true);assert.equal(result.output.rows.length,1);assert.equal(result.output.rows[0][21],70);
 assert.equal(result.parsed.orders[0].financial.sourceShippingMinor,1000);assert.equal(result.parsed.orders[0].financial.shippingMinor,0);assert.equal(result.parsed.items[0].allocatedDiscountMinor,3000);
 const automatic=run([r],{discountAllocationConfirmed:false,taxConfirmed:false});assert.equal(automatic.output.ok,true);assert.equal(automatic.effectiveSettings.discountAllocationConfirmed,true);assert.equal(automatic.effectiveSettings.taxConfirmed,true);assert.ok(!automatic.output.issues.some(i=>i.code==='ALLOCATION_CONFIRMATION'));
});
test('remaining order discount is proportionally allocated after known line discounts, stable on reorder',()=>{
 const common={Subtotal:'140',Total:'140','Discount Amount':'60'};
 const a=item({...common,'Lineitem sku':'A','Lineitem discount':'20'}),b=item({...common,'Lineitem sku':'B'});
 const p=run([a,b]),q=run([b,a]);assert.equal(p.output.ok,true);assert.equal(p.output.summary.ecountTotalMinor,14000);
 assert.deepEqual(p.parsed.items.map(i=>[i.sku,i.lineSubtotalMinor]).sort(),q.parsed.items.map(i=>[i.sku,i.lineSubtotalMinor]).sort());
 assert.equal(p.parsed.items.reduce((n,i)=>n+i.allocatedDiscountMinor,0),4000);
});
test('same SKU at different discounts gets stable distinct references; identical duplicates still block',()=>{
 const a=item({Subtotal:'150',Total:'150','Discount Amount':'50','Lineitem discount':'50'}),b=item({Subtotal:'150',Total:'150','Discount Amount':'50'});
 const result=run([a,b]);assert.equal(result.output.ok,true);assert.equal(new Set(result.output.rows.map(r=>r[15])).size,2);
 assert.equal(run([item({Subtotal:'200',Total:'200'}),item({Subtotal:'200',Total:'200'})]).output.ok,false);
});
test('fractional cent unit prices, mixed currency, unknown tax and inconsistent totals stop ECOUNT output',()=>{
 assert.equal(run([item({'Lineitem quantity':'3','Lineitem price':'1',Subtotal:'2',Total:'2','Discount Amount':'1'})]).output.ok,false);
 assert.equal(run([item({Currency:'USD'})]).output.ok,false);
 assert.equal(run([item({Taxes:'5',Total:'105'})]).output.ok,false);
 assert.equal(run([item({Total:'110'})]).output.ok,false);
});
test('SHOPLINE explicit aliases normalize ordinary orders, no guessing on missing financial columns',()=>{
 const row={'訂單編號':'SL-SYN','商品貨號':'0001','商品名稱':'合成商品','數量':'1','單價':'100','付款狀態':'已付款','送貨狀態':'備貨中','付款方式':'信用卡','訂單狀態':'已確認','訂單小計':'100','運費':'0','優惠折扣':'0','訂單合計':'100'};
 const {source,parsed}=parseUnifiedMarketplace(table([row]));assert.equal(source.platform,'SHOPLINE');assert.equal(parsed.orders[0].sourcePlatform,'SHOPLINE');assert.equal(parsed.orders[0].financial.currency,null);
 const result=buildUnifiedConversion(source.rows,config(parsed));assert.equal(result.output.ok,true);assert.equal(result.output.rows[0][13],'SHOPLINE');assert.match(result.output.rows[0][15],/^SL-/);
 delete row['訂單合計'];assert.throws(()=>parseUnifiedMarketplace(table([row])),/SHOPLINE.*缺少/);
});
test('SHOPLINE file mode never treats failed or expired COD as eligible pending payment',()=>{
 const row={'訂單號碼':'SL-PAID','商品貨號':'0001','商品名稱':'合成商品','數量':'1','單價':'100','付款狀態':'已付款','送貨狀態':'備貨中','付款方式':'信用卡','訂單狀態':'已確認','訂單小計':'100','運費':'0','優惠折扣':'0','訂單合計':'100'};
 const rows=[row,...['付款失敗','付款已逾期'].map((status,index)=>({...row,'訂單號碼':'SL-FAILED-'+index,'付款狀態':status,'付款方式':'貨到付款'})),{...row,'訂單號碼':'SL-CANCELLED','訂單狀態':'已取消'}];
 const {parsed}=parseUnifiedMarketplace(table(rows)),result=prepareUnifiedMarketplace(parsed,config(parsed));
 assert.equal(result.output.ok,true);assert.deepEqual(result.parsed.orders.map(order=>order.sourceOrderNumber),['SL-PAID']);
 assert.deepEqual(result.choices.filter(choice=>!choice.eligible).map(choice=>choice.reason),['付款失敗','付款期限已過','已取消訂單']);
 assert.equal(result.output.summary.physicalQuantity,1);assert.equal(result.output.summary.ecountTotalMinor,10000);
});
test('unknown SHOPLINE bundle structure blocks instead of double counting parent and children',()=>{
 const row={'訂單號碼':'SL','商品貨號':'0001','商品名稱':'合成套組','數量':'1','單價':'100','付款狀態':'已付款','送貨狀態':'待出貨','付款方式':'信用卡','訂單狀態':'已確認','訂單小計':'100','運費':'0','優惠折扣':'0','訂單合計':'100','商品類型':'組合商品'};
 const {parsed}=parseUnifiedMarketplace(table([row]));assert.equal(prepareUnifiedMarketplace(parsed,config(parsed)).output.ok,false);
});

test('scientific-notation SKUs cannot collapse distinct products even with confirmed mappings',()=>{
 for(const code of ['4.71E+12','4.71e13','471E+10']){
  const rows=table([item({'Lineitem sku':code,'Lineitem name':'商品甲'}),item({Name:'SYN-B','Lineitem sku':code,'Lineitem name':'商品乙'})]);
  assert.throws(()=>parseUnifiedMarketplace(rows),/科學記號/);
  assert.throws(()=>buildUnifiedConversion(rows,{skuMappings:{[code]:{erpSku:'4711299273094',confirmed:true}}}),/科學記號/);
 }
 assert.throws(()=>inspectMarketplaceRows([['訂單編號','產品SKU','產品數量'],['ONE','4.71E+12',1]]),/科學記號/);
 const sl={'訂單號碼':'SL','商品貨號':'4.71E+12','商品名稱':'商品','數量':1,'單價':100,'付款狀態':'已付款','送貨狀態':'備貨中','付款方式':'信用卡','訂單狀態':'已確認','訂單小計':100,'運費':0,'優惠折扣':0,'訂單合計':100};
 assert.throws(()=>parseUnifiedMarketplace(table([sl])),/科學記號/);
});

test('complete distinct SKUs survive grouping and identical SKUs sum quantity and money',()=>{
 const rows=[item({'Lineitem sku':'04711299273094'}),item({Name:'SYN-B','Lineitem sku':'NEW47112992730942'}),item({Name:'SYN-C','Lineitem sku':'04711299273094',Subtotal:200,Total:200,'Lineitem quantity':2})];
 const result=run(rows,{salesExportMode:'product-200-v1'});assert.equal(result.output.ok,true);
 assert.equal(result.output.salesLayout.lines.length,2);assert.equal(result.output.summary.physicalQuantity,4);
 const same=result.output.salesLayout.lines.find(x=>x.productCode==='04711299273094');assert.equal(same.quantity,3);assert.equal(same.grossMinor,30000);
 const other=result.output.salesLayout.lines.find(x=>x.productCode==='NEW47112992730942');assert.equal(other.quantity,1);
});
