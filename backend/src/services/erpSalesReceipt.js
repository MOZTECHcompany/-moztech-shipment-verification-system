const {createHash}=require('node:crypto');
const {parseOrderRows}=require('./orderImportParser');
const HEADERS=['ECOUNT實際銷貨單號','WMS批次號','客戶/供應商編碼','發貨倉庫','交易類型','平台','店鋪','商城訂單編號','來源明細號','品項編碼','數量','稅前價格','營業稅','含稅金額','國際條碼','序號/批號','摘要'];
const clean=v=>String(v??'').trim();
const fail=message=>Object.assign(new Error(message),{status:400});
async function reconcileSales(rows,record){
 const {prepareEcountFinancials,parseMoneyMinor}=await import('./marketplaceIntake.mjs');
 if(!Array.isArray(rows)||rows.length>10000)throw fail('銷貨回傳資料格式或列數無效');
 const h=rows.findIndex(r=>Array.isArray(r)&&r.some(c=>clean(c)==='來源明細號')&&r.some(c=>clean(c)==='ECOUNT實際銷貨單號'));
 if(h<0)throw fail('請使用 ECOUNT 已儲存銷貨明細的回傳格式，需有「ECOUNT實際銷貨單號」；銷貨上傳檔不能當作成功回執');
 const names=rows[h].map(clean),required=HEADERS.slice(0,14);
 for(const label of required)if(names.filter(n=>n===label).length!==1)throw fail(`回傳欄位缺漏或重複：${label}`);
 for(const label of HEADERS.slice(14))if(names.filter(n=>n===label).length>1)throw fail(`回傳欄位重複：${label}`);
 const {rows:expected,financials}=prepareEcountFinancials(record.snapshot);
 const identity=r=>JSON.stringify([r[13],r[14],r[12],r[15]].map(clean));
 const byKey=new Map(expected.map(r=>[identity(r),r]));
 const seen=new Set(),vouchers=new Set(),actual=[];
 const physical=new Map(record.orders.flatMap(o=>o.expected_items.map(i=>[JSON.stringify([o.source_platform,o.source_store,o.source_order_number,i.sourceLineId]),i])));
 const picking=[['理貨單號','品項編碼','品項名稱','商城訂單編號','平台','店鋪','來源明細號','國際條碼','數量','序號/批號','摘要']];
 for(let n=h+1;n<rows.length;n++){
  const row=rows[n];if(!Array.isArray(row))throw fail('回傳列格式無效');
  if(row.every(v=>!clean(v)))continue;
  const get=k=>clean(row[names.indexOf(k)]);
  // Only an isolated report footer is ignored; never discard an incomplete data row.
  if(row.filter(v=>clean(v)).length===1&&/^(?:合計|總計|小計|\d{4}\/\d{2}\/\d{2}.*)$/.test(clean(row.find(v=>clean(v)))))continue;
  const key=JSON.stringify(['平台','店鋪','商城訂單編號','來源明細號'].map(get));
  const e=byKey.get(key);
  if(!e||seen.has(key))throw fail(`第 ${n+1} 列：來源訂單／明細不屬於本批或重複`);
  seen.add(key);
  const voucher=get(HEADERS[0]);
  if(!voucher||voucher.length>100||/[\u0000-\u001f]/.test(voucher)||voucher===record.batch_number)throw fail(`第 ${n+1} 列：請提供 ECOUNT 實際已儲存銷貨單號，不能填 WMS 批次碼`);
  const pairs=[['WMS批次號',record.batch_number],['客戶/供應商編碼',e[2]],['發貨倉庫',e[6]],['交易類型',e[7]],['品項編碼',e[11]]];
  for(const [label,value] of pairs)if(get(label)!==clean(value))throw fail(`第 ${n+1} 列：${label} 與原批次不同`);
  if(!/^\d+(?:\.0+)?$/.test(get('數量'))||Number(get('數量'))!==Number(e[19]))throw fail(`第 ${n+1} 列：商品數量不符`);
  const net=parseMoneyMinor(get('稅前價格')),tax=parseMoneyMinor(get('營業稅')),gross=parseMoneyMinor(get('含稅金額'));
  if(net===null||tax===null||gross===null||net!==parseMoneyMinor(e[23])||tax!==parseMoneyMinor(e[24])||net+tax!==gross)throw fail(`第 ${n+1} 列：稅前／營業稅／含稅金額不符，請核對 ECOUNT 原銷貨單，勿重複匯入`);
  const item=physical.get(key);
  if(item){
   if(!item.barcode)throw fail(`商品 ${item.productCode} 缺少已確認商品條碼，請先核對原商品對照`);
   if(get('國際條碼')&&get('國際條碼')!==item.barcode)throw fail(`第 ${n+1} 列：國際條碼不符`);
   picking.push([record.batch_number,item.productCode,item.productName,get('商城訂單編號'),get('平台'),get('店鋪'),get('來源明細號'),item.barcode,item.quantity,get('序號/批號'),get('摘要')]);
  }else if(get('序號/批號'))throw fail('非庫存運費不可含 SN');
  vouchers.add(voucher);actual.push({identity:JSON.parse(key),voucher,productCode:get('品項編碼'),quantity:Number(get('數量')),netMinor:net,taxMinor:tax,grossMinor:gross,serials:get('序號/批號'),summary:get('摘要')});
 }
 if(seen.size!==byKey.size)throw fail('回傳未包含整批全部商品與運費明細，未建立／放行任務');
 const parsed=parseOrderRows(picking);
 actual.sort((a,b)=>JSON.stringify(a.identity).localeCompare(JSON.stringify(b.identity)));
 const fingerprint=createHash('sha256').update(JSON.stringify(actual)).digest('hex');
 return {receipt:{fingerprint,vouchers:[...vouchers].sort(),financials,lines:actual},parsed};
}
module.exports={HEADERS,reconcileSales};
