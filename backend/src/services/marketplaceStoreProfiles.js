const FIELDS=['apiConnectionId','shopifyShop','projectOwner','salesOwner','erpStaffCode','erpProjectCode','erpResponsibilityConfirmed','store','customerCode','customerName','warehouseCode','currency','taxMode','taxType','taxConfirmed','erpCurrencyCode','erpCurrencyConfirmed','shippingSku'];
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const reject=(message,code,status=400)=>{throw Object.assign(new Error(message),{status,code});};
// Preserve PostgreSQL's full timestamp precision for optimistic updates. A JS
// Date would discard microseconds before the client can return the CAS value.
const projection=`id,platform,store,settings,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`;
const nextTimestamp="GREATEST(clock_timestamp(),marketplace_store_profiles.updated_at+INTERVAL '1 microsecond')";
function profileSettings(input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('店鋪設定格式無效');
 const result={};
 for(const key of FIELDS){
  if(key==='shippingSku')continue;
  const value=input[key];if(value===undefined)continue;
  if(key.endsWith('Confirmed')){if(typeof value!=='boolean')fail('確認欄位格式無效');result[key]=value;}
  else{if(typeof value!=='string'||value.length>100||/[\u0000-\u001f\u007f]/.test(value))fail('店鋪欄位格式無效');result[key]=value.trim();}
 }
 if(result.shopifyShop&&!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(result.shopifyShop))fail('Shopify 店鋪網域格式無效');
 if(!result.store||!result.customerCode||!result.warehouseCode)fail('請填寫店鋪、銷貨客戶編碼及倉庫');
 if(result.currency!=='TWD'||result.taxMode!=='erp_inclusive'||result.taxType!=='11'||result.taxConfirmed!==true)fail('請確認 TWD 及 ECOUNT 含稅計價設定');
 if((result.erpStaffCode||result.erpProjectCode)&&result.erpResponsibilityConfirmed!==true)fail('請確認 ECOUNT 承辦人及專案編碼');
 if(result.erpCurrencyCode&&result.erpCurrencyConfirmed!==true)fail('請確認 ECOUNT 貨幣代碼');
 const shipping=input.shippingSku;
 if(shipping){
  if(typeof shipping!=='object'||Array.isArray(shipping))fail('運費設定格式無效');
  const s={};for(const key of ['erpSku','name']){if(typeof shipping[key]!=='string'||shipping[key].length>100||/[\u0000-\u001f\u007f]/.test(shipping[key]))fail('運費品項格式無效');s[key]=shipping[key].trim();}
  for(const key of ['confirmed','nonStock']){if(typeof shipping[key]!=='boolean')fail('運費確認格式無效');s[key]=shipping[key];}
  result.shippingSku=s;
 }
 return result;
}
function mountStoreProfiles(router,pool,connectionRegistry){
 router.get('/store-profiles',async(req,res,next)=>{try{
  const rows=(await pool.query(`SELECT ${projection} FROM marketplace_store_profiles ORDER BY platform,store`)).rows;
  res.set('Cache-Control','private, no-store').json({profiles:rows});
 }catch(e){next(e);}});
 router.post('/store-profiles',async(req,res,next)=>{try{
  const platform=req.body?.platform;if(!['Shopify','SHOPLINE','1Shop'].includes(platform))fail('商城平台無效');
  const settings=profileSettings(req.body?.settings);
  const body=req.body||{},hasId=Object.hasOwn(body,'profileId'),hasExpected=Object.hasOwn(body,'expectedUpdatedAt');
  if(Object.hasOwn(body,'createOnly')&&typeof body.createOnly!=='boolean'||body.createOnly===true&&(hasId||hasExpected)||hasId!==hasExpected)reject('店鋪保存條件無效，請重新讀取設定','STORE_PROFILE_GUARD_INVALID');
  if(hasId&&(!/^[1-9]\d{0,9}$/.test(String(body.profileId))||Number(body.profileId)>2147483647||typeof body.expectedUpdatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(body.expectedUpdatedAt)||!Number.isFinite(Date.parse(body.expectedUpdatedAt))||new Date(body.expectedUpdatedAt).toISOString().slice(0,19)!==body.expectedUpdatedAt.slice(0,19)))reject('店鋪保存條件無效，請重新讀取設定','STORE_PROFILE_GUARD_INVALID');
  if((body.createOnly===true||hasId)&&platform==='Shopify'){
   const connection=connectionRegistry?.publicList().find(value=>value.id===settings.apiConnectionId&&value.shop===settings.shopifyShop&&value.connectionReady===true);
   if(!connection)reject('請選擇已配置且店鋪一致的讀單連線','STORE_CONNECTION_INVALID');
  }
  let row;
  if(body.createOnly===true){
   row=(await pool.query(`INSERT INTO marketplace_store_profiles(platform,store,settings,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(platform,store) DO NOTHING RETURNING ${projection}`,[platform,settings.store,JSON.stringify(settings),req.user.id])).rows[0];
   if(!row)reject('此店鋪設定已存在，請重新讀取後編輯','STORE_PROFILE_EXISTS',409);
  }else if(hasId){
   row=(await pool.query(`UPDATE marketplace_store_profiles SET settings=$4::jsonb,updated_by=$5,updated_at=${nextTimestamp} WHERE id=$1 AND platform=$2 AND store=$3 AND updated_at=$6::timestamptz RETURNING ${projection}`,[Number(body.profileId),platform,settings.store,JSON.stringify(settings),req.user.id,body.expectedUpdatedAt])).rows[0];
   if(!row)reject('店鋪設定已變更，請重新讀取後再保存','STORE_PROFILE_CHANGED',409);
  }else{
   row=(await pool.query(`INSERT INTO marketplace_store_profiles(platform,store,settings,updated_by) VALUES($1,$2,$3,$4)
    ON CONFLICT(platform,store) DO UPDATE SET settings=EXCLUDED.settings,updated_by=EXCLUDED.updated_by,updated_at=${nextTimestamp}
    RETURNING ${projection}`,[platform,settings.store,JSON.stringify(settings),req.user.id])).rows[0];
  }
  res.set('Cache-Control','private, no-store').json(row);
 }catch(e){if(e.status)return res.status(e.status).set('Cache-Control','private, no-store').json({code:e.code,message:e.message});next(e);}});
}
module.exports={profileSettings,mountStoreProfiles};
