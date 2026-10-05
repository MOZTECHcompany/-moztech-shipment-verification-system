const express=require('express'),request=require('supertest');
const {createMarketplacePreparation}=require('../services/marketplacePreparation');
const {resolveProducts,verifyCatalogMappings}=require('../services/marketplaceProductCatalog');
const {confirmBarcodeReview,reviewEvidence,verifySavedBarcodeReviews}=require('../services/marketplaceBarcodeReviews');
const {createMarketplaceRouter}=require('../routes/marketplaceRoutes');
const sku='4711299270086',newSku='NEW'+sku,variant='gid://shopify/ProductVariant/10001';
const table=rows=>{const headers=[...new Set(rows.flatMap(Object.keys))];return [headers,...rows.map(row=>headers.map(header=>row[header]??''))];};
const order=extra=>({Name:'#154230',Id:'7624215101596','Financial Status':'pending','Fulfillment Status':'unfulfilled',Currency:'TWD',Subtotal:'1380',Shipping:'0',Taxes:'0',Total:'1380','Discount Amount':'0','Refunded Amount':'0','Outstanding Balance':'1380','Payment Method':'custom','Lineitem quantity':'2','Lineitem name':'晶霧貼 無貼膜神器','Lineitem price':'690','Lineitem sku':sku,'Lineitem discount':'0','Lineitem id':'16493014253724',...extra});
const profile={id:2,platform:'Shopify',store:'墨子科技 官網',settings:{store:'墨子科技 官網',customerCode:'00063',customerName:'墨子科技 官網',warehouseCode:'003',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,shippingSku:{erpSku:'00001',name:'運費',nonStock:true,confirmed:true}}};
function harness(){
 const h={reviews:[],products:[{erp_sku:sku,barcode:sku,product_name:'晶霧貼 底板',spec:'iPhone X/Xs/11Pro',active:true},{erp_sku:newSku,barcode:'',product_name:'晶霧貼 無貼膜神器',spec:'iPhone X/Xs/11Pro',active:true},{erp_sku:'UNRELATED',barcode:'OTHER',product_name:'其他商品',spec:'',active:true}]};
 h.pool={connect:jest.fn(),query:jest.fn(async(sql,params)=>{
  if(sql.includes('INSERT INTO marketplace_product_mapping_reviews')){
   const existing=h.reviews.find(row=>row.fingerprint===params[1]);if(existing)return {rows:[]};
   // PostgreSQL jsonb returns object keys in a different order from input JSON.
   const evidence=JSON.parse(params[2]),record={id:h.reviews.length+1,store_profile_id:params[0],fingerprint:params[1],evidence:Object.fromEntries(Object.entries(evidence).reverse()),confirmed_by:params[3]};
   h.reviews.push(record);return {rows:[record]};
  }
  if(sql.includes('marketplace_product_mapping_reviews'))return {rows:sql.includes('store_profile_id=$1')?h.reviews.filter(row=>row.store_profile_id===params[0]&&params[1].includes(row.fingerprint)&&!row.revoked_at):h.reviews.filter(row=>params[0].includes(row.id)&&!row.revoked_at)};
  return {rows:[profile]};
 })};
 h.verify=jest.fn(async rows=>({rows,verification:{shop:'moztech.myshopify.com',orders:[{number:'#154230',id:'7624215101596',currentQuantity:2,items:[{id:'16493014253724',sku,barcode:newSku,variantId:variant}]}]}}));
 h.resolve=jest.fn(async keys=>({products:resolveProducts(keys,h.products)}));
 h.prepare=createMarketplacePreparation({pool:h.pool,verifyShopify:h.verify,resolveProducts:h.resolve});
 h.reader=async()=>({products:h.products,capturedAt:'2026-10-05',source:'local test fixture'});
 return h;
}
const input=()=>({rows:table([order()])});
const select=(preview,target)=>({rows:input().rows,profileId:'2',settings:{...preview.settings,skuMappings:{[sku]:{...preview.settings.skuMappings[sku],erpSku:target,confirmed:true,barcodeConfirmed:true,barcode:'INJECTED',erpName:'INJECTED'}}}});
const snapshot=preview=>({settings:preview.settings,sourceEvidence:preview.sourceEvidence,items:preview.parsed.items,orders:preview.parsed.orders,barcodeReviews:preview.barcodeReviews,rows:preview.output.rows,headers:preview.output.headers,summary:preview.output.summary,salesLayout:preview.output.salesLayout});
function app(h){const instance=express();instance.use(express.json());instance.use((req,res,next)=>{req.user={id:1,role:'dispatcher'};next();});instance.use('/api/marketplace-intakes',createMarketplaceRouter({pool:h.pool,prepareMarketplace:h.prepare}));return instance;}

test('numeric SKU and NEW actual barcode expose exact targets without choosing or stripping either identity',async()=>{
 const h=harness(),preview=await h.prepare(input()),conflict=preview.barcodeConflicts[0];
 expect(conflict.targetOptions.map(target=>target.erpSku)).toEqual([sku,newSku]);
 expect(conflict).toMatchObject({sourceSku:sku,sourceBarcode:newSku,selectedErpSku:'',canConfirm:false});
 expect(preview.settings.skuMappings[sku]).toMatchObject({erpSku:'',confirmed:false,barcodeConfirmed:false});
 expect(preview.output.ok).toBe(false);expect(h.reviews).toEqual([]);expect(h.pool.connect).not.toHaveBeenCalled();
});

test('exact NEW selection requires approval, then reuses persisted review and exports the selected SKU with original source retained',async()=>{
 const h=harness(),first=await h.prepare(input()),selected=await h.prepare(select(first,newSku),{refresh:true});
 const candidate=selected.barcodeConflicts[0];
 expect(candidate).toMatchObject({erpSku:newSku,erpBarcode:'',sourceBarcode:newSku,selectedErpSku:newSku,canConfirm:true});
 expect(selected.output.ok).toBe(false);expect(selected.barcodeReviews).toEqual([]);
 expect(selected.settings.skuMappings[sku]).toMatchObject({erpSku:newSku,erpName:'晶霧貼 無貼膜神器',barcode:newSku,barcodeConfirmed:false});
 await confirmBarcodeReview(h.pool,candidate,{id:1,role:'dispatcher'});
 const approved=await h.prepare(input(),{refresh:true});
 expect(approved.barcodeConflicts).toEqual([]);expect(approved.output.ok).toBe(true);expect(approved.prepick.ok).toBe(true);
 expect(approved.settings.skuMappings[sku]).toMatchObject({erpSku:newSku,barcode:newSku,barcodeConfirmed:true});
 expect(approved.parsed.items[0].sku).toBe(sku);expect(approved.sourceEvidence.verification.orders[0].items[0].barcode).toBe(newSku);
 const saved=snapshot(approved),reviewed=await verifySavedBarcodeReviews(h.pool,saved,h.reader,{returnContext:true});
 await expect(verifyCatalogMappings(h.pool,saved.settings,[sku],h.reader,reviewed)).resolves.toBeUndefined();
 const {buildEcountUploadTable}=await import('../services/marketplaceIntake.mjs');
 const exported=buildEcountUploadTable(saved);expect(exported.rows[0][11]).toBe(newSku);expect(exported.rows[0][exported.headers.indexOf('數量')]).toBe(2);
 expect(exported.rows[0][exported.headers.indexOf('稅前價格')]+exported.rows[0][exported.headers.indexOf('營業稅')]).toBe(1380);expect(h.pool.connect).not.toHaveBeenCalled();
});

test('confirmation route rejects an unselected target fingerprint and records only the explicitly selected target',async()=>{
 const h=harness(),first=await h.prepare(input()),selectedBody=select(first,newSku),selected=await h.prepare(selectedBody);
 const body={...input(),profileId:'2',verificationFingerprint:first.verification.currentFingerprint,confirmation:{fingerprint:selected.barcodeConflicts[0].fingerprint,confirmed:true}};
 expect((await request(app(h)).post('/api/marketplace-intakes/barcode-confirmations').send(body)).status).toBe(409);expect(h.reviews).toEqual([]);
 const response=await request(app(h)).post('/api/marketplace-intakes/barcode-confirmations').send({...selectedBody,verificationFingerprint:selected.verification.currentFingerprint,confirmation:body.confirmation});
 expect(response.status).toBe(201);expect(h.reviews[0].evidence.erpSku).toBe(newSku);expect(h.reviews[0].evidence.erpBarcode).toBe('');expect(h.pool.connect).not.toHaveBeenCalled();
});

test('arbitrary target and forged client review cannot select or approve a foreign ERP product',async()=>{
 const h=harness(),first=await h.prepare(input()),foreign=select(first,'UNRELATED');
 foreign.barcodeReviews=[{id:99,fingerprint:first.barcodeConflicts[0].fingerprint,evidence:{erpSku:'UNRELATED'}}];
 const result=await h.prepare(foreign,{refresh:true});expect(result.output.ok).toBe(false);expect(result.barcodeReviews).toEqual([]);
 expect(result.barcodeConflicts[0].canConfirm).toBe(false);expect(result.barcodeConflicts[0].targetOptions.some(target=>target.erpSku==='UNRELATED')).toBe(false);
 const settings={skuMappings:{[sku]:{erpSku:newSku,barcode:newSku,barcodeConfirmed:true}}};
 await expect(verifyCatalogMappings(h.pool,settings,[sku],h.reader,{settings,evidence:[{sourceSku:sku,erpSku:newSku}]})).rejects.toMatchObject({status:400});
});

test('validated review capability cannot be borrowed by different settings or altered scan barcode',async()=>{
 const h=harness(),first=await h.prepare(input()),selected=await h.prepare(select(first,newSku));await confirmBarcodeReview(h.pool,selected.barcodeConflicts[0],{id:1,role:'dispatcher'});
 const approved=await h.prepare(input(),{refresh:true}),saved=snapshot(approved),reviewed=await verifySavedBarcodeReviews(h.pool,saved,h.reader,{returnContext:true});
 await expect(verifyCatalogMappings(h.pool,JSON.parse(JSON.stringify(saved.settings)),[sku],h.reader,reviewed)).rejects.toMatchObject({status:400});
 saved.settings.skuMappings[sku].barcode=sku;
 await expect(verifyCatalogMappings(h.pool,saved.settings,[sku],h.reader,reviewed)).rejects.toMatchObject({status:400});
});

test.each(['inactiveSource','duplicateSourceBarcode','duplicateNewBarcode','changedNewName','changedNewBarcode','revoked'])('saved alternate target fails closed when %s changes',async change=>{
 const h=harness(),first=await h.prepare(input()),selected=await h.prepare(select(first,newSku));await confirmBarcodeReview(h.pool,selected.barcodeConflicts[0],{id:1,role:'dispatcher'});
 const approved=await h.prepare(input(),{refresh:true}),saved=snapshot(approved);
 if(change==='inactiveSource')h.products[0].active=false;
 if(change==='duplicateSourceBarcode')h.products.push({...h.products[0],erp_sku:'DUPLICATE'});
 if(change==='duplicateNewBarcode')h.products.push({...h.products[0],erp_sku:'DUPLICATE',barcode:newSku});
 if(change==='changedNewName')h.products[1].product_name='changed';
 if(change==='changedNewBarcode')h.products[1].barcode=sku;
 if(change==='revoked')h.reviews[0].revoked_at='2026-10-05';
 await expect(verifySavedBarcodeReviews(h.pool,saved,h.reader,{returnContext:true})).rejects.toMatchObject({code:'BARCODE_REVIEW_CHANGED'});
 const next=await h.prepare(input(),{refresh:true});expect(next.output.ok).toBe(false);expect(next.barcodeReviews).toEqual([]);
});

test('one missing barcode among two live versions remains blocked and exposes the exact affected order line',async()=>{
 const h=harness(),currentRows=table([order({'Lineitem quantity':'1'}),order({'Lineitem quantity':'1','Lineitem id':'16493014253725'})]);
 h.products=[{...h.products[0],barcode:''}];
 h.verify.mockResolvedValue({rows:currentRows,verification:{shop:'moztech.myshopify.com',orders:[{number:'#154230',id:'7624215101596',currentQuantity:2,items:[{id:'16493014253724',sku,barcode:sku,variantId:variant},{id:'16493014253725',sku,barcode:'',variantId:'gid://shopify/ProductVariant/10002'}]}]}});
 const result=await h.prepare({rows:currentRows});expect(result.output.ok).toBe(false);expect(result.prepick.ok).toBe(false);
 expect(result.barcodeConflicts[0]).toMatchObject({canConfirm:false,reviewReason:'SOURCE_BARCODE_MISSING'});
 expect(result.barcodeConflicts[0].relatedOrders).toEqual(expect.arrayContaining([expect.objectContaining({sourceLineId:'16493014253725',barcode:'',barcodeMissing:true})]));
});

test('a sole exact API-barcode target requires review even when the source SKU is absent from ERP',async()=>{
 const h=harness();h.products=h.products.filter(product=>product.erp_sku!==sku);
 const result=await h.prepare(input());expect(result.output.ok).toBe(false);
 expect(result.barcodeConflicts[0]).toMatchObject({erpSku:newSku,selectedErpSku:newSku,canConfirm:true});
});

test('an explicit invalid target cannot silently fall back to an existing approved target',async()=>{
 const h=harness(),first=await h.prepare(input()),selected=await h.prepare(select(first,newSku));await confirmBarcodeReview(h.pool,selected.barcodeConflicts[0],{id:1,role:'dispatcher'});
 const result=await h.prepare(select(first,'UNRELATED'),{refresh:true});expect(result.output.ok).toBe(false);expect(result.barcodeReviews).toEqual([]);expect(result.barcodeConflicts[0].canConfirm).toBe(false);
});

test('a new duplicate barcode between saved review validation and catalog validation invalidates its capability',async()=>{
 const h=harness(),first=await h.prepare(input()),selected=await h.prepare(select(first,newSku));await confirmBarcodeReview(h.pool,selected.barcodeConflicts[0],{id:1,role:'dispatcher'});
 const approved=await h.prepare(input(),{refresh:true}),saved=snapshot(approved),reviewed=await verifySavedBarcodeReviews(h.pool,saved,h.reader,{returnContext:true});
 h.products.push({...h.products[0],erp_sku:'NEW-DUPLICATE',barcode:newSku});
 await expect(verifyCatalogMappings(h.pool,saved.settings,[sku],h.reader,reviewed)).rejects.toMatchObject({status:400});
});

test('a single current variant with no API barcode preserves an existing confirmed physical profile barcode',async()=>{
 const h=harness();h.products=[{...h.products[0],barcode:''}];
 h.verify.mockResolvedValue({rows:input().rows,verification:{shop:'moztech.myshopify.com',orders:[{number:'#154230',id:'7624215101596',currentQuantity:2,items:[{id:'16493014253724',sku,barcode:'',variantId:variant}]}]}});
 const result=await h.prepare({...input(),settings:{skuMappings:{[sku]:{erpSku:sku,barcode:sku,confirmed:true,barcodeConfirmed:true}}}});
 expect(result.barcodeConflicts).toEqual([]);expect(result.output.ok).toBe(true);expect(result.prepick.ok).toBe(true);
 expect(result.settings.skuMappings[sku]).toMatchObject({barcode:sku,barcodeConfirmed:true});
});

test('an actual barcode also present as a different source SKU still offers both exact targets',async()=>{
 const h=harness(),rows=table([order({'Lineitem quantity':'1'}),order({'Lineitem quantity':'1','Lineitem sku':newSku,'Lineitem id':'16493014253725'})]);
 h.verify.mockResolvedValue({rows,verification:{shop:'moztech.myshopify.com',orders:[{number:'#154230',id:'7624215101596',currentQuantity:2,items:[{id:'16493014253724',sku,barcode:newSku,variantId:variant},{id:'16493014253725',sku:newSku,barcode:newSku,variantId:'gid://shopify/ProductVariant/10002'}]}]}});
 const result=await h.prepare({rows});
 expect(result.barcodeConflicts.find(conflict=>conflict.sourceSku===sku).targetOptions.map(target=>target.erpSku)).toEqual([sku,newSku]);
});


test.each(['duplicateBarcode','primaryName','missingReference'])('a primary reviewed target revalidates every identity when the second reference has %s',async change=>{
 const h=harness(),first=await h.prepare(input()),selected=await h.prepare(select(first,sku));await confirmBarcodeReview(h.pool,selected.barcodeConflicts[0],{id:1,role:'dispatcher'});
 const approved=await h.prepare(input(),{refresh:true}),saved=snapshot(approved),reviewed=await verifySavedBarcodeReviews(h.pool,saved,h.reader,{returnContext:true});
 expect(saved.settings.skuMappings[sku].erpSku).toBe(sku);
 if(change==='duplicateBarcode')h.products.push({...h.products[0],erp_sku:'NEW-DUPLICATE',barcode:newSku});
 if(change==='primaryName')h.products[0].product_name='changed';
 const reader=change==='missingReference'?async()=>null:h.reader;
 await expect(verifyCatalogMappings(h.pool,saved.settings,[sku],reader,reviewed)).rejects.toMatchObject({status:400});
});

test('501 product rows with two exact targets each use bounded review lookup chunks',async()=>{
 const h=harness(),count=501,lines=[],verified=[];h.products=[];
 for(let index=0;index<count;index++){
  const sourceSku=String(5000000000000+index),barcode='NEW'+sourceSku,id=String(200000+index);
  lines.push(order({'Lineitem sku':sourceSku,'Lineitem quantity':'1','Lineitem price':'10','Lineitem id':id,Subtotal:String(count*10),Total:String(count*10),'Outstanding Balance':String(count*10)}));
  h.products.push({erp_sku:sourceSku,barcode:sourceSku,product_name:'原品項'+index,spec:'',active:true},{erp_sku:barcode,barcode:'',product_name:'新品項'+index,spec:'',active:true});
  verified.push({id,sku:sourceSku,barcode,variantId:'gid://shopify/ProductVariant/'+String(10001+index)});
 }
 const rows=table(lines);h.verify.mockResolvedValue({rows,verification:{shop:'moztech.myshopify.com',orders:[{number:'#154230',id:'7624215101596',currentQuantity:count,items:verified}]}});
 const result=await h.prepare({rows});expect(result.barcodeConflicts).toHaveLength(count);expect(result.parsed.summary.totalQuantity).toBe(count);
 const reviewLookups=h.pool.query.mock.calls.filter(([sql])=>sql.includes('marketplace_product_mapping_reviews'));
 expect(reviewLookups.map(([,params])=>params[1].length)).toEqual([1000,2]);
 expect(result.output.ok).toBe(false);expect(h.pool.connect).not.toHaveBeenCalled();
});
