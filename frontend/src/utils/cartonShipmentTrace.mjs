const text=value=>value==null?'':String(value);
const fail=message=>{throw Error(message);};
const integer=value=>Number.isSafeInteger(value)&&value>0;
export const CARTON_SHIPMENT_TRACE_HEADERS=Object.freeze(['WMS工作單號','WMS工作單ID','來源理貨批次','ECOUNT已核對單號','平台','店鋪','商城訂單編號','來源明細號','完整來源SKU','ERP品項編碼','箱號','箱內容版本','箱分配ID','箱明細ID','商品掃描碼類型','國際條碼','內部掃描碼','數量','實際SN','作業狀態','揀貨確認時間','裝箱確認時間','解除時間','解除原因']);
// This is a trace file only. Released allocations remain visible as evidence,
// and picked/packed are separate verification states, never extra ERP sales.
export function buildCartonShipmentTrace(payload={}) {
 const order=payload.order||{},allocations=payload.allocations;
 if(!Array.isArray(allocations))fail('箱出貨對照缺少分配資料');
 const rows=[],seen=new Set();
 for(const a of allocations){
  if(!['picked','packed','released'].includes(a.status)||!Array.isArray(a.lines))fail('箱出貨分配狀態或明細無效');
  for(const line of a.lines){
   const key=JSON.stringify([a.allocationId,line.lineId,line.orderItemId]);
   if(seen.has(key)||!integer(line.quantity)||line.quantitySign!==1)fail('箱出貨明細重複或數量無效');seen.add(key);
   const serials=line.actualSN||[];
   if(!Array.isArray(serials)||new Set(serials).size!==serials.length||serials.some(s=>typeof s!=='string'||!s)||serials.length&&serials.length!==line.quantity)fail('箱出貨 SN 與實際數量不一致');
   const values=serials.length?serials.map(sn=>[1,sn]):[[line.quantity,'']];
   const type=line.ean?'國際條碼':line.internalScanCode?'內部掃描碼':'品項編碼';
   for(const [quantity,sn] of values)rows.push([
    text(order.voucher_number),text(order.id||a.orderId),text(payload.batchNumber||order.batch_number),
    (payload.ecountVouchers||[]).map(text).join(' / '),
    text(line.sourcePlatform||order.source_platform),text(line.sourceStore||order.source_store),text(line.sourceOrderNumber||order.source_order_number),text(line.sourceLineId),text(line.sourceSKU),
    text(line.itemCode),text(a.cartonId),text(a.contentRevision),text(a.allocationId),text(line.lineId),type,text(line.ean),text(line.internalScanCode),quantity,sn,
    {picked:'已揀貨',packed:'已裝箱',released:'已解除'}[a.status],text(a.pickedAt),text(a.packedAt),text(a.releasedAt),text(a.releaseReason)
   ]);
  }
 }
 return {name:'箱出貨對照',headers:[...CARTON_SHIPMENT_TRACE_HEADERS],rows,purpose:'出貨追溯與原 ECOUNT 單據核對；不可作為新的銷貨匯入檔'};
}

export function cartonTraceNotes(payload = {}, purpose = '作業歷史與原 ECOUNT 單據對照；不可作為新的銷貨匯入檔') {
 return [['用途',purpose],['正式庫存','沿用原 ECOUNT 銷貨流程；此檔不建立銷貨單、不重複扣庫存。'],['原單補註','全單檔案可附原單附件；原單摘要只貼對應品項，保留原摘要、SN 與數量。'],['核對範圍','原單號／人工核對紀錄不是 ECOUNT 官方回寫或儲存成功回執。'],
  ['本次內容指紋',text(payload.fingerprint)],['可進行人工核對',payload.ready===true?'是':payload.ready===false?'否':'未提供'],['WMS對照狀態',({unlinked:'未綁定',reference_only:'待人工核對',manual_checked:'已人工核對',changed:'內容有變，待重新核對'})[payload.status]||'未提供'],
  ['人工核對指紋（非官方回執）',text(payload.reference?.confirmedFingerprint)],['人工核對時間（非官方回執）',text(payload.reference?.confirmedAt)],['人工核對人',text(payload.reference?.confirmedBy?.name||payload.reference?.confirmedBy?.username||payload.reference?.confirmedBy?.id)],
  ...(payload.referenceWarning?[['來源提示',payload.referenceWarning]]:[]),...(payload.blockers||[]).map(blocker=>['待確認',blocker.message])];
}

export function buildPackedCartonShipmentTrace(payload={}) {
 if (!Array.isArray(payload.rows)||!Array.isArray(payload.looseRows)) fail('已裝箱對照缺少實際明細，請重新整理。');
 const headers=['WMS工作單號','WMS出貨對照碼','ECOUNT公司代碼','原ECOUNT銷貨單號','核對狀態','箱號','ERP品項編碼','商品名稱','本次數量','實際SN','箱分配ID','箱內容版本','來源明細號','完整來源SKU'];
 const rows=[],seen=new Set(),serialsSeen=new Set(),byCode=new Map();
 for(const line of [...payload.rows.map(line=>({...line,boxed:true})),...payload.looseRows.map(line=>({...line,boxed:false}))]) {
  const key=JSON.stringify([line.boxed,line.allocationId,line.cartonLineId,line.orderItemId]);
  if(seen.has(key)||!integer(line.quantity)||!line.itemCode||line.boxed&&!line.cartonId)fail('已裝箱明細重複或數量無效');seen.add(key);
  const serials=line.actualSN||[];
  if(!Array.isArray(serials)||serials.length&&serials.length!==line.quantity||serials.some(sn=>typeof sn!=='string'||!sn||serialsSeen.has(sn)))fail('已裝箱 SN 與實際數量不一致');
  for(const sn of serials){if(serialsSeen.has(sn))fail('已裝箱 SN 重複');serialsSeen.add(sn);}
  const total=byCode.get(line.itemCode)||{quantity:0,actualSN:[]};total.quantity+=line.quantity;total.actualSN.push(...serials);byCode.set(line.itemCode,total);
  for(const[quantity,sn]of serials.length?serials.map(sn=>[1,sn]):[[line.quantity,'']])rows.push([
   text(payload.wmsVoucherNumber),text(payload.shipmentReference),text(payload.reference?.companyCode),text(payload.reference?.voucherNumber),
   ({unlinked:'未綁定',reference_only:'待人工核對',manual_checked:'已人工核對',changed:'內容有變，待重新核對'})[payload.status]||'待確認',
   line.boxed?text(line.cartonId):'未使用箱號',text(line.itemCode),text(line.productName),quantity,sn,text(line.allocationId),text(line.contentRevision),text(line.sourceLineId),text(line.sourceSKU)
  ]);
 }
 if(!Array.isArray(payload.totals)||payload.totals.some(total=>!Number.isSafeInteger(total.quantity)||total.quantity<0||(byCode.get(total.itemCode)?.quantity||0)!==total.quantity||JSON.stringify([...(byCode.get(total.itemCode)?.actualSN||[])].sort())!==JSON.stringify([...(total.actualSN||[])].sort()))||[...byCode.keys()].some(code=>!payload.totals.some(total=>total.itemCode===code)))fail('已裝箱明細與商品合計不一致，未產生檔案');
 return {name:'已裝箱對照',headers,rows,notes:cartonTraceNotes(payload,'當次實際已裝箱內容與原 ECOUNT 單據核對；不可作為新的銷貨匯入檔')};
}
