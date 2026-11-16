const {createHash}=require('node:crypto');
const {createReferenceReader,exactReviewTargets}=require('./marketplaceProductCatalog');
const readReference=createReferenceReader();
// Only a successful server-side read of persisted reviews can authorize an
// alternate ERP target. JSON sent by a client cannot reproduce this capability.
const validatedReviewContexts=new WeakMap();
const clean=value=>String(value??'').trim();
const fail=(message,code='BARCODE_REVIEW_INVALID',status=400)=>Object.assign(new Error(message),{status,code});
const scalar=(value,max=100)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const identifier=value=>scalar(value)&&Boolean(value)&&!/^[+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?\d+$/.test(value);
const validId=value=>Number.isSafeInteger(Number(value))&&Number(value)>0&&Number(value)<=2147483647;
const validFingerprint=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const identityFields=['storeProfileId','platform','shop','sourceSku','sourceBarcode','sourceName','variantId','variantIds','erpSku','erpBarcode','erpName','spec'];
const physicalProof='physical-scan-v1';
const internalProof='internal-scan-v1';
const historicalProof='historical-line-scan-v1';
const hasHistoricalProof=evidence=>evidence?.barcodeProof===historicalProof;
const historicalFields=['physicalBarcode','barcodeProof','historicalLine'];
const shopifyLineId=value=>typeof value==='string'&&/^gid:\/\/shopify\/LineItem\/\d+$/.test(value);
const shopifyOrderId=value=>clean(value).match(/^(?:gid:\/\/shopify\/Order\/)?([1-9]\d*)$/)?.[1]||'';
const shopifyVariantId=value=>typeof value==='string'&&/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(value);
const sameLine=(item,line)=>item.sourceOrderNumber===line.orderNumber&&item.sourceLineId===line.sourceLineId;
const positiveQuantity=value=>Number.isSafeInteger(value)&&value>0;

function historicalShopifyLineEvidence(order,line){
 if(!order||!line||order.cancelled!==false||order.cancelledAt||order.fulfillmentStatus!=='unfulfilled'||
  !positiveQuantity(order.currentQuantity)||order.currentQuantity!==order.remainingQuantity||clean(line.variantId)||clean(line.barcode)||
  !shopifyOrderId(order.id)||!identifier(clean(order.number))||!shopifyLineId(line.id)||!identifier(clean(line.sku))||
  !positiveQuantity(line.quantity)||line.unfulfilledQuantity!==line.quantity)return null;
 return {orderNumber:clean(order.number),orderId:shopifyOrderId(order.id),sourceLineId:line.id,quantity:line.quantity};
}
const hasInternalProof=evidence=>evidence?.barcodeProof===internalProof;
const internalFields=['internalScanCode','codeType','barcodeProof','sourceLines'];
const internalIdentifier=value=>identifier(value)&&/^ITM-[A-Za-z0-9._-]{1,96}$/.test(value);
const physicalFields=['physicalBarcode','barcodeProof'];
const hasPhysicalProof=evidence=>evidence?.barcodeProof===physicalProof;
const scanBarcode=evidence=>hasInternalProof(evidence)?evidence.internalScanCode:(hasPhysicalProof(evidence)||hasHistoricalProof(evidence))?evidence.physicalBarcode:evidence.erpBarcode||evidence.sourceBarcode;
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
const fingerprint=evidence=>createHash('sha256').update(JSON.stringify(canonical(evidence))).digest('hex');
// Preserve the exact legacy evidence shape and fingerprint. Only physical-scan
// reviews add fields; an empty Shopify barcode remains empty in their evidence.
const evidenceFields=evidence=>[...identityFields,...(hasHistoricalProof(evidence)?historicalFields:hasInternalProof(evidence)?internalFields:hasPhysicalProof(evidence)?physicalFields:[])];
const reviewEvidence=candidate=>Object.fromEntries(evidenceFields(candidate).map(key=>[key,candidate[key]]));

function barcodeReviewCandidate({profileId,platform,shop,sourceSku,sourceBarcode,sourceName,variantIds,product,physicalBarcode,internalScanCode,codeType,barcodeProof,sourceLines,historicalLine}={}){
 const variants=[...new Set(Array.isArray(variantIds)?variantIds.map(clean).filter(Boolean):[])].sort();
 const evidence={storeProfileId:validId(profileId)?Number(profileId):null,platform:clean(platform),shop:clean(shop),
  sourceSku:clean(sourceSku),sourceBarcode:clean(sourceBarcode),sourceName:clean(sourceName),variantId:variants.length===1?variants[0]:'',variantIds:variants,
  erpSku:clean(product?.erp_sku),erpBarcode:clean(product?.barcode),erpName:clean(product?.product_name),spec:clean(product?.spec)};
 const physical=barcodeProof===physicalProof,internal=barcodeProof===internalProof;
 if(internal)Object.assign(evidence,{internalScanCode:clean(internalScanCode),codeType:codeType,barcodeProof:internalProof,sourceLines});
 if(physical)Object.assign(evidence,{physicalBarcode:clean(physicalBarcode),barcodeProof:physicalProof});
 const historical=barcodeProof===historicalProof;
 if(historical)Object.assign(evidence,{physicalBarcode:clean(physicalBarcode),barcodeProof:historicalProof,historicalLine:{
  orderNumber:clean(historicalLine?.orderNumber),orderId:shopifyOrderId(historicalLine?.orderId),
  sourceLineId:clean(historicalLine?.sourceLineId),quantity:historicalLine?.quantity
 }});
 const shopify=evidence.platform==='Shopify';
 const scopedLine=evidence.historicalLine;
 const canConfirm=Boolean(evidence.storeProfileId&&['Shopify','SHOPLINE','1Shop'].includes(evidence.platform)&&
  Boolean(evidence.shop)&&scalar(evidence.shop,255)&&(!shopify||/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(evidence.shop))&&
  (!shopify||(historical?variants.length===0:variants.length>0&&variants.every(shopifyVariantId)))&&
  variants.length<=1000&&variants.every(value=>scalar(value,255))&&identifier(evidence.sourceSku)&&
  (historical?shopify&&evidence.sourceBarcode===''&&identifier(evidence.physicalBarcode)&&evidence.erpBarcode===evidence.physicalBarcode&&
   identifier(scopedLine.orderNumber)&&scalar(scopedLine.orderId)&&Boolean(scopedLine.orderId)&&shopifyLineId(scopedLine.sourceLineId)&&scalar(scopedLine.sourceLineId,255)&&positiveQuantity(scopedLine.quantity)&&Boolean(evidence.sourceName)
   :internal?evidence.sourceBarcode===''&&evidence.erpBarcode===''&&codeType==='internal'&&internalIdentifier(evidence.internalScanCode)&&Array.isArray(sourceLines)&&sourceLines.length>0&&sourceLines.length<=1000&&sourceLines.every(line=>Array.isArray(line)&&line.length===3&&scalar(line[0],255)&&line[0]&&scalar(line[1],255)&&line[1]&&Number.isSafeInteger(line[2])&&line[2]>0)&&new Set(sourceLines.map(line=>JSON.stringify(line.slice(0,2)))).size===sourceLines.length:physical?shopify&&evidence.sourceBarcode===''&&identifier(evidence.physicalBarcode)&&(!evidence.erpBarcode||evidence.erpBarcode===evidence.physicalBarcode):identifier(evidence.sourceBarcode))&&
  identifier(evidence.erpSku)&&(evidence.erpBarcode===''||identifier(evidence.erpBarcode))&&scalar(evidence.sourceName,5000)&&scalar(evidence.erpName,5000)&&scalar(evidence.spec,5000)&&product?.active===true);
 return {...evidence,fingerprint:fingerprint(evidence),canConfirm};
}

function validEvidence(evidence){
 const fields=evidenceFields(evidence);
 if(!evidence||typeof evidence!=='object'||Array.isArray(evidence)||Object.keys(evidence).length!==fields.length||fields.some(key=>!Object.hasOwn(evidence,key)))return false;
 const candidate=barcodeReviewCandidate({profileId:evidence.storeProfileId,platform:evidence.platform,shop:evidence.shop,sourceSku:evidence.sourceSku,sourceBarcode:evidence.sourceBarcode,sourceName:evidence.sourceName,variantIds:evidence.variantIds,
  product:{erp_sku:evidence.erpSku,barcode:evidence.erpBarcode,product_name:evidence.erpName,spec:evidence.spec,active:true},physicalBarcode:evidence.physicalBarcode,internalScanCode:evidence.internalScanCode,codeType:evidence.codeType,barcodeProof:evidence.barcodeProof,sourceLines:evidence.sourceLines,historicalLine:evidence.historicalLine});
 return candidate.canConfirm&&JSON.stringify(canonical(reviewEvidence(candidate)))===JSON.stringify(canonical(evidence));
}
function reviewMatchesCandidate(candidate,record){
 return Boolean(record&&Number(record.store_profile_id)===candidate.storeProfileId&&validEvidence(record.evidence)&&
  record.fingerprint===candidate.fingerprint&&fingerprint(record.evidence)===candidate.fingerprint);
}
function actorId(user){
 if(!validId(user?.id)||!['admin','dispatcher','superadmin'].includes(user?.role))throw Object.assign(new Error('沒有商品核對權限'),{status:403,code:'BARCODE_REVIEW_FORBIDDEN'});
 return Number(user.id);
}

async function readBarcodeReviews(pool,profileId,fingerprints){
 if(!validId(profileId))return [];
 if(!Array.isArray(fingerprints)||fingerprints.length>1000||fingerprints.some(value=>!validFingerprint(value)))throw fail('商品核對識別無效');
 const values=[...new Set(fingerprints)];if(!values.length)return [];
 return (await pool.query(`SELECT id,store_profile_id,fingerprint,evidence,confirmed_by,confirmed_at
  FROM marketplace_product_mapping_reviews WHERE store_profile_id=$1 AND fingerprint=ANY($2::text[]) AND revoked_at IS NULL`,[Number(profileId),values])).rows;
}

async function readPhysicalBarcodeReviews(pool,profileId,skus){
 if(!validId(profileId))return [];
 if(!Array.isArray(skus)||skus.length>1000||skus.some(value=>!identifier(value)))throw fail('實物條碼商品識別無效');
 if(!skus.length)return [];
 return (await pool.query(`SELECT id,store_profile_id,fingerprint,evidence,confirmed_by,confirmed_at
  FROM marketplace_product_mapping_reviews WHERE store_profile_id=$1 AND evidence->>'barcodeProof'='physical-scan-v1'
  AND evidence->>'sourceSku'=ANY($2::text[]) AND revoked_at IS NULL`,[Number(profileId),[...new Set(skus)]])).rows;
}

async function readInternalScanReviews(pool,profileId,skus){
 if(!validId(profileId)||!skus.length)return [];
 return (await pool.query(`SELECT id,store_profile_id,fingerprint,evidence,confirmed_by,confirmed_at FROM marketplace_product_mapping_reviews
 WHERE store_profile_id=$1 AND evidence->>'barcodeProof'='internal-scan-v1' AND evidence->>'sourceSku'=ANY($2::text[]) AND revoked_at IS NULL`,[Number(profileId),skus])).rows;
}
function currentReviewTargets(evidence,products){
 if(hasInternalProof(evidence)){
  const source=exactReviewTargets(evidence.sourceSku,'',products),target=products.find(p=>p.erp_sku===evidence.erpSku);
  const collision=products.some(p=>p.erp_sku===evidence.internalScanCode||p.barcode===evidence.internalScanCode);
  return {blocked:source.blocked||collision||!target||target.active!==true||Boolean(target.barcode)||source.targets.some(p=>p.erp_sku!==evidence.erpSku),targets:target?[target]:[]};
 }
 const physical=hasPhysicalProof(evidence)||hasHistoricalProof(evidence);
 const current=exactReviewTargets(evidence.sourceSku,physical?evidence.physicalBarcode:evidence.sourceBarcode,products);
 if(physical&&(current.targets.length!==1||current.targets[0]?.erp_sku!==evidence.erpSku))current.blocked=true;
 return current;
}

function allowsHistoricalBarcodeReview(user,verifiedErpSession=false){
 return ['admin','superadmin'].includes(user?.role)||
  (verifiedErpSession===true&&user?.role==='dispatcher'&&Boolean(user.erpSubject)&&
   Array.isArray(user.permissions)&&user.permissions.includes('wms_admin'));
}

async function confirmBarcodeReview(pool,candidate,user,{historicalLineAttested=false,verifiedErpSession=false}={}){
 const actor=actorId(user),evidence=reviewEvidence(candidate||{});
 if(candidate?.canConfirm!==true||!validEvidence(evidence)||!validFingerprint(candidate.fingerprint)||fingerprint(evidence)!==candidate.fingerprint)throw fail('請先核對目前店鋪、商品版本及 ECOUNT 條碼');
 if(hasHistoricalProof(evidence)){
  if(!allowsHistoricalBarcodeReview(user,verifiedErpSession))throw fail('僅管理員可核對 Shopify 歷史商品明細','BARCODE_REVIEW_FORBIDDEN',403);
  if(historicalLineAttested!==true)throw fail('請確認歷史商品明細與實物身分','BARCODE_HISTORICAL_ATTESTATION_REQUIRED');
 }
 if(hasInternalProof(evidence)){
  await pool.query('INSERT INTO marketplace_internal_scan_codes(internal_scan_code,product_code,created_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[evidence.internalScanCode,evidence.erpSku,actor]);
  const binding=(await pool.query('SELECT product_code FROM marketplace_internal_scan_codes WHERE internal_scan_code=$1',[evidence.internalScanCode])).rows[0];
  if(!binding||binding.product_code!==evidence.erpSku)throw fail('此內部掃描碼已對應其他品項，請另建內碼','INTERNAL_SCAN_CODE_CONFLICT');
 }
 const inserted=(await pool.query(`INSERT INTO marketplace_product_mapping_reviews(store_profile_id,fingerprint,evidence,confirmed_by)
  VALUES($1,$2,$3::jsonb,$4) ON CONFLICT DO NOTHING
  RETURNING id,store_profile_id,fingerprint,evidence,confirmed_by,confirmed_at`,[evidence.storeProfileId,candidate.fingerprint,JSON.stringify(evidence),actor])).rows[0];
 if(inserted)return inserted;
 const existing=(await readBarcodeReviews(pool,evidence.storeProfileId,[candidate.fingerprint]))[0];
 if(!existing)throw fail('商品核對已變更，請重新核對','BARCODE_REVIEW_CHANGED');
 return existing;
}

async function revokeBarcodeReview(pool,id,user){
 const actor=actorId(user);
 if(!validId(id))throw fail('商品核對編號無效');
 return (await pool.query(`UPDATE marketplace_product_mapping_reviews SET revoked_at=NOW(),revoked_by=$2
  WHERE id=$1 AND revoked_at IS NULL RETURNING id,store_profile_id,fingerprint,evidence,confirmed_by,confirmed_at,revoked_by,revoked_at`,[Number(id),actor])).rows[0]||null;
}

function verifySnapshotSource(snapshot,evidence){
 const verification=snapshot.sourceEvidence?.verification;
 if(!verification||verification.platform!==evidence.platform||clean(verification.shop)!==evidence.shop)throw fail(`商品 ${evidence.sourceSku} 的來源核對資料已變更`,'BARCODE_REVIEW_CHANGED');
 const lines=(snapshot.items||[]).filter(item=>item.sku===evidence.sourceSku);
 if(hasHistoricalProof(evidence)){
  const scoped=evidence.historicalLine;
  const matchingOrders=(verification.orders||[]).filter(order=>order.number===scoped.orderNumber&&shopifyOrderId(order.id)===scoped.orderId);
  const matchingLines=(matchingOrders[0]?.items||[]).filter(item=>item.id===scoped.sourceLineId);
  const matchingItems=lines.filter(item=>sameLine(item,scoped));
  const actual=historicalShopifyLineEvidence(matchingOrders[0],matchingLines[0]);
  const mapping=snapshot.settings?.skuMappings?.[evidence.sourceSku];
  if(verification.mode!=='api'||verification.version!=='shopify-current-v2'||
   snapshot.sourceEvidence?.historicalLineProofProfileId!==evidence.storeProfileId||
   matchingOrders.length!==1||matchingLines.length!==1||matchingItems.length!==1||
   !actual||JSON.stringify(canonical(actual))!==JSON.stringify(canonical(scoped))||
   matchingLines[0].sku!==evidence.sourceSku||clean(matchingLines[0].name)!==evidence.sourceName||
   matchingItems[0].quantity!==scoped.quantity||clean(matchingItems[0].productName)!==evidence.sourceName||
   !mapping||mapping.erpSku!==evidence.erpSku||mapping.barcode!==evidence.physicalBarcode||
   mapping.barcodeConfirmed!==true||mapping.scanCodeType==='internal')
   throw fail(`商品 ${evidence.sourceSku} 的歷史 Shopify 明細或 ECOUNT 對照已變更`,'BARCODE_REVIEW_CHANGED');
  const snapshotLines=new Set(lines.map(item=>JSON.stringify([item.sourceOrderNumber,item.sourceLineId])));
  const siblings=(verification.orders||[]).flatMap(order=>(order.items||[]).filter(item=>
   item.sku===evidence.sourceSku&&snapshotLines.has(JSON.stringify([order.number,item.id]))));
  if(siblings.some(line=>clean(line.variantId)||clean(line.barcode)?!shopifyVariantId(line.variantId)||line.barcode!==evidence.physicalBarcode:false))
   throw fail(`商品 ${evidence.sourceSku} 的同品號 Shopify 條碼已變更`,'BARCODE_REVIEW_CHANGED');
  return;
 }
 if(hasInternalProof(evidence)){
  const signature=lines.map(i=>[i.sourceOrderNumber,i.sourceLineId,i.quantity]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if(!lines.length||JSON.stringify(signature)!==JSON.stringify(evidence.sourceLines)||[...new Set(lines.map(i=>clean(i.productName)))].sort().join(' / ')!==evidence.sourceName)throw fail('內碼來源訂單明細已變更','BARCODE_REVIEW_CHANGED');
  for(const number of new Set(lines.map(i=>i.sourceOrderNumber))){
   const actual=verification.orders?.find(o=>o.number===number)?.items?.filter(i=>i.sku===evidence.sourceSku)||[];
   const expected=lines.filter(i=>i.sourceOrderNumber===number);
   if(!actual.length||actual.some(i=>clean(i.barcode)))throw fail('內碼來源商品條碼已變更','BARCODE_REVIEW_CHANGED');
   if(evidence.platform==='Shopify'){
    if(actual.length!==expected.length||actual.some(i=>!evidence.variantIds.includes(clean(i.variantId))||!expected.some(e=>e.sourceLineId===i.id)))throw fail('內碼來源版本已變更','BARCODE_REVIEW_CHANGED');
   }else if(actual.reduce((sum,i)=>sum+Number(i.quantity||0),0)!==expected.reduce((sum,i)=>sum+i.quantity,0))throw fail('內碼來源商品數量已變更','BARCODE_REVIEW_CHANGED');
  }
  const mapping=snapshot.settings?.skuMappings?.[evidence.sourceSku];
  if(!mapping||mapping.erpSku!==evidence.erpSku||mapping.scanCodeType!=='internal'||mapping.internalScanCode!==evidence.internalScanCode||mapping.internalScanConfirmed!==true||clean(mapping.barcode)||mapping.barcodeConfirmed===true)throw fail(`商品 ${evidence.sourceSku} 的內碼對照已變更`,'BARCODE_REVIEW_CHANGED');
  return;
 }
 const lineIds=new Set(lines.map(item=>item.sourceLineId));
 const verified=(verification.orders||[]).flatMap(order=>order.items||[]).filter(item=>item.sku===evidence.sourceSku&&lineIds.has(item.id));
 if(!lines.length||verified.length!==lineIds.size||new Set(verified.map(item=>item.id)).size!==lineIds.size||verified.some(item=>clean(item.barcode)!==evidence.sourceBarcode)||
  (evidence.platform==='Shopify'&&verified.some(item=>!evidence.variantIds.includes(clean(item.variantId))))||
  JSON.stringify([...new Set(verified.map(item=>clean(item.variantId)).filter(Boolean))].sort())!==JSON.stringify(evidence.variantIds))throw fail(`商品 ${evidence.sourceSku} 的來源版本或條碼已變更`,'BARCODE_REVIEW_CHANGED');
 if(hasPhysicalProof(evidence)&&(lineIds.size!==lines.length||[...new Set(lines.map(item=>clean(item.productName)))].sort().join(' / ')!==evidence.sourceName))throw fail(`商品 ${evidence.sourceSku} 的來源商品明細已變更`,'BARCODE_REVIEW_CHANGED');
 const mapping=snapshot.settings?.skuMappings?.[evidence.sourceSku];
 if(!mapping||mapping.erpSku!==evidence.erpSku||mapping.barcode!==scanBarcode(evidence)||mapping.barcodeConfirmed!==true||hasPhysicalProof(evidence)&&Object.hasOwn(mapping,'physicalBarcode')&&mapping.physicalBarcode!==evidence.physicalBarcode)throw fail(`商品 ${evidence.sourceSku} 的已保存對照與核對紀錄不同`,'BARCODE_REVIEW_CHANGED');
}

function verifiedReviewTarget(context,settings,sku,product,products){
 const verified=context&&validatedReviewContexts.get(context);
 if(!verified||verified.settings!==settings||!product||product.active!==true)return false;
 const evidence=verified.evidence.find(value=>value.sourceSku===sku&&value.erpSku===product.erp_sku);
 const mapping=settings.skuMappings?.[sku];
 const current=evidence&&Array.isArray(products)?currentReviewTargets(evidence,products):null;
 return Boolean(evidence&&current&&!current.blocked&&current.targets.some(value=>value.erp_sku===product.erp_sku)&&mapping&&mapping.erpSku===evidence.erpSku&&(hasInternalProof(evidence)?mapping.scanCodeType==='internal'&&mapping.internalScanCode===evidence.internalScanCode&&mapping.internalScanConfirmed===true&&!clean(mapping.barcode):mapping.barcode===scanBarcode(evidence)&&mapping.barcodeConfirmed===true)&&
  product.barcode===evidence.erpBarcode&&product.product_name===evidence.erpName&&clean(product.spec)===evidence.spec);
}
function validatedCatalogContext(context,settings,products){
 const verified=context&&validatedReviewContexts.get(context);
 if(!verified||verified.settings!==settings||!Array.isArray(products))return false;
 return verified.evidence.every(evidence=>verifiedReviewTarget(context,settings,evidence.sourceSku,
  products.find(product=>product.erp_sku===evidence.erpSku),products));
}

function historicalSnapshotLines(snapshot){
 const verification=snapshot?.sourceEvidence?.verification;
 if(verification?.platform!=='Shopify'||verification.mode!=='api'||verification.version!=='shopify-current-v2')return [];
 const sourceIdentities=new Set();
 for(const order of verification.orders||[])for(const line of order.items||[]){
  const scoped=historicalShopifyLineEvidence(order,line);
  if(scoped)sourceIdentities.add(JSON.stringify([scoped.orderNumber,scoped.sourceLineId,line.sku]));
 }
 return (snapshot.items||[]).filter(item=>sourceIdentities.has(JSON.stringify([item.sourceOrderNumber,item.sourceLineId,item.sku])));
}
function requiresStrictBarcodeReview(snapshot){
 return Boolean(snapshot?.sourceEvidence?.historicalLineProofProfileId!==undefined||
  Array.isArray(snapshot?.barcodeReviews)&&snapshot.barcodeReviews.some(review=>hasHistoricalProof(review?.evidence)||hasPhysicalProof(review?.evidence))||
  historicalSnapshotLines(snapshot).length);
}
function verifyHistoricalReviewCoverage(snapshot,reviews){
 const marker=snapshot?.sourceEvidence?.historicalLineProofProfileId;
 const historical=(reviews||[]).filter(review=>hasHistoricalProof(review.evidence));
 const lines=historicalSnapshotLines(snapshot);
 if(marker===undefined&&!historical.length&&!lines.length)return;
 if(!validId(marker)||!historical.length)throw fail('已保存的歷史商品核對紀錄不完整','BARCODE_REVIEW_CHANGED');
 const identities=new Set(historical.map(({evidence})=>JSON.stringify([
  evidence.historicalLine.orderNumber,evidence.historicalLine.sourceLineId,evidence.sourceSku
 ])));
 if(identities.size!==historical.length||lines.length!==identities.size||
  lines.some(item=>!identities.has(JSON.stringify([item.sourceOrderNumber,item.sourceLineId,item.sku]))))
  throw fail('已保存的歷史 Shopify 明細與核對範圍不同','BARCODE_REVIEW_CHANGED');
}
function assertPersistedReview(review,record){
 const evidence=review.evidence;
 if(!record||record.fingerprint!==review.fingerprint||Number(record.store_profile_id)!==evidence.storeProfileId||
  !validEvidence(record.evidence)||fingerprint(record.evidence)!==review.fingerprint)
  throw fail(`商品 ${evidence.sourceSku} 的核對已撤銷或變更，請重新核對`,'BARCODE_REVIEW_CHANGED');
}
async function lockSavedHistoricalBarcodeReviews(db,snapshot){
 const reviews=(snapshot?.barcodeReviews||[]).filter(review=>hasHistoricalProof(review.evidence));
 if(!reviews.length)return;
 const ids=reviews.map(review=>Number(review.id));
 const records=(await db.query(`SELECT id,store_profile_id,fingerprint,evidence FROM marketplace_product_mapping_reviews
  WHERE id=ANY($1::bigint[]) AND revoked_at IS NULL ORDER BY id FOR SHARE`,[ids])).rows;
 const byId=new Map(records.map(record=>[Number(record.id),record]));
 for(const review of reviews)assertPersistedReview(review,byId.get(Number(review.id)));
}

async function verifySavedBarcodeReviews(pool,snapshot,reader=readReference,{returnContext=false}={}){
 const reviews=snapshot?.barcodeReviews;
 if(reviews===undefined||Array.isArray(reviews)&&reviews.length===0){
  verifyHistoricalReviewCoverage(snapshot,reviews);
  return;
 }
 if(!Array.isArray(reviews)||reviews.length>1000||reviews.some(review=>!validId(review?.id)||!validFingerprint(review.fingerprint)||!validEvidence(review.evidence)||fingerprint(review.evidence)!==review.fingerprint))throw fail('已保存的商品核對紀錄無效');
 verifyHistoricalReviewCoverage(snapshot,reviews);
 const ids=reviews.map(review=>Number(review.id));
 if(new Set(ids).size!==ids.length)throw fail('已保存的商品核對紀錄重複');
 const records=(await pool.query(`SELECT id,store_profile_id,fingerprint,evidence FROM marketplace_product_mapping_reviews
  WHERE id=ANY($1::bigint[]) AND revoked_at IS NULL`,[ids])).rows;
 const reference=await reader();
 if(!Array.isArray(reference?.products)||!reference.products.length)throw fail('目前無法核對 ECOUNT 商品主檔','BARCODE_REVIEW_UNAVAILABLE');
 for(const review of reviews){
  const evidence=review.evidence,record=records.find(row=>Number(row.id)===Number(review.id));
  assertPersistedReview(review,record);
  verifySnapshotSource(snapshot,evidence);
  if(hasInternalProof(evidence)){
   const binding=(await pool.query('SELECT product_code FROM marketplace_internal_scan_codes WHERE internal_scan_code=$1',[evidence.internalScanCode])).rows[0];
   if(!binding||binding.product_code!==evidence.erpSku)throw fail('內部掃描碼對照不存在或已變更','BARCODE_REVIEW_CHANGED');
  }
  const targets=currentReviewTargets(evidence,reference.products);
  const product=targets.targets.find(value=>value.erp_sku===evidence.erpSku);
  if(targets.blocked||!product||product.active!==true||product.erp_sku!==evidence.erpSku||product.barcode!==evidence.erpBarcode||product.product_name!==evidence.erpName||clean(product.spec)!==evidence.spec)throw fail(`商品 ${evidence.sourceSku} 的 ECOUNT 對照已變更，請重新核對`,'BARCODE_REVIEW_CHANGED');
 }
 if(returnContext){
  const context=Object.freeze({});
  validatedReviewContexts.set(context,{settings:snapshot.settings,evidence:reviews.map(review=>JSON.parse(JSON.stringify(review.evidence)))});
  return context;
 }
}
module.exports={historicalProof,requiresStrictBarcodeReview,lockSavedHistoricalBarcodeReviews,historicalShopifyLineEvidence,shopifyVariantId,barcodeReviewCandidate,reviewEvidence,reviewMatchesCandidate,readBarcodeReviews,readPhysicalBarcodeReviews,readInternalScanReviews,allowsHistoricalBarcodeReview,confirmBarcodeReview,revokeBarcodeReview,verifySavedBarcodeReviews,verifiedReviewTarget,validatedCatalogContext};
