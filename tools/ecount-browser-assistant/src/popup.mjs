const status = document.querySelector('#status'), select = document.querySelector('#controller'), bind = document.querySelector('#bind'),verify=document.querySelector('#verify');
async function refresh() {
  const response = await chrome.runtime.sendMessage({ type:'POPUP_STATUS' });
  if (!response.ok) { status.textContent='目前無法連線，請重新開啟 WMS 助手頁。'; return; }
  const data = response.result;
  select.replaceChildren(...data.controllers.map(controller => { const option = document.createElement('option'); option.value=String(controller.tabId); option.textContent=`${controller.label}（${controller.actorId}）`; return option; }));
  bind.disabled = !data.canBind || !data.controllers.length;
  verify.disabled=!data.canBind||!data.bound||!data.controllers.find(controller=>controller.tabId===data.bound.controllerTabId)?.canVerifyCompany;
  status.textContent = data.bound?.companyEvidence ? `已核對公司：${data.bound.companyEvidence.companyName}；正式自動儲存尚未啟用。` : data.bound ? '已綁定 ECOUNT 分頁；TEST 驗收前請讀取公司識別。' : !data.controllers.length ? '請先在 WMS 助手頁按「連線助手」。' : !data.canBind ? '請切到已登入的 ECOUNT 原銷貨單，再打開助手。' : '可以綁定目前 ECOUNT 分頁。';
}
const action=work=>async()=>{try{await work();}catch{status.textContent='分頁或助手連線已改變，請重新開啟助手。';bind.disabled=false;verify.disabled=false;}};
bind.addEventListener('click',action(async()=>{bind.disabled=true;const result=await chrome.runtime.sendMessage({type:'POPUP_BIND',controllerTabId:Number(select.value)});if(!result.ok){status.textContent='綁定失敗，請等待 ECOUNT 載入完成，再確認 WMS 與 ECOUNT 分頁。';bind.disabled=false;}else await refresh();}));
verify.addEventListener('click',action(async()=>{verify.disabled=true;const result=await chrome.runtime.sendMessage({type:'POPUP_VERIFY_COMPANY'});if(result.ok)await refresh();else{status.textContent=({OPEN_COMPANY_BASIC_INFORMATION:'請先在 ECOUNT 開啟「公司基本資訊」。',BIND_COMPANY_MAPPING_FIRST:'尚未設定 TEST 公司代碼，請先完成 WMS 測試設定。',COMPANY_MAPPING_MISMATCH:'目前公司的名稱或統編與 TEST 設定不符，已停止。'}[result.errorCode]||'無法核對公司識別，請重新確認分頁。');verify.disabled=false;}}));
document.querySelector('#unbind').addEventListener('click',action(async()=>{await chrome.runtime.sendMessage({type:'POPUP_UNBIND'});await refresh();}));
refresh().catch(() => { status.textContent='助手連線已中斷，請重新載入擴充套件。'; });
