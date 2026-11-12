const {createShopifyOrderVerifier}=require('../services/shopifyOrderVerification');
const {resolveShopifyStore,publicStoreSelection}=require('../services/shopifyStoreRouting');
const rows=[['Name','Id','Lineitem sku','Lineitem quantity','Lineitem price'],['FU1053','101','SKU-A','1','100'],['FU1054','102','SKU-B','1','200']];
const connections=[{id:'first',shop:'first.myshopify.com',token:'SECRET-FIRST'},{id:'second',shop:'second.myshopify.com',token:'SECRET-SECOND'}];
const profile=(id,connection,extra={})=>({id,platform:'Shopify',store:`匿名店${id}`,updated_at:'2026-11-03T00:00:00Z',settings:{apiConnectionId:connection,shopifyShop:connections.find(c=>c.id===connection)?.shop,...extra}});
function harness(membership,profiles=[profile(1,'first'),profile(2,'second')],extra={}){
 const fetchImpl=jest.fn(async(url,options)=>{const shop=new URL(url).hostname;const body=JSON.parse(options.body);const ids=body.variables.ids;
  if(membership[shop] instanceof Error)throw membership[shop];
  return {ok:true,text:async()=>JSON.stringify({data:{shop:{myshopifyDomain:shop},nodes:ids.map(id=>membership[shop]?.includes(id.split('/').pop())?{id,name:id.endsWith('/101')?'FU1053':'FU1054'}:null)}})};
 });
 const verifier=createShopifyOrderVerifier({env:{},connections,fetchImpl,...extra});
 return {fetchImpl,verifier,resolve:(input={})=>resolveShopifyStore({rows,profiles,input,verifier})};
}
test('anonymous FU file resolves the unique full ID and name match before detailed verification',async()=>{
 const h=harness({'first.myshopify.com':[],'second.myshopify.com':['101','102']});
 const r=await h.resolve({settings:{apiConnectionId:'first',shopifyShop:'first.myshopify.com'}});
 expect(r.profile.id).toBe(2);expect(r.context).toMatchObject({apiConnectionId:'second',shopifyShop:'second.myshopify.com',profileId:'2'});
 expect(h.fetchImpl).toHaveBeenCalledTimes(2);
 for(const [,options] of h.fetchImpl.mock.calls){const body=JSON.parse(options.body);expect(body.variables.ids).toEqual(['gid://shopify/Order/101','gid://shopify/Order/102']);expect(body.query).not.toMatch(/shippingAddress|lineItems|email|phone/);}
});
test('explicit wrong profile never falls back to the other store',async()=>{
 const h=harness({'first.myshopify.com':[],'second.myshopify.com':['101','102']});
 await expect(h.resolve({profileId:'1'})).rejects.toMatchObject({status:409,code:'MARKETPLACE_STORE_SELECTION_REQUIRED',storeSelection:{reason:'not_found'}});
 expect(h.fetchImpl).toHaveBeenCalledTimes(1);expect(h.fetchImpl.mock.calls[0][0]).toContain('first.myshopify.com');
});
test('same connection with distinct ERP profiles remains ambiguous',async()=>{
 const h=harness({'second.myshopify.com':['101','102']},[profile(2,'second'),profile(3,'second',{customerCode:'DIFFERENT'})]);
 await expect(h.resolve()).rejects.toMatchObject({storeSelection:{reason:'ambiguous',choices:[{id:'2'},{id:'3'}]}});expect(h.fetchImpl).toHaveBeenCalledTimes(1);
});
test('one complete store and one unknown authority does not pretend there is a unique match',async()=>{
 const h=harness({'first.myshopify.com':new Error('SECRET-UPSTREAM'),'second.myshopify.com':['101','102']});
 await expect(h.resolve()).rejects.toMatchObject({storeSelection:{reason:'connection_unavailable'}});
 expect(JSON.stringify(await h.resolve().catch(e=>e))).not.toContain('SECRET');
 // A person can explicitly choose the working persisted binding.
 expect((await h.resolve({profileId:'2'})).profile.id).toBe(2);
});
test('orders belonging to two stores cannot be silently split or converted',async()=>{
 const h=harness({'first.myshopify.com':['101'],'second.myshopify.com':['102']});
 await expect(h.resolve()).rejects.toMatchObject({storeSelection:{reason:'mixed_stores'}});
});
test('all matching IDs also require exact names',async()=>{
 const h=harness({'first.myshopify.com':[],'second.myshopify.com':['101','102']});
 h.fetchImpl.mockImplementation(async()=>({ok:true,text:async()=>JSON.stringify({data:{shop:{myshopifyDomain:'second.myshopify.com'},nodes:[{id:'gid://shopify/Order/101',name:'OTHER'},{id:'gid://shopify/Order/102',name:'FU1054'}]}})}));
 await expect(h.resolve({profileId:'2'})).rejects.toMatchObject({storeSelection:{reason:'not_found'}});
});
test('binding requires both persisted connection and domain to agree, without fallback',async()=>{
 const h=harness({},[profile(2,'second',{shopifyShop:'first.myshopify.com'})]);
 await expect(h.resolve({profileId:'2',settings:{apiConnectionId:'first'}})).rejects.toMatchObject({storeSelection:{reason:'connection_unavailable'}});expect(h.fetchImpl).not.toHaveBeenCalled();
});
test('public registry supports environment token references and never returns credentials',()=>{
 const v=createShopifyOrderVerifier({env:{WMS_SHOPIFY_CONNECTIONS_JSON:JSON.stringify([{id:'second',shop:'second.myshopify.com',tokenEnv:'WMS_SHOPIFY_SECOND_ACCESS_TOKEN'}]),WMS_SHOPIFY_SECOND_ACCESS_TOKEN:'SECRET'}});
 expect(v.listConnections()).toEqual([{id:'second',shop:'second.myshopify.com',ready:true}]);expect(JSON.stringify(v.listConnections())).not.toMatch(/SECRET|tokenEnv/);
});
test.each([
 'not-json',JSON.stringify([{id:'x',shop:'bad/host',token:'SECRET'}]),
 JSON.stringify([{id:'x',shop:'first.myshopify.com',tokenEnv:'OTHER_SECRET'}]),
 JSON.stringify([{id:'x',shop:'first.myshopify.com',token:'SECRET'},{id:'x',shop:'second.myshopify.com',token:'SECRET'}]),
 JSON.stringify([{id:'x',shop:'first.myshopify.com',token:'SECRET'},{id:'y',shop:'first.myshopify.com',token:'SECRET'}])
])('invalid registry is generic and never leaks raw JSON: %s',raw=>{
 const v=createShopifyOrderVerifier({env:{WMS_SHOPIFY_CONNECTIONS_JSON:raw}});
 expect(()=>v.listConnections()).toThrow('Shopify 店鋪連線設定無效');try{v.listConnections();}catch(e){expect(e.message).not.toContain('SECRET');}
});
test('missing token is an unavailable connection, never an authoritative empty result',async()=>{
 const h=harness({},[profile(2,'second')],{connections:[{id:'second',shop:'second.myshopify.com',token:''}]});
 await expect(h.resolve()).rejects.toMatchObject({storeSelection:{reason:'connection_unavailable',choices:[{connectionReady:false}]}});expect(h.fetchImpl).not.toHaveBeenCalled();
});
test('no profiles requires store setup instead of assuming ERP ownership',async()=>{
 const h=harness({},[]);await expect(h.resolve()).rejects.toMatchObject({storeSelection:{reason:'not_configured',choices:[]}});expect(h.fetchImpl).not.toHaveBeenCalled();
});
test('public selection whitelist strips arbitrary nested fields',()=>{
 expect(publicStoreSelection({platform:'Shopify',reason:'ambiguous',token:'SECRET',choices:[{id:2,platform:'Shopify',store:'匿名店',shop:'second.myshopify.com',connectionReady:true,token:'SECRET',tokenEnv:'PRIVATE'}]})).toEqual({platform:'Shopify',reason:'ambiguous',choices:[{id:'2',platform:'Shopify',store:'匿名店',shop:'second.myshopify.com',connectionReady:true}]});
});
test.each(['{}','{"oops":1}','"text"','1','null'])('invalid explicit registry cannot silently fall back to a configured legacy store: %s',raw=>{
 const v=createShopifyOrderVerifier({env:{WMS_SHOPIFY_CONNECTIONS_JSON:raw,WMS_SHOPIFY_SHOP:'first.myshopify.com',WMS_SHOPIFY_ACCESS_TOKEN:'SECRET'}});
 expect(()=>v.listConnections()).toThrow('Shopify 店鋪連線設定無效');
});
test('only a genuine singleton legacy global can bind an old profile without an explicit store binding',async()=>{
 const h=harness({},[{id:1,platform:'Shopify',store:'匿名店',settings:{}}],{connections:[{id:'legacy',shop:'second.myshopify.com',token:'SECRET'}]});
 await expect(h.resolve()).rejects.toMatchObject({storeSelection:{reason:'connection_unavailable'}});expect(h.fetchImpl).not.toHaveBeenCalled();
});
test('wrong returned shop, partial GraphQL errors, and missing nodes are unknown instead of authoritative no-match',async()=>{
 for(const payload of [
  {data:{shop:{myshopifyDomain:'wrong.myshopify.com'},nodes:[null,null]}},
  {data:{shop:{myshopifyDomain:'second.myshopify.com'},nodes:[null,null]},errors:[{message:'SECRET ERROR',extensions:{code:'ACCESS_DENIED'}}]},
  {data:{shop:{myshopifyDomain:'second.myshopify.com'}}}
 ]){
  const h=harness({},[profile(2,'second')]);h.fetchImpl.mockResolvedValue({ok:true,text:async()=>JSON.stringify(payload)});
  await expect(h.resolve()).rejects.toMatchObject({storeSelection:{reason:'connection_unavailable'}});
 }
});
test('probe deadline is bounded and failure is not cached as an empty shop',async()=>{
 jest.useFakeTimers();
 try{
  const h=harness({},[profile(2,'second')]);h.fetchImpl.mockImplementation(()=>new Promise(()=>{}));
  const result=h.resolve().catch(error=>error);await jest.advanceTimersByTimeAsync(5001);
  expect(await result).toMatchObject({storeSelection:{reason:'connection_unavailable'}});
  h.fetchImpl.mockImplementation(async()=>({ok:true,text:async()=>JSON.stringify({data:{shop:{myshopifyDomain:'second.myshopify.com'},nodes:[{id:'gid://shopify/Order/101',name:'FU1053'},{id:'gid://shopify/Order/102',name:'FU1054'}]}})}));
  expect((await h.resolve()).profile.id).toBe(2);expect(h.fetchImpl).toHaveBeenCalledTimes(2);
 }finally{jest.useRealTimers();}
});
test('an explicitly selected store surfaces its lookup timeout as retryable, without probing other stores',async()=>{
 const h=harness({},[profile(2,'second')]);
 h.fetchImpl.mockImplementation(()=>new Promise(()=>{}));
 jest.useFakeTimers();
 try{
  const result=resolveShopifyStore({rows,profiles:[profile(2,'second')],input:{profileId:'2'},verifier:h.verifier,deadline:Date.now()+100}).catch(error=>error);
  await jest.advanceTimersByTimeAsync(101);
  expect(await result).toMatchObject({status:503,code:'SHOPIFY_TIMEOUT'});
  expect(h.fetchImpl).toHaveBeenCalledTimes(1);
 }finally{jest.useRealTimers();}
});
test('source ID errors remain input errors and do not trigger an API request',async()=>{
 const h=harness({},[profile(2,'second')]),invalid=rows.map(row=>[...row]);invalid[1][1]='not-an-id';
 await expect(resolveShopifyStore({rows:invalid,profiles:[profile(2,'second')],input:{profileId:'2'},verifier:h.verifier})).rejects.toMatchObject({code:'SHOPIFY_SOURCE_ID_INVALID',status:400});expect(h.fetchImpl).not.toHaveBeenCalled();
});
test('credential rotation invalidates probe cache without exposing the token in routing evidence',async()=>{
 const env={WMS_SHOPIFY_CONNECTIONS_JSON:JSON.stringify([{id:'second',shop:'second.myshopify.com',tokenEnv:'WMS_SHOPIFY_SECOND_ACCESS_TOKEN'}]),WMS_SHOPIFY_SECOND_ACCESS_TOKEN:'SECRET-BEFORE'};
 const h=harness({'second.myshopify.com':['101','102']},[profile(2,'second')],{env,connections:undefined});
 const first=await h.resolve();await h.resolve();expect(h.fetchImpl).toHaveBeenCalledTimes(1);const before=h.verifier.registryFingerprint();
 env.WMS_SHOPIFY_SECOND_ACCESS_TOKEN='SECRET-AFTER';const after=await h.resolve();expect(h.verifier.registryFingerprint()).not.toBe(before);expect(h.fetchImpl).toHaveBeenCalledTimes(2);
 expect(after.context).toEqual(first.context);expect(JSON.stringify(after)).not.toContain('SECRET');
});
