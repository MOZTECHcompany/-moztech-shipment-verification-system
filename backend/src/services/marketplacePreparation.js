const {createHash,randomBytes}=require('node:crypto');
const {lookupProducts}=require('./marketplaceProductCatalog');
const {createShopifyOrderVerifier}=require('./shopifyOrderVerification');
const {safeSettings}=require('./marketplaceSettings');
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
 if(named)return choices.find(p=>p.store===named)||null;
 return shop&&bound.length===1?bound[0]:choices.length===1&&all.length===1?choices[0]:null;
}

function createMarketplacePreparation({pool,verifyShopify=createShopifyOrderVerifier(),resolveProducts=lookupProducts}={}){
 // Short-lived preview reuse avoids sending Shopify another request for each
 // settings blur. Saving always performs a new read before committing.
 const cache=new Map();
 async function currentShopify(rows,refresh){
  const key=digest(rows),previous=cache.get(key);
  if(!refresh&&previous&&previous.expires>Date.now())return previous.promise;
  const promise=verifyShopify(rows);
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
   const result=await currentShopify(source.rows,options.refresh===true);
   verifiedRows=result.rows;verification={...result.verification,currentFingerprint:digest([result.verification.shop,result.rows])};
  }
  const profile=selectProfile(profiles,source.platform,{...input,shopifyShop:verification?.shop});
  const initialProfile=profile&&!clean(input.profileId)&&!clean(supplied.store)&&!clean(supplied.customerCode);
  const settingsInput={salesExportMode:'product-200-v1',store:'',customerCode:'',customerName:'',warehouseCode:'003',date:date(),batchSequence:'1',batchNumber:`WMS-${date().replaceAll('-','')}-${randomBytes(2).toString('hex').toUpperCase()}`,currency:'',taxMode:'erp_inclusive',taxType:'11',summaryNote:'',shippingSku:{erpSku:'00001',name:'運費',confirmed:false,nonStock:false},skuMappings:{},...profile?.settings};
  for(const [key,value] of Object.entries(supplied)){
   // Initial UI defaults do not erase an already confirmed store profile.
   if(initialProfile&&['store','customerCode','customerName','warehouseCode','currency'].includes(key)&&!clean(value))continue;
   if(initialProfile&&['taxConfirmed','erpResponsibilityConfirmed','shippingSku','taxMode','taxType','projectOwner','salesOwner','erpStaffCode','erpProjectCode'].includes(key)&&!clean(supplied.store)&&!clean(input.profileId))continue;
   settingsInput[key]=value;
  }
  safeSettings(settingsInput);
  if(verification)settingsInput.shopifyShop=verification.shop;
  const current=parseUnifiedMarketplace(verifiedRows);
  const raw=deliveryForOrders(current.source,current.parsed);
  // A cancelled order may have no remaining product rows. Keep its current
  // order-level evidence visible without reviving any removed CSV products.
  for(const order of verification?.orders||[]){
   if(raw.orders.some(o=>o.sourceOrderNumber===order.number))continue;
   if(order.currentQuantity!==0)throw fail(`${order.number}：Shopify 商品明細未完整解析`,'SHOPIFY_RESPONSE_INVALID');
   raw.orders.push({sourcePlatform:'Shopify',sourceOrderNumber:order.number,currentQuantity:0,
    paymentStatus:order.paymentStatus,fulfillmentStatus:order.fulfillmentStatus,cancelled:order.cancelled===true,
    paymentMethod:'',shipping:{},financial:{subtotalMinor:order.subtotalMinor,totalMinor:order.totalMinor,shippingMinor:order.shippingMinor,
     discountMinor:order.discountMinor,taxMinor:0,refundedMinor:0,outstandingMinor:order.outstandingMinor,feeMinor:null}});
  }
  // Determine eligibility before resolving products; removed and fulfilled
  // items cannot create new catalog exceptions for this shipment.
  const eligible=prepareUnifiedMarketplace(raw,settingsInput).parsed;
  const skus=[...new Set(eligible.items.map(i=>i.sku))];
  const catalog=await resolveProducts(skus);
  const apiBarcodes=new Map();
  for(const order of verification?.orders||[])for(const i of order.items||[]){
   if(!skus.includes(i.sku)||!i.barcode)continue;
   if(apiBarcodes.has(i.sku)&&apiBarcodes.get(i.sku)!==i.barcode)throw fail(`商品 ${i.sku} 在 Shopify 對應不同條碼，請核對商品設定`,'BARCODE_AMBIGUOUS');
   apiBarcodes.set(i.sku,i.barcode);
  }
  settingsInput.skuMappings={...settingsInput.skuMappings};
  for(const item of eligible.items){
   const match=catalog.products?.[item.sku],provided=settingsInput.skuMappings[item.sku]||{};
   if(match?.status==='matched'){
    const p=match.matches[0];
    const apiBarcode=apiBarcodes.get(item.sku);
    if(p.barcode&&apiBarcode&&p.barcode!==apiBarcode)throw fail(`商品 ${item.sku} 的 Shopify 與 ECOUNT 條碼不同，請先核對`,'BARCODE_MISMATCH');
    settingsInput.skuMappings[item.sku]={...provided,erpSku:p.erp_sku,erpName:p.product_name,spec:p.spec||'',confirmed:true,erpConfirmed:true,barcode:p.barcode||apiBarcode||provided.barcode||'',barcodeConfirmed:p.barcode||apiBarcode?true:provided.barcodeConfirmed===true,category:provided.category||''};
   }else if(!settingsInput.skuMappings[item.sku])settingsInput.skuMappings[item.sku]={erpSku:item.sku,erpName:item.productName,barcode:'',confirmed:false,barcodeConfirmed:false,category:''};
  }
  const settings=safeSettings(settingsInput);
  const prepared=prepareUnifiedMarketplace(raw,settings);
  if(prepared.parsed.items.length>1000||prepared.parsed.summary.totalQuantity>50000)throw fail('本批超過 1,000 商品列或 50,000 件，請分批轉檔');
  if(prepared.parsed.orders.some(o=>!clean(o.sourceOrderNumber)||clean(o.sourceOrderNumber).length>100))throw fail('商城訂單號最多 100 字');
  if(clean(settings.store).length>100||clean(settings.customerCode).length>30||clean(settings.warehouseCode).length>30)throw fail('店鋪、客戶或倉庫欄位過長');
  return {source,raw,...prepared,settings:prepared.effectiveSettings||settings,verification,catalog,profiles:profiles.filter(p=>p.platform===source.platform),profileId:profile?String(profile.id):'',sourceEvidence:{rows:source.rows,verification}};
 };
}
module.exports={createMarketplacePreparation,deliveryForOrders,selectProfile};
