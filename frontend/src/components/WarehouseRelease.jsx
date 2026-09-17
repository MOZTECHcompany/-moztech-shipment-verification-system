import React,{useEffect,useRef,useState} from 'react';
import {Link,useParams} from 'react-router-dom';
import {useReactToPrint} from 'react-to-print';
import * as XLSX from 'xlsx';
import api from '@/api/api.js';
import {Button} from '@/ui';
import {OrderBarcode} from './OrderBarcode';
const box='rounded-2xl border border-slate-200 bg-white p-5';
const input='min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2';
const labels={pending:'待揀貨',picking:'揀貨中',picked:'二次查核要裝箱',packing:'裝箱複檢中',completed:'裝箱完成',voided:'已作廢'};
const actions={enable:'啟用流程','confirm-barcode':'確認商品實物條碼','confirm-sales':'銷貨核對通過',print:'領單／重印',assign:'指派預揀','reset-product':'重設商品待重新清點',scan:'商品預揀查核',complete:'預揀完成，放行揀貨'};
const time=v=>v?new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'尚未完成';
export default function WarehouseRelease({user}){
 const {intakeId}=useParams();
 return intakeId?<ReleaseDetail key={`${user.id}:${intakeId}`} id={intakeId} user={user}/>:<ReleaseList/>;
}
function ReleaseList(){
 const [data,setData]=useState([]),[error,setError]=useState('');
 useEffect(()=>{let alive=true;api.get('/api/warehouse-intakes').then(r=>{if(alive)setData(r.data.batches);}).catch(e=>{if(alive)setError(e.response?.data?.message||'讀取失敗');});return()=>{alive=false;};},[]);
 return <main className="mx-auto max-w-6xl space-y-5 pb-8"><Link to="/tasks" className="text-blue-700">← 返回作業看板</Link><h1 className="text-2xl font-semibold">整批預揀作業</h1><p>先核對 ERP 銷貨，再領單列印、指派預揀。完成後各訂單分別揀貨與裝箱複檢。</p>{error&&<p role="alert">{error}</p>}<div className="grid gap-4 md:grid-cols-2">{data.map(b=><Link key={b.id} className={box+' hover:border-blue-500'} to={`/warehouse-intakes/${b.id}`}><strong>{b.batch_number}</strong><p className="mt-2">{b.source_platform} · {b.source_store}</p><p className="mt-3 text-blue-700">{b.prepick_completed_at?'預揀完成 · 訂單揀貨／裝箱':b.printed_at?'已領單 · 預揀中':b.erp_confirmed_at?'銷貨核對通過 · 待領單':'待 ECOUNT 銷貨回傳核對'}</p><p className="mt-2 text-sm">預揀人員：{b.prepick_owner_name||'未指派'}</p></Link>)}</div>{!data.length&&!error&&<p>目前沒有啟用新流程的批次。行政可從商城轉檔的批次卡片開啟。</p>}</main>;
}
function ReleaseDetail({id,user}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[staff,setStaff]=useState([]),[assignee,setAssignee]=useState('');
 const [rows,setRows]=useState(null),[filename,setFilename]=useState(''),[confirmed,setConfirmed]=useState(false),[barcode,setBarcode]=useState(''),[product,setProduct]=useState(''),[quantity,setQuantity]=useState(1);
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
 const run=async(action,payload)=>{if(busy)return;setBusy(true);setError('');try{await mutate(action,payload);if(action==='scan')setBarcode('');}catch(e){setError(e.response?.data?.message||e.message||'操作失敗，請以相同內容重試');}finally{if(valid())setBusy(false);}};
 const print=useReactToPrint({contentRef:paperRef,documentTitle:`${paper==='prepick'?'預揀總表':'訂單作業明細'}-${data?.batch.batch_number||id}`,
  onBeforePrint:async()=>{if(!valid())throw Error('登入人員已變更');const fresh=await mutate('print',{kind:paper});await new Promise(resolve=>{printResolve.current=resolve;setPrintData(fresh);});},
  onPrintError:(_,e)=>{setError(e.response?.data?.message||e.message||'列印未開啟，請重試');setBusy(false);},onAfterPrint:()=>{setBusy(false);setError('列印視窗已關閉，請確認紙張已印出。重印不會重複領取任務。');},
  pageStyle:'@page {size:A4;margin:10mm} @media print {body {color:#000;background:white} thead{display:table-header-group} tr{break-inside:avoid} .work-sheet{break-after:page}.work-sheet:last-child{break-after:auto}}'});
 const downloadFormat=async()=>{try{const r=await api.get('/api/warehouse-intakes/receipt-format',{responseType:'blob'});if(!valid())return;const url=URL.createObjectURL(r.data),a=document.createElement('a');a.href=url;a.download='ECOUNT銷貨回傳欄位.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch{setError('欄位範本下載失敗');}};
 const readFile=async e=>{setRows(null);setConfirmed(false);const file=e.target.files?.[0];if(!file)return;try{if(file.size>10*1024*1024)throw Error('檔案上限 10 MiB');const book=XLSX.read(await file.arrayBuffer(),{type:'array',raw:true,sheetRows:10001});if(book.SheetNames.length!==1)throw Error('請使用單一工作表，避免漏讀');const sheet=book.Sheets[book.SheetNames[0]];const range=XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']);if(range.e.r>=10000||range.e.c>=100)throw Error('資料範圍超限');if(valid()){setRows(XLSX.utils.sheet_to_json(sheet,{header:1,raw:false,defval:''}));setFilename(file.name);setError('');}}catch(e){setError(e.message);}e.target.value='';};
 if(!data)return <main><p role="status">{error||'載入批次…'}</p></main>;
 const {batch,flow,orders,products,events}=data;
 const phase=!flow?.erp_confirmed_at?0:!flow.printed_at?1:!flow.prepick_completed_at?2:3;
 return <main className="mx-auto max-w-7xl space-y-5 pb-8"><div className="flex flex-wrap justify-between gap-3"><Link to="/warehouse-intakes" className="text-blue-700">← 整批預揀作業</Link><Button variant="secondary" disabled={busy} onClick={()=>refresh().catch(()=>setError('更新失敗'))}>更新進度</Button></div>
  <header><p className="text-sm text-slate-500">{batch.source_platform} · {batch.source_store}</p><h1 className="mt-2 text-2xl font-semibold">{batch.batch_number}</h1><p className="mt-2">{orders.length} 筆獨立訂單 · {products.reduce((n,p)=>n+p.quantity,0)} 件商品</p></header>
  <div className="grid gap-2 sm:grid-cols-4">{['① 下載銷貨檔 → 上傳 ECOUNT','② 回傳已儲存銷貨結果','③ 領單列印 → 整批預揀','④ 逐單揀貨 → 二次查核裝箱'].map((s,i)=><div key={s} className={`rounded-xl border p-3 text-sm ${i===phase?'border-blue-500 bg-blue-50 font-semibold':'border-slate-200 bg-white'}`}>{s}</div>)}</div>
  {error&&<div role="status" className="rounded-xl bg-amber-50 p-4 text-amber-950"><p>{error}</p>{pending.current&&<Button className="mt-3" disabled={busy} onClick={()=>{const [a,p]=JSON.parse(pending.current.content);run(a,p);}}>重試原操作</Button>}</div>}
  {!flow?<section className={box}><p>這是既有轉檔批次。啟用後會沿用原訂單，建立獨立工作條碼；不會再次送出 ERP 銷貨。</p>{manager&&<Button className="mt-3" disabled={busy} onClick={()=>run('enable')}>啟用銷貨核對與預揀</Button>}</section>:<>
   {manager&&<section className={box}><h2 className="text-lg font-semibold">ECOUNT 銷貨結果核對</h2><p className="mt-2 text-sm">先到轉檔批次下載銷貨檔，再上傳 ECOUNT 並儲存。接著匯出已儲存的銷貨明細至此核對；上傳檔不能當作成功回執。</p><Link className="mt-3 inline-block text-blue-700 underline" to={`/admin/marketplace-converter?batch=${id}#batch-detail`}>前往下載「上傳 ECOUNT 的銷貨檔」 →</Link>
    {flow.erp_confirmed_at?<div className="mt-4 rounded-xl bg-emerald-50 p-4"><strong>銷貨明細核對通過</strong><p>{flow.erp_receipt.vouchers.join('、')}</p><p>稅前 {(flow.erp_receipt.financials.netMinor/100).toFixed(2)} ＋ 稅 {(flow.erp_receipt.financials.taxMinor/100).toFixed(2)} ＝ 含稅 {(flow.erp_receipt.financials.grossMinor/100).toFixed(2)}</p><p className="mt-2 text-xs">核對人：{flow.erp_confirmed_name} · {time(flow.erp_confirmed_at)}。依回傳資料核對，不代表會計憑證、收款或物流已完成。</p></div>:<div className="mt-4 space-y-3"><Button variant="secondary" onClick={downloadFormat}>下載回傳欄位範本（空白）</Button><p className="text-xs text-slate-500">請於 ECOUNT 設定對應匯出欄位；實際銷貨單號請包含日期及序號。缺少欄位或金額不符會停止放行。</p><label className="block rounded-xl border-2 border-dashed p-4">選擇 ECOUNT 已儲存銷貨明細<input className="mt-3 block max-w-full" type="file" accept=".xlsx,.xls,.csv" disabled={busy} onChange={readFile}/>{filename&&<span className="text-sm">{filename}</span>}</label><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>這是 ECOUNT 已儲存的銷貨明細，已確認單據存在；不是待上傳的檔案。</label><Button disabled={busy||!rows||!confirmed} onClick={()=>run('confirm-sales',{rows,savedSalesConfirmed:confirmed})}>核對銷貨結果並建立待預揀任務</Button></div>}
   </section>}
   {manager&&!flow.erp_confirmed_at&&<details className={box} open={products.some(p=>!p.barcode)||undefined}><summary className="cursor-pointer font-semibold">商品作業條碼（僅需處理缺漏或更正）</summary><p className="mt-2 text-sm">保留商城原始資料；這裡只記錄本批實物條碼。ECOUNT 品項編碼不會因長度或相似名稱自動替換。</p>{products.map(p=><BarcodeConfirmation key={p.key} product={p} disabled={busy} onConfirm={barcode=>run('confirm-barcode',{productCode:p.productCode,barcode,confirmed:true})}/>)}</details>}
   <section className={box}><h2 className="text-lg font-semibold">領單、列印與預揀負責人</h2><p className="mt-2 text-sm">領單人：{flow.print_owner_name||'尚未領單'} · {time(flow.printed_at)}</p><p className="mt-1 text-sm">預揀人員：{flow.prepick_owner_name||'尚未指派'} · {flow.prepick_completed_at?'已完成':'待核對'}</p>
    {manager&&<><div className="mt-4 flex flex-wrap gap-3"><select aria-label="列印內容" className={input} value={paper} onChange={e=>setPaper(e.target.value)} disabled={busy}><option value="prepick">預揀總表（全批）</option><option value="orders">所有訂單明細（每單分頁）</option></select><Button disabled={busy||!flow.erp_confirmed_at} onClick={()=>{setBusy(true);setError('');print();}}>{flow.printed_at?'重印':'領單並列印'}</Button></div><p className="mt-2 text-xs text-slate-500">首次列印記錄登入者領單；取消列印或缺紙可重印。總表依品項數自動續頁，完整明細不受畫面分頁限制。</p><div className="mt-4 flex flex-wrap gap-3"><select aria-label="預揀人員" className={input} value={assignee} onChange={e=>setAssignee(e.target.value)}><option value="">選擇預揀人員</option>{staff.map(s=><option key={s.id} value={s.id}>{s.name}（{s.role}）</option>)}</select><Button variant="secondary" disabled={busy||!assignee||!flow.printed_at||!!flow.prepick_completed_at} onClick={()=>run('assign',{assigneeId:Number(assignee)})}>指派／轉交預揀</Button></div></>}
   </section>
   <section className={box}><h2 className="text-lg font-semibold">預揀總表與條碼查核</h2><p className="mt-2 text-sm">掃商品實物條碼，填入本次實點數量。整批核對不會取代各訂單的揀貨與裝箱複檢。</p><div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['品項','商品','商品條碼','需求','已核對'].map(h=><th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{products.map(p=><tr key={p.key} className="border-t"><td className="p-3">{p.productCode}</td><td className="p-3">{p.productName}</td><td className="p-3 font-mono">{p.barcode||'尚未確認'}</td><td className="p-3">{p.quantity}</td><td className="p-3">{flow.prepick_counts[p.key]||0}{manager&&!flow.prepick_completed_at&&!!flow.prepick_counts[p.key]&&<button type="button" disabled={busy} className="ml-2 text-blue-700 underline" onClick={()=>{const reason=window.prompt('重設後須重新掃碼清點，請填寫原因');if(reason)run('reset-product',{productKey:p.key,reason});}}>重新清點</button>}</td></tr>)}</tbody></table></div>
    {flow.prepick_owner_id===user.id&&!flow.prepick_completed_at&&<form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();run('scan',{productKey:product,barcode,quantity:Number(quantity)});}}><label className="flex min-w-0 flex-col gap-1 text-sm">待查核商品<select className={input+' max-w-sm'} value={product} onChange={e=>setProduct(e.target.value)} required><option value="">選擇商品</option>{products.map(p=><option value={p.key} key={p.key}>{p.productName} · {p.productCode}</option>)}</select></label><label className="flex flex-col gap-1 text-sm">本次實點數量<input aria-label="本次實點數量" className={input+' w-28'} type="number" min="1" step="1" value={quantity} onChange={e=>setQuantity(e.target.value)} required/></label><label className="flex flex-col gap-1 text-sm">掃描商品條碼<input aria-label="預揀商品條碼" className={input} autoComplete="off" value={barcode} onChange={e=>setBarcode(e.target.value)} required/></label><Button type="submit" disabled={busy}>確認本次預揀</Button></form>}
    <div className="mt-4 flex flex-wrap items-center gap-3"><Button disabled={busy||flow.prepick_owner_id!==user.id||!!flow.prepick_completed_at||products.some(p=>(flow.prepick_counts[p.key]||0)!==p.quantity)} onClick={()=>run('complete')}>完成預揀，放行各訂單揀貨</Button>{flow.prepick_completed_at&&<Link className="text-blue-700 underline" to="/tasks">前往掃描訂單條碼認領 →</Link>}</div>
   </section>
  </>}
  <section className={box}><h2 className="text-lg font-semibold">獨立訂單任務（{orders.length}）</h2><p className="mt-2 text-sm">每筆訂單固定一個 WT 工作條碼。揀貨完成後，裝箱人員的看板會出現「二次查核要裝箱」。</p><div className="mt-4 grid gap-3 md:grid-cols-2">{orders.map(o=><article className="rounded-xl border p-4" key={o.id}><strong>{o.source_order_number}</strong><p className="mt-1 text-sm text-blue-700">{!flow?.erp_confirmed_at?'待 ERP 核對':o.status==='pending'&&!flow.prepick_completed_at?'待整批預揀':labels[o.status]||'待建立'}</p><p className="mt-2 font-mono text-xs">{o.work_barcode||'啟用後產生工作條碼'}</p><p className="mt-2 text-xs">揀貨：{o.picker_name||'未領取'} · 裝箱：{o.packer_name||'未領取'}</p><details className="mt-3 text-sm"><summary>商品明細（{o.expected_items.reduce((n,i)=>n+i.quantity,0)} 件）</summary>{o.expected_items.map(i=><p key={i.sourceLineId} className="mt-2">{i.productName} × {i.quantity}<br/><span className="font-mono text-xs">{i.barcode||'條碼待確認'}</span></p>)}</details>{o.order_id&&<Link className="mt-3 inline-block text-sm text-blue-700 underline" to={`/order/${o.order_id}`}>查看工作單</Link>}</article>)}</div></section>
  <details className={box}><summary>批次操作紀錄</summary>{events.map((e,i)=><p key={i} className="mt-2 text-sm">{time(e.created_at)} · {e.actor_name} · {actions[e.action]||e.action}</p>)}</details>
  <div style={{display:'none'}}><div ref={paperRef}><WarehousePaper data={printData||data} kind={paper}/></div></div>
 </main>;
}
export function WarehousePaper({data,kind}){
 const {batch,orders,products,flow}=data;
 const head=<><h1 style={{fontSize:22}}>Corely WMS · {kind==='orders'?'訂單作業明細':'預揀總表'}</h1><p>{batch.batch_number} · {batch.source_platform} · {batch.source_store}</p><p>領單人：{flow?.print_owner_name||'未領單'} · 預揀：{flow?.prepick_owner_name||'待指派'}</p><p>ERP 銷貨單：{flow?.erp_receipt?.vouchers?.join('、')||'尚未核對'}</p></>;
 const td={padding:8,border:'1px solid #777',verticalAlign:'top'};
 const table=items=><table style={{width:'100%',borderCollapse:'collapse',marginTop:16}}><thead><tr>{['品項／商品','商品條碼','數量'].map(h=><th key={h} style={td}>{h}</th>)}</tr></thead><tbody>{items.map((i,n)=><tr key={n}><td style={td}>{i.productCode}<br/>{i.productName}{i.snCount>0&&<p style={{fontWeight:700}}>須核對 {i.snCount} 組 SN</p>}</td><td style={{...td,width:'45%'}}><OrderBarcode value={i.barcode} label="商品條碼"/></td><td style={td}>{i.quantity}</td></tr>)}</tbody></table>;
 return <div style={{fontFamily:'sans-serif',fontSize:'11pt'}}>{kind==='prepick'?<section>{head}<p>供整批提出商品及預揀查核；仍須逐單揀貨、逐單裝箱複檢。</p>{table(products)}<p>預揀人員：____________　核對日期：____________</p></section>:orders.map(o=><section className="work-sheet" key={o.id}>{head}<h2 style={{fontSize:20,margin:'16px 0'}}>商城訂單：{o.source_order_number}</h2><OrderBarcode value={o.work_barcode} label="掃此工作條碼認領揀貨／裝箱"/>{table(o.expected_items)}<p>揀貨核對完成：____________　裝箱二次核對：____________</p><p>商品如要求 SN，請依系統提示掃描實際 SN；封箱與物流交寄為不同事件。</p></section>)}</div>;
}

function BarcodeConfirmation({product,disabled,onConfirm}){
 const [barcode,setBarcode]=useState(product.barcode||''),[checked,setChecked]=useState(false);
 return <div className="mt-4 rounded-xl border p-3"><p className="text-sm">{product.productName} · {product.productCode}</p><div className="mt-2 flex flex-wrap items-center gap-3"><input aria-label={`商品實物條碼 ${product.productCode}`} className={input} value={barcode} onChange={e=>{setBarcode(e.target.value);setChecked(false);}}/><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>已核對商品實物條碼</label><Button variant="secondary" disabled={disabled||!checked||!barcode.trim()} onClick={()=>onConfirm(barcode.trim())}>保存本批條碼</Button></div></div>;
}
