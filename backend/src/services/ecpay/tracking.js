'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {LogisticsError,verify,fields}=require('./protocol');
function digest(data){return createHash('sha256').update(JSON.stringify(data)).digest('hex');}
async function transaction(pool,fn){const client=await pool.connect();try{await client.query('BEGIN');await client.query("SET LOCAL lock_timeout = '3s'");await client.query("SET LOCAL statement_timeout = '8s'");const out=await fn(client);await client.query('COMMIT');return out;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
function checkOrderId(orderId){if(orderId!=null&&(!Number.isSafeInteger(orderId)||orderId<=0))throw new LogisticsError('INVALID_ORDER','訂單識別不正確');}
async function saveQuery(pool,account,result,userId,orderId=null){
 checkOrderId(orderId);
 if(result.accountId!==account.id||result.merchantId!==account.merchantId||result.environment!==account.environment)throw new LogisticsError('ACCOUNT_MISMATCH','物流帳號不符');
 return transaction(pool,async db=>{
  if(orderId!=null){const found=await db.query('SELECT id FROM orders WHERE id=$1',[orderId]);if(!found.rows.length)throw new LogisticsError('ORDER_NOT_FOUND','找不到 WMS 訂單',404);}
  const inserted=await db.query(`INSERT INTO wms_logistics_shipments(id,account_id,environment,merchant_id,logistics_id,order_id,merchant_trade_no,shipment_no,service,status_code,status,checked_at,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(account_id,environment,logistics_id) DO NOTHING RETURNING id`,[randomUUID(),account.id,account.environment,account.merchantId,result.logisticsId,orderId,result.merchantTradeNo,result.shipmentNo,result.service,result.statusCode,result.status,result.checkedAt,userId]);
  const previous=(await db.query('SELECT * FROM wms_logistics_shipments WHERE account_id=$1 AND environment=$2 AND logistics_id=$3 FOR UPDATE',[account.id,account.environment,result.logisticsId])).rows[0];
  if(previous.merchant_id!==account.merchantId||previous.service!==result.service||previous.merchant_trade_no!==result.merchantTradeNo||(orderId!=null&&previous.order_id!=null&&previous.order_id!==orderId))throw new LogisticsError('SHIPMENT_CONFLICT','這筆物流單已有不同的帳號、通路或訂單關聯',409);
  const evidence={logisticsId:result.logisticsId,merchantTradeNo:result.merchantTradeNo,shipmentNo:result.shipmentNo,statusCode:result.statusCode,service:result.service,checkedAt:result.checkedAt};
  await db.query(`INSERT INTO wms_logistics_events(account_id,environment,merchant_id,logistics_id,shipment_id,source,status_code,dedupe_key,evidence) VALUES($1,$2,$3,$4,$5,'query',$6,$7,$8) ON CONFLICT(dedupe_key) DO NOTHING`,[account.id,account.environment,account.merchantId,result.logisticsId,previous.id,result.statusCode,digest([account.id,account.environment,'query',evidence]),evidence]);
  if(new Date(result.checkedAt)>=new Date(previous.checked_at)){
   await db.query(`UPDATE wms_logistics_shipments SET order_id=COALESCE(order_id,$2),shipment_no=$3,status_code=$4,status=$5,checked_at=$6,sync_requested=false,last_error_code=NULL WHERE id=$1`,[previous.id,orderId,result.shipmentNo,result.statusCode,result.status,result.checkedAt]);
   if(result.needsReturnTracking)await db.query(`INSERT INTO wms_logistics_expected_returns(id,shipment_id,reason) VALUES($1,$2,'uncollected') ON CONFLICT(shipment_id) DO UPDATE SET last_seen_at=NOW()`,[randomUUID(),previous.id]);
   else if(result.status==='collected')await db.query("UPDATE wms_logistics_expected_returns SET status='needs_review' WHERE shipment_id=$1",[previous.id]);
  }
  await db.query('UPDATE wms_logistics_events SET shipment_id=$1 WHERE shipment_id IS NULL AND account_id=$2 AND environment=$3 AND logistics_id=$4 AND merchant_id=$5',[previous.id,account.id,account.environment,result.logisticsId,account.merchantId]);
  return {id:previous.id,created:inserted.rows.length===1};
 });
}
async function recordCallback(pool,account,input){
 const data=fields(input);
 if(data.MerchantID!==account.merchantId||!verify(data,account))throw new LogisticsError('INVALID_CALLBACK','物流通知驗證失敗',403);
 if(!/^\d{1,20}$/.test(data.AllPayLogisticsID||'')||!/^\d{1,8}$/.test(data.RtnCode||'')||!account.services.includes(data.LogisticsSubType)||typeof data.MerchantTradeNo!=='string'||!data.MerchantTradeNo||data.MerchantTradeNo.length>20)throw new LogisticsError('INVALID_CALLBACK','物流通知識別不完整');
 const evidence={merchantTradeNo:data.MerchantTradeNo,service:data.LogisticsSubType,code:data.RtnCode,providerTime:data.UpdateStatusDate||''};
 // Callback is an authenticated hint. Reconcile by query; late events never overwrite a current snapshot.
 return transaction(pool,async db=>{
  const shipment=(await db.query('SELECT id,merchant_id,merchant_trade_no,service FROM wms_logistics_shipments WHERE account_id=$1 AND environment=$2 AND logistics_id=$3 FOR UPDATE',[account.id,account.environment,data.AllPayLogisticsID])).rows[0];
  if(shipment&&(shipment.merchant_id!==account.merchantId||shipment.merchant_trade_no!==data.MerchantTradeNo||shipment.service!==data.LogisticsSubType))throw new LogisticsError('CALLBACK_CONFLICT','物流通知與既有物流單不符',409);
  const saved=await db.query(`INSERT INTO wms_logistics_events(account_id,environment,merchant_id,logistics_id,shipment_id,source,status_code,provider_time,dedupe_key,evidence) VALUES($1,$2,$3,$4,$5,'callback',$6,$7,$8,$9) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id`,[account.id,account.environment,account.merchantId,data.AllPayLogisticsID,shipment?.id||null,data.RtnCode,data.UpdateStatusDate||null,digest([account.id,account.environment,data.AllPayLogisticsID,evidence]),evidence]);
  if(shipment&&saved.rows.length)await db.query('UPDATE wms_logistics_shipments SET sync_requested=true WHERE id=$1',[shipment.id]);
  return {duplicate:saved.rows.length===0,matched:!!shipment};
 });
}
module.exports={saveQuery,recordCallback,checkOrderId};
