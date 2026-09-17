const {createHash}=require('node:crypto');
const {createWorkBarcode}=require('./warehouseBatch');
const {reconcileSales}=require('./erpSalesReceipt');
const manager=user=>['admin','superadmin','dispatcher'].includes(user.role);
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const productKey=i=>JSON.stringify([i.productCode,i.barcode]);
function products(orders){
 const result=new Map();
 for(const o of orders)for(const i of o.expected_items){const key=productKey(i);if(!result.has(key))result.set(key,{key,productCode:i.productCode,productName:i.productName,barcode:i.barcode,quantity:0});result.get(key).quantity+=i.quantity;}
 return [...result.values()].sort((a,b)=>a.productCode.localeCompare(b.productCode));
}
async function enableFlow(db,id,actor){
 const linked=(await db.query('SELECT 1 FROM marketplace_intake_orders o JOIN marketplace_work_order_links l ON l.intake_order_id=o.id WHERE o.intake_id=$1 LIMIT 1',[id])).rowCount;
 if(linked)throw fail('此批已有舊理貨工作單，請從原理貨批次完成；不可重新建立任務');
 await db.query('INSERT INTO marketplace_warehouse_flows(intake_id,enabled_by) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,actor]);
 const orders=(await db.query('SELECT id FROM marketplace_intake_orders WHERE intake_id=$1 AND work_barcode IS NULL ORDER BY id',[id])).rows;
 for(const o of orders)await db.query('UPDATE marketplace_intake_orders SET work_barcode=$2 WHERE id=$1',[o.id,createWorkBarcode()]);
}
async function readFlow(db,id){
 const batch=(await db.query('SELECT id,batch_number,source_platform,source_store,created_at,created_by,snapshot FROM marketplace_intakes WHERE id=$1',[id])).rows[0];
 if(!batch)throw fail('找不到批次',404);
 const flow=(await db.query(`SELECT f.*,p.name AS print_owner_name,u.name AS prepick_owner_name,c.name AS erp_confirmed_name FROM marketplace_warehouse_flows f
 LEFT JOIN users p ON p.id=f.print_owner_id LEFT JOIN users u ON u.id=f.prepick_owner_id LEFT JOIN users c ON c.id=f.erp_confirmed_by WHERE f.intake_id=$1`,[id])).rows[0]||null;
 const orders=(await db.query(`SELECT s.*,l.order_id,w.status,w.picker_id,w.packer_id,p.name AS picker_name,k.name AS packer_name
 FROM marketplace_intake_orders s LEFT JOIN marketplace_work_order_links l ON l.intake_order_id=s.id LEFT JOIN orders w ON w.id=l.order_id
 LEFT JOIN users p ON p.id=w.picker_id LEFT JOIN users k ON k.id=w.packer_id WHERE s.intake_id=$1 ORDER BY s.id`,[id])).rows;
 const snStats=(await db.query(`SELECT i.order_id,i.source_line_id,COUNT(s.id)::int AS sn_count FROM order_items i
 LEFT JOIN order_item_instances s ON s.order_item_id=i.id WHERE i.order_id=ANY($1::int[]) GROUP BY i.id`,[orders.filter(o=>o.order_id).map(o=>o.order_id)])).rows;
 const snMap=new Map(snStats.map(i=>[JSON.stringify([i.order_id,i.source_line_id]),i.sn_count]));
 for(const o of orders)o.expected_items=o.expected_items.map(i=>({...i,snCount:snMap.get(JSON.stringify([o.order_id,i.sourceLineId]))||0}));
 const events=(await db.query('SELECT e.action,e.created_at,u.name AS actor_name,e.details FROM marketplace_warehouse_events e LEFT JOIN users u ON u.id=e.actor_id WHERE intake_id=$1 ORDER BY e.id DESC LIMIT 50',[id])).rows;
 return {batch,flow,orders,products:products(orders),events};
}
async function mutateFlow(pool,id,action,body,user){
 if(!/^[1-9]\d{0,9}$/.test(String(id))||Number(id)>2147483647)throw fail('批次編號無效',400);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.commandId||'')||body.expectedActorId!==user.id)throw fail('登入人員或操作識別已變更，請重新整理',400);
 if(!['enable','confirm-barcode','confirm-sales','print','assign','scan','reset-product','complete'].includes(action))throw fail('操作無效',400);
 if(['enable','confirm-barcode','confirm-sales','print','assign','reset-product'].includes(action)&&!manager(user))throw fail('此操作需要拋單員或管理員',403);
 const db=await pool.connect();let open=false,commit=false,tainted=false;
 try{
  await db.query('BEGIN');open=true;
  await db.query("SET LOCAL lock_timeout='3000ms'");await db.query("SET LOCAL statement_timeout='15000ms'");
  await db.query("SELECT pg_advisory_xact_lock(hashtext('wms-warehouse-command'),hashtext($1))",[`${user.id}:${body.commandId}`]);
  const fingerprint=hash([String(id),action,body]);
  const previous=(await db.query('SELECT * FROM marketplace_warehouse_commands WHERE actor_id=$1 AND command_id=$2',[user.id,body.commandId])).rows[0];
  if(previous){if(previous.request_hash!==fingerprint)throw fail('同一操作識別不可用於不同內容');await db.query('ROLLBACK');open=false;return {...previous.response,reused:true};}
  // Same source-first lock order as legacy return, save and deletion.
  const identities=(await db.query('SELECT source_platform,source_store,source_order_number FROM marketplace_intake_orders WHERE intake_id=$1',[id])).rows.map(o=>JSON.stringify([o.source_platform,o.source_store,o.source_order_number])).sort((a,b)=>a.localeCompare(b));
  for(const key of identities)await db.query("SELECT pg_advisory_xact_lock(hashtext('wms-marketplace-source'),hashtext($1))",[key]);
  if(!(await db.query('SELECT id FROM marketplace_intakes WHERE id=$1 FOR UPDATE',[id])).rowCount)throw fail('找不到批次',404);
  let f=(await db.query('SELECT * FROM marketplace_warehouse_flows WHERE intake_id=$1 FOR UPDATE',[id])).rows[0];
  if(action==='enable'&&!f){await enableFlow(db,id,user.id);f=(await db.query('SELECT * FROM marketplace_warehouse_flows WHERE intake_id=$1',[id])).rows[0];}
  if(!f)throw fail('請先啟用銷貨核對與預揀流程');
  const data=await readFlow(db,id);let details={};
  if(action==='confirm-barcode'){
   if(f.erp_confirmed_at)throw fail('銷貨已核對，不可更改作業商品條碼');
   if(body.confirmed!==true||typeof body.barcode!=='string'||!/^\x20*[!-~]{1,100}$/.test(body.barcode)||!data.orders.some(o=>o.expected_items.some(i=>i.productCode===body.productCode)))throw fail('請填寫商品實物條碼並確認',400);
   const previous=[];
   for(const o of data.orders){
    const items=o.expected_items.map(({snCount,...i})=>{if(i.productCode!==body.productCode)return i;previous.push(i.barcode);return {...i,barcode:body.barcode.trim()};});
    await db.query('UPDATE marketplace_intake_orders SET expected_items=$2 WHERE id=$1',[o.id,JSON.stringify(items)]);
   }
   details={productCode:body.productCode,barcode:body.barcode.trim(),previous,source:'staff_physical_confirmation'};
  }
  if(action==='confirm-sales'){
   if(body.savedSalesConfirmed!==true)throw fail('請確認這份檔案來自 ECOUNT 已儲存銷貨明細',400);
   await require('./marketplaceProductCatalog').verifyCatalogMappings(db,data.batch.snapshot.settings,[...new Set(data.batch.snapshot.items.map(i=>i.sku))]);
   const result=await reconcileSales(body.rows,{...data.batch,orders:data.orders}).catch(e=>{throw fail(e.message,400);});
   if(f.erp_receipt){if(f.erp_receipt.fingerprint!==result.receipt.fingerprint)throw fail('此批已核對不同的 ERP 結果，請處理原單據差異，不可覆寫或重複建單');}
   else{
    const batchId=(await db.query('INSERT INTO warehouse_import_batches(voucher_number,created_by) VALUES($1,$2) RETURNING id',[data.batch.batch_number,user.id])).rows[0].id;
    for(const source of data.orders){
     const group=result.parsed.workOrders.find(g=>g.sourceOrderNumber===source.source_order_number&&g.sourcePlatform===source.source_platform&&g.sourceStore===source.source_store);
     if(!group)throw fail('回傳缺少商城訂單');
     if((await db.query('SELECT 1 FROM orders WHERE source_platform=$1 AND source_store=$2 AND source_order_number=$3 LIMIT 1',[source.source_platform,source.source_store,source.source_order_number])).rowCount)throw fail('商城訂單已有工作單，未重複建立');
     const orderId=(await db.query(`INSERT INTO orders(voucher_number,customer_name,warehouse,status,import_batch_id,source_order_number,source_platform,source_store,work_barcode,warehouse_hold)
      VALUES($1,$2,$3,'pending',$4,$5,$6,$7,$1,TRUE) RETURNING id`,[source.work_barcode,data.batch.snapshot.settings.customerName||data.batch.source_store,data.batch.snapshot.settings.warehouseCode,batchId,source.source_order_number,source.source_platform,source.source_store])).rows[0].id;
     await db.query('INSERT INTO marketplace_work_order_links(intake_order_id,order_id) VALUES($1,$2)',[source.id,orderId]);
     for(const item of group.items){
      const itemId=(await db.query(`INSERT INTO order_items(order_id,product_code,product_name,quantity,barcode,source_order_number,source_platform,source_store,source_line_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[orderId,item.productCode,item.productName,item.quantity,item.barcode,source.source_order_number,source.source_platform,source.source_store,item.sourceLineId])).rows[0].id;
      for(const sn of item.serials)await db.query('INSERT INTO order_item_instances(order_item_id,serial_number) VALUES($1,$2)',[itemId,sn]);
     }
     await db.query("INSERT INTO operation_logs(user_id,order_id,action_type,details) VALUES($1,$2,'import',$3)",[user.id,orderId,JSON.stringify({method:'erp_sales_receipt',marketplaceIntakeId:Number(id),erpVouchers:result.receipt.vouchers,warehouseHold:true,sourceDetails:group.items.map(i=>({sourceLineId:i.sourceLineId,serials:i.serials,serialSource:i.serialSource,summary:i.sourceSummary}))})]);
    }
    await db.query('UPDATE marketplace_warehouse_flows SET erp_receipt=$2,erp_confirmed_by=$3,erp_confirmed_at=NOW(),import_batch_id=$4 WHERE intake_id=$1',[id,JSON.stringify(result.receipt),user.id,batchId]);
   }
   details={vouchers:result.receipt.vouchers,financials:result.receipt.financials};
  }
  if(['print','assign','scan','reset-product','complete'].includes(action)&&!f.erp_confirmed_at)throw fail('請先回傳 ECOUNT 已儲存銷貨明細並通過金額、數量核對');
  if(['print','complete'].includes(action)){
   const actual=(await db.query(`SELECT i.source_order_number,i.source_line_id,i.product_code,i.barcode,i.quantity,o.status
    FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.import_batch_id=$1 ORDER BY o.id,i.id`,[f.import_batch_id])).rows;
   const expected=new Map(data.orders.flatMap(o=>o.expected_items.map(i=>[JSON.stringify([o.source_order_number,i.sourceLineId]),i])));
   if(actual.length!==expected.size||actual.some(i=>{const e=expected.get(JSON.stringify([i.source_order_number,i.source_line_id]));return !e||i.status==='voided'||e.productCode!==i.product_code||e.barcode!==i.barcode||e.quantity!==i.quantity;}))throw fail('工作單已變更或作廢，與原批次不同，請先由主管核對；暫停列印與預揀放行');
  }
  if(action==='print'){
   if(data.products.some(p=>!p.barcode))throw fail('商品條碼未確認，不可列印作業單');
   if(!f.printed_at)await db.query('UPDATE marketplace_warehouse_flows SET print_owner_id=$2,printed_at=NOW() WHERE intake_id=$1',[id,user.id]);
   details={kind:body.kind==='orders'?'orders':'prepick',reprint:!!f.printed_at,printOwnerId:f.print_owner_id||user.id};
  }
  if(action==='assign'){
   if(!f.printed_at)throw fail('請先領單並列印');
   if(f.prepick_completed_at)throw fail('預揀已完成，不能變更負責人');
   const assignee=(await db.query("SELECT id FROM users WHERE id=$1 AND role IN ('picker','packer','admin','superadmin')",[Number.isSafeInteger(body.assigneeId)?body.assigneeId:0])).rows[0];
   if(!assignee)throw fail('請選擇有效的預揀人員',400);
   await db.query('UPDATE marketplace_warehouse_flows SET prepick_owner_id=$2 WHERE intake_id=$1',[id,assignee.id]);details={from:f.prepick_owner_id,to:assignee.id};
  }
  if(action==='reset-product'){
   if(f.prepick_completed_at)throw fail('預揀已放行，不可重設數量');
   if(typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>500||!data.products.some(p=>p.key===body.productKey))throw fail('請提供有效商品與重新清點原因',400);
   const counts={...f.prepick_counts};details={productKey:body.productKey,previous:counts[body.productKey]||0,reason:body.reason.trim()};counts[body.productKey]=0;
   await db.query('UPDATE marketplace_warehouse_flows SET prepick_counts=$2 WHERE intake_id=$1',[id,JSON.stringify(counts)]);
  }
  if(['scan','complete'].includes(action)){
   if(f.prepick_owner_id!==user.id)throw fail('請由本批指派的預揀人員操作',403);
   if(f.prepick_completed_at)throw fail('預揀已完成，不能重複核對');
   if(action==='scan'){
    const candidates=data.products.filter(p=>p.barcode===String(body.barcode||'').trim());
    const p=candidates.find(p=>p.key===body.productKey);
    if(!p)throw fail('此條碼不符選取的商品；請掃商品實物條碼',400);
    if(!Number.isSafeInteger(body.quantity)||body.quantity<1)throw fail('請填寫本次實點的正整數數量',400);
    const counts={...f.prepick_counts};counts[p.key]=(counts[p.key]||0)+body.quantity;
    if(counts[p.key]>p.quantity)throw fail('核對數量超過本批需求，未增加');
    await db.query('UPDATE marketplace_warehouse_flows SET prepick_counts=$2 WHERE intake_id=$1',[id,JSON.stringify(counts)]);details={productCode:p.productCode,barcode:p.barcode,quantity:body.quantity,total:counts[p.key]};
   }else{
    if(data.products.some(p=>Number(f.prepick_counts[p.key]||0)!==p.quantity))throw fail('商品尚未全部掃碼並清點完成，不能放行揀貨');
    await db.query('UPDATE marketplace_warehouse_flows SET prepick_completed_at=NOW() WHERE intake_id=$1',[id]);
    await db.query('UPDATE orders SET warehouse_hold=FALSE,updated_at=NOW() WHERE import_batch_id=$1',[f.import_batch_id]);
   }
  }
  await db.query('INSERT INTO marketplace_warehouse_events(intake_id,actor_id,action,details) VALUES($1,$2,$3,$4)',[id,user.id,action,JSON.stringify(details)]);
  const response={ok:true,intakeId:Number(id),action};
  await db.query('INSERT INTO marketplace_warehouse_commands(actor_id,command_id,request_hash,response) VALUES($1,$2,$3,$4)',[user.id,body.commandId,fingerprint,JSON.stringify(response)]);
  commit=true;await db.query('COMMIT');open=false;return response;
 }catch(e){if(open)try{await db.query('ROLLBACK');}catch{tainted=true;}
  if(commit||tainted)throw fail('操作結果尚未確認，請保留同一操作識別重試，或重新讀取批次核對',503);
  if(['55P03','57014','23505'].includes(e.code))throw fail('批次正在處理或已建立關聯，請重新讀取後再試');
  throw e;
 }finally{db.release(tainted);}
}
module.exports={enableFlow,readFlow,mutateFlow,products,manager};
