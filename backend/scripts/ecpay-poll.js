'use strict';
// Explicit maintenance invocation only; no timer and no automatic server-start side effects.
const {pool}=require('../src/config/database');
const {loadAccounts,selectAccount}=require('../src/services/ecpay/accounts');
const {queryLogistics}=require('../src/services/ecpay/client');
const {saveQuery}=require('../src/services/ecpay/tracking');
(async()=>{const summary={checked:0,failed:0};try{
 const accounts=loadAccounts();
 const records=await pool.query(`SELECT * FROM wms_logistics_shipments WHERE (account_id||':'||environment||':'||merchant_id)=ANY($1::text[]) AND (sync_requested OR (status<>'collected' AND checked_at<NOW()-INTERVAL '30 minutes')) ORDER BY sync_requested DESC,checked_at LIMIT 30`,[accounts.filter(a=>a.enabled&&a.verified).map(a=>[a.id,a.environment,a.merchantId].join(':'))]);
 for(const row of records.rows){try{
  const account=selectAccount(accounts,row.account_id);
  const result=await queryLogistics(account,{logisticsId:row.logistics_id});
  await saveQuery(pool,account,result,row.created_by,row.order_id);summary.checked++;
 }catch(e){summary.failed++;await pool.query('UPDATE wms_logistics_shipments SET last_error_code=$2 WHERE id=$1',[row.id,e.code||'SYNC_UNAVAILABLE']);}}
 console.log(JSON.stringify(summary));
}catch{console.error('Logistics sync unavailable');process.exitCode=1;}finally{await pool.end();}})();
