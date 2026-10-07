const {createMarketplacePreparation}=require('../services/marketplacePreparation');
const {resolveProducts,verifyCatalogMappings}=require('../services/marketplaceProductCatalog');
const barcode='4711299274435';
const first=`${barcode}-蒂蒂©️ Didi Chen-第一團`,second=`${barcode}-蒂蒂©️ Didi Chen-第二團`;
const product={erp_sku:`NEW${barcode}`,barcode,product_name:'ERP 萬用勾',spec:'灰色',active:true};
const profile={id:1,platform:'1Shop',store:'已設定的 1Shop 店鋪',settings:{store:'已設定的 1Shop 店鋪',apiConnectionId:'test-connection',customerCode:'00088',customerName:'平台收入',warehouseCode:'003',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true}};
const table=records=>{const headers=[...new Set(records.flatMap(Object.keys))];return [headers,...records.map(r=>headers.map(h=>r[h]??''))];};
const line=(number,sku,quantity,price)=>({'訂單編號':number,'建立日期':'2026-10-07','訂單狀態':'已確認','名稱':'一般品','產品SKU':sku,'產品':'商城萬用勾','產品數量':quantity,'數量(單品/組合/任選)':quantity,'單價':price,'小計':quantity*price,'訂單金額(不含金/物流手續費)':quantity*price,'訂單金流手續費':0,'訂單運費':0,'總計金額':quantity*price,'金流':'信用卡','金流狀態':'已付款','物流狀態':'等待出貨'});
function harness(products=[product]){
 const pool={query:jest.fn(async sql=>({rows:sql.includes('marketplace_store_profiles')?[profile]:[]})),connect:jest.fn()};
 const verifyOneShop=jest.fn(async rows=>({rows,verification:{platform:'1Shop',shop:'https://company.1shop.tw',orders:rows.slice(1).map(row=>{const value=Object.fromEntries(rows[0].map((name,i)=>[name,row[i]]));return {number:value['訂單編號'],items:[{sku:value['產品SKU'],quantity:value['產品數量'],netMinor:value['小計']*100}]};}),fingerprint:'current-exact-api-proof'}}));
 const lookup=jest.fn(async skus=>({products:resolveProducts(skus,products),sync:{source_note:'Read-only local test reference'}}));
 return {pool,verifyOneShop,lookup,prepare:createMarketplacePreparation({pool,verifyOneShop,resolveProducts:lookup})};
}
test('campaigns resolve one exact barcode, aggregate quantity/money into 200-unit rows and retain source identities',async()=>{
 const h=harness(),rows=table([line('TST-CAMPAIGN-1',first,210,100),line('TST-CAMPAIGN-2',second,240,200)]);
 const result=await h.prepare({rows});
 expect(h.verifyOneShop).toHaveBeenCalledWith(result.source.rows,{apiConnectionId:'test-connection'});
 expect(h.lookup).toHaveBeenCalledWith([first,second,barcode]);
 expect(result.output.ok).toBe(true);expect(result.barcodeConflicts).toEqual([]);expect(result.barcodeReviews).toEqual([]);
 const {prepareEcountFinancials,buildEcountUploadTable}=await import('../services/marketplaceIntake.mjs');
 const record={...result.output,settings:result.settings,orders:result.parsed.orders,items:result.parsed.items};
 const view=prepareEcountFinancials(record),file=buildEcountUploadTable(record);
 expect(view.rows.map(row=>row[19])).toEqual([200,200,50]);
 expect(file.headers).toHaveLength(27);expect(file.rows.map(row=>row[file.headers.indexOf('數量')])).toEqual([200,200,50]);
 expect(file.rows.every(row=>row[11]===product.erp_sku)).toBe(true);
 expect(view.rows.reduce((n,row)=>n+row[23]+row[24],0)).toBe(69000);
 expect(view.rows.every(row=>Number.isInteger(row[23])&&Number.isInteger(row[24]))).toBe(true);
 expect(result.parsed.items.map(item=>item.sku)).toEqual([first,second]);
 expect(new Set(result.parsed.items.map(item=>item.sourceLineId)).size).toBe(2);
 expect(result.parsed.items[0]).toMatchObject({sourceBarcode:barcode,campaignGroupName:'蒂蒂©️ Didi Chen',campaignRound:'第一團',groupName:'一般品'});
 expect(Object.keys(result.settings.skuMappings)).toEqual([first,second]);
 for(const sku of [first,second])expect(result.settings.skuMappings[sku]).toMatchObject({erpSku:product.erp_sku,barcode,barcodeConfirmed:true,confirmed:true});
 expect(result.prepick.rows).toHaveLength(1);expect(result.prepick.rows[0][5]).toBe(450);
 const allocations=result.output.salesLayout.lines.flatMap(row=>row.allocations);
 for(const item of result.parsed.items)expect(allocations.filter(a=>a.identity[3]===item.sourceLineId).reduce((n,a)=>n+a.quantity,0)).toBe(item.quantity);
 expect(result.sourceEvidence.rows).toEqual(result.source.rows);
 expect(result.verification.orders.flatMap(order=>order.items).every(item=>!Object.hasOwn(item,'barcode'))).toBe(true);
 expect(h.pool.connect).not.toHaveBeenCalled();
 await expect(verifyCatalogMappings(null,result.settings,[first,second],async()=>({products:[product]}),undefined,{platform:'1Shop'})).resolves.toBeUndefined();
});
test.each([
 ['missing',[],'不在 ECOUNT'],
 ['inactive',[{...product,active:false}],'中止使用'],
 ['ambiguous',[product,{...product,erp_sku:barcode}],'多個'],
 ['raw SKU names another product',[product,{...product,erp_sku:first,barcode:''}],'不同 ECOUNT'],
 ['ERP barcode differs',[{...product,erp_sku:barcode,barcode:'4711299270000'}],'條碼不同']
])('campaign %s fails before producing a sales file',async(_,products,message)=>{
 const h=harness(products);await expect(h.prepare({rows:table([line('TST-CAMPAIGN-1',first,1,100)])})).rejects.toThrow(message);
 expect(h.pool.connect).not.toHaveBeenCalled();
});
test('confirmed stale mappings are not silently replaced',async()=>{
 const h=harness(),rows=table([line('TST-CAMPAIGN-1',first,1,100)]);
 await expect(h.prepare({rows,settings:{skuMappings:{[first]:{erpSku:'OTHER',confirmed:true}}}})).rejects.toMatchObject({code:'BARCODE_AMBIGUOUS'});
 await expect(h.prepare({rows,settings:{skuMappings:{[first]:{erpSku:'OTHER',confirmed:false,erpConfirmed:true}}}})).rejects.toMatchObject({code:'BARCODE_AMBIGUOUS'});
 await expect(h.prepare({rows,settings:{skuMappings:{[first]:{erpSku:product.erp_sku,barcode:'4711299270000',barcodeConfirmed:true}}}})).rejects.toMatchObject({code:'BARCODE_AMBIGUOUS'});
 await expect(h.prepare({rows,settings:{skuMappings:{[first]:{erpSku:product.erp_sku,barcode:'4711299270000',confirmed:true}}}})).rejects.toMatchObject({code:'BARCODE_AMBIGUOUS'});
});
test('saved campaign mappings recheck current reference and ignore tampered extracted metadata',async()=>{
 const settings={skuMappings:{[first]:{erpSku:product.erp_sku,barcode,barcodeConfirmed:true}}};
 const context={platform:'1Shop',items:[{sku:first,sourceBarcode:'4711299270000'}]};
 const verify=(products,override=settings)=>verifyCatalogMappings(null,override,[first],async()=>({products}),undefined,context);
 await expect(verify([product])).resolves.toBeUndefined();
 await expect(verify([{...product,active:false}])).rejects.toThrow('中止使用');
 await expect(verify([product,{...product,erp_sku:barcode}])).rejects.toThrow('多個');
 await expect(verify([{...product,barcode:'4711299270000',erp_sku:barcode}])).rejects.toThrow('條碼不同');
 await expect(verify([product],{skuMappings:{[first]:{erpSku:product.erp_sku,barcode:'4711299270000',barcodeConfirmed:true}}})).rejects.toThrow('對照已變更');
 await expect(verifyCatalogMappings(null,settings,[first],async()=>null,undefined,context)).rejects.toThrow('無法核對');
});
test('a compound-looking SKU on another platform is never normalized',async()=>{
 const settings={skuMappings:{[first]:{erpSku:'OTHER',barcode:'',confirmed:true}}};
 await expect(verifyCatalogMappings(null,settings,[first],async()=>({products:[product,{erp_sku:'OTHER',barcode:'',product_name:'手動商品',active:true}]}),undefined,{platform:'Shopify'})).resolves.toBeUndefined();
});
