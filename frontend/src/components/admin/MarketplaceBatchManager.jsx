import React,{useEffect,useRef,useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {Archive,Download,Search,Trash2,X,ChevronLeft,ChevronRight} from 'lucide-react';
import {Button} from '../../ui';
import apiClient from '@/api/api.js';
import {formatMinor} from '../../utils/marketplaceIntake.mjs';
import {savedBatchTables} from '../../utils/marketplaceBatchFiles.mjs';
const control='min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const textButton='inline-flex min-h-10 items-center gap-1 text-sm font-medium text-blue-700 hover:underline disabled:opacity-40';
const initial={status:'active',platform:'',store:'',from:'',to:'',q:'',page:1};
const dateTime=v=>new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
export default function MarketplaceBatchManager({enabled,currentSession,refreshKey}){
 const [filters,setFilters]=useState(initial),[data,setData]=useState({intakes:[],facets:[],total:0,orders:0,pageSize:20});
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[detail,setDetail]=useState(null),[deleting,setDeleting]=useState(null),[revision,setRevision]=useState(0);
 const [params,setParams]=useSearchParams();const selected=params.get('batch');
 const alive=useRef(true),session=useRef(currentSession),pending=useRef(false),dialog=useRef(null);session.current=currentSession;
 const valid=()=>alive.current&&session.current();
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(!enabled){setData({intakes:[],facets:[],total:0,orders:0,pageSize:20});setDetail(null);setDeleting(null);}},[enabled]);
 useEffect(()=>{
  if(!enabled)return;let cancelled=false;setLoading(true);
  apiClient.get('/api/marketplace-intakes',{params:filters}).then(r=>{
   if(cancelled||!valid())return;
   const pages=Math.max(1,Math.ceil(r.data.total/r.data.pageSize));
   if(filters.page>pages){setFilters(f=>({...f,page:pages}));return;}
   setData(r.data);
  }).catch(e=>{if(!cancelled&&valid()){setData(d=>({...d,intakes:[]}));setNotice(e.response?.data?.message||'批次載入失敗，請重新整理。');}}).finally(()=>{if(!cancelled&&valid())setLoading(false);});
  return()=>{cancelled=true;};
 },[enabled,filters,refreshKey,revision]);
 useEffect(()=>{
  setDetail(null);if(!selected||!enabled)return;let cancelled=false;
  apiClient.get(`/api/marketplace-intakes/${encodeURIComponent(selected)}`).then(r=>{if(!cancelled&&valid())setDetail(r.data);}).catch(e=>{if(!cancelled&&valid())setNotice(e.response?.data?.message||'無法開啟批次明細。');});
  return()=>{cancelled=true;};
 },[enabled,selected,revision]);
 useEffect(()=>{if(deleting)dialog.current?.showModal();else dialog.current?.close();},[deleting]);
 const filter=(key,value)=>setFilters(f=>({...f,[key]:value,...(key==='platform'?{store:''}:{}),page:1}));
 const closeDetail=()=>setParams(p=>{p.delete('batch');return p;},{replace:true});
 const operate=async(record,action)=>{
  if(pending.current||!valid())return;pending.current=true;setBusy(true);setNotice('');
  try{
   if(action==='delete')await apiClient.delete(`/api/marketplace-intakes/${record.id}`,{data:{confirmed:true,batchNumber:record.batch_number}});
   else await apiClient.patch(`/api/marketplace-intakes/${record.id}/${action}`);
   if(!valid())return;
   if(action==='delete'){setDeleting(null);if(String(record.id)===selected)closeDetail();}
   setRevision(v=>v+1);setNotice(action==='delete'?'批次已永久刪除。':action==='archive'?'批次已封存，仍可供理貨回匯比對。':'批次已取消封存。');
  }catch(e){if(valid())setNotice(e.response?.data?.message||'操作結果尚未確認，請重新讀取批次後再操作。');}
  finally{pending.current=false;if(valid())setBusy(false);}
 };
 const download=async(id,kind)=>{
  if(pending.current||!valid())return;pending.current=true;setBusy(true);setNotice('');
  try{
   const r=await apiClient.get(`/api/marketplace-intakes/${id}`),XLSX=await import('xlsx');if(!valid())return;
   const book=XLSX.utils.book_new();for(const t of savedBatchTables(r.data,kind)){const sheet=XLSX.utils.aoa_to_sheet(t.rows);sheet['!cols']=(t.rows[0]||[]).map(()=>({wch:24}));XLSX.utils.book_append_sheet(book,sheet,t.name);}
   XLSX.writeFile(book,`${kind==='ecount'?'ECOUNT銷貨匯入':'WMS預揀與訂單明細'}_${r.data.batchNumber}.xlsx`);
   setNotice(kind==='ecount'?'銷貨檔已下載；重新下載不代表需要再次上傳 ERP。':'預揀總表與訂單明細已下載。掃碼用紙本工作單請從理貨批次頁列印。');
  }catch(e){if(valid())setNotice(e.response?.data?.message||e.message||'下載失敗，請重試。');}
  finally{pending.current=false;if(valid())setBusy(false);}
 };
 const stores=[...new Set(data.facets.filter(f=>!filters.platform||f.source_platform===filters.platform).map(f=>f.source_store))];
 const groups=Object.groupBy(data.intakes,r=>r.sales_date);
 const pages=Math.max(1,Math.ceil(data.total/data.pageSize));
 return <section id="saved-batches" className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-label="批次管理">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">批次管理</h2><p className="mt-1 text-sm text-slate-500">依銷貨日期整理，保留每筆商城訂單及理貨關聯。</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-sm">{data.total} 批 · {data.orders} 筆訂單</span></div>
  <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
   <label className="text-sm">批次搜尋<input className={control} placeholder="批次編號或追蹤單號" value={filters.q} onChange={e=>filter('q',e.target.value)}/></label>
   <label className="text-sm">平台<select className={control} value={filters.platform} onChange={e=>filter('platform',e.target.value)}><option value="">全部平台</option>{['Shopify','1Shop','SHOPLINE'].map(p=><option key={p}>{p}</option>)}</select></label>
   <label className="text-sm">店鋪<select className={control} value={filters.store} onChange={e=>filter('store',e.target.value)}><option value="">全部店鋪</option>{stores.map(s=><option key={s}>{s}</option>)}</select></label>
   <label className="text-sm">開始銷貨日期<input type="date" className={control} value={filters.from} onChange={e=>filter('from',e.target.value)}/></label>
   <label className="text-sm">結束銷貨日期<input type="date" className={control} value={filters.to} onChange={e=>filter('to',e.target.value)}/></label>
   <label className="text-sm">顯示狀態<select className={control} value={filters.status} onChange={e=>filter('status',e.target.value)}><option value="active">未封存</option><option value="archived">已封存</option><option value="all">全部批次</option></select></label>
  </div>
  <div className="mt-2 flex justify-end"><button className={textButton} onClick={()=>setFilters(initial)}>清除篩選</button></div>
  {notice&&<p role="status" className="my-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{notice}</p>}
  {loading?<p role="status" className="py-8 text-center text-slate-500">載入批次中…</p>:Object.entries(groups).map(([date,rows])=><section key={date} className="mt-4" aria-label={`${date} 銷貨批次`}>
   <h3 className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold">{date} <span className="ml-2 font-normal text-slate-500">本頁 {rows.length} 批</span></h3>
   <div className="divide-y divide-slate-100">{rows.map(r=><article key={r.id} className="grid gap-3 px-1 py-4 xl:grid-cols-[1fr_auto]">
    <div className="min-w-0"><Link className="break-all font-semibold text-blue-700 hover:underline" to={`?batch=${r.id}#batch-detail`}>#{r.id} · {r.batch_number}</Link>{r.archived_at&&<span className="ml-2 rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">已封存</span>}<p className="mt-1 text-sm">{r.source_platform} · {r.source_store}</p><p className="mt-1 text-sm text-slate-500">{r.order_count} 筆訂單 · {r.summary?.physicalQuantity??r.summary?.totalQuantity??0} 件 · 已回匯 {r.linked_count} 筆</p></div>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1"><button className={textButton} disabled={busy||!enabled} onClick={()=>download(r.id,'ecount')}><Download size={15}/>銷貨檔</button><button className={textButton} disabled={busy||!enabled} onClick={()=>download(r.id,'prepick')}>預揀與明細</button><Link className={textButton} to={`/admin?intakeId=${r.id}`}>匯入理貨單</Link><button className={textButton} disabled={busy||!enabled} onClick={()=>operate(r,r.archived_at?'restore':'archive')}><Archive size={15}/>{r.archived_at?'取消封存':'封存'}</button><button className="inline-flex min-h-10 items-center gap-1 text-sm text-red-700 disabled:text-slate-400" disabled={busy||!enabled||r.linked_count>0} title={r.linked_count>0?'已連結理貨工作單，請改用封存':'永久刪除批次'} onClick={()=>setDeleting(r)}><Trash2 size={15}/>刪除</button></div>
   </article>)}</div>
  </section>)}
  {!loading&&!data.intakes.length&&<div className="py-10 text-center text-sm text-slate-500"><Search className="mx-auto mb-2"/>沒有符合條件的批次。</div>}
  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 text-sm"><span>每頁 {data.pageSize} 批 · 第 {filters.page}／{pages} 頁</span><div className="flex gap-2"><Button variant="secondary" disabled={loading||filters.page<=1} onClick={()=>setFilters(f=>({...f,page:f.page-1}))}><ChevronLeft size={16}/>上一頁</Button><Button variant="secondary" disabled={loading||filters.page>=pages} onClick={()=>setFilters(f=>({...f,page:f.page+1}))}>下一頁<ChevronRight size={16}/></Button></div></div>
  {selected&&<section id="batch-detail" className="mt-6 scroll-mt-4 rounded-xl border border-blue-200 p-4" aria-label="批次明細"><div className="flex items-center justify-between"><h3 className="font-semibold">批次 #{selected} 明細</h3><button className={textButton} onClick={closeDetail}><X size={16}/>關閉明細</button></div>{!detail?<p className="mt-3 text-sm">正在讀取批次；若失敗請查看上方訊息。</p>:<>
   <p className="mt-2 break-all text-sm">{detail.batchNumber} · {detail.platform} · {detail.store}</p><p className="mt-1 text-xs text-slate-500">銷貨日期 {detail.settings.date} · 保存於 {dateTime(detail.createdAt)}{detail.archivedAt?` · 封存於 ${dateTime(detail.archivedAt)}`:''}</p>
   <p className="mt-2 text-sm">{detail.summary.orderCount} 筆訂單 · {detail.settings.currency} {formatMinor(detail.summary.ecountTotalMinor)}（訂單總額不代表已收款）</p>
   <div className="mt-3 flex flex-wrap gap-4">{[...new Map((detail.links||[]).filter(l=>l.import_batch_id).map(l=>[l.import_batch_id,l])).values()].map(l=><Link key={l.import_batch_id} className={textButton} to={`/batches/${l.import_batch_id}`}>理貨單 {l.voucher_number}：列印預揀／揀貨／裝箱明細</Link>)}</div>
   {!(detail.links||[]).some(l=>l.import_batch_id)&&<p className="mt-2 text-sm text-slate-500">尚未回匯 ECOUNT 理貨單。回匯後會提供理貨批次連結及 WT 掃碼工作單列印。</p>}
   <div className="mt-4 space-y-2">{detail.orders.map(o=><details key={o.sourceOrderNumber} className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-medium">{o.sourceOrderNumber} · 訂單總額 {formatMinor(o.sourceFinancial?.totalMinor??o.financial.totalMinor)}</summary><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['來源貨號','ERP 品項','商品','確認條碼','數量'].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{detail.items.filter(i=>i.sourceOrderNumber===o.sourceOrderNumber).map(i=>{const m=detail.settings.skuMappings[i.sku]||{};return <tr key={i.sourceLineId}><td className="p-2">{i.sku}</td><td className="p-2">{m.erpSku}</td><td className="p-2">{m.erpName||i.productName}</td><td className="p-2">{m.barcodeConfirmed?m.barcode:'待確認'}</td><td className="p-2">{i.quantity}</td></tr>;})}</tbody></table></div></details>)}</div>
  </>}</section>}
  <dialog ref={dialog} className="w-[calc(100%-2rem)] max-w-lg rounded-2xl p-6 backdrop:bg-slate-900/40" aria-labelledby="delete-batch-title" onCancel={e=>{if(busy)e.preventDefault();else setDeleting(null);}}>
   <h3 id="delete-batch-title" className="text-lg font-semibold">確定刪除這個批次嗎？</h3><p className="mt-3 break-all text-sm font-medium">#{deleting?.id} · {deleting?.batch_number}</p><p className="mt-2 text-sm leading-6">將永久刪除本批轉檔資料及來源訂單對應，刪除後無法復原，也無法再供理貨回匯比對。刪除不會撤銷 ECOUNT 銷貨或庫存異動。</p><p className="mt-2 text-sm text-slate-600">如果日後還會回匯理貨單，請取消並使用「封存」。</p>{notice&&<p role="alert" className="mt-3 text-sm text-red-700">{notice}</p>}<div className="mt-5 flex justify-end gap-3"><Button autoFocus variant="secondary" disabled={busy} onClick={()=>setDeleting(null)}>取消</Button><Button className="!bg-red-700" disabled={busy} onClick={()=>operate(deleting,'delete')}>{busy?'處理中…':'確定永久刪除'}</Button></div>
  </dialog>
 </section>;
}
