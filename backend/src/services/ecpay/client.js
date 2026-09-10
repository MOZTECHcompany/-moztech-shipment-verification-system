'use strict';
const { LogisticsError, mac, verify, parseForm } = require('./protocol');
const QUERY_PATH = '/Helper/QueryLogisticsTradeInfo/V5';
const HOSTS = { stage:'https://logistics-stage.ecpay.com.tw', production:'https://logistics.ecpay.com.tw' };
function queryFields(account, input, now = Date.now()) {
  if (!HOSTS[account?.environment]) throw new LogisticsError('INVALID_ENVIRONMENT','物流環境不正確');
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k=>!['logisticsId','merchantTradeNo'].includes(k))) throw new LogisticsError('INVALID_QUERY','請選擇一種物流單號查詢');
  const id = input.logisticsId, trade = input.merchantTradeNo;
  if (!!id === !!trade || (id && (typeof id !== 'string' || !/^\d{1,20}$/.test(id))) || (trade && (typeof trade !== 'string' || !/^[A-Za-z0-9]{1,20}$/.test(trade)))) throw new LogisticsError('INVALID_QUERY','請輸入綠界物流訂單編號或廠商訂單編號，兩者擇一');
  return {MerchantID:account.merchantId, ...(id?{AllPayLogisticsID:id}:{MerchantTradeNo:trade}), TimeStamp:Math.floor(now/1000)};
}
function assertQueryResponse(data, account, input) {
  if (!verify(data,account)) throw new LogisticsError('PROVIDER_SIGNATURE_INVALID','無法驗證綠界回覆，未更新資料',502);
  if (data.MerchantID!==account.merchantId || (input.logisticsId&&data.AllPayLogisticsID!==input.logisticsId) || (input.merchantTradeNo&&data.MerchantTradeNo!==input.merchantTradeNo)) throw new LogisticsError('PROVIDER_IDENTITY_MISMATCH','綠界回覆與查詢帳號或單號不符',502);
  if (!/^\d{1,20}$/.test(data.AllPayLogisticsID||'') || !/^\d{1,8}$/.test(data.LogisticsStatus||'')) throw new LogisticsError('INVALID_PROVIDER_RESPONSE','綠界未回傳有效物流單',502);
  const type = data.LogisticsType?.replace(/^CVS_/, '');
  if (!account.services.includes(type)) throw new LogisticsError('SERVICE_NOT_ALLOWED','此物流通路尚未在 WMS 啟用',409);
  return type;
}
// Only exact documented events are classified. Unknown codes stay visible for review.
function normalizedStatus(code, type) {
  const common = type==='UNIMART' ? {'2031':'awaiting_dispatch','2030':'at_logistics_center','2063':'awaiting_pickup','2067':'collected','2074':'uncollected'} : {'3024':'at_logistics_center','3018':'awaiting_pickup','3022':'collected','3020':'uncollected'};
  return common[String(code)] || 'unmapped';
}
const LABELS = {awaiting_dispatch:'等待賣家出貨',at_logistics_center:'已到物流中心',awaiting_pickup:'到店待取',collected:'已取件',uncollected:'逾期未取',unmapped:'貨態待確認'};
function normalizeQuery(data, account, input, checkedAt = new Date().toISOString()) {
  const service = assertQueryResponse(data,account,input), state=normalizedStatus(data.LogisticsStatus,service);
  return {accountId:account.id,merchantId:account.merchantId,environment:account.environment,logisticsId:data.AllPayLogisticsID,merchantTradeNo:data.MerchantTradeNo||'',shipmentNo:data.ShipmentNo||'',service,statusCode:data.LogisticsStatus,status:state,statusLabel:LABELS[state],checkedAt,source:'ecpay-query-v5',needsReturnTracking:state==='uncollected'};
}
async function queryLogistics(account,input,{fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=12000}={}) {
  if (!account.enabled || !account.verified) throw new LogisticsError('ACCOUNT_NOT_READY','此物流帳號尚未完成設定',409);
  const payload=queryFields(account,input,now()); payload.CheckMacValue=mac(payload,account);
  const controller = new AbortController(), timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetchImpl(HOSTS[account.environment]+QUERY_PATH,{method:'POST',redirect:'error',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(payload).toString(),signal:controller.signal});
    if (!response.ok) throw new LogisticsError('PROVIDER_UNAVAILABLE','綠界查詢暫時無法使用，請稍後重試',502);
    let text='';
    if (response.body?.getReader) {
      const reader=response.body.getReader(), decoder=new TextDecoder();let bytes=0;
      try { while(true) {const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>65536){await reader.cancel();throw new LogisticsError('INVALID_PROVIDER_RESPONSE','綠界回覆過大',502);}text+=decoder.decode(value,{stream:true});}text+=decoder.decode(); } finally {reader.releaseLock();}
    } else text=await response.text();
    return normalizeQuery(parseForm(text),account,input,new Date(now()).toISOString());
  } catch(error) {
    if (error instanceof LogisticsError) throw error;
    throw new LogisticsError(controller.signal.aborted?'PROVIDER_TIMEOUT':'PROVIDER_UNAVAILABLE',controller.signal.aborted?'綠界查詢逾時，請稍後重試':'綠界查詢暫時無法使用，請檢查連線設定',502);
  } finally {clearTimeout(timer);}
}
module.exports={queryLogistics,queryFields,assertQueryResponse,normalizeQuery,normalizedStatus,HOSTS};
