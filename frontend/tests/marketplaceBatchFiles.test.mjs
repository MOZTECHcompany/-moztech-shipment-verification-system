import test from 'node:test';
import assert from 'node:assert/strict';
import {savedBatchTables} from '../src/utils/marketplaceBatchFiles.mjs';
import {parseUnifiedMarketplace,prepareUnifiedMarketplace} from '../src/utils/unifiedMarketplace.mjs';
const r={handler:{userId:7,name:'原承辦人',username:'staff'},batchNumber:'SYN',platform:'Shopify',store:'Synthetic',settings:{date:'2026-09-16',skuMappings:{NEW0012:{erpSku:'NEW0012',erpName:'Film',barcode:'not-confirmed',barcodeConfirmed:false}}},prepick:{headers:['SKU','Qty'],rows:[['NEW0012',2]]},reportHeaders:['Order','Total'],reportRows:[['SYN-01',123]],items:[{sku:'NEW0012',sourceOrderNumber:'SYN-01',sourceLineId:'LINE-1',quantity:2,lineSubtotalMinor:12300}],links:[{source_order_number:'SYN-01',work_barcode:'WT-SYN'}]};
test('saved downloads preserve exact source identifier, amounts and work barcode without current converter draft',()=>{
 const tables=savedBatchTables(r,'prepick');
 assert.deepEqual(tables[1].rows,[['SKU','Qty','轉檔建立者'],['NEW0012',2,'原承辦人']]);
 assert.deepEqual(tables[2].rows[1].slice(0,10),['SYN-01','LINE-1','NEW0012','NEW0012','Film','',2,123,'WT-SYN','原承辦人']);
 assert.deepEqual(tables[2].rows[1].slice(10,19),Array(9).fill(''));
 assert.deepEqual(tables[2].rows[1].slice(19,21),['Film','']);
 assert.deepEqual(tables[2].rows[1].slice(21),Array(4).fill(''));
 assert.match(tables[0].rows.flat().join(' '),/不是 ECOUNT 理貨回匯檔/);
 const confirmed=structuredClone(r);confirmed.settings.skuMappings.NEW0012.barcodeConfirmed=true;confirmed.settings.skuMappings.NEW0012.barcode='0012';
 assert.equal(savedBatchTables(confirmed,'prepick')[2].rows[1][5],'0012');
});

test('saved order details retain only the matching order delivery fields and preserve source data',()=>{
 const record=structuredClone(r);
 record.orders=[{sourcePlatform:'Shopify',sourceOrderNumber:'SYN-OTHER',shipping:{recipient:'其他收件人'}},{sourcePlatform:'Shopify',sourceOrderNumber:'SYN-01',shipping:{recipient:'測試收件人',phone:'0900000000',address:'測試地址 1 號',postalCode:'00100',method:'超商取貨付款',storeName:'測試門市',storeCode:'000123',trackingNumber:'000456',note:'請保留外盒',paymentCard:'PRIVATE_CARD',billingAddress:'PRIVATE_BILLING'}}];
 const before=structuredClone(record),tables=savedBatchTables(record,'prepick');
 const row=tables.find(t=>t.name==='訂單商品明細').rows[1];
 assert.deepEqual(row.slice(10,19),['測試收件人','0900000000','測試地址 1 號','00100','超商取貨付款','測試門市','000123','000456','請保留外盒']);
 const shipping=tables.find(t=>t.name==='配送資料');
 assert.equal(shipping.rows[1][4],'其他收件人');
 assert.deepEqual(shipping.rows[2],['SYN-01','Shopify','Synthetic','WT-SYN',...row.slice(10,19)]);
 assert.doesNotMatch(JSON.stringify(tables),/PRIVATE_CARD|PRIVATE_BILLING/);
 assert.deepEqual(record,before);
});

test('saved warehouse downloads separate the effective marketplace name from ERP name and specification',()=>{
 const record=structuredClone(r);
 record.items[0].productName='商城保護貼 iPhone Pro（無貼膜神器）';
 record.settings.skuMappings.NEW0012.spec='iPhone Pro';
 const before=structuredClone(record),table=savedBatchTables(record,'prepick').find(t=>t.name==='訂單商品明細');
 assert.equal(table.rows[1][4],record.items[0].productName);
 assert.equal(table.rows[1][table.rows[0].indexOf('ECOUNT品項名稱')],'Film');
 assert.equal(table.rows[1][table.rows[0].indexOf('規格')],'iPhone Pro');
 assert.equal(table.rows[1][6],2);assert.equal(table.rows[1][7],123);
 assert.deepEqual(record,before);
});

test('historical mapping warnings are visible in prepick and item sheets',()=>{
 const sheets=savedBatchTables({...r,reviewWarning:'來源尾碼品項已停用'},'prepick');
 for(const name of ['預揀總表','訂單商品明細'])assert.match(sheets.find(s=>s.name===name).rows[0][0],/不可作為出貨依據.*已停用/);
});

test('saved campaign downloads append source metadata and trace each grouped allocation to its own campaign', () => {
 const barcode='4711299274435',skus=[`${barcode}-蒂蒂©️ Didi Chen-第一團`,`${barcode}-另一團組-第二團`];
 const headers=['訂單編號','名稱','產品SKU','產品','產品數量','數量(單品/組合/任選)','單價','小計','訂單金額(不含金/物流手續費)','訂單金流手續費','訂單運費','總計金額','金流','金流狀態','物流狀態'];
 const rows=[headers,...skus.map((sku,index)=>[`SYN-${index}`,'一般品',sku,'合成商品',1,1,100,100,100,0,0,100,'信用卡','已付款','等待出貨'])];
 const {parsed}=parseUnifiedMarketplace(rows);
 const settings={store:'合成商店',customerCode:'CUST',warehouseCode:'003',date:'2026-10-07',batchSequence:'1',batchNumber:'TEST-CAMPAIGN-FILE',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,salesExportMode:'product-200-v1',skuMappings:Object.fromEntries(skus.map(sku=>[sku,{erpSku:'ERP-CAMPAIGN',erpName:'合成 ERP 商品',barcode,erpConfirmed:true,barcodeConfirmed:true}]))};
 const converted=prepareUnifiedMarketplace(parsed,settings),record={...converted.output,settings:converted.effectiveSettings,items:converted.parsed.items,orders:converted.parsed.orders,prepick:converted.prepick};
 assert.equal(converted.output.ok,true);
 const before=structuredClone(record),tables=savedBatchTables(record,'prepick');
 const details=tables.find(table=>table.name==='訂單商品明細');
 assert.deepEqual(details.rows[0].slice(21),['來源SKU條碼','來源團組名稱','來源團次','來源SKU格式']);
 for(const row of details.rows.slice(1)){
  const item=record.items.find(item=>item.sourceLineId===row[1]);
  assert.equal(row[2],item.sku);assert.deepEqual(row.slice(21),[barcode,item.campaignGroupName,item.campaignRound,item.sourceSkuFormat]);
 }
 const trace=tables.find(table=>table.name==='彙總銷貨對照');
 assert.deepEqual(trace.rows[0].slice(10),['來源SKU','來源SKU條碼','來源團組名稱','來源團次','來源SKU格式']);
 assert.equal(new Set(trace.rows.slice(1).map(row=>row[0])).size,1);
 for(const row of trace.rows.slice(1)){
  const item=record.items.find(item=>item.sourceLineId===row[7]);
  assert.deepEqual(row.slice(10),[item.sku,barcode,item.campaignGroupName,item.campaignRound,item.sourceSkuFormat]);
 }
 assert.deepEqual(record,before);
});
