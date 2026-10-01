const express=require('express');
const {readFlow,mutateFlow,manager}=require('../services/warehouseRelease');
const {validId}=require('../services/marketplaceBatchManagement');
const shippingFields=['recipient','phone','address','postalCode','method','storeName','storeCode','trackingNumber','note'];
function warehouseShipping(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return {};
 return Object.fromEntries(shippingFields.filter(key=>typeof value[key]==='string'&&value[key].trim()).map(key=>[key,value[key].replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim().slice(0,1000)]));
}
function publicWarehouseData(data,user){
 const {snapshot,...batch}=data.batch;
 const sourceOrders=new Map((snapshot?.orders||[]).map(o=>[JSON.stringify([o.sourcePlatform||batch.source_platform,o.sourceOrderNumber]),o]));
 const orders=data.orders.map(({financial,nonstock_items,...o})=>({...o,shipping:warehouseShipping(sourceOrders.get(JSON.stringify([o.source_platform,o.source_order_number]))?.shipping)}));
 const flow=!manager(user)&&data.flow?.erp_receipt?{...data.flow,erp_receipt:{vouchers:data.flow.erp_receipt.vouchers}}:data.flow;
 const events=manager(user)?data.events:data.events.map(({details,...e})=>e);
 return {...data,batch:{...batch,handler:snapshot?.handler,projectOwner:snapshot?.settings?.projectOwner,salesOwner:snapshot?.settings?.salesOwner},orders,flow,events};
}
function createWarehouseReleaseRouter({pool}){
 const router=express.Router();
 const handle=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){if(e.status)return res.status(e.status).json({message:e.message});next(e);}};
 router.get('/',handle(async(req,res)=>{
  const rows=(await pool.query(`SELECT i.id,i.batch_number,i.source_platform,i.source_store,f.erp_confirmed_at,f.printed_at,f.prepick_completed_at,u.name AS prepick_owner_name,
   (SELECT COUNT(*)::int FROM marketplace_intake_orders o WHERE o.intake_id=i.id) AS order_count,
   (SELECT COALESCE(SUM((item->>'quantity')::int),0)::int FROM marketplace_intake_orders o CROSS JOIN LATERAL jsonb_array_elements(o.expected_items) item WHERE o.intake_id=i.id) AS total_quantity
   FROM marketplace_warehouse_flows f JOIN marketplace_intakes i ON i.id=f.intake_id LEFT JOIN users u ON u.id=f.prepick_owner_id
   WHERE i.archived_at IS NULL AND (NOT $3::boolean OR (f.erp_confirmed_at IS NOT NULL AND f.prepick_completed_at IS NULL)) AND ($1::boolean OR (f.prepick_owner_id=$2 AND f.prepick_completed_at IS NULL))
   ORDER BY i.id DESC LIMIT 100`,[manager(req.user),req.user.id,req.query.ready==='1'])).rows;
  res.set('Cache-Control','private, no-store').json({batches:rows});
 }));
 router.get('/staff',handle(async(req,res)=>{
  if(!manager(req.user))return res.status(403).json({message:'無指派權限'});
  res.json({staff:(await pool.query("SELECT id,name,role FROM users WHERE role IN ('picker','packer','admin','superadmin') ORDER BY name,id")).rows});
 }));
 router.get('/receipt-format',handle(async(req,res)=>{
  if(!manager(req.user))return res.status(403).json({message:'無轉檔權限'});
  const xlsx=require('xlsx'),book=xlsx.utils.book_new();xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet([require('../services/erpSalesReceipt').HEADERS]),'銷貨回傳欄位');
  res.set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="ECOUNT-sales-return-columns.xlsx"'}).send(xlsx.write(book,{type:'buffer',bookType:'xlsx'}));
 }));
 router.get('/:id',handle(async(req,res)=>{
  if(!validId(req.params.id))return res.status(400).json({message:'批次編號無效'});
  const data=await readFlow(pool,req.params.id);
  // Staff see physical work and responsibility; accounting evidence stays with dispatch/admin.
  res.set('Cache-Control','private, no-store').json(publicWarehouseData(data,req.user));
 }));
 router.post('/:id/:action',handle(async(req,res)=>{
  const result=await mutateFlow(pool,req.params.id,req.params.action,req.body||{},req.user);
  if(req.params.action==='complete'&&!result.reused){
   const data=await readFlow(pool,req.params.id);
   for(const o of data.orders)req.app.get('io')?.emit('new_task',{id:o.order_id,status:o.status,task_type:'pick',work_barcode:o.work_barcode,source_order_number:o.source_order_number,source_platform:o.source_platform,source_store:o.source_store,import_batch_id:data.flow.import_batch_id});
  }
  req.app.get('io')?.emit('warehouse_tasks_changed',{intakeId:Number(req.params.id)});
  res.json(result);
 }));
 return router;
}
module.exports={createWarehouseReleaseRouter,publicWarehouseData};
