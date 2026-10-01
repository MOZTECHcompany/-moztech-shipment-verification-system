import { buildEcountUploadTable, prepareEcountFinancials, groupedSalesRecord } from './marketplaceIntake.mjs';
const shippingFields=['recipient','phone','address','postalCode','method','storeName','storeCode','trackingNumber','note'];
const shippingHeaders=['收件人','收件電話','收件地址','郵遞區號','配送方式','取貨門市','門市代號','物流單號','出貨備註'];
const shippingCells=shipping=>shippingFields.map(key=>typeof shipping?.[key]==='string'?shipping[key]:'');
export function savedBatchTables(record,kind){
 if(kind==='ecount-grouped'){const t=buildEcountUploadTable(groupedSalesRecord(record));return [{name:'銷貨匯入',rows:[t.headers,...t.rows]}];}
 if(kind==='ecount'){const t=buildEcountUploadTable(record);return [{name:'銷貨匯入',rows:[t.headers,...t.rows]}];}
 if(!record?.prepick||!Array.isArray(record.items))throw Error('此批次缺少預揀資料');
 const handler=record.handler?.name||record.handler?.username||'未記錄';
 let financials=null;try{financials=prepareEcountFinancials(record).financials;}catch{}
 const settings=record.settings||{},links=new Map((record.links||[]).map(l=>[l.source_order_number,l])),orders=new Map((record.orders||[]).map(o=>[o.sourceOrderNumber,o]));
 return [
  {name:'批次說明',rows:[['批次',record.batchNumber],['銷貨日期',settings.date],['平台',record.platform],['店鋪',record.store],['轉檔建立者',handler],['專案負責人',settings.projectOwner||'未指定'],['業務負責人',settings.salesOwner||'未指定'],['ECOUNT 承辦人編碼',settings.erpStaffCode||''],['ECOUNT 專案編碼',settings.erpProjectCode||''],['建立者帳號',record.handler?.username||''],['建立者來源',record.handler?.legacy?'依原建立者帳號查得；舊批次未保存當時姓名':'建立批次時的登入人員'],['核對狀態',record.reviewWarning?`待修正，不可作為出貨依據：${record.reviewWarning}`:'依原保存批次資料產生'],['用途','WMS 預揀彙總與來源訂單明細；不是 ECOUNT 理貨回匯檔'],['工作條碼','紙本掃碼工作單請由倉庫預揀頁領單列印；舊理貨批次仍由原批次頁列印'],['金額','訂單總額不代表已收款']]},
  {name:'預揀總表',rows:[...(record.reviewWarning?[[`待修正，不可作為出貨依據：${record.reviewWarning}`]]:[]),[...record.prepick.headers,'轉檔建立者'],...record.prepick.rows.map(r=>[...r,handler])]},
  {name:'訂單商品明細',rows:[...(record.reviewWarning?[[`待修正，不可作為出貨依據：${record.reviewWarning}`]]:[]),['商城訂單','來源明細號','來源貨號','ECOUNT 品項編碼','商品名稱','已確認商品條碼','數量','商品成交金額','WT 工作條碼','轉檔建立者',...shippingHeaders],...record.items.map(i=>{
   const m=settings.skuMappings?.[i.sku]||{};
   return [i.sourceOrderNumber,i.sourceLineId,i.sku,m.erpSku,m.erpName||i.productName,m.barcodeConfirmed===true?m.barcode:'',i.quantity,i.lineSubtotalMinor==null?'':i.lineSubtotalMinor/100,links.get(i.sourceOrderNumber)?.work_barcode||'',handler,...shippingCells(orders.get(i.sourceOrderNumber)?.shipping)];
  })]},
  {name:'訂單金額核對',rows:[record.reportHeaders||[],...(record.reportRows||[])]},
  {name:'金額與追溯',rows:traceRows(record,financials)},
  ...groupedTrace(record),
  {name:'配送資料',rows:[['商城訂單','平台','店鋪','WT 工作條碼',...shippingHeaders],...(record.orders||[]).map(o=>[o.sourceOrderNumber,o.sourcePlatform||record.platform,record.store||settings.store,links.get(o.sourceOrderNumber)?.work_barcode||'',...shippingCells(o.shipping)])]}
 ];
}

function groupedTrace(record){
 if(!record.salesLayout)return [];
 const view=prepareEcountFinancials(record);
 if(!view.salesLayout)return [];
 return [{name:'彙總銷貨對照',rows:[['彙總明細號','ERP 品項編碼','彙總列數量','彙總列含稅金額','平台','店鋪','商城訂單','來源明細號','分配數量','原訂單成交金額'],...view.salesLayout.lines.flatMap(l=>l.allocations.map(a=>[l.lineId,l.productCode,l.quantity,l.grossMinor/100,...a.identity,a.quantity,a.sourceGrossMinor/100]))]}];
}

function traceRows(record,financials){
 const s=record.settings||{};
 return [['批次追蹤號',record.batchNumber||s.batchNumber],['轉檔建立者',record.handler?.name||record.handler?.username||'未記錄'],['建立者帳號',record.handler?.username||''],['專案負責人',s.projectOwner||'未指定'],['業務負責人',s.salesOwner||'未指定'],['ECOUNT 承辦人編碼',s.erpStaffCode||''],['ECOUNT 專案編碼',s.erpProjectCode||''],['計稅版本',financials?.version||'待核對'],['計稅方式',financials?.description||''],['稅前合計',financials?financials.netMinor/100:''],['營業稅合計',financials?financials.taxMinor/100:''],['含稅合計',financials?financials.grossMinor/100:''],['下載版本',financials?.recalculatedLegacy?'由原批次含稅金額補算；原保存資料保留不變':'保存時已明確計算'],['ERP 操作','已匯入 ERP 的批次應核對原單，不可再次匯入扣庫存'],['序號說明','B 欄是銷貨分組序號，不是商品 SN；商品序號/批號及摘要欄保留供填寫'],[],['平台','店鋪','商城訂單編號','來源明細號','品項編碼','數量','稅前價格','營業稅','含稅金額'],...(financials?prepareEcountFinancials(record).rows.map(r=>[r[13],r[14],r[12],r[15],r[11],r[19],r[23],r[24],Number((r[23]+r[24]).toFixed(2))]):[])];
}
