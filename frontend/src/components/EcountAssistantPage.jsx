import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Plug, RefreshCw } from 'lucide-react';
import api from '@/api/api';
import { PageHeader } from '@/ui';
import { assistantError, createAssistantBridge, createAssistantRunner, jobLabels, pendingAssistantKey } from '@/utils/ecountAssistant.mjs';

const button='rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium hover:bg-blue-50 disabled:opacity-40';
const time=value=>value?new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'—';
export function EcountAssistantPage({user}) {
    const [data,setData]=useState(null),[connection,setConnection]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState(false),[automatic,setAutomatic]=useState(false),[note,setNote]=useState('');
    const session=api.getSessionIdentity(),context=useRef(null),bridge=useRef(null),runner=useRef(null),active=useRef(false),running=useRef(false),request=useRef(0);
    context.current={actorId:user.id,role:user.role,session};
    const current=useCallback(captured=>active.current&&captured.actorId===context.current.actorId&&captured.role===context.current.role&&['dispatcher','admin','superadmin'].includes(context.current.role)&&captured.session===context.current.session&&captured.session===api.getSessionIdentity(),[]);
    const load=useCallback(async()=>{
        const captured={...context.current},seq=++request.current;
        try {const {data:result}=await api.get('/api/ecount-browser-assistant/status',{timeout:15000});if(current(captured)&&seq===request.current){setData(result);return result;}}
        catch(e){if(current(captured)&&seq===request.current)setError(assistantError(e));}return null;
    },[current]);
    useEffect(()=>{
        active.current=true;setConnection(null);setAutomatic(false);setError('');setData(null);setBusy(false);
        const key=pendingAssistantKey(user.id);
        try{setPending(!!localStorage.getItem(key));}catch{setPending(true);}
        void load();
        return()=>{active.current=false;request.current++;bridge.current?.close();bridge.current=null;runner.current=null;};
    },[user.id,user.role,session,load]);
    const perform=useCallback(async work=>{
        if(running.current)return;running.current=true;const captured={...context.current};setBusy(true);setError('');
        try{await work();}
        catch(e){if(current(captured)){setError(assistantError(e));setAutomatic(false);}}
        finally{running.current=false;if(current(captured)){setBusy(false);await load();}}
    },[current,load]);
    const connect=()=>perform(async()=>{
        const transport=bridge.current||createAssistantBridge();bridge.current=transport;
        const captured={...context.current};
        await transport.request('HELLO',{actorId:user.id,actorLabel:user.name||user.username||String(user.id),companyMappings:data?.mode==='test'?data.configuration?.companyMappings||[]:[]});
        const capabilities=await transport.request('GET_CAPABILITIES');if(!current(captured))return;setConnection(capabilities);
        const key=pendingAssistantKey(user.id),workerKey=`wms_ecount_assistant_worker:${user.id}`;
        let workerId=localStorage.getItem(workerKey);if(!workerId){workerId=crypto.randomUUID();localStorage.setItem(workerKey,workerId);}
        // Survives closing this tab; contains only the recovery lease and metadata plan,
        // never WMS JWT, ECOUNT credentials, cookies or the complete ERP snapshot.
        const store={read(){const value=JSON.parse(localStorage.getItem(key)||'null');return value;},write(value){localStorage.setItem(key,JSON.stringify(value));if(current(captured))setPending(true);},clear(){localStorage.removeItem(key);if(current(captured))setPending(false);}};
        const withLock=work=>{
            if(!navigator.locks?.request)throw new Error('此瀏覽器不支援助手的跨分頁保護，請改用最新 Chrome。');
            return navigator.locks.request(`corely-ecount-assistant:${user.id}`,{mode:'exclusive',ifAvailable:true},lock=>{if(!lock)throw new Error('另一個 WMS 分頁正在處理回寫，請稍後再試。');return work();});
        };
        runner.current=createAssistantRunner({api,bridge:transport,actorId:user.id,workerId,store,isCurrent:()=>current(captured),withLock});
    });
    const process=useCallback(()=>perform(async()=>{
        if(!runner.current)throw new Error('請先連接 Chrome 助手。');
        const result=await runner.current.runOne(data?.mode);
        if(result.empty)setNote('目前沒有待回寫工作。');
        else if(result.historicalVerified){setAutomatic(false);setNote('舊版回寫結果已確認；WMS 訂單已有更新，須另行核對新版。');}
        else if(result.verified)setNote('箱號明細已儲存，並重新讀回核對。');
        else if(result.testVerified)setNote('TEST 單已讀回核對；正式自動回寫仍須完成驗收。');
        else if(result.readOnlyRecoveryRequired){setAutomatic(false);setNote('儲存結果待確認，請唯讀核對上次結果。');}
        else setNote('預覽完成，ECOUNT 尚未儲存。');
    }),[perform,data?.mode]);
    useEffect(()=>{
        if(!automatic||pending||!data?.enabled||!connection?.bound)return;
        const id=setTimeout(()=>void process(),10000);return()=>clearTimeout(id);
    },[automatic,pending,data,connection,process]);
    const reconcile=()=>perform(async()=>{await api.post('/api/ecount-browser-assistant/reconcile',{expectedActorId:user.id,commandId:crypto.randomUUID(),limit:20},{timeout:20000});setNote('已檢查完成裝箱且已綁定原銷貨單的訂單。');});
    const recover=()=>perform(async()=>{if(!runner.current)throw new Error('請先連接 Chrome 助手。');const result=await runner.current.recover();if(result.historicalVerified){setAutomatic(false);setNote('舊版回寫結果已確認；WMS 訂單已有更新，須另行核對新版。');}else setNote(result.verified||result.testVerified?'上次儲存結果已讀回核對。':'仍待確認，未重新儲存 ECOUNT。');});
    const retry=job=>perform(async()=>{await api.post(`/api/ecount-browser-assistant/jobs/${job.id}/retry`,{expectedActorId:user.id,commandId:crypto.randomUUID(),reason:'修正設定後重試未儲存工作'},{timeout:20000});setNote('已重新排隊；將重新讀取原單後核對。');});
    const canManage=data?.canManage&&['dispatcher','admin','superadmin'].includes(user.role);
    return <section className="space-y-5 pb-8">
        <PageHeader title="ECOUNT 回寫助手" />
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">裝箱完成 → 補註原銷貨單</h2><span className="rounded-full bg-slate-100 px-3 py-1 text-sm">{data?({off:'尚未啟用',preview:'預覽模式',test:'指定 TEST 單測試',live:'正式模式'}[data.mode]||'尚未啟用'):'載入中'}</span></div>
            <p className="text-sm text-slate-600">在公司 Chrome 保持 WMS 與 ECOUNT 登入。助手只填寫「WMS箱號明細」，完成後會重新開啟原單核對。</p>
            {data&&!data.enabled&&<p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">實際 ECOUNT 儲存驗收完成前，自動回寫維持關閉。</p>}
            {canManage&&<div className="flex flex-wrap gap-2">
                <button className={button} disabled={busy} onClick={connect}><Plug size={16} className="mr-2 inline" />{connection?'重新連接助手':'連接 Chrome 助手'}</button>
                <button className={button} disabled={busy||!data.enabled||!connection?.bound||pending} onClick={process}>處理下一筆</button>
                <button className={button} disabled={busy||!data.enabled||pending} onClick={reconcile}>補查待回寫訂單</button>
                <button className={button} disabled={busy} onClick={()=>void load()}><RefreshCw size={16} className="mr-2 inline" />重新整理</button>
            </div>}
            {connection&&<p className="text-sm text-slate-600">{connection.bound?'已綁定 ECOUNT 分頁':'請在 ECOUNT 分頁點開助手擴充功能，選擇此 WMS 人員並綁定分頁。'}</p>}
            {connection&&data?.mode==='test'&&<p className="text-sm text-slate-600">測試前，先在 ECOUNT「公司資訊」頁讓助手核對公司識別，再開啟指定的 TEST 銷貨單。</p>}
            {canManage&&data?.enabled&&connection?.bound&&!pending&&<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={automatic} disabled={busy} onChange={e=>setAutomatic(e.target.checked)} />此頁開啟時自動處理待回寫工作</label>}
            {pending&&<div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm space-y-3"><p><AlertTriangle size={16} className="mr-2 inline" />上次儲存結果待確認。請先連接助手，再讀取原單確認。</p><button className={button} disabled={busy||!connection} onClick={recover}>唯讀確認上次結果</button></div>}
            {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
            {note&&<p role="status" className="text-sm text-slate-700">{note}</p>}
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm"><caption className="px-5 py-4 text-left font-semibold">最近 50 筆回寫工作</caption><thead className="bg-slate-50 text-slate-600"><tr><th className="p-4">WMS 訂單</th><th className="p-4">原銷貨單</th><th className="p-4">狀態</th><th className="p-4">更新時間</th></tr></thead><tbody>{data?.jobs?.map(job=><tr key={job.id} className="border-t border-slate-100"><td className="p-4"><Link className="text-blue-700" to={`/order/${job.orderId}`}>WMS-{job.orderId}</Link></td><td className="p-4">{job.companyCode} / {job.voucherNumber}</td><td className="p-4">{jobLabels[job.status]||'待核對'}{job.lastError&&<p className="mt-1 text-xs text-amber-800">請主管核對此筆回寫</p>}{canManage&&job.canRetry&&<button className={`${button} mt-2 block`} disabled={busy||pending} onClick={()=>retry(job)}>修正後重新排隊</button>}</td><td className="p-4 whitespace-nowrap">{time(job.updatedAt)}</td></tr>)}</tbody></table>
            {data&&!data.jobs?.length&&<p className="p-5 text-sm text-slate-500">尚無回寫工作</p>}
        </div>
    </section>;
}
