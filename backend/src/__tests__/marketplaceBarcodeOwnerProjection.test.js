// Anonymous, disposable PGlite only. Real preparation, review, mixed transaction
// and saved-source validators are exercised; no native concurrency is claimed.
const fs=require('node:fs');
const {createHash,randomUUID}=require('node:crypto');
const express=require('express'),request=require('supertest');
const {PGlite}=require('@electric-sql/pglite');
const {createMarketplacePreparation}=require('../services/marketplacePreparation');
const {createMarketplaceDraftOverwriteService}=require('../services/marketplaceDraftOverwrite');
const {createMarketplaceRouter}=require('../routes/marketplaceRoutes');
const catalog=require('../services/marketplaceProductCatalog');
const reviews=require('../services/marketplaceBarcodeReviews');
const actualReview=reviews.verifySavedBarcodeReviews,actualCatalog=catalog.verifyCatalogMappings;
const actor={id:1,role:'dispatcher',name:'Anonymous operator'};
const SKU='ANON-OWNER-SKU',OTHER='ANON-UNCHANGED-SKU';
const profile={id:1,platform:'Shopify',store:'Anonymous store',settings:{store:'Anonymous store',customerCode:'ANON-CUSTOMER',customerName:'Anonymous store',warehouseCode:'003',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,shippingSku:{erpSku:'00001',name:'Shipping',confirmed:true,nonStock:true}}};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const table=records=>{const headers=[...new Set(records.flatMap(Object.keys))];return [headers,...records.map(record=>headers.map(key=>record[key]??''))];};
const objects=rows=>rows.slice(1).map(values=>Object.fromEntries(rows[0].map((key,index)=>[key,values[index]])));
const row=(number,line,extra={})=>({Name:number,Id:String(9000+number.charCodeAt(number.length-1)),'Financial Status':'paid','Fulfillment Status':'unfulfilled',Currency:'TWD',Subtotal:'100',Shipping:'0',Taxes:'0',Total:'100','Discount Amount':'0','Refunded Amount':'0','Outstanding Balance':'0','Payment Method':'credit_card','Lineitem quantity':'1','Lineitem name':'Anonymous variant '+line,'Lineitem price':'100','Lineitem sku':SKU,'Lineitem discount':'0','Lineitem id':`gid://shopify/LineItem/${line}`,...extra});
const variant=line=>'gid://shopify/ProductVariant/'+(1000+Number(line.split('/').pop()));
function snapshot(conversion){return {platform:'Shopify',handler:{userId:2,name:'Anonymous original operator'},settings:conversion.settings,sourceEvidence:conversion.sourceEvidence,barcodeReviews:conversion.barcodeReviews,summary:conversion.output.summary,headers:conversion.output.headers,rows:conversion.output.rows,reportHeaders:conversion.output.reportHeaders,reportRows:conversion.output.reportRows,orders:conversion.parsed.orders.map(order=>({...order,sourceFinancial:conversion.raw.orders.find(raw=>raw.sourceOrderNumber===order.sourceOrderNumber).financial})),items:conversion.parsed.items,prepick:conversion.prepick,...(conversion.output.salesLayout?{salesLayout:conversion.output.salesLayout}:{}),...(conversion.output.rounding?{rounding:conversion.output.rounding}:{})};}

async function setup(){
 const db=new PGlite();
 await db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT);INSERT INTO users VALUES(1,'dispatcher'),(2,'dispatcher');
 CREATE TABLE marketplace_intakes(id SERIAL PRIMARY KEY,batch_number TEXT UNIQUE,source_platform TEXT,source_store TEXT,fingerprint TEXT UNIQUE,created_by INTEGER REFERENCES users(id),created_at TIMESTAMPTZ DEFAULT NOW(),snapshot JSONB,archived_at TIMESTAMPTZ);
 CREATE TABLE marketplace_intake_orders(id SERIAL PRIMARY KEY,intake_id INTEGER REFERENCES marketplace_intakes(id),source_platform TEXT,source_store TEXT,source_order_number TEXT,expected_items JSONB,nonstock_items JSONB DEFAULT '[]',financial JSONB,work_barcode TEXT UNIQUE,UNIQUE(source_platform,source_store,source_order_number));
 CREATE TABLE marketplace_warehouse_flows(intake_id INTEGER PRIMARY KEY REFERENCES marketplace_intakes(id),enabled_by INTEGER,enabled_at TIMESTAMPTZ DEFAULT NOW(),erp_receipt JSONB,erp_confirmed_by INTEGER,erp_confirmed_at TIMESTAMPTZ,import_batch_id INTEGER,print_owner_id INTEGER,printed_at TIMESTAMPTZ,prepick_owner_id INTEGER,prepick_completed_at TIMESTAMPTZ,prepick_counts JSONB DEFAULT '{}');
 CREATE TABLE marketplace_work_order_links(intake_order_id INTEGER PRIMARY KEY,order_id INTEGER);
 CREATE TABLE orders(id SERIAL PRIMARY KEY,source_platform TEXT,source_store TEXT,source_order_number TEXT,import_batch_id INTEGER,work_barcode TEXT,status TEXT);
 CREATE TABLE order_items(barcode TEXT);
 CREATE TABLE warehouse_import_batches(id SERIAL PRIMARY KEY,voucher_number TEXT);
 CREATE TABLE marketplace_warehouse_events(id SERIAL PRIMARY KEY,intake_id INTEGER,action TEXT);
 CREATE TABLE marketplace_store_profiles(id INTEGER PRIMARY KEY,platform TEXT,store TEXT,settings JSONB,updated_at TIMESTAMPTZ DEFAULT NOW());`);
 for(const name of ['038_marketplace_product_mapping_reviews.sql','039_order_item_scan_identity.sql','041_marketplace_draft_revisions.sql','042_marketplace_upload_scopes.sql'])await db.exec(fs.readFileSync(require.resolve('../../migrations/'+name),'utf8'));
 await db.query('INSERT INTO marketplace_store_profiles(id,platform,store,settings) VALUES(1,$1,$2,$3)',['Shopify',profile.store,profile.settings]);
 const h={db,api:new Map(),calls:[],active:false,failSql:null,beforeConnect:null,commitAckLost:false,products:[{erp_sku:SKU,barcode:'',product_name:'Anonymous ERP item',spec:'Anonymous exact model',active:true},{erp_sku:OTHER,barcode:OTHER,product_name:'Anonymous unchanged item',spec:'',active:true}]};
 const query=async(sql,args=[])=>{
  h.calls.push([sql,clone(args)]);
  if(sql.includes('pg_advisory_xact_lock'))return {rows:[{}]};
  if(h.failSql?.(sql,args))throw Error('Anonymous forced SQL failure');
  if(sql==='BEGIN')h.active=true;
  const result=await db.query(sql,args);
  if(sql==='COMMIT'||sql==='ROLLBACK')h.active=false;
  if(sql==='COMMIT'&&h.commitAckLost){h.commitAckLost=false;throw Error('Anonymous lost commit acknowledgement');}
  return result;
 };
 h.pool={query:async(sql,args)=>{
  // A pool read cannot see records inserted by a different active transaction.
  // PGlite has one physical connection, so enforce this visibility boundary.
  if(h.active&&sql.includes('FROM marketplace_product_mapping_reviews'))throw Error('Pool read escaped active review transaction');
  return query(sql,args);
 },connect:async()=>{if(h.beforeConnect){const hook=h.beforeConnect;h.beforeConnect=null;await hook();}return {query,release(){}};}};
 h.reader=async()=>({products:h.products});
 h.validate=async(current,connection=h.pool)=>{const context=await actualReview(connection,current,h.reader,{returnContext:true});await actualCatalog(connection,current.settings,[...new Set(current.items.map(item=>item.sku))],h.reader,context,current);};
 h.prepare=createMarketplacePreparation({pool:h.pool,resolveProducts:async keys=>({products:catalog.resolveProducts(keys,h.products)}),classifyReimports:async({raw})=>{
  const numbers=raw.orders.map(order=>order.sourceOrderNumber),sources=(await db.query('SELECT * FROM marketplace_intake_orders WHERE source_order_number=ANY($1::text[]) ORDER BY id',[numbers])).rows;
  return {reimports:sources.map(source=>({orderNumber:source.source_order_number,intakeId:source.intake_id,state:'pending'})),fingerprint:hash(sources)};
 },verifyShopify:async sourceRows=>{
  const numbers=[...new Set(objects(sourceRows).map(record=>record.Name))],records=numbers.flatMap(number=>clone(h.api.get(number)||[]));
  const orders=numbers.map(number=>{
   const selected=records.filter(record=>record.Name===number),first=selected[0],quantity=selected.reduce((sum,record)=>sum+Number(record['Lineitem quantity']),0);
   const current={number,id:first.Id,cancelled:false,cancelledAt:null,currency:'TWD',fulfillmentStatus:'unfulfilled',paymentStatus:'paid',currentQuantity:quantity,remainingQuantity:quantity,totalMinor:Number(first.Total)*100,subtotalMinor:Number(first.Subtotal)*100,shippingMinor:0,discountMinor:0,productDiscountMinor:0,receivedMinor:Number(first.Total)*100,outstandingMinor:0,removedLineIds:[],items:selected.map(record=>({id:record['Lineitem id'],sku:record['Lineitem sku'],name:record['Lineitem name'],quantity:Number(record['Lineitem quantity']),unfulfilledQuantity:Number(record['Lineitem quantity']),variantId:variant(record['Lineitem id']),barcode:h.barcodeFor?h.barcodeFor(record):record['Lineitem sku'],netMinor:Number(record['Lineitem price'])*100*Number(record['Lineitem quantity'])}))};
   return h.mutateEvidence?h.mutateEvidence(current):current;
  });
  return {rows:table(records),verification:{version:'shopify-current-v2',platform:'Shopify',shop:'anonymous-owner.myshopify.com',fingerprint:hash([records,orders]),orders}};
 }});
 h.app=()=>{const app=express();app.use(express.json());app.use((req,res,next)=>{req.user=actor;next();});app.use('/api/marketplace-intakes',createMarketplaceRouter({pool:h.pool,prepareMarketplace:h.prepare}));app.use((error,req,res,next)=>res.status(error.status||500).json({code:error.code,message:error.message}));return app;};
 h.input=records=>({rows:table(records),profileId:'1',settings:{date:'2026-10-30',batchNumber:'TEST-ANON-UPLOAD',...h.inputSettings}});
 h.approve=async records=>{
  const input=h.input(records),preview=await h.prepare(input,{refresh:true});
  for(const conflict of preview.barcodeConflicts){const response=await request(h.app()).post('/api/marketplace-intakes/barcode-confirmations').send({...input,verificationFingerprint:preview.verification.currentFingerprint,confirmation:{fingerprint:conflict.fingerprint,confirmed:true}});expect(response.status).toBe(201);}
  const approved=await h.prepare(input,{refresh:true});expect(approved.barcodeConflicts).toEqual([]);return approved;
 };
 h.addBatch=async(records,name)=>{
  for(const number of new Set(records.map(record=>record.Name)))h.api.set(number,records.filter(record=>record.Name===number));
  const approved=await h.approve(records),saved=snapshot(approved);saved.settings.batchNumber=name;
  await h.validate(saved);
  const batch=(await db.query('INSERT INTO marketplace_intakes(batch_number,source_platform,source_store,fingerprint,created_by,snapshot) VALUES($1,$2,$3,$4,2,$5) RETURNING *',[name,'Shopify',profile.store,name,saved])).rows[0];
  for(const order of saved.orders)await db.query('INSERT INTO marketplace_intake_orders(intake_id,source_platform,source_store,source_order_number,expected_items,financial,work_barcode) VALUES($1,$2,$3,$4,$5,$6,$7)',[batch.id,'Shopify',profile.store,order.sourceOrderNumber,saved.items.filter(item=>item.sourceOrderNumber===order.sourceOrderNumber).map(item=>({sourceLineId:item.sourceLineId,sourceSku:item.sku,productCode:saved.settings.skuMappings[item.sku].erpSku,quantity:item.quantity,barcode:saved.settings.skuMappings[item.sku].barcode})),{source:order.sourceFinancial,ecount:order.financial},'ANON-WORK-'+order.sourceOrderNumber]);
  await db.query('INSERT INTO marketplace_warehouse_flows(intake_id,enabled_by) VALUES($1,2)',[batch.id]);return batch;
 };
 h.service=createMarketplaceDraftOverwriteService({pool:h.pool,prepareMarketplace:h.prepare,enabled:()=>true,mixedEnabled:()=>true});
 h.body=async records=>{const approved=await h.approve(records),input={...h.input(records),settings:approved.settings,scopeMode:'uploaded-file-v2'},preview=await h.service.preview(input,actor);if(!preview.canConfirm)throw Error('Anonymous preview blocked: '+JSON.stringify(preview.blockedReasons));return {...input,commandId:randomUUID(),previewFingerprint:preview.previewFingerprint,confirmed:true,notImportedConfirmed:true};};
 h.state=async()=>{const state={};for(const name of ['marketplace_intakes','marketplace_intake_orders','marketplace_warehouse_flows','marketplace_intake_scope_orders','marketplace_draft_revisions','marketplace_draft_commands','marketplace_product_mapping_reviews','marketplace_internal_scan_codes','orders','marketplace_warehouse_events'])state[name]=(await db.query('SELECT * FROM '+name+' ORDER BY 1')).rows;return state;};
 return h;
}

describe('barcode proof projection through real mixed-owner SQL and unchanged exact validators',()=>{
 let h;
 beforeEach(async()=>{
  h=await setup();
  jest.spyOn(reviews,'verifySavedBarcodeReviews').mockImplementation((db,current,unused,options)=>actualReview(db,current,h.reader,options));
  jest.spyOn(catalog,'verifyCatalogMappings').mockImplementation((db,settings,skus,unused,context,current)=>actualCatalog(db,settings,skus,h.reader,context,current));
 });
 afterEach(async()=>{await h?.db.close();});
 const A=()=>row('#ANON-A',11),B=()=>row('#ANON-B',22),C=()=>row('#ANON-C',33),R=()=>row('#ANON-R',44);
 async function originals(retained=[]){const one=await h.addBatch([A(),...retained],'TEST-ANON-OWNER-A'),two=await h.addBatch([B()],'TEST-ANON-OWNER-B');h.api.set('#ANON-C',[C()]);return [one,two];}
 test('one confirmation reaches mixed apply across two owners and one new order; exact owners and complete output all validate',async()=>{
  const owners=await originals(),body=await h.body([A(),B(),C()]),normal=await h.prepare(body,{refresh:true});
  expect(normal.newOrderCount).toBe(1);expect(normal.parsed.orders.map(order=>order.sourceOrderNumber)).toEqual(['#ANON-C']);await h.validate(snapshot(normal));
  const before=await h.state(),callOffset=h.calls.length,result=await h.service.apply(body,actor),after=await h.state();
  const applied=h.calls.slice(callOffset).map(([sql])=>sql),proofLock=applied.findIndex(sql=>sql.includes('FROM marketplace_product_mapping_reviews')&&sql.includes('ORDER BY id FOR SHARE')),derivedInsert=applied.findIndex(sql=>sql.startsWith('INSERT INTO marketplace_product_mapping_reviews'));
  expect(proofLock).toBeGreaterThan(applied.indexOf('BEGIN'));expect(derivedInsert).toBeGreaterThan(proofLock);
  expect(result).toMatchObject({applied:true,newOrderCount:1,updatedOrderCount:2,exportBatch:{activeOrderCount:3,quantity:3}});
  for(const owner of owners){const updated=after.marketplace_intakes.find(batch=>batch.id===owner.id);await h.validate(updated.snapshot);expect(updated.snapshot.barcodeReviews[0].evidence.variantIds).toHaveLength(1);}
  for(const old of before.marketplace_intake_orders){const next=after.marketplace_intake_orders.find(source=>source.id===old.id);expect(next.intake_id).toBe(old.intake_id);expect(next.work_barcode).toBe(old.work_barcode);expect(next.draft_version).toBe(1);}
  const exported=after.marketplace_intakes.find(batch=>batch.id===result.exportBatch.id);await h.validate(exported.snapshot);
  const {savedBatchTables}=await import('../services/marketplaceBatchFiles.mjs'),tables=savedBatchTables(exported.snapshot,'ecount'),headers=tables[0].rows[0],quantityColumn=headers.indexOf('數量');expect(tables[0].rows.slice(1).reduce((sum,row)=>sum+Number(row[quantityColumn]),0)).toBe(3);
  expect(after.orders).toEqual([]);expect(after.marketplace_warehouse_events).toEqual([]);
  const writes=h.calls.filter(([sql])=>sql.startsWith('INSERT INTO marketplace_product_mapping_reviews')).length,again=await h.service.apply(body,actor);expect(again).toEqual({...result,replayed:true});expect(h.calls.filter(([sql])=>sql.startsWith('INSERT INTO marketplace_product_mapping_reviews'))).toHaveLength(writes);
 });
 test('a retained different SKU keeps its source and item byte-for-byte unchanged',async()=>{
  const retained={...R(),'Lineitem sku':OTHER,'Lineitem name':'Anonymous unchanged item'},owners=await originals([retained]),body=await h.body([A(),B(),C()]),before=await h.state();await h.service.apply(body,actor);const after=await h.state();
  expect(after.marketplace_intake_orders.find(source=>source.source_order_number==='#ANON-R')).toEqual(before.marketplace_intake_orders.find(source=>source.source_order_number==='#ANON-R'));
  const owner=after.marketplace_intakes.find(batch=>batch.id===owners[0].id);expect(owner.snapshot.items.find(item=>item.sourceOrderNumber==='#ANON-R')).toEqual(owners[0].snapshot.items.find(item=>item.sourceOrderNumber==='#ANON-R'));await h.validate(owner.snapshot);
 });
 test('retained same SKU is authorized only by its valid prior exact review and unchanged target mapping',async()=>{
  const owners=await originals([R()]),body=await h.body([A(),B(),C()]);await h.service.apply(body,actor);const updated=(await h.db.query('SELECT snapshot FROM marketplace_intakes WHERE id=$1',[owners[0].id])).rows[0].snapshot;
  await h.validate(updated);expect(updated.barcodeReviews).toHaveLength(1);expect(updated.barcodeReviews[0].evidence.variantIds).toEqual([variant(A()['Lineitem id']),variant(R()['Lineitem id'])]);expect(updated.items.find(item=>item.sourceOrderNumber==='#ANON-R').quantity).toBe(1);
 });
 test.each(['physical','internal'])('%s proof retains its existing exact evidence shape and scan identity across owner union',async kind=>{
  h.barcodeFor=record=>record['Lineitem sku']===SKU?'':record['Lineitem sku'];
  h.inputSettings={skuMappings:{[SKU]:kind==='physical'?{physicalBarcode:'ANON-PHYSICAL-SCAN'}:{scanCodeType:'internal',internalScanCode:'ITM-ANON-OWNER'}}};
  const owners=await originals([R()]),body=await h.body([A(),B(),C()]),result=await h.service.apply(body,actor),updated=(await h.db.query('SELECT snapshot FROM marketplace_intakes WHERE id=$1',[owners[0].id])).rows[0].snapshot;
  await h.validate(updated);expect(updated.barcodeReviews).toHaveLength(1);expect(updated.barcodeReviews[0].evidence.barcodeProof).toBe(kind==='physical'?'physical-scan-v1':'internal-scan-v1');
  expect(updated.barcodeReviews[0].evidence.sourceName).toBe('Anonymous variant 11 / Anonymous variant 44');
  if(kind==='internal')expect(updated.barcodeReviews[0].evidence.sourceLines).toEqual([['#ANON-A',A()['Lineitem id'],1],['#ANON-R',R()['Lineitem id'],1]]);
  else{expect(updated.barcodeReviews[0].evidence.sourceLines).toBeUndefined();expect(updated.barcodeReviews[0].evidence.physicalBarcode).toBe('ANON-PHYSICAL-SCAN');}
  const exported=(await h.db.query('SELECT snapshot FROM marketplace_intakes WHERE id=$1',[result.exportBatch.id])).rows[0].snapshot;await h.validate(exported);
 });
 test('a borrowed line stays under the old owner proof when its canonical owner is also uploaded with a newer quantity',async()=>{
  await h.addBatch([A()],'TEST-ANON-OWNER-A');h.api.set('#ANON-C',[C()]);
  const first=await h.service.apply(await h.body([A(),C()]),actor),mixedOwner=(await h.db.query('SELECT * FROM marketplace_intakes WHERE id=$1',[first.exportBatch.id])).rows[0];
  const changedA={...A(),'Lineitem quantity':'2',Subtotal:'200',Total:'200'};h.api.set('#ANON-A',[changedA]);
  const result=await h.service.apply(await h.body([changedA,C()]),actor),retained=(await h.db.query('SELECT snapshot FROM marketplace_intakes WHERE id=$1',[mixedOwner.id])).rows[0].snapshot;
  expect(retained.items.find(item=>item.sourceOrderNumber==='#ANON-A')).toEqual(mixedOwner.snapshot.items.find(item=>item.sourceOrderNumber==='#ANON-A'));expect(retained.items.find(item=>item.sourceOrderNumber==='#ANON-A').quantity).toBe(1);await h.validate(retained);
  const current=(await h.db.query('SELECT snapshot FROM marketplace_intakes WHERE id=$1',[result.exportBatch.id])).rows[0].snapshot;expect(current.items.find(item=>item.sourceOrderNumber==='#ANON-A').quantity).toBe(2);await h.validate(current);
 });
 test('revoking only full API authority before the source transaction rejects even while a separate CSV draft proof remains valid',async()=>{
  await originals();const uploaded=[A(),B(),C()].map(record=>({...record,'Lineitem name':'Anonymous CSV label '+record.Name})),body=await h.body(uploaded),normal=await h.prepare(body,{refresh:true});
  const fullFingerprint=normal.barcodeReviewCandidates[0].fingerprint,draft=await h.prepare(body,{overwriteOrderNumbers:uploaded.map(record=>record.Name)});expect(draft.barcodeReviews[0].fingerprint).not.toBe(fullFingerprint);
  const full=(await h.db.query('SELECT * FROM marketplace_product_mapping_reviews WHERE fingerprint=$1',[fullFingerprint])).rows[0];
  h.beforeConnect=()=>h.db.query('UPDATE marketplace_product_mapping_reviews SET revoked_at=NOW() WHERE id=$1',[full.id]);
  const before=await h.state();await expect(h.service.apply(body,actor)).rejects.toMatchObject({code:'BARCODE_REVIEW_CHANGED'});const after=await h.state();
  const externalRevocation=after.marketplace_product_mapping_reviews.find(record=>record.id===full.id).revoked_at;expect(externalRevocation).toBeTruthy();before.marketplace_product_mapping_reviews.find(record=>record.id===full.id).revoked_at=externalRevocation;expect(after).toEqual(before);
  expect(h.calls.some(([sql])=>sql.includes('FROM marketplace_product_mapping_reviews')&&sql.includes('FOR SHARE'))).toBe(true);
 });
 test('the complete exported file passes the actual download handler and stops after review revocation',async()=>{
  await originals();const result=await h.service.apply(await h.body([A(),B(),C()]),actor),record=(await h.db.query('SELECT * FROM marketplace_intakes WHERE id=$1',[result.exportBatch.id])).rows[0];
  const jwt=require('jsonwebtoken'),{downloadFile}=require('../services/marketplaceDownloads'),oldSecret=process.env.JWT_SECRET;process.env.JWT_SECRET='ANONYMOUS-OWNER-DOWNLOAD-ONLY';
  const token=()=>jwt.sign({downloadActor:1,intakeId:record.id,kind:'ecount',draftRevision:0,uploadScopeFingerprint:record.snapshot.uploadScope.fingerprint},process.env.JWT_SECRET,{algorithm:'HS256',audience:'wms-marketplace-file',expiresIn:120});
  const download=async()=>{const response={statusCode:200,body:null,set(){return this;},status(code){this.statusCode=code;return this;},send(body){this.body=body;return this;}};await downloadFile({pool:h.pool})({params:{id:String(record.id),kind:'ecount'},headers:{cookie:'wms_marketplace_download='+token()}},response,error=>{throw error;});return response;};
  try{
   const response=await download();expect(response.statusCode).toBe(200);expect(Buffer.isBuffer(response.body)).toBe(true);const XLSX=require('xlsx'),book=XLSX.read(response.body),rows=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1});expect(rows.slice(1).reduce((sum,row)=>sum+Number(row[rows[0].indexOf('數量')]),0)).toBe(3);
   await h.db.query('UPDATE marketplace_product_mapping_reviews SET revoked_at=NOW() WHERE id=$1',[record.snapshot.barcodeReviews[0].id]);const blocked=await download();expect(blocked.statusCode).toBe(400);expect(Buffer.isBuffer(blocked.body)).toBe(false);
  }finally{if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;}
 });
 test.each(['missing','revoked','catalog','quantity','variant','cross-order-line'])('invalid retained %s authority cannot write owners, new batch or partial review records',async change=>{
  const owners=await originals([R()]);
  if(change==='revoked')await h.db.query('UPDATE marketplace_product_mapping_reviews SET revoked_at=NOW() WHERE id=$1',[owners[0].snapshot.barcodeReviews[0].id]);
  else if(change==='catalog')h.products[0].spec='Anonymous changed catalog';
  else{
   const altered=clone(owners[0].snapshot);
   if(change==='missing')altered.barcodeReviews=[];
   if(change==='quantity')altered.sourceEvidence.verification.orders.find(order=>order.number==='#ANON-R').items[0].quantity=null;
   if(change==='variant')altered.sourceEvidence.verification.orders.find(order=>order.number==='#ANON-R').items[0].variantId='gid://shopify/ProductVariant/99999';
   if(change==='cross-order-line')altered.sourceEvidence.verification.orders.find(order=>order.number==='#ANON-R').items[0].id=A()['Lineitem id'];
   await h.db.query('UPDATE marketplace_intakes SET snapshot=$2 WHERE id=$1',[owners[0].id,altered]);
  }
  const body=await h.body([A(),B(),C()]),before=await h.state();
  if(change==='missing')await expect(h.service.apply(body,actor)).rejects.toMatchObject({code:'MARKETPLACE_BARCODE_OWNER_REVIEW_REQUIRED',status:400});
  else await expect(h.service.apply(body,actor)).rejects.toBeDefined();
  expect(await h.state()).toEqual(before);
 });
 test.each(['INSERT INTO marketplace_draft_revisions','INSERT INTO marketplace_intake_scope_orders','INSERT INTO marketplace_draft_commands'])('failure at %s rolls back derived owner proofs together with all sales changes',async prefix=>{
  await originals();const body=await h.body([A(),B(),C()]),before=await h.state();h.failSql=sql=>sql.startsWith(prefix);await expect(h.service.apply(body,actor)).rejects.toThrow('Anonymous forced SQL failure');expect(await h.state()).toEqual(before);
 });
 test('lost commit acknowledgement reuses the original command and never reinserts owner reviews',async()=>{
  await originals();const body=await h.body([A(),B(),C()]);h.commitAckLost=true;await expect(h.service.apply(body,actor)).rejects.toMatchObject({code:'MARKETPLACE_DRAFT_RESULT_UNKNOWN'});const after=await h.state(),writes=h.calls.filter(([sql])=>sql.startsWith('INSERT INTO marketplace_product_mapping_reviews')).length;
  expect((await h.service.apply(body,actor)).replayed).toBe(true);expect(await h.state()).toEqual(after);expect(h.calls.filter(([sql])=>sql.startsWith('INSERT INTO marketplace_product_mapping_reviews'))).toHaveLength(writes);
 });
 test.each(['imported','shipped','archived'])('%s original still blocks the entire mixed upload',async status=>{
  const owners=await originals(),input=h.input([A(),B(),C()]);await h.approve([A(),B(),C()]);
  if(status==='imported')await h.db.query('UPDATE marketplace_warehouse_flows SET erp_receipt=$2 WHERE intake_id=$1',[owners[0].id,{reference:'ANON-ALREADY-IMPORTED'}]);
  if(status==='archived')await h.db.query('UPDATE marketplace_intakes SET archived_at=NOW() WHERE id=$1',[owners[0].id]);
  if(status==='shipped')h.mutateEvidence=order=>order.number==='#ANON-A'?{...order,fulfillmentStatus:'fulfilled',remainingQuantity:0}:order;
  const before=await h.state(),preview=await h.service.preview({...input,scopeMode:'uploaded-file-v2'},actor);expect(preview.canConfirm).toBe(false);await expect(h.service.apply({...input,scopeMode:'uploaded-file-v2',commandId:randomUUID(),previewFingerprint:preview.previewFingerprint,confirmed:true,notImportedConfirmed:true},actor)).rejects.toBeDefined();expect(await h.state()).toEqual(before);
 });
});
