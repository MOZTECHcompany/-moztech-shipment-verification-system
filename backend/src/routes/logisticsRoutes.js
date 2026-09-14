'use strict';
const express = require('express');
const {rateLimit}=require('express-rate-limit');
const {loadAccounts,publicAccount,selectAccount}=require('../services/ecpay/accounts');
const {queryLogistics}=require('../services/ecpay/client');
const {LogisticsError,parseForm}=require('../services/ecpay/protocol');
const {saveQuery,recordCallback,checkOrderId}=require('../services/ecpay/tracking');
function createLogisticsRouter({pool,env=process.env,query=queryLogistics}={}) {
 const router=express.Router();
 // This WMS deployment is one company. Never select an account from caller-provided MerchantID/tenant.
 router.use(async(req,res,next)=>{
  res.set('Cache-Control','no-store');
  try {
   if (!req.user?.id) return res.status(401).json({message:'需要登入'});
   const result=await pool.query('SELECT role FROM users WHERE id = $1',[req.user.id]);
   if (!['admin','superadmin'].includes(result.rows[0]?.role)) return res.status(403).json({message:'需要管理員權限'});
   next();
  } catch {res.status(503).json({message:'暫時無法確認操作權限'});}
 });
 router.use(rateLimit({windowMs:60000,limit:30,standardHeaders:'draft-7',legacyHeaders:false,keyGenerator:req=>String(req.user.id),message:{message:'物流查詢過於頻繁，請稍後再試'}}));
 const handle=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){res.status(e instanceof LogisticsError?e.status:503).json({code:e instanceof LogisticsError?e.code:'LOGISTICS_UNAVAILABLE',message:e instanceof LogisticsError?e.message:'物流服務暫時無法使用'});}};
 router.get('/accounts',handle(async(req,res)=>res.json({accounts:loadAccounts(env).map(publicAccount)})));
 router.post('/accounts/:accountId/query',handle(async(req,res)=>{
  const account=selectAccount(loadAccounts(env),req.params.accountId);
  const result=await query(account,req.body);
  res.json(result);
 }));
 router.post('/accounts/:accountId/import',handle(async(req,res)=>{
  const {query:reference,orderId=null,...extra}=req.body||{};
  if(Object.keys(extra).length)throw new LogisticsError('INVALID_IMPORT','匯入欄位不正確');
  checkOrderId(orderId);
  const account=selectAccount(loadAccounts(env),req.params.accountId);
  const result=await query(account,reference);
  res.json({...await saveQuery(pool,account,result,req.user.id,orderId),result});
 }));
 router.get('/shipments',handle(async(req,res)=>{
  const offset=Number(req.query.offset||0);
  if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new LogisticsError('INVALID_PAGE','頁碼不正確');
  const accounts=loadAccounts(env).filter(a=>a.enabled&&a.verified);
  const rows=await pool.query(`SELECT s.id,s.account_id,s.environment,s.merchant_id,s.logistics_id,s.order_id,s.merchant_trade_no,s.shipment_no,s.service,s.status_code,s.status,s.checked_at,s.sync_requested,s.last_error_code,r.status AS return_status FROM wms_logistics_shipments s LEFT JOIN wms_logistics_expected_returns r ON r.shipment_id=s.id WHERE (s.account_id||':'||s.environment||':'||s.merchant_id)=ANY($1::text[]) ORDER BY s.created_at DESC,s.id LIMIT 51 OFFSET $2`,[accounts.map(a=>[a.id,a.environment,a.merchantId].join(':')),offset]);
  res.json({items:rows.rows.slice(0,50),nextOffset:rows.rows.length>50?offset+50:null});
 }));
 router.post('/shipments/print-form',handle(async(req,res)=>{
  const {shipmentIds}=req.body||{};
  if(!Array.isArray(shipmentIds)||!shipmentIds.length||shipmentIds.length>50||shipmentIds.some(id=>typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id))||new Set(shipmentIds).size!==shipmentIds.length)throw new LogisticsError('INVALID_PRINT_BATCH','列印物流單識別不正確');
  const rows=(await pool.query('SELECT account_id,environment,merchant_id,service,logistics_id FROM wms_logistics_shipments WHERE id=ANY($1::uuid[])',[shipmentIds])).rows;
  if(rows.length!==shipmentIds.length)throw new LogisticsError('SHIPMENT_NOT_FOUND','部分物流單不存在',404);
  const account=selectAccount(loadAccounts(env),rows[0].account_id);
  res.json(require('../services/ecpay/printing').buildPrintForm(account,rows));
 }));
 router.post('/shipments/:id/sync',handle(async(req,res)=>{
  if(!/^[0-9a-f-]{36}$/.test(req.params.id))throw new LogisticsError('INVALID_SHIPMENT','物流記錄識別不正確');
  const record=(await pool.query('SELECT * FROM wms_logistics_shipments WHERE id=$1',[req.params.id])).rows[0];
  if(!record)throw new LogisticsError('SHIPMENT_NOT_FOUND','找不到物流記錄',404);
  const account=selectAccount(loadAccounts(env),record.account_id);
  if(account.environment!==record.environment||account.merchantId!==record.merchant_id)throw new LogisticsError('ACCOUNT_MISMATCH','物流帳號設定已變更，請先核對',409);
  const result=await query(account,{logisticsId:record.logistics_id});
  await saveQuery(pool,account,result,req.user.id,record.order_id);
  res.json(result);
 }));
 return router;
}
function createLogisticsCallbackRouter({pool,env=process.env}={}) {
 const router=express.Router();
 router.use(rateLimit({windowMs:60000,limit:120,standardHeaders:'draft-7',legacyHeaders:false}));
 router.post('/:accountId',express.text({type:'application/x-www-form-urlencoded',limit:'32kb'}),async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(env.WMS_ECPAY_CALLBACKS_ENABLED!=='true')return res.status(503).type('text').send('0|DISABLED');
  try{
   const account=selectAccount(loadAccounts(env),req.params.accountId);
   await recordCallback(pool,account,parseForm(req.body));
   res.type('text').send('1|OK');
  }catch(e){res.status(e instanceof LogisticsError?e.status:503).type('text').send('0|ERROR');}
 });
 return router;
}
module.exports={createLogisticsRouter,createLogisticsCallbackRouter};
