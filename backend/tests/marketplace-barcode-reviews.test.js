const {readFileSync}=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {barcodeReviewCandidate,reviewEvidence,readBarcodeReviews,confirmBarcodeReview,revokeBarcodeReview,verifySavedBarcodeReviews}=require('../src/services/marketplaceBarcodeReviews');
const actor={id:1,role:'dispatcher'};
const sku='4711299270086',variantId='gid://shopify/ProductVariant/10001';
const product={erp_sku:sku,barcode:sku,product_name:'晶霧貼 無貼膜神器',spec:'iPhone X/Xs/11Pro',active:true};
const input=()=>({profileId:1,platform:'Shopify',shop:'moztech.myshopify.com',sourceSku:sku,sourceBarcode:'NEW'+sku,sourceName:'晶霧貼 無貼膜神器 iPhone X/Xs/11Pro',variantIds:[variantId],product});
const reference=()=>({products:[product,{...product,erp_sku:'NEW'+sku,barcode:'NEW'+sku,product_name:'晶霧貼 含貼膜神器'}],capturedAt:'2026-10-02',source:'ECOUNT'});
function snapshot(record){
 return {barcodeReviews:[{id:record.id,fingerprint:record.fingerprint,evidence:record.evidence}],
  items:[{sku,sourceLineId:'gid://shopify/LineItem/1',productName:input().sourceName}],
  settings:{skuMappings:{[sku]:{erpSku:sku,barcode:sku,barcodeConfirmed:true}}},
  sourceEvidence:{verification:{platform:'Shopify',shop:input().shop,orders:[{items:[{id:'gid://shopify/LineItem/1',sku,variantId,barcode:'NEW'+sku}]}]}}};
}
async function setup(){
 const db=new PGlite();
 await db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2); CREATE TABLE marketplace_store_profiles(id INTEGER PRIMARY KEY); INSERT INTO marketplace_store_profiles VALUES(1),(2);");
 await db.exec(readFileSync(require.resolve('../migrations/038_marketplace_product_mapping_reviews.sql'),'utf8'));
 return {db,pool:{query:(...args)=>db.query(...args)}};
}

describe('barcode review identity',()=>{
 test('preserves NEW and variant identity, includes source and ERP labels in the pin',()=>{
  const original=barcodeReviewCandidate(input());
  expect(original.canConfirm).toBe(true);
  expect(original.sourceBarcode).toBe('NEW'+sku);expect(original.erpBarcode).toBe(sku);
  for(const change of [{sourceName:'另一個品名'},{variantIds:['gid://shopify/ProductVariant/10002']},{sourceBarcode:sku},{shop:'other.myshopify.com'},{profileId:2},{product:{...product,spec:'iPhone 11'}}]){
   expect(barcodeReviewCandidate({...input(),...change}).fingerprint).not.toBe(original.fingerprint);
  }
  expect(barcodeReviewCandidate({...input(),variantIds:[variantId,variantId]}).fingerprint).toBe(original.fingerprint);
 });
 test.each([
  {profileId:null},{variantIds:[]},{variantIds:[variantId,'gid://shopify/ProductVariant/2']},{variantIds:['gid://shopify/LineItem/1']},
  {sourceSku:'4.711299270086E+12'},{product:{...product,active:false}},{product:{...product,barcode:''}},
 ])('cannot confirm an incomplete or unsafe pin: %j',change=>{
  expect(barcodeReviewCandidate({...input(),...change}).canConfirm).toBe(false);
 });
 test.each(['SHOPLINE','1Shop'])('%s cannot approve a barcode exception without a store identity',platform=>{
  const connection={...input(),platform,variantIds:[],shop:'known-platform-store'};
  expect(barcodeReviewCandidate(connection).canConfirm).toBe(true);
  expect(barcodeReviewCandidate({...connection,shop:''}).canConfirm).toBe(false);
  expect(barcodeReviewCandidate({...connection,shop:'   '}).canConfirm).toBe(false);
 });
});

describe('persisted barcode review',()=>{
 let db,pool;
 beforeEach(async()=>({db,pool}=await setup()));
 afterEach(async()=>{await db?.close();});
 test('migration stores immutable confirmation, reuses it on retry and never crosses profiles',async()=>{
  const candidate=barcodeReviewCandidate(input()),first=await confirmBarcodeReview(pool,candidate,actor);
  const repeated=await confirmBarcodeReview(pool,candidate,{id:2,role:'admin'});
  expect(String(repeated.id)).toBe(String(first.id));expect(repeated.confirmed_by).toBe(1);
  expect(first.evidence).toEqual(reviewEvidence(candidate));
  expect(await readBarcodeReviews(pool,2,[candidate.fingerprint])).toEqual([]);
  expect(await readBarcodeReviews(pool,1,[candidate.fingerprint])).toHaveLength(1);
  await expect(verifySavedBarcodeReviews(pool,snapshot(first),async()=>reference())).resolves.toBeUndefined();
 });
 test('revocation blocks an already saved export and retains the old audit record',async()=>{
  const candidate=barcodeReviewCandidate(input()),first=await confirmBarcodeReview(pool,candidate,actor);
  const revoked=await revokeBarcodeReview(pool,first.id,{id:2,role:'admin'});
  expect(revoked.revoked_by).toBe(2);expect(revoked.revoked_at).toBeTruthy();
  expect(await readBarcodeReviews(pool,1,[candidate.fingerprint])).toEqual([]);
  await expect(verifySavedBarcodeReviews(pool,snapshot(first),async()=>reference())).rejects.toMatchObject({status:400,code:'BARCODE_REVIEW_CHANGED'});
  const renewed=await confirmBarcodeReview(pool,candidate,actor);
  expect(String(renewed.id)).not.toBe(String(first.id));
  expect((await pool.query('SELECT * FROM marketplace_product_mapping_reviews')).rows).toHaveLength(2);
 });
 test.each(['barcode','product_name','spec','active'])('a current ERP %s change blocks the saved export',async field=>{
  const first=await confirmBarcodeReview(pool,barcodeReviewCandidate(input()),actor);
  const changed=reference();changed.products[0]={...product,[field]:field==='active'?false:'changed'};
  await expect(verifySavedBarcodeReviews(pool,snapshot(first),async()=>changed)).rejects.toMatchObject({status:400,code:'BARCODE_REVIEW_CHANGED'});
 });
 test('a new conflicting ERP barcode match blocks the saved export',async()=>{
  const first=await confirmBarcodeReview(pool,barcodeReviewCandidate(input()),actor),changed=reference();
  changed.products.push({...product,erp_sku:'OTHER',barcode:sku});
  await expect(verifySavedBarcodeReviews(pool,snapshot(first),async()=>changed)).rejects.toMatchObject({status:400,code:'BARCODE_REVIEW_CHANGED'});
 });
 test.each(['variant','barcode','shop','line','duplicateLine','mapping','evidence'])('altered snapshot %s cannot borrow an existing confirmation',async field=>{
  const first=await confirmBarcodeReview(pool,barcodeReviewCandidate(input()),actor),saved=snapshot(first);
  if(field==='variant')saved.sourceEvidence.verification.orders[0].items[0].variantId='gid://shopify/ProductVariant/2';
  if(field==='barcode')saved.sourceEvidence.verification.orders[0].items[0].barcode=sku;
  if(field==='shop')saved.sourceEvidence.verification.shop='other.myshopify.com';
  if(field==='line')saved.items[0].sourceLineId='gid://shopify/LineItem/999';
  if(field==='duplicateLine'){
   saved.items.push({...saved.items[0],sourceLineId:'gid://shopify/LineItem/2'});
   saved.sourceEvidence.verification.orders[0].items.push({...saved.sourceEvidence.verification.orders[0].items[0]});
  }
  if(field==='mapping')saved.settings.skuMappings[sku].erpSku='NEW'+sku;
  if(field==='evidence')saved.barcodeReviews[0].evidence={...saved.barcodeReviews[0].evidence,sourceName:'changed'};
  await expect(verifySavedBarcodeReviews(pool,saved,async()=>reference())).rejects.toMatchObject({status:400});
 });
 test.each(['single','mixed'])('a %s saved source with a missing variant cannot reuse a known variant approval',async shape=>{
  const first=await confirmBarcodeReview(pool,barcodeReviewCandidate(input()),actor),saved=snapshot(first);
  if(shape==='single')delete saved.sourceEvidence.verification.orders[0].items[0].variantId;
  else{
   saved.items.push({...saved.items[0],sourceLineId:'gid://shopify/LineItem/2'});
   const unknown={...saved.sourceEvidence.verification.orders[0].items[0],id:'gid://shopify/LineItem/2'};
   delete unknown.variantId;saved.sourceEvidence.verification.orders[0].items.push(unknown);
  }
  await expect(verifySavedBarcodeReviews(pool,saved,async()=>reference())).rejects.toMatchObject({status:400,code:'BARCODE_REVIEW_CHANGED'});
 });
 test('client confirmation booleans cannot approve a fabricated fingerprint or missing variant',async()=>{
  const candidate=barcodeReviewCandidate(input());
  await expect(confirmBarcodeReview(pool,{...candidate,fingerprint:'a'.repeat(64)},actor)).rejects.toMatchObject({status:400});
  const incomplete=barcodeReviewCandidate({...input(),variantIds:[]});
  await expect(confirmBarcodeReview(pool,{...incomplete,canConfirm:true},actor)).rejects.toMatchObject({status:400});
  await expect(confirmBarcodeReview(pool,candidate,{id:2,role:'picker'})).rejects.toMatchObject({status:403});
  expect((await pool.query('SELECT * FROM marketplace_product_mapping_reviews')).rows).toEqual([]);
 });
 test('legacy snapshots with no review keep their existing behavior; missing reference fails closed',async()=>{
  await expect(verifySavedBarcodeReviews(pool,{},async()=>{throw Error('should not read');})).resolves.toBeUndefined();
  const first=await confirmBarcodeReview(pool,barcodeReviewCandidate(input()),actor);
  await expect(verifySavedBarcodeReviews(pool,snapshot(first),async()=>null)).rejects.toMatchObject({status:400,code:'BARCODE_REVIEW_UNAVAILABLE'});
 });
});
