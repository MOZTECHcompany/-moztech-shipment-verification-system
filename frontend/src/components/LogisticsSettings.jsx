import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {Truck,ArrowLeft,Search} from 'lucide-react';
import api from '../api/api';
import {PageHeader} from '../ui';
import {LogisticsTrackingList} from './LogisticsTrackingList';
const names={UNIMART:'7-ELEVEN',FAMI:'全家',HILIFE:'萊爾富'};
export function LogisticsSettings(){
 const [accounts,setAccounts]=useState([]),[accountId,setAccountId]=useState(''),[kind,setKind]=useState('logisticsId'),[value,setValue]=useState(''),[result,setResult]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [trackingVersion,setTrackingVersion]=useState(0),[saving,setSaving]=useState(false);
 const sequence=useRef(0),pending=useRef(false);
 useEffect(()=>{const controller=new AbortController();api.get('/api/logistics/accounts',{signal:controller.signal}).then(({data})=>setAccounts(data.accounts)).catch(e=>{if(!controller.signal.aborted)setError(e.message||'無法載入物流帳號');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>{controller.abort();sequence.current++;};},[]);
 const change=fn=>{sequence.current++;setResult(null);setError('');fn();};
 const submit=async e=>{e.preventDefault();if(pending.current)return;pending.current=true;setBusy(true);setError('');setResult(null);const current=++sequence.current;try{const {data}=await api.post(`/api/logistics/accounts/${encodeURIComponent(accountId)}/query`,{[kind]:value.trim()},{timeout:16000});if(current===sequence.current)setResult(data);}catch(e){if(current===sequence.current)setError(e.message||'查詢失敗');}finally{pending.current=false;setBusy(false);}};
 const save=async()=>{if(!result||saving)return;setSaving(true);const current=sequence.current;try{await api.post(`/api/logistics/accounts/${encodeURIComponent(result.accountId)}/import`,{query:{logisticsId:result.logisticsId}},{timeout:20000});setTrackingVersion(v=>v+1);}catch(e){if(current===sequence.current)setError(e.message||'加入追蹤失敗');}finally{setSaving(false);}};
 const selected=accounts.find(a=>a.id===accountId);
 return <div className="pb-8"><PageHeader title="物流串接"/><Link to="/settings" className="mb-5 inline-flex items-center gap-2 text-sm text-slate-600"><ArrowLeft size={16}/>返回設定</Link>
  {loading?<p role="status">正在載入物流帳號…</p>:<div className="grid items-start gap-5 xl:grid-cols-2">
   <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="mb-4 font-semibold">綠界帳號</h2>
    {!accounts.length?<p className="text-sm text-slate-500">尚未配置物流帳號</p>:accounts.map(a=><button key={a.id} type="button" aria-pressed={accountId===a.id} onClick={()=>change(()=>setAccountId(a.id))} className={`mb-3 flex w-full items-start gap-3 rounded-lg border p-4 text-left ${accountId===a.id?'border-blue-500 bg-blue-50':'border-slate-200'}`}><Truck size={20} className="mt-1 shrink-0 text-blue-600"/><span className="min-w-0 flex-1"><span className="block font-medium">{a.label}</span><span className="mt-1 block text-xs text-slate-500">商店 {a.merchantId} · {a.environment==='production'?'正式':'測試'}</span><span className="mt-2 block text-xs text-slate-600">{a.services.map(s=>names[s]||s).join('、')||'通路待確認'}</span></span><span className={`shrink-0 text-xs ${a.queryReady?'text-emerald-700':'text-slate-500'}`}>{a.queryReady?'可查詢':'待設定'}</span></button>)}
   </section>
   <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">物流單查詢</h2><p className="mt-1 text-xs text-slate-500">查詢既有物流單，不會建立新單。</p>
    <form onSubmit={submit} className="mt-5 space-y-4"><label className="block text-sm">編號類型<select value={kind} onChange={e=>change(()=>setKind(e.target.value))} className="mt-2 min-h-11 w-full rounded-lg border border-slate-200 px-3"><option value="logisticsId">綠界物流訂單編號</option><option value="merchantTradeNo">廠商訂單編號</option></select></label><label className="block text-sm">查詢編號<input value={value} onChange={e=>change(()=>setValue(e.target.value))} maxLength={20} inputMode={kind==='logisticsId'?'numeric':'text'} autoComplete="off" required className="mt-2 min-h-11 w-full rounded-lg border border-slate-200 px-3"/></label><button disabled={busy||!selected?.queryReady||!value.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-5 text-sm text-white disabled:opacity-40"><Search size={17}/>{busy?'查詢中…':'查詢'}</button>{!selected&&<p className="text-xs text-slate-500">請先選擇物流帳號</p>}</form>
    {error&&<p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {result&&<div aria-live="polite" className="mt-5 rounded-lg bg-slate-50 p-4"><p className="font-semibold">{result.statusLabel}<span className="ml-2 text-xs font-normal text-slate-500">{result.statusCode}</span></p><dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">{[['物流',names[result.service]||result.service],['廠商單號',result.merchantTradeNo],['物流單號',result.logisticsId],['配送編號',result.shipmentNo],['查詢時間',new Date(result.checkedAt).toLocaleString('zh-TW')]].map(([label,val])=><div key={label} className="contents"><dt className="text-slate-500">{label}</dt><dd className="break-all">{val||'—'}</dd></div>)}</dl><button type="button" onClick={save} disabled={saving} className="mt-4 min-h-11 rounded-lg border border-blue-200 px-4 text-sm text-blue-700 disabled:opacity-40">{saving?'正在加入…':'加入追蹤'}</button>{result.needsReturnTracking&&<p className="mt-3 text-sm text-amber-800">包裹逾期未取，請追蹤退回；倉庫實收仍須另外核對。</p>}</div>}
   </section>
  </div>}
 {!loading&&<LogisticsTrackingList version={trackingVersion} accounts={accounts}/>}
 </div>;
}
