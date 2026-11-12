const express=require('express'),request=require('supertest');
const {createMarketplaceRouter}=require('../routes/marketplaceRoutes');
const appFor=(prepareMarketplace,user={id:1,role:'dispatcher'})=>{const pool={query:jest.fn(),connect:jest.fn()};const app=express();app.use(express.json());app.use((req,res,next)=>{req.user=user;next();});app.use('/api/marketplace-intakes',createMarketplaceRouter({pool,prepareMarketplace}));return {app,pool};};
test('store selection response whitelists safe choices without copying private fields',async()=>{
 const error=Object.assign(new Error('請選擇店鋪'),{status:409,code:'MARKETPLACE_STORE_SELECTION_REQUIRED',storeSelection:{reason:'ambiguous',token:'SECRET',choices:[{id:2,store:'匿名店',shop:'second.myshopify.com',connectionReady:true,token:'SECRET',tokenEnv:'PRIVATE'}]}});
 const h=appFor(async()=>{throw error;});const result=await request(h.app).post('/api/marketplace-intakes/preview').send({rows:[]});
 expect(result.status).toBe(409);expect(result.body.storeSelection).toEqual({platform:'Shopify',reason:'ambiguous',choices:[{id:'2',platform:'Shopify',store:'匿名店',shop:'second.myshopify.com',connectionReady:true}]});expect(JSON.stringify(result.body)).not.toMatch(/SECRET|PRIVATE|token/);expect(h.pool.connect).not.toHaveBeenCalled();
});
test('preview enforces the same role gates as saving and returns no internal source evidence',async()=>{
 const prepare=jest.fn(async()=>({parsed:{items:[]},output:{ok:false},sourceEvidence:{private:'original snapshot'}}));
 for(const role of ['picker','packer']){const {app}=appFor(prepare,{id:2,role});expect((await request(app).post('/api/marketplace-intakes/preview').send({rows:[]})).status).toBe(403);}
 expect(prepare).not.toHaveBeenCalled();const {app,pool}=appFor(prepare);const r=await request(app).post('/api/marketplace-intakes/preview').send({rows:[]});expect(r.status).toBe(200);expect(r.body.sourceEvidence).toBeUndefined();expect(r.headers['cache-control']).toBe('private, no-store');expect(pool.connect).not.toHaveBeenCalled();
});
test('save requires a fresh identical Shopify preview before any batch or warehouse write',async()=>{
 const prepare=jest.fn(async()=>({source:{platform:'Shopify'},parsed:{items:[]},output:{ok:true},verification:{currentFingerprint:'current'}}));
 const {app,pool}=appFor(prepare);const r=await request(app).post('/api/marketplace-intakes').send({previewFingerprint:'old'});
 expect(r.status).toBe(409);expect(r.body.code).toBe('SHOPIFY_PREVIEW_CHANGED');expect(prepare).toHaveBeenCalledWith({previewFingerprint:'old'},{refresh:true});expect(pool.connect).not.toHaveBeenCalled();
});
test('query failure and invalid output prevent saving, leaving the source unchanged',async()=>{
 const error=Object.assign(new Error('Shopify 連線失敗'),{status:503,code:'SHOPIFY_UNAVAILABLE',orderNumber:'#154230'});const {app,pool}=appFor(async()=>{throw error;});
 const response=await request(app).post('/api/marketplace-intakes/preview').send({rows:[]});expect(response.status).toBe(503);expect(response.body.code).toBe('SHOPIFY_UNAVAILABLE');expect(response.body.orderNumber).toBe('#154230');expect(pool.connect).not.toHaveBeenCalled();
 const failed=appFor(async()=>({output:{ok:false,issues:[{message:'訂單異常'}]}}));expect((await request(failed.app).post('/api/marketplace-intakes').send({rows:[]})).status).toBe(400);expect(failed.pool.connect).not.toHaveBeenCalled();
});

test.each([
 ['dispatcher',true,403,'BARCODE_REVIEW_FORBIDDEN'],
 ['admin',false,400,'BARCODE_CONFIRMATION_REQUIRED'],
])('historical barcode confirmation checks role %s and attestation %s before persistence',async(role,historicalLineAttested,status,code)=>{
 const fingerprint='a'.repeat(64);
 const prepare=jest.fn(async()=>({
  profileId:12,verification:{currentFingerprint:'current'},
  barcodeReviewCandidates:[{fingerprint,requiresHistoricalLineAttestation:true}],
 }));
 const {app,pool}=appFor(prepare,{id:7,role});
 const response=await request(app).post('/api/marketplace-intakes/barcode-confirmations').send({
  verificationFingerprint:'current',confirmation:{fingerprint,confirmed:true,historicalLineAttested},
 });
 expect(response.status).toBe(status);
 expect(response.body.code).toBe(code);
 expect(pool.query).not.toHaveBeenCalled();
 expect(pool.connect).not.toHaveBeenCalled();
});

function mixedUpload() {
 const header=['Name','Id','Lineitem name','Lineitem sku'];
 const readyRows=[['#101','101','Primary product','A'],['','','Accessory','B']];
 const heldRow=['#102','102','Historical item','C'];
 const order=number=>({sourceOrderNumber:'#'+number});
 const fullRows=[header,...readyRows,heldRow];
 const selectedRows=[header,...readyRows];
 const verification={
  platform:'Shopify',version:'shopify-current-v2',mode:'api',shop:'example.myshopify.com',currentFingerprint:'a'.repeat(64),
  orders:[101,102].map(number=>({id:String(number),number:'#'+number,cancelled:false,fulfillmentStatus:'unfulfilled'})),
 };
 const full={
  source:{platform:'Shopify',rows:fullRows},profileId:12,settings:{store:'demo'},verification,
  raw:{orders:[order(101),order(102)],items:[
   {...order(101),sku:'A'},{...order(101),sku:'B'},{...order(102),sku:'C'},
  ]},
  parsed:{orders:[order(101),order(102)]},choices:[{number:'#101',eligible:true},{number:'#102',eligible:true}],
  reimports:[],output:{ok:false,issues:[{code:'BARCODE_MAPPING_REQUIRED',severity:'error',orderNumber:'#102',message:'品項待核對'}]},
 };
 const selected={
  profileId:12,verification:{...verification,orders:verification.orders.slice(0,1)},output:{ok:true},
  raw:{orders:[order(101)]},parsed:{orders:[order(101)]},reimports:[],barcodeConflicts:[],
  sourceEvidence:{private:'original snapshot'},
 };
 return {full,selected,fullRows,selectedRows};
}

test('ready preview projects whole orders from a fresh full-file check and uses the ordinary conversion without writes',async()=>{
 const {full,selected,fullRows,selectedRows}=mixedUpload();
 const prepare=jest.fn().mockResolvedValueOnce(full).mockResolvedValueOnce(full).mockResolvedValueOnce(selected);
 const {app,pool}=appFor(prepare);
 const original={rows:fullRows,profileId:12};
 const preview=await request(app).post('/api/marketplace-intakes/preview').send(original);
 expect(preview.status).toBe(200);
 expect(preview.body.readyScope).toMatchObject({
  candidateNumbers:['#101'],heldOrders:[{orderNumber:'#102',reasons:['品項待核對']}],excludedFulfilled:[],
 });
 const result=await request(app).post('/api/marketplace-intakes/ready-preview').send({
  ...original,readyScopeFingerprint:preview.body.readyScope.fingerprint,selectedOrderNumbers:['#102'],
 });
 expect(result.status).toBe(200);
 expect(result.body.rows).toEqual(selectedRows);
 expect(result.body.preview.output.ok).toBe(true);
 expect(result.body.preview.sourceEvidence).toBeUndefined();
 expect(prepare.mock.calls[1][0]).toMatchObject(original);
 expect(prepare.mock.calls[2][0]).toEqual({rows:selectedRows,settings:full.settings,profileId:12});
 expect(prepare.mock.calls[2][1].verificationScope).toBe(prepare.mock.calls[1][1].verificationScope);
 expect(pool.query).not.toHaveBeenCalled();
 expect(pool.connect).not.toHaveBeenCalled();
});

test.each(['full','selected'])('ready preview rejects changed %s scope before any write',async changed=>{
 const {full,selected,fullRows}=mixedUpload();
 const changedFull={...full,verification:{...full.verification,currentFingerprint:'b'.repeat(64)}};
 const changedSelected={...selected,parsed:{orders:[]},excludedFulfilled:['#101']};
 const prepare=jest.fn().mockResolvedValueOnce(full)
  .mockResolvedValueOnce(changed==='full'?changedFull:full).mockResolvedValueOnce(changedSelected);
 const {app,pool}=appFor(prepare);
 const original={rows:fullRows,profileId:12};
 const preview=await request(app).post('/api/marketplace-intakes/preview').send(original);
 const result=await request(app).post('/api/marketplace-intakes/ready-preview').send({
  ...original,readyScopeFingerprint:preview.body.readyScope.fingerprint,
 });
 expect(result.status).toBe(409);
 expect(result.body.code).toBe('MARKETPLACE_READY_SCOPE_CHANGED');
 expect(prepare).toHaveBeenCalledTimes(changed==='full'?2:3);
 expect(pool.query).not.toHaveBeenCalled();
 expect(pool.connect).not.toHaveBeenCalled();
});
