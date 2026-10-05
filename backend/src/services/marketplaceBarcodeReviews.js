const {createHash}=require('node:crypto');
const {createReferenceReader,resolveProducts}=require('./marketplaceProductCatalog');
const readReference=createReferenceReader();
const clean=value=>String(value??'').trim();
const fail=(message,code='BARCODE_REVIEW_INVALID')=>Object.assign(new Error(message),{status:400,code});
const scalar=(value,max=100)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const identifier=value=>scalar(value)&&Boolean(value)&&!/^[+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?\d+$/.test(value);
const validId=value=>Number.isSafeInteger(Number(value))&&Number(value)>0&&Number(value)<=2147483647;
const validFingerprint=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const identityFields=['storeProfileId','platform','shop','sourceSku','sourceBarcode','sourceName','variantId','variantIds','erpSku','erpBarcode','erpName','spec'];
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
const fingerprint=evidence=>createHash('sha256').update(JSON.stringify(canonical(evidence))).digest('hex');
const reviewEvidence=candidate=>Object.fromEntries(identityFields.map(key=>[key,candidate[key]]));

function barcodeReviewCandidate({profileId,platform,shop,sourceSku,sourceBarcode,sourceName,variantIds,product}={}){
 const variants=[...new Set(Array.isArray(variantIds)?variantIds.map(clean).filter(Boolean):[])].sort();
 const evidence={storeProfileId:validId(profileId)?Number(profileId):null,platform:clean(platform),shop:clean(shop),
  sourceSku:clean(sourceSku),sourceBarcode:clean(sourceBarcode),sourceName:clean(sourceName),variantId:variants.length===1?variants[0]:'',variantIds:variants,
  erpSku:clean(product?.erp_sku),erpBarcode:clean(product?.barcode),erpName:clean(product?.product_name),spec:clean(product?.spec)};
 const shopify=evidence.platform==='Shopify';
 const canConfirm=Boolean(evidence.storeProfileId&&['Shopify','SHOPLINE','1Shop'].includes(evidence.platform)&&
  Boolean(evidence.shop)&&scalar(evidence.shop,255)&&(!shopify||/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(evidence.shop))&&
  (!shopify||variants.length>0&&variants.every(value=>/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(value)))&&
  variants.length<=1000&&variants.every(value=>scalar(value,255))&&identifier(evidence.sourceSku)&&identifier(evidence.sourceBarcode)&&
  identifier(evidence.erpSku)&&(evidence.erpBarcode===''||identifier(evidence.erpBarcode))&&scalar(evidence.sourceName,5000)&&scalar(evidence.erpName,5000)&&scalar(evidence.spec,5000)&&product?.active===true);
 return {...evidence,fingerprint:fingerprint(evidence),canConfirm};
}

function validEvidence(evidence){
 if(!evidence||typeof evidence!=='object'||Array.isArray(evidence)||Object.keys(evidence).length!==identityFields.length||identityFields.some(key=>!Object.hasOwn(evidence,key)))return false;
 const candidate=barcodeReviewCandidate({profileId:evidence.storeProfileId,platform:evidence.platform,shop:evidence.shop,sourceSku:evidence.sourceSku,sourceBarcode:evidence.sourceBarcode,sourceName:evidence.sourceName,variantIds:evidence.variantIds,
  product:{erp_sku:evidence.erpSku,barcode:evidence.erpBarcode,product_name:evidence.erpName,spec:evidence.spec,active:true}});
 return candidate.canConfirm&&JSON.stringify(canonical(reviewEvidence(candidate)))===JSON.stringify(canonical(evidence));
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

async function confirmBarcodeReview(pool,candidate,user){
 const actor=actorId(user),evidence=reviewEvidence(candidate||{});
 if(candidate?.canConfirm!==true||!validEvidence(evidence)||!validFingerprint(candidate.fingerprint)||fingerprint(evidence)!==candidate.fingerprint)throw fail('請先核對目前店鋪、商品版本及 ECOUNT 條碼');
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
 const lineIds=new Set(lines.map(item=>item.sourceLineId));
 const verified=(verification.orders||[]).flatMap(order=>order.items||[]).filter(item=>item.sku===evidence.sourceSku&&lineIds.has(item.id));
 if(!lines.length||verified.length!==lineIds.size||new Set(verified.map(item=>item.id)).size!==lineIds.size||verified.some(item=>clean(item.barcode)!==evidence.sourceBarcode)||
  (evidence.platform==='Shopify'&&verified.some(item=>!evidence.variantIds.includes(clean(item.variantId))))||
  JSON.stringify([...new Set(verified.map(item=>clean(item.variantId)).filter(Boolean))].sort())!==JSON.stringify(evidence.variantIds))throw fail(`商品 ${evidence.sourceSku} 的來源版本或條碼已變更`,'BARCODE_REVIEW_CHANGED');
 const mapping=snapshot.settings?.skuMappings?.[evidence.sourceSku];
 if(!mapping||mapping.erpSku!==evidence.erpSku||mapping.barcode!==(evidence.erpBarcode||evidence.sourceBarcode)||mapping.barcodeConfirmed!==true)throw fail(`商品 ${evidence.sourceSku} 的已保存對照與核對紀錄不同`,'BARCODE_REVIEW_CHANGED');
}

async function verifySavedBarcodeReviews(pool,snapshot,reader=readReference){
 const reviews=snapshot?.barcodeReviews;
 if(reviews===undefined||Array.isArray(reviews)&&reviews.length===0)return;
 if(!Array.isArray(reviews)||reviews.length>1000||reviews.some(review=>!validId(review?.id)||!validFingerprint(review.fingerprint)||!validEvidence(review.evidence)||fingerprint(review.evidence)!==review.fingerprint))throw fail('已保存的商品核對紀錄無效');
 const ids=reviews.map(review=>Number(review.id));
 if(new Set(ids).size!==ids.length)throw fail('已保存的商品核對紀錄重複');
 const records=(await pool.query(`SELECT id,store_profile_id,fingerprint,evidence FROM marketplace_product_mapping_reviews
  WHERE id=ANY($1::bigint[]) AND revoked_at IS NULL`,[ids])).rows;
 const reference=await reader();
 if(!Array.isArray(reference?.products)||!reference.products.length)throw fail('目前無法核對 ECOUNT 商品主檔','BARCODE_REVIEW_UNAVAILABLE');
 for(const review of reviews){
  const evidence=review.evidence,record=records.find(row=>Number(row.id)===Number(review.id));
  if(!record||record.fingerprint!==review.fingerprint||Number(record.store_profile_id)!==evidence.storeProfileId||!validEvidence(record.evidence)||fingerprint(record.evidence)!==review.fingerprint)throw fail(`商品 ${evidence.sourceSku} 的核對已撤銷或變更，請重新核對`,'BARCODE_REVIEW_CHANGED');
  verifySnapshotSource(snapshot,evidence);
  const target=resolveProducts([evidence.sourceSku],reference.products)[evidence.sourceSku];
  const product=target?.status==='matched'?target.matches[0]:null;
  if(!product||product.active!==true||product.erp_sku!==evidence.erpSku||product.barcode!==evidence.erpBarcode||product.product_name!==evidence.erpName||clean(product.spec)!==evidence.spec)throw fail(`商品 ${evidence.sourceSku} 的 ECOUNT 對照已變更，請重新核對`,'BARCODE_REVIEW_CHANGED');
 }
}
module.exports={barcodeReviewCandidate,reviewEvidence,readBarcodeReviews,confirmBarcodeReview,revokeBarcodeReview,verifySavedBarcodeReviews};
