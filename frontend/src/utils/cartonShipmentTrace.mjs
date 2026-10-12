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
   const key=JSON.stringify([a.allocationId,line.lineId]);
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
