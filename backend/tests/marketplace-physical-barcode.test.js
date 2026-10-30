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

describe('uploaded eligible barcode prerequisites stay separate from new-sales scope',()=>{
 let db,pool,h;
 beforeAll(async()=>{
  db=new PGlite();
  await db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1); CREATE TABLE marketplace_store_profiles(id INTEGER PRIMARY KEY,platform TEXT,store TEXT,settings JSONB,updated_at TIMESTAMPTZ); CREATE TABLE order_items(barcode TEXT);');
  await db.query('INSERT INTO marketplace_store_profiles VALUES($1,$2,$3,$4,NOW())',[profile.id,profile.platform,profile.store,profile.settings]);
  for(const name of ['038_marketplace_product_mapping_reviews.sql','039_order_item_scan_identity.sql'])await db.exec(readFileSync(require.resolve('../migrations/'+name),'utf8'));
 });
 beforeEach(async()=>{
  await db.exec('TRUNCATE marketplace_product_mapping_reviews,marketplace_internal_scan_codes RESTART IDENTITY');
  h={records:records(),products:[product()],variants:[...variants],barcodes:[sku,sku],saved:new Set(['#AUDIT-SCAN-2']),writes:[],transactions:[],rejectProjection:false};
  const query=async(...args)=>{if(!args[0].startsWith('SELECT'))h.writes.push(args);if(h.rejectProjection&&args[0].startsWith('INSERT INTO marketplace_product_mapping_reviews')&&JSON.parse(args[2]||args[1]?.[2]||'null')?.variantIds?.length===1)throw Error('AUDIT reject projected insert');return db.query(...args);};
  pool={query,connect:jest.fn(async()=>({query:async(...args)=>{h.transactions.push(args[0]);if(args[0].startsWith('SET LOCAL'))return {rows:[]};const result=await query(...args);if(args[0]==='COMMIT'&&h.loseCommitAck){h.loseCommitAck=false;throw Error('AUDIT commit acknowledgement lost');}return result;},release:h.release=jest.fn()}))};
  h.prepare=createMarketplacePreparation({pool,verifyShopify:async()=>({rows:table(h.records),verification:{version:'shopify-current-v2',platform:'Shopify',shop:'audit.myshopify.com',fingerprint:createHash('sha256').update(JSON.stringify([h.records,h.variants,h.barcodes])).digest('hex'),orders:h.records.map((r,i)=>({number:r.Name,id:r.Id,cancelled:Boolean(r['Cancelled at']),fulfillmentStatus:r['Fulfillment Status'],paymentStatus:r['Financial Status'],currentQuantity:Number(r['Lineitem quantity']),remainingQuantity:Number(r['Lineitem quantity']),totalMinor:Number(r.Total)*100,receivedMinor:Number(r.Total)*100,outstandingMinor:0,items:[{id:r['Lineitem id'],sku:r['Lineitem sku'],name:r['Lineitem name'],quantity:Number(r['Lineitem quantity']),unfulfilledQuantity:Number(r['Lineitem quantity']),variantId:h.variants[i],barcode:h.barcodes[i]}]}))}}),resolveProducts:async keys=>({products:resolveProducts(keys,h.products)}),classifyReimports:async()=>({reimports:[...h.saved].map(orderNumber=>({orderNumber,intakeId:100,state:'pending',message:'AUDIT saved'})),fingerprint:JSON.stringify([...h.saved].sort())})});
 });
 afterAll(async()=>db?.close());
 const input=settings=>({rows:table(h.uploadRecords||h.records),profileId:'1',settings:settings||{}});
 const reader=async()=>({products:h.products});
 function app(){const app=express();app.use(express.json());app.use((req,res,next)=>{req.user=actor;next();});app.use('/api/marketplace-intakes',createMarketplaceRouter({pool,prepareMarketplace:h.prepare}));app.use((error,req,res,next)=>res.status(error.status||500).json({code:error.code,message:error.message}));return app;}
 async function confirm(preview,settings){return request(app()).post('/api/marketplace-intakes/barcode-confirmations').send({...input(settings),verificationFingerprint:preview.verification.currentFingerprint,confirmation:{fingerprint:preview.barcodeConflicts[0].fingerprint,confirmed:true}});}
 function snapshot(preview){return {platform:'Shopify',summary:preview.output.summary,items:preview.parsed.items,orders:preview.parsed.orders.map(order=>({...order,sourceFinancial:preview.raw.orders.find(raw=>raw.sourceOrderNumber===order.sourceOrderNumber).financial})),settings:preview.settings,sourceEvidence:preview.sourceEvidence,barcodeReviews:preview.barcodeReviews,headers:preview.output.headers,rows:preview.output.rows,prepick:preview.prepick,...(preview.output.salesLayout?{salesLayout:preview.output.salesLayout}:{}),...(preview.output.rounding?{rounding:preview.output.rounding}:{})};}
 test('pure reimports expose the same complete eligible candidate as overwrite without reviving new sales',async()=>{
  h.saved=new Set(h.records.map(r=>r.Name));const normal=await h.prepare(input()),draft=await h.prepare(input(),{overwriteOrderNumbers:[...h.saved]});
  expect(normal.parsed.orders).toHaveLength(0);expect(normal.newOrderCount).toBe(0);
  expect(normal.barcodeConflicts).toHaveLength(1);expect(normal.barcodeConflicts[0].canConfirm).toBe(true);
  expect(normal.barcodeConflicts[0].fingerprint).toBe(draft.barcodeConflicts[0].fingerprint);
  expect(normal.verification.currentFingerprint).toBe(draft.verification.currentFingerprint);
  expect(normal.barcodeScope).toMatchObject({version:'uploaded-eligible-v1',orderCount:2,itemCount:2});expect(normal.barcodeScope.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(h.writes).toEqual([]);expect(pool.connect).not.toHaveBeenCalled();
  expect((await confirm(normal)).status).toBe(201);expect(pool.connect).not.toHaveBeenCalled();const reviewed=await h.prepare(input(),{refresh:true});expect(reviewed.barcodeConflicts).toEqual([]);expect(reviewed.newOrderCount).toBe(0);const reviewedDraft=await h.prepare(input(),{overwriteOrderNumbers:[...h.saved]});expect(reviewedDraft.output.ok).toBe(true);await expect(verifySavedBarcodeReviews(pool,snapshot(reviewedDraft),reader)).resolves.toBeUndefined();expect((await db.query('SELECT * FROM marketplace_product_mapping_reviews')).rows).toHaveLength(1);
 });
 test('a problem SKU existing only in a saved order is still actionable before entering comparison',async()=>{
  h.records.push({...h.records[1],Name:'#AUDIT-SCAN-3',Id:'9003','Lineitem id':'gid://shopify/LineItem/3'});h.variants.push('gid://shopify/ProductVariant/103');h.barcodes.push(sku);h.saved.add('#AUDIT-SCAN-3');
  h.records[0]['Lineitem sku']='AUDIT-CLEAN';h.products.push({...product(),erp_sku:'AUDIT-CLEAN',barcode:'AUDIT-CLEAN'});h.barcodes[0]='AUDIT-CLEAN';
  const preview=await h.prepare(input());expect(preview.newOrderCount).toBe(1);expect(preview.parsed.items.map(i=>i.sku)).toEqual(['AUDIT-CLEAN']);
  expect(preview.barcodeConflicts).toHaveLength(1);expect(preview.barcodeConflicts[0]).toMatchObject({sourceSku:sku,canConfirm:true,relatedOrders:[{orderNumber:'#AUDIT-SCAN-2'},{orderNumber:'#AUDIT-SCAN-3'}]});
 });
 test.each(['api','physical','internal'])('%s confirmation atomically records the complete identity and exact new-sales projection, and both snapshots still validate',async kind=>{
  const settings=kind==='physical'?proposal(scan):kind==='internal'?{skuMappings:{[sku]:{scanCodeType:'internal',internalScanCode:'ITM-AUDIT-SCOPE'}}}:{};
  if(kind!=='api')h.barcodes=['',''];
  const preview=await h.prepare(input(settings));expect(preview.barcodeConflicts[0].variantIds).toEqual(variants);
  expect((await confirm(preview,settings)).status).toBe(201);
  const stored=(await db.query('SELECT * FROM marketplace_product_mapping_reviews ORDER BY id')).rows;
  expect(stored).toHaveLength(2);expect(stored.map(r=>r.evidence.variantIds)).toEqual([variants,[variants[0]]]);
  expect(h.transactions).toContain('BEGIN');expect(h.transactions).toContain('COMMIT');
  const approved=await h.prepare(input(settings),{refresh:true});expect(approved.barcodeConflicts).toEqual([]);expect(approved.output.ok).toBe(true);
  expect(approved.newOrderCount).toBe(1);expect(approved.parsed.orders.map(o=>o.sourceOrderNumber)).toEqual(['#AUDIT-SCAN-1']);expect(approved.parsed.items).toHaveLength(1);
  expect(approved.barcodeReviews).toHaveLength(1);expect(approved.barcodeReviews[0].evidence.variantIds).toEqual([variants[0]]);
  const context=await verifySavedBarcodeReviews(pool,snapshot(approved),reader,{returnContext:true});await expect(verifyCatalogMappings(pool,approved.settings,[sku],reader,context,snapshot(approved))).resolves.toBeUndefined();
  const draft=await h.prepare(input(settings),{refresh:true,overwriteOrderNumbers:h.records.map(r=>r.Name)});expect(draft.output.ok).toBe(true);expect(draft.barcodeReviews).toHaveLength(1);expect(draft.barcodeReviews[0].evidence.variantIds).toEqual(variants);
  await expect(verifySavedBarcodeReviews(pool,snapshot(draft),reader)).resolves.toBeUndefined();
  const {savedBatchTables}=await import('../src/services/marketplaceBatchFiles.mjs');const tables=savedBatchTables(snapshot(approved),'ecount');expect(tables[0].rows.length).toBeGreaterThan(1);
  expect(h.writes.every(([sql])=>/^(BEGIN|COMMIT)$/.test(sql)||sql.startsWith('INSERT INTO marketplace_product_mapping_reviews')||sql.startsWith('INSERT INTO marketplace_internal_scan_codes'))).toBe(true);
 });
 test.each(['api','physical','internal'])('%s one confirmation also authorizes only the safe complete CSV name/quantity projection',async kind=>{
  h.records.forEach(record=>{record['Lineitem quantity']='2';record.Subtotal='200';record.Total='200';});h.uploadRecords=h.records.map((record,index)=>({...record,'Lineitem name':'AUDIT operator label '+index,'Lineitem quantity':'1',Subtotal:'100',Total:'100'}));
  if(kind!=='api')h.barcodes=['',''];const settings=kind==='physical'?proposal(scan):kind==='internal'?{skuMappings:{[sku]:{scanCodeType:'internal',internalScanCode:'ITM-AUDIT-SCOPE'}}}:{};
  // The synthetic API fixture reports the live quantity independently of CSV.
  const preview=await h.prepare(input(settings));expect((await confirm(preview,settings)).status).toBe(201);
  const normal=await h.prepare(input(settings),{refresh:true}),draft=await h.prepare(input(settings),{refresh:true,overwriteOrderNumbers:h.records.map(record=>record.Name)});
  expect(normal.barcodeConflicts).toEqual([]);expect(draft.barcodeConflicts).toEqual([]);expect(normal.parsed.items[0].quantity).toBe(2);expect(draft.parsed.items.map(item=>item.quantity)).toEqual([1,1]);expect(draft.parsed.items.map(item=>item.productName)).toEqual(['AUDIT operator label 0','AUDIT operator label 1']);
  await expect(verifySavedBarcodeReviews(pool,snapshot(normal),reader)).resolves.toBeUndefined();await expect(verifySavedBarcodeReviews(pool,snapshot(draft),reader)).resolves.toBeUndefined();expect((await db.query('SELECT * FROM marketplace_product_mapping_reviews')).rows).toHaveLength(3);
 });
 test('a changed CSV cannot borrow the old complete-upload confirmation fingerprint',async()=>{
  const preview=await h.prepare(input());h.uploadRecords=h.records.map(record=>({...record,'Lineitem name':'AUDIT changed after preview'}));const response=await confirm(preview);expect(response.status).toBe(409);expect((await db.query('SELECT * FROM marketplace_product_mapping_reviews')).rows).toEqual([]);
 });
 test('a failed exact projection insert rolls back the complete approval too',async()=>{
  const preview=await h.prepare(input());h.rejectProjection=true;const response=await confirm(preview);
  expect(response.status).toBe(500);expect((await db.query('SELECT * FROM marketplace_product_mapping_reviews')).rows).toEqual([]);expect(h.transactions).toContain('ROLLBACK');
 });
 test('lost review commit acknowledgement returns unknown, discards the connection and same proof retry reads exactly two records',async()=>{
  const preview=await h.prepare(input());h.loseCommitAck=true;const first=await confirm(preview);expect(first.status).toBe(503);expect(first.body.code).toBe('BARCODE_REVIEW_RESULT_UNKNOWN');expect(h.release).toHaveBeenCalledWith(true);expect((await db.query('SELECT * FROM marketplace_product_mapping_reviews')).rows).toHaveLength(2);
  const repeated=await confirm(preview);expect(repeated.status).toBe(201);expect((await db.query('SELECT * FROM marketplace_product_mapping_reviews')).rows).toHaveLength(2);expect(h.transactions).toContain("SET LOCAL lock_timeout='2000ms'");expect(h.transactions).toContain("SET LOCAL statement_timeout='10000ms'");
 });
 test('the real download handler revalidates the persisted sales-subset proof and generates only one new-order quantity',async()=>{
  const preview=await h.prepare(input());expect((await confirm(preview)).status).toBe(201);const approved=await h.prepare(input(),{refresh:true}),saved=snapshot(approved),record={id:101,batch_number:'AUDIT-NEW-ONLY',source_platform:'Shopify',source_store:profile.store,snapshot:saved};
  const reviewService=require('../src/services/marketplaceBarcodeReviews'),catalogService=require('../src/services/marketplaceProductCatalog');
  const actualReview=verifySavedBarcodeReviews,actualCatalog=verifyCatalogMappings;
  const reviewSpy=jest.spyOn(reviewService,'verifySavedBarcodeReviews').mockImplementation((db,current,unused,options)=>actualReview(db,current,reader,options));
  const catalogSpy=jest.spyOn(catalogService,'verifyCatalogMappings').mockImplementation((db,current,skus,unused,context,currentSnapshot)=>actualCatalog(db,current,skus,reader,context,currentSnapshot));
  const readPool={query:jest.fn(async(sql,args)=>{
   if(sql.startsWith('SELECT role FROM users'))return {rows:[{role:'dispatcher'}]};
   if(sql.startsWith('SELECT * FROM marketplace_intakes'))return {rows:[record]};
   if(sql.startsWith('SELECT EXISTS('))return {rows:[{borrowed:false}]};
   if(sql.includes('marketplace_product_mapping_reviews')||sql.includes('marketplace_internal_scan_codes'))return db.query(sql,args);
   return {rows:[]};
  })};
  const oldSecret=process.env.JWT_SECRET;process.env.JWT_SECRET='AUDIT-SUBSET-DOWNLOAD-ONLY';
  try{
   const token=jwt.sign({downloadActor:1,intakeId:101,kind:'ecount'},process.env.JWT_SECRET,{algorithm:'HS256',audience:'wms-marketplace-file',expiresIn:120});
   const response={statusCode:200,body:null,set:jest.fn(),status(code){this.statusCode=code;return this;},send(body){this.body=body;return this;}};response.set.mockReturnValue(response);
   await downloadFile({pool:readPool})({params:{id:'101',kind:'ecount'},headers:{cookie:'wms_marketplace_download='+token}},response,error=>{throw error;});
   expect(response.statusCode).toBe(200);expect(Buffer.isBuffer(response.body)).toBe(true);const XLSX=require('xlsx'),book=XLSX.read(response.body),rows=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1});expect(rows.slice(1).reduce((sum,row)=>sum+row[rows[0].indexOf('數量')],0)).toBe(1);
   expect(reviewSpy).toHaveBeenCalled();expect(catalogSpy).toHaveBeenCalled();expect(readPool.query.mock.calls.every(([sql])=>sql.startsWith('SELECT'))).toBe(true);
  }finally{reviewSpy.mockRestore();catalogSpy.mockRestore();if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;}
 });
 test('a previously complete-only review is explicitly confirmed again to fill the missing exact projection idempotently',async()=>{
  const preview=await h.prepare(input());await confirmBarcodeReview(pool,preview.barcodeConflicts[0],actor);
  const missing=await h.prepare(input());expect(missing.barcodeConflicts).toHaveLength(1);
  const first=await confirm(missing),second=await confirm(missing);expect(first.status).toBe(201);expect(second.status).toBe(201);expect(first.body.id).toBe(second.body.id);expect((await db.query('SELECT * FROM marketplace_product_mapping_reviews')).rows).toHaveLength(2);
 });
 test('inconsistent existing subset evidence rejects and rolls back the newly inserted full approval',async()=>{
  const preview=await h.prepare(input()),projection=preview.barcodeReviewCandidates[0].confirmationCandidates[1];
  const record=await confirmBarcodeReview(pool,projection,actor);await db.query('UPDATE marketplace_product_mapping_reviews SET evidence=$1 WHERE id=$2',[{...record.evidence,sourceName:'AUDIT inconsistent persisted label'},record.id]);
  const response=await confirm(preview);expect(response.status).toBe(409);expect(response.body.code).toBe('BARCODE_REVIEW_CHANGED');const stored=(await db.query('SELECT * FROM marketplace_product_mapping_reviews')).rows;expect(stored).toHaveLength(1);expect(stored[0].fingerprint).toBe(projection.fingerprint);expect(h.transactions).toContain('ROLLBACK');
 });
 test('client scope/order/confirmation projection injection never expands the server-derived proofs',async()=>{
  const preview=await h.prepare(input()),response=await request(app()).post('/api/marketplace-intakes/barcode-confirmations').send({...input(),overwriteOrderNumbers:['#FOREIGN'],barcodeScope:{orderNumbers:['#FOREIGN']},verificationFingerprint:preview.verification.currentFingerprint,confirmation:{fingerprint:preview.barcodeConflicts[0].fingerprint,confirmed:true,confirmationCandidates:[{sourceSku:'FOREIGN',variantIds:['gid://shopify/ProductVariant/999']}]}});
  expect(response.status).toBe(201);const stored=(await db.query('SELECT * FROM marketplace_product_mapping_reviews')).rows;expect(stored).toHaveLength(2);expect(stored.every(record=>record.evidence.sourceSku===sku)).toBe(true);expect(JSON.stringify(stored)).not.toContain('999');const normal=await h.prepare({...input(),overwriteOrderNumbers:['#AUDIT-SCAN-2']});expect(normal.newOrderCount).toBe(1);expect(normal.parsed.orders[0].sourceOrderNumber).toBe('#AUDIT-SCAN-1');
 });
 test.each(['api','physical','internal'])('%s duplicate Shopify line identity across orders cannot authorize either scope',async kind=>{
  h.records[1]['Lineitem id']=h.records[0]['Lineitem id'];if(kind!=='api')h.barcodes=['',''];const settings=kind==='physical'?proposal(scan):kind==='internal'?{skuMappings:{[sku]:{scanCodeType:'internal',internalScanCode:'ITM-AUDIT-SCOPE'}}}:{};
  const preview=await h.prepare(input(settings));expect(preview.output.ok).toBe(false);expect(preview.barcodeConflicts.every(candidate=>!candidate.canConfirm)).toBe(true);expect((await confirm(preview,settings)).status).toBe(400);expect((await db.query('SELECT * FROM marketplace_product_mapping_reviews')).rows).toEqual([]);
 });
 test.each(['barcode','variant','target','profile'])('fresh %s drift rejects old scope without approval writes',async changed=>{
  const preview=await h.prepare(input());
  if(changed==='barcode')h.barcodes=[scan,scan];if(changed==='variant')h.variants[1]='gid://shopify/ProductVariant/999';if(changed==='target')h.products[0].spec='AUDIT changed spec';if(changed==='profile')await db.query('UPDATE marketplace_store_profiles SET store=$1 WHERE id=1',['AUDIT changed store']);
  try{const response=await confirm(preview);expect(response.status).toBe(409);expect((await db.query('SELECT * FROM marketplace_product_mapping_reviews')).rows).toEqual([]);}finally{if(changed==='profile')await db.query('UPDATE marketplace_store_profiles SET store=$1 WHERE id=1',[profile.store]);}
 });
 test('different API barcodes across saved/new lines remain ambiguous rather than being approved by SKU',async()=>{
  h.barcodes[1]=scan;await expect(h.prepare(input())).rejects.toMatchObject({code:'BARCODE_AMBIGUOUS'});expect(h.writes).toEqual([]);
 });
 test.each(['cancelled','fulfilled'])('%s saved products cannot add candidates or variant identity',async state=>{
  if(state==='cancelled'){h.records.forEach(record=>record['Cancelled at']='');h.records[1]['Cancelled at']='2026-10-30';}else h.records[1]['Fulfillment Status']='fulfilled';
  const preview=await h.prepare(input());expect(preview.barcodeConflicts).toEqual([]);expect(preview.barcodeScope.itemCount).toBe(1);
 });
 test('a normal exact barcode path keeps old caller data and requires no review transaction',async()=>{
  h.products[0].barcode=sku;h.variants[1]=variants[0];const preview=await h.prepare(input());expect(preview.output.ok).toBe(true);expect(preview.barcodeConflicts).toEqual([]);expect(preview.newOrderCount).toBe(1);expect(pool.connect).not.toHaveBeenCalled();
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
   const readOnlyPool={query:jest.fn(async sql=>({rows:sql.includes('SELECT role FROM users')?[{role:'dispatcher'}]:sql.startsWith('SELECT * FROM marketplace_intakes')?[{id:1,snapshot:saved,source_platform:'Shopify'}]:sql.startsWith('SELECT EXISTS(')?[{borrowed:false}]:[]}))};
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
