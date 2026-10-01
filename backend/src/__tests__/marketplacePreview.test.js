const express=require('express'),request=require('supertest');
const {createMarketplaceRouter}=require('../routes/marketplaceRoutes');
const appFor=(prepareMarketplace,user={id:1,role:'dispatcher'})=>{const pool={query:jest.fn(),connect:jest.fn()};const app=express();app.use(express.json());app.use((req,res,next)=>{req.user=user;next();});app.use('/api/marketplace-intakes',createMarketplaceRouter({pool,prepareMarketplace}));return {app,pool};};
test('preview enforces the same role gates as saving and returns no internal source evidence',async()=>{
 const prepare=jest.fn(async()=>({parsed:{items:[]},output:{ok:false},sourceEvidence:{private:'original snapshot'}}));
 for(const role of ['picker','packer']){const {app}=appFor(prepare,{id:2,role});expect((await request(app).post('/api/marketplace-intakes/preview').send({rows:[]})).status).toBe(403);}
 expect(prepare).not.toHaveBeenCalled();const {app,pool}=appFor(prepare);const r=await request(app).post('/api/marketplace-intakes/preview').send({rows:[]});expect(r.status).toBe(200);expect(r.body.sourceEvidence).toBeUndefined();expect(r.headers['cache-control']).toBe('private, no-store');expect(pool.connect).not.toHaveBeenCalled();
});
test('save requires a fresh identical Shopify preview before any batch or warehouse write',async()=>{
 const prepare=jest.fn(async()=>({parsed:{items:[]},output:{ok:true},verification:{currentFingerprint:'current'}}));
 const {app,pool}=appFor(prepare);const r=await request(app).post('/api/marketplace-intakes').send({previewFingerprint:'old'});
 expect(r.status).toBe(409);expect(r.body.code).toBe('SHOPIFY_PREVIEW_CHANGED');expect(prepare).toHaveBeenCalledWith({previewFingerprint:'old'},{refresh:true});expect(pool.connect).not.toHaveBeenCalled();
});
test('query failure and invalid output prevent saving, leaving the source unchanged',async()=>{
 const error=Object.assign(new Error('Shopify 連線失敗'),{status:503,code:'SHOPIFY_UNAVAILABLE',orderNumber:'#154230'});const {app,pool}=appFor(async()=>{throw error;});
 const response=await request(app).post('/api/marketplace-intakes/preview').send({rows:[]});expect(response.status).toBe(503);expect(response.body.code).toBe('SHOPIFY_UNAVAILABLE');expect(response.body.orderNumber).toBe('#154230');expect(pool.connect).not.toHaveBeenCalled();
 const failed=appFor(async()=>({output:{ok:false,issues:[{message:'訂單異常'}]}}));expect((await request(failed.app).post('/api/marketplace-intakes').send({rows:[]})).status).toBe(400);expect(failed.pool.connect).not.toHaveBeenCalled();
});
