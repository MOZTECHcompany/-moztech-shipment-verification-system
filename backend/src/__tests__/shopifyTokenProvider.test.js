const {createConnectionRegistry}=require('../services/shopifyStoreRouting');
const {createShopifyTokenProvider}=require('../services/shopifyTokenProvider');
const entry={id:'second',shop:'second.myshopify.com',authKind:'client_credentials',clientIdEnv:'WMS_SHOPIFY_SECOND_CLIENT_ID',clientSecretEnv:'WMS_SHOPIFY_SECOND_CLIENT_SECRET'};
const context={apiConnectionId:'second',shopifyShop:'second.myshopify.com'};
const reply=(token='ANONYMOUS-TOKEN',expires=100,extra={})=>({ok:true,status:200,text:async()=>JSON.stringify({access_token:token,expires_in:expires,scope:'read_orders,read_products',...extra})});
function harness(extra={}){
 const env={WMS_SHOPIFY_SECOND_CLIENT_ID:'ANONYMOUS-ID',WMS_SHOPIFY_SECOND_CLIENT_SECRET:'ANONYMOUS-SECRET',...extra.env},registry=createConnectionRegistry({env,connections:extra.connections||[entry]});let now=1000;
 const fetchImpl=jest.fn(async()=>reply()),provider=createShopifyTokenProvider({getConnection:registry.connection,fetchImpl,now:()=>now,...extra.provider});
 return {env,registry,fetchImpl,provider,setNow:value=>{now=value;}};
}
test('own-store grant uses one fixed HTTPS host and form credentials without scope or redirect fallback',async()=>{
 const h=harness();expect(await h.provider.getToken(context)).toBe('ANONYMOUS-TOKEN');
 const [url,options]=h.fetchImpl.mock.calls[0];expect(url).toBe('https://second.myshopify.com/admin/oauth/access_token');expect(options).toMatchObject({method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'}});
 const body=new URLSearchParams(options.body);expect(Object.fromEntries(body)).toEqual({grant_type:'client_credentials',client_id:'ANONYMOUS-ID',client_secret:'ANONYMOUS-SECRET'});expect(options.headers).not.toHaveProperty('X-Shopify-Access-Token');
 expect(h.registry.publicList()).toEqual([{id:'second',platform:'Shopify',shop:'second.myshopify.com',connectionReady:true,authKind:'client_credentials'}]);expect(JSON.stringify(h.registry.publicList())).not.toMatch(/ANONYMOUS|Env|secret|token/);
});
test('expiry follows actual expires_in and refreshes early without a fixed 24-hour assumption',async()=>{
 const h=harness();h.fetchImpl.mockResolvedValueOnce(reply('FIRST',100)).mockResolvedValueOnce(reply('SECOND',100));
 expect(await h.provider.getToken(context)).toBe('FIRST');h.setNow(90000);expect(await h.provider.getToken(context)).toBe('FIRST');h.setNow(91000);expect(await h.provider.getToken(context)).toBe('SECOND');expect(h.fetchImpl).toHaveBeenCalledTimes(2);
});
test('concurrent reads share one acquisition but separate stores never share tokens',async()=>{
 const other={...entry,id:'third',shop:'third.myshopify.com',clientIdEnv:'WMS_SHOPIFY_THIRD_CLIENT_ID',clientSecretEnv:'WMS_SHOPIFY_THIRD_CLIENT_SECRET'};
 const h=harness({connections:[entry,other],env:{WMS_SHOPIFY_THIRD_CLIENT_ID:'THIRD-ID',WMS_SHOPIFY_THIRD_CLIENT_SECRET:'THIRD-SECRET'}});
 let finish;h.fetchImpl.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce(reply('THIRD-TOKEN'));
 const a=h.provider.getToken(context),b=h.provider.getToken(context);expect(await h.provider.getToken({apiConnectionId:'third',shopifyShop:'third.myshopify.com'})).toBe('THIRD-TOKEN');finish(reply('SECOND-TOKEN'));expect(await Promise.all([a,b])).toEqual(['SECOND-TOKEN','SECOND-TOKEN']);expect(h.fetchImpl).toHaveBeenCalledTimes(2);
});
test('secret rotation invalidates cached and in-flight grants instead of lending the old secret token',async()=>{
 const h=harness();let finish;h.fetchImpl.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce(reply('ROTATED-TOKEN'));
 const pending=h.provider.getToken(context).catch(error=>error);h.env.WMS_SHOPIFY_SECOND_CLIENT_SECRET='ROTATED-SECRET';expect(await h.provider.getToken(context)).toBe('ROTATED-TOKEN');finish(reply('OLD-TOKEN'));expect(await pending).toMatchObject({code:'SHOPIFY_AUTH_CHANGED',status:503});expect(await h.provider.getToken(context)).toBe('ROTATED-TOKEN');expect(h.fetchImpl).toHaveBeenCalledTimes(2);
});
test('expired and denied renewal fails closed and never returns the previously valid token',async()=>{
 const h=harness();h.fetchImpl.mockResolvedValueOnce(reply('FIRST',1)).mockResolvedValueOnce({ok:false,status:401,text:async()=>JSON.stringify({error:'invalid_grant',secret:'ANONYMOUS-SECRET'})});await h.provider.getToken(context);h.setNow(2001);
 const error=await h.provider.getToken(context).catch(value=>value);expect(error).toMatchObject({code:'SHOPIFY_AUTH_DENIED',status:503});expect(error.message).not.toMatch(/SECRET|FIRST|invalid_grant/);
});
test.each([
 {expires_in:0},{expires_in:'86399'},{access_token:''},{access_token:'ANONYMOUS-SECRET'},{scope:'read_orders'},{scope:'read_orders,read_products,write_orders'},{error:'invalid_grant'},
])('invalid or broader grant never becomes an API credential: %j',async extra=>{
 const h=harness();h.fetchImpl.mockResolvedValue(reply('ANONYMOUS-TOKEN',100,extra));await expect(h.provider.getToken(context)).rejects.toMatchObject({status:503});
});
test('credential pair is restricted to env-name refs and is never a static access token',()=>{
 for(const value of [{...entry,tokenEnv:'WMS_SHOPIFY_SECOND_ACCESS_TOKEN'},{...entry,clientSecretEnv:'OTHER_SECRET'},{...entry,clientIdEnv:'OTHER_ID'},{...entry,authKind:'unknown'},{...entry,clientSecret:'ANONYMOUS-SECRET'}]){
  expect(()=>harness({connections:[value]}).registry.list()).toThrow('Shopify 店鋪連線設定無效');
 }
});
test('a grant timeout is bounded even if fetch never settles',async()=>{
 jest.useFakeTimers();try{const h=harness();h.fetchImpl.mockImplementation(()=>new Promise(()=>{}));const result=h.provider.getToken(context).catch(error=>error);await jest.advanceTimersByTimeAsync(5001);expect(await result).toMatchObject({code:'SHOPIFY_AUTH_TIMEOUT',status:503});}finally{jest.useRealTimers();}
});
test('streaming response size is bounded and cancellation prevents oversized token bodies',async()=>{
 const h=harness(),cancel=jest.fn(),read=jest.fn().mockResolvedValue({done:false,value:Buffer.alloc(16385)});h.fetchImpl.mockResolvedValue({ok:true,status:200,body:{getReader:()=>({read,cancel,releaseLock:jest.fn()})}});
 await expect(h.provider.getToken(context)).rejects.toMatchObject({code:'SHOPIFY_AUTH_RESPONSE_INVALID'});expect(cancel).toHaveBeenCalledTimes(1);expect(read).toHaveBeenCalledTimes(1);
});
test('401 invalidation removes only the exact token used, never a newer cached token',async()=>{
 const h=harness();h.fetchImpl.mockResolvedValueOnce(reply('FIRST')).mockResolvedValueOnce(reply('SECOND'));await h.provider.getToken(context);h.provider.invalidate(context,'FIRST');expect(await h.provider.getToken(context)).toBe('SECOND');h.provider.invalidate(context,'FIRST');expect(await h.provider.getToken(context)).toBe('SECOND');expect(h.fetchImpl).toHaveBeenCalledTimes(2);
});
test('legacy static access token behavior requires no OAuth request',async()=>{
 const h=harness({connections:[{id:'first',shop:'first.myshopify.com',token:'STATIC-TOKEN'}]});expect(await h.provider.getToken({apiConnectionId:'first',shopifyShop:'first.myshopify.com'})).toBe('STATIC-TOKEN');expect(h.fetchImpl).not.toHaveBeenCalled();
});
test('a token arriving after timeout cannot populate the cache for a later request',async()=>{
 jest.useFakeTimers();try{
  const h=harness();let finish;h.fetchImpl.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce(reply('FRESH-TOKEN'));
  const first=h.provider.getToken(context).catch(error=>error);await jest.advanceTimersByTimeAsync(5001);expect(await first).toMatchObject({code:'SHOPIFY_AUTH_TIMEOUT'});finish(reply('LATE-TOKEN'));await Promise.resolve();await Promise.resolve();expect(await h.provider.getToken(context)).toBe('FRESH-TOKEN');expect(h.fetchImpl).toHaveBeenCalledTimes(2);
 }finally{jest.useRealTimers();}
});
test('clock rollback discards cached tokens and requires a new explicit acquisition',async()=>{
 const h=harness();h.fetchImpl.mockResolvedValueOnce(reply('BEFORE')).mockResolvedValueOnce(reply('AFTER'));await h.provider.getToken(context);h.setNow(500);await expect(h.provider.getToken(context)).rejects.toMatchObject({code:'SHOPIFY_AUTH_CLOCK_CHANGED'});expect(h.fetchImpl).toHaveBeenCalledTimes(1);expect(await h.provider.getToken(context)).toBe('AFTER');expect(h.fetchImpl).toHaveBeenCalledTimes(2);
});
test('clock rollback also invalidates pending flights and prevents a late old token from caching',async()=>{
 const h=harness();let finish;h.fetchImpl.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce(reply('AFTER'));
 const first=h.provider.getToken(context).catch(error=>error);h.setNow(500);await expect(h.provider.getToken(context)).rejects.toMatchObject({code:'SHOPIFY_AUTH_CLOCK_CHANGED'});expect(await h.provider.getToken(context)).toBe('AFTER');finish(reply('BEFORE'));expect(await first).toMatchObject({code:'SHOPIFY_AUTH_CLOCK_CHANGED'});expect(await h.provider.getToken(context)).toBe('AFTER');expect(h.fetchImpl).toHaveBeenCalledTimes(2);
});
