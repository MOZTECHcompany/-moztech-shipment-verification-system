const {createMarketplacePreparation,selectProfile}=require('../services/marketplacePreparation');
const table=rows=>{const headers=[...new Set(rows.flatMap(Object.keys))];return [headers,...rows.map(r=>headers.map(h=>r[h]??''))];};
const order=extra=>({Name:'#154230',Id:'7624215101596','Financial Status':'pending','Fulfillment Status':'unfulfilled',Currency:'TWD',Subtotal:'890',Shipping:'0',Taxes:'0',Total:'890','Discount Amount':'0','Refunded Amount':'0','Outstanding Balance':'890','Payment Method':'custom','Lineitem quantity':'1','Lineitem name':'來源商品','Lineitem price':'890','Lineitem sku':'4711299272493','Lineitem discount':'0','Lineitem id':'16493014253724','Shipping Name':'收件人','Shipping Address1':'配送地址',...extra});
const profile={id:2,platform:'Shopify',store:'墨子科技 官網',settings:{store:'墨子科技 官網',customerCode:'00063',customerName:'墨子科技 官網',warehouseCode:'003',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,shippingSku:{erpSku:'00001',name:'運費',nonStock:true,confirmed:true}}};
function harness(profiles=[profile],extra={}){
 const pool={query:jest.fn().mockResolvedValue({rows:profiles}),connect:jest.fn()};
 const verifyShopify=jest.fn(async rows=>({rows,verification:{shop:'www-omfuture.myshopify.com',orders:[{number:'#154230',currentQuantity:1,items:[{sku:'4711299272493',barcode:'4711299272493'}]}]}}));
 const resolveProducts=jest.fn(async skus=>({sync:{source_note:'ECOUNT reference'},products:Object.fromEntries(skus.map(sku=>[sku,{status:'matched',matches:[{erp_sku:sku,product_name:'ERP 商品',spec:'完整規格',barcode:'',active:true}]}]))}));
 return {pool,verifyShopify,resolveProducts,prepare:createMarketplacePreparation({pool,verifyShopify,resolveProducts,...extra})};
}
test('one confirmed profile and current API product data automatically replace empty first-upload defaults',async()=>{
 const h=harness();const result=await h.prepare({rows:table([order()]),settings:{store:'',customerCode:'',customerName:'',currency:'TWD',taxConfirmed:false,skuMappings:{},shippingSku:{erpSku:'00001',name:'運費',nonStock:false,confirmed:false}}});
 expect(result.output.ok).toBe(true);expect(result.settings.customerCode).toBe('00063');expect(result.settings.shippingSku.nonStock).toBe(true);expect(result.settings.taxConfirmed).toBe(true);expect(result.settings.discountAllocationConfirmed).toBe(true);
 expect(result.settings.skuMappings['4711299272493']).toMatchObject({erpSku:'4711299272493',erpName:'ERP 商品',barcode:'4711299272493',barcodeConfirmed:true,confirmed:true});
 expect(result.parsed.orders[0].shipping).toMatchObject({recipient:'收件人',address:'配送地址'});expect(result.sourceEvidence.rows).toEqual(result.source.rows);expect(result.verification.currentFingerprint).toMatch(/^[a-f0-9]{64}$/);expect(h.pool.connect).not.toHaveBeenCalled();
 expect(Number.isInteger(result.output.rows[0][23])).toBe(true);expect(Number.isInteger(result.output.rows[0][24])).toBe(true);expect(result.output.rows[0][23]+result.output.rows[0][24]).toBe(890);
});
test('multiple store profiles never guess by product name; explicit selection and explicit settings changes are respected',async()=>{
 const other={...profile,id:3,store:'其他商店',settings:{...profile.settings,store:'其他商店',customerCode:'00099'}};
 expect(selectProfile([profile,other],'Shopify',{})).toBe(null);
 const h=harness([profile,other]);const ambiguous=await h.prepare({rows:table([order()])});expect(ambiguous.output.ok).toBe(false);expect(ambiguous.profileId).toBe('');
 const chosen=await h.prepare({rows:table([order()]),profileId:'3'});expect(chosen.output.ok).toBe(true);expect(chosen.settings.customerCode).toBe('00099');
 const edited=await h.prepare({rows:table([order()]),profileId:'3',settings:{store:'其他商店',customerCode:'00100'}});expect(edited.settings.customerCode).toBe('00100');
 await expect(h.prepare({rows:table([order()]),profileId:'404'})).rejects.toMatchObject({code:'STORE_PROFILE_INVALID'});
});
test('API failure has no CSV fallback; preview cache is short lived and saving always refreshes',async()=>{
 const h=harness();const body={rows:table([order()])};await h.prepare(body);await h.prepare(body);expect(h.verifyShopify).toHaveBeenCalledTimes(1);
 await h.prepare(body,{refresh:true});expect(h.verifyShopify).toHaveBeenCalledTimes(2);
 h.verifyShopify.mockRejectedValueOnce(Object.assign(new Error('未使用舊資料'),{status:503,code:'SHOPIFY_UNAVAILABLE'}));await expect(h.prepare(body,{refresh:true})).rejects.toMatchObject({code:'SHOPIFY_UNAVAILABLE'});expect(h.pool.connect).not.toHaveBeenCalled();
});
test('removed historical items are not catalog-resolved; original source evidence is retained',async()=>{
 const source=table([order({'Lineitem sku':'4711299274749',Total:'1880',Subtotal:'1880'}),order({'Lineitem sku':'4711299272493',Total:'1880',Subtotal:'1880'})]);
 const h=harness();h.verifyShopify.mockResolvedValueOnce({rows:table([order()]),verification:{shop:'www-omfuture.myshopify.com',orders:[]}});
 const result=await h.prepare({rows:source});expect(h.resolveProducts).toHaveBeenCalledWith(['4711299272493']);expect(result.output.summary.physicalQuantity).toBe(1);expect(result.output.summary.ecountTotalMinor).toBe(89000);expect(JSON.stringify(result.sourceEvidence.rows)).toContain('4711299274749');
});
test('API barcode conflict with ERP or between current variants blocks output instead of inventing a barcode',async()=>{
 const h=harness();h.resolveProducts.mockResolvedValueOnce({products:{'4711299272493':{status:'matched',matches:[{erp_sku:'4711299272493',product_name:'ERP 商品',barcode:'OTHER'}]}}});
 await expect(h.prepare({rows:table([order()])})).rejects.toMatchObject({code:'BARCODE_MISMATCH'});
});
test('conflicting shipping details block the batch and repeated blank continuation values remain valid',async()=>{
 const h=harness();const body={rows:table([order(),order({'Lineitem id':'16493014253725',Subtotal:'1780',Total:'1780','Shipping Address1':'不同地址'})])};
 await expect(h.prepare(body)).rejects.toMatchObject({code:'DELIVERY_CONFLICT'});
});
test('malformed settings and oversized arrays cannot trigger an external lookup',async()=>{
 const h=harness();await expect(h.prepare({rows:table([order()]),settings:{taxConfirmed:'true'}})).rejects.toMatchObject({status:400});expect(h.verifyShopify).not.toHaveBeenCalled();
});
test('explicit clearing of a selected store customer cannot silently restore its profile value',async()=>{
 const h=harness();const result=await h.prepare({rows:table([order()]),profileId:'2',settings:{store:profile.store,customerCode:''}});
 expect(result.settings.customerCode).toBe('');expect(result.output.ok).toBe(false);
});
test('verified Shopify domain selects only its bound store and persists that binding',async()=>{
 const bound={...profile,settings:{...profile.settings,shopifyShop:'www-omfuture.myshopify.com'}};
 const other={...profile,id:3,store:'其他商店',settings:{...profile.settings,store:'其他商店',customerCode:'00099',shopifyShop:'other-shop.myshopify.com'}};
 const h=harness([bound,other]);const result=await h.prepare({rows:table([order()])});
 expect(result.settings.customerCode).toBe('00063');expect(result.settings.shopifyShop).toBe('www-omfuture.myshopify.com');
 await expect(h.prepare({rows:table([order()]),profileId:'3'})).rejects.toMatchObject({code:'STORE_PROFILE_INVALID'});
});
test('cancelled zero-current Shopify order remains visible as excluded audit without restoring CSV products',async()=>{
 const h=harness();const rows=table([order()]);h.verifyShopify.mockResolvedValueOnce({rows:[rows[0]],verification:{shop:'www-omfuture.myshopify.com',orders:[{number:'#154230',currentQuantity:0,cancelled:true,paymentStatus:'voided',fulfillmentStatus:'unfulfilled',subtotalMinor:0,totalMinor:0,shippingMinor:0,discountMinor:0,outstandingMinor:0,items:[]}]}});
 const r=await h.prepare({rows});expect(r.raw.orders[0]).toMatchObject({sourceOrderNumber:'#154230',cancelled:true,financial:{totalMinor:0}});
 expect(r.choices).toEqual([{number:'#154230',eligible:false,reason:'Shopify 已取消訂單'}]);expect(r.output.ok).toBe(false);expect(r.parsed.items).toEqual([]);expect(r.raw.items).toEqual([]);expect(h.resolveProducts).toHaveBeenCalledWith([]);
});
test('a cancelled empty order does not remove a different valid current shipment in the same CSV',async()=>{
 const h=harness();const active=table([order()]);const source=table([order(),order({Name:'#154195',Id:'7621155160220'})]);
 h.verifyShopify.mockResolvedValueOnce({rows:active,verification:{shop:'www-omfuture.myshopify.com',orders:[{number:'#154230',currentQuantity:1,items:[]},{number:'#154195',currentQuantity:0,cancelled:true,paymentStatus:'voided',fulfillmentStatus:'unfulfilled',subtotalMinor:0,totalMinor:0,shippingMinor:0,discountMinor:0,outstandingMinor:0,items:[]}]}});
 const r=await h.prepare({rows:source});expect(r.output.ok).toBe(true);expect(r.output.summary.physicalQuantity).toBe(1);expect(r.output.summary.ecountTotalMinor).toBe(89000);expect(r.parsed.orders.map(o=>o.sourceOrderNumber)).toEqual(['#154230']);expect(r.raw.orders.map(o=>o.sourceOrderNumber)).toEqual(['#154230','#154195']);expect(r.choices[1]).toMatchObject({eligible:false,number:'#154195',reason:'Shopify 已取消訂單'});
});
