const {readFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const express=require('express'),request=require('supertest');
const {PGlite}=require('@electric-sql/pglite');
const {safeSettings}=require('../src/services/marketplaceSettings');
const {createMarketplacePreparation}=require('../src/services/marketplacePreparation');
const {resolveProducts,verifyCatalogMappings}=require('../src/services/marketplaceProductCatalog');
const {barcodeReviewCandidate,reviewEvidence,confirmBarcodeReview,verifySavedBarcodeReviews,revokeBarcodeReview}=require('../src/services/marketplaceBarcodeReviews');
const {createMarketplaceRouter}=require('../src/routes/marketplaceRoutes');
const {downloadFile}=require('../src/services/marketplaceDownloads');
const jwt=require('jsonwebtoken');
const sku='AUDIT-SKU-001',scan='AUDIT-SCAN-001';
const variants=['gid://shopify/ProductVariant/101','gid://shopify/ProductVariant/102'];
const actor={id:1,role:'dispatcher'};
const profile={id:1,platform:'Shopify',store:'AUDIT store',settings:{store:'AUDIT store',customerCode:'AUDIT-CUSTOMER',customerName:'AUDIT store',warehouseCode:'003',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,shippingSku:{erpSku:'00001',name:'運費',nonStock:true,confirmed:true}}};
const product=()=>({erp_sku:sku,barcode:'',product_name:'AUDIT ERP product',spec:'AUDIT exact specification',active:true});
const table=records=>{const headers=Object.keys(records[0]);return [headers,...records.map(record=>headers.map(header=>record[header]??''))];};
const records=()=>[0,1].map(index=>({Name:`#AUDIT-SCAN-${index+1}`,Id:`900${index+1}`,'Financial Status':'paid','Fulfillment Status':'unfulfilled',Currency:'TWD',Subtotal:'100',Shipping:'0',Taxes:'0',Total:'100','Discount Amount':'0','Refunded Amount':'0','Outstanding Balance':'0','Lineitem quantity':'1','Lineitem name':`AUDIT source version ${index+1}`,'Lineitem price':'100','Lineitem sku':sku,'Lineitem discount':'0','Lineitem id':`gid://shopify/LineItem/${index+1}`}));
const proposal=physicalBarcode=>({skuMappings:{[sku]:{physicalBarcode,barcode:physicalBarcode,confirmed:true,barcodeConfirmed:true}}});

describe('physical barcode settings and legacy evidence',()=>{
 test.each([123,' '.repeat(3),'X'.repeat(101),'4.711299270086E+12','SCAN\nCODE'])('rejects an unsafe physical barcode: %j',physicalBarcode=>{
  expect(()=>safeSettings(proposal(physicalBarcode))).toThrow();
 });
 test('keeps the old evidence shape and fingerprint unchanged',()=>{
  const candidate=barcodeReviewCandidate({profileId:1,platform:'Shopify',shop:'moztech.myshopify.com',sourceSku:'4711299270086',sourceBarcode:'NEW4711299270086',sourceName:'晶霧貼 無貼膜神器 iPhone X/Xs/11Pro',variantIds:['gid://shopify/ProductVariant/10001'],product:{erp_sku:'4711299270086',barcode:'4711299270086',product_name:'晶霧貼 無貼膜神器',spec:'iPhone X/Xs/11Pro',active:true}});
  expect(Object.keys(reviewEvidence(candidate))).toHaveLength(12);
  expect(candidate.fingerprint).toBe('43c476df3eb8d2086e49a40226cc989123f5ccf844be00bd693c0525b6b4cc61');
  expect(reviewEvidence(candidate)).not.toHaveProperty('physicalBarcode');
  expect(safeSettings(proposal(scan)).skuMappings[sku].physicalBarcode).toBe(scan);
 });
});

describe('Shopify blank barcode physical confirmation',()=>{
 let db,pool,h;
 beforeAll(async()=>{
  db=new PGlite();
  await db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1); CREATE TABLE marketplace_store_profiles(id INTEGER PRIMARY KEY,platform TEXT,store TEXT,settings JSONB,updated_at TIMESTAMPTZ);');
  await db.query('INSERT INTO marketplace_store_profiles(id,platform,store,settings) VALUES($1,$2,$3,$4)',[profile.id,profile.platform,profile.store,profile.settings]);
  await db.exec(readFileSync(require.resolve('../migrations/038_marketplace_product_mapping_reviews.sql'),'utf8'));
 });
 beforeEach(async()=>{
  await db.exec('TRUNCATE marketplace_product_mapping_reviews RESTART IDENTITY');
  h={products:[product()],records:records(),variantIds:[...variants],barcodes:['',''],reads:[],writes:[]};
  pool={query:async(...args)=>{h.reads.push(args);if(!args[0].startsWith('SELECT'))h.writes.push(args);return db.query(...args);},connect:jest.fn(()=>{throw Error('operational transaction forbidden');})};
  h.prepare=createMarketplacePreparation({pool,
   verifyShopify:async()=>({rows:table(h.records),verification:{shop:'audit.myshopify.com',fingerprint:createHash('sha256').update(JSON.stringify([h.variantIds,h.barcodes])).digest('hex'),orders:h.records.map((record,index)=>({number:record.Name,id:record.Id,currentQuantity:1,items:[{id:record['Lineitem id'],sku:record['Lineitem sku'],variantId:h.variantIds[index],barcode:h.barcodes[index]}]}))}}),
   resolveProducts:async keys=>({products:resolveProducts(keys,h.products),sync:{source_note:'AUDIT reference'}}),
   classifyReimports:async()=>({reimports:[],fingerprint:'AUDIT reimports'})});
 });
 afterAll(async()=>{await db?.close();});
 const input=settings=>({rows:table(h.records),profileId:'1',settings:settings||{}});
 const snapshot=preview=>({items:preview.parsed.items,settings:preview.settings,sourceEvidence:preview.sourceEvidence,barcodeReviews:preview.barcodeReviews});
 const reader=async()=>({products:h.products});
 async function approve(){
  const fresh=await h.prepare(input(proposal(scan)),{refresh:true});
  const record=await confirmBarcodeReview(pool,fresh.barcodeReviewCandidates[0],actor);
  const approved=await h.prepare(input(),{refresh:true});
  return {fresh,record,approved,saved:snapshot(approved)};
 }
 test('two named versions need an explicit scan and persisted review; an API barcode stays blank',async()=>{
  const initial=await h.prepare(input());
  expect(initial.output.ok).toBe(false);expect(initial.prepick.ok).toBe(false);
  expect(initial.barcodeConflicts[0]).toMatchObject({sourceBarcode:'',physicalBarcode:'',barcodeProof:'physical-scan-v1',requiresPhysicalBarcode:true,canEnterPhysicalBarcode:true,canConfirm:false});
  const scanned=await h.prepare(input(proposal(scan)),{refresh:true});
  expect(scanned.barcodeConflicts[0]).toMatchObject({sourceBarcode:'',physicalBarcode:scan,canConfirm:true,variantIds:variants});
  expect(scanned.barcodeConflicts[0].sourceName).toContain('version 1 / AUDIT source version 2');
  expect(scanned.output.ok).toBe(false);expect(scanned.prepick.ok).toBe(false);
  expect(scanned.settings.skuMappings[sku]).toMatchObject({barcode:scan,barcodeConfirmed:false});
  expect(initial.barcodeConflicts[0].fingerprint).not.toBe(scanned.barcodeConflicts[0].fingerprint);
  const changed=await h.prepare(input(proposal('AUDIT-SCAN-002')),{refresh:true});
  expect(changed.barcodeConflicts[0].fingerprint).not.toBe(scanned.barcodeConflicts[0].fingerprint);
  expect(h.writes).toEqual([]);expect(pool.connect).not.toHaveBeenCalled();
 });
 test('an exact persisted scan is automatically reused and authorizes catalog verification without filling either master',async()=>{
  const {record,approved,saved}=await approve();
  expect(record.evidence).toMatchObject({sourceBarcode:'',erpBarcode:'',physicalBarcode:scan,barcodeProof:'physical-scan-v1'});
  expect(record.confirmed_by).toBe(1);expect(record.confirmed_at).toBeTruthy();
  expect(approved.output.ok).toBe(true);expect(approved.prepick.ok).toBe(true);expect(approved.barcodeConflicts).toEqual([]);
  expect(approved.settings.skuMappings[sku]).toMatchObject({barcode:scan,physicalBarcode:scan,barcodeConfirmed:true});
  expect(approved.sourceEvidence.verification.orders.every(order=>order.items.every(line=>line.barcode===''))).toBe(true);
  const context=await verifySavedBarcodeReviews(pool,saved,reader,{returnContext:true});
  await expect(verifyCatalogMappings(pool,saved.settings,[sku],reader,context,saved)).resolves.toBeUndefined();
  expect(h.products[0].barcode).toBe('');expect(pool.connect).not.toHaveBeenCalled();
  expect(h.writes.every(([sql])=>sql.includes('marketplace_product_mapping_reviews'))).toBe(true);
 });
 test('one valid blank version uses the same confirmation requirement',async()=>{
  h.records.pop();h.variantIds.pop();h.barcodes.pop();
  expect((await h.prepare(input())).output.ok).toBe(false);
  expect((await approve()).approved.output.ok).toBe(true);
 });
 test('a known ERP barcode requires the exact physical scan',async()=>{
  h.products[0].barcode=scan;
  const wrong=await h.prepare(input(proposal('AUDIT-SCAN-002')),{refresh:true});
  expect(wrong.output.ok).toBe(false);expect(wrong.barcodeConflicts[0].canConfirm).toBe(false);
  const {approved}=await approve();expect(approved.output.ok).toBe(true);expect(approved.barcodeReviews[0].evidence.erpBarcode).toBe(scan);
 });
 test.each(['mixed','invalidVariant','missingVariant','differentBarcodes','ambiguousErp','otherScanTarget','missingReference'])('unsafe %s cannot use physical confirmation',async change=>{
  if(change==='mixed')h.barcodes[0]=scan;
  if(change==='invalidVariant')h.variantIds[1]='gid://shopify/LineItem/102';
  if(change==='missingVariant')h.variantIds[1]='';
  if(change==='differentBarcodes')h.barcodes=[scan,'AUDIT-SCAN-002'];
  if(change==='ambiguousErp')h.products.push({...product(),erp_sku:'AUDIT-DUPLICATE',barcode:sku});
  if(change==='otherScanTarget')h.products.push({...product(),erp_sku:'AUDIT-OTHER',barcode:scan});
  if(change==='missingReference')h.products=[];
  if(change==='differentBarcodes')await expect(h.prepare(input(proposal(scan)),{refresh:true})).rejects.toMatchObject({code:'BARCODE_AMBIGUOUS'});
  else{
   const preview=await h.prepare(input(proposal(scan)),{refresh:true});expect(preview.output.ok).toBe(false);
   expect(preview.barcodeConflicts.every(candidate=>!candidate.canConfirm)).toBe(true);
  }
  expect(h.writes).toEqual([]);
 });
 test.each(['variant','sourceBarcode','name','spec','erpBarcode','inactive','duplicateScan','revoked'])('persisted scans become blocked when current %s changes',async change=>{
  const {record}=await approve();
  if(change==='variant')h.variantIds[1]='gid://shopify/ProductVariant/999';
  if(change==='sourceBarcode')h.barcodes[1]=scan;
  if(change==='name')h.records[1]['Lineitem name']='AUDIT different source name';
  if(change==='spec')h.products[0].spec='AUDIT different specification';
  if(change==='erpBarcode')h.products[0].barcode=scan;
  if(change==='inactive')h.products[0].active=false;
  if(change==='duplicateScan')h.products.push({...product(),erp_sku:'AUDIT-OTHER',barcode:scan});
  if(change==='revoked')await revokeBarcodeReview(pool,record.id,actor);
  const preview=await h.prepare(input(),{refresh:true});expect(preview.output.ok).toBe(false);expect(preview.barcodeReviews).toEqual([]);
 });
 test.each(['sourceBarcode','missingVariant','unknownVariant','sourceLine','sourceName','mapping','physicalMapping','filledErp','otherTarget','missingReference'])('saved downloads reject altered %s',async change=>{
  const {saved}=await approve();
  if(change==='sourceBarcode')saved.sourceEvidence.verification.orders[0].items[0].barcode=scan;
  if(change==='missingVariant')delete saved.sourceEvidence.verification.orders[0].items[0].variantId;
  if(change==='unknownVariant')saved.sourceEvidence.verification.orders[0].items[0].variantId='gid://shopify/ProductVariant/999';
  if(change==='sourceLine')saved.items[0].sourceLineId='gid://shopify/LineItem/999';
  if(change==='sourceName')saved.items[0].productName='AUDIT changed source name';
  if(change==='mapping')saved.settings.skuMappings[sku].barcode='AUDIT wrong scan';
  if(change==='physicalMapping')saved.settings.skuMappings[sku].physicalBarcode='AUDIT wrong scan';
  if(change==='filledErp')h.products[0].barcode=scan;
  if(change==='otherTarget')h.products.push({...product(),erp_sku:'AUDIT-OTHER',barcode:scan});
  await expect(verifySavedBarcodeReviews(pool,saved,change==='missingReference'?async()=>null:reader)).rejects.toMatchObject({status:400});
 });
 test('clearing or changing a scan cannot borrow the persisted scan approval',async()=>{
  await approve();
  for(const value of ['', 'AUDIT-SCAN-002']){
   const preview=await h.prepare(input(proposal(value)),{refresh:true});
   expect(preview.output.ok).toBe(false);expect(preview.barcodeReviews).toEqual([]);
  }
 });
 test.each(['ecount','ecount-grouped','prepick'])('a failed physical review blocks the actual %s download endpoint',async kind=>{
  const {saved}=await approve(),oldSecret=process.env.JWT_SECRET;
  process.env.JWT_SECRET='AUDIT-download-secret';
  const service=require('../src/services/marketplaceBarcodeReviews');
  const verification=jest.spyOn(service,'verifySavedBarcodeReviews').mockRejectedValue(Object.assign(new Error('AUDIT missing reference'),{status:400,code:'BARCODE_REVIEW_UNAVAILABLE'}));
  try{
   const token=jwt.sign({downloadActor:1,intakeId:1,kind},process.env.JWT_SECRET,{algorithm:'HS256',audience:'wms-marketplace-file',expiresIn:120});
   const readOnlyPool={query:jest.fn(async sql=>({rows:sql.includes('SELECT role FROM users')?[{role:'dispatcher'}]:[{id:1,snapshot:saved,source_platform:'Shopify'}]}))};
   const res={status:jest.fn(),send:jest.fn()};res.status.mockReturnValue(res);
   await downloadFile({pool:readOnlyPool})({params:{id:'1',kind},headers:{cookie:`wms_marketplace_download=${token}`}},res,jest.fn());
   expect(res.status).toHaveBeenCalledWith(400);expect(res.send).toHaveBeenCalledWith('AUDIT missing reference');
   expect(readOnlyPool.query.mock.calls.every(([sql])=>sql.startsWith('SELECT'))).toBe(true);
  }finally{
   verification.mockRestore();if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;
  }
 });
 test('the confirmation route pins the fresh scan and source; forged old hashes and checkbox omissions cannot write',async()=>{
  const app=express();app.use(express.json());app.use((req,res,next)=>{req.user=actor;next();});
  app.use('/api/marketplace-intakes',createMarketplaceRouter({pool,prepareMarketplace:h.prepare}));
  const scanned=await h.prepare(input(proposal(scan)),{refresh:true});
  const body={...input(proposal(scan)),verificationFingerprint:scanned.verification.currentFingerprint,confirmation:{fingerprint:scanned.barcodeConflicts[0].fingerprint,confirmed:true}};
  const changed={...body,settings:proposal('AUDIT-SCAN-002')};
  expect((await request(app).post('/api/marketplace-intakes/barcode-confirmations').send(changed)).status).toBe(409);
  expect((await request(app).post('/api/marketplace-intakes/barcode-confirmations').send({...body,confirmation:{...body.confirmation,confirmed:false}})).status).toBe(400);
  const accepted=await request(app).post('/api/marketplace-intakes/barcode-confirmations').send(body);
  expect(accepted.status).toBe(201);expect((await h.prepare(input(),{refresh:true})).output.ok).toBe(true);
  expect(h.writes).toHaveLength(1);expect(pool.connect).not.toHaveBeenCalled();
 });
});
