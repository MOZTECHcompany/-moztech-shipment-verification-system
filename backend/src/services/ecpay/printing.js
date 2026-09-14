'use strict';
const {mac,LogisticsError}=require('./protocol');const {HOSTS}=require('./client');
function buildPrintForm(account,shipments){
 if(!account.enabled||!account.verified)throw new LogisticsError('ACCOUNT_NOT_READY','物流帳號尚未完成設定',409);
 if(!Array.isArray(shipments)||!shipments.length||shipments.length>50)throw new LogisticsError('INVALID_PRINT_BATCH','每批請選擇 1 至 50 筆物流單');
 const service=shipments[0].service;
 if(!account.services.includes(service))throw new LogisticsError('SERVICE_NOT_ALLOWED','物流通路尚未啟用');
 const ids=[];
 for(const s of shipments){
  if(s.account_id!==account.id||s.environment!==account.environment||s.merchant_id!==account.merchantId||s.service!==service||!/^\d{1,20}$/.test(s.logistics_id))throw new LogisticsError('MIXED_PRINT_BATCH','請依綠界帳號與超商通路分批列印');
  ids.push(s.logistics_id);
 }
 const fields={MerchantID:account.merchantId,AllPayLogisticsID:[...new Set(ids)].join(',')};fields.CheckMacValue=mac(fields,account);
 return {action:HOSTS[account.environment]+'/helper/printTradeDocument',method:'POST',fields};
}
module.exports={buildPrintForm};
