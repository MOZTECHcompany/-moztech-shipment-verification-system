const {createHash}=require('node:crypto');
const clean=value=>String(value??'').trim();
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const SHOP=/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const REASONS=new Set(['ambiguous','not_found','connection_unavailable','mixed_stores','not_configured']);
const configError=()=>Object.assign(new Error('Shopify 店鋪連線設定無效'),{status:503,code:'SHOPIFY_CONFIG_INVALID'});

// Credentials stay here on the server. Profiles contain only an exact binding.
function createConnectionRegistry({env=process.env,connections}={}){
 function entries(){
  try{
   let configured=connections;
   if(configured===undefined&&clean(env.WMS_SHOPIFY_CONNECTIONS_JSON))configured=JSON.parse(env.WMS_SHOPIFY_CONNECTIONS_JSON);
   if(configured&&!Array.isArray(configured)){
    if(typeof configured!=='object'||!Array.isArray(configured.connections))throw configError();
    configured=configured.connections;
   }
   if(configured===undefined)configured=[];
   if(!Array.isArray(configured)||configured.length>8)throw configError();
   const ids=new Set(),shops=new Set();
   const result=configured.map(value=>{
    if(!value||typeof value!=='object'||Array.isArray(value))throw configError();
    const id=clean(value.id),shop=clean(value.shop).toLowerCase(),apiVersion=value.apiVersion||'2026-07';
    if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(id)||!SHOP.test(shop)||ids.has(id)||shops.has(shop)||!/^20\d{2}-(?:01|04|07|10)$/.test(apiVersion))throw configError();
    const authKind=value.authKind===undefined?'static_token':value.authKind;let auth;
    if(authKind==='client_credentials'){
     if(value.token!==undefined||value.tokenEnv!==undefined||value.clientId!==undefined||value.clientSecret!==undefined||!/^WMS_SHOPIFY_(?:[A-Z0-9_]+_)?CLIENT_ID$/.test(value.clientIdEnv)||!/^WMS_SHOPIFY_(?:[A-Z0-9_]+_)?CLIENT_SECRET$/.test(value.clientSecretEnv)||value.clientIdEnv.replace(/CLIENT_ID$/,'')!==value.clientSecretEnv.replace(/CLIENT_SECRET$/,''))throw configError();
     const clientId=env[value.clientIdEnv],clientSecret=env[value.clientSecretEnv];
     if([clientId,clientSecret].some(v=>v!==undefined&&(typeof v!=='string'||v.length>4096||/[\u0000-\u001f\u007f]/.test(v))))throw configError();
     auth={clientId:clientId||'',clientSecret:clientSecret||'',ready:!!clean(clientId)&&!!clean(clientSecret)};
    }else if(authKind==='static_token'){
     if(value.clientIdEnv!==undefined||value.clientSecretEnv!==undefined||value.clientId!==undefined||value.clientSecret!==undefined||value.tokenEnv!==undefined&&(!/^WMS_SHOPIFY_(?:[A-Z0-9_]+_)?ACCESS_TOKEN$/.test(value.tokenEnv)||value.token!==undefined))throw configError();
     const token=value.tokenEnv?env[value.tokenEnv]:value.token;if(token!==undefined&&typeof token!=='string')throw configError();
     auth={token:token||'',ready:!!clean(token)};
    }else throw configError();
    ids.add(id);shops.add(shop);return {id,shop,apiVersion,authKind,...auth};
   });
   const legacyShop=clean(env.WMS_SHOPIFY_SHOP).toLowerCase();
   if(legacyShop&&!shops.has(legacyShop)){
    if(!SHOP.test(legacyShop)||ids.has('legacy')||result.length>=8)throw configError();
    const token=env.WMS_SHOPIFY_ACCESS_TOKEN||'',apiVersion=env.WMS_SHOPIFY_API_VERSION||'2026-07';
    if(typeof token!=='string'||!/^20\d{2}-(?:01|04|07|10)$/.test(apiVersion))throw configError();
    result.push({id:'legacy',shop:legacyShop,token,apiVersion,authKind:'static_token',ready:!!clean(token),legacy:true});
   }
   return result;
  }catch{throw configError();}
 }
 function connection(context={}){
  const values=entries(),id=clean(context.apiConnectionId),shop=clean(context.shopifyShop).toLowerCase();
  const selected=id?values.find(value=>value.id===id):shop?values.find(value=>value.shop===shop):values.length===1&&values[0].legacy?values[0]:null;
  if(!selected||!selected.ready||shop&&selected.shop!==shop)throw configError();
  return selected;
 }
 return {entries,connection,list:()=>entries().map(({id,shop,ready})=>({id,shop,ready})),publicList:()=>entries().map(({id,shop,ready,authKind})=>({id,platform:'Shopify',shop,connectionReady:ready,authKind})),fingerprint:()=>hash(entries())};
}

function publicStoreSelection(value){
 const reason=REASONS.has(value?.reason)?value.reason:'connection_unavailable';
 return {platform:'Shopify',reason,choices:(Array.isArray(value?.choices)?value.choices:[]).slice(0,16).map(choice=>({
  id:clean(choice.id).slice(0,100),platform:'Shopify',store:clean(choice.store).slice(0,100),
  shop:SHOP.test(clean(choice.shop).toLowerCase())?clean(choice.shop).toLowerCase():'',connectionReady:choice.connectionReady===true,
 }))};
}
function selectionError(reason,choices){
 const messages={ambiguous:'多個店鋪符合這份訂單，請選擇正確店鋪',not_found:'已設定的店鋪找不到完整訂單，請確認來源店鋪',connection_unavailable:'店鋪連線尚未完成或暫時無法核對，請選擇已授權的店鋪',mixed_stores:'這份檔案包含不同店鋪的訂單，請分店匯出',not_configured:'請先完成來源店鋪的連線與轉檔設定'};
 return Object.assign(new Error(messages[reason]),{status:409,code:'MARKETPLACE_STORE_SELECTION_REQUIRED',storeSelection:publicStoreSelection({reason,choices})});
}

async function resolveShopifyStore({rows,profiles,input={},verifier,refresh=false,deadline}){
 const shops=profiles.filter(profile=>profile.platform==='Shopify');
 let connections;
 try{connections=verifier.listConnections();}catch{throw selectionError('connection_unavailable',shops.map(profile=>({id:profile.id,store:profile.store,shop:profile.settings?.shopifyShop})));}
 function binding(profile){
  const id=clean(profile.settings?.apiConnectionId),shop=clean(profile.settings?.shopifyShop).toLowerCase();
  const connection=id?connections.find(value=>value.id===id):shop?connections.find(value=>value.shop===shop):shops.length===1&&connections.length===1&&connections[0].id===verifier.legacyConnectionId?.()?connections[0]:null;
  return connection&&(!shop||connection.shop===shop)?connection:null;
 }
 const candidates=shops.map(profile=>{const connection=binding(profile);return {profile,connection,context:connection?{
  profileId:String(profile.id),profileUpdatedAt:profile.updated_at||null,apiConnectionId:connection.id,shopifyShop:connection.shop,
 }:null};});
 const choices=candidates.map(({profile,connection})=>({id:String(profile.id),platform:'Shopify',store:profile.store,shop:connection?.shop||profile.settings?.shopifyShop||'',connectionReady:connection?.ready===true}));
 if(!shops.length||shops.length>16)throw selectionError('not_configured',choices);
 let selected=null;
 if(clean(input.profileId))selected=candidates.find(value=>String(value.profile.id)===String(input.profileId));
 if(clean(input.profileId)&&!selected)throw Object.assign(new Error('店鋪設定不存在或平台不同，請重新選擇店鋪'),{status:400,code:'STORE_PROFILE_INVALID'});
 if(selected){
  if(!selected.connection?.ready)throw selectionError('connection_unavailable',choices);
  let probe;try{probe=await verifier.probe(rows,selected.context,{refresh,deadline});}catch(error){if(error.status&&error.status<500||['SHOPIFY_TIMEOUT','SHOPIFY_THROTTLED'].includes(error.code))throw error;throw selectionError('connection_unavailable',choices);}
  if(!probe.complete)throw selectionError('not_found',choices);
  return {profile:selected.profile,context:selected.context};
 }
 const unique=new Map(candidates.filter(value=>value.connection?.ready).map(value=>[value.connection.id,value]));
 if(!unique.size)throw selectionError(connections.length?'connection_unavailable':'not_configured',choices);
 const results=await Promise.all([...unique.values()].map(async value=>{
  try{return {id:value.connection.id,probe:await verifier.probe(rows,value.context,{refresh,deadline})};}catch(error){if(error.status&&error.status<500)throw error;return {id:value.connection.id,unknown:true};}
 }));
 const matches=candidates.filter(value=>results.some(result=>result.id===value.connection?.id&&result.probe?.complete));
 if(matches.length>1)throw selectionError('ambiguous',choices);
 const unknown=results.some(value=>value.unknown)||candidates.some(value=>!value.connection?.ready);
 if(unknown)throw selectionError('connection_unavailable',choices);
 if(matches.length===1)return {profile:matches[0].profile,context:matches[0].context};
 const partial=results.filter(value=>value.probe?.matchedOrderIds?.length);
 const all=new Set(partial.flatMap(value=>value.probe.matchedOrderIds));
 if(partial.length>1&&all.size===partial[0].probe.orderCount)throw selectionError('mixed_stores',choices);
 throw selectionError('not_found',choices);
}
module.exports={createConnectionRegistry,resolveShopifyStore,publicStoreSelection};
