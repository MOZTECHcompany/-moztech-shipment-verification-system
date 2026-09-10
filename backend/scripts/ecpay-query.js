'use strict';
// Read-only diagnostic. Credentials arrive through stdin, never command-line arguments or files.
const {readFileSync}=require('node:fs');
const {queryLogistics}=require('../src/services/ecpay/client');
const {loadAccounts,selectAccount}=require('../src/services/ecpay/accounts');
(async()=>{
 try {
  const config=JSON.parse(readFileSync(0,'utf8'));
  const accounts=loadAccounts({WMS_ECPAY_ACCOUNTS_JSON:JSON.stringify(config.accounts)});
  const result=await queryLogistics(selectAccount(accounts,config.accountId),config.query);
  console.log(JSON.stringify({ok:true,result}));
 } catch(error) {console.log(JSON.stringify({ok:false,code:error.code||'CONFIGURATION_ERROR',message:error.code?error.message:'物流測試設定不正確'}));process.exitCode=1;}
})();
