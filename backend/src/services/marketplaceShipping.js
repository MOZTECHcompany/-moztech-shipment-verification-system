const {createHash}=require('node:crypto');
const {createShopifyOrderVerifier}=require('./shopifyOrderVerification');
const {deliveryForOrders}=require('./marketplacePreparation');
const {validId}=require('./marketplaceBatchManagement');
const fields=['recipient','phone','address','postalCode','method','storeName','storeCode','trackingNumber','note'];
const clean=value=>String(value??'').trim();
const fail=(message,code='MARKETPLACE_SHIPPING_NOT_AVAILABLE',status=409)=>Object.assign(new Error(message),{status,code});
function canonical(value){
 if(Object.prototype.toString.call(value)==='[object Date]')return value.toISOString();
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function shipping(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw fail('原訂單收件資料無法核對');
 return Object.fromEntries(fields.map(key=>{
  const text=value[key]??'';
  if(typeof text!=='string'||text.length>1000||/[\u0000-\u001f\u007f]/.test(text))throw fail('收件資料格式無法核對');
  return [key,text.trim()];
 }));
}
function input(body,user,apply=false){
 if(!validId(user?.id)||!['admin','superadmin','dispatcher'].includes(user.role))throw fail('沒有收件資料核對權限','MARKETPLACE_SHIPPING_FORBIDDEN',403);
 const allowed=apply?['orderNumber','previewFingerprint','commandId','expectedActorId']:['orderNumber'];
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!allowed.includes(key))||
  typeof body.orderNumber!=='string'||!body.orderNumber||body.orderNumber!==body.orderNumber.trim()||body.orderNumber.length>100||/[\u0000-\u001f\u007f]/.test(body.orderNumber))throw fail('請選擇原批次訂單','MARKETPLACE_SHIPPING_INVALID',400);
 if(apply&&(!/^[a-f0-9]{64}$/.test(body.previewFingerprint||'')||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.commandId||'')||body.expectedActorId!==user.id))throw fail('登入人員或核對結果已變更，請重新核對','MARKETPLACE_SHIPPING_INVALID',400);
}
function sourceRows(rows,number){
 if(!Array.isArray(rows)||!Array.isArray(rows[0]))throw fail('原批次缺少 Shopify 來源檔，請由主管核對');
 const name=rows[0].indexOf('Name');if(name<0)throw fail('原批次缺少 Shopify 訂單編號');
 let previous='';const selected=[];
 for(const row of rows.slice(1)){
  if(!Array.isArray(row))throw fail('原批次來源檔格式無效');
  if(!row.some(value=>clean(value)))continue;
  const current=clean(row[name])||previous;previous=current;
  if(current===number)selected.push([...row]);
 }
 if(!selected.length)throw fail('原批次來源檔找不到這筆訂單');
 return [[...rows[0]],...selected];
}
const moneyFields=['subtotalMinor','shippingMinor','discountMinor','productDiscountMinor','shippingGrossMinor','shippingDiscountMinor','shippingCancellationMinor','totalMinor','outstandingMinor','receivedMinor'];
const splitMoneyFields=['productDiscountMinor','shippingGrossMinor','shippingDiscountMinor','shippingCancellationMinor'];
function businessShape(evidence,legacy=false){
 const requiredMoney=legacy?moneyFields.filter(key=>!splitMoneyFields.includes(key)):moneyFields;
 if(!evidence||typeof evidence.id!=='string'||!/^\d{1,25}$/.test(evidence.id)||!Array.isArray(evidence.items)||!evidence.items.length||
  requiredMoney.some(key=>!Number.isSafeInteger(evidence[key])||evidence[key]<0)||!Number.isSafeInteger(evidence.currentQuantity)||!Number.isSafeInteger(evidence.remainingQuantity)||
  !legacy&&!Array.isArray(evidence.shippingLines)||!Array.isArray(evidence.removedLineIds))throw fail('原訂單商品與金額證據不完整，請由主管核對');
 const items=evidence.items.map(item=>{
  if(typeof item.id!=='string'||!item.id||typeof item.sku!=='string'||!item.sku||!Number.isSafeInteger(item.quantity)||item.quantity<1||
   !Number.isSafeInteger(item.unfulfilledQuantity)||!Number.isSafeInteger(item.netMinor))throw fail('原訂單商品與金額證據不完整，請由主管核對');
  return {id:item.id,sku:item.sku,quantity:item.quantity,unfulfilledQuantity:item.unfulfilledQuantity,netMinor:item.netMinor,variantId:item.variantId||'',barcode:item.barcode||''};
 }).sort((a,b)=>a.id.localeCompare(b.id));
 if(new Set(items.map(item=>item.id)).size!==items.length)throw fail('原訂單來源明細重複，請由主管核對');
 return {number:evidence.number,id:evidence.id,currency:evidence.currency,cancelled:evidence.cancelled,cancelledAt:evidence.cancelledAt,
  paymentStatus:evidence.paymentStatus,fulfillmentStatus:evidence.fulfillmentStatus,currentQuantity:evidence.currentQuantity,remainingQuantity:evidence.remainingQuantity,
  ...Object.fromEntries(requiredMoney.map(key=>[key,evidence[key]])),items,removedLineIds:[...evidence.removedLineIds].sort(),
  ...(!legacy?{shippingLines:evidence.shippingLines.map(line=>({id:line.id,removed:line.removed,originalMinor:line.originalMinor,currentMinor:line.currentMinor})).sort((a,b)=>a.id.localeCompare(b.id))}:{})};
}
function business(evidence){return businessShape(evidence);}
function savedBusiness(verification,evidence,order,source,items){
 if(verification.version==='shopify-current-v2')return business(evidence);
 if(verification.version!=='shopify-current-v1'||[...splitMoneyFields,'shippingLines'].some(key=>Object.hasOwn(evidence,key)))throw fail('原訂單核對版本無法安全核對，請由主管處理');
 const old=businessShape(evidence,true),financials=[order.financial,order.sourceFinancial,source.financial?.source,source.financial?.ecount];
 const financialKeys=['subtotalMinor','shippingMinor','discountMinor','totalMinor','outstandingMinor'];
 if(old.currency!=='TWD'||old.cancelled!==false||old.cancelledAt!==null||old.fulfillmentStatus!=='unfulfilled'||!['paid','pending'].includes(old.paymentStatus)||
  old.currentQuantity<1||old.currentQuantity!==old.remainingQuantity||financials.some(financial=>!financial||financial.currency!=='TWD'||financial.taxMinor!==0||financial.refundedMinor!==0||financialKeys.some(key=>financial[key]!==old[key])))
  throw fail('原訂單金額或狀態證據不一致','MARKETPLACE_SHIPPING_BUSINESS_CHANGED');
 let gross=0,net=0,quantity=0;
 for(const item of items){
  if(!Number.isSafeInteger(item.unitPriceMinor)||item.unitPriceMinor<0||!Number.isSafeInteger(item.lineSubtotalMinor)||item.lineSubtotalMinor<0||
   !Number.isSafeInteger(item.lineDiscountMinor)||item.lineDiscountMinor<0||!Number.isSafeInteger(item.quantity)||item.quantity<1)throw fail('原訂單缺少可核對的商品原價與折扣');
  const lineGross=item.unitPriceMinor*item.quantity;
  if(!Number.isSafeInteger(lineGross)||lineGross-item.lineSubtotalMinor!==item.lineDiscountMinor)throw fail('原訂單商品原價、折扣與金額不一致','MARKETPLACE_SHIPPING_BUSINESS_CHANGED');
  gross+=lineGross;net+=item.lineSubtotalMinor;quantity+=item.quantity;
 }
 if(![gross,net,quantity,old.subtotalMinor+old.shippingMinor,old.outstandingMinor+old.receivedMinor].every(Number.isSafeInteger)||
  net!==old.subtotalMinor||gross-net!==old.discountMinor||old.subtotalMinor+old.shippingMinor!==old.totalMinor||old.outstandingMinor+old.receivedMinor!==old.totalMinor||
  quantity!==old.currentQuantity||old.items.some(item=>item.quantity!==item.unfulfilledQuantity))throw fail('原訂單商品與付款金額不一致','MARKETPLACE_SHIPPING_BUSINESS_CHANGED');
 // v1 accepted only gross-minus-product-net == the complete order discount.
 // Its saved item amounts therefore prove zero shipping discount. Historical
 // shipping-line identities were never stored and are not fabricated here.
 return {...old,productDiscountMinor:gross-net,shippingGrossMinor:old.shippingMinor,shippingDiscountMinor:0,shippingCancellationMinor:0};
}
function savedShippingBaseline(batch,source,profiles,number){
  const snapshot=batch.snapshot,orders=snapshot?.orders?.filter(order=>order.sourceOrderNumber===number);
  if(orders?.length!==1||orders[0].sourcePlatform!=='Shopify'||snapshot.settings?.store!==batch.source_store)throw fail('原訂單平台或店鋪不一致');
  if(!source||source.source_platform!=='Shopify'||source.source_store!==batch.source_store)throw fail('原批次找不到這筆 Shopify 訂單');
  const verification=snapshot.sourceEvidence?.verification,old=verification?.orders?.filter(order=>order.number===number);
  if(verification?.platform!=='Shopify'||old?.length!==1||snapshot.settings.shopifyShop!==verification.shop)throw fail('原批次缺少可核對的 Shopify 店鋪或訂單證據');
  if(profiles.length!==1||profiles[0].settings?.shopifyShop!==verification.shop||profiles[0].settings.store!==batch.source_store)throw fail('店鋪連線設定已變更，請由主管核對');
  const items=(snapshot.items||[]).filter(item=>item.sourceOrderNumber===number);
  const expected=new Map((source.expected_items||[]).map(item=>[item.sourceLineId,item]));
  if(!items.length||expected.size!==items.length||items.some(item=>{const original=expected.get(item.sourceLineId);return !original||original.sourceSku!==item.sku||original.quantity!==item.quantity||original.productCode!==snapshot.settings.skuMappings?.[item.sku]?.erpSku;}))throw fail('原訂單商品或數量已變更','MARKETPLACE_SHIPPING_BUSINESS_CHANGED');
  const oldBusiness=savedBusiness(verification,old[0],orders[0],source,items);
  if(orders[0].financial?.totalMinor!==oldBusiness.totalMinor||oldBusiness.items.length!==items.length||items.some(item=>{
   const original=oldBusiness.items.find(line=>line.id===item.sourceLineId);return !original||original.sku!==item.sku||original.quantity!==item.quantity||original.netMinor!==item.lineSubtotalMinor;
  }))throw fail('原訂單金額或商品證據不一致','MARKETPLACE_SHIPPING_BUSINESS_CHANGED');
 return {batch,source,order:orders[0],verification,oldBusiness,profile:profiles[0]};
}
function assertCurrentBusiness(saved,verification,evidence){
 if(verification?.shop!==saved.verification.shop||evidence?.number!==saved.oldBusiness.number)throw fail('Shopify 店鋪或原訂單身分已變更','MARKETPLACE_SHIPPING_BUSINESS_CHANGED');
 if(verification.version!=='shopify-current-v2')throw fail('Shopify 目前核對證據版本不完整，請重新核對');
 const fresh=business(evidence);
 const compared={...fresh};if(saved.verification.version==='shopify-current-v1')delete compared.shippingLines;
 if(fresh.cancelled!==false||fresh.cancelledAt||fresh.fulfillmentStatus!=='unfulfilled'||fresh.currentQuantity!==fresh.remainingQuantity||!['paid','pending'].includes(fresh.paymentStatus)||hash(compared)!==hash(saved.oldBusiness))
   throw fail('商品、數量、金額或訂單狀態已變更，請核對原銷貨單','MARKETPLACE_SHIPPING_BUSINESS_CHANGED');
 return fresh;
}
function assertAvailable(context){
 const {flow,tasks,link,activity}=context;
 if(!tasks.length&&(flow?.printed_at||flow?.prepick_completed_at||flow?.prepick_owner_id||Object.values(flow?.prepick_counts||{}).some(value=>Number(value)>0)))throw fail('此批已開始倉庫作業，請由主管處理原訂單','MARKETPLACE_SHIPPING_BUSY');
 if(link&&(!link.order_id||tasks.length!==1||tasks[0].id!==link.order_id)||tasks.length&&!link)throw fail('原工作單關聯已變更，請由主管核對','MARKETPLACE_SHIPPING_BUSY');
 if(flow?.erp_confirmed_at&&(!flow.import_batch_id||!link))throw fail('已核對的 ERP 工作單關聯不完整，請由主管核對','MARKETPLACE_SHIPPING_BUSY');
 if(tasks.some(task=>task.status!=='pending'||task.picker_id||task.packer_id||task.completed_at)||activity.progress||activity.history||activity.labels||activity.changes)
  throw fail('原訂單已作業、作廢或建立物流單，請由主管處理','MARKETPLACE_SHIPPING_BUSY');
}
function createMarketplaceShippingService({pool,verifyShopify=createShopifyOrderVerifier()}={}){
 async function context(db,id,number,lock=false){
  if(!validId(id))throw fail('批次編號無效','MARKETPLACE_SHIPPING_INVALID',400);
  const batch=(await db.query('SELECT * FROM marketplace_intakes WHERE id=$1'+(lock?' FOR UPDATE':''),[Number(id)])).rows[0];
  if(!batch)throw fail('找不到原批次','MARKETPLACE_SHIPPING_NOT_FOUND',404);
  if(batch.archived_at||batch.source_platform!=='Shopify')throw fail('請從未封存的 Shopify 原批次核對收件資料');
  const source=(await db.query('SELECT * FROM marketplace_intake_orders WHERE intake_id=$1 AND source_order_number=$2'+(lock?' FOR UPDATE':''),[Number(id),number])).rows[0];
  const profiles=(await db.query("SELECT id,platform,store,settings FROM marketplace_store_profiles WHERE platform='Shopify' AND store=$1"+(lock?' FOR SHARE':''),[batch.source_store])).rows;
  const baseline=savedShippingBaseline(batch,source,profiles,number);
  const flow=(await db.query('SELECT * FROM marketplace_warehouse_flows WHERE intake_id=$1'+(lock?' FOR UPDATE':''),[Number(id)])).rows[0]||null;
  const link=(await db.query('SELECT * FROM marketplace_work_order_links WHERE intake_order_id=$1'+(lock?' FOR UPDATE':''),[source.id])).rows[0]||null;
  const tasks=(await db.query('SELECT id,status,picker_id,packer_id,completed_at FROM orders WHERE source_platform=$1 AND source_store=$2 AND source_order_number=$3 ORDER BY id'+(lock?' FOR UPDATE':''),['Shopify',batch.source_store,number])).rows;
  const taskIds=tasks.map(task=>task.id);
  const activity=(await db.query(`SELECT
   EXISTS(SELECT 1 FROM order_items i LEFT JOIN order_item_instances s ON s.order_item_id=i.id WHERE i.order_id=ANY($1::int[]) AND (i.picked_quantity>0 OR i.packed_quantity>0 OR s.status IN ('picked','packed'))) AS progress,
   EXISTS(SELECT 1 FROM operation_logs WHERE order_id=ANY($1::int[]) AND action_type IN ('claim','pick','pack','scan_error','void','defect_exchange')) AS history,
   EXISTS(SELECT 1 FROM wms_logistics_shipments WHERE order_id=ANY($1::int[])) AS labels,
   EXISTS(SELECT 1 FROM order_exceptions WHERE order_id=ANY($1::int[]) AND type='order_change' AND status='open') AS changes`,[taskIds])).rows[0]||{};
  const value={...baseline,flow,link,tasks,activity};assertAvailable(value);
  const targetEvidence={...baseline.verification,orders:baseline.verification.orders.filter(order=>order.number===number)};
  // Other orders can be printed, picked or have their contact corrected while
  // this pending target is reviewed. Keep only target and ERP-link evidence.
  delete targetEvidence.currentFingerprint;
  value.sourceFingerprint=hash({batchId:batch.id,fingerprint:batch.fingerprint,archivedAt:batch.archived_at,
   platform:batch.source_platform,store:batch.source_store,settings:batch.snapshot.settings,
   order:baseline.order,items:batch.snapshot.items.filter(item=>item.sourceOrderNumber===number),
   evidence:targetEvidence,rows:sourceRows(batch.snapshot.sourceEvidence.rows,number),source,
   flow:flow?{erp_confirmed_at:flow.erp_confirmed_at,import_batch_id:flow.import_batch_id}:null,link,tasks,activity,profile:profiles[0]});
  return value;
 }
 async function current(saved,number){
  const rows=sourceRows(saved.batch.snapshot.sourceEvidence.rows,number);
  const result=await verifyShopify(rows),verification=result.verification,evidence=verification?.orders?.filter(order=>order.number===number);
  if(verification?.shop!==saved.verification.shop||evidence?.length!==1||verification.orders.length!==1)throw fail('Shopify 店鋪或原訂單身分已變更','MARKETPLACE_SHIPPING_BUSINESS_CHANGED');
  const fresh=assertCurrentBusiness(saved,verification,evidence[0]);
  if(evidence[0].shippingSource!=='shopify-current')throw fail('Shopify 尚無可核對的收件資料，請先在商城修正');
  const currentRows=sourceRows(result.rows,number);
  if(['Shipping Name','Shipping Phone','Shipping Address1'].some(field=>{
   const column=currentRows[0].indexOf(field);return column<0||!currentRows.slice(1).some(row=>clean(row[column]));
  }))throw fail('Shopify 收件人、電話或地址不完整，請先在商城修正');
  const {parseUnifiedMarketplace}=await import('./unifiedMarketplace.mjs');
  const parsed=parseUnifiedMarketplace(result.rows);
  const delivered=deliveryForOrders(parsed.source,parsed.parsed).orders;
  if(delivered.length!==1||delivered[0].sourceOrderNumber!==number)throw fail('Shopify 收件資料未完整對應原訂單');
  const method=[...new Set(evidence[0].shippingLines.filter(line=>!line.removed).map(line=>clean(line.title)).filter(Boolean))].join(' / ');
  const previousShipping=shipping(saved.order.shipping),currentShipping=shipping({...previousShipping,...delivered[0].shipping,method});
  if(['recipient','phone','address'].some(key=>!currentShipping[key]))throw fail('Shopify 收件人、電話或地址不完整，請先在商城修正');
  const changedFields=fields.filter(key=>previousShipping[key]!==currentShipping[key]);
  return {intakeId:Number(saved.batch.id),orderNumber:number,previousShipping,currentShipping,changed:changedFields.length>0,changedFields,
   sourceFingerprint:saved.sourceFingerprint,previewFingerprint:hash({sourceFingerprint:saved.sourceFingerprint,shipping:currentShipping,business:fresh,updatedAt:evidence[0].updatedAt,fingerprint:evidence[0].fingerprint})};
 }
 async function preview(id,body,user){input(body,user);const saved=await context(pool,id,body.orderNumber);return current(saved,body.orderNumber);}
 async function commandReceipt(body,user,requestHash){
  const db=await pool.connect();let open=false,tainted=false;
  try{
   await db.query('BEGIN');open=true;await db.query("SET LOCAL lock_timeout='3000ms'");await db.query("SET LOCAL statement_timeout='15000ms'");
   await db.query("SELECT pg_advisory_xact_lock(hashtext('wms-warehouse-command'),hashtext($1))",[`${user.id}:${body.commandId}`]);
   const previous=(await db.query('SELECT * FROM marketplace_warehouse_commands WHERE actor_id=$1 AND command_id=$2',[user.id,body.commandId])).rows[0];
   if(previous&&previous.request_hash!==requestHash)throw fail('同一操作識別不可用於不同內容','MARKETPLACE_SHIPPING_CHANGED');
   await db.query('ROLLBACK');open=false;return previous?{...previous.response,reused:true}:null;
  }catch(error){
   if(open)try{await db.query('ROLLBACK');}catch{tainted=true;}
   if(tainted)throw fail('暫時無法確認操作紀錄，請保留同一操作識別重試','MARKETPLACE_SHIPPING_UNAVAILABLE',503);
   if(['55P03','57014'].includes(error.code))throw fail('原訂單正在處理，請保留同一操作識別重試','MARKETPLACE_SHIPPING_CHANGED');
   throw error;
  }finally{db.release(tainted);}
 }
 async function apply(id,body,user){
  input(body,user,true);
  if(!validId(id))throw fail('批次編號無效','MARKETPLACE_SHIPPING_INVALID',400);
  const requestHash=hash([String(id),'shipping-update',body]);
  // A committed receipt survives later work and API outages. Read it under the
  // same actor-command lock before any fresh network or workflow checks.
  const completed=await commandReceipt(body,user,requestHash);if(completed)return completed;
  const saved=await context(pool,id,body.orderNumber),fresh=await current(saved,body.orderNumber);
  const db=await pool.connect();let open=false,commit=false,tainted=false;
  try{
   await db.query('BEGIN');open=true;await db.query("SET LOCAL lock_timeout='3000ms'");await db.query("SET LOCAL statement_timeout='15000ms'");
   await db.query("SELECT pg_advisory_xact_lock(hashtext('wms-warehouse-command'),hashtext($1))",[`${user.id}:${body.commandId}`]);
   const previous=(await db.query('SELECT * FROM marketplace_warehouse_commands WHERE actor_id=$1 AND command_id=$2',[user.id,body.commandId])).rows[0];
   if(previous){if(previous.request_hash!==requestHash)throw fail('同一操作識別不可用於不同內容','MARKETPLACE_SHIPPING_CHANGED');await db.query('ROLLBACK');open=false;return {...previous.response,reused:true};}
   if(body.previewFingerprint!==fresh.previewFingerprint)throw fail('收件資料或核對結果已更新，請重新核對','MARKETPLACE_SHIPPING_CHANGED');
   await db.query("SELECT pg_advisory_xact_lock(hashtext('wms-marketplace-source'),hashtext($1))",[JSON.stringify(['Shopify',saved.batch.source_store,body.orderNumber])]);
   const locked=await context(db,id,body.orderNumber,true);
   if(locked.sourceFingerprint!==saved.sourceFingerprint)throw fail('原批次或工作狀態已更新，請重新核對','MARKETPLACE_SHIPPING_CHANGED');
   if(fresh.changed){
    const index=locked.batch.snapshot.orders.findIndex(order=>order.sourceOrderNumber===body.orderNumber);
    await db.query('UPDATE marketplace_intakes SET snapshot=jsonb_set(snapshot,$2::text[],$3::jsonb,true) WHERE id=$1',[Number(id),['orders',String(index),'shipping'],JSON.stringify(fresh.currentShipping)]);
    await db.query('INSERT INTO marketplace_warehouse_events(intake_id,actor_id,action,details) VALUES($1,$2,$3,$4::jsonb)',[Number(id),user.id,'shipping-update',JSON.stringify({orderNumber:body.orderNumber,source:'shopify-current',before:fresh.previousShipping,after:fresh.currentShipping,changedFields:fresh.changedFields,sourceFingerprint:saved.sourceFingerprint,previewFingerprint:fresh.previewFingerprint})]);
   }
   const response={ok:true,intakeId:Number(id),orderNumber:body.orderNumber,updated:fresh.changed,changedFields:fresh.changedFields};
   await db.query('INSERT INTO marketplace_warehouse_commands(actor_id,command_id,request_hash,response) VALUES($1,$2,$3,$4::jsonb)',[user.id,body.commandId,requestHash,JSON.stringify(response)]);
   commit=true;await db.query('COMMIT');open=false;return response;
  }catch(error){
   if(open)try{await db.query('ROLLBACK');}catch{tainted=true;}
   if(commit||tainted)throw fail('更新結果尚未確認，請保留同一操作識別重試或重新讀取原批次','MARKETPLACE_SHIPPING_RESULT_UNKNOWN',503);
   if(['55P03','57014','23505'].includes(error.code))throw fail('原訂單正在處理，請重新讀取後核對','MARKETPLACE_SHIPPING_CHANGED');
   throw error;
  }finally{db.release(tainted);}
 }
 return {preview,apply};
}
module.exports={createMarketplaceShippingService,sourceRows,business,savedShippingBaseline,assertCurrentBusiness,assertAvailable};
