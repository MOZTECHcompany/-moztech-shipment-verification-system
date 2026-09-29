import React,{useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import api from '@/api/api.js';
import {socket} from '@/api/socket.js';
export default function WarehouseTaskQueue({user,active=true}){
 const [batches,setBatches]=useState([]),[error,setError]=useState('');
 useEffect(()=>{
  if(!active)return;
  let alive=true;
  const refresh=()=>api.get('/api/warehouse-intakes?ready=1').then(r=>{if(alive){setBatches(r.data?.batches||[]);setError('');}}).catch(()=>{if(alive)setError('預揀任務讀取失敗');});
  refresh();socket.on('warehouse_tasks_changed',refresh);window.addEventListener('focus',refresh);
  return()=>{alive=false;socket.off('warehouse_tasks_changed',refresh);window.removeEventListener('focus',refresh);};
 },[user.id,user.role,active]);
 if(!active)return null;
 const manager=['admin','superadmin','dispatcher'].includes(user.role);
 return <section aria-label="整批預揀任務" className="mb-5"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">{manager?'整批預揀':'我的預揀任務'}</h2>{manager&&<Link className="min-h-10 content-center text-sm text-blue-700 underline" to="/warehouse-intakes">全部批次</Link>}</div>{error?<p role="alert" className="text-amber-900">{error}</p>:!batches.length?<p className="text-sm text-slate-500">目前沒有待預揀的批次</p>:<div className="grid gap-3 md:grid-cols-2">{batches.map(b=><Link key={b.id} to={`/warehouse-intakes/${b.id}`} className="rounded-xl border border-blue-200 bg-white p-5 hover:border-blue-500"><p className="font-semibold">{b.source_platform} · {b.source_store}</p><p className="mt-2 text-sm text-slate-600">{b.batch_number}</p><p className="mt-3">{b.order_count} 筆訂單 · {b.total_quantity} 件</p><div className="mt-4 flex flex-wrap justify-between gap-2"><span className="text-sm text-slate-600">{b.prepick_owner_name||'尚未指派'}</span><strong className="text-blue-700">{!b.printed_at?'待列印':b.prepick_owner_name?'進行預揀':'指派預揀'} →</strong></div></Link>)}</div>}</section>;
}
