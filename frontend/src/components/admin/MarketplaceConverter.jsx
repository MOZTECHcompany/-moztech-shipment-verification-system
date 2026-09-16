import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft, Download, FileSpreadsheet, Loader2, UploadCloud } from 'lucide-react';
import { Button, PageHeader } from '../../ui';
import apiClient from '@/api/api.js';
import { API_ORIGIN } from '../../api/origin';
import MarketplaceBatchManager from './MarketplaceBatchManager';
import { batchSessionMatches } from '../../utils/importBatches';
import { formatMinor, buildEcountUploadTable, ECOUNT_TAX_DESCRIPTION } from '../../utils/marketplaceIntake.mjs';
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
const batchNumber=()=>`WMS-${today().replaceAll('-','')}-${Array.from(crypto.getRandomValues(new Uint8Array(2)),v=>v.toString(16).padStart(2,'0')).join('').toUpperCase()}`;
const initialSettings=()=>({store:'',customerCode:'',customerName:'',warehouseCode:'003',date:today(),batchSequence:'1',batchNumber:batchNumber(),projectOwner:'',salesOwner:'',erpStaffCode:'',erpProjectCode:'',erpResponsibilityConfirmed:false,summaryNote:'',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:false,includeTestOrders:false,bundleZeroConfirmed:false,discountAllocationConfirmed:false,skuMappings:{},shippingSku:{erpSku:'00001',name:'運費',confirmed:false,nonStock:false}});
function Field({label,help,children,...props}){return <label className="block min-w-0 text-sm font-medium text-slate-800">{label}{children||<input className={inputClass} {...props}/>} {help&&<span className="mt-1 block text-xs font-normal leading-5 text-slate-500">{help}</span>}</label>;}
function Check({children,checked,onChange}){return <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6 text-slate-800"><input type="checkbox" checked={!!checked} onChange={e=>onChange(e.target.checked)} className="mt-1 h-4 w-4 shrink-0"/><span>{children}</span></label>;}
export function MarketplaceConverter({user}){
 if(!MARKETPLACE_ROLES.includes(user?.role))return <Navigate to="/tasks" replace/>;
 return <ConverterPage user={user}/>;
}
function ConverterPage({user}){
 const [input,setInput]=useState(null),[settings,setSettings]=useState(initialSettings),[name,setName]=useState('');
 const [busy,setBusy]=useState(false),[access,setAccess]=useState('loading'),[message,setMessage]=useState(''),[records,setRecords]=useState([]),[saved,setSaved]=useState(null);
 const [profiles,setProfiles]=useState([]),[profileId,setProfileId]=useState(''),[profileNotice,setProfileNotice]=useState('');
 const [dragging,setDragging]=useState(false),[catalog,setCatalog]=useState(null),[catalogError,setCatalogError]=useState(''),[fileLink,setFileLink]=useState('');
 const fileRef=useRef(null),request=useRef(0),mounted=useRef(true),token=useRef(null),actor=useRef({id:user.id,role:user.role}),inFlight=useRef(false);
 const currentSession=()=>batchSessionMatches(localStorage,actor.current,token.current);
 const loadProfiles=async()=>{
  const response=await apiClient.get('/api/marketplace-intakes/store-profiles');
  if(mounted.current&&currentSession())setProfiles(response.data.profiles||[]);
 };
 const loadRecords=async()=>{
  const response=await apiClient.get('/api/marketplace-intakes');
  if(!mounted.current||!currentSession())return false;
  setRecords(response.data.intakes);setAccess('ready');return true;
 };
 useEffect(()=>{
  mounted.current=true;try{token.current=JSON.parse(localStorage.getItem('wms_token'));}catch{token.current=null;}
  loadProfiles().catch(()=>{if(mounted.current&&currentSession())setProfileNotice('店鋪設定暫時無法讀取，仍可手動填寫。');});
  loadRecords().catch(()=>{if(mounted.current){setAccess('denied');setMessage('無法確認轉檔權限，請使用拋單員、管理員或最高管理員帳號重新登入。');}});
  const check=()=>{if(currentSession())return;request.current++;setInput(null);setName('');setSaved(null);setRecords([]);setProfiles([]);setProfileId('');setSettings(initialSettings());setAccess('denied');setMessage('登入人員已變更，請重新登入。');};
  window.addEventListener('storage',check);return()=>{mounted.current=false;request.current++;window.removeEventListener('storage',check);};
 },[]);
 const locked=busy||access!=='ready';
 const prepared=useMemo(()=>input?prepareUnifiedMarketplace(input.parsed,settings):null,[input,settings]);
 const products=useMemo(()=>[...new Map((prepared?.parsed.items||[]).map(i=>[i.sku,i])).values()],[prepared]);
 // Collapse repeated per-order errors without dropping their order/row context.
 const issueGroups=useMemo(()=>{
  const groups=new Map();
  for(const item of prepared?.output.issues||[]){
   if(item.severity==='warning')continue;
   const key=`${item.code}:${item.field||''}`;
   if(!groups.has(key))groups.set(key,{key,items:[]});
   groups.get(key).items.push(item);
  }
  return [...groups.values()].map(group=>({...group,title:group.items[0].code==='PRODUCT_MAPPING_REQUIRED'?`${group.items.length} 項商品需確認 ECOUNT 對照`:group.items[0].message}));
 },[prepared]);
 const catalogIssues=products.flatMap(i=>{const r=catalog?.products?.[i.sku];return r?.status==='inactive'?[`${i.sku}：ECOUNT 已中止使用，請確認出貨品項。`]:r?.status==='ambiguous'?[`${i.sku}：品項編碼／條碼對應多個商品，請先核對主檔。`]:[];});
 const catalogBlocked=!!catalogError||catalogIssues.length>0;
 const warnings=prepared?.output.issues.filter(v=>v.severity==='warning')||[];
 const update=(key,value)=>{setSaved(null);if(['store','customerCode','customerName','warehouseCode','currency','taxConfirmed','shippingSku','projectOwner','salesOwner','erpStaffCode','erpProjectCode','erpResponsibilityConfirmed'].includes(key))setProfileId('');setSettings(s=>({...s,[key]:value,...(key==='currency'?{taxConfirmed:false}:{})}));};
 const mapping=(sku,key,value)=>{setSaved(null);setSettings(s=>({...s,skuMappings:{...s.skuMappings,[sku]:{...s.skuMappings[sku],[key]:value,...(['erpSku','erpName'].includes(key)?{confirmed:false}:{}),...(key==='barcode'?{barcodeConfirmed:false}:{})}}}));};
 const useProfile=id=>{
  if(locked||!currentSession())return;
  const profile=profiles.find(p=>String(p.id)===id&&p.platform===input?.parsed.platform);
  setSaved(null);setProfileId(profile?String(profile.id):'');setProfileNotice('');
  setSettings(s=>({...initialSettings(),date:s.date,batchNumber:s.batchNumber,skuMappings:s.skuMappings,discountAllocationConfirmed:s.discountAllocationConfirmed,bundleZeroConfirmed:s.bundleZeroConfirmed,includeTestOrders:s.includeTestOrders,...(profile?.settings||{})}));
 };
 const saveProfile=async()=>{
  if(locked||inFlight.current||!currentSession())return;inFlight.current=true;setBusy(true);setProfileNotice('');
  try{
   const response=await apiClient.post('/api/marketplace-intakes/store-profiles',{platform:input.parsed.platform,settings});
   if(!mounted.current||!currentSession())return;
   setProfiles(p=>[...p.filter(v=>v.id!==response.data.id),response.data]);setProfileId(String(response.data.id));setProfileNotice('店鋪設定已保存，下次上傳後選擇此店鋪即可帶入。');
  }catch(e){if(mounted.current&&currentSession())setProfileNotice(e.response?.data?.message||'店鋪設定未保存，請重試。');}
  finally{inFlight.current=false;if(mounted.current)setBusy(false);}
 };
 const selectFiles=async files=>{
  if(locked||!files?.length)return;
  setMessage('');setInput(null);setSaved(null);setName('');setProfileId('');setProfileNotice('');setCatalog(null);setCatalogError('');setFileLink('');
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
   let matched=null;
   try{
    matched=(await apiClient.post('/api/marketplace-products/resolve',{skus:[...new Set(result.parsed.items.map(i=>i.sku))]})).data;
    if(!mounted.current||sequence!==request.current||!currentSession())return;
    setCatalog(matched);
    for(const [sku,r] of Object.entries(matched.products||{}))if(r.status==='matched'){
     const p=r.matches[0];mappings[sku]={erpSku:p.erp_sku,erpName:p.product_name,spec:p.spec,barcode:p.barcode,confirmed:true,barcodeConfirmed:!!p.barcode,category:''};
    }
   }catch{if(mounted.current&&sequence===request.current)setCatalogError('ECOUNT 商品主檔暫時無法讀取，請重新上傳檔案再試。');}
   if(!mounted.current||sequence!==request.current||!currentSession())return;
   setSettings({...initialSettings(),skuMappings:mappings});
  }catch(e){if(mounted.current&&sequence===request.current)setMessage(e.message||'無法讀取來源檔');}
  finally{if(mounted.current&&sequence===request.current)setBusy(false);}
 };
 const writeBook=async(record,kind)=>{
  const XLSX=await import('xlsx');if(!mounted.current||!currentSession())throw Error('登入已變更，未下載資料。');
  const book=XLSX.utils.book_new();
  const add=(title,rows)=>{const sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!cols']=(rows[0]||[]).map(()=>({wch:24}));XLSX.utils.book_append_sheet(book,sheet,title);};
  if(kind==='ecount'){const upload=buildEcountUploadTable(record);add('銷貨匯入',[upload.headers,...upload.rows]);}
  else{
   add('承辦人',[['狀態','未保存核對草稿'],['承辦人',user.name||user.username||''],['承辦人帳號',user.username||'']]);
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
  if(kind==='ecount'&&(!prepared.output.ok||catalogBlocked))return;
  if(kind==='audit'&&(!prepared.audit.ok||!prepared.prepick.ok))return;
  inFlight.current=true;setBusy(true);setMessage('');
  try{
   if(kind==='ecount'){
    const response=await apiClient.post('/api/marketplace-intakes',{rows:input.source.rows,settings},{timeout:45000});
    if(!mounted.current||!currentSession())return;
    setSaved(response.data);
    const link=await apiClient.post(`/api/marketplace-intakes/${response.data.id}/download-link`,{kind:'ecount'},{withCredentials:true});
    if(!mounted.current||!currentSession())return;
    const url=`${API_ORIGIN}${link.data.url}`;setFileLink(url);
    const anchor=document.createElement('a');anchor.href=url;anchor.download='';document.body.appendChild(anchor);anchor.click();anchor.remove();
    await loadRecords();setMessage(`轉檔批次 #${response.data.id} 已保存，檔案已準備好。若未開始下載，請點下方下載連結。`);
   }else{if(!await loadRecords())throw Error('登入已失效');await writeBook(null,'audit');setMessage('預揀與金額核對表已下載；商品彙總只計本批納入的訂單。');}
  }catch(e){if(mounted.current)setMessage(e.response?.data?.message||'保存或下載未完成，請先查看已保存批次；結果不明時不要改單號重送。');}
  finally{inFlight.current=false;if(mounted.current)setBusy(false);}
 };
 return <main className="mx-auto max-w-7xl space-y-5 pb-8 text-slate-900" data-testid="marketplace-converter">
  <Link to="/admin" className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-blue-700"><ArrowLeft size={16}/>返回出貨管理</Link>
  <div className="flex flex-wrap items-center justify-between gap-3"><PageHeader title="商城訂單轉檔"/><a href="#saved-batches" className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700">管理已保存批次</a></div>
  <p className="text-sm leading-6 text-slate-600">上傳 Shopify、1Shop 或 SHOPLINE 訂單，下載後即可到 ECOUNT 匯入銷貨。</p>
  {fileLink&&<a href={fileLink} download className="inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white">下載已保存的 ECOUNT 銷貨檔</a>}
  {message&&<p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{message}</p>}
  <section className={`${sectionClass} border-2 border-dashed transition-colors ${dragging?"border-blue-500 bg-blue-50":"border-slate-300"}`} onDragOver={e=>{e.preventDefault();if(!locked)setDragging(true);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDragging(false);}} onDrop={e=>{e.preventDefault();setDragging(false);selectFiles(Array.from(e.dataTransfer.files||[]));}} aria-label="商城訂單檔案區">
   <div className="flex flex-col items-center py-4 text-center"><UploadCloud size={36} className="mb-3 text-blue-600"/><h2 className="text-lg font-semibold">{dragging?"放開檔案，開始讀取":"將訂單檔拖曳到這裡"}</h2><p className="mt-2 text-sm text-slate-600">Shopify、1Shop、SHOPLINE · Excel／CSV</p><p className="mt-1 text-xs text-slate-500">每次一個平台／店鋪，一個檔案，上限 10 MiB</p>
   <Button type="button" variant="secondary" className="mt-4" disabled={locked} onClick={()=>fileRef.current?.click()}>{busy?<Loader2 className="mr-2 animate-spin" size={18}/>:<FileSpreadsheet className="mr-2" size={18}/>}選擇原始訂單檔</Button></div>
   <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={locked} onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';return selectFiles(files);}} aria-label="商城原始訂單檔"/>
   {name&&<p className="mt-3 text-sm">已辨識：<strong>{input?.parsed.platform}</strong> · {name}</p>}
   <details className="mt-3 text-sm text-slate-600"><summary className="cursor-pointer">各平台下載方式</summary><ul className="mt-2 list-disc space-y-1 pl-5"><li>Shopify：訂單 → 匯出 → 訂單 CSV；不要選交易紀錄。</li><li>1Shop：選取本批訂單 → 匯出 Excel。</li><li>SHOPLINE：訂單 → 更多動作 → 訂單報表，包含商品貨號、商品明細及訂單金額欄。客製欄位或組合商品仍須用實際檔驗收。</li></ul></details>
  </section>
  {input&&prepared&&<>
   <section className={`${sectionClass} border-blue-200`} aria-label="轉檔與下載">
    <div className="mb-5 rounded-xl bg-blue-50 p-4"><Field label="選擇本批店鋪" help="店鋪設定只需保存一次；系統會帶入銷貨客戶、倉庫與已確認的計價設定。"><select className={inputClass} disabled={locked} value={profileId} onChange={e=>useProfile(e.target.value)}><option value="">請選擇店鋪，或展開下方設定新增</option>{profiles.filter(p=>p.platform===input.parsed.platform).map(p=><option key={p.id} value={p.id}>{p.store} · {p.settings.customerCode}</option>)}</select></Field>{profileId&&<p className="mt-2 text-sm">銷貨客戶：{settings.customerCode} · {settings.customerName}</p>}<p className="mt-2 text-sm text-slate-600">轉檔建立者：{user.name||user.username||'目前登入人員'}（保存批次時自動綁定）</p></div>
    <div className="flex flex-wrap items-start justify-between gap-4">
     <div><h2 className="font-semibold">2. 下載 ECOUNT 銷貨檔</h2><p className="mt-2 text-sm text-slate-600">{prepared.parsed.summary.orderCount} 筆訂單 · {prepared.parsed.summary.totalQuantity} 件商品 · 訂單總額 {settings.currency} {money(prepared.parsed.summary.totalMinor)}</p><p className="mt-1 text-xs text-slate-500">已排除 {input.parsed.orders.length-prepared.parsed.summary.orderCount} 筆不符合出貨條件的訂單</p></div>
     <Button disabled={locked||!prepared.output.ok||catalogBlocked} onClick={()=>download('ecount')}><Download size={16} className="mr-2"/>下載 ECOUNT 銷貨檔</Button>
    </div>
    {prepared.output.ok&&<div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"><p>稅前 {money(prepared.output.summary.ecountNetMinor)} ＋ 營業稅 {money(prepared.output.summary.ecountTaxMinor)} ＝ 含稅 {money(prepared.output.summary.ecountTotalMinor)}</p><p className="mt-1 text-xs text-slate-500">{ECOUNT_TAX_DESCRIPTION}</p></div>}
    {catalog?.sync&&<p className="mt-3 text-xs text-slate-500">ECOUNT 唯讀對照來源 · 資料日期 {new Date(catalog.sync.created_at).toLocaleString('zh-TW')}</p>}
    {catalogBlocked&&<ul role="alert" className="mt-3 rounded-lg bg-amber-50 p-4 text-sm text-amber-950">{[catalogError,...catalogIssues].filter(Boolean).map(x=><li key={x}>{x}</li>)}</ul>}
    {issueGroups.length>0?<div className="mt-4 rounded-lg bg-amber-50 p-4" role="region" aria-label="待處理問題"><p className="text-sm font-semibold text-amber-950">請先處理以下問題，即可下載</p><ul className="mt-2 space-y-2 text-sm text-amber-950" aria-label="轉檔檢查結果">{issueGroups.map(g=><li key={g.key}>{g.items.length>1?<details><summary className="cursor-pointer">{g.title}{g.items[0].code!=='PRODUCT_MAPPING_REQUIRED'?`（${g.items.length} 筆）`:''}</summary><ul className="mt-2 space-y-1 pl-4">{g.items.map((v,i)=><li key={i}>{v.orderNumber?`${v.orderNumber}：`:''}{v.sourceRow?`第 ${v.sourceRow} 列：`:''}{v.message}</li>)}</ul></details>:<>{g.items[0].orderNumber?`${g.items[0].orderNumber}：`:''}{g.items[0].sourceRow?`第 ${g.items[0].sourceRow} 列：`:''}{g.title}</>}</li>)}</ul><p className="mt-3 text-xs text-amber-900">商品與設定問題可在下方展開核對；訂單資料有誤時，請修正來源檔再上傳。</p></div>:!catalogBlocked&&<p className="mt-4 text-sm text-emerald-700">檢查通過，可以下載。</p>}
    <p className="mt-3 text-xs text-slate-500">下載時會自動保存本批訂單，供理貨單回匯對應。請將下載的檔案上傳到 ECOUNT 完成銷貨。</p>
    {saved&&<Link className="mt-3 inline-block text-sm font-medium text-blue-700 underline" to={`/admin?intakeId=${saved.id}`}>ERP 銷貨完成後，匯入此批理貨單</Link>}
   </section>
   <details className={sectionClass}><summary className="cursor-pointer font-semibold">商品對照（{products.length} 項）</summary><fieldset disabled={locked}><legend className="sr-only">商品對照</legend><p className="mt-2 text-sm text-slate-600">商城原始貨號完整比對 ECOUNT 品項編碼與條碼；唯一匹配會自動帶入。NEW 前綴及尾碼保持不變，主檔條碼空白時再核對實物。</p>
    <div className="mt-4 space-y-3">{products.map(i=>{const m=settings.skuMappings[i.sku]||{};return <div key={i.sku} className="rounded-lg border border-slate-200 p-4"><p className="font-medium">{i.productName} <span className="text-xs text-slate-500">{i.sku}</span></p><p className="mt-2 text-xs text-slate-500">{catalog?.products?.[i.sku]?.status==='matched'?'已依 ECOUNT 主檔精確對應':catalog?.products?.[i.sku]?.status==='inactive'?'ECOUNT 已中止使用':catalog?.products?.[i.sku]?.status==='ambiguous'?'主檔有多筆對應，待釐清':'主檔未找到，請核對完整品項編碼'}</p><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Field label="ECOUNT 品項編碼" value={m.erpSku||''} onChange={e=>mapping(i.sku,'erpSku',e.target.value)}/><Field label="ECOUNT 品項名稱" value={m.erpName||''} onChange={e=>mapping(i.sku,'erpName',e.target.value)}/><Field label="國際條碼" value={m.barcode||''} placeholder="待實物／主檔核對" onChange={e=>mapping(i.sku,'barcode',e.target.value)}/><Field label="商品分類" value={m.category||''} onChange={e=>mapping(i.sku,'category',e.target.value)}/></div><Check checked={m.confirmed} onChange={v=>mapping(i.sku,'confirmed',v)}>已核對此商品的 ECOUNT 品項編碼與名稱。</Check>{m.barcode&&<Check checked={m.barcodeConfirmed} onChange={v=>mapping(i.sku,'barcodeConfirmed',v)}>已核對實物商品條碼。</Check>}</div>;})}</div>
   </fieldset></details>
   <details className={sectionClass}><summary className="cursor-pointer font-semibold">店鋪與 ECOUNT 設定（首次設定或變更時使用）</summary><fieldset disabled={locked}><legend className="sr-only">ECOUNT 設定</legend>
    <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Field label="商城店鋪" value={settings.store} onChange={e=>update('store',e.target.value)} help="回匯時需保留相同店鋪名稱。"/><Field label="ECOUNT 銷貨客戶編碼" value={settings.customerCode} onChange={e=>update('customerCode',e.target.value)} help="依本批應收帳款歸屬填入 ERP 客戶碼。"/><Field label="ECOUNT 客戶名稱" value={settings.customerName} onChange={e=>update('customerName',e.target.value)}/><Field label="發貨倉庫編碼" value={settings.warehouseCode} onChange={e=>update('warehouseCode',e.target.value)}/><Field label="銷貨日期" type="date" value={settings.date} onChange={e=>update('date',e.target.value)}/><Field label="銷貨追蹤單號（K 欄）" value={settings.batchNumber} maxLength={20} onChange={e=>update('batchNumber',e.target.value)}/><Field label="銷貨分組序號（B 欄）" value={settings.batchSequence} onChange={e=>update('batchSequence',e.target.value)}/><Field label="來源金額幣別" value={settings.currency} onChange={e=>update('currency',e.target.value)}/></div>
    <div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="專案負責人（選填）" value={settings.projectOwner||''} onChange={e=>update('projectOwner',e.target.value)}/><Field label="業務負責人（選填）" value={settings.salesOwner||''} onChange={e=>update('salesOwner',e.target.value)}/><Field label="ECOUNT 承辦人編碼（選填）" value={settings.erpStaffCode||''} onChange={e=>{update('erpStaffCode',e.target.value);update('erpResponsibilityConfirmed',false);}} help="使用 ECOUNT 人員編碼；WMS 登入建立者會另外自動保存。"/><Field label="ECOUNT 專案編碼（選填）" value={settings.erpProjectCode||''} onChange={e=>{update('erpProjectCode',e.target.value);update('erpResponsibilityConfirmed',false);}}/><Field label="本批摘要（選填）" value={settings.summaryNote||''} maxLength={255} onChange={e=>update('summaryNote',e.target.value)} help="預設空白。每個商品的 SN 可在下載檔的序號/批號或摘要填入，請勿在此輸入共用 SN。"/></div>
    {(settings.erpStaffCode||settings.erpProjectCode)&&<Check checked={settings.erpResponsibilityConfirmed} onChange={v=>update('erpResponsibilityConfirmed',v)}>已核對 ECOUNT 承辦人及專案編碼。</Check>}
    <p className="mt-3 text-xs text-slate-500">B 欄「序號」用來把本批商品歸為同一張銷貨單；商品 SN 填在「序號/批號」，與本批追蹤號不同。</p>
    <Check checked={settings.taxConfirmed} onChange={v=>update('taxConfirmed',v)}>已確認本次金額為 TWD，使用 ECOUNT 營業稅 11 及含稅單價，轉檔明確列出稅前金額與營業稅。</Check>
    {input.parsed.platform==='SHOPLINE'&&input.source.rows[0].includes('商品結帳價')?<p className="mt-4 text-sm text-slate-600">已使用 SHOPLINE 原報表逐商品提供的折扣、購物金與點數分攤，自動核對訂單總額；原始金額另行保留。</p>:input.parsed.platform!=='1Shop'&&<Check checked={settings.discountAllocationConfirmed} onChange={v=>update('discountAllocationConfirmed',v)}>訂單剩餘折扣按商品折後金額比例分攤，尾差按最小貨幣單位分配；運費折抵依訂單總額核對。這是 ECOUNT 計價分攤，原始金額另行保留。</Check>}
    {prepared.parsed.summary.bundleComponentCount>0&&<Check checked={settings.bundleZeroConfirmed} onChange={v=>update('bundleZeroConfirmed',v)}>確認本檔組合商品由主商品保留原組合價，其餘原檔未分價元件以 0 元入帳，仍依數量出貨。</Check>}
    {prepared.parsed.summary.shippingMinor>0&&<div className="mt-4 rounded-lg bg-slate-50 p-4"><div className="grid gap-3 sm:grid-cols-2"><Field label="ECOUNT 運費品項編碼" value={settings.shippingSku.erpSku} onChange={e=>update('shippingSku',{...settings.shippingSku,erpSku:e.target.value,confirmed:false,nonStock:false})}/><Field label="運費品項名稱" value={settings.shippingSku.name} onChange={e=>update('shippingSku',{...settings.shippingSku,name:e.target.value,confirmed:false,nonStock:false})}/></div><Check checked={settings.shippingSku.confirmed&&settings.shippingSku.nonStock} onChange={v=>update('shippingSku',{...settings.shippingSku,confirmed:v,nonStock:v})}>已確認運費品項為無形商品／數量管理除外，運費不納入預揀。</Check></div>}
   </fieldset><div className="mt-4 border-t border-slate-100 pt-4"><Button variant="secondary" disabled={locked} onClick={saveProfile}>保存此店鋪設定</Button><p className="mt-2 text-xs text-slate-500">同平台、同店鋪會更新原設定，供轉檔人員共用；已保存批次不受影響。</p>{profileNotice&&<p role="status" className="mt-2 text-sm text-blue-800">{profileNotice}</p>}</div>
   </details>
   <details className={sectionClass}>
    <summary className="cursor-pointer font-semibold">訂單明細與納入／排除</summary>
    <p className="mt-2 text-sm text-slate-600">原檔 {input.parsed.orders.length} 筆；本批納入 {prepared.parsed.summary.orderCount} 筆、{prepared.parsed.summary.itemCount} 商品列、{prepared.parsed.summary.totalQuantity} 件。訂單總額不代表已收款。</p>
    {input.parsed.platform==='1Shop'&&input.parsed.orders.some(o=>TEST_ORDER_NUMBERS.includes(o.sourceOrderNumber))&&<Check checked={settings.includeTestOrders} onChange={v=>update('includeTestOrders',v)}>納入本次已授權的兩筆 TST 未付款測試單；其他未付款非貨到付款訂單仍排除。</Check>}
    <div className="mt-4 overflow-x-auto"><table className="w-full text-sm" aria-label="來源訂單與金額"><thead className="bg-slate-50"><tr>{['商城訂單','付款／出貨狀態','商品金額','運費','訂單總額','本批處理'].map(v=><th key={v} className={cell}>{v}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{input.parsed.orders.map(o=>{const c=prepared.choices.find(c=>c.number===o.sourceOrderNumber);return <tr key={o.sourceOrderNumber}><td className={`${cell} font-medium`}>{o.sourceOrderNumber}</td><td className={cell}>{o.rawPaymentStatus}／{o.rawFulfillmentStatus}</td><td className={cell}>{money(o.financial.subtotalMinor)}</td><td className={cell}>{money(o.financial.shippingMinor)}</td><td className={cell}>{money(o.financial.totalMinor)}</td><td className={cell}>{c.eligible?'納入':'排除'} · {c.reason}</td></tr>;})}</tbody></table></div>
   </details>
   <details className={sectionClass}><summary className="cursor-pointer font-semibold">其他下載與轉檔說明</summary>
    <p className="mt-3 text-sm text-slate-600">ECOUNT 銷貨檔為 27 欄：P 欄數量、R 欄含稅單價，X～AA 欄為商城訂單編號、平台、店鋪、來源明細號。上傳時請核對 ECOUNT 畫面表頭相同。</p>
    <p className="mt-2 text-sm text-slate-600">訂單總額不代表已收款；商品條碼須確認後才能用於 WMS 揀貨核對。</p>
    <Button className="mt-4" variant="secondary" disabled={locked||!prepared.audit.ok||!prepared.prepick.ok} onClick={()=>download('audit')}>下載預揀與金額核對表</Button>
    {!!warnings.length&&<details className="mt-4 text-sm text-slate-600"><summary className="cursor-pointer">查看提醒（{warnings.length}）</summary><ul className="mt-2 space-y-1">{warnings.map((v,i)=><li key={i}>{v.orderNumber?`${v.orderNumber}：`:''}{v.message}</li>)}</ul></details>}
   </details>
  </>}
  <MarketplaceBatchManager enabled={access==='ready'} currentSession={currentSession} refreshKey={records}/>

 </main>;
}
