import { buildEcountUploadTable } from './marketplaceIntake.mjs';
export function savedBatchTables(record,kind){
 if(kind==='ecount'){const t=buildEcountUploadTable(record);return [{name:'銷貨匯入',rows:[t.headers,...t.rows]}];}
 if(!record?.prepick||!Array.isArray(record.items))throw Error('此批次缺少預揀資料');
 const settings=record.settings||{},links=new Map((record.links||[]).map(l=>[l.source_order_number,l]));
 return [
  {name:'批次說明',rows:[['批次',record.batchNumber],['銷貨日期',settings.date],['平台',record.platform],['店鋪',record.store],['核對狀態',record.reviewWarning?`待修正，不可作為出貨依據：${record.reviewWarning}`:'依原保存批次資料產生'],['用途','WMS 預揀彙總與來源訂單明細；不是 ECOUNT 理貨回匯檔'],['工作條碼','ERP 理貨回匯後產生；紙本掃碼工作單請由理貨批次頁列印'],['金額','訂單總額不代表已收款']]},
  {name:'預揀總表',rows:[...(record.reviewWarning?[[`待修正，不可作為出貨依據：${record.reviewWarning}`]]:[]),record.prepick.headers,...record.prepick.rows]},
  {name:'訂單商品明細',rows:[...(record.reviewWarning?[[`待修正，不可作為出貨依據：${record.reviewWarning}`]]:[]),['商城訂單','來源明細號','來源貨號','ECOUNT 品項編碼','商品名稱','已確認商品條碼','數量','商品成交金額','WT 工作條碼'],...record.items.map(i=>{
   const m=settings.skuMappings?.[i.sku]||{};
   return [i.sourceOrderNumber,i.sourceLineId,i.sku,m.erpSku,m.erpName||i.productName,m.barcodeConfirmed===true?m.barcode:'',i.quantity,i.lineSubtotalMinor==null?'':i.lineSubtotalMinor/100,links.get(i.sourceOrderNumber)?.work_barcode||''];
  })]},
  {name:'訂單金額核對',rows:[record.reportHeaders||[],...(record.reportRows||[])]}
 ];
}
