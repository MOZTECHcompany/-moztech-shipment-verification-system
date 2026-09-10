import {useEffect,useRef,useState} from 'react';
import api from '../api/api';
const labels={awaiting_dispatch:'等待賣家出貨',at_logistics_center:'已到物流中心',awaiting_pickup:'到店待取',collected:'已取件',uncollected:'逾期未取',unmapped:'貨態待確認'};
export function LogisticsTrackingList({version,accounts}){
 const [page,setPage]=useState(0),[reload,setReload]=useState(0),[data,setData]=useState({items:[],nextOffset:null}),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(null);const pending=useRef(false);
 useEffect(()=>{const c=new AbortController();setLoading(true);setError('');api.get('/api/logistics/shipments',{params:{offset:page},signal:c.signal}).then(r=>setData(r.data)).catch(e=>{if(!c.signal.aborted)setError(e.message||'無法載入追蹤紀錄');}).finally(()=>{if(!c.signal.aborted)setLoading(false);});return()=>c.abort();},[page,reload,version]);
 const sync=async id=>{if(pending.current)return;pending.current=true;setBusy(id);setError('');try{await api.post(`/api/logistics/shipments/${id}/sync`,{},{timeout:20000});setReload(v=>v+1);}catch(e){setError(e.message||'更新失敗');}finally{pending.current=false;setBusy(null);}};
 const print=async id=>{
  if(pending.current)return;const popup=window.open('about:blank','_blank');
  if(!popup){setError('請允許彈出視窗後再列印');return;}
  popup.opener=null;popup.document.title='正在準備物流標籤';popup.document.body.textContent='正在準備物流標籤…';pending.current=true;setBusy(id);setError('');
  try{const {data}=await api.post('/api/logistics/shipments/print-form',{shipmentIds:[id]});
   if(!['https://logistics.ecpay.com.tw/helper/printTradeDocument','https://logistics-stage.ecpay.com.tw/helper/printTradeDocument'].includes(data.action)||data.method!=='POST')throw Error('列印網址不正確');
   if(popup.closed)throw Error('列印視窗已關閉');
   const form=popup.document.createElement('form');form.method='POST';form.action=data.action;
   for(const key of ['MerchantID','AllPayLogisticsID','CheckMacValue']){if(typeof data.fields?.[key]!=='string')throw Error('列印資料不完整');const input=popup.document.createElement('input');input.type='hidden';input.name=key;input.value=data.fields[key];form.appendChild(input);}
   popup.document.body.appendChild(form);form.submit();
  }catch(e){popup.close();setError(e.message||'無法準備列印');}finally{pending.current=false;setBusy(null);}
 };
 return <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">已追蹤物流</h2><button type="button" onClick={()=>setReload(v=>v+1)} disabled={loading} className="min-h-11 px-3 text-sm text-blue-600">重新整理</button></div>
 {error&&<p role="alert" className="my-3 text-sm text-red-700">{error}</p>}{loading?<p role="status" className="py-5 text-sm text-slate-500">正在載入…</p>:!data.items.length?<p className="py-5 text-sm text-slate-500">尚無追蹤紀錄，查詢物流單後可加入。</p>:<div className="mt-3 divide-y divide-slate-100">{data.items.map(s=><article key={s.id} className="flex flex-wrap items-center gap-3 py-4"><div className="min-w-0 flex-1"><p className="break-all font-medium">{s.merchant_trade_no}</p><p className="mt-1 break-all text-xs text-slate-500">{accounts.find(a=>a.id===s.account_id)?.label||s.account_id} · 配送 {s.shipment_no||'待取得'}</p><p className="mt-1 text-xs text-slate-500">更新：{new Date(s.checked_at).toLocaleString('zh-TW')}</p></div><div><p className="text-sm">{labels[s.status]||'貨態待確認'} <span className="text-xs text-slate-400">{s.status_code}</span></p>{s.return_status&&<p className="mt-1 text-xs text-amber-700">{s.return_status==='expected'?'待追蹤退回，尚未確認實收':'退回狀態有變更，請核對'}</p>}{s.last_error_code&&<p className="mt-1 text-xs text-red-600">上次同步失敗</p>}</div><button type="button" onClick={()=>sync(s.id)} disabled={!!busy} className="min-h-11 rounded-lg border border-slate-200 px-3 text-sm disabled:opacity-40">{busy===s.id?'處理中…':'更新貨態'}</button><button type="button" onClick={()=>print(s.id)} disabled={!!busy} className="min-h-11 rounded-lg border border-slate-200 px-3 text-sm disabled:opacity-40">列印託運單</button></article>)}</div>}
 <div className="mt-3 flex justify-end gap-3"><button type="button" disabled={loading||page===0} onClick={()=>setPage(Math.max(0,page-50))} className="min-h-11 px-3 text-sm disabled:opacity-30">上一頁</button><button type="button" disabled={loading||data.nextOffset===null} onClick={()=>setPage(data.nextOffset)} className="min-h-11 px-3 text-sm disabled:opacity-30">下一頁</button></div>
 </section>;
}
