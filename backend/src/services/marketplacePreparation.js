const {createHash,randomBytes}=require('node:crypto');
const {lookupProducts}=require('./marketplaceProductCatalog');
const {createShopifyOrderVerifier}=require('./shopifyOrderVerification');
const {createShoplineOrderVerifier}=require('./shoplineOrderVerification');
const {createOneShopOrderVerifier}=require('./oneShopOrderVerification');
const {safeSettings}=require('./marketplaceSettings');
const {classifyMarketplaceReimports,newSalesSource}=require('./marketplaceReimports');
const {barcodeReviewCandidate,readBarcodeReviews,reviewMatchesCandidate}=require('./marketplaceBarcodeReviews');
const clean=value=>String(value??'').trim();
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(message,code='MARKETPLACE_INVALID',status=400)=>Object.assign(new Error(message),{status,code});
const date=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

function deliveryForOrders(source,parsed){
 const headers=source.rows[0],values=new Map();let last='';
 const fields=source.platform==='Shopify'?{
  recipient:['Shipping Name'],phone:['Shipping Phone'],address:['Shipping Address1','Shipping Address2','Shipping City','Shipping Province','Shipping Country'],postalCode:['Shipping Zip'],method:['Shipping Method']
 }:source.platform==='1Shop'?{
  recipient:['顧客'],phone:['電話國碼','顧客電話'],address:['運送地址'],method:['物流'],storeName:['門市名稱','運送超商'],storeCode:['超商代號'],trackingNumber:['託運單號'],note:['物流備註','方便收貨時間']
 }:{recipient:['收件人'],phone:['收件人電話號碼'],address:['完整地址'],postalCode:['郵政編號（如適用)'],method:['送貨方式'],storeName:['門市名稱'],storeCode:['全家服務編號 / 7-11 店號'],trackingNumber:['送貨編號'],note:['出貨備註']};
 const orderColumn=headers.indexOf(source.platform==='Shopify'?'Name':source.platform==='1Shop'?'訂單編號':'訂單號碼');
 for(const r of source.rows.slice(1)){
  const number=clean(r[orderColumn])||(source.platform==='Shopify'?last:'');if(!number)continue;last=number;
  if(!values.has(number))values.set(number,new Map());
  const cols=values.get(number);
  for(const names of Object.values(fields))for(const name of names){
   const value=clean(r[headers.indexOf(name)]);if(!value)continue;
   if(cols.has(name)&&cols.get(name)!==value)throw fail(`${number}：收件資料不一致，請核對 ${name}`,'DELIVERY_CONFLICT');
   if(value.length>1000||/[\u0000-\u001f\u007f]/.test(value))throw fail(`${number}：收件資料格式無效`,'DELIVERY_INVALID');
   cols.set(name,value);
  }
 }
 for(const o of parsed.orders){
  const cols=values.get(o.sourceOrderNumber)||new Map();
  o.shipping=Object.fromEntries(Object.entries(fields).map(([key,names])=>[key,[...new Set(names.map(n=>cols.get(n)).filter(Boolean))].join(' ')]));
 }
 return parsed;
}

function selectProfile(profiles,platform,input={}){
 const all=profiles.filter(p=>p.platform===platform);
 const shop=platform==='Shopify'?clean(input.shopifyShop):'';
 const choices=all.filter(p=>!shop||!p.settings?.shopifyShop||p.settings.shopifyShop===shop);
 const bound=choices.filter(p=>p.settings?.shopifyShop===shop);
 if(input.profileId!=null&&clean(input.profileId)){
  const match=choices.find(p=>String(p.id)===String(input.profileId));
  if(!match)throw fail('店鋪設定不存在或平台不同，請重新選擇店鋪','STORE_PROFILE_INVALID');return match;
 }
 const named=clean(input.settings?.store);
 if(named){
  const match=choices.find(p=>p.store===named);
  if(!match&&all.length)throw fail('請選擇已設定的店鋪；新店鋪須先保存設定','STORE_PROFILE_INVALID');
  return match||null;
 }
 return shop&&bound.length===1?bound[0]:choices.length===1&&all.length===1?choices[0]:null;
}

function createMarketplacePreparation({pool,verifyShopify=createShopifyOrderVerifier(),verifyShopline=createShoplineOrderVerifier(),verifyOneShop=createOneShopOrderVerifier(),resolveProducts=lookupProducts,classifyReimports=classifyMarketplaceReimports}={}){
 // Short-lived preview reuse avoids sending Shopify another request for each
 // settings blur. Saving always performs a new read before committing.
 const cache=new Map();
 async function currentPlatform(platform,rows,context,refresh){
  const key=digest([platform,context,rows]),previous=cache.get(key);
  if(!refresh&&previous&&previous.expires>Date.now())return previous.promise;
  const verifier=platform==='Shopify'?verifyShopify:platform==='SHOPLINE'?verifyShopline:verifyOneShop;
  const promise=verifier(rows,context);
  cache.set(key,{expires:Date.now()+15000,promise});
  if(cache.size>16)cache.delete(cache.keys().next().value);
  try{return await promise;}catch(e){cache.delete(key);throw e;}
 }
 return async function prepare(input={},options={}){
  const {inspectMarketplaceRows,parseUnifiedMarketplace,prepareUnifiedMarketplace}=await import('./unifiedMarketplace.mjs');
  const source=inspectMarketplaceRows(input.rows);
  const profiles=(await pool.query('SELECT id,platform,store,settings,updated_at FROM marketplace_store_profiles ORDER BY platform,store')).rows;
  const supplied=input.settings||{};
  if(typeof supplied!=='object'||Array.isArray(supplied))throw fail('轉檔設定格式無效');
  safeSettings({...supplied,skuMappings:supplied.skuMappings??{}});
  let verifiedRows=source.rows,verification=null;
  if(source.platform==='Shopify'){
   const result=await currentPlatform(source.platform,source.rows,{},options.refresh===true);
   verifiedRows=result.rows;verification=result.verification?{...result.verification,mode:'api',platform:source.platform,currentFingerprint:digest([result.verification.shop,result.rows,result.verification.fingerprint||null])}:null;
  }
  const profile=selectProfile(profiles,source.platform,{...input,shopifyShop:verification?.shop});
  if(source.platform!=='Shopify'){
   // Only a persisted store binding can select a server-side API credential.
   // Uploaded settings cannot turn a required live check on or off.
   const context={apiConnectionId:clean(profile?.settings?.apiConnectionId)};
   const result=await currentPlatform(source.platform,source.rows,context,options.refresh===true);
   verifiedRows=result.rows;verification=result.verification?{...result.verification,mode:'api',platform:source.platform,currentFingerprint:digest([source.platform,context.apiConnectionId,result.rows,result.verification.fingerprint])}:null;
  }
  const initialProfile=profile&&!clean(input.profileId)&&!clean(supplied.store)&&!clean(supplied.customerCode);
  const settingsInput={salesExportMode:'product-200-v1',store:'',customerCode:'',customerName:'',warehouseCode:'003',date:date(),batchSequence:'1',batchNumber:`WMS-${date().replaceAll('-','')}-${randomBytes(2).toString('hex').toUpperCase()}`,currency:'',taxMode:'erp_inclusive',taxType:'11',summaryNote:'',shippingSku:{erpSku:'00001',name:'運費',confirmed:false,nonStock:false},skuMappings:{},...profile?.settings};
  for(const [key,value] of Object.entries(supplied)){
   if(key==='apiConnectionId')continue;
   // Initial UI defaults do not erase an already confirmed store profile.
   if(initialProfile&&['store','customerCode','customerName','warehouseCode','currency'].includes(key)&&!clean(value))continue;
   if(initialProfile&&['taxConfirmed','erpResponsibilityConfirmed','shippingSku','taxMode','taxType','projectOwner','salesOwner','erpStaffCode','erpProjectCode'].includes(key)&&!clean(supplied.store)&&!clean(input.profileId))continue;
   settingsInput[key]=value;
  }
  safeSettings(settingsInput);
  if(verification&&source.platform==='Shopify')settingsInput.shopifyShop=verification.shop;
  const current=parseUnifiedMarketplace(verifiedRows);
  const raw=deliveryForOrders(current.source,current.parsed);
  // A cancelled order may have no remaining product rows. Keep its current
  // order-level evidence visible without reviving any removed CSV products.
  for(const order of source.platform==='Shopify'?verification?.orders||[]:[]){
   if(raw.orders.some(o=>o.sourceOrderNumber===order.number))continue;
   if(order.currentQuantity!==0)throw fail(`${order.number}：Shopify 商品明細未完整解析`,'SHOPIFY_RESPONSE_INVALID');
   raw.orders.push({sourcePlatform:'Shopify',sourceOrderNumber:order.number,currentQuantity:0,
    paymentStatus:order.paymentStatus,fulfillmentStatus:order.fulfillmentStatus,cancelled:order.cancelled===true,
    paymentMethod:'',shipping:{},financial:{subtotalMinor:order.subtotalMinor,totalMinor:order.totalMinor,shippingMinor:order.shippingMinor,
     discountMinor:order.discountMinor,taxMinor:0,refundedMinor:0,outstandingMinor:order.outstandingMinor,feeMinor:null}});
  }
  const sourceClassification={...await classifyReimports({db:pool,platform:source.platform,store:clean(settingsInput.store),raw,verification,profile,verifiedRows}),verifiedRows};
  const reimports=sourceClassification.reimports;
  const salesRaw=newSalesSource(raw,reimports);
  if(verification&&source.platform==='Shopify')verification={...verification,currentFingerprint:digest([verification.currentFingerprint,sourceClassification.fingerprint,salesRaw.orders.map(order=>order.sourceOrderNumber).sort()])};
  // Determine eligibility before resolving products; removed and fulfilled
  // items cannot create new catalog exceptions for this shipment.
  const eligible=prepareUnifiedMarketplace(salesRaw,settingsInput).parsed;
  const skus=[...new Set(eligible.items.map(i=>i.sku))];
  const apiBarcodes=new Map(),apiVariants=new Map(),incompleteSources=new Set();
  const eligibleLines=new Set(eligible.items.map(i=>JSON.stringify([i.sourceOrderNumber,i.sourceLineId])));
  for(const order of verification?.orders||[])for(const i of order.items||[]){
   if(!skus.includes(i.sku))continue;
   if(source.platform==='Shopify'&&!eligibleLines.has(JSON.stringify([order.number,i.id])))continue;
   if(source.platform==='Shopify'&&(!i.variantId||!i.barcode))incompleteSources.add(i.sku);
   if(i.variantId){if(!apiVariants.has(i.sku))apiVariants.set(i.sku,new Set());apiVariants.get(i.sku).add(i.variantId);}
   if(!i.barcode)continue;
   if(apiBarcodes.has(i.sku)&&apiBarcodes.get(i.sku)!==i.barcode)throw fail(`商品 ${i.sku} 在 ${source.platform} 對應不同條碼，請核對商品設定`,'BARCODE_AMBIGUOUS');
   apiBarcodes.set(i.sku,i.barcode);
  }
  const catalog=!skus.length&&reimports.length?{products:{},sync:null}:await resolveProducts(skus);
  const extraBarcodes=[...new Set([...apiBarcodes.values()].filter(value=>!skus.includes(value)))];
  const barcodeCatalog=extraBarcodes.length?await resolveProducts(extraBarcodes):{products:{}};
  const sourceCandidates=[];
  for(const sku of skus){
   const match=catalog.products?.[sku],apiBarcode=apiBarcodes.get(sku),variantIds=[...(apiVariants.get(sku)||[])].sort();
   const barcodeMatch=apiBarcode===sku?match:catalog.products?.[apiBarcode]||barcodeCatalog.products?.[apiBarcode];
   const catalogBlocked=[match,barcodeMatch].some(value=>['inactive','ambiguous'].includes(value?.status));
   const targets=catalogBlocked?[]:[...new Map([...(match?.matches||[]),...(barcodeMatch?.matches||[])]
    .filter(p=>p.active===true&&(p.erp_sku===sku||p.barcode===sku||apiBarcode&&(p.erp_sku===apiBarcode||p.barcode===apiBarcode)))
    .map(p=>[p.erp_sku,p])).values()];
   const p=match?.status==='matched'?match.matches[0]:null;
   if(!catalogBlocked&&targets.length<=1&&!(p?.barcode&&apiBarcode&&p.barcode!==apiBarcode)&&variantIds.length<=1&&!(targets.length&&!p))continue;
   // An ambiguous or inactive original identity remains blocked, even if the
   // other exact string happens to name an active product.
   if(!targets.length&&!p)continue;
   const common={profileId:profile?.id,platform:source.platform,shop:verification?.shop||profile?.settings?.apiConnectionId||'',sourceSku:sku,sourceBarcode:apiBarcode||'',sourceName:[...new Set(eligible.items.filter(i=>i.sku===sku).map(i=>i.productName))].sort().join(' / '),variantIds};
   const candidates=targets.map(product=>barcodeReviewCandidate({...common,product}));
   const relatedOrders=eligible.items.filter(item=>item.sku===sku).map(item=>{
    const order=verification?.orders?.find(order=>order.number===item.sourceOrderNumber);
    const verified=order?.items?.find(line=>line.id===item.sourceLineId);
    return {orderNumber:item.sourceOrderNumber,orderId:order?.id||'',sourceLineId:item.sourceLineId,
     variantId:verified?.variantId||'',productName:item.productName,quantity:item.quantity,
     barcode:verified?.barcode||'',barcodeMissing:!verified?.barcode};
   });
   const missingBarcode=source.platform==='Shopify'&&relatedOrders.some(value=>value.barcodeMissing);
   sourceCandidates.push({sku,common,targets,candidates,relatedOrders,catalogBlocked,
    proposedTarget:clean(supplied.skuMappings?.[sku]?.erpSku),
    reviewReason:catalogBlocked?'ERP_AMBIGUOUS':missingBarcode?'SOURCE_BARCODE_MISSING':incompleteSources.has(sku)?'SOURCE_VARIANT_MISSING':targets.length>1?'ERP_TARGET_REQUIRED':!p?.barcode?'ERP_BARCODE_MISSING':variantIds.length>1?'MULTIPLE_VARIANTS':'BARCODE_MISMATCH'});
  }
  const fingerprints=[...new Set(sourceCandidates.flatMap(value=>value.candidates.map(candidate=>candidate.fingerprint)))];
  const reviews=[];
  // Each product can expose two exact targets while the shipment itself still
  // has at most 1,000 product rows. Keep each persisted lookup bounded.
  if(profile)for(let offset=0;offset<fingerprints.length;offset+=1000)
   reviews.push(...await readBarcodeReviews(pool,profile.id,fingerprints.slice(offset,offset+1000)));
  const approved=new Map(reviews.filter(record=>sourceCandidates.some(value=>value.candidates.some(candidate=>reviewMatchesCandidate(candidate,record)))).map(record=>[record.fingerprint,record]));
  const reviewCandidates=[],barcodeConflicts=[],barcodeReviews=[],selectedTargets=new Map();
  for(const value of sourceCandidates){
   const approvedCandidates=value.candidates.filter(candidate=>approved.has(candidate.fingerprint));
   const selected=value.candidates.find(candidate=>candidate.erpSku===value.proposedTarget)||
    (approvedCandidates.length===1?approvedCandidates[0]:value.candidates.length===1?value.candidates[0]:null);
   const invalidSelection=Boolean(value.proposedTarget&&!value.candidates.some(candidate=>candidate.erpSku===value.proposedTarget));
   const selectedErpSku=selected?.erpSku||'';
   const candidate={...(selected||barcodeReviewCandidate(value.common)),
    canConfirm:Boolean(selected?.canConfirm&&!invalidSelection&&!value.catalogBlocked&&!incompleteSources.has(value.sku)),
    selectedErpSku,targetOptions:value.targets.map(product=>({erpSku:product.erp_sku,erpName:product.product_name,erpBarcode:product.barcode,spec:product.spec||''})),
    relatedOrders:value.relatedOrders,reviewReason:value.reviewReason};
   selectedTargets.set(value.sku,{product:value.targets.find(product=>product.erp_sku===selectedErpSku)||null});
   // Only the currently selected target is confirmable through the route.
   reviewCandidates.push(candidate);
   if(candidate.canConfirm&&approved.has(candidate.fingerprint)){
    const review=approved.get(candidate.fingerprint);barcodeReviews.push({id:review.id,fingerprint:review.fingerprint,evidence:review.evidence});
   }else barcodeConflicts.push(candidate);
  }
  settingsInput.skuMappings={...settingsInput.skuMappings};
  for(const item of eligible.items){
   const match=catalog.products?.[item.sku],provided=settingsInput.skuMappings[item.sku]||{};
   if(selectedTargets.has(item.sku)||match?.status==='matched'){
    const p=selectedTargets.has(item.sku)?selectedTargets.get(item.sku).product:match.matches[0];
    if(!p){settingsInput.skuMappings[item.sku]={...provided,erpSku:'',erpName:'',spec:'',confirmed:false,erpConfirmed:false,barcode:'',barcodeConfirmed:false};continue;}
    const apiBarcode=apiBarcodes.get(item.sku);
    const blocked=barcodeConflicts.some(c=>c.sourceSku===item.sku);
    settingsInput.skuMappings[item.sku]={...provided,erpSku:p.erp_sku,erpName:p.product_name,spec:p.spec||'',confirmed:true,erpConfirmed:true,barcode:p.barcode||apiBarcode||provided.barcode||'',barcodeConfirmed:blocked?false:p.barcode||apiBarcode?true:provided.barcodeConfirmed===true,category:provided.category||''};
   }else if(!settingsInput.skuMappings[item.sku])settingsInput.skuMappings[item.sku]={erpSku:item.sku,erpName:item.productName,barcode:'',confirmed:false,barcodeConfirmed:false,category:''};
  }
  const settings=safeSettings(settingsInput);
  const prepared=prepareUnifiedMarketplace(salesRaw,settings);
  const {buildMarketplaceAuditRows}=await import('./marketplaceIntake.mjs');
  prepared.audit=buildMarketplaceAuditRows(raw,prepared.effectiveSettings||settings);
  prepared.choices.push(...reimports.map(order=>({number:order.orderNumber,eligible:false,reason:order.message,existing:true})));
  if(barcodeConflicts.length){
   const issues=barcodeConflicts.map(c=>({code:'BARCODE_MISMATCH',severity:'error',sku:c.sourceSku,message:`商品 ${c.sourceSku} 的商城與 ECOUNT 對照待核對`}));
   prepared.output={...prepared.output,ok:false,rows:[],issues:[...prepared.output.issues,...issues]};
   prepared.prepick={...prepared.prepick,ok:false,rows:[],issues:[...prepared.prepick.issues,...issues]};
  }
  if(prepared.parsed.items.length>1000||prepared.parsed.summary.totalQuantity>50000)throw fail('本批超過 1,000 商品列或 50,000 件，請分批轉檔');
  if(prepared.parsed.orders.some(o=>!clean(o.sourceOrderNumber)||clean(o.sourceOrderNumber).length>100))throw fail('商城訂單號最多 100 字');
  if(clean(settings.store).length>100||clean(settings.customerCode).length>30||clean(settings.warehouseCode).length>30)throw fail('店鋪、客戶或倉庫欄位過長');
  return {source,raw,...prepared,reimports,newOrderCount:prepared.parsed.orders.length,sourceClassification,settings:prepared.effectiveSettings||settings,verification,catalog,barcodeConflicts,barcodeReviews,barcodeReviewCandidates:reviewCandidates,profiles:profiles.filter(p=>p.platform===source.platform),profileId:profile?String(profile.id):'',sourceEvidence:{rows:source.rows,verification}};
 };
}
module.exports={createMarketplacePreparation,deliveryForOrders,selectProfile};
