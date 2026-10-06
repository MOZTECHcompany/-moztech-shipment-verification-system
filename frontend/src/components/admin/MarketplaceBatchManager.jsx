import React,{useEffect,useRef,useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {Archive,Download,Search,Trash2,X,ChevronLeft,ChevronRight} from 'lucide-react';
import {Button} from '../../ui';
import apiClient from '@/api/api.js';
import {formatMinor,prepareEcountFinancials,groupedSalesRecord} from '../../utils/marketplaceIntake.mjs';
import {API_ORIGIN} from '../../api/origin';
import {AdminDashboard} from './AdminDashboard';
const control='min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const textButton='inline-flex min-h-10 items-center gap-1 text-sm font-medium text-blue-700 hover:underline disabled:opacity-40';
const initial={status:'active',platform:'',store:'',from:'',to:'',q:'',page:1};
const dateTime=v=>new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
function OrderShipping({shipping,label='收件資料'}){
 if(!shipping||typeof shipping!=='object'||Array.isArray(shipping))return null;
 const value=key=>typeof shipping[key]==='string'?shipping[key].trim():'';
 const fields=[['收件',[value('recipient'),value('phone')].filter(Boolean).join(' · ')],['地址',[value('postalCode'),value('address')].filter(Boolean).join(' ')],['配送',[value('method'),value('storeName'),value('storeCode')].filter(Boolean).join(' · ')],['物流單號',value('trackingNumber')],['備註',value('note')]].filter(([,content])=>content);
 return fields.length?<dl className="mt-3 space-y-1 rounded-lg bg-slate-50 p-3 text-sm" aria-label={label}>{fields.map(([label,content])=><div key={label} className="flex gap-3"><dt className="w-16 shrink-0 text-slate-600">{label}</dt><dd className="min-w-0 whitespace-pre-wrap break-words text-slate-900">{content}</dd></div>)}</dl>:null;
}
export default function MarketplaceBatchManager({enabled,currentSession,refreshKey,user}){
 const [filters,setFilters]=useState(initial),[data,setData]=useState({intakes:[],facets:[],total:0,orders:0,pageSize:20});
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[detail,setDetail]=useState(null),[deleting,setDeleting]=useState(null),[revision,setRevision]=useState(0);
 const [fileLink,setFileLink]=useState(null);
 const [shippingReview,setShippingReview]=useState(null),[shippingStatus,setShippingStatus]=useState(null),[shippingBusy,setShippingBusy]=useState('');
 const detailRef=useRef(null),orderRef=useRef(null);
 const [params,setParams]=useSearchParams();const selected=params.get('batch'),focusedOrder=params.get('order'),shippingRefresh=params.get('shipping')==='refresh';
 const alive=useRef(true),session=useRef(currentSession),pending=useRef(false),dialog=useRef(null);session.current=currentSession;
 const shippingGeneration=useRef(0),shippingPending=useRef(null),shippingReviewRef=useRef(null),shippingContext=useRef(''),shippingAutoIntent=useRef(null);
 const shippingContextKey=JSON.stringify([enabled,selected,focusedOrder,shippingRefresh,user?.id,user?.role,refreshKey]);
 shippingContext.current=shippingContextKey;shippingReviewRef.current=shippingReview;
 const valid=()=>alive.current&&session.current();
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{
  shippingGeneration.current++;setShippingReview(null);setShippingStatus(null);setShippingBusy('');
  if(shippingPending.current!==null){shippingPending.current=null;pending.current=false;setBusy(false);}
 },[shippingContextKey]);
 useEffect(()=>{if(!enabled){setData({intakes:[],facets:[],total:0,orders:0,pageSize:20});setDetail(null);setDeleting(null);}},[enabled]);
 useEffect(()=>{
  if(!enabled||shippingRefresh){setLoading(false);return;}let cancelled=false;setLoading(true);
  apiClient.get('/api/marketplace-intakes',{params:filters}).then(r=>{
   if(cancelled||!valid())return;
   const pages=Math.max(1,Math.ceil(r.data.total/r.data.pageSize));
   if(filters.page>pages){setFilters(f=>({...f,page:pages}));return;}
   setData(r.data);
  }).catch(e=>{if(!cancelled&&valid()){setData(d=>({...d,intakes:[]}));setNotice(e.response?.data?.message||'批次載入失敗，請重新整理。');}}).finally(()=>{if(!cancelled&&valid())setLoading(false);});
  return()=>{cancelled=true;};
 },[enabled,shippingRefresh,filters,refreshKey,revision]);
 useEffect(()=>{
  setDetail(null);if(!selected||!enabled)return;let cancelled=false;
  Promise.all([apiClient.get(`/api/marketplace-intakes/${encodeURIComponent(selected)}`),apiClient.get(`/api/warehouse-intakes/${encodeURIComponent(selected)}`)]).then(([r,w])=>{if(!cancelled&&valid())setDetail({...r.data,warehouseFlow:w.data.flow});}).catch(e=>{if(!cancelled&&valid())setNotice(e.response?.data?.message||'無法開啟批次明細。');});
  return()=>{cancelled=true;};
 },[enabled,selected,revision]);
 useEffect(()=>{if(detail)(detail.orders.some(order=>order.sourceOrderNumber===focusedOrder)?orderRef.current:detailRef.current)?.scrollIntoView({behavior:'smooth',block:'start'});},[detail,focusedOrder]);
 useEffect(()=>{if(deleting)dialog.current?.showModal();else dialog.current?.close();},[deleting]);
 const filter=(key,value)=>setFilters(f=>({...f,[key]:value,...(key==='platform'?{store:''}:{}),page:1}));
 const closeDetail=()=>setParams(p=>{p.delete('batch');p.delete('view');p.delete('order');p.delete('shipping');return p;},{replace:true});
 const shippingEditable=orderNumber=>{
  const link=detail?.links?.find(value=>value.source_order_number===orderNumber&&value.order_id);
  return detail?.platform==='Shopify'&&!detail.archivedAt&&(!link||link.status==='pending');
 };
 const shippingCurrent=(context,generation)=>valid()&&shippingContext.current===context&&shippingGeneration.current===generation;
 const shippingAction=async(orderNumber,review=null)=>{
  if(!enabled||pending.current||!valid()||shippingContext.current!==shippingContextKey||!user?.id||!detail||String(detail.id)!==selected||!shippingEditable(orderNumber)||!detail.orders.some(order=>order.sourceOrderNumber===orderNumber))return;
  if(review&&(shippingReviewRef.current!==review||!review.changed||!shippingCurrent(review.context,review.generation)))return;
  const context=shippingContextKey,generation=++shippingGeneration.current;
  let receivedResponse=false;
  shippingPending.current=generation;pending.current=true;setBusy(true);setShippingBusy(orderNumber);setShippingStatus(null);setFileLink(null);
  if(!review)setShippingReview(null);
  try{
   const path=`/api/marketplace-intakes/${detail.id}/orders/${review?'shipping-update':'shipping-preview'}`;
   const body=review?{orderNumber,previewFingerprint:review.previewFingerprint,commandId:review.commandId,expectedActorId:user.id}:{orderNumber};
   const response=await apiClient.post(path,body,{timeout:75000});
   receivedResponse=true;
   if(!shippingCurrent(context,generation))return;
   const result=response.data;
   if(String(result?.intakeId)!==String(detail.id)||result?.orderNumber!==orderNumber)throw Error('收件資料回應不符，請重新查詢。');
   if(review){
    if(result.ok!==true||typeof result.updated!=='boolean')throw Error('收件資料保存結果未確認，請重新查詢。');
    setShippingReview(null);setShippingStatus({context,orderNumber,message:'收件資料已更新'});setRevision(value=>value+1);
   }
   else{
    const isShipping=value=>value&&typeof value==='object'&&!Array.isArray(value);
    if(!isShipping(result.previousShipping)||!isShipping(result.currentShipping)||typeof result.changed!=='boolean'||(result.changed&&(typeof result.previewFingerprint!=='string'||!result.previewFingerprint)))throw Error('收件資料未完成核對，請重新查詢。');
    if(result.changed)setShippingReview({...result,context,generation,commandId:crypto.randomUUID()});
    else setShippingStatus({context,orderNumber,message:'收件資料已是最新'});
   }
  }catch(error){if(shippingCurrent(context,generation)){
   const status=Number(error.response?.status);
   const uncertain=review&&!receivedResponse&&(!error.response||status===408||(status>=500&&status<=599));
   setShippingReview(uncertain?{...review,generation}:null);
   setShippingStatus({context,orderNumber,error:true,message:error.response?.data?.message||(uncertain?'保存結果未確認，請重試。':error.message||'收件資料更新未完成，請重新查詢。')});
  }}
  finally{if(shippingPending.current===generation){shippingPending.current=null;pending.current=false;if(valid()){setBusy(false);setShippingBusy('');}}}
 };
 useEffect(()=>{
  if(!enabled||!shippingRefresh||!selected||!focusedOrder){shippingAutoIntent.current=null;return;}
  if(pending.current||!detail||String(detail.id)!==selected||!valid()||!detail.orders.some(order=>order.sourceOrderNumber===focusedOrder))return;
  const intent=JSON.stringify([selected,focusedOrder,user?.id,user?.role]);
  if(shippingAutoIntent.current===intent)return;
  shippingAutoIntent.current=intent;
  if(shippingEditable(focusedOrder))shippingAction(focusedOrder);
 },[enabled,selected,focusedOrder,shippingRefresh,user?.id,user?.role,detail,busy]);
 const operate=async(record,action)=>{
  if(pending.current||!valid())return;pending.current=true;setBusy(true);setNotice('');setFileLink(null);
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
  if(pending.current||!valid()||shippingContext.current!==shippingContextKey||shippingRefresh&&String(id)===selected)return;const context=shippingContextKey;pending.current=true;setBusy(true);setNotice('');setFileLink(null);
  try{
   const response=await apiClient.post(`/api/marketplace-intakes/${id}/download-link`,{kind},{withCredentials:true});if(!valid()||shippingContext.current!==context)return;
   const url=`${API_ORIGIN}${response.data.url}`;setFileLink({url,label:kind==='ecount-grouped'?'下載彙總銷貨檔':kind==='ecount'?'下載原保存格式':'下載預揀與訂單明細 Excel'});
   setNotice(kind==='prepick'?'預揀與訂單明細已下載。':'銷貨檔已下載。已在 ECOUNT 儲存的批次，請勿重複匯入。');
   const anchor=document.createElement('a');anchor.href=url;anchor.download='';document.body.appendChild(anchor);anchor.click();anchor.remove();
  }catch(e){if(valid()&&shippingContext.current===context)setNotice(e.response?.data?.message||'下載失敗，請重試。');}
  finally{pending.current=false;if(valid())setBusy(false);}
 };
 const stores=[...new Set([...(filters.store?[filters.store]:[]),...data.facets.filter(f=>!filters.platform||f.source_platform===filters.platform).map(f=>f.source_store)])];
 const groups=Object.groupBy(data.intakes,r=>r.sales_date);
 let salesView=null,salesWarning='';if(detail&&!detail.financialWarning){try{salesView=prepareEcountFinancials(groupedSalesRecord(detail));}catch(e){salesWarning=e.message;}}
 const displayFinancials=salesView?.financials||detail?.financials;
 const pages=Math.max(1,Math.ceil(data.total/data.pageSize));
 return <section id="saved-batches" className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-label="批次管理">
  <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{shippingRefresh?'原訂單':`已保存批次（${data.total}）`}</h2></div>
  {!shippingRefresh&&<><div className="mt-5 grid gap-3 sm:grid-cols-3">
   <label className="text-sm">批次搜尋<input className={control} placeholder="批次編號或追蹤單號" value={filters.q} onChange={e=>filter('q',e.target.value)}/></label>
   <label className="text-sm">平台<select className={control} value={filters.platform} onChange={e=>filter('platform',e.target.value)}><option value="">全部平台</option>{['Shopify','1Shop','SHOPLINE'].map(p=><option key={p}>{p}</option>)}</select></label>
   <label className="text-sm">狀態<select className={control} value={filters.status} onChange={e=>filter('status',e.target.value)}><option value="active">未封存</option><option value="archived">已封存</option><option value="all">全部批次</option></select></label>
  </div><details className="mt-3 text-sm"><summary className="cursor-pointer font-medium text-slate-700">更多篩選</summary><div className="mt-3 grid gap-3 sm:grid-cols-3"><label className="text-sm">店鋪<select className={control} value={filters.store} onChange={e=>filter('store',e.target.value)}><option value="">全部店鋪</option>{stores.map(s=><option key={s}>{s}</option>)}</select></label>
   <label className="text-sm">開始銷貨日期<input type="date" className={control} value={filters.from} onChange={e=>filter('from',e.target.value)}/></label>
   <label className="text-sm">結束銷貨日期<input type="date" className={control} value={filters.to} onChange={e=>filter('to',e.target.value)}/></label>
  </div></details>
  <button className={textButton+' mt-2'} onClick={()=>setFilters(initial)}>清除篩選</button></>}
  {notice&&<div role="status" className="my-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-950"><p>{notice}</p>{fileLink&&<a href={fileLink.url} download className="mt-2 inline-flex min-h-10 items-center font-semibold underline" onClick={e=>{if(!valid())e.preventDefault();}}>{fileLink.label}</a>}</div>}
  {!shippingRefresh&&<>{loading?<p role="status" className="py-8 text-center text-slate-500">載入批次中…</p>:Object.entries(groups).map(([date,rows])=><section key={date} className="mt-4" aria-label={`${date} 銷貨批次`}>
   <h3 className="rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold">{date}</h3>
   <div className="mt-3 grid gap-4 lg:grid-cols-2">{rows.map(r=><article key={r.id} className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${String(r.id)===selected?'border-blue-500 ring-1 ring-blue-100':'border-slate-200'}`} aria-label={`批次 ${r.batch_number}`}>
    <div className="p-5"><div className="flex items-center justify-between gap-2"><span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{r.source_platform}</span><span className="text-xs text-slate-500">{r.archived_at?'已封存':r.warehouse_flow?(r.warehouse_flow.prepickCompletedAt?'預揀完成':r.warehouse_flow.erpConfirmedAt?'理貨已核對':'待 ECOUNT 回匯'):Number(r.linked_count)===Number(r.order_count)?'已回匯理貨':Number(r.linked_count)>0?'理貨回匯中':'待 ECOUNT 回匯'}</span></div>
     <Link className="mt-3 block break-all text-lg font-semibold text-slate-950 hover:text-blue-700" to={`?batch=${r.id}#batch-detail`}>{r.batch_number}</Link><p className="mt-1 text-sm text-slate-500">批次 #{r.id} · {r.source_store}</p>
     <p className="mt-3 text-sm">{r.order_count} 筆訂單 · {r.summary?.physicalQuantity??r.summary?.totalQuantity??0} 件商品{Number(r.linked_count)>0?` · ${r.linked_count} 張工作單`:null}</p>
     <p className="mt-3 text-sm text-slate-600">訂單總額 <strong className="text-slate-950">{formatMinor(r.summary?.ecountTotalMinor??r.summary?.totalMinor)}</strong></p>
     <div className="mt-4 flex flex-wrap gap-2">{!r.warehouse_flow?.erpConfirmedAt&&Number(r.linked_count)===0?<>
      <Button disabled={busy||!enabled} onClick={()=>download(r.id,'ecount-grouped')}><Download size={15} className="mr-1"/>下載銷貨檔</Button>
      <Button as={Link} variant="secondary" to={`?batch=${r.id}&view=return#batch-detail`}>匯回 ECOUNT 理貨單</Button>
     </>:<Button as={Link} to={r.warehouse_flow?.erpConfirmedAt?`/warehouse-intakes/${r.id}`:`?batch=${r.id}#batch-detail`}>{r.warehouse_flow?.prepickCompletedAt?'查看訂單任務':r.warehouse_flow?.erpConfirmedAt?'列印與預揀':'查看理貨批次'}</Button>}
     </div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-2"><div className="flex gap-4"><button className={textButton} disabled={busy||!enabled} onClick={()=>operate(r,r.archived_at?'restore':'archive')}><Archive size={15}/>{r.archived_at?'取消封存':'封存'}</button><button className="inline-flex min-h-10 items-center gap-1 text-sm text-red-700 disabled:text-slate-400" disabled={busy||!enabled||r.linked_count>0||!!r.warehouse_flow?.erpConfirmedAt} title={r.linked_count>0?'已連結理貨工作單，請改用封存':'永久刪除批次'} onClick={()=>{setNotice('');setDeleting(r);}}><Trash2 size={15}/>刪除</button></div></div>
   </article>)}</div>
  </section>)}
  {!loading&&!data.intakes.length&&<div className="py-10 text-center text-sm text-slate-500"><Search className="mx-auto mb-2"/>沒有符合條件的批次。</div>}
  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 text-sm"><span>每頁 {data.pageSize} 批 · 第 {filters.page}／{pages} 頁</span><div className="flex gap-2"><Button variant="secondary" disabled={loading||filters.page<=1} onClick={()=>setFilters(f=>({...f,page:f.page-1}))}><ChevronLeft size={16}/>上一頁</Button><Button variant="secondary" disabled={loading||filters.page>=pages} onClick={()=>setFilters(f=>({...f,page:f.page+1}))}>下一頁<ChevronRight size={16}/></Button></div></div></>}
  {selected&&<section ref={detailRef} id="batch-detail" className="mt-6 scroll-mt-4 rounded-xl border border-blue-200 p-4" aria-label="批次明細"><div className="flex items-center justify-between"><h3 className="font-semibold">批次 #{selected} 明細</h3><button className={textButton} onClick={closeDetail}><X size={16}/>關閉明細</button></div>{!detail?<p className="mt-3 text-sm">正在讀取批次；若失敗請查看上方訊息。</p>:<>
   {!shippingRefresh&&<div className="my-4 space-y-4" aria-label="本批出貨流程">
    {(detail.reviewWarning||detail.financialWarning||salesWarning)&&<p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{[detail.reviewWarning,detail.financialWarning,salesWarning].filter(Boolean).join("；")}</p>}
    <ol className="flex flex-wrap gap-x-5 gap-y-2 border-b border-slate-200 pb-3 text-sm"><li>1 商城訂單已保存</li><li>2 下載銷貨檔</li><li className="font-semibold text-blue-700">3 {detail.warehouseFlow?.erp_confirmed_at?'理貨已核對':'待 ECOUNT 回匯'}</li><li>4 列印與預揀</li></ol>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">{detail.platform} · {detail.store}</p><p className="mt-1 break-all text-sm text-slate-600">{detail.batchNumber} · {detail.orders.length} 筆訂單</p></div>{!detail.warehouseFlow?.erp_confirmed_at&&<Button disabled={busy||!!detail.reviewWarning||!!detail.financialWarning||!!salesWarning} onClick={()=>download(detail.id,'ecount-grouped')}>下載銷貨檔</Button>}</div>
    {detail.warehouseFlow?.erp_confirmed_at?<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-blue-50 p-4"><strong>理貨核對完成 · {detail.orders.length} 筆訂單</strong><Button as={Link} to={`/warehouse-intakes/${detail.id}`}>列印與預揀</Button></div>:!(detail.links||[]).some(link=>link.order_id)&&user&&<AdminDashboard key={`${user.id}:${detail.id}`} user={user} embedded batchId={detail.id} onMatched={()=>{if(valid())setRevision(v=>v+1);}}/>}
   </div>}
   <details className="mt-4" open={detail.orders.some(order=>order.sourceOrderNumber===focusedOrder)||undefined}><summary className="cursor-pointer font-semibold">{shippingRefresh?'原訂單資料':'訂單、商品與金額'}</summary>
   <p className="mt-2 break-all text-sm">{detail.batchNumber} · {detail.platform} · {detail.store}</p>{!shippingRefresh&&<><p className="mt-1 text-xs text-slate-500">銷貨日期 {detail.settings.date} · 保存於 {dateTime(detail.createdAt)}{detail.archivedAt?` · 封存於 ${dateTime(detail.archivedAt)}`:''}</p>
   <p className="mt-2 text-sm">轉檔建立者：{detail.handler?.name||detail.handler?.username||'未記錄'}{detail.handler?.username?`（${detail.handler.username}）`:''}{detail.handler?.legacy?' · 依原建立者帳號查得':''}</p><p className="mt-2 text-sm">{detail.summary.orderCount} 筆訂單 · {detail.settings.currency} {formatMinor(detail.summary.ecountTotalMinor)}（訂單總額不代表已收款）</p>
   <p className="mt-2 text-sm">專案負責人：{detail.settings.projectOwner||'未指定'} · 業務負責人：{detail.settings.salesOwner||'未指定'}</p>
   {displayFinancials&&<div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"><p>稅前 {formatMinor(displayFinancials.netMinor)} ＋ 營業稅 {formatMinor(displayFinancials.taxMinor)} ＝ 含稅 {formatMinor(displayFinancials.grossMinor)}</p>{detail.financials.recalculatedLegacy&&<p className="mt-2 text-amber-900">此舊批次下載時會補上稅前金額與營業稅，原保存資料保留不變。若已匯入 ERP，請核對並修正原銷貨單，勿再次匯入扣庫存。</p>}</div>}
   <details className="my-4 text-sm"><summary className="cursor-pointer text-blue-700">其他下載</summary><div className="mt-2 flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={()=>download(detail.id,'prepick')}>下載商品與訂單核對表</Button><Button variant="secondary" disabled={busy||!!detail.reviewWarning||!!detail.financialWarning} onClick={()=>download(detail.id,'ecount')}>下載原保存格式</Button></div></details>
   {salesView&&<details className="my-4 rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer font-semibold">彙總銷貨（{salesView.rows.length} 列，每列最多 200 件）</summary><div className="mt-3 overflow-x-auto"><table className="min-w-[680px] w-full text-left text-sm"><thead className="bg-slate-50"><tr>{['品項編碼','商品','數量','含稅均價','稅前金額','營業稅','含稅金額'].map(h=><th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{salesView.rows.map(r=><tr key={r[15]} className="border-t border-slate-100"><td className="p-3">{r[11]}</td><td className="p-3">{r[16]}</td><td className="p-3 font-semibold">{r[19]}</td><td className="p-3">{r[21]}</td><td className="p-3">{r[23]}</td><td className="p-3">{r[24]}</td><td className="p-3">{((r[23]+r[24])).toFixed(2)}</td></tr>)}</tbody></table></div></details>}
   <details className="my-4 rounded-xl border border-slate-200 p-4" open={params.get('view')==='prepick'||undefined}><summary className="cursor-pointer font-semibold">預揀總表 · 商品合計</summary><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr>{['ERP 品項編碼','商品名稱','已確認條碼','總數量','訂單數'].map(h=><th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{(detail.prepick?.rows||[]).map((r,i)=><tr key={i} className="border-t border-slate-100"><td className="p-3">{r[2]}</td><td className="p-3">{r[4]}</td><td className="p-3">{r[3]||'待確認'}</td><td className="p-3 font-semibold">{r[5]}</td><td className="p-3">{r[6]}</td></tr>)}</tbody></table></div></details>
   <div className="mt-3 flex flex-wrap gap-4">{[...new Map((detail.links||[]).filter(l=>l.import_batch_id).map(l=>[l.import_batch_id,l])).values()].map(l=><Link key={l.import_batch_id} className={textButton} to={`/batches/${l.import_batch_id}`}>理貨單 {l.voucher_number}：列印預揀／揀貨／裝箱明細</Link>)}</div></>}
   {shippingRefresh&&!detail.orders.some(order=>order.sourceOrderNumber===focusedOrder)&&<p role="alert" className="mt-3 text-sm text-amber-900">找不到原訂單。</p>}
   <div className="mt-4 grid gap-3">{(shippingRefresh?detail.orders.filter(order=>order.sourceOrderNumber===focusedOrder):detail.orders).map((o,index)=>{
    const review=shippingReview?.context===shippingContextKey&&shippingReview.orderNumber===o.sourceOrderNumber?shippingReview:null;
    const status=shippingStatus?.context===shippingContextKey&&shippingStatus.orderNumber===o.sourceOrderNumber?shippingStatus:null;
    const editableShipping=shippingEditable(o.sourceOrderNumber);
    const workState=(detail.links||[]).find(link=>link.source_order_number===o.sourceOrderNumber&&link.order_id)?.status;
    return <details key={o.sourceOrderNumber} ref={o.sourceOrderNumber===focusedOrder?orderRef:undefined} open={o.sourceOrderNumber===focusedOrder||undefined} aria-label={`商城訂單 ${o.sourceOrderNumber}`} className={`min-w-0 scroll-mt-4 rounded-xl border p-4 ${o.sourceOrderNumber===focusedOrder?'border-blue-500 ring-1 ring-blue-100':'border-slate-200'}`}>
     <summary className="cursor-pointer text-sm"><span className="mr-3 rounded bg-slate-100 px-2 py-1 text-slate-500">{index+1}</span><strong className="text-base">{o.sourceOrderNumber}</strong><span className="ml-4 text-slate-600">{detail.items.filter(i=>i.sourceOrderNumber===o.sourceOrderNumber).reduce((sum,i)=>sum+i.quantity,0)} 件 · {formatMinor(o.sourceFinancial?.totalMinor??o.financial.totalMinor)}</span></summary>
     {review?<div className="mt-3 rounded-lg border border-slate-200 p-3" aria-label="收件資料變更"><div className="grid gap-3 sm:grid-cols-2"><div><h4 className="text-sm font-semibold">已保存</h4><OrderShipping shipping={review.previousShipping} label="已保存收件資料"/></div><div><h4 className="text-sm font-semibold">Shopify 最新</h4><OrderShipping shipping={review.currentShipping} label="Shopify 最新收件資料"/></div></div><div className="mt-3 flex flex-wrap gap-3"><Button disabled={busy||!enabled} onClick={()=>shippingAction(o.sourceOrderNumber,review)}>{shippingBusy===o.sourceOrderNumber?'保存中…':'保存收件資料'}</Button><button className={textButton} disabled={busy||!enabled} onClick={()=>{if(valid()&&shippingReviewRef.current===review){shippingGeneration.current++;setShippingReview(null);}}}>取消</button></div></div>:<><OrderShipping shipping={o.shipping}/>{editableShipping&&<Button className="mt-3" variant="secondary" disabled={busy||!enabled} onClick={()=>shippingAction(o.sourceOrderNumber)}>{shippingBusy===o.sourceOrderNumber?'查詢中…':'更新收件資料'}</Button>}</>}
     {status&&<p role={status.error?'alert':'status'} className={`mt-2 text-sm ${status.error?'text-amber-900':'text-slate-700'}`}>{status.message}</p>}
     {!editableShipping&&workState&&<p className="mt-2 text-sm text-slate-600">{workState==='completed'?'裝箱完成':workState==='voided'?'已作廢':'倉庫作業中'}</p>}
     <div className="mt-3 overflow-x-auto"><table className="min-w-[560px] w-full text-left text-sm"><thead><tr>{['來源貨號','ERP 品項','商品','確認條碼','數量'].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{detail.items.filter(i=>i.sourceOrderNumber===o.sourceOrderNumber).map(i=>{const m=detail.settings.skuMappings[i.sku]||{};return <tr key={i.sourceLineId}><td className="p-2">{i.sku}</td><td className="p-2">{m.erpSku}</td><td className="min-w-32 p-2">{m.erpName||i.productName}</td><td className="p-2">{m.barcodeConfirmed?m.barcode:'待確認'}</td><td className="p-2">{i.quantity}</td></tr>;})}</tbody></table></div>
    </details>;
   })}</div>
   </details>
  </>}</section>}
  <dialog ref={dialog} className="w-[calc(100%-2rem)] max-w-lg rounded-2xl p-6 backdrop:bg-slate-900/40" aria-labelledby="delete-batch-title" onCancel={e=>{if(busy)e.preventDefault();else setDeleting(null);}}>
   <h3 id="delete-batch-title" className="text-lg font-semibold">確定刪除這個批次嗎？</h3><p className="mt-3 break-all text-sm font-medium">#{deleting?.id} · {deleting?.batch_number}</p><p className="mt-2 text-sm leading-6">將永久刪除本批轉檔資料及來源訂單對應，刪除後無法復原，也無法再供理貨回匯比對。刪除不會撤銷 ECOUNT 銷貨或庫存異動。</p><p className="mt-2 text-sm text-slate-600">如果日後還會回匯理貨單，請取消並使用「封存」。</p>{notice&&<p role="alert" className="mt-3 text-sm text-red-700">{notice}</p>}<div className="mt-5 flex justify-end gap-3"><Button autoFocus variant="secondary" disabled={busy} onClick={()=>setDeleting(null)}>取消</Button><Button className="!bg-red-700" disabled={busy} onClick={()=>operate(deleting,'delete')}>{busy?'處理中…':'確定永久刪除'}</Button></div>
  </dialog>
 </section>;
}
