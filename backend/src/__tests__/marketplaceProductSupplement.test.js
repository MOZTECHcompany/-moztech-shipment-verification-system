const express = require('express');
const request = require('supertest');
const {createMarketplaceRouter} = require('../routes/marketplaceRoutes');
const {createReferenceReader, createProductRouter, lookupProducts, verifyCatalogMappings, syncForUser} = require('../services/marketplaceProductCatalog');
const {createSupplementCatalog, validGtin} = require('../services/marketplaceProductSupplement');

const env = {K_SERVICE:'corely-wms-dev', GCS_BUCKET:'moztech-main-db-corely-wms-dev',
 ECOUNT_REFERENCE_OBJECT:'reference/official.json', ECOUNT_REFERENCE_SUPPLEMENT_OBJECT:'reference/supplements/fixture.json'};
const base = {capturedAt:'2026-09-16', source:'ECOUNT fixture',
 products:[{erp_sku:'EXISTING', barcode:'5901234123457', product_name:'原有商品', spec:'', active:true}]};
const first = {erpSku:'ITEM01', barcode:'4006381333931', productName:'測試新品', confirmed:true};
const second = {erpSku:'ITEM02', barcode:'73513537', productName:'測試第二款', confirmed:true};
const admin = {id:12, role:'admin'};
const code = n => Object.assign(new Error(String(n)), {code:n});

function harness() {
 const objects = new Map(), writes = [];
 let nextGeneration = 1;
 function put(key, value) {
  objects.set(key, {generation:nextGeneration++, bytes:Buffer.from(JSON.stringify(value))});
 }
 put(env.ECOUNT_REFERENCE_OBJECT, base);
 const file = (key, options = {}) => ({
  async getMetadata() {
   if (!objects.has(key)) throw code(404);
   return [{generation:String(objects.get(key).generation)}];
  },
  async download() {
   const data = objects.get(key);
   if (!data || (options.generation && options.generation !== data.generation)) throw code(404);
   return [data.bytes];
  },
  async save(body, options) {
   const current = objects.get(key)?.generation || 0;
   if (options.preconditionOpts?.ifGenerationMatch !== current) throw code(412);
   writes.push(key);
   put(key, JSON.parse(body));
  },
 });
 const storage = {bucket:() => ({file})};
 const reader = () => createReferenceReader({env, storage});
 const store = createSupplementCatalog({env, storage});
 return {objects, writes, reader, store, put, storage};
}

test('registration supports all four GTIN lengths including leading zeroes and validates the check digit', () => {
 for (const valid of ['73513537', '036000291452', '4006381333931', '10012345000017']) expect(validGtin(valid)).toBe(true);
 for (const bad of [null, 73513537, '00000000', '73513538', '400638133393', '04006381333931 ']) expect(validGtin(bad)).toBe(false);
});

test('fresh readers, existing readers and save validation share a generation-pinned catalog', async () => {
 const h = harness(), read = h.reader(), original = h.objects.get(env.ECOUNT_REFERENCE_OBJECT);
 expect((await lookupProducts([first.barcode], read)).products[first.barcode].status).toBe('missing');
 expect(await h.store.register(first, admin.id)).toMatchObject({created:true});
 for (const reader of [read, h.reader()]) {
  const match = await lookupProducts([first.erpSku, first.barcode], reader);
  expect(match.sync).toMatchObject({created_at:base.capturedAt, base_product_count:1, product_count:2, supplement_updated_at:expect.any(String)});
  expect(match.products[first.barcode]).toMatchObject({status:'matched', matches:[{erp_sku:first.erpSku, active:true}]});
  expect(match.products[first.erpSku].matches[0]).not.toHaveProperty('registeredBy');
  await expect(verifyCatalogMappings(null, {skuMappings:{[first.barcode]:{erpSku:first.erpSku}}}, [first.barcode], reader)).resolves.toBeUndefined();
 }
 expect(JSON.parse(h.objects.get(env.ECOUNT_REFERENCE_SUPPLEMENT_OBJECT).bytes).products[0]).toMatchObject({registeredBy:'12'});
 expect(h.objects.get(env.ECOUNT_REFERENCE_OBJECT)).toBe(original);
 expect((await h.store.register(first, 15)).created).toBe(false);
 expect(h.writes).toEqual([env.ECOUNT_REFERENCE_SUPPLEMENT_OBJECT]);
});

test('concurrent distinct submissions persist both; racing identical submissions only create one record', async () => {
 const h = harness();
 const submissions = await Promise.all([h.store.register(first,12), h.store.register(second,13), h.store.register(first,14)]);
 expect(submissions.filter(s => s.created)).toHaveLength(2);
 expect((await h.reader()()).products).toHaveLength(3);
});

test('conflicting SKU, barcode, inactive base, names or damaged identifiers cannot write', async () => {
 const h = harness();
 await h.store.register(first,12);
 const rules = [{...first,productName:'另一品'}, {...first,erpSku:'OTHER'}, {...first,barcode:second.barcode},
  {...first,erpSku:base.products[0].barcode}, {...first,erpSku:first.barcode}];
 for (const value of rules) await expect(h.store.register(value,12)).rejects.toMatchObject({status:409});
 for (const value of [{...first,erpSku:'1.2E13'}, {...first,barcode:'00000000'}, {...first,confirmed:false},
  {...first,erpSku:'__proto__'}, {...first,productName:''}]) await expect(h.store.register(value,12)).rejects.toMatchObject({status:400});
 const inactive = {...base.products[0],active:false};
 h.put(env.ECOUNT_REFERENCE_OBJECT, {...base,products:[inactive]});
 await expect(h.store.register({erpSku:inactive.erp_sku,barcode:inactive.barcode,productName:inactive.product_name,confirmed:true},12)).rejects.toMatchObject({status:409});
 expect(h.writes).toHaveLength(1);
});

test('an official update absorbs exact matches, quarantines changed and cross-key products, and preserves unrelated availability', async () => {
 const h = harness(), read = h.reader();
 await h.store.register(first,12);
 const official = {erp_sku:first.erpSku, barcode:first.barcode, product_name:first.productName, active:true, spec:'ERP 規格'};
 h.put(env.ECOUNT_REFERENCE_OBJECT,{...base, products:[...base.products, official]});
 expect((await read()).products).toEqual([...base.products,official]);
 h.put(env.ECOUNT_REFERENCE_OBJECT,{...base, products:[...base.products,{...official,erp_sku:'NEW-CODE'}]});
 const {products} = await lookupProducts([first.erpSku,first.barcode,'NEW-CODE','EXISTING'],read);
 for (const key of [first.erpSku,first.barcode,'NEW-CODE']) expect(products[key].status).toBe('ambiguous');
 expect(products.EXISTING.status).toBe('matched');
 await expect(verifyCatalogMappings(null,{skuMappings:{'unrelated-store-code':{erpSku:'NEW-CODE'}}},['unrelated-store-code'],read)).rejects.toThrow();
});

test('role, verified ERP grant, explicit DEV environment, confirmation and revision protect the write route', async () => {
 const h = harness(), reader=h.reader(), app=express();
 app.use(express.json());
 let user = {id:12,role:'dispatcher',permissions:['wms_admin'],erpSubject:'erp-12'}, verified = false;
 app.use((req,_res,next)=>{req.user=user; if(verified) req.erpSession={}; next();});
 app.use('/products',createProductRouter({reader,env,supplement:h.store}));
 const resolve=()=>request(app).post('/products/resolve').send({skus:[first.barcode]});
 const submit=()=>request(app).post('/products/register').send(first);
 expect((await resolve()).body.sync.can_register).toBe(false);
 await submit().expect(403);
 verified=true;
 expect((await resolve()).body.sync.can_register).toBe(true);
 await submit().expect(201);
 user=admin;
 await submit().expect(200);
 user={...admin,role:'picker'};
 await submit().expect(403);
 expect(h.writes).toHaveLength(1);
 for (const off of [{K_SERVICE:'corely-wms'}, {GCS_BUCKET:'prod'}, {ECOUNT_REFERENCE_SUPPLEMENT_OBJECT:env.ECOUNT_REFERENCE_OBJECT}, {ECOUNT_REFERENCE_SUPPLEMENT_OBJECT:''}]) {
  const disabled={...env,...off};
  await expect(createSupplementCatalog({env:disabled,storage:h.storage}).register(second,12)).rejects.toMatchObject({status:403});
  expect(syncForUser({created_at:'2026-09-16'}, {user:admin}, disabled)).not.toHaveProperty('can_register');
 }
});

test('preview exposes registration to the current caller without leaking the capability to a cached response', async () => {
 const previous = {};
 for (const key of Object.keys(env)) { previous[key] = process.env[key]; process.env[key] = env[key]; }
 try {
  const prepared = {parsed:{items:[]}, output:{ok:false}, catalog:{products:{},sync:{source_note:'local'}}};
  const app = express();
  let role='admin';
  app.use((req,_res,next)=>{req.user={id:12,role}; next();});
  app.use(createMarketplaceRouter({pool:{}, prepareMarketplace:async()=>prepared}));
  expect((await request(app).post('/preview')).body.catalog.sync.can_register).toBe(true);
  role='dispatcher';
  expect((await request(app).post('/preview')).body.catalog.sync.can_register).toBe(false);
  expect(prepared.catalog.sync).not.toHaveProperty('can_register');
 } finally {
  for (const [key,value] of Object.entries(previous)) {
   if (value === undefined) delete process.env[key]; else process.env[key]=value;
  }
 }
});

test('an inaccessible or malformed supplement cannot be mistaken for a missing file', async () => {
 const h = harness();
 h.put(env.ECOUNT_REFERENCE_SUPPLEMENT_OBJECT, {schemaVersion:1,products:[{}]});
 await expect(h.store.register(first,12)).rejects.toMatchObject({status:503});
 await expect(h.reader()()).rejects.toMatchObject({status:503});
 const denied = {bucket:()=>({file:()=>({getMetadata:async()=>{throw code(403);}})})};
 await expect(createSupplementCatalog({env,storage:denied}).register(first,12)).rejects.toMatchObject({status:503});
 expect(h.writes).toHaveLength(0);
});

test('different widths of one GTIN conflict without rewriting exact ERP SKUs or matching zero-padded input', async () => {
 const h = harness();
 const upc='036000291452', ean='0036000291452';
 const existing={...base.products[0],erp_sku:'007',barcode:upc};
 h.put(env.ECOUNT_REFERENCE_OBJECT,{...base,products:[existing]});
 await expect(h.store.register({...first,barcode:ean},12)).rejects.toMatchObject({status:409});
 await expect(h.store.register({...first,erpSku:'7'},12)).resolves.toMatchObject({created:true});
 const exact=await lookupProducts(['007','7',ean],h.reader());
 expect(exact.products['007'].matches[0].barcode).toBe(upc);
 expect(exact.products['7'].matches[0].barcode).toBe(first.barcode);
 expect(exact.products[ean].status).toBe('missing');
 h.put(env.ECOUNT_REFERENCE_OBJECT,{...base,products:[{...existing,barcode:'0'+first.barcode}]});
 const collision=await lookupProducts(['007','7'],h.reader());
 expect(collision.products['007'].status).toBe('ambiguous');
 expect(collision.products['7'].status).toBe('ambiguous');
});
