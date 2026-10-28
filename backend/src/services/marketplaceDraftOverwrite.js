const {createHash}=require('node:crypto');
const clean=value=>String(value??'').trim();
const clone=value=>JSON.parse(JSON.stringify(value));
const fail=(message,code='MARKETPLACE_DRAFT_CHANGED',status=409)=>Object.assign(new Error(message),{status,code});
function canonical(value){
 if(value instanceof Date)return value.toISOString();
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).filter(key=>key!=='checkedAt').sort().map(key=>[key,canonical(value[key])]));
 return value;
}
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const id=value=>Number.isSafeInteger(Number(value))&&Number(value)>0;
function actor(user){if(!id(user?.id)||!['admin','dispatcher','superadmin'].includes(user.role))throw fail('需要拋單員或管理員權限','MARKETPLACE_DRAFT_FORBIDDEN',403);return Number(user.id);}
function summary(snapshot,number,source){
 const order=snapshot.orders?.find(value=>value.sourceOrderNumber===number);
 const items=(snapshot.items||[]).filter(value=>value.sourceOrderNumber===number).map(value=>({sku:value.sku,name:value.productName,productName:value.productName,quantity:value.quantity,unitMinor:value.unitPriceMinor,lineSubtotalMinor:value.lineSubtotalMinor}));
 const fallback=source?.expected_items||[];
 return {items:items.length?items:fallback.map(value=>({sku:value.sourceSku,name:value.productName,productName:value.productName,quantity:value.quantity})),quantity:(items.length?items:fallback).reduce((n,item)=>n+item.quantity,0),totalMinor:order?.sourceFinancial?.totalMinor??order?.financial?.totalMinor??source?.financial?.source?.totalMinor??null,shipping:clone(order?.shipping||{})};
}
function changes(before,after){return ['items','quantity','totalMinor','shipping'].filter(key=>hash(before[key])!==hash(after[key])).map(field=>({field,before:before[field],after:after[field]}));}
function blockedReasons(batch,flow,activity){
 const reasons=[];
 if(batch.archived_at)reasons.push('批次已封存');
 if(!flow)reasons.push('批次作業紀錄不完整');
 if(flow){
  for(const [key,value] of Object.entries(flow))if(!['intake_id','enabled_by','enabled_at','prepick_counts'].includes(key)&&value!=null)reasons.push('批次已核對銷貨、列印或開始倉庫作業');
  if(!flow.prepick_counts||Array.isArray(flow.prepick_counts)||Object.keys(flow.prepick_counts).length)reasons.push('批次已有預揀紀錄');
 }
 if(activity?.links||activity?.tasks||activity?.imports||activity?.events)reasons.push('批次已有理貨回匯、工作單或作業紀錄');
 if(batch.snapshot?.erpReceipt||batch.snapshot?.erpConfirmedAt)reasons.push('批次已有 ERP 回傳');
 return [...new Set(reasons)];
}
function oldRaw(snapshot,numbers){
 const orders=(snapshot.orders||[]).filter(order=>numbers.has(order.sourceOrderNumber)).map(order=>{
  const copy=clone(order);
  if(!order.sourceFinancial&&(snapshot.items||[]).some(item=>item.sourceOrderNumber===order.sourceOrderNumber&&item.allocatedDiscountMinor))throw fail('舊訂單缺少原始金額，不能重新分攤');
  copy.financial=clone(order.sourceFinancial||order.financial);delete copy.sourceFinancial;return copy;
 });
 const items=(snapshot.items||[]).filter(item=>numbers.has(item.sourceOrderNumber)).map(item=>{
  const copy=clone(item);if(Number.isSafeInteger(item.sourceLineSubtotalMinor))copy.lineSubtotalMinor=item.sourceLineSubtotalMinor;
  delete copy.allocatedDiscountMinor;delete copy.sourceLineSubtotalMinor;return copy;
 });
 if(orders.length!==numbers.size)throw fail('舊批次原始訂單不完整，請核對原批次');
 return {platform:snapshot.platform,orders,items,issues:[],summary:{}};
}
function mergedRows(oldRows,newRows,keep,upload,platform){
 const field=platform==='Shopify'?'Name':platform==='1Shop'?'訂單編號':'訂單號碼';
 const headers=[...new Set([...(oldRows?.[0]||[]),...(newRows?.[0]||[])])];
 if(!headers.includes(field))throw fail('來源訂單欄位不完整');
 const result=[headers];
 for(const [rows,selected] of [[oldRows,keep],[newRows,upload]]){
  if(selected.size&&!Array.isArray(rows?.[0]))throw fail('舊批次缺少來源檔案證據');
  let previous='';
  for(const row of rows?.slice(1)||[]){const record=Object.fromEntries(rows[0].map((name,index)=>[name,row[index]??'']));const number=clean(record[field])||previous;previous=number;if(selected.has(number)){record[field]=number;result.push(headers.map(name=>record[name]??''));}}
 }
 return result;
}
async function buildSnapshot(batch,sources,conversion,decisions,user,omittedChecks){
 const snapshot=batch.snapshot,uploaded=new Set(sources.filter(source=>conversion.uploadedNumbers.has(source.source_order_number)).map(source=>source.source_order_number));
 const kept=new Set(sources.filter(source=>!uploaded.has(source.source_order_number)&&source.draft_active!==false&&decisions[source.source_order_number]==='keep').map(source=>source.source_order_number));
 const old=oldRaw(snapshot,kept),selected=conversion.raw.orders.filter(order=>uploaded.has(order.sourceOrderNumber));
 if(selected.length!==uploaded.size||[...uploaded].some(number=>!conversion.parsed.orders.some(order=>order.sourceOrderNumber===number)))throw fail('商城訂單已取消、出貨或資料變更，請重新核對');
 const raw={...old,orders:[...old.orders,...clone(selected)],items:[...old.items,...clone(conversion.raw.items.filter(item=>uploaded.has(item.sourceOrderNumber)))],issues:clone((conversion.raw.issues||[]).filter(issue=>uploaded.has(issue.orderNumber)))};
 const protectedSettings=['store','customerCode','customerName','warehouseCode','currency','taxMode','taxType','taxConfirmed','erpCurrencyCode','erpCurrencyConfirmed','erpStaffCode','erpProjectCode','erpResponsibilityConfirmed','salesExportMode'];
 if(batch.source_platform!==conversion.source.platform||batch.source_store!==conversion.settings.store||protectedSettings.some(key=>clean(snapshot.settings[key])!==clean(conversion.settings[key])))throw fail('店鋪、客戶、倉庫或計價設定不同，不能覆蓋原批次');
 const settings={...clone(snapshot.settings),skuMappings:{...clone(snapshot.settings.skuMappings||{}),...Object.fromEntries([...new Set(raw.items.filter(item=>uploaded.has(item.sourceOrderNumber)).map(item=>item.sku))].map(sku=>[sku,clone(conversion.settings.skuMappings[sku])]))}};
 const {prepareUnifiedMarketplace}=await import('./unifiedMarketplace.mjs');
 const {prepareEcountFinancials}=await import('./marketplaceIntake.mjs');
 const prepared=prepareUnifiedMarketplace(raw,settings);
 if(!prepared.output.ok)throw fail('覆蓋後商品或金額尚未核對完成','MARKETPLACE_DRAFT_NOT_READY');
 const retainedSkus=new Set(old.items.map(item=>item.sku)),selectedSkus=new Set(raw.items.filter(item=>uploaded.has(item.sourceOrderNumber)).map(item=>item.sku));
 for(const sku of retainedSkus)if(selectedSkus.has(sku)&&hash(snapshot.settings.skuMappings[sku])!==hash(settings.skuMappings[sku]))throw fail('同批保留訂單與新版商品對照不同，請先統一核對');
 const evidence=snapshot.sourceEvidence||{},latest=conversion.sourceEvidence||{};
 const oldVerification=evidence.verification,newVerification=latest.verification||conversion.verification;
 if(!oldVerification||!newVerification||oldVerification.shop!==newVerification.shop||oldVerification.platform!==newVerification.platform)throw fail('商城來源核對身分不同或不完整');
 const verification={...clone(oldVerification),...clone(newVerification),orders:[...[...kept].map(number=>clone(omittedChecks[number].evidence)),...(newVerification.orders||[]).filter(order=>uploaded.has(order.number))]};
 verification.fingerprint=hash(verification.orders);delete verification.checkedAt;
 const draftRevision=Number(snapshot.draftRevision||0)+1;
 const draftOverride={mode:'operator-reviewed-csv-v1',revision:draftRevision,actorId:Number(user.id),uploadedOrderNumbers:[...uploaded].sort(),keptOrderNumbers:[...kept].sort(),excludedOrderNumbers:sources.filter(source=>!uploaded.has(source.source_order_number)&&!kept.has(source.source_order_number)).map(source=>source.source_order_number).sort()};
 const result={...clone(snapshot),platform:batch.source_platform,settings:prepared.effectiveSettings||settings,
  sourceEvidence:{...clone(evidence),rows:mergedRows(evidence.rows,latest.rows,kept,uploaded,batch.source_platform),verification,draftOverride,
   draftSourceReview:latest.draftSourceReview||null},
  barcodeReviews:[...(snapshot.barcodeReviews||[]).filter(review=>retainedSkus.has(review.evidence?.sourceSku)&&!selectedSkus.has(review.evidence?.sourceSku)),...(conversion.barcodeReviews||[]).filter(review=>selectedSkus.has(review.evidence?.sourceSku))],
  summary:prepared.output.summary,headers:prepared.output.headers,rows:prepared.output.rows,reportHeaders:prepared.output.reportHeaders,reportRows:prepared.output.reportRows,
  orders:prepared.parsed.orders.map(order=>({...order,sourceFinancial:raw.orders.find(value=>value.sourceOrderNumber===order.sourceOrderNumber).financial})),items:prepared.parsed.items,prepick:prepared.prepick,draftRevision,draftOverride,
  draftExcludedOrderNumbers:draftOverride.excludedOrderNumbers,draftUpdatedAt:new Date().toISOString(),draftUpdatedBy:Number(user.id)};
 delete result.salesLayout;delete result.rounding;delete result.draftFingerprint;
 if(prepared.output.salesLayout)result.salesLayout=prepared.output.salesLayout;
 if(prepared.output.rounding)result.rounding=prepared.output.rounding;
 prepareEcountFinancials(result);
 result.draftFingerprint=hash(result);return result;
}

function createMarketplaceDraftOverwriteService({pool,prepareMarketplace,validateSnapshot=async snapshot=>{
 const reviewed=await require('./marketplaceBarcodeReviews').verifySavedBarcodeReviews(pool,snapshot,undefined,{returnContext:true});
 await require('./marketplaceProductCatalog').verifyCatalogMappings(pool,snapshot.settings,[...new Set(snapshot.items.map(item=>item.sku))],undefined,reviewed,snapshot);
}}){
 async function command(db,userId,commandId,requestHash){
  const row=(await db.query('SELECT request_hash,response FROM marketplace_draft_commands WHERE actor_id=$1 AND command_id=$2',[userId,commandId])).rows[0];
  if(row&&row.request_hash!==requestHash)throw fail('同一操作識別不能使用不同內容','MARKETPLACE_DRAFT_COMMAND_CHANGED');
  return row?{...row.response,replayed:true}:null;
 }
 async function readContext(db,conversion,{lock=false,batchIds}={}){
  const numbers=conversion.raw.orders.map(order=>order.sourceOrderNumber),platform=conversion.source.platform,store=clean(conversion.settings.store);
  if(!numbers.length||new Set(numbers).size!==numbers.length)throw fail('來源訂單不完整');
  const owned=(await db.query('SELECT * FROM marketplace_intake_orders WHERE source_platform=$1 AND source_store=$2 AND source_order_number=ANY($3::text[]) ORDER BY id',[platform,store,numbers])).rows;
  if(owned.length!==numbers.length)throw fail('本次含未保存的新訂單，請先分開處理','MARKETPLACE_DRAFT_NEW_ORDERS');
  const ids=[...new Set(owned.map(source=>Number(source.intake_id)))].sort((a,b)=>a-b);
  if(batchIds&&hash(ids)!==hash(batchIds))throw fail('來源訂單批次已變更');
  const batches=[];
  for(const batchId of ids){
   const batch=(await db.query('SELECT * FROM marketplace_intakes WHERE id=$1'+(lock?' FOR UPDATE':''),[batchId])).rows[0];
   if(!batch||batch.source_platform!==platform||batch.source_store!==store)throw fail('來源批次身分已變更');
   const flow=(await db.query('SELECT * FROM marketplace_warehouse_flows WHERE intake_id=$1'+(lock?' FOR UPDATE':''),[batchId])).rows[0];
   const sources=(await db.query('SELECT * FROM marketplace_intake_orders WHERE intake_id=$1 ORDER BY id',[batchId])).rows;
   const activity=(await db.query(`SELECT
    EXISTS(SELECT 1 FROM marketplace_work_order_links l JOIN marketplace_intake_orders s ON s.id=l.intake_order_id WHERE s.intake_id=$1) AS links,
    EXISTS(SELECT 1 FROM orders WHERE source_platform=$2 AND source_store=$3 AND source_order_number=ANY($4::text[])) AS tasks,
    EXISTS(SELECT 1 FROM warehouse_import_batches WHERE voucher_number=$5) AS imports,
    EXISTS(SELECT 1 FROM marketplace_warehouse_events WHERE intake_id=$1 AND action<>'enable') AS events`,[batchId,platform,store,sources.map(source=>source.source_order_number),batch.batch_number])).rows[0];
   batches.push({batch,flow,sources,activity,blockedReasons:blockedReasons(batch,flow,activity)});
  }
  return {batches,numbers,ids,identities:batches.flatMap(value=>value.sources.map(source=>[source.source_platform,source.source_store,source.source_order_number])).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))};
 }
 const fingerprint=(context,conversion,body,omittedChecks)=>hash({context,rows:body.rows,settings:{...conversion.settings,batchNumber:undefined,date:undefined},verification:conversion.verification?.orders,sourceReview:conversion.sourceEvidence?.draftSourceReview,omittedChecks});
 async function checkOmitted(context,body){
  const result={},business=require('./marketplaceShipping').business;
  for(const {batch,sources} of context.batches){
   const numbers=sources.filter(source=>source.draft_active!==false&&!context.numbers.includes(source.source_order_number)).map(source=>source.source_order_number);
   if(!numbers.length)continue;
   const checks=Object.fromEntries(numbers.map(number=>[number,{canKeep:false,keepBlockedReason:'未能即時核對原訂單，請重新查核或明確移出本批'}]));
   try{
    const rows=mergedRows(batch.snapshot.sourceEvidence?.rows,null,new Set(numbers),new Set(),batch.source_platform);
    const fresh=await prepareMarketplace({rows,settings:batch.snapshot.settings,profileId:body.profileId},{refresh:true});
    const previous=batch.snapshot.sourceEvidence?.verification,current=fresh.verification;
    if(batch.source_platform!=='Shopify'||current?.platform!==previous?.platform||current?.shop!==previous?.shop||current?.version!=='shopify-current-v2'||current.orders?.length!==numbers.length)throw fail('原訂單來源身分不完整');
    for(const number of numbers){
     try{
      const old=previous.orders.filter(order=>order.number===number),found=current.orders.filter(order=>order.number===number);
      if(old.length!==1||found.length!==1)throw fail('原訂單身分不完整');
      const before=business(old[0]),after=business(found[0]);
      if(after.cancelled!==false||after.cancelledAt||after.fulfillmentStatus!=='unfulfilled'||after.currentQuantity!==after.remainingQuantity||!['paid','pending'].includes(after.paymentStatus)||hash(before)!==hash(after)){
       checks[number]={canKeep:false,keepBlockedReason:'商城商品、金額或出貨狀態已變更，請核對後移出本批',business:after};
      }else checks[number]={canKeep:true,evidence:clone(found[0]),business:after};
     }catch{checks[number]={canKeep:false,keepBlockedReason:'原訂單缺少可比對的即時證據，請重新查核或明確移出本批'};}
    }
   }catch{}
   Object.assign(result,checks);
  }
  return result;
 }
 async function collect(body,refresh){
  const initial=await prepareMarketplace(body,{refresh});
  const context=await readContext(pool,initial);
  const conversion=await prepareMarketplace(body,{refresh:false,overwriteOrderNumbers:context.numbers});
  conversion.uploadedNumbers=new Set(context.numbers);
  const omittedChecks=await checkOmitted(context,body);
  return {context,conversion,omittedChecks,previewFingerprint:fingerprint(context,conversion,body,omittedChecks)};
 }
 async function preview(body,user){
  actor(user);const data=await collect(body,true),{context,conversion}=data;
  const validationErrors=conversion.output?.ok?[]:(conversion.output?.issues||[]).filter(issue=>issue.severity==='error').map(issue=>issue.message);
  const affectedBatches=context.batches.map(({batch,sources,blockedReasons:reasons})=>({id:Number(batch.id),batchNumber:batch.batch_number,revision:Number(batch.snapshot.draftRevision||0),canOverwrite:reasons.length===0&&conversion.output?.ok===true,blockedReasons:[...reasons,...validationErrors],
   uploadedOrders:sources.filter(source=>context.numbers.includes(source.source_order_number)).map(source=>{
    const number=source.source_order_number,before=summary(batch.snapshot,number,source),after=summary({orders:conversion.parsed.orders.map(order=>({...order,sourceFinancial:conversion.raw.orders.find(raw=>raw.sourceOrderNumber===order.sourceOrderNumber)?.financial})),items:conversion.parsed.items},number),diff=changes(before,after);
    const current=conversion.verification?.orders?.find(order=>order.number===number);
    const live=current?{totalMinor:current.totalMinor,receivedMinor:current.receivedMinor,outstandingMinor:current.outstandingMinor,quantity:current.currentQuantity}:null;
    return {orderNumber:number,changed:diff.length>0||source.draft_active===false,restoring:source.draft_active===false,before,after,changes:diff,live,diffAPI:Boolean(live&&(live.totalMinor!==after.totalMinor||live.quantity!==after.quantity))};}),
   omittedOrders:sources.filter(source=>source.draft_active!==false&&!context.numbers.includes(source.source_order_number)).map(source=>({orderNumber:source.source_order_number,decisionKey:source.source_order_number,before:summary(batch.snapshot,source.source_order_number,source),canKeep:data.omittedChecks[source.source_order_number].canKeep,...(data.omittedChecks[source.source_order_number].keepBlockedReason?{keepBlockedReason:data.omittedChecks[source.source_order_number].keepBlockedReason}:{})}))}));
  return {previewFingerprint:data.previewFingerprint,affectedBatches,confirmationRequired:true};
 }
 async function apply(body,user){
  const userId=actor(user);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.commandId||'')||body.confirmed!==true||body.notImportedConfirmed!==true||!/^[a-f0-9]{64}$/.test(body.previewFingerprint||''))throw fail('請確認尚未匯入 ECOUNT 及覆蓋內容','MARKETPLACE_DRAFT_CONFIRMATION_REQUIRED',400);
  const requestHash=hash(body),previous=await command(pool,userId,body.commandId,requestHash);if(previous)return previous;
  const data=await collect(body,true);
  if(data.previewFingerprint!==body.previewFingerprint)throw fail('原批次或商城資料已更新，請重新核對');
  if(data.conversion.output?.ok!==true)throw Object.assign(fail('新版訂單商品、折扣或金額尚未核對完成','MARKETPLACE_DRAFT_NOT_READY'),{issues:data.conversion.output?.issues||[]});
  const decisions=body.decisions||{};
  if(!decisions||typeof decisions!=='object'||Array.isArray(decisions))throw fail('請逐筆決定未包含的訂單','MARKETPLACE_DRAFT_DECISIONS_REQUIRED',400);
  const omitted=data.context.batches.flatMap(value=>value.sources.filter(source=>source.draft_active!==false&&!data.context.numbers.includes(source.source_order_number)).map(source=>source.source_order_number));
  if(omitted.some(number=>!['exclude','keep'].includes(decisions[number]))||Object.keys(decisions).some(number=>!omitted.includes(number)))throw fail('請逐筆選擇保留或排除未包含的訂單','MARKETPLACE_DRAFT_DECISIONS_REQUIRED',400);
  if(omitted.some(number=>decisions[number]==='keep'&&!data.omittedChecks[number]?.canKeep))throw fail('未包含的訂單已變更或尚未核對，不能保留於新版草稿','MARKETPLACE_DRAFT_KEEP_NOT_AVAILABLE');
  if(typeof body.reason!=='undefined'&&(typeof body.reason!=='string'||body.reason.length>500))throw fail('修改原因格式無效','MARKETPLACE_DRAFT_INVALID',400);
  const reason=clean(body.reason)||'尚未匯入 ECOUNT，依本次訂單檔重新產生草稿';
  const snapshots=new Map();
  for(const value of data.context.batches){if(value.blockedReasons.length)throw fail(value.blockedReasons.join('；'),'MARKETPLACE_DRAFT_ALREADY_STARTED');const next=await buildSnapshot(value.batch,value.sources,data.conversion,decisions,user,data.omittedChecks);await validateSnapshot(next);snapshots.set(Number(value.batch.id),next);}
  const db=await pool.connect();let open=false,commitAttempted=false,tainted=false;
  try{
   await db.query('BEGIN');open=true;await db.query("SET LOCAL lock_timeout='3000ms'");await db.query("SET LOCAL statement_timeout='15000ms'");
   await db.query("SELECT pg_advisory_xact_lock(hashtext('wms-draft-command'),hashtext($1))",[`${userId}:${body.commandId}`]);
   const reused=await command(db,userId,body.commandId,requestHash);if(reused){await db.query('ROLLBACK');open=false;return reused;}
   for(const identity of data.context.identities)await db.query("SELECT pg_advisory_xact_lock(hashtext('wms-marketplace-source'),hashtext($1))",[JSON.stringify(identity)]);
   const current=await readContext(db,data.conversion,{lock:true,batchIds:data.context.ids});
   if(fingerprint(current,data.conversion,body,data.omittedChecks)!==data.previewFingerprint)throw fail('批次已開始作業或資料已更新，請重新核對');
   const batches=[];
   const {warehouseProductDetails,mappingScanIdentity}=await import('./marketplaceIntake.mjs');
   for(const {batch,sources,blockedReasons:reasons} of current.batches){
    if(reasons.length)throw fail(reasons.join('；'),'MARKETPLACE_DRAFT_ALREADY_STARTED');
    const next=snapshots.get(Number(batch.id)),active=new Set(next.orders.map(order=>order.sourceOrderNumber));
    await db.query('INSERT INTO marketplace_draft_revisions(intake_id,revision,before_snapshot,before_sources,after_hash,actor_id,command_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[batch.id,next.draftRevision,JSON.stringify(batch.snapshot),JSON.stringify(sources),hash(next),userId,body.commandId,reason]);
    await db.query('UPDATE marketplace_intakes SET snapshot=$2 WHERE id=$1',[batch.id,JSON.stringify(next)]);
    for(const source of sources){
     const number=source.source_order_number,order=next.orders.find(value=>value.sourceOrderNumber===number);
     if(!active.has(number)){await db.query('UPDATE marketplace_intake_orders SET draft_active=FALSE WHERE id=$1',[source.id]);continue;}
     const expected=next.items.filter(item=>item.sourceOrderNumber===number).map(item=>({sourceLineId:item.sourceLineId,sourceSku:item.sku,productCode:next.settings.skuMappings[item.sku].erpSku,...warehouseProductDetails(item,next.settings.skuMappings[item.sku]),quantity:item.quantity,...mappingScanIdentity(next.settings.skuMappings[item.sku]),groupName:item.groupName,...(item.sourceSkuFormat?{sourceSkuFormat:item.sourceSkuFormat,sourceBarcode:item.sourceBarcode,campaignGroupName:item.campaignGroupName,campaignRound:item.campaignRound}:{})}));
     const ids=new Set(expected.map(item=>item.sourceLineId));
     const nonstock=next.rows.filter(row=>row[12]===number&&!ids.has(row[15])).map(row=>({sourceLineId:row[15],productCode:row[11],quantity:row[19]}));
     const rounding=next.rounding?.orders.find(entry=>entry.identity[0]===order.sourcePlatform&&entry.identity[1]===number);
     await db.query('UPDATE marketplace_intake_orders SET draft_active=TRUE,expected_items=$2,nonstock_items=$3,financial=$4 WHERE id=$1',[source.id,JSON.stringify(expected),JSON.stringify(nonstock),JSON.stringify({source:order.sourceFinancial,ecount:order.financial,...(rounding?{erpRounding:{policy:next.rounding.policy,...rounding}}:{})})]);
    }
    batches.push({id:Number(batch.id),batchNumber:batch.batch_number,draftRevision:next.draftRevision,draftFingerprint:next.draftFingerprint,activeOrderCount:next.orders.length,excludedOrderNumbers:sources.filter(source=>!active.has(source.source_order_number)).map(source=>source.source_order_number)});
   }
   const response={applied:true,commandId:body.commandId,batches,replayed:false};
   await db.query('INSERT INTO marketplace_draft_commands(actor_id,command_id,request_hash,response) VALUES($1,$2,$3,$4)',[userId,body.commandId,requestHash,JSON.stringify(response)]);
   commitAttempted=true;await db.query('COMMIT');open=false;return response;
  }catch(error){if(open)try{await db.query('ROLLBACK');}catch{tainted=true;}if(commitAttempted)throw fail('覆蓋結果尚未確認，請以相同操作識別重試讀取結果','MARKETPLACE_DRAFT_RESULT_UNKNOWN',503);throw error;}finally{db.release(tainted);}
 }
 return {preview,apply};
}
module.exports={createMarketplaceDraftOverwriteService};
