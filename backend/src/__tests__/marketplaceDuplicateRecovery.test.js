const express=require('express'),request=require('supertest');

jest.mock('../services/marketplaceBarcodeReviews',()=>({
 confirmBarcodeReview:jest.fn(),verifySavedBarcodeReviews:jest.fn(async()=>({})),
}));
jest.mock('../services/marketplaceProductCatalog',()=>({verifyCatalogMappings:jest.fn(async()=>{})}));

const {createMarketplaceRouter}=require('../routes/marketplaceRoutes');

function harness({intakeId,workOrderId}={}){
 const db={query:jest.fn(async(sql)=>{
  if(sql.startsWith('SELECT * FROM marketplace_intakes WHERE fingerprint='))return {rows:[]};
  if(sql.startsWith('SELECT intake_id FROM marketplace_intake_orders'))return {rows:intakeId===undefined?[]:[{intake_id:intakeId}]};
  if(sql.startsWith('SELECT id FROM orders WHERE source_platform='))return {rows:workOrderId===undefined?[]:[{id:workOrderId}]};
  return {rows:[]};
 }),release:jest.fn()};
 const pool={query:jest.fn(),connect:jest.fn(async()=>db)};
 const parsed={orders:[{sourcePlatform:'Shopify',sourceOrderNumber:'#154319',financial:{totalMinor:188000}}],items:[]};
 const prepare=jest.fn(async()=>({source:{platform:'Shopify',rows:[['Name'],['#154319']]},parsed,raw:parsed,
  settings:{store:'墨子科技 官網',skuMappings:{},batchNumber:'TEST-DUPLICATE'},
  output:{ok:true,headers:[],rows:[],summary:{orderCount:1}},prepick:{headers:[],rows:[]},
  verification:{currentFingerprint:'fresh'},barcodeReviews:[],sourceEvidence:{},
 }));
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:1,role:'dispatcher',name:'User'};next();});
 app.use('/api/marketplace-intakes',createMarketplaceRouter({pool,prepareMarketplace:prepare}));
 return {app,db,pool,prepare};
}

const body={previewFingerprint:'fresh',intakeId:999,workOrderId:999,orderNumber:'FORGED'};
function expectNoWrites(db){
 const statements=db.query.mock.calls.map(([sql])=>sql);
 expect(statements).toContain('ROLLBACK');expect(statements).not.toContain('COMMIT');
 expect(statements.some(sql=>/^(INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(false);
 expect(db.release).toHaveBeenCalledTimes(1);
}

test('saved source duplicate points to the existing batch and verified order, without another sale or task',async()=>{
 const h=harness({intakeId:19});
 const response=await request(h.app).post('/api/marketplace-intakes').send(body);
 expect(response.status).toBe(409);expect(response.body).toMatchObject({code:'MARKETPLACE_SOURCE_EXISTS',intakeId:19,orderNumber:'#154319'});
 expect(response.body.workOrderId).toBeUndefined();expect(response.body.message).toContain('未重複轉銷貨');
 expect(h.prepare).toHaveBeenCalledWith(body,{refresh:true});expectNoWrites(h.db);
 expect(h.db.query.mock.calls.filter(([sql])=>sql.startsWith('SELECT id FROM orders WHERE source_platform='))).toHaveLength(0);
});

test('legacy source duplicate points to its original work order and preserves rollback',async()=>{
 const h=harness({workOrderId:41});
 const response=await request(h.app).post('/api/marketplace-intakes').send(body);
 expect(response.status).toBe(409);expect(response.body).toMatchObject({code:'MARKETPLACE_SOURCE_EXISTS',workOrderId:41,orderNumber:'#154319'});
 expect(response.body.intakeId).toBeUndefined();expect(response.body.message).toContain('未再次轉銷貨');
 expectNoWrites(h.db);
});

test.each([0,-1,2147483648,'19/../../other','NaN'])('invalid batch reference %p never becomes a navigation target',async(intakeId)=>{
 const h=harness({intakeId});
 const response=await request(h.app).post('/api/marketplace-intakes').send(body);
 expect(response.status).toBe(409);expect(response.body.code).toBe('MARKETPLACE_SOURCE_EXISTS');
 expect(response.body.intakeId).toBeUndefined();expectNoWrites(h.db);
});

test('a stale marketplace preview still blocks before any source lookup',async()=>{
 const h=harness({intakeId:19});
 const response=await request(h.app).post('/api/marketplace-intakes').send({...body,previewFingerprint:'stale'});
 expect(response.status).toBe(409);expect(response.body.code).toBe('SHOPIFY_PREVIEW_CHANGED');
 expect(response.body.intakeId).toBeUndefined();expect(response.body.workOrderId).toBeUndefined();expect(h.pool.connect).not.toHaveBeenCalled();
});
