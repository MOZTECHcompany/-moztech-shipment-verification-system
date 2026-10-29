const express=require('express'),request=require('supertest'),jwt=require('jsonwebtoken'),XLSX=require('xlsx');
jest.mock('../services/marketplaceBarcodeReviews',()=>({verifySavedBarcodeReviews:jest.fn(async()=>({}))}));
jest.mock('../services/marketplaceProductCatalog',()=>({verifyCatalogMappings:jest.fn(async()=>{})}));
const {issueDownload,downloadFile}=require('../services/marketplaceDownloads');
const {createUploadScope}=require('../services/marketplaceUploadScopes');
async function harness(){
 const {parseUnifiedMarketplace,prepareUnifiedMarketplace}=await import('../services/unifiedMarketplace.mjs');
 const headers=['Name','Financial Status','Fulfillment Status','Currency','Subtotal','Shipping','Taxes','Total','Discount Amount','Refunded Amount','Payment Method','Lineitem quantity','Lineitem name','Lineitem price','Lineitem sku','Lineitem discount'];
 const raw=parseUnifiedMarketplace([headers,['#SYN','paid','unfulfilled','TWD','100','0','0','100','0','0','card','1','Synthetic','100','SKU','0']]).parsed;
 const settings={store:'Synthetic',customerCode:'C1',customerName:'Synthetic',warehouseCode:'003',date:'2026-10-28',batchSequence:'1',batchNumber:'TEST-DRAFT-DL',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,discountAllocationConfirmed:true,skuMappings:{SKU:{erpSku:'000123',erpName:'Synthetic',barcode:'4710000000001',confirmed:true,barcodeConfirmed:true}}};
 const prepared=prepareUnifiedMarketplace(raw,settings);
 const record={id:19,batch_number:settings.batchNumber,source_platform:'Shopify',source_store:'Synthetic',snapshot:{settings,headers:prepared.output.headers,rows:prepared.output.rows,summary:prepared.output.summary,orders:prepared.parsed.orders,items:prepared.parsed.items,prepick:prepared.prepick,handler:{userId:7,name:'Synthetic'}}};
 const state={sources:[],members:[],owners:[]};
 const pool={query:jest.fn(async sql=>{
  if(sql.startsWith('SELECT role'))return {rows:[{role:'dispatcher'}]};
  if(sql.startsWith('SELECT * FROM marketplace_intakes'))return {rows:[record]};
  if(sql.startsWith('SELECT intake_id,intake_order_id,source_version'))return {rows:state.members};
  if(sql.startsWith('SELECT s.* FROM marketplace_intake_orders'))return {rows:state.sources};
  if(sql.startsWith('SELECT id,source_platform,source_store,archived_at'))return {rows:state.owners};
  if(sql.startsWith('SELECT EXISTS('))return {rows:[{borrowed:false}]};
  return {rows:[]};
 })};
 const app=express();app.use(express.json());app.post('/link',(req,res)=>issueDownload(res,19,'ecount',7,record.snapshot.draftRevision??0,record.snapshot.uploadScope?.fingerprint));app.get('/api/marketplace-files/:id/:kind',downloadFile({pool}));
 return {app,record,pool,state};
}
beforeEach(()=>{process.env.JWT_SECRET='synthetic-draft-download-test-only';});
test('issued original-version link cannot silently return a later revised sales workbook',async()=>{
 const h=await harness(),link=await request(h.app).post('/link'),cookie=link.headers['set-cookie'][0].split(';')[0];
 h.record.snapshot.draftRevision=1;
 const result=await request(h.app).get(link.body.url).set('Cookie',cookie);
 expect(result.status).toBe(409);expect(result.text).toContain('版本已更新');expect(result.headers['content-type']).not.toContain('spreadsheet');
});
test('latest revision download uses the current workbook and includes revision in filename',async()=>{
 const h=await harness();h.record.snapshot.draftRevision=3;
 const link=await request(h.app).post('/link'),cookie=link.headers['set-cookie'][0].split(';')[0];
 const claims=jwt.verify(cookie.split('=')[1],process.env.JWT_SECRET,{audience:'wms-marketplace-file'});expect(claims.draftRevision).toBe(3);
 const result=await request(h.app).get(link.body.url).set('Cookie',cookie).buffer(true).parse((res,done)=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>done(null,Buffer.concat(chunks)));});
 expect(result.status).toBe(200);expect(decodeURIComponent(result.headers['content-disposition'])).toContain('_修訂3.xlsx');
 const book=XLSX.read(result.body,{type:'buffer'}),rows=XLSX.utils.sheet_to_json(book.Sheets['銷貨匯入'],{header:1});
 expect(rows).toHaveLength(2);expect(rows[1][11]).toBe('000123');
});
test('an unversioned historical cookie also fails after a draft revision',async()=>{
 const h=await harness();h.record.snapshot.draftRevision=1;
 const token=jwt.sign({downloadActor:7,intakeId:19,kind:'ecount'},process.env.JWT_SECRET,{audience:'wms-marketplace-file',expiresIn:120});
 const result=await request(h.app).get('/api/marketplace-files/19/ecount').set('Cookie','wms_marketplace_download='+token);
 expect(result.status).toBe(409);
});
async function scopedHarness(){
 const h=await harness(),source={id:25,intake_id:8,source_platform:'Shopify',source_store:'Synthetic',source_order_number:'#SYN',draft_version:2,draft_active:true};
 h.state.sources.push(source);h.state.members.push({intake_id:19,intake_order_id:25,source_version:2});
 h.state.owners.push({id:8,source_platform:'Shopify',source_store:'Synthetic',archived_at:null});h.record.snapshot.uploadScope=createUploadScope([source]);
 return h;
}
test('scope download cookie pins the complete uploaded file manifest',async()=>{
 const h=await scopedHarness(),link=await request(h.app).post('/link'),cookie=link.headers['set-cookie'][0].split(';')[0];
 const claims=jwt.verify(cookie.split('=')[1],process.env.JWT_SECRET,{audience:'wms-marketplace-file'});
 expect(claims.uploadScopeFingerprint).toBe(h.record.snapshot.uploadScope.fingerprint);
 expect((await request(h.app).get(link.body.url).set('Cookie',cookie)).status).toBe(200);
});
test('a scope cookie cannot download after a borrowed source changes version',async()=>{
 const h=await scopedHarness(),link=await request(h.app).post('/link'),cookie=link.headers['set-cookie'][0].split(';')[0];h.state.sources[0].draft_version=3;
 const result=await request(h.app).get(link.body.url).set('Cookie',cookie);expect(result.status).toBe(409);expect(result.headers['content-type']).not.toContain('spreadsheet');
});
test('an unscoped cookie cannot be reused for a new complete-file scope',async()=>{
 const h=await harness(),link=await request(h.app).post('/link'),cookie=link.headers['set-cookie'][0].split(';')[0];
 const scoped=await scopedHarness();Object.assign(h.state,scoped.state);h.record.snapshot.uploadScope=scoped.record.snapshot.uploadScope;
 expect((await request(h.app).get(link.body.url).set('Cookie',cookie)).status).toBe(409);
});
