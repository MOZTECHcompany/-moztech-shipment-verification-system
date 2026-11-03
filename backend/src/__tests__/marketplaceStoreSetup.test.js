const express=require('express'),request=require('supertest'),{PGlite}=require('@electric-sql/pglite');
const {createMarketplaceRouter}=require('../routes/marketplaceRoutes');
const {createConnectionRegistry}=require('../services/shopifyStoreRouting');
const settings=extra=>({store:'Anonymous store',apiConnectionId:'omfuture-orders',shopifyShop:'omfuture.myshopify.com',customerCode:'ANON-CUSTOMER',customerName:'Anonymous customer',warehouseCode:'ANON-WH',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,...extra});
let db;
beforeAll(async()=>{db=new PGlite();await db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(7); CREATE TABLE marketplace_store_profiles(id SERIAL PRIMARY KEY,platform TEXT NOT NULL,store TEXT NOT NULL,settings JSONB NOT NULL,updated_by INTEGER REFERENCES users(id),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(platform,store));');});
afterAll(async()=>{await db.close();});
beforeEach(async()=>{await db.exec('TRUNCATE marketplace_store_profiles RESTART IDENTITY');});
function harness({role='dispatcher',ready=true}={}){
 const pool={query:jest.fn((...args)=>db.query(...args)),connect:jest.fn()},prepare=jest.fn(async()=>{throw Error('Order preparation forbidden in settings route');});
 const connectionRegistry=createConnectionRegistry({env:{},connections:[{id:'omfuture-orders',shop:'omfuture.myshopify.com',token:ready?'ANONYMOUS-TOKEN':''}]});
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:7,role};next();});app.use('/api/marketplace-intakes',createMarketplaceRouter({pool,prepareMarketplace:prepare,connectionRegistry}));return {app,pool,prepare};
}
const post=(h,body)=>request(h.app).post('/api/marketplace-intakes/store-profiles').send(body);
const get=h=>request(h.app).get('/api/marketplace-intakes/store-profiles');
test('public connection metadata is configuration-only, role-gated, and exposes no env or credential fields',async()=>{
 const h=harness(),r=await request(h.app).get('/api/marketplace-intakes/store-connections');expect(r.status).toBe(200);expect(r.headers['cache-control']).toBe('private, no-store');expect(r.body).toEqual({connections:[{id:'omfuture-orders',platform:'Shopify',shop:'omfuture.myshopify.com',connectionReady:true,authKind:'static_token'}]});expect(JSON.stringify(r.body)).not.toMatch(/ANONYMOUS|Env|tokenEnv|accessToken/);expect(h.prepare).not.toHaveBeenCalled();expect(h.pool.query).not.toHaveBeenCalled();
 const denied=harness({role:'packer'});expect((await request(denied.app).get('/api/marketplace-intakes/store-connections')).status).toBe(403);
});
test('create-only races insert exactly once and cannot overwrite the winner settings',async()=>{
 const h=harness(),results=await Promise.all([post(h,{platform:'Shopify',settings:settings(),createOnly:true}),post(h,{platform:'Shopify',settings:settings({customerCode:'SECOND-TRY'}),createOnly:true})]);
 expect(results.map(r=>r.status).sort()).toEqual([200,409]);expect(results.find(r=>r.status===409).body.code).toBe('STORE_PROFILE_EXISTS');
 const rows=(await get(h)).body.profiles;expect(rows).toHaveLength(1);expect(rows[0].settings.customerCode).toBe(results.find(r=>r.status===200).body.settings.customerCode);expect(h.prepare).not.toHaveBeenCalled();expect(h.pool.connect).not.toHaveBeenCalled();
});
test('microsecond timestamp roundtrips exactly and concurrent CAS edits accept only one writer',async()=>{
 const h=harness();await post(h,{platform:'Shopify',settings:settings(),createOnly:true});await db.query("UPDATE marketplace_store_profiles SET updated_at='2026-11-03T00:00:00.123456Z'");
 const original=(await get(h)).body.profiles[0];expect(original.updated_at).toBe('2026-11-03T00:00:00.123456Z');
 const edits=await Promise.all(['CUSTOMER-A','CUSTOMER-B'].map(customerCode=>post(h,{platform:'Shopify',settings:settings({customerCode}),profileId:String(original.id),expectedUpdatedAt:original.updated_at})));
 expect(edits.map(r=>r.status).sort()).toEqual([200,409]);expect(edits.find(r=>r.status===409).body.code).toBe('STORE_PROFILE_CHANGED');const fresh=(await get(h)).body.profiles[0];expect(fresh).toEqual(edits.find(r=>r.status===200).body);expect(fresh.updated_at).toMatch(/\.\d{6}Z$/);expect(fresh.updated_at).not.toBe(original.updated_at);
});
test('stale, missing or renamed profile updates never become creates',async()=>{
 const h=harness(),initial=(await post(h,{platform:'Shopify',settings:settings(),createOnly:true})).body;
 for(const extra of [{profileId:'404',expectedUpdatedAt:initial.updated_at},{profileId:String(initial.id),expectedUpdatedAt:'2020-01-01T00:00:00.000000Z'},{profileId:String(initial.id),expectedUpdatedAt:initial.updated_at,settings:settings({store:'Renamed store'})}]){
  const r=await post(h,{platform:'Shopify',settings:settings(),...extra});expect(r.status).toBe(409);expect(r.body.code).toBe('STORE_PROFILE_CHANGED');
 }
 expect((await get(h)).body.profiles).toEqual([initial]);
});
test('new guarded Shopify setup requires an exact configured server connection and domain',async()=>{
 const h=harness();for(const changed of [{apiConnectionId:'foreign'},{shopifyShop:'foreign.myshopify.com'},{apiConnectionId:''}]){
  const r=await post(h,{platform:'Shopify',settings:settings(changed),createOnly:true});expect(r.status).toBe(400);expect(r.body.code).toBe('STORE_CONNECTION_INVALID');
 }
 expect((await get(h)).body.profiles).toEqual([]);const unavailable=harness({ready:false});expect((await post(unavailable,{platform:'Shopify',settings:settings(),createOnly:true})).body.code).toBe('STORE_CONNECTION_INVALID');
});
test('incomplete guards are rejected rather than silently taking the legacy upsert branch',async()=>{
 const h=harness();for(const extra of [{createOnly:'true'},{profileId:'1'},{expectedUpdatedAt:'2026-11-03T00:00:00Z'},{profileId:'1',expectedUpdatedAt:'invalid'},{profileId:'1',expectedUpdatedAt:'2026-11-03T00:00:00Z',createOnly:true}])expect((await post(h,{platform:'Shopify',settings:settings(),...extra})).status).toBe(400);
 expect((await get(h)).body.profiles).toEqual([]);
});
test('legacy unguarded upsert remains compatible and preserves its previous role gates',async()=>{
 const h=harness(),first=await post(h,{platform:'Shopify',settings:settings({apiConnectionId:'legacy-not-configured'})});expect(first.status).toBe(200);
 const second=await post(h,{platform:'Shopify',settings:settings({apiConnectionId:'legacy-not-configured',customerCode:'LEGACY-UPDATED'})});expect(second.status).toBe(200);expect(second.body.id).toBe(first.body.id);expect(second.body.settings.customerCode).toBe('LEGACY-UPDATED');expect((await get(h)).body.profiles).toHaveLength(1);
 expect((await post(harness({role:'picker'}),{platform:'Shopify',settings:settings(),createOnly:true})).status).toBe(403);
});
