import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft, Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button, PageHeader } from '../../ui';
import apiClient from '@/api/api.js';
import { batchSessionMatches } from '../../utils/importBatches';
import { formatMinor, buildEcountUploadTable } from '../../utils/marketplaceIntake.mjs';
import { MARKETPLACE_ROLES, TEST_ORDER_NUMBERS, parseUnifiedMarketplace, prepareUnifiedMarketplace } from '../../utils/unifiedMarketplace.mjs';

const knownMappings = {
 '4711299270024': { erpSku:'4711299270024',barcode:'4711299270024',erpName:'bonson-奈米纖維拖把布(兩入)',spec:'BO-A02' },
 '4711299270000': { erpSku:'4711299270000',barcode:'4711299270000',erpName:'bonson-極省水平板拖把組二代',spec:'BO-A03' },
 '4711299271137': { erpSku:'4711299271137',barcode:'',erpName:'bonson-拖把配件-拖把桿',spec:'BO-A17' },
};
const inputClass='mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 disabled:bg-slate-100';
const sectionClass='rounded-xl border border-slate-200 bg-white p-4 sm:p-6';
const cell='px-3 py-3 text-left align-top';
const money=n=>n==null?'未提供':formatMinor(n);
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const batchNumber=()=>`TEST-${today().replaceAll('-','')}-${Array.from(crypto.getRandomValues(new Uint8Array(2)),v=>v.toString(16).padStart(2,'0')).join('').toUpperCase()}`;
const initialSettings=()=>({store:'',customerCode:'',customerName:'',warehouseCode:'003',date:today(),batchSequence:'1',batchNumber:batchNumber(),currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:false,includeTestOrders:false,bundleZeroConfirmed:false,discountAllocationConfirmed:false,skuMappings:{},shippingSku:{erpSku:'00001',name:'運費',confirmed:false,nonStock:false}});
function Field({label,help,children,...props}){return <label className="block min-w-0 text-sm font-medium text-slate-800">{label}{children||<input className={inputClass} {...props}/>} {help&&<span className="mt-1 block text-xs font-normal leading-5 text-slate-500">{help}</span>}</label>;}
function Check({children,checked,onChange}){return <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6 text-slate-800"><input type="checkbox" checked={!!checked} onChange={e=>onChange(e.target.checked)} className="mt-1 h-4 w-4 shrink-0"/><span>{children}</span></label>;}
export function MarketplaceConverter({user}){
 if(import.meta.env?.VITE_DEPLOY_ENV!=='dev'||!MARKETPLACE_ROLES.includes(user?.role))return <Navigate to="/tasks" replace/>;
 return <ConverterPage user={user}/>;
}
function ConverterPage({user}){
 const [input,setInput]=useState(null),[settings,setSettings]=useState(initialSettings),[name,setName]=useState('');
 const [busy,setBusy]=useState(false),[access,setAccess]=useState('loading'),[message,setMessage]=useState(''),[records,setRecords]=useState([]),[saved,setSaved]=useState(null);
 const fileRef=useRef(null),request=useRef(0),mounted=useRef(true),token=useRef(null),actor=useRef({id:user.id,role:user.role}),inFlight=useRef(false);
 const currentSession=()=>batchSessionMatches(localStorage,actor.current,token.current);
 const loadRecords=async()=>{
  const response=await apiClient.get('/api/marketplace-intakes');
  if(!mounted.current||!currentSession())return false;
  setRecords(response.data.intakes);setAccess('ready');return true;
 };
 useEffect(()=>{
  mounted.current=true;try{token.current=JSON.parse(localStorage.getItem('wms_token'));}catch{token.current=null;}
  loadRecords().catch(()=>{if(mounted.current){setAccess('denied');setMessage('無法確認轉檔權限，請使用拋單員、管理員或最高管理員帳號重新登入。');}});
  const check=()=>{if(currentSession())return;request.current++;setInput(null);setName('');setSaved(null);setRecords([]);setSettings(initialSettings());setAccess('denied');setMessage('登入人員已變更，請重新登入。');};
  window.addEventListener('storage',check);return()=>{mounted.current=false;request.current++;window.removeEventListener('storage',check);};
 },[]);
 const locked=busy||access!=='ready';
 const prepared=useMemo(()=>input?prepareUnifiedMarketplace(input.parsed,settings):null,[input,settings]);
 const products=useMemo(()=>[...new Map((prepared?.parsed.items||[]).map(i=>[i.sku,i])).values()],[prepared]);
 const update=(key,value)=>{setSaved(null);setSettings(s=>({...s,[key]:value,...(key==='currency'?{taxConfirmed:false}:{})}));};
 const mapping=(sku,key,value)=>{setSaved(null);setSettings(s=>({...s,skuMappings:{...s.skuMappings,[sku]:{...s.skuMappings[sku],[key]:value,...(['erpSku','erpName'].includes(key)?{confirmed:false}:{}),...(key==='barcode'?{barcodeConfirmed:false}:{})}}}));};
 const selectFiles=async files=>{
  if(locked||!files?.length)return;
  setMessage('');setInput(null);setSaved(null);setName('');
  if(!currentSession()){setAccess('denied');return;}
  const file=files[0];
  if(files.length!==1||! /\.(xlsx|xls|csv)$/i.test(file.name)||!file.size||file.size>10*1024*1024){setMessage('請選擇一個非空白的 Excel 或 CSV，檔案上限 10 MiB。');return;}
  const sequence=++request.current;setBusy(true);
  try{
   const XLSX=await import('xlsx'),buffer=await file.arrayBuffer();let source=buffer;
   if(/\.csv$/i.test(file.name))try{source=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{throw Error('CSV 請使用 UTF-8 編碼重新匯出，或改選 Excel 原始檔。');}
   const book=XLSX.read(source,{type:typeof source==='string'?'string':'array',raw:true,cellFormula:false,cellHTML:false,sheetRows:5001});
   if(book.SheetNames.length!==1)throw Error('請使用單一訂單工作表，避免漏讀其他工作表。');
   const sheet=book.Sheets[book.SheetNames[0]],range=XLSX.utils.decode_range(sheet['!fullref']||sheet['!ref']||'A1');
   if(range.e.r>=5000||range.e.c>=200)throw Error('原始檔最多 5,000 列或 200 欄，請分批匯出。');
   const result=parseUnifiedMarketplace(XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:'',blankrows:true}));
   if(!mounted.current||sequence!==request.current||!currentSession())return;
   setInput(result);setName(file.name);
   const mappings=Object.fromEntries(result.parsed.items.map(i=>[i.sku,{...(knownMappings[i.sku]||{erpSku:i.sku,erpName:i.productName,barcode:''}),confirmed:false,barcodeConfirmed:false,category:''}]));
   setSettings(s=>({...initialSettings(),store:s.store,warehouseCode:s.warehouseCode,skuMappings:mappings}));
  }catch(e){if(mounted.current&&sequence===request.current)setMessage(e.message||'無法讀取來源檔');}
  finally{if(mounted.current&&sequence===request.current)setBusy(false);}
 };
 const writeBook=async(record,kind)=>{
  const XLSX=await import('xlsx');if(!mounted.current||!currentSession())throw Error('登入已變更，未下載資料。');
  const book=XLSX.utils.book_new();
  const add=(title,rows)=>{const sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!cols']=(rows[0]||[]).map(()=>({wch:24}));XLSX.utils.book_append_sheet(book,sheet,title);};
  if(kind==='ecount'){const upload=buildEcountUploadTable(record);add('銷貨匯入',[upload.headers,...upload.rows]);}
  else{
   add('預揀總表',[prepared.prepick.headers,...prepared.prepick.rows]);
   add('訂單金額核對',[prepared.audit.headers,...prepared.audit.rows]);
   add('來源商品對照',[['平台','商城訂單','來源明細號','來源SKU','商品名稱','原始數量','原始單價','原始商品小計','來源組合名稱'],...input.parsed.items.map(i=>[input.parsed.platform,i.sourceOrderNumber,i.sourceLineId,i.sku,i.productName,i.quantity,i.unitPriceMinor==null?'原檔未分價':i.unitPriceMinor/100,(i.sourceLineSubtotalMinor??i.lineSubtotalMinor)==null?'原檔未分價':(i.sourceLineSubtotalMinor??i.lineSubtotalMinor)/100,i.groupName])]);
   add('本批納入與排除',[['商城訂單','納入本批','原因'],...prepared.choices.map(c=>[c.number,c.eligible?'是':'否',c.reason])]);
   add('ECOUNT成交核對',[['商城訂單','來源明細號','SKU','數量','商品淨額','另分攤訂單折扣','平台商品折扣','平台全單折扣','平台購物金分攤','平台點數分攤'],...prepared.parsed.items.map(i=>[i.sourceOrderNumber,i.sourceLineId,i.sku,i.quantity,i.lineSubtotalMinor==null?'待確認':i.lineSubtotalMinor/100,(i.allocatedDiscountMinor||0)/100,...['product','order','credit','points'].map(k=>(i.sourceDiscounts?.[k]??0)/100)])]);
  }
  XLSX.writeFile(book,`${kind==='ecount'?'ECOUNT銷貨匯入':'預揀與金額核對'}_${record?.batchNumber||settings.batchNumber}.xlsx`);
 };
 const download=async kind=>{
  if(locked||inFlight.current||!input||!currentSession())return;
  if(kind==='ecount'&&!prepared.output.ok)return;
  if(kind==='audit'&&(!prepared.audit.ok||!prepared.prepick.ok))return;
  inFlight.current=true;setBusy(true);setMessage('');
  try{
   if(kind==='ecount'){
    const response=await apiClient.post('/api/marketplace-intakes',{rows:input.source.rows,settings},{timeout:45000});
    if(!mounted.current||!currentSession())return;
    setSaved(response.data);await writeBook(response.data,'ecount');await loadRecords();
    setMessage(`轉檔批次 #${response.data.id} 已保存，ECOUNT 銷貨檔已下載。請先在 ERP 核對並完成銷貨，再由此批次匯入理貨單。`);
   }else{if(!await loadRecords())throw Error('登入已失效');await writeBook(null,'audit');setMessage('預揀與金額核對表已下載；商品彙總只計本批納入的訂單。');}
  }catch(e){if(mounted.current)setMessage(e.response?.data?.message||'保存或下載未完成，請先查看已保存批次；結果不明時不要改單號重送。');}
  finally{inFlight.current=false;if(mounted.current)setBusy(false);}
 };
 const redownload=async id=>{
  if(locked||inFlight.current)return;inFlight.current=true;setBusy(true);setMessage('');
  try{const response=await apiClient.get(`/api/marketplace-intakes/${id}`);if(currentSession()&&mounted.current)await writeBook(response.data,'ecount');}
  catch(e){if(mounted.current)setMessage(e.response?.data?.message||'無法取得已保存轉檔批次。');}
  finally{inFlight.current=false;if(mounted.current)setBusy(false);}
 };
 return <main className="mx-auto max-w-7xl space-y-5 pb-8 text-slate-900" data-testid="marketplace-converter">
  <Link to="/admin" className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-blue-700"><ArrowLeft size={16}/>返回出貨管理</Link>
  <PageHeader title="商城訂單轉檔"/>
  <p className="text-sm leading-6 text-slate-600">1Shop、Shopify、SHOPLINE 使用同一入口，依表頭辨識並統一輸出 ECOUNT 27 欄。只有拋單員、管理員與最高管理員可保存轉檔及匯入。</p>
  {message&&<p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{message}</p>}
  <section className={`${sectionClass} border-dashed`} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();selectFiles(Array.from(e.dataTransfer.files||[]));}} aria-label="商城訂單檔案區">
   <h2 className="font-semibold">1. 放入平台原始訂單檔</h2><p className="mt-2 text-sm text-slate-600">可拖曳或選擇一個 Excel／CSV。請保留商品明細、付款／出貨狀態及金額欄；不要先合併同品項。</p>
   <Button type="button" variant="secondary" className="mt-4" disabled={locked} onClick={()=>fileRef.current?.click()}>{busy?<Loader2 className="mr-2 animate-spin" size={18}/>:<FileSpreadsheet className="mr-2" size={18}/>}選擇原始訂單檔</Button>
   <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={locked} onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';return selectFiles(files);}} aria-label="商城原始訂單檔"/>
   {name&&<p className="mt-3 text-sm">已辨識：<strong>{input?.parsed.platform}</strong> · {name}</p>}
   <details className="mt-3 text-sm text-slate-600"><summary className="cursor-pointer">各平台下載方式</summary><ul className="mt-2 list-disc space-y-1 pl-5"><li>Shopify：訂單 → 匯出 → 訂單 CSV；不要選交易紀錄。</li><li>1Shop：選取本批訂單 → 匯出 Excel。</li><li>SHOPLINE：訂單 → 更多動作 → 訂單報表，包含商品貨號、商品明細及訂單金額欄。客製欄位或組合商品仍須用實際檔驗收。</li></ul></details>
  </section>
  {input&&prepared&&<>
   <section className={sectionClass}>
    <h2 className="font-semibold">2. 核對本批訂單</h2>
    <p className="mt-2 text-sm text-slate-600">原檔 {input.parsed.orders.length} 筆；本批納入 {prepared.parsed.summary.orderCount} 筆、{prepared.parsed.summary.itemCount} 商品列、{prepared.parsed.summary.totalQuantity} 件。訂單總額不代表已收款。</p>
    {input.parsed.platform==='1Shop'&&input.parsed.orders.some(o=>TEST_ORDER_NUMBERS.includes(o.sourceOrderNumber))&&<Check checked={settings.includeTestOrders} onChange={v=>update('includeTestOrders',v)}>納入本次已授權的兩筆 TST 未付款測試單；其他未付款非貨到付款訂單仍排除。</Check>}
    <div className="mt-4 overflow-x-auto"><table className="w-full text-sm" aria-label="來源訂單與金額"><thead className="bg-slate-50"><tr>{['商城訂單','付款／出貨狀態','商品金額','運費','訂單總額','本批處理'].map(v=><th key={v} className={cell}>{v}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{input.parsed.orders.map(o=>{const c=prepared.choices.find(c=>c.number===o.sourceOrderNumber);return <tr key={o.sourceOrderNumber}><td className={`${cell} font-medium`}>{o.sourceOrderNumber}</td><td className={cell}>{o.rawPaymentStatus}／{o.rawFulfillmentStatus}</td><td className={cell}>{money(o.financial.subtotalMinor)}</td><td className={cell}>{money(o.financial.shippingMinor)}</td><td className={cell}>{money(o.financial.totalMinor)}</td><td className={cell}>{c.eligible?'納入':'排除'} · {c.reason}</td></tr>;})}</tbody></table></div>
   </section>
   <fieldset disabled={locked} className={sectionClass}><legend className="sr-only">商品與 ECOUNT 設定</legend>
    <h2 className="font-semibold">3. 核對商品與 ECOUNT 設定</h2><p className="mt-2 text-sm text-slate-600">來源 SKU 先帶入供核對；確認 ECOUNT 品項後才匯出。國際條碼從實物／主檔核對，不自動以 SKU 代替。</p>
    <div className="mt-4 space-y-3">{products.map(i=>{const m=settings.skuMappings[i.sku]||{};return <div key={i.sku} className="rounded-lg border border-slate-200 p-4"><p className="font-medium">{i.productName} <span className="text-xs text-slate-500">{i.sku}</span></p><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Field label="ECOUNT 品項編碼" value={m.erpSku||''} onChange={e=>mapping(i.sku,'erpSku',e.target.value)}/><Field label="ECOUNT 品項名稱" value={m.erpName||''} onChange={e=>mapping(i.sku,'erpName',e.target.value)}/><Field label="國際條碼" value={m.barcode||''} placeholder="待實物／主檔核對" onChange={e=>mapping(i.sku,'barcode',e.target.value)}/><Field label="商品分類" value={m.category||''} onChange={e=>mapping(i.sku,'category',e.target.value)}/></div><Check checked={m.confirmed} onChange={v=>mapping(i.sku,'confirmed',v)}>已核對此商品的 ECOUNT 品項編碼與名稱。</Check>{m.barcode&&<Check checked={m.barcodeConfirmed} onChange={v=>mapping(i.sku,'barcodeConfirmed',v)}>已核對實物商品條碼。</Check>}</div>;})}</div>
    <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Field label="商城店鋪" value={settings.store} onChange={e=>update('store',e.target.value)} help="回匯時需保留相同店鋪名稱。"/><Field label="ECOUNT 客戶／供應商編碼" value={settings.customerCode} onChange={e=>update('customerCode',e.target.value)} help="依本批應收帳款歸屬填入 ERP 客戶碼。"/><Field label="ECOUNT 客戶名稱" value={settings.customerName} onChange={e=>update('customerName',e.target.value)}/><Field label="發貨倉庫編碼" value={settings.warehouseCode} onChange={e=>update('warehouseCode',e.target.value)}/><Field label="銷貨日期" type="date" value={settings.date} onChange={e=>update('date',e.target.value)}/><Field label="銷貨追蹤單號（K 欄）" value={settings.batchNumber} maxLength={20} onChange={e=>update('batchNumber',e.target.value)}/><Field label="銷貨分組序號（B 欄）" value={settings.batchSequence} onChange={e=>update('batchSequence',e.target.value)}/><Field label="來源金額幣別" value={settings.currency} onChange={e=>update('currency',e.target.value)}/></div>
    <Check checked={settings.taxConfirmed} onChange={v=>update('taxConfirmed',v)}>已確認本次金額為 TWD，使用 ECOUNT 營業稅 11 及含稅單價，由 ERP 依設定計稅。</Check>
    {input.parsed.platform==='SHOPLINE'&&input.source.rows[0].includes('商品結帳價')?<p className="mt-4 text-sm text-slate-600">已使用 SHOPLINE 原報表逐商品提供的折扣、購物金與點數分攤，自動核對訂單總額；原始金額另行保留。</p>:input.parsed.platform!=='1Shop'&&<Check checked={settings.discountAllocationConfirmed} onChange={v=>update('discountAllocationConfirmed',v)}>訂單剩餘折扣按商品折後金額比例分攤，尾差按最小貨幣單位分配；運費折抵依訂單總額核對。這是 ECOUNT 計價分攤，原始金額另行保留。</Check>}
    {prepared.parsed.summary.bundleComponentCount>0&&<Check checked={settings.bundleZeroConfirmed} onChange={v=>update('bundleZeroConfirmed',v)}>確認本檔組合商品由主商品保留原組合價，其餘原檔未分價元件以 0 元入帳，仍依數量出貨。</Check>}
    {prepared.parsed.summary.shippingMinor>0&&<div className="mt-4 rounded-lg bg-slate-50 p-4"><div className="grid gap-3 sm:grid-cols-2"><Field label="ECOUNT 運費品項編碼" value={settings.shippingSku.erpSku} onChange={e=>update('shippingSku',{...settings.shippingSku,erpSku:e.target.value,confirmed:false,nonStock:false})}/><Field label="運費品項名稱" value={settings.shippingSku.name} onChange={e=>update('shippingSku',{...settings.shippingSku,name:e.target.value,confirmed:false,nonStock:false})}/></div><Check checked={settings.shippingSku.confirmed&&settings.shippingSku.nonStock} onChange={v=>update('shippingSku',{...settings.shippingSku,confirmed:v,nonStock:v})}>已確認運費品項為無形商品／數量管理除外，運費不納入預揀。</Check></div>}
   </fieldset>
   <section className={sectionClass}><h2 className="font-semibold">4. 保存批次並下載統一格式</h2><p className="mt-2 text-sm text-slate-600">保存後保留來源單號、商品、金額與 ECOUNT 對照，供理貨單回匯核對。此步不會送出 ERP 銷貨或扣庫存。</p>
    <p className="mt-2 text-sm text-slate-600">下載使用 ECOUNT 線上上傳 27 欄：P 欄數量、R 欄含稅單價，X～AA 欄為商城訂單編號、平台、店鋪、來源明細號。上傳時請核對 ECOUNT 畫面表頭相同。</p>
    {!!prepared.output.issues.length&&<ul className="mt-3 space-y-1 text-sm" aria-label="轉檔檢查結果">{prepared.output.issues.map((v,i)=><li key={i} className={v.severity==='warning'?'text-slate-500':'text-amber-900'}>{v.orderNumber?`${v.orderNumber}：`:''}{v.message}</li>)}</ul>}
    <div className="mt-4 flex flex-wrap gap-3"><Button disabled={locked||!prepared.output.ok} onClick={()=>download('ecount')}><Download size={16} className="mr-2"/>保存並下載 ECOUNT 銷貨檔（27 欄）</Button><Button variant="secondary" disabled={locked||!prepared.audit.ok||!prepared.prepick.ok} onClick={()=>download('audit')}>下載預揀與金額核對表</Button></div>
    {saved&&<Link className="mt-4 inline-block font-medium text-blue-700 underline" to={`/admin?intakeId=${saved.id}`}>ERP 銷貨完成後，匯入此批理貨單</Link>}
   </section>
  </>}
  <section className={sectionClass}><h2 className="font-semibold">已保存的轉檔批次</h2><p className="mt-2 text-sm text-slate-600">從對應批次開啟理貨單匯入，系統會核對整批訂單、品項及數量，再建立可列印條碼的商城工作單。重下載不代表需要再次送出 ERP 銷貨。</p>
   <div className="mt-4 overflow-x-auto"><table className="w-full text-sm" aria-label="已保存轉檔批次"><thead className="bg-slate-50"><tr>{['批次','平台／店鋪','訂單／已連結','操作'].map(v=><th key={v} className={cell}>{v}</th>)}</tr></thead><tbody>{records.map(r=><tr key={r.id}><td className={cell}>#{r.id} · {r.batch_number}</td><td className={cell}>{r.source_platform}／{r.source_store}</td><td className={cell}>{r.order_count}／{r.linked_count}</td><td className={cell}><button disabled={locked} className="mr-4 min-h-10 text-blue-700 underline" onClick={()=>redownload(r.id)}>重下載銷貨檔</button><Link className="text-blue-700 underline" to={`/admin?intakeId=${r.id}`}>匯入理貨單</Link></td></tr>)}</tbody></table></div>
   {access==='ready'&&!records.length&&<p className="mt-3 text-sm text-slate-500">尚無保存的轉檔批次。</p>}
  </section>
 </main>;
}
