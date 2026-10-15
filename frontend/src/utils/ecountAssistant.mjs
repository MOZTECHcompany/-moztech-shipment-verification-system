export const CHANNEL = 'corely.ecount-assistant.v1';
const types = new Set(['HELLO','PING','GET_CAPABILITIES','READ_DOCUMENT','PREVIEW_PLAN','SAVE_PLAN','READ_BACK']);
export const jobLabels = Object.freeze({queued:'待回寫',claimed:'正在讀取',prepared:'已建立預覽',previewed:'已預覽，未儲存',verified:'已讀回核對',test_verified:'測試單已讀回核對',superseded_verified:'舊版回寫已確認，須處理新版',uncertain:'儲存結果待確認',blocked:'需人工核對',failed:'未完成'});
export function createAssistantBridge({ target = window, origin = target.location.origin, random = crypto, timeoutMs = 20000 } = {}) {
    const nonce = [...random.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('');
    const waiting = new Map(); let closed = false;
    const receive = event => {
        const data=event.data;
        if(event.source!==target||event.origin!==origin||data?.channel!==CHANNEL||data.direction!=='extension-to-page'||data.nonce!==nonce||data.type!=='RESULT')return;
        const pending=waiting.get(data.requestId);if(!pending)return;
        waiting.delete(data.requestId);clearTimeout(pending.timer);
        if(data.payload?.ok===true)pending.resolve(data.payload.result);
        else pending.reject(Object.assign(new Error(data.payload?.errorCode||'EXTENSION_FAILED'),{code:data.payload?.errorCode||'EXTENSION_FAILED'}));
    };
    target.addEventListener('message',receive);
    return {
        request(type,payload={}) {
            if(closed||!types.has(type))return Promise.reject(new Error('助手連線已關閉'));
            const requestId=random.randomUUID();
            const message={channel:CHANNEL,direction:'page-to-extension',nonce,requestId,type,payload};
            try {if(new TextEncoder().encode(JSON.stringify(message)).length>196608)return Promise.reject(new Error('單據明細超過助手上限，請主管核對；不會自動儲存。'));}
            catch{return Promise.reject(new Error('助手訊息格式無效'));}
            return new Promise((resolve,reject)=>{
                const timer=setTimeout(()=>{waiting.delete(requestId);reject(Object.assign(new Error('助手未回應，請確認 Chrome 擴充功能與 ECOUNT 分頁。'),{code:'EXTENSION_TIMEOUT'}));},timeoutMs);
                waiting.set(requestId,{resolve,reject,timer});
                target.postMessage(message,origin);
            });
        },
        close() {closed=true;target.removeEventListener('message',receive);for(const {reject,timer}of waiting.values()){clearTimeout(timer);reject(new Error('助手連線已關閉'));}waiting.clear();}
    };
}

export const pendingAssistantKey = actorId => `wms_ecount_assistant_pending_v1:${actorId}`;
export const assistantError = error => ({BIND_ECOUNT_TAB_FIRST:'請在 Chrome 開啟 ECOUNT，再由助手擴充功能綁定該分頁。',COMPANY_ID_NOT_VERIFIED:'請先在 ECOUNT 公司資訊頁，讓助手核對公司名稱與統編。',HANDSHAKE_REQUIRED:'請重新連接助手。',TEMPORARY_DRAFT:'ECOUNT 有未處理的暫存資料，請先由原操作人員確認。',UNSUPPORTED_DOCUMENT:'請在 ECOUNT 開啟指定的原銷貨單修改畫面。',VENDOR_SAVE_NOT_ACCEPTED:'尚未完成 ECOUNT 實際儲存驗收，目前不會自動儲存。',SAVE_DISABLED_VENDOR_ACCEPTANCE_PENDING:'ECOUNT 儲存尚未驗收，目前只可預覽。',BUSINESS_CONFLICT:'原銷貨單已被修改，請重新核對。',METADATA_CONFLICT:'箱號欄已被他人修改，請重新核對。',READBACK_REOPEN_ORIGINAL_REQUIRED:'請在 ECOUNT 關閉目前畫面，再回查詢清單唯讀確認；不要再次儲存。',SAVE_UI_CONFIRMATION_PENDING:'ECOUNT 有待處理提示，請查看後使用「唯讀確認上次結果」。',SAVE_RESULT_UNKNOWN:'儲存結果待確認，請使用「唯讀確認上次結果」。'}[error?.code] || error?.response?.data?.message || error?.message || '助手暫時無法完成');

// Persist intent before SAVE_PLAN. Recovery never issues another vendor save.
export function createAssistantRunner({ api, bridge, actorId, workerId, store, isCurrent = ()=>true, now = Date.now, uuid = ()=>crypto.randomUUID(), withLock=work=>work() }) {
    let busy=false;
    const check=()=>{if(!isCurrent())throw new Error('登入人員已變更，助手已停止。');};
    const post=async(path,body)=>{check();const {data}=await api.post(`/api/ecount-browser-assistant${path}`,{expectedActorId:actorId,workerId,commandId:uuid(),...body},{timeout:20000});check();return data;};
    const send=async(type,payload)=>{check();const result=await bridge.request(type,payload);check();return result;};
    const runner={
        async runOne(mode) {
            if(busy||store.read())throw new Error('上次操作尚待確認，請先唯讀核對。');
            busy=true;
            try {
                const claimed=await post('/claim',{});if(!claimed.job)return {empty:true};
                const {job,leaseToken}=claimed;
                const {before,capabilities}=await send('READ_DOCUMENT',{companyCode:job.companyCode,voucherNumber:job.voucherNumber});
                const prepared=await post(`/jobs/${job.id}/prepare`,{leaseToken,before,capabilities});
                const context={jobId:job.id,workerId,leaseToken,planFingerprint:prepared.planFingerprint,plan:prepared.plan};
                try { await send('PREVIEW_PLAN',{jobId:job.id,plan:prepared.plan,planFingerprint:prepared.planFingerprint}); }
                catch(error) {
                    // No save was attempted; release prepared work as a definite failure.
                    await post(`/jobs/${job.id}/result`,{leaseToken,planFingerprint:prepared.planFingerprint,outcome:'failed',vendorSaveAttempted:false,errorCode:/^[A-Z0-9_]{1,100}$/.test(error.code||'')?error.code:'PREVIEW_FAILED'});
                    throw error;
                }
                if(!prepared.saveAllowed)return post(`/jobs/${job.id}/result`,{leaseToken,planFingerprint:prepared.planFingerprint,outcome:'preview'});
                const permitMode=prepared.plan.mode;
                const savedIntent={...context,actorId,stage:'save-intent',createdAt:now()};
                try {
                    if(!['test','live'].includes(permitMode)||mode!==permitMode)throw new Error('回寫模式已改變，請重新載入。');
                    store.write(savedIntent); // Failure to retain recovery evidence prevents saving.
                } catch(error) {
                    // SAVE_PLAN has never been sent. Report this precise boundary, without
                    // requiring local storage that may itself be unavailable.
                    try { await post(`/jobs/${job.id}/result`,{leaseToken,planFingerprint:prepared.planFingerprint,outcome:'failed',vendorSaveAttempted:false,errorCode:'LOCAL_PRE_SAVE_FAILED'}); } catch { /* Keep the original failure; never attempt a vendor save. */ }
                    throw error;
                }
                let result;
                try {
                    const expiresAt=Math.min(now()+90000,Date.parse(prepared.leaseExpiresAt||claimed.leaseExpiresAt)||now()+90000);
                    result=await send('SAVE_PLAN',{jobId:job.id,planFingerprint:prepared.planFingerprint,permit:{saveAllowed:true,testSaveAllowed:permitMode==='test',mode:permitMode,testWriteEnabled:prepared.plan.testWriteEnabled===true,companyCode:job.companyCode,voucherNumber:job.voucherNumber,jobId:job.id,planFingerprint:prepared.planFingerprint,expiresAt}});
                } catch(error) {result={outcome:'uncertain',errorCode:/^[A-Z0-9_]{1,100}$/.test(error.code||'')?error.code:'SAVE_RESULT_UNKNOWN'};}
                const notAttempted=result.outcome==='not_attempted'&&result.saveAttempted===false;
                const body={leaseToken,planFingerprint:prepared.planFingerprint,outcome:notAttempted?'failed':['saved','test_verified'].includes(result.outcome)?'saved':'uncertain',...(notAttempted?{vendorSaveAttempted:false}:{}),...(result.after?{after:result.after}:{}),...(result.errorCode?{errorCode:result.errorCode}:{})};
                // A lost WMS receipt is replayed with the same command, never another ECOUNT save.
                const commandId=uuid();store.write({...savedIntent,stage:'result',body:{...body,commandId}});
                const receipt=await post(`/jobs/${job.id}/result`,{...body,commandId});
                if(receipt.verified||receipt.testVerified||receipt.historicalVerified||notAttempted&&receipt.job?.status==='failed')store.clear();
                return receipt;
            } finally {busy=false;}
        },
        async recover() {
            if(busy)throw new Error('助手正在處理');const pending=store.read();if(!pending||pending.actorId!==actorId||pending.workerId!==workerId)throw new Error('找不到此人員的待確認工作');
            busy=true;
            try {
                if(pending.stage==='result'){
                    try {
                        const receipt=await post(`/jobs/${pending.jobId}/result`,pending.body);
                        if(receipt.verified||receipt.testVerified||receipt.historicalVerified||pending.body.outcome==='failed'&&receipt.job?.status==='failed'){store.clear();return receipt;}
                    } catch(error) {
                        if(error.response?.status!==409||!['ECOUNT_BROWSER_SAVE_NOT_ACCEPTED','ECOUNT_BROWSER_STATE_CHANGED','ECOUNT_BROWSER_LEASE_EXPIRED'].includes(error.response?.data?.code||error.code))throw error;
                    }
                }
                const result=await send('READ_BACK',{jobId:pending.jobId,planFingerprint:pending.planFingerprint,plan:pending.plan});
                if(!result.after)throw new Error('原單尚無法讀回確認；保留待確認紀錄，請勿重複儲存。');
                const receipt=await post(`/jobs/${pending.jobId}/recover`,{leaseToken:pending.leaseToken,planFingerprint:pending.planFingerprint,after:result.after});
                if(receipt.verified||receipt.testVerified||receipt.historicalVerified)store.clear();return receipt;
            } finally {busy=false;}
        }
    };
    return {runOne:mode=>withLock(()=>runner.runOne(mode)),recover:()=>withLock(()=>runner.recover())};
}
