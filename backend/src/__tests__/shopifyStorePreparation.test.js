const express=require('express'),request=require('supertest');
const {createShopifyOrderVerifier}=require('../services/shopifyOrderVerification');
const {createMarketplacePreparation}=require('../services/marketplacePreparation');
const {createMarketplaceRouter}=require('../routes/marketplaceRoutes');
const {reviewEvidence}=require('../services/marketplaceBarcodeReviews');
const sku='4711299272493',bag=value=>({shopMoney:{amount:String(value),currencyCode:'TWD'}});
const table=records=>{const headers=[...new Set(records.flatMap(Object.keys))];return [headers,...records.map(record=>headers.map(h=>record[h]??''))];};
const record=(name='FU1053',id='101')=>({Name:name,Id:id,'Financial Status':'pending','Fulfillment Status':'unfulfilled',Currency:'TWD',Subtotal:'100',Shipping:'0',Taxes:'0',Total:'100','Discount Amount':'0','Refunded Amount':'0','Outstanding Balance':'100','Payment Method':'custom','Lineitem quantity':'1','Lineitem name':'匿名商品','Lineitem price':'100','Lineitem sku':sku,'Lineitem discount':'0','Shipping Name':'匿名收件人','Shipping Address1':'匿名地址'});
const profile=(id,connection,shop)=>({id,platform:'Shopify',store:`匿名店${id}`,updated_at:'2026-11-03T00:00:00Z',settings:{apiConnectionId:connection,shopifyShop:shop,store:`匿名店${id}`,customerCode:`0000${id}`,warehouseCode:'003',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,shippingSku:{erpSku:'00001',name:'運費',nonStock:true,confirmed:true}}});
function current(id,barcode,shipping=0){
 return {id:`gid://shopify/Order/${id}`,name:id==='101'?'FU1053':'FU1054',updatedAt:'2026-11-03T00:00:00Z',createdAt:'2026-11-02T00:00:00Z',edited:false,cancelledAt:null,currencyCode:'TWD',presentmentCurrencyCode:'TWD',taxesIncluded:false,displayFinancialStatus:'PENDING',displayFulfillmentStatus:'UNFULFILLED',paymentGatewayNames:['manual'],discountCodes:[],currentSubtotalLineItemsQuantity:1,currentSubtotalPriceSet:bag(100),currentShippingPriceSet:bag(0),currentTotalDiscountsSet:bag(0),currentTotalTaxSet:bag(0),currentTotalPriceSet:bag(100),totalOutstandingSet:bag(100),totalReceivedSet:bag(0),totalRefundedSet:bag(0),currentTotalAdditionalFeesSet:null,currentTotalDutiesSet:null,totalTipReceivedSet:bag(0),shippingAddress:null,shippingLines:{nodes:[],pageInfo:{hasNextPage:false}},lineItems:{nodes:[{id:`gid://shopify/LineItem/${id}`,name:'匿名商品',sku,quantity:1,currentQuantity:1,unfulfilledQuantity:1,requiresShipping:true,taxable:true,originalUnitPriceSet:bag(100),priceAfterAllDiscountsBeforeTaxesSet:bag(100),variant:{id:'gid://shopify/ProductVariant/123',barcode}}],pageInfo:{hasNextPage:false}}};
}
function harness({profiles,known,barcode=sku,env={},connections,shipping=0}={}){
 const state={profiles:profiles||[profile(1,'first','first.myshopify.com'),profile(2,'second','second.myshopify.com')],reviews:[],known:known||{'first.myshopify.com':[],'second.myshopify.com':['101','102']},barcode,shipping};
 const fetchImpl=jest.fn(async(url,options)=>{
  const shop=new URL(url).hostname,body=JSON.parse(options.body);let data={shop:{myshopifyDomain:shop}};
  if(body.variables.ids)data.nodes=body.variables.ids.map(id=>state.known[shop]?.includes(id.split('/').pop())?{id,name:id.endsWith('/101')?'FU1053':'FU1054'}:null);
  else {const id=body.variables.id.split('/').pop();data.order=state.known[shop]?.includes(id)?current(id,state.barcode,state.shipping):null;
   if(data.order&&state.shipping){data.order.currentShippingPriceSet=bag(state.shipping);data.order.currentTotalPriceSet=bag(100+state.shipping);data.order.totalOutstandingSet=bag(100+state.shipping);data.order.shippingLines.nodes=[{id:'gid://shopify/ShippingLine/1',title:'配送',isRemoved:false,originalPriceSet:bag(state.shipping),currentDiscountedPriceSet:bag(state.shipping)}];}}
  return {ok:true,text:async()=>JSON.stringify({data})};
 });
 const verifier=createShopifyOrderVerifier({env,connections:connections||[{id:'first',shop:'first.myshopify.com',token:'SECRET-ONE'},{id:'second',shop:'second.myshopify.com',token:'SECRET-TWO'}],fetchImpl});
 const pool={connect:jest.fn(),query:jest.fn(async(sql,params)=>({rows:sql.includes('marketplace_store_profiles')?state.profiles:sql.includes('marketplace_product_mapping_reviews')?state.reviews.filter(review=>review.store_profile_id===params[0]&&params[1].includes(review.fingerprint)):[]}))};
 const resolveProducts=jest.fn(async skus=>({products:Object.fromEntries(skus.map(s=>[s,{status:'matched',matches:[{erp_sku:sku,product_name:'ERP商品',spec:'匿名規格',barcode:sku,active:true}]}]))}));
 const prepare=createMarketplacePreparation({pool,verifyShopify:verifier,resolveProducts,classifyReimports:async()=>({reimports:[],fingerprint:'anonymous-source'})});
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:7,role:'dispatcher'};next();});app.use('/api/marketplace-intakes',createMarketplaceRouter({pool,prepareMarketplace:prepare}));
 return {state,fetchImpl,verifier,pool,prepare,app,resolveProducts};
}
test('production decorated factory routes anonymous FU file to the full matching profile before detailed reads',async()=>{
 const h=harness(),rows=table([record(),record('FU1054','102')]);
 const result=await h.prepare({rows,settings:{apiConnectionId:'first',shopifyShop:'first.myshopify.com',skuMappings:{}}});
 expect(result.profileId).toBe('2');expect(result.settings).toMatchObject({store:'匿名店2',customerCode:'00002',apiConnectionId:'second',shopifyShop:'second.myshopify.com'});expect(result.output.ok).toBe(true);
 expect(result.verification).toMatchObject({apiConnectionId:'second',shop:'second.myshopify.com'});
 const full=h.fetchImpl.mock.calls.filter(([,options])=>JSON.parse(options.body).variables.id);expect(full).toHaveLength(2);expect(full.every(([url])=>url.includes('second.myshopify.com'))).toBe(true);
 expect(h.pool.connect).not.toHaveBeenCalled();expect(JSON.stringify(result)).not.toContain('SECRET');
});
test.each([undefined,'2'])('persisted Shopify authority cannot become stale uploaded store A after resolving B (selection %s)',async profileId=>{
 const h=harness(),result=await h.prepare({rows:table([record()]),...(profileId?{profileId}:{}),settings:{store:'匿名店1',customerCode:'00001',customerName:'舊店客戶',warehouseCode:'WRONG',currency:'USD',taxType:'WRONG',apiConnectionId:'first',shopifyShop:'first.myshopify.com',skuMappings:{}}});
 expect(result.profileId).toBe('2');expect(result.settings).toMatchObject({store:'匿名店2',customerCode:'00002',warehouseCode:'003',currency:'TWD',taxType:'11',apiConnectionId:'second',shopifyShop:'second.myshopify.com'});expect(result.settings.customerName).not.toBe('舊店客戶');expect(result.output.ok).toBe(true);
});
test('an unmatched built-in verifier produces selection 409 and every command remains write-free',async()=>{
 const h=harness({known:{'first.myshopify.com':[],'second.myshopify.com':[]}}),body={rows:table([record()])};
 const response=await request(h.app).post('/api/marketplace-intakes/preview').send(body);
 expect(response.status).toBe(409);expect(response.body).toMatchObject({code:'MARKETPLACE_STORE_SELECTION_REQUIRED',storeSelection:{platform:'Shopify',reason:'not_found',choices:[{id:'1',connectionReady:true},{id:'2',connectionReady:true}]}});
 expect(response.headers['cache-control']).toBe('private, no-store');expect(JSON.stringify(response.body)).not.toMatch(/SECRET|tokenEnv|anonymous-source/);
 const command=await request(h.app).post('/api/marketplace-intakes').send(body);expect(command.status).toBe(409);expect(command.body.code).toBe('MARKETPLACE_STORE_SELECTION_REQUIRED');
 expect(h.pool.connect).not.toHaveBeenCalled();expect(h.resolveProducts).not.toHaveBeenCalled();
});
test('saved barcode proof cannot cross shops even for the same SKU, variant ID, and profile ID',async()=>{
 const h=harness({profiles:[profile(2,'second','second.myshopify.com')],barcode:'DIFFERENT-BARCODE'}),body={rows:table([record()]),profileId:'2'};
 const first=await h.prepare(body),candidate=first.barcodeConflicts[0];
 expect(candidate.canConfirm).toBe(true);h.state.reviews.push({id:11,store_profile_id:2,fingerprint:candidate.fingerprint,evidence:reviewEvidence(candidate)});
 expect((await h.prepare(body)).barcodeConflicts).toHaveLength(0);
 h.state.profiles=[profile(2,'first','first.myshopify.com')];h.state.known['first.myshopify.com']=['101'];
 const switched=await h.prepare(body);
 expect(switched.barcodeReviews).toEqual([]);expect(switched.barcodeConflicts).toHaveLength(1);expect(switched.barcodeConflicts[0].fingerprint).not.toBe(candidate.fingerprint);expect(switched.verification.currentFingerprint).not.toBe(first.verification.currentFingerprint);
});
test('full verifier cache separates ERP profiles and persisted profile updates; refresh rereads probe and details',async()=>{
 const h=harness({profiles:[profile(2,'second','second.myshopify.com'),profile(3,'second','second.myshopify.com')]}),body={rows:table([record()]),profileId:'2'};
 const first=await h.prepare(body);await h.prepare(body);expect(h.fetchImpl).toHaveBeenCalledTimes(2);
 const other=await h.prepare({...body,profileId:'3'});expect(other.settings.customerCode).toBe('00003');expect(other.verification.currentFingerprint).not.toBe(first.verification.currentFingerprint);expect(h.fetchImpl).toHaveBeenCalledTimes(3);
 h.state.profiles[0]={...h.state.profiles[0],updated_at:'2026-11-03T01:00:00Z'};const updated=await h.prepare(body);expect(h.fetchImpl).toHaveBeenCalledTimes(4);expect(updated.verification.currentFingerprint).not.toBe(first.verification.currentFingerprint);
 await h.prepare(body,{refresh:true});expect(h.fetchImpl).toHaveBeenCalledTimes(6);
});
test('changing the full source file cannot reuse a successful one-order probe',async()=>{
 const h=harness({known:{'first.myshopify.com':[],'second.myshopify.com':['101']}});
 await h.prepare({rows:table([record()])});
 await expect(h.prepare({rows:table([record(),record('FU1054','102')])})).rejects.toMatchObject({storeSelection:{reason:'not_found'}});
 expect(h.pool.connect).not.toHaveBeenCalled();
});
test('legacy singleton domain/profile binding remains compatible while canonicalizing forged routing settings',async()=>{
 const h=harness({profiles:[{...profile(1,'first','first.myshopify.com'),settings:{...profile(1,'first','first.myshopify.com').settings,apiConnectionId:undefined,shopifyShop:undefined}}],known:{'first.myshopify.com':['101']},connections:[],env:{WMS_SHOPIFY_SHOP:'first.myshopify.com',WMS_SHOPIFY_ACCESS_TOKEN:'SECRET-LEGACY'}});
 const result=await h.prepare({rows:table([record()]),settings:{apiConnectionId:'second',shopifyShop:'second.myshopify.com',skuMappings:{}}});
 expect(result.settings).toMatchObject({apiConnectionId:'legacy',shopifyShop:'first.myshopify.com'});expect(result.output.ok).toBe(true);
});
test('same server-preview store context preserves batch shipping confirmation and valid ERP edits',async()=>{
 const p=profile(2,'second','second.myshopify.com');delete p.settings.shippingSku;
 const h=harness({profiles:[p],shipping:50}),rows=table([{...record(),Shipping:'50',Total:'150','Outstanding Balance':'150'}]);
 const first=await h.prepare({rows,profileId:'2',settings:{skuMappings:{}}});expect(first.output.ok).toBe(false);expect(first.output.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'SHIPPING_MAPPING_REQUIRED'})]));
 const settings={...first.settings,warehouseCode:'004',customerCode:'BATCH-CUSTOMER',customerName:'本批客戶',erpStaffCode:'STAFF-NEW',erpProjectCode:'PROJECT-NEW',erpResponsibilityConfirmed:true,shippingSku:{erpSku:'00001',name:'Shipping',confirmed:true,nonStock:true}};
 const next=await h.prepare({rows,profileId:first.profileId,settings});
 expect(next.settings).toMatchObject({store:p.store,apiConnectionId:'second',shopifyShop:'second.myshopify.com',warehouseCode:'004',customerCode:'BATCH-CUSTOMER',customerName:'本批客戶',erpStaffCode:'STAFF-NEW',erpProjectCode:'PROJECT-NEW',erpResponsibilityConfirmed:true,shippingSku:settings.shippingSku});expect(next.output.ok).toBe(true);
 const unconfirmed=await h.prepare({rows,profileId:first.profileId,settings:{...settings,shippingSku:{...settings.shippingSku,confirmed:false}}});expect(unconfirmed.output.ok).toBe(false);expect(unconfirmed.output.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'SHIPPING_MAPPING_REQUIRED'})]));
});
test('foreign preview metadata cannot lend ERP overrides or shipping confirmation to the selected store',async()=>{
 const p=profile(2,'second','second.myshopify.com');delete p.settings.shippingSku;
 const h=harness({profiles:[p],shipping:50}),rows=table([{...record(),Shipping:'50',Total:'150','Outstanding Balance':'150'}]);
 const result=await h.prepare({rows,profileId:'2',settings:{apiConnectionId:'first',shopifyShop:'first.myshopify.com',store:'匿名店1',warehouseCode:'A-WAREHOUSE',customerCode:'A-CUSTOMER',shippingSku:{erpSku:'A-SHIPPING',name:'Wrong',confirmed:true,nonStock:true},skuMappings:{}}});
 expect(result.settings).toMatchObject({store:p.store,warehouseCode:'003',customerCode:'00002',apiConnectionId:'second',shopifyShop:'second.myshopify.com'});expect(result.output.ok).toBe(false);expect(result.output.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'SHIPPING_MAPPING_REQUIRED'})]));
});
test('switching ERP profiles on the same Shopify connection does not inherit the old store settings',async()=>{
 const h=harness({profiles:[profile(2,'second','second.myshopify.com'),profile(3,'second','second.myshopify.com')]}),rows=table([record()]);
 const first=await h.prepare({rows,profileId:'2'}),next=await h.prepare({rows,profileId:'3',settings:first.settings});
 expect(next.settings).toMatchObject({store:'匿名店3',customerCode:'00003',apiConnectionId:'second',shopifyShop:'second.myshopify.com'});expect(next.output.ok).toBe(true);
});
test('legacy same-shop batch edits remain compatible with the old preview shape without connection ID',async()=>{
 const p=profile(1,'first','first.myshopify.com');delete p.settings.apiConnectionId;
 const h=harness({profiles:[p],known:{'first.myshopify.com':['101']},connections:[],env:{WMS_SHOPIFY_SHOP:'first.myshopify.com',WMS_SHOPIFY_ACCESS_TOKEN:'SECRET-LEGACY'}}),rows=table([record()]);
 const first=await h.prepare({rows,profileId:'1'}),settings={...first.settings,warehouseCode:'004'};delete settings.apiConnectionId;
 const next=await h.prepare({rows,profileId:'1',settings});expect(next.settings.warehouseCode).toBe('004');expect(next.settings.apiConnectionId).toBe('legacy');expect(next.output.ok).toBe(true);
});
