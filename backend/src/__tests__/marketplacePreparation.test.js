const {createMarketplacePreparation,selectProfile}=require('../services/marketplacePreparation');
const {reviewEvidence}=require('../services/marketplaceBarcodeReviews');
const table=rows=>{const headers=[...new Set(rows.flatMap(Object.keys))];return [headers,...rows.map(r=>headers.map(h=>r[h]??''))];};
const order=extra=>({Name:'#154230',Id:'7624215101596','Financial Status':'pending','Fulfillment Status':'unfulfilled',Currency:'TWD',Subtotal:'890',Shipping:'0',Taxes:'0',Total:'890','Discount Amount':'0','Refunded Amount':'0','Outstanding Balance':'890','Payment Method':'custom','Lineitem quantity':'1','Lineitem name':'來源商品','Lineitem price':'890','Lineitem sku':'4711299272493','Lineitem discount':'0','Lineitem id':'16493014253724','Shipping Name':'收件人','Shipping Address1':'配送地址',...extra});
const profile={id:2,platform:'Shopify',store:'墨子科技 官網',settings:{store:'墨子科技 官網',customerCode:'00063',customerName:'墨子科技 官網',warehouseCode:'003',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,shippingSku:{erpSku:'00001',name:'運費',nonStock:true,confirmed:true}}};
function harness(profiles=[profile],extra={}){
 const pool={query:jest.fn(async sql=>({rows:sql.includes('marketplace_product_mapping_reviews')?[]:profiles})),connect:jest.fn()};
 const verifyShopify=jest.fn(async rows=>({rows,verification:{shop:'www-omfuture.myshopify.com',orders:[{number:'#154230',currentQuantity:1,items:[{id:'16493014253724',sku:'4711299272493',barcode:'4711299272493',variantId:'gid://shopify/ProductVariant/123'}]}]}}));
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
function barcodeHarness(){
 const h=harness();
 h.identity={shop:'www-omfuture.myshopify.com',barcode:'NEW4711299272493',variantId:'gid://shopify/ProductVariant/123'};
 h.product={erp_sku:'4711299272493',product_name:'ERP 商品',spec:'完整規格',barcode:'4711299272493',active:true};
 h.profiles=[profile];h.reviews=[];
 h.pool.query.mockImplementation(async(sql,params)=>({rows:sql.includes('marketplace_product_mapping_reviews')?h.reviews.filter(r=>r.store_profile_id===params[0]&&params[1].includes(r.fingerprint)):h.profiles}));
 h.verifyShopify.mockImplementation(async rows=>{
  const records=rows.slice(1).map(r=>Object.fromEntries(rows[0].map((header,i)=>[header,r[i]])));
  const orders=[...new Set(records.map(r=>r.Name))].map(number=>({number,currentQuantity:records.filter(r=>r.Name===number).reduce((n,r)=>n+Number(r['Lineitem quantity']),0),items:records.filter(r=>r.Name===number).map(r=>({id:r['Lineitem id'],sku:r['Lineitem sku'],barcode:h.identity.barcode,...(h.identity.variantId?{variantId:h.identity.variantId}:{})}))}));
  return {rows,verification:{shop:h.identity.shop,orders}};
 });
 h.resolveProducts.mockImplementation(async skus=>({products:Object.fromEntries(skus.map(sku=>[sku,{status:'matched',matches:[h.product]}]))}));
 h.saveReview=c=>{const record={id:17,store_profile_id:c.storeProfileId,fingerprint:c.fingerprint,evidence:reviewEvidence(c)};h.reviews.push(record);return record;};
 return h;
}
test('API barcode conflict leaves a reviewable preview but blocks sales and prepick instead of inventing a barcode',async()=>{
 const h=barcodeHarness(),r=await h.prepare({rows:table([order()])});
 expect(r.output).toMatchObject({ok:false,rows:[]});expect(r.prepick).toMatchObject({ok:false,rows:[]});
 expect(r.output.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'BARCODE_MISMATCH',sku:'4711299272493'})]));
 expect(r.parsed.summary.totalQuantity).toBe(1);
 expect(r.barcodeConflicts).toHaveLength(1);
 expect(r.barcodeConflicts[0]).toMatchObject({storeProfileId:2,platform:'Shopify',shop:'www-omfuture.myshopify.com',sourceSku:'4711299272493',sourceBarcode:'NEW4711299272493',sourceName:'來源商品',variantId:'gid://shopify/ProductVariant/123',variantIds:['gid://shopify/ProductVariant/123'],erpSku:'4711299272493',erpBarcode:'4711299272493',erpName:'ERP 商品',spec:'完整規格',canConfirm:true});
 expect(r.barcodeConflicts[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
 expect(r.settings.skuMappings['4711299272493']).toMatchObject({erpSku:'4711299272493',barcode:'4711299272493',barcodeConfirmed:false});
 expect(h.pool.connect).not.toHaveBeenCalled();
});
test('an exact saved review is reused across orders while preserving NEW source barcode and physical ERP barcode',async()=>{
 const h=barcodeHarness(),first=await h.prepare({rows:table([order()])});
 const record=h.saveReview(first.barcodeConflicts[0]);
 const second=await h.prepare({rows:table([order({Name:'#NEXT',Id:'7624215101597','Lineitem id':'16493014253725'})])},{refresh:true});
 expect(second.output.ok).toBe(true);expect(second.prepick.ok).toBe(true);expect(second.barcodeConflicts).toEqual([]);
 expect(second.barcodeReviews).toEqual([{id:record.id,fingerprint:record.fingerprint,evidence:record.evidence}]);
 expect(second.settings.skuMappings['4711299272493']).toMatchObject({erpSku:'4711299272493',barcode:'4711299272493',barcodeConfirmed:true});
 expect(second.sourceEvidence.verification.orders[0].items[0].barcode).toBe('NEW4711299272493');
 expect(second.parsed.orders[0].sourceOrderNumber).toBe('#NEXT');
 expect(h.pool.connect).not.toHaveBeenCalled();
});
test('client mapping and a supplied review cannot bypass an unconfirmed barcode conflict',async()=>{
 const h=barcodeHarness(),first=await h.prepare({rows:table([order()])});
 const r=await h.prepare({rows:table([order()]),barcodeReviews:[{id:17,fingerprint:first.barcodeConflicts[0].fingerprint,evidence:reviewEvidence(first.barcodeConflicts[0])}],settings:{skuMappings:{'4711299272493':{erpSku:'NEW4711299272493',erpName:'任意品名',barcode:'NEW4711299272493',confirmed:true,barcodeConfirmed:true}}}},{refresh:true});
 expect(r.output.ok).toBe(false);expect(r.prepick.ok).toBe(false);expect(r.barcodeReviews).toEqual([]);expect(r.barcodeConflicts).toHaveLength(1);
 expect(r.settings.skuMappings['4711299272493']).toMatchObject({erpSku:'4711299272493',erpName:'ERP 商品',barcode:'4711299272493',barcodeConfirmed:false});
});
test.each([
 ['store profile',h=>{h.profiles=[{...profile,id:3}];}],
 ['Shopify domain',h=>{h.identity.shop='other-shop.myshopify.com';}],
 ['current variant',h=>{h.identity.variantId='gid://shopify/ProductVariant/124';}],
 ['API barcode',h=>{h.identity.barcode='NEW47112992724932';}],
 ['ERP code',h=>{h.product.erp_sku='NEW4711299272493';}],
 ['ERP barcode',h=>{h.product.barcode='47112992724932';}],
 ['ERP name',h=>{h.product.product_name='另一版本 ERP 商品';}],
 ['ERP specification',h=>{h.product.spec='另一型號規格';}],
])('a saved review is not reused after the %s changes',async(label,change)=>{
 const h=barcodeHarness(),first=await h.prepare({rows:table([order()])});h.saveReview(first.barcodeConflicts[0]);change(h);
 const next=await h.prepare({rows:table([order()])},{refresh:true});
 expect(next.output.ok).toBe(false);expect(next.prepick.ok).toBe(false);expect(next.barcodeReviews).toEqual([]);expect(next.barcodeConflicts).toHaveLength(1);
 expect(next.barcodeConflicts[0].fingerprint).not.toBe(first.barcodeConflicts[0].fingerprint);
});
test('two eligible versions with the same barcode and blank ERP barcode require explicit approval, then retain quantities and money',async()=>{
 const h=barcodeHarness();
 h.identity.barcode='4711299272493';h.product.barcode='';
 const rows=table([order({Subtotal:'1780',Total:'1780','Outstanding Balance':'1780','Lineitem name':'完整商品頁面一 iPhone 18 Pro'}),order({Subtotal:'1780',Total:'1780','Outstanding Balance':'1780','Lineitem id':'16493014253725','Lineitem name':'完整商品頁面二 iPhone 18 Pro'})]);
 h.verifyShopify.mockResolvedValue({rows,verification:{shop:h.identity.shop,orders:[{number:'#154230',id:'7624215101596',currentQuantity:2,items:[{id:'16493014253724',sku:'4711299272493',barcode:h.identity.barcode,variantId:'gid://shopify/ProductVariant/123'},{id:'16493014253725',sku:'4711299272493',barcode:h.identity.barcode,variantId:'gid://shopify/ProductVariant/124'}]}]}});
 const r=await h.prepare({rows});expect(r.output.ok).toBe(false);expect(r.prepick.ok).toBe(false);expect(r.barcodeConflicts).toHaveLength(1);
 expect(r.barcodeConflicts[0]).toMatchObject({variantId:'',variantIds:['gid://shopify/ProductVariant/123','gid://shopify/ProductVariant/124'],erpBarcode:'',canConfirm:true,reviewReason:'ERP_BARCODE_MISSING',relatedOrders:[
  {orderNumber:'#154230',orderId:'7624215101596',sourceLineId:'16493014253724',variantId:'gid://shopify/ProductVariant/123',productName:'完整商品頁面一 iPhone 18 Pro',quantity:1},
  {orderNumber:'#154230',orderId:'7624215101596',sourceLineId:'16493014253725',variantId:'gid://shopify/ProductVariant/124',productName:'完整商品頁面二 iPhone 18 Pro',quantity:1},
 ]});
 h.saveReview(r.barcodeConflicts[0]);
 const confirmed=await h.prepare({rows},{refresh:true});
 expect(confirmed.output.ok).toBe(true);expect(confirmed.prepick.ok).toBe(true);expect(confirmed.barcodeConflicts).toEqual([]);
 expect(confirmed.parsed.summary.totalQuantity).toBe(2);expect(confirmed.output.summary.ecountTotalMinor).toBe(178000);
 expect(confirmed.settings.skuMappings['4711299272493']).toMatchObject({erpSku:'4711299272493',barcode:'4711299272493',barcodeConfirmed:true});
 expect(confirmed.barcodeReviews[0].evidence.erpBarcode).toBe('');expect(h.pool.connect).not.toHaveBeenCalled();
});
test('same-SKU current versions with different actual barcodes cannot be grouped or physically approved',async()=>{
 const h=barcodeHarness(),rows=table([order({Subtotal:'1780',Total:'1780','Outstanding Balance':'1780'}),order({Subtotal:'1780',Total:'1780','Outstanding Balance':'1780','Lineitem id':'16493014253725'})]);
 h.verifyShopify.mockResolvedValue({rows,verification:{shop:h.identity.shop,orders:[{number:'#154230',items:[
  {id:'16493014253724',sku:'4711299272493',barcode:'4711299272493',variantId:'gid://shopify/ProductVariant/123'},
  {id:'16493014253725',sku:'4711299272493',barcode:'NEW4711299272493',variantId:'gid://shopify/ProductVariant/124'},
 ]}]}});
 await expect(h.prepare({rows})).rejects.toMatchObject({code:'BARCODE_AMBIGUOUS'});expect(h.reviews).toEqual([]);
});
test('missing current Shopify variant ID cannot produce a confirmable barcode conflict',async()=>{
 const h=barcodeHarness();h.identity.variantId='';const r=await h.prepare({rows:table([order()])});
 expect(r.output.ok).toBe(false);expect(r.prepick.ok).toBe(false);expect(r.barcodeConflicts[0]).toMatchObject({variantId:'',variantIds:[],canConfirm:false,sourceBarcode:'NEW4711299272493'});
});
test('one known variant cannot cover another eligible same-SKU line whose variant ID is missing',async()=>{
 const h=barcodeHarness(),rows=table([order({Subtotal:'1780',Total:'1780','Outstanding Balance':'1780'}),order({Subtotal:'1780',Total:'1780','Outstanding Balance':'1780','Lineitem id':'16493014253725'})]);
 h.verifyShopify.mockResolvedValueOnce({rows,verification:{shop:h.identity.shop,orders:[{number:'#154230',currentQuantity:2,items:[{id:'16493014253724',sku:'4711299272493',barcode:h.identity.barcode,variantId:'gid://shopify/ProductVariant/123'},{id:'16493014253725',sku:'4711299272493',barcode:h.identity.barcode}]}]}});
 const r=await h.prepare({rows});expect(r.output.ok).toBe(false);expect(r.prepick.ok).toBe(false);expect(r.barcodeConflicts).toHaveLength(1);expect(r.barcodeConflicts[0].canConfirm).toBe(false);
});
test('a saved review cannot cover another eligible same-SKU line whose API barcode is missing',async()=>{
 const h=barcodeHarness(),first=await h.prepare({rows:table([order()])});h.saveReview(first.barcodeConflicts[0]);
 const rows=table([order({Subtotal:'1780',Total:'1780','Outstanding Balance':'1780'}),order({Subtotal:'1780',Total:'1780','Outstanding Balance':'1780','Lineitem id':'16493014253725'})]);
 h.verifyShopify.mockResolvedValueOnce({rows,verification:{shop:h.identity.shop,orders:[{number:'#154230',currentQuantity:2,items:[{id:'16493014253724',sku:'4711299272493',barcode:h.identity.barcode,variantId:h.identity.variantId},{id:'16493014253725',sku:'4711299272493',variantId:h.identity.variantId}]}]}});
 const r=await h.prepare({rows},{refresh:true});expect(r.output.ok).toBe(false);expect(r.prepick.ok).toBe(false);expect(r.barcodeReviews).toEqual([]);expect(r.barcodeConflicts).toHaveLength(1);
 expect(r.barcodeConflicts[0]).toMatchObject({sourceBarcode:'NEW4711299272493',variantId:'gid://shopify/ProductVariant/123',variantIds:['gid://shopify/ProductVariant/123'],canConfirm:false});
});
test('an excluded fulfilled order cannot add a different barcode or variant to the eligible same-SKU shipment',async()=>{
 const h=barcodeHarness(),rows=table([order(),order({Name:'#FULFILLED',Id:'7624215101597','Lineitem id':'16493014253725','Fulfillment Status':'fulfilled'})]);
 h.product.barcode='4711299272493';
 h.verifyShopify.mockResolvedValueOnce({rows,verification:{shop:h.identity.shop,orders:[{number:'#154230',currentQuantity:1,items:[{id:'16493014253724',sku:'4711299272493',barcode:'4711299272493',variantId:'gid://shopify/ProductVariant/123'}]},{number:'#FULFILLED',currentQuantity:1,items:[{id:'16493014253725',sku:'4711299272493',barcode:'NEW4711299272493',variantId:'gid://shopify/ProductVariant/124'}]}]}});
 const r=await h.prepare({rows});expect(r.output.ok).toBe(true);expect(r.prepick.ok).toBe(true);expect(r.barcodeConflicts).toEqual([]);expect(r.parsed.summary.totalQuantity).toBe(1);expect(r.choices).toEqual(expect.arrayContaining([expect.objectContaining({number:'#FULFILLED',eligible:false})]));
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
test('SHOPLINE store binding is trusted, cached by connection, and refreshed before saving',async()=>{
 const sl={...profile,id:20,platform:'SHOPLINE',store:'bonson(SHOPLINE)',settings:{...profile.settings,store:'bonson(SHOPLINE)',customerCode:'00020',apiConnectionId:'bonson-read'}};
 const rows=table([{'訂單編號':'SL-LOCAL','商品貨號':'4711299272493','商品名稱':'商品','數量':'1','單價':'100','付款狀態':'已付款','送貨狀態':'備貨中','付款方式':'信用卡','訂單狀態':'已確認','訂單小計':'100','運費':'0','優惠折扣':'0','訂單合計':'100'}]);
 const verifyShopline=jest.fn(async r=>({rows:r,verification:{platform:'SHOPLINE',shop:'merchant',fingerprint:'current-api-hash',orders:[]}}));
 const h=harness([sl],{verifyShopline});
 const input={rows,settings:{apiConnectionId:''}};
 const first=await h.prepare(input);expect(first.verification).toMatchObject({mode:'api',platform:'SHOPLINE'});expect(first.settings.apiConnectionId).toBe('bonson-read');expect(first.output.ok).toBe(true);
 expect(verifyShopline).toHaveBeenCalledWith(expect.any(Array),{apiConnectionId:'bonson-read'});
 await h.prepare(input);expect(verifyShopline).toHaveBeenCalledTimes(1);
 const refreshed=await h.prepare(input,{refresh:true});expect(verifyShopline).toHaveBeenCalledTimes(2);expect(refreshed.verification.currentFingerprint).toBe(first.verification.currentFingerprint);
 verifyShopline.mockResolvedValueOnce({rows,verification:{platform:'SHOPLINE',shop:'merchant',fingerprint:'new-shipping-hash',orders:[]}});
 expect((await h.prepare(input,{refresh:true})).verification.currentFingerprint).not.toBe(first.verification.currentFingerprint);
 await expect(h.prepare({rows,settings:{store:'未知店鋪',apiConnectionId:''}})).rejects.toMatchObject({code:'STORE_PROFILE_INVALID'});
 expect(verifyShopline).toHaveBeenCalledTimes(3);
 verifyShopline.mockRejectedValueOnce(Object.assign(new Error('IP 未允許'),{status:503,code:'SHOPLINE_IP_NOT_ALLOWED'}));
 await expect(h.prepare(input,{refresh:true})).rejects.toMatchObject({code:'SHOPLINE_IP_NOT_ALLOWED'});
 expect(h.pool.connect).not.toHaveBeenCalled();
});
test('unbound SHOPLINE store remains explicitly file mode without pretending API verification',async()=>{
 const rows=table([{'訂單編號':'SL-FILE','商品貨號':'4711299272493','商品名稱':'商品','數量':'1','單價':'100','付款狀態':'已付款','送貨狀態':'備貨中','付款方式':'信用卡','訂單狀態':'已確認','訂單小計':'100','運費':'0','優惠折扣':'0','訂單合計':'100'}]);
 const sl={...profile,platform:'SHOPLINE'};
 const h=harness([sl]);const result=await h.prepare({rows});
 expect(result.verification).toBeNull();expect(result.output.ok).toBe(true);expect(h.verifyShopify).not.toHaveBeenCalled();
});
