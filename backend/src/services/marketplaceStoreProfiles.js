const FIELDS=['store','customerCode','customerName','warehouseCode','currency','taxMode','taxType','taxConfirmed','erpCurrencyCode','erpCurrencyConfirmed','shippingSku'];
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
function profileSettings(input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('店鋪設定格式無效');
 const result={};
 for(const key of FIELDS){
  if(key==='shippingSku')continue;
  const value=input[key];if(value===undefined)continue;
  if(key.endsWith('Confirmed')){if(typeof value!=='boolean')fail('確認欄位格式無效');result[key]=value;}
  else{if(typeof value!=='string'||value.length>100||/[\u0000-\u001f\u007f]/.test(value))fail('店鋪欄位格式無效');result[key]=value.trim();}
 }
 if(!result.store||!result.customerCode||!result.warehouseCode)fail('請填寫店鋪、銷貨客戶編碼及倉庫');
 if(result.currency!=='TWD'||result.taxMode!=='erp_inclusive'||result.taxType!=='11'||result.taxConfirmed!==true)fail('請確認 TWD 及 ECOUNT 含稅計價設定');
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
function mountStoreProfiles(router,pool){
 router.get('/store-profiles',async(req,res,next)=>{try{
  const rows=(await pool.query('SELECT id,platform,store,settings,updated_at FROM marketplace_store_profiles ORDER BY platform,store')).rows;
  res.set('Cache-Control','private, no-store').json({profiles:rows});
 }catch(e){next(e);}});
 router.post('/store-profiles',async(req,res,next)=>{try{
  const platform=req.body?.platform;if(!['Shopify','SHOPLINE','1Shop'].includes(platform))fail('商城平台無效');
  const settings=profileSettings(req.body?.settings);
  const row=(await pool.query(`INSERT INTO marketplace_store_profiles(platform,store,settings,updated_by) VALUES($1,$2,$3,$4)
   ON CONFLICT(platform,store) DO UPDATE SET settings=EXCLUDED.settings,updated_by=EXCLUDED.updated_by,updated_at=NOW()
   RETURNING id,platform,store,settings,updated_at`,[platform,settings.store,JSON.stringify(settings),req.user.id])).rows[0];
  res.json(row);
 }catch(e){if(e.status)return res.status(e.status).json({message:e.message});next(e);}});
}
module.exports={profileSettings,mountStoreProfiles};
