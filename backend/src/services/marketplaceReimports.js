const {createHash}=require('node:crypto');
const {validId}=require('./marketplaceBatchManagement');
const clean=value=>String(value??'').trim();
const fail=()=>Object.assign(new Error('原訂單紀錄無法完整核對，請重新讀取原批次'),{status:409,code:'MARKETPLACE_REIMPORT_UNAVAILABLE'});
function canonical(value){
 if(Object.prototype.toString.call(value)==='[object Date]')return value.toISOString();
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
const fingerprint=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

// Source ownership is permanent. A re-upload reads the original owner; it
// never moves an order into a new sales batch or infers an ECOUNT posting state.
async function classifyMarketplaceReimports({db,platform,store,raw,verification,profile,verifiedRows}){
 const numbers=[...new Set(raw.orders.map(order=>order.sourceOrderNumber))].sort();
 if(platform!=='Shopify'||!clean(store))return {reimports:[],identities:[],fingerprint:fingerprint([])};
 if(numbers.some(number=>typeof number!=='string'||!number||number.length>100)||numbers.length!==raw.orders.length)throw fail();
 const sources=(await db.query(`SELECT s.*,row_to_json(b) AS batch,row_to_json(f) AS flow,row_to_json(l) AS link
  FROM marketplace_intake_orders s JOIN marketplace_intakes b ON b.id=s.intake_id
  LEFT JOIN marketplace_warehouse_flows f ON f.intake_id=s.intake_id
  LEFT JOIN marketplace_work_order_links l ON l.intake_order_id=s.id
  WHERE s.source_platform=$1 AND s.source_store=$2 AND s.source_order_number=ANY($3::text[])
  ORDER BY s.source_order_number`,[platform,store,numbers])).rows;
 const tasks=(await db.query(`SELECT o.id,o.source_platform,o.source_store,o.source_order_number,o.status,o.picker_id,o.packer_id,o.completed_at,
  EXISTS(SELECT 1 FROM order_items i LEFT JOIN order_item_instances s ON s.order_item_id=i.id WHERE i.order_id=o.id AND (i.picked_quantity>0 OR i.packed_quantity>0 OR s.status IN ('picked','packed'))) AS progress,
  EXISTS(SELECT 1 FROM operation_logs WHERE order_id=o.id AND action_type IN ('claim','pick','pack','scan_error','void','defect_exchange')) AS history,
  EXISTS(SELECT 1 FROM wms_logistics_shipments WHERE order_id=o.id) AS labels,
  EXISTS(SELECT 1 FROM order_exceptions WHERE order_id=o.id AND type='order_change' AND status='open') AS changes
  FROM orders o WHERE o.source_platform=$1 AND o.source_store=$2 AND o.source_order_number=ANY($3::text[])
  ORDER BY o.source_order_number,o.id`,[platform,store,numbers])).rows;
 if(!Array.isArray(sources)||!Array.isArray(tasks))throw fail();
 const owned=new Map();
 for(const source of sources){
  if(!validId(source.id)||!validId(source.intake_id)||source.source_platform!==platform||source.source_store!==store||!numbers.includes(source.source_order_number)||owned.has(source.source_order_number)||
   !source.batch||Number(source.batch.id)!==Number(source.intake_id)||source.batch.source_platform!==platform||source.batch.source_store!==store)throw fail();
  owned.set(source.source_order_number,source);
 }
 for(const task of tasks)if(!validId(task.id)||task.source_platform!==platform||task.source_store!==store||!numbers.includes(task.source_order_number)||
  !['pending','picking','picked','packing','completed','voided'].includes(task.status))throw fail();
 const reimports=[],ledger=[];
 for(const number of numbers){
  const source=owned.get(number),orders=tasks.filter(task=>task.source_order_number===number);
  if(!source&&!orders.length){ledger.push({number,owner:null});continue;}
  const current=verification?.orders?.filter(order=>order.number===number);
  if(current?.length!==1)throw fail();
  const linked=source?.link,order=linked?.order_id?orders.find(task=>Number(task.id)===Number(linked.order_id)):orders.length===1?orders[0]:null;
  let state='needs_review',message='請核對原銷貨單',canUpdateShipping=false;
  if(current[0].fulfillmentStatus==='fulfilled'){state='completed';message='已出貨，請開啟原訂單';}
  else if(orders.some(task=>task.status==='completed')){state='warehouse_completed';message='裝箱已完成，請處理原訂單';}
  else if(current[0].cancelled===true||current[0].cancelledAt){state='cancelled';message='商城訂單已取消，請核對原銷貨單';}
  else if(['partial','partially_fulfilled'].includes(current[0].fulfillmentStatus)){state='partial';message='商城訂單已部分出貨，請核對原銷貨單';}
  else if(orders.some(task=>task.status==='voided')){state='voided';message='原工作單已作廢，請由主管處理';}
  else if(orders.some(task=>task.status!=='pending'||task.picker_id||task.packer_id||task.progress||task.history||task.labels||task.changes)){
   state='in_progress';message='原訂單作業中，請由主管處理';
  }else if(source&&!source.batch.archived_at&&(!linked||order)){
   state='pending';message='已保存，請開啟原訂單';
   try{
    // Use the same saved evidence and target-order guards as the update route.
    // The update route still re-reads Shopify and validates its own preview.
    const {savedShippingBaseline,assertAvailable,assertCurrentBusiness,sourceRows}=require('./marketplaceShipping');
    const baseline=savedShippingBaseline(source.batch,source,profile?[profile]:[],number);
    const activity=Object.fromEntries(['progress','history','labels','changes'].map(key=>[key,orders.some(task=>task[key]===true)]));
    assertAvailable({flow:source.flow,link:linked,tasks:orders,activity});
    assertCurrentBusiness(baseline,verification,current[0]);
    const rows=raw.orders.find(item=>item.sourceOrderNumber===number)?.shipping;
    const currentRows=sourceRows(verifiedRows,number);
    const missing=['Shipping Name','Shipping Phone','Shipping Address1'].some(field=>{
     const column=currentRows[0].indexOf(field);return column<0||!currentRows.slice(1).some(row=>clean(row[column]));
    });
    const header=verification?.version==='shopify-current-v2';
    if(current[0].shippingSource!=='shopify-current'||!header||missing||['recipient','phone','address'].some(key=>!clean(rows?.[key])))throw fail();
    canUpdateShipping=true;message='可更新原訂單收件資料';
   }catch(error){
    if(!error.status)throw error;
    message=error.code==='MARKETPLACE_SHIPPING_BUSINESS_CHANGED'?'商品或金額已變更，請核對原銷貨單':'請由原訂單核對收件資料';
   }
  }
  reimports.push({orderNumber:number,intakeId:source?Number(source.intake_id):null,workOrderId:order?Number(order.id):null,state,message,canUpdateShipping});
  ledger.push({number,source:source||null,tasks:orders,currentId:current[0].id,profile:profile||null});
 }
 return {reimports,identities:numbers.map(number=>[platform,store,number]),fingerprint:fingerprint(ledger)};
}
function newSalesSource(raw,reimports){
 const excluded=new Set(reimports.map(order=>order.orderNumber));
 return {...raw,orders:raw.orders.filter(order=>!excluded.has(order.sourceOrderNumber)),items:raw.items.filter(item=>!excluded.has(item.sourceOrderNumber)),issues:raw.issues.filter(issue=>!issue.orderNumber||!excluded.has(issue.orderNumber))};
}
module.exports={classifyMarketplaceReimports,newSalesSource};
