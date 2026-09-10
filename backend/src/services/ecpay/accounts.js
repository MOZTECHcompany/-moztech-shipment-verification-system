'use strict';
const { LogisticsError } = require('./protocol');
const B2C = ['UNIMART', 'FAMI', 'HILIFE'];
function loadAccounts(env = process.env) {
  if (!env.WMS_ECPAY_ACCOUNTS_JSON) return [];
  let input;
  try { input = JSON.parse(env.WMS_ECPAY_ACCOUNTS_JSON); } catch { throw new LogisticsError('ACCOUNTS_INVALID', '物流帳號設定格式不正確', 503); }
  if (!Array.isArray(input) || input.length > 20) throw new LogisticsError('ACCOUNTS_INVALID', '物流帳號設定格式不正確', 503);
  const keys = new Set(), merchants = new Set();
  return input.map(a => {
    if (!a || !/^[a-z0-9][a-z0-9-]{0,49}$/.test(a.id) || !/^\d{6,10}$/.test(a.merchantId) || !['stage','production'].includes(a.environment) || !a.label || typeof a.label !== 'string' || a.label.length > 80 || keys.has(a.id) || merchants.has(`${a.environment}:${a.merchantId}`)) throw new LogisticsError('ACCOUNTS_INVALID', '物流帳號識別重複或不正確', 503);
    if (!Array.isArray(a.services) || a.services.some(s => !B2C.includes(s))) throw new LogisticsError('ACCOUNTS_INVALID', '物流通路設定不正確', 503);
    if (a.enabled === true && (typeof a.hashKey !== 'string' || a.hashKey.length !== 16 || typeof a.hashIv !== 'string' || a.hashIv.length !== 16 || a.verified !== true)) throw new LogisticsError('ACCOUNTS_INVALID', '物流帳號尚未確認金鑰與權限', 503);
    keys.add(a.id); merchants.add(`${a.environment}:${a.merchantId}`);
    return Object.freeze({ id:a.id, label:a.label, merchantId:a.merchantId, environment:a.environment, services:[...new Set(a.services)], enabled:a.enabled===true, verified:a.verified===true, hashKey:a.hashKey, hashIv:a.hashIv });
  });
}
function publicAccount(a) { return {id:a.id,label:a.label,merchantId:a.merchantId,environment:a.environment,services:a.services,queryReady:a.enabled&&a.verified,writeEnabled:false}; }
function selectAccount(accounts,id) {
  const account = accounts.find(a=>a.id===id);
  if (!account) throw new LogisticsError('ACCOUNT_NOT_FOUND', '找不到物流帳號',404);
  if (!account.enabled || !account.verified) throw new LogisticsError('ACCOUNT_NOT_READY','此物流帳號尚未完成設定',409);
  return account;
}
module.exports = { loadAccounts, publicAccount, selectAccount, B2C };
