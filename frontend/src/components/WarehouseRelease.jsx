import React,{useEffect,useRef,useState} from 'react';
import {Link,useParams} from 'react-router-dom';
import {useReactToPrint} from 'react-to-print';
import * as XLSX from 'xlsx';
import api from '@/api/api.js';
import {API_ORIGIN} from '@/api/origin';
import {UploadCloud,FileSpreadsheet,Download,ChevronRight} from 'lucide-react';
import {Button} from '@/ui';
import {OrderBarcode} from './OrderBarcode';
const box='rounded-2xl border border-slate-200 bg-white p-5';
const input='min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2';
const labels={pending:'待揀貨',picking:'揀貨中',picked:'二次查核要裝箱',packing:'裝箱複檢中',completed:'裝箱完成',voided:'已作廢'};
const actions={enable:'啟用流程','confirm-barcode':'確認商品實物條碼','confirm-sales':'銷貨核對通過',print:'領單／重印',assign:'指派預揀','reset-product':'重設商品待重新清點',scan:'商品預揀查核',complete:'預揀完成，放行揀貨'};
const time=v=>v?new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'尚未完成';
export default function WarehouseRelease({user}){
 const {intakeId}=useParams();
 return intakeId?<ReleaseDetail key={`${user.id}:${intakeId}`} id={intakeId} user={user}/>:<ReleaseList user={user}/>;
}
function ReleaseList({user}){
 const [data,setData]=useState([]),[error,setError]=useState('');
 useEffect(()=>{let alive=true;api.get('/api/warehouse-intakes').then(r=>{if(alive)setData(r.data.batches);}).catch(e=>{if(alive)setError(e.response?.data?.message||'讀取失敗');});return()=>{alive=false;};},[]);
 return <main className="mx-auto max-w-6xl space-y-5 pb-8"><Link to="/tasks" className="text-blue-700">← 返回作業看板</Link><h1 className="text-2xl font-semibold">{['admin','superadmin','dispatcher'].includes(user.role)?'商城批次':'我的預揀批次'}</h1>{error&&<p role="alert">{error}</p>}<div className="grid gap-4 md:grid-cols-2">{data.map(b=><Link key={b.id} className={box+' hover:border-blue-500'} to={`/warehouse-intakes/${b.id}`}><strong>{b.batch_number}</strong><p className="mt-2">{b.source_platform} · {b.source_store}</p><p className="mt-3 text-blue-700">{b.prepick_completed_at?'預揀完成 · 訂單揀貨／裝箱':b.printed_at?'已領單 · 預揀中':b.erp_confirmed_at?'銷貨核對通過 · 待領單':'待 ECOUNT 銷貨回傳核對'}</p><p className="mt-2 text-sm">預揀人員：{b.prepick_owner_name||'未指派'}</p></Link>)}</div>{!data.length&&!error&&<p>{['admin','superadmin','dispatcher'].includes(user.role)?'目前沒有待處理批次。':'目前沒有指派給你的預揀批次。'}</p>}</main>;
}
function ReleaseDetail({id,user}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[staff,setStaff]=useState([]),[assignee,setAssignee]=useState('');
 const [rows,setRows]=useState(null),[filename,setFilename]=useState(''),[confirmed,setConfirmed]=useState(false),[barcode,setBarcode]=useState(''),[product,setProduct]=useState(''),[quantity,setQuantity]=useState(1);
 const [fileError,setFileError]=useState(''),[dragging,setDragging]=useState(false);
 const receiptFileRef=useRef(null),barcodeDetailsRef=useRef(null);
 const [paper,setPaper]=useState('prepick'),[printData,setPrintData]=useState(null);
 const paperRef=useRef(null),printResolve=useRef(null),pending=useRef(null),alive=useRef(true),sessionToken=useRef(localStorage.getItem('wms_token'));
 const pendingKey=`wms-warehouse-command:${user.id}:${id}`;
 const valid=()=>alive.current&&localStorage.getItem('wms_token')===sessionToken.current;
 const manager=['admin','superadmin','dispatcher'].includes(user.role);
 const refresh=async()=>{const r=await api.get(`/api/warehouse-intakes/${id}`);if(valid())setData(r.data);return r.data;};
 useEffect(()=>{alive.current=true;try{pending.current=JSON.parse(sessionStorage.getItem(pendingKey)||'null');if(pending.current)setError('有結果待確認的操作，請按「重試原操作」核對；不會重複計數。');}catch{}refresh().catch(e=>setError(e.response?.data?.message||'批次讀取失敗'));if(manager)api.get('/api/warehouse-intakes/staff').then(r=>{if(valid())setStaff(r.data.staff);}).catch(()=>{});return()=>{alive.current=false;};},[id]);
 useEffect(()=>{if(printData&&printResolve.current){printResolve.current();printResolve.current=null;}},[printData]);
 const mutate=async(action,payload={})=>{
  if(!valid())throw Error('登入人員已變更，請重新整理');
  const content=JSON.stringify([action,payload]);
  if(pending.current&&pending.current.content!==content)throw Error('上一操作結果待確認，請先重試相同操作');
  pending.current ||= {content,body:{...payload,commandId:crypto.randomUUID(),expectedActorId:user.id}};
  sessionStorage.setItem(pendingKey,JSON.stringify(pending.current));
  try{await api.post(`/api/warehouse-intakes/${id}/${action}`,pending.current.body);pending.current=null;sessionStorage.removeItem(pendingKey);}
  catch(e){if(e.response&&e.response.status<500){pending.current=null;sessionStorage.removeItem(pendingKey);}throw e;}
  return refresh();
 };
 const run=async(action,payload)=>{if(busy)return;setBusy(true);setError('');setNotice('');try{await mutate(action,payload);if(action==='scan'){setBarcode('');setNotice(`已記錄 ${payload.quantity} 件。`);}if(action==='assign')setNotice('預揀人員已指派。');if(action==='reset-product')setNotice('已歸零，請重新清點。');}catch(e){setError(e.response?.data?.message||e.message||'操作失敗，請以相同內容重試');}finally{if(valid())setBusy(false);}};
 const print=useReactToPrint({contentRef:paperRef,documentTitle:`${paper==='prepick'?'預揀總表':'訂單作業明細'}-${data?.batch.batch_number||id}`,
  onBeforePrint:async()=>{if(!valid())throw Error('登入人員已變更');const fresh=await mutate('print',{kind:paper});await new Promise(resolve=>{printResolve.current=resolve;setPrintData(fresh);});},
  onPrintError:(_,e)=>{setError(e.response?.data?.message||e.message||'列印未開啟，請重試');setBusy(false);},onAfterPrint:()=>{setBusy(false);setNotice('列印視窗已關閉；缺紙可重印。');},
  pageStyle:'@page {size:A4;margin:10mm} @media print {body {color:#000;background:white} thead{display:table-header-group} tr{break-inside:avoid} .work-sheet{break-after:page}.work-sheet:last-child{break-after:auto}}'});
 const downloadFormat=async()=>{try{const r=await api.get('/api/warehouse-intakes/receipt-format',{responseType:'blob'});if(!valid())return;const url=URL.createObjectURL(r.data),a=document.createElement('a');a.href=url;a.download='ECOUNT銷貨回傳欄位.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch{setError('欄位範本下載失敗');}};
 const readFiles=async files=>{
  if(busy||!files?.length||!valid())return;
  setRows(null);setConfirmed(false);setFileError('');setError('');setNotice('');setFilename(files[0].name);setBusy(true);
  try{
   const file=files[0];
   if(files.length!==1||!file.size||! /\.(xlsx|xls|csv)$/i.test(file.name))throw Error('請選擇一份 ECOUNT 銷貨明細 Excel／CSV。');
   if(file.size>10*1024*1024)throw Error('檔案上限 10 MiB');
   const book=XLSX.read(await file.arrayBuffer(),{type:'array',raw:true,sheetRows:10001});
   if(book.SheetNames.length!==1)throw Error('請使用單一工作表，避免漏讀');
   const sheet=book.Sheets[book.SheetNames[0]],range=XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']||'A1');
   if(range.e.r>=10000||range.e.c>=100)throw Error('資料範圍超限');
   const parsed=XLSX.utils.sheet_to_json(sheet,{header:1,raw:false,defval:''});
   const header=parsed.findIndex(r=>r.some(c=>String(c).trim()==='ECOUNT實際銷貨單號')&&r.some(c=>String(c).trim()==='來源明細號'));
   if(header<0)throw Error('此報表缺少可核對的銷貨單號或來源明細號欄位。請在 ECOUNT 匯出格式加入這些欄位後重新匯出。');
   if(!parsed.slice(header+1).some(r=>r.some(c=>String(c).trim())))throw Error('檔案沒有銷貨明細，請勿上傳空白欄位範本。');
   if(valid())setRows(parsed);
  }catch(e){if(valid())setFileError(e.message||'檔案讀取失敗');}
  finally{if(valid())setBusy(false);}
 };
 const downloadSales=async()=>{
  if(busy||!valid())return;setBusy(true);setError('');setNotice('');
  try{const r=await api.post(`/api/marketplace-intakes/${id}/download-link`,{kind:'ecount-grouped'},{withCredentials:true});if(!valid())return;const a=document.createElement('a');a.href=API_ORIGIN+r.data.url;a.download='';document.body.appendChild(a);a.click();a.remove();setNotice('彙總銷貨檔已下載。已在 ECOUNT 儲存的批次，請勿重複匯入。');}
  catch(e){if(valid())setError(e.response?.data?.message||'銷貨檔下載失敗');}finally{if(valid())setBusy(false);}
 };
 if(!data)return <main><p role="status">{error||'載入批次…'}</p></main>;
 const {batch,flow,orders,products,events}=data;
 const missingBarcodes=products.filter(p=>!p.barcode);
 const showBarcodeIssues=()=>{if(barcodeDetailsRef.current){barcodeDetailsRef.current.open=true;barcodeDetailsRef.current.scrollIntoView({behavior:'smooth',block:'start'});}};
 return <main className="mx-auto max-w-7xl space-y-5 pb-8"><div className="flex flex-wrap justify-between gap-3"><Link to="/warehouse-intakes" className="text-blue-700">← 整批預揀作業</Link><Button variant="secondary" disabled={busy} onClick={()=>refresh().catch(()=>setError('更新失敗'))}>更新進度</Button></div>
  <header><h1 className="text-2xl font-semibold">{manager&&!flow?.erp_confirmed_at?'匯回 ECOUNT 銷貨明細':flow?.prepick_completed_at?'訂單揀貨與裝箱':'列印與預揀'}</h1><p className="mt-3">{batch.source_platform} · {batch.source_store} · {orders.length} 筆訂單 · {products.reduce((n,p)=>n+p.quantity,0)} 件</p><p className="mt-1 break-all text-sm text-slate-500">批次 {batch.batch_number}</p></header>
  {manager&&<ol aria-label="批次作業流程" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 pb-4 text-sm"><li className="text-slate-500">1. 銷貨檔備妥</li><li aria-hidden="true"><ChevronRight size={16} className="text-slate-400"/></li><li aria-current={!flow?.erp_confirmed_at?'step':undefined} className={!flow?.erp_confirmed_at?'font-semibold text-blue-700':'text-slate-500'}>2. 匯回銷貨明細</li><li aria-hidden="true"><ChevronRight size={16} className="text-slate-400"/></li><li aria-current={flow?.erp_confirmed_at?'step':undefined} className={flow?.erp_confirmed_at?'font-semibold text-blue-700':'text-slate-500'}>3. 列印與預揀</li></ol>}
  {notice&&<p role="status" className="rounded-lg bg-slate-50 px-4 py-2 text-sm text-slate-700">{notice}</p>}
  {error&&<div role="alert" className="rounded-xl bg-amber-50 p-4 text-amber-950"><p>{error}</p>{pending.current&&<Button className="mt-3" disabled={busy} onClick={()=>{const [a,p]=JSON.parse(pending.current.content);run(a,p);}}>重試原操作</Button>}</div>}
  {!flow?<section className={box}><p>此批尚未建立預揀工作。</p>{manager&&<Button className="mt-3" disabled={busy} onClick={()=>run('enable')}>建立預揀工作</Button>}</section>:<>
   {manager&&<section className={flow.erp_confirmed_at?'rounded-xl border border-slate-200 bg-white px-5 py-3':box}>{flow.erp_confirmed_at?<details className="text-sm"><summary className="cursor-pointer font-medium text-slate-700">銷貨已核對 · {flow.erp_receipt.vouchers.join('、')}</summary><p className="mt-3">稅前 {(flow.erp_receipt.financials.netMinor/100).toFixed(2)} ＋ 營業稅 {(flow.erp_receipt.financials.taxMinor/100).toFixed(2)} ＝ 含稅 {(flow.erp_receipt.financials.grossMinor/100).toFixed(2)}</p><p className="mt-1">核對人：{flow.erp_confirmed_name} · {time(flow.erp_confirmed_at)}</p></details>:<>
    <h2 className="text-lg font-semibold">ECOUNT → WMS</h2>
    <p className="mt-2 text-slate-600">在 ECOUNT 儲存銷貨單後，匯出這批銷貨明細並上傳。</p>
    <div role="region" aria-label="ECOUNT 銷貨明細上傳區" className={`mt-5 rounded-xl border-2 border-dashed p-5 text-center ${dragging?'border-blue-500 bg-blue-50':fileError?'border-amber-400 bg-amber-50/40':'border-slate-300 bg-slate-50/60'}`} onDragOver={e=>{e.preventDefault();if(!busy)setDragging(true);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDragging(false);}} onDrop={e=>{e.preventDefault();setDragging(false);readFiles(Array.from(e.dataTransfer.files||[]));}}>
     {rows?<FileSpreadsheet size={28} className="mx-auto text-blue-600"/>:<UploadCloud size={28} className="mx-auto text-blue-600"/>}
     <p className="mt-3 font-medium break-all">{filename||'拖曳 ECOUNT 匯出的銷貨明細到這裡'}</p>
     <p className="mt-1 text-sm text-slate-500">Excel／CSV · 每次一個檔案 · 上限 10 MiB</p>
     <Button variant="secondary" className="mt-4" disabled={busy} onClick={()=>receiptFileRef.current?.click()}>{filename?'重新選擇檔案':'選擇 ECOUNT 匯出檔'}</Button>
     <input ref={receiptFileRef} className="hidden" aria-label="ECOUNT 銷貨明細匯出檔" type="file" accept=".xlsx,.xls,.csv" disabled={busy} onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';readFiles(files);}}/>
     {fileError&&<p role="alert" className="mt-3 text-left text-sm text-amber-950">{fileError}</p>}
    </div>
    {rows&&<label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy}/>此檔案由 ECOUNT 已儲存的銷貨單匯出</label>}
    <div className="mt-4 flex flex-wrap items-center gap-3"><Button disabled={busy||!rows||!confirmed||missingBarcodes.length>0} onClick={()=>run('confirm-sales',{rows,savedSalesConfirmed:confirmed})}>核對並建立預揀單</Button>{rows&&missingBarcodes.length>0&&<button className="min-h-11 text-sm font-medium text-amber-900 underline" onClick={showBarcodeIssues}>先確認 {missingBarcodes.length} 項商品條碼</button>}</div>
    <details className="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-600"><summary className="cursor-pointer">檔案格式</summary><p className="mt-2">使用含實際銷貨單號、來源明細與金額的 ECOUNT 匯出檔。商城原始訂單與 WMS 銷貨檔不能用於此步驟。</p><button type="button" className="mt-2 min-h-10 text-blue-700 underline" onClick={downloadFormat}>下載欄位設定參考（空白）</button><p className="mt-1">空白參考檔僅供設定 ECOUNT 匯出欄位。</p></details>
    <details className="mt-3 text-sm text-slate-600"><summary className="cursor-pointer">尚未上傳 ECOUNT</summary><div className="mt-3 flex flex-wrap items-center gap-3"><Button variant="secondary" disabled={busy} onClick={downloadSales}><Download size={16} className="mr-2"/>下載本批彙總銷貨檔</Button><span>下載後，到 ECOUNT 匯入並儲存。</span></div></details>
   </>}
   </section>}
   {manager&&!flow.erp_confirmed_at&&<details ref={barcodeDetailsRef} className={box+' scroll-mt-4'}><summary className={`cursor-pointer font-semibold ${missingBarcodes.length?'text-amber-900':'text-slate-700'}`}>{missingBarcodes.length?`商品條碼待確認（${missingBarcodes.length} 項）`:'商品條碼已確認'}</summary>{missingBarcodes.map(p=><BarcodeConfirmation key={p.key} product={p} disabled={busy} onConfirm={barcode=>run('confirm-barcode',{productCode:p.productCode,barcode,confirmed:true})}/>)}{products.some(p=>p.barcode)&&<details className="mt-3 text-sm"><summary className="cursor-pointer">已確認商品（{products.filter(p=>p.barcode).length} 項）</summary>{products.filter(p=>p.barcode).map(p=><BarcodeConfirmation key={p.key} product={p} disabled={busy} onConfirm={barcode=>run('confirm-barcode',{productCode:p.productCode,barcode,confirmed:true})}/>)}</details>}</details>}
   {flow.erp_confirmed_at&&<section className={box}><h2 className="text-lg font-semibold">領單與指派預揀</h2><p className="mt-2 text-sm">領單人：{flow.print_owner_name||'尚未領單'} · {time(flow.printed_at)}</p><p className="mt-1 text-sm">預揀人員：{flow.prepick_owner_name||'尚未指派'} · {flow.prepick_completed_at?'已完成':'待核對'}</p>
    {manager&&<><div className="mt-4 flex flex-wrap gap-3"><select aria-label="列印內容" className={input} value={paper} onChange={e=>setPaper(e.target.value)} disabled={busy}><option value="prepick">預揀總表（全批）</option><option value="orders">所有訂單明細（每單分頁）</option></select><Button disabled={busy||products.some(p=>!p.barcode)} onClick={()=>{setBusy(true);setError('');print();}}>{flow.printed_at?'重印':'領單並列印'}</Button></div>{products.some(p=>!p.barcode)&&<p className="mt-2 text-sm text-amber-800">請先確認 {products.filter(p=>!p.barcode).length} 項商品條碼。</p>}<div className="mt-4 flex flex-wrap gap-3"><select aria-label="預揀人員" className={input} value={assignee} onChange={e=>setAssignee(e.target.value)}><option value="">選擇預揀人員</option>{staff.map(s=><option key={s.id} value={s.id}>{s.name}（{s.role}）</option>)}</select><Button variant="secondary" disabled={busy||!assignee||!flow.printed_at||!!flow.prepick_completed_at} onClick={()=>run('assign',{assigneeId:Number(assignee)})}>指派／轉交預揀</Button></div></>}
   </section>}
   {flow.printed_at&&<section className={box}><h2 className="text-lg font-semibold">預揀商品查核</h2><div className="mt-4 space-y-3 sm:hidden">{products.map(p=><article key={p.key} className="rounded-xl border border-slate-200 p-3 text-sm"><p className="font-medium">{p.productName}</p><p className="mt-1 text-slate-600">{p.productCode}</p><div className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className="font-mono">{p.barcode||'條碼待確認'}</span><strong>已核對 {flow.prepick_counts[p.key]||0} / {p.quantity}</strong></div>{manager&&!flow.prepick_completed_at&&!!flow.prepick_counts[p.key]&&<button type="button" disabled={busy} className="mt-2 text-blue-700 underline" onClick={()=>{const reason=window.prompt('重設後須重新掃碼清點，請填寫原因');if(reason)run('reset-product',{productKey:p.key,reason});}}>重新清點</button>}</article>)}</div><div className="mt-4 hidden overflow-x-auto sm:block"><table className="w-full text-left text-sm"><thead><tr>{['品項','商品','商品條碼','需求','已核對'].map(h=><th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{products.map(p=><tr key={p.key} className="border-t"><td className="p-3">{p.productCode}</td><td className="p-3">{p.productName}</td><td className="p-3 font-mono">{p.barcode||'尚未確認'}</td><td className="p-3">{p.quantity}</td><td className="p-3">{flow.prepick_counts[p.key]||0}{manager&&!flow.prepick_completed_at&&!!flow.prepick_counts[p.key]&&<button type="button" disabled={busy} className="ml-2 text-blue-700 underline" onClick={()=>{const reason=window.prompt('重設後須重新掃碼清點，請填寫原因');if(reason)run('reset-product',{productKey:p.key,reason});}}>重新清點</button>}</td></tr>)}</tbody></table></div>
    {flow.prepick_owner_id===user.id&&!flow.prepick_completed_at&&<form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();run('scan',{productKey:product,barcode,quantity:Number(quantity)});}}><label className="flex min-w-0 flex-col gap-1 text-sm">待查核商品<select className={input+' max-w-sm'} value={product} onChange={e=>setProduct(e.target.value)} required><option value="">選擇商品</option>{products.map(p=><option value={p.key} key={p.key}>{p.productName} · {p.productCode}</option>)}</select></label><label className="flex flex-col gap-1 text-sm">本次實點數量<input aria-label="本次實點數量" className={input+' w-28'} type="number" min="1" step="1" value={quantity} onChange={e=>setQuantity(e.target.value)} required/></label><label className="flex flex-col gap-1 text-sm">掃描商品條碼<input aria-label="預揀商品條碼" className={input} autoComplete="off" value={barcode} onChange={e=>setBarcode(e.target.value)} required/></label><Button type="submit" disabled={busy}>確認本次預揀</Button></form>}
    <div className="mt-4 flex flex-wrap items-center gap-3"><Button disabled={busy||flow.prepick_owner_id!==user.id||!!flow.prepick_completed_at||products.some(p=>(flow.prepick_counts[p.key]||0)!==p.quantity)} onClick={()=>run('complete')}>完成預揀，放行各訂單揀貨</Button>{flow.prepick_completed_at&&<Link className="text-blue-700 underline" to="/tasks">前往掃描訂單條碼認領 →</Link>}</div>
   </section>}
  </>}
  <details className={box} open={!!flow?.prepick_completed_at||undefined}><summary className="cursor-pointer font-semibold">訂單工作單（{orders.length}）</summary><div className="mt-4 grid gap-3 md:grid-cols-2">{orders.map(o=><article className="rounded-xl border p-4" key={o.id}><strong>{o.source_order_number}</strong><p className="mt-1 text-sm text-blue-700">{!flow?.erp_confirmed_at?'待 ERP 核對':o.status==='pending'&&!flow.prepick_completed_at?'待整批預揀':labels[o.status]||'待建立'}</p><p className="mt-2 font-mono text-xs">{o.work_barcode||'啟用後產生工作條碼'}</p><p className="mt-2 text-xs">揀貨：{o.picker_name||'未領取'} · 裝箱：{o.packer_name||'未領取'}</p><details className="mt-3 text-sm"><summary>商品明細（{o.expected_items.reduce((n,i)=>n+i.quantity,0)} 件）</summary>{o.expected_items.map(i=><p key={i.sourceLineId} className="mt-2">{i.productName} × {i.quantity}<br/><span className="font-mono text-xs">{i.barcode||'條碼待確認'}</span></p>)}</details>{o.order_id&&<Link className="mt-3 inline-block text-sm text-blue-700 underline" to={`/order/${o.order_id}`}>查看工作單</Link>}</article>)}</div></details>
  <details className={box}><summary>批次操作紀錄</summary>{events.map((e,i)=><p key={i} className="mt-2 text-sm">{time(e.created_at)} · {e.actor_name} · {actions[e.action]||e.action}</p>)}</details>
  <div style={{display:'none'}}><div ref={paperRef}><WarehousePaper data={printData||data} kind={paper}/></div></div>
 </main>;
}
export function WarehousePaper({data,kind}){
 const {batch,orders,products,flow}=data;
 const head=<><h1 style={{fontSize:22}}>Corely WMS · {kind==='orders'?'訂單作業明細':'預揀總表'}</h1><p>{batch.batch_number} · {batch.source_platform} · {batch.source_store}</p><p>領單人：{flow?.print_owner_name||'未領單'} · 預揀：{flow?.prepick_owner_name||'待指派'}</p><p>ERP 銷貨單：{flow?.erp_receipt?.vouchers?.join('、')||'尚未核對'}</p></>;
 const td={padding:8,border:'1px solid #777',verticalAlign:'top'};
 const table=items=><table style={{width:'100%',borderCollapse:'collapse',marginTop:16}}><thead><tr>{['品項／商品','商品條碼','數量'].map(h=><th key={h} style={td}>{h}</th>)}</tr></thead><tbody>{items.map((i,n)=><tr key={n}><td style={td}>{i.productCode}<br/>{i.productName}{i.snCount>0&&<p style={{fontWeight:700}}>須核對 {i.snCount} 組 SN</p>}</td><td style={{...td,width:'45%'}}><OrderBarcode value={i.barcode} label="商品條碼"/></td><td style={td}>{i.quantity}</td></tr>)}</tbody></table>;
 return <div style={{fontFamily:'sans-serif',fontSize:'11pt'}}>{kind==='prepick'?<section>{head}{table(products)}<p>預揀人員：____________　核對日期：____________</p></section>:orders.map(o=><section className="work-sheet" key={o.id}>{head}<h2 style={{fontSize:20,margin:'16px 0'}}>商城訂單：{o.source_order_number}</h2><OrderBarcode value={o.work_barcode} label="掃此工作條碼認領揀貨／裝箱"/>{table(o.expected_items)}<p>揀貨核對完成：____________　裝箱二次核對：____________</p></section>)}</div>;
}

function BarcodeConfirmation({product,disabled,onConfirm}){
 const [barcode,setBarcode]=useState(product.barcode||''),[checked,setChecked]=useState(false);
 return <div className="mt-4 rounded-xl border p-3"><p className="text-sm">{product.productName} · {product.productCode}</p><div className="mt-2 flex flex-wrap items-center gap-3"><input aria-label={`商品實物條碼 ${product.productCode}`} className={input} value={barcode} onChange={e=>{setBarcode(e.target.value);setChecked(false);}}/><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>已核對商品實物條碼</label><Button variant="secondary" disabled={disabled||!checked||!barcode.trim()} onClick={()=>onConfirm(barcode.trim())}>保存本批條碼</Button></div></div>;
}
