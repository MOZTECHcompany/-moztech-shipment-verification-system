const validId=value=>Number.isSafeInteger(Number(value))&&Number(value)>0;
const voucher=value=>typeof value==='string'&&value.length<=100&&Boolean(value.trim())&&!/[\u0000-\u001f\u007f]/.test(value);
// Capability checks let the formal legacy schema return truthful blank refs.
// This helper reads only the exact order -> source batch -> persisted ERP receipt.
async function readCartonShipmentReferences(db,order={}) {
 const result={batchNumber:null,ecountVouchers:[],ecountVerificationKind:null};
 if(!validId(order.id))return result;
 const schema=(await db.query(`SELECT
  to_regclass(format('%I.warehouse_import_batches',current_schema())) AS batches,
  to_regclass(format('%I.marketplace_work_order_links',current_schema())) AS links,
  to_regclass(format('%I.marketplace_intake_orders',current_schema())) AS sources,
  to_regclass(format('%I.marketplace_warehouse_flows',current_schema())) AS flows`)).rows[0]||{};
 if(schema.batches&&validId(order.import_batch_id)) {
  const batch=(await db.query('SELECT voucher_number FROM warehouse_import_batches WHERE id=$1',[Number(order.import_batch_id)])).rows[0];
  if(voucher(batch?.voucher_number))result.batchNumber=batch.voucher_number;
 }
 if(!schema.links||!schema.sources||!schema.flows)return result;
 const linked=(await db.query(`SELECT s.intake_id,f.erp_receipt FROM marketplace_work_order_links l
  JOIN marketplace_intake_orders s ON s.id=l.intake_order_id
  JOIN marketplace_warehouse_flows f ON f.intake_id=s.intake_id WHERE l.order_id=$1`,[Number(order.id)])).rows;
 if(!linked.length)return result;
 // Never merge unrelated source batches or silently pick the first join result.
 if(new Set(linked.map(row=>String(row.intake_id))).size!==1)return {...result,referenceWarning:'來源批次關聯不唯一，ECOUNT單號留空待核對'};
 const receipts=linked.map(row=>row.erp_receipt).filter(Boolean);
 if(receipts.length!==1)return {...result,referenceWarning:'原ECOUNT回執尚未核對或關聯重複'};
 const receipt=receipts[0];
 if(typeof receipt!=='object'||Array.isArray(receipt)||!/^[a-f0-9]{64}$/.test(receipt.fingerprint||'')||!['sales-receipt','warehouse-return'].includes(receipt.verificationKind)||!Array.isArray(receipt.vouchers)||!receipt.vouchers.length||receipt.vouchers.some(value=>!voucher(value)||value===result.batchNumber))return {...result,referenceWarning:'原ECOUNT回執資料不完整，單號留空待核對'};
 // A batch can contain several saved sales vouchers. Only exact source line
 // identities and quantities prove which of them belong to this work order.
 const source=[order.source_platform,order.source_store,order.source_order_number];
 if(source.some(value=>!voucher(value))||!Array.isArray(receipt.lines))return {...result,referenceWarning:'僅有批次銷貨單號，尚未按此訂單明細核對，ECOUNT單號留空'};
 const items=(await db.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY id',[Number(order.id)])).rows;
 if(!items.length||items.some(item=>!voucher(item.source_line_id)||!voucher(item.product_code)||!Number.isSafeInteger(item.quantity)||item.quantity<0||Number(item.quantity_sign??1)!==1))return {...result,referenceWarning:'來源明細身分不完整，ECOUNT單號留空待核對'};
 const expected=new Map();
 for(const item of items){const key=JSON.stringify([item.source_line_id,item.product_code]);expected.set(key,(expected.get(key)||0)+item.quantity);}
 const matches=receipt.lines.filter(line=>Array.isArray(line?.identity)&&line.identity.length===4&&line.identity.slice(0,3).every((value,index)=>value===source[index]));
 const actual=new Map(),vouchers=[];
 for(const line of matches){
  if(!voucher(line.identity[3])||!voucher(line.productCode)||!Number.isSafeInteger(line.quantity)||line.quantity<1||!receipt.vouchers.includes(line.voucher))return {...result,referenceWarning:'原ECOUNT回執明細無法精確對應，單號留空待核對'};
  const key=JSON.stringify([line.identity[3],line.productCode]);actual.set(key,(actual.get(key)||0)+line.quantity);vouchers.push(line.voucher);
 }
 if(actual.size!==expected.size||[...expected].some(([key,quantity])=>actual.get(key)!==quantity))return {...result,referenceWarning:'原ECOUNT回執與此訂單的來源明細或數量不符，單號留空待核對'};
 result.ecountVouchers=[...new Set(vouchers)].sort();
 result.ecountVerificationKind=receipt.verificationKind;
 return result;
}
module.exports={readCartonShipmentReferences};
