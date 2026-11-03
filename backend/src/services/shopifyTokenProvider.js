const {createHash}=require('node:crypto');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const error=(code,message='Shopify 讀單授權暫時無法使用，請核對專用 App 授權')=>Object.assign(new Error(message),{status:503,code});
const identity=connection=>hash([connection.id,connection.shop,connection.apiVersion,connection.authKind,connection.clientId,connection.clientSecret]);
const MAX_BYTES=16384;

async function boundedBody(response){
 if(Number(response.headers?.get?.('content-length'))>MAX_BYTES)throw error('SHOPIFY_AUTH_RESPONSE_INVALID');
 if(response.body?.getReader){
  const reader=response.body.getReader(),parts=[];let size=0;
  try{for(;;){const chunk=await reader.read();if(chunk.done)break;const bytes=Buffer.from(chunk.value);size+=bytes.length;if(size>MAX_BYTES){await reader.cancel();throw error('SHOPIFY_AUTH_RESPONSE_INVALID');}parts.push(bytes);}return Buffer.concat(parts).toString('utf8');}
  finally{reader.releaseLock?.();}
 }
 const raw=await response.text();if(Buffer.byteLength(raw,'utf8')>MAX_BYTES)throw error('SHOPIFY_AUTH_RESPONSE_INVALID');return raw;
}

// Access tokens and client credentials stay in server memory only. No DTO,
// filesystem, browser, logging, or business-data operation uses this cache.
function createShopifyTokenProvider({getConnection,fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=5000}={}){
 if(typeof getConnection!=='function'||typeof fetchImpl!=='function'||typeof now!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw error('SHOPIFY_AUTH_CONFIG_INVALID');
 const cache=new Map(),flights=new Map();
 let lastNow=null,epoch=0;
 function clock(){
  const value=now();
  if(!Number.isSafeInteger(value)||value<0||lastNow!==null&&value<lastNow){lastNow=Number.isSafeInteger(value)&&value>=0?value:null;epoch++;cache.clear();flights.clear();throw error('SHOPIFY_AUTH_CLOCK_CHANGED','伺服器時間已變更，請重新核對讀單授權');}
  lastNow=value;return value;
 }
 async function acquire(connection,context,key,generation){
  const started=clock(),controller=new AbortController();let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(error('SHOPIFY_AUTH_TIMEOUT','Shopify 讀單授權逾時，請稍後重試'));},timeoutMs);});
  try{return await Promise.race([timeout,(async()=>{
   let response;try{response=await fetchImpl(`https://${connection.shop}/admin/oauth/access_token`,{method:'POST',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},body:new URLSearchParams({grant_type:'client_credentials',client_id:connection.clientId,client_secret:connection.clientSecret}).toString()});}catch{throw error('SHOPIFY_AUTH_UNAVAILABLE');}
   if(!response.ok)throw error(response.status===400||response.status===401||response.status===403?'SHOPIFY_AUTH_DENIED':'SHOPIFY_AUTH_UNAVAILABLE');
   let value;try{value=JSON.parse(await boundedBody(response));}catch(e){if(e.code==='SHOPIFY_AUTH_RESPONSE_INVALID')throw e;throw error('SHOPIFY_AUTH_RESPONSE_INVALID');}
   if(value?.error)throw error('SHOPIFY_AUTH_DENIED');
   const token=value?.access_token,seconds=value?.expires_in;
   if(typeof token!=='string'||!token||token.length>4096||token!==token.trim()||/[\u0000-\u0020\u007f]/.test(token)||token===connection.clientSecret||token===connection.clientId||!Number.isSafeInteger(seconds)||seconds<1||seconds>31536000)throw error('SHOPIFY_AUTH_RESPONSE_INVALID');
   const scopes=typeof value.scope==='string'?value.scope.split(',').map(scope=>scope.trim()).filter(Boolean):[];
   if(scopes.length!==2||new Set(scopes).size!==2||!scopes.includes('read_orders')||!scopes.includes('read_products'))throw error('SHOPIFY_AUTH_SCOPE_INVALID','Shopify 專用 App 必須僅授權讀取訂單與商品，請核對授權範圍');
   if(controller.signal.aborted)throw error('SHOPIFY_AUTH_TIMEOUT');
   const received=clock();if(generation!==epoch)throw error('SHOPIFY_AUTH_CLOCK_CHANGED');
   if(identity(getConnection(context))!==key)throw error('SHOPIFY_AUTH_CHANGED');
   const expiresAt=started+seconds*1000;if(!Number.isSafeInteger(expiresAt)||received>=expiresAt)throw error('SHOPIFY_AUTH_RESPONSE_INVALID');
   const valueToCache={id:connection.id,token,issuedAt:started,expiresAt,renewAt:expiresAt-Math.min(60000,Math.floor(seconds*100))};
   cache.set(key,valueToCache);if(cache.size>16)cache.delete(cache.keys().next().value);return token;
  })()]);}finally{clearTimeout(timer);}
 }
 async function getToken(context={}){
  const connection=getConnection(context);if(connection.authKind!=='client_credentials')return connection.token;
  const time=clock(),key=identity(connection);
  for(const [old,value] of cache)if(value.id===connection.id&&old!==key)cache.delete(old);
  const saved=cache.get(key);if(saved&&time<saved.renewAt)return saved.token;
  cache.delete(key);if(flights.has(key))return flights.get(key);
  const flight=acquire(connection,context,key,epoch);flights.set(key,flight);
  try{return await flight;}finally{if(flights.get(key)===flight)flights.delete(key);}
 }
 function invalidate(context,usedToken){
  try{const connection=getConnection(context),key=identity(connection);if(cache.get(key)?.token===usedToken)cache.delete(key);}catch{}
 }
 return {getToken,invalidate};
}
module.exports={createShopifyTokenProvider};
