const {readFileSync}=require('node:fs');
const express=require('express'),request=require('supertest');
const {PGlite}=require('@electric-sql/pglite');
const {createMarketplaceRouter}=require('../src/routes/marketplaceRoutes');
const {barcodeReviewCandidate,readBarcodeReviews}=require('../src/services/marketplaceBarcodeReviews');
const sourceFingerprint='current-source-evidence';
const sourceSku='4711299270086';
const candidate=()=>barcodeReviewCandidate({profileId:1,platform:'Shopify',shop:'moztech.myshopify.com',sourceSku,
 sourceBarcode:'NEW'+sourceSku,sourceName:'晶霧貼 無貼膜神器 iPhone X/Xs/11Pro',variantIds:['gid://shopify/ProductVariant/10001'],
 product:{erp_sku:sourceSku,barcode:sourceSku,product_name:'晶霧貼 無貼膜神器',spec:'iPhone X/Xs/11Pro',active:true}});
const body=()=>({rows:[['Name'],['#154230']],profileId:'1',verificationFingerprint:sourceFingerprint,confirmation:{fingerprint:candidate().fingerprint,confirmed:true}});
function appFor(pool,prepareMarketplace,user={id:1,role:'dispatcher'}){
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user=user;next();});
 app.use('/api/marketplace-intakes',createMarketplaceRouter({pool,prepareMarketplace}));
 app.use((error,req,res,next)=>res.status(error.status||500).json({message:error.message,code:error.code}));
 return app;
}

describe('fresh server barcode confirmation route',()=>{
 let db,pool,sql;
 beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2);
   CREATE TABLE marketplace_store_profiles(id INTEGER PRIMARY KEY); INSERT INTO marketplace_store_profiles VALUES(1);
   CREATE TABLE marketplace_intakes(id INTEGER PRIMARY KEY); CREATE TABLE orders(id INTEGER PRIMARY KEY);
   CREATE TABLE inventory(sku TEXT PRIMARY KEY,quantity INTEGER); INSERT INTO inventory VALUES('${sourceSku}',30);`);
  await db.exec(readFileSync(require.resolve('../migrations/038_marketplace_product_mapping_reviews.sql'),'utf8'));
 });
 beforeEach(async()=>{
  await db.exec('TRUNCATE marketplace_product_mapping_reviews RESTART IDENTITY');
  sql=[];pool={query:async(...args)=>{sql.push(args);return db.query(...args);},connect:jest.fn(()=>{throw Error('confirmation must not start a batch transaction');})};
 });
 afterAll(async()=>{await db?.close();});
 function prepare(extra={}){
  return jest.fn(async()=>{
   const fresh=candidate(),reviews=await readBarcodeReviews(pool,1,[fresh.fingerprint]);
   return {profileId:'1',barcodeReviewCandidates:[fresh],barcodeConflicts:reviews.length?[]:[fresh],
    verification:{currentFingerprint:sourceFingerprint},sourceEvidence:{private:'original source evidence'},output:{ok:reviews.length>0},...extra};
  });
 }
 async function assertNoOperationalWrites(){
  expect(pool.connect).not.toHaveBeenCalled();
  expect((await db.query('SELECT count(*)::int AS n FROM marketplace_intakes')).rows[0].n).toBe(0);
  expect((await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n).toBe(0);
  expect((await db.query('SELECT quantity FROM inventory')).rows[0].quantity).toBe(30);
  expect(sql.some(([query])=>/\b(?:INSERT|UPDATE|DELETE)\b[\s\S]*\b(?:marketplace_intakes|orders|inventory)\b/i.test(query))).toBe(false);
 }
 test.each(['admin','dispatcher','superadmin'])('%s can confirm the freshly prepared identity without writing a batch or inventory',async role=>{
  const fresh=prepare(),app=appFor(pool,fresh,{id:1,role}),input=body();
  const response=await request(app).post('/api/marketplace-intakes/barcode-confirmations').send(input);
  expect(response.status).toBe(201);expect(response.body.confirmed).toBe(true);
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(fresh).toHaveBeenCalledWith(input,{refresh:true});
  const stored=(await db.query('SELECT * FROM marketplace_product_mapping_reviews')).rows;
  expect(stored).toHaveLength(1);expect(stored[0].confirmed_by).toBe(1);
  await assertNoOperationalWrites();
 });
 test.each(['picker','packer','viewer',null])('unauthorized role %s cannot read fresh platform data or confirm',async role=>{
  const fresh=prepare(),app=appFor(pool,fresh,role?{id:2,role}:undefined);
  // Explicitly clear identity for the anonymous case (the helper defaults to dispatcher).
  const anonymous=role===null?appFor(pool,fresh,null):app;
  const response=await request(anonymous).post('/api/marketplace-intakes/barcode-confirmations').send(body());
  expect(response.status).toBe(role===null?401:403);expect(fresh).not.toHaveBeenCalled();
  expect((await db.query('SELECT * FROM marketplace_product_mapping_reviews')).rows).toEqual([]);
  await assertNoOperationalWrites();
 });
 test.each([false,'true',undefined])('requires a real confirmation before refreshing: %j',confirmed=>{
  const fresh=prepare(),input=body();input.confirmation.confirmed=confirmed;
  return request(appFor(pool,fresh)).post('/api/marketplace-intakes/barcode-confirmations').send(input).then(response=>{
   expect(response.status).toBe(400);expect(response.body.code).toBe('BARCODE_CONFIRMATION_REQUIRED');expect(fresh).not.toHaveBeenCalled();
  });
 });
 test('a valid-looking unmatched product fingerprint is rejected before insertion',async()=>{
  const fresh=prepare(),input=body();input.confirmation.fingerprint='a'.repeat(64);
  const response=await request(appFor(pool,fresh)).post('/api/marketplace-intakes/barcode-confirmations').send(input);
  expect(response.status).toBe(409);expect(response.body.code).toBe('BARCODE_REVIEW_CHANGED');
  expect((await db.query('SELECT * FROM marketplace_product_mapping_reviews')).rows).toEqual([]);
  await assertNoOperationalWrites();
 });
 test('changed live order evidence rejects the old preview and never records a confirmation',async()=>{
  const fresh=prepare({verification:{currentFingerprint:'changed-source-evidence'}}),input=body();
  const response=await request(appFor(pool,fresh)).post('/api/marketplace-intakes/barcode-confirmations').send(input);
  expect(response.status).toBe(409);expect(response.body.code).toBe('BARCODE_REVIEW_CHANGED');
  expect(fresh).toHaveBeenCalledWith(input,{refresh:true});
  expect((await db.query('SELECT * FROM marketplace_product_mapping_reviews')).rows).toEqual([]);
  await assertNoOperationalWrites();
 });
 test('client ERP, barcode, variant and evidence injection cannot replace the server candidate',async()=>{
  const fresh=prepare(),input=body();
  input.settings={skuMappings:{[sourceSku]:{erpSku:'INJECTED',barcode:'INJECTED',confirmed:true}}};
  input.confirmation={...input.confirmation,erpSku:'INJECTED',sourceBarcode:sourceSku,variantId:'gid://shopify/ProductVariant/999',evidence:{erpSku:'INJECTED'}};
  input.barcodeReviewCandidates=[{...candidate(),erpSku:'INJECTED'}];
  const response=await request(appFor(pool,fresh)).post('/api/marketplace-intakes/barcode-confirmations').send(input);
  expect(response.status).toBe(201);
  const stored=(await db.query('SELECT evidence FROM marketplace_product_mapping_reviews')).rows[0].evidence;
  expect(stored.erpSku).toBe(sourceSku);expect(stored.erpBarcode).toBe(sourceSku);expect(stored.sourceBarcode).toBe('NEW'+sourceSku);
  expect(stored.variantId).toBe('gid://shopify/ProductVariant/10001');expect(JSON.stringify(stored)).not.toContain('INJECTED');
  await assertNoOperationalWrites();
 });
 test('retry after confirmation succeeds even when no conflicts remain and keeps the same audit record',async()=>{
  const fresh=prepare(),app=appFor(pool,fresh),input=body();
  const first=await request(app).post('/api/marketplace-intakes/barcode-confirmations').send(input);
  const second=await request(app).post('/api/marketplace-intakes/barcode-confirmations').send(input);
  expect(first.status).toBe(201);expect(second.status).toBe(201);
  expect(second.body.id).toBe(first.body.id);expect(second.body.confirmedAt).toBe(first.body.confirmedAt);
  expect(fresh).toHaveBeenCalledTimes(2);expect((await db.query('SELECT * FROM marketplace_product_mapping_reviews')).rows).toHaveLength(1);
  await assertNoOperationalWrites();
 });
 test('preview exposes conflicts for review but excludes internal candidates and source evidence',async()=>{
  const response=await request(appFor(pool,prepare())).post('/api/marketplace-intakes/preview').send(body());
  expect(response.status).toBe(200);expect(response.body.barcodeConflicts).toHaveLength(1);
  expect(response.body.barcodeReviewCandidates).toBeUndefined();expect(response.body.sourceEvidence).toBeUndefined();
  expect(response.headers['cache-control']).toBe('private, no-store');
  await assertNoOperationalWrites();
 });
});
