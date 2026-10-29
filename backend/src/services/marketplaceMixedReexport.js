const {draftOverwriteTools:{hash,summary,changes,oldRaw,mergedRows,blockedReasons}}=require('./marketplaceDraftOverwrite');
const {captureHandler}=require('./marketplaceHandler');
const clean=value=>String(value??'').trim();
const clone=value=>JSON.parse(JSON.stringify(value));
const fail=(message,code='MARKETPLACE_DRAFT_CHANGED',status=409)=>Object.assign(new Error(message),{status,code});
const positive=value=>Number.isSafeInteger(Number(value))&&Number(value)>0;
const protectedSettings=['store','customerCode','customerName','warehouseCode','currency','taxMode','taxType','taxConfirmed','erpCurrencyCode','erpCurrencyConfirmed','erpStaffCode','erpProjectCode','erpResponsibilityConfirmed','salesExportMode'];
function actor(user){if(!positive(user?.id)||!['admin','dispatcher','superadmin'].includes(user.role))throw fail('需要拋單員或管理員權限','MARKETPLACE_DRAFT_FORBIDDEN',403);return Number(user.id);}
function uploadedNumbers(conversion){
 const rows=conversion.source?.rows,column=rows?.[0]?.indexOf('Name'),numbers=[];let previous='';
 if(conversion.source?.platform!=='Shopify'||column<0)throw fail('目前僅支援 Shopify 混合訂單轉檔','MARKETPLACE_DRAFT_PLATFORM',400);
 for(const row of rows.slice(1)){if(!row.some(value=>clean(value)))continue;const number=clean(row[column])||previous;if(!number||number.length>100)throw fail('來源訂單不完整');previous=number;if(!numbers.includes(number))numbers.push(number);}
 const raw=conversion.raw?.orders?.map(order=>order.sourceOrderNumber),verification=conversion.verification;
 if(!numbers.length||!raw||hash([...raw].sort())!==hash([...numbers].sort())||verification?.platform!=='Shopify'||verification?.version!=='shopify-current-v2'||!clean(verification.shop)||!Array.isArray(verification.orders)||verification.orders.length!==numbers.length||numbers.some(number=>verification.orders.filter(order=>order.number===number).length!==1))throw fail('上傳訂單未取得完整且唯一的商城核對證據','MARKETPLACE_DRAFT_SOURCE_INVALID',400);
 return numbers.sort();
}
function afterSummary(conversion,number){return summary({orders:conversion.parsed.orders.map(order=>({...order,sourceFinancial:conversion.raw.orders.find(raw=>raw.sourceOrderNumber===order.sourceOrderNumber)?.financial})),items:conversion.parsed.items},number);}
function makeSnapshot(conversion,raw,settings,user){
 return import('./unifiedMarketplace.mjs').then(({prepareUnifiedMarketplace})=>{
  const prepared=prepareUnifiedMarketplace(raw,settings);
  if(!prepared.output.ok)throw Object.assign(fail('新版訂單商品、折扣或金額尚未核對完成','MARKETPLACE_DRAFT_NOT_READY'),{issues:prepared.output.issues});
  if(hash(prepared.parsed.orders.map(order=>order.sourceOrderNumber).sort())!==hash(raw.orders.map(order=>order.sourceOrderNumber).sort()))throw fail('本次訂單含不符合銷貨條件的訂單，未產生部分轉檔','MARKETPLACE_DRAFT_SOURCE_INVALID',400);
  return {platform:conversion.source.platform,handler:captureHandler(user),settings:prepared.effectiveSettings||settings,sourceEvidence:clone(conversion.sourceEvidence),barcodeReviews:clone(conversion.barcodeReviews||[]),summary:prepared.output.summary,headers:prepared.output.headers,rows:prepared.output.rows,reportHeaders:prepared.output.reportHeaders,reportRows:prepared.output.reportRows,orders:prepared.parsed.orders.map(order=>({...order,sourceFinancial:clone(raw.orders.find(value=>value.sourceOrderNumber===order.sourceOrderNumber).financial)})),items:prepared.parsed.items,prepick:prepared.prepick,...(prepared.output.salesLayout?{salesLayout:prepared.output.salesLayout}:{}),...(prepared.output.rounding?{rounding:prepared.output.rounding}:{})};
 });
}
async function patchOwner(batch,sources,conversion,user){
 const snapshot=batch.snapshot,selected=new Set(sources.filter(source=>conversion.uploadedNumbers.has(source.source_order_number)).map(source=>source.source_order_number));
 if(protectedSettings.some(key=>clean(snapshot.settings?.[key])!==clean(conversion.settings[key])))throw fail('店鋪、客戶、倉庫或計價設定不同，不能覆蓋原批次');
 // An owner can itself be a previous mixed export. Retain every unrelated
 // snapshot order, including borrowed sources, rather than rebuilding from
 // this owner's canonical rows alone. Their source rows are never updated.
 const retained=new Set(snapshot.orders.filter(order=>!selected.has(order.sourceOrderNumber)).map(order=>order.sourceOrderNumber)),old=oldRaw(snapshot,retained);
 const raw={...old,orders:[...old.orders,...clone(conversion.raw.orders.filter(order=>selected.has(order.sourceOrderNumber)))],items:[...old.items,...clone(conversion.raw.items.filter(item=>selected.has(item.sourceOrderNumber)))],issues:clone((conversion.raw.issues||[]).filter(issue=>!issue.orderNumber||selected.has(issue.orderNumber)))};
 const selectedSkus=new Set(conversion.raw.items.filter(item=>selected.has(item.sourceOrderNumber)).map(item=>item.sku)),retainedSkus=new Set(old.items.map(item=>item.sku));
 for(const sku of selectedSkus)if(retainedSkus.has(sku)&&hash(snapshot.settings.skuMappings[sku])!==hash(conversion.settings.skuMappings[sku]))throw fail('同批保留訂單與新版商品對照不同，請先統一核對');
 const settings={...clone(snapshot.settings),skuMappings:{...clone(snapshot.settings.skuMappings),...Object.fromEntries([...selectedSkus].map(sku=>[sku,clone(conversion.settings.skuMappings[sku])]))}};
 const previous=snapshot.sourceEvidence?.verification,current=conversion.verification;
 if(!previous||previous.platform!==current.platform||previous.shop!==current.shop||!Array.isArray(previous.orders)||[...retained].some(number=>previous.orders.filter(order=>order.number===number).length!==1))throw fail('原批次缺少完整的商城核對證據');
 const verification={...clone(previous),orders:[...previous.orders.filter(order=>retained.has(order.number)),...current.orders.filter(order=>selected.has(order.number))]};verification.fingerprint=hash(verification.orders);delete verification.checkedAt;
 const revision=Number(snapshot.draftRevision||0)+1,draftOverride={mode:'uploaded-file-v2',revision,actorId:Number(user.id),uploadedOrderNumbers:[...selected].sort(),keptOrderNumbers:[...retained].sort(),excludedOrderNumbers:[]};
 const rebuilt=await makeSnapshot(conversion,raw,settings,user);
 const next={...clone(snapshot),...rebuilt,draftRevision:revision,draftOverride,draftUpdatedAt:new Date().toISOString(),draftUpdatedBy:Number(user.id),sourceEvidence:{...clone(snapshot.sourceEvidence),rows:mergedRows(snapshot.sourceEvidence.rows,conversion.sourceEvidence.rows,retained,selected,'Shopify'),verification,draftOverride,draftSourceReview:clone(conversion.sourceEvidence.draftSourceReview||null)},barcodeReviews:[...(snapshot.barcodeReviews||[]).filter(review=>retainedSkus.has(review.evidence?.sourceSku)&&!selectedSkus.has(review.evidence?.sourceSku)),...(conversion.barcodeReviews||[]).filter(review=>selectedSkus.has(review.evidence?.sourceSku))],draftExcludedOrderNumbers:(snapshot.draftExcludedOrderNumbers||[]).filter(number=>!selected.has(number))};
 if(snapshot.handler)next.handler=clone(snapshot.handler);else delete next.handler;
 if(!rebuilt.salesLayout)delete next.salesLayout;if(!rebuilt.rounding)delete next.rounding;delete next.draftFingerprint;
 (await import('./marketplaceIntake.mjs')).prepareEcountFinancials(next);
 next.draftFingerprint=hash(next);return next;
}
function createMarketplaceMixedReexportService({pool,prepareMarketplace,enabled=()=>process.env.WMS_MIXED_REEXPORT_ENABLED==='true',validateSnapshot=async snapshot=>{
 const reviewed=await require('./marketplaceBarcodeReviews').verifySavedBarcodeReviews(pool,snapshot,undefined,{returnContext:true});
 await require('./marketplaceProductCatalog').verifyCatalogMappings(pool,snapshot.settings,[...new Set(snapshot.items.map(item=>item.sku))],undefined,reviewed,snapshot);
}}){
 const scopes=()=>require('./marketplaceUploadScopes');
 async function command(db,userId,commandId,requestHash){const row=(await db.query('SELECT request_hash,response FROM marketplace_draft_commands WHERE actor_id=$1 AND command_id=$2',[userId,commandId])).rows[0];if(row&&row.request_hash!==requestHash)throw fail('同一操作識別不能使用不同內容','MARKETPLACE_DRAFT_COMMAND_CHANGED');return row?{...row.response,replayed:true}:null;}
 async function readContext(db,conversion,{lock=false,expectedIds}={}){
  const numbers=uploadedNumbers(conversion),platform='Shopify',store=clean(conversion.settings.store);
  if(!store)throw fail('請選擇已設定的店鋪','STORE_PROFILE_REQUIRED',400);
  const sources=(await db.query('SELECT * FROM marketplace_intake_orders WHERE source_platform=$1 AND source_store=$2 AND source_order_number=ANY($3::text[]) ORDER BY id',[platform,store,numbers])).rows;
  if(sources.some(source=>!positive(source.id)||!positive(source.intake_id)||!numbers.includes(source.source_order_number)||source.source_platform!==platform||source.source_store!==store)||new Set(sources.map(source=>source.source_order_number)).size!==sources.length)throw fail('原來源訂單紀錄不完整');
  const owned=new Set(sources.map(source=>source.source_order_number)),newNumbers=numbers.filter(number=>!owned.has(number));
  const scopeActivity=sources.length?await scopes().readSourceScopeActivity(db,sources.map(source=>Number(source.id))):[];
  const ids=[...new Set([...sources.map(source=>Number(source.intake_id)),...scopeActivity.map(value=>Number(value.batch.id))])].sort((a,b)=>a-b);
  if(expectedIds&&hash(ids)!==hash(expectedIds))throw fail('來源訂單範圍已變更');
  if(lock)for(const intakeId of ids){await db.query('SELECT id FROM marketplace_intakes WHERE id=$1 FOR UPDATE',[intakeId]);await db.query('SELECT intake_id FROM marketplace_warehouse_flows WHERE intake_id=$1 FOR UPDATE',[intakeId]);}
  const activity=lock&&sources.length?await scopes().readSourceScopeActivity(db,sources.map(source=>Number(source.id))):scopeActivity;
  const owners=[];
  for(const intakeId of [...new Set(sources.map(source=>Number(source.intake_id)))].sort((a,b)=>a-b)){
   const batch=(await db.query('SELECT * FROM marketplace_intakes WHERE id=$1',[intakeId])).rows[0];
   if(!batch||batch.source_platform!==platform||batch.source_store!==store||!Array.isArray(batch.snapshot?.orders)||!batch.snapshot.settings)throw fail('原批次身分已變更');
   const allSources=(await db.query('SELECT * FROM marketplace_intake_orders WHERE intake_id=$1 ORDER BY id',[intakeId])).rows;
   owners.push({batch,sources:allSources});
  }
  const tasks=(await db.query('SELECT id,source_platform,source_store,source_order_number FROM orders WHERE source_platform=$1 AND source_store=$2 AND source_order_number=ANY($3::text[]) ORDER BY id',[platform,store,numbers])).rows;
  const profiles=(await db.query('SELECT id,platform,store,settings,updated_at FROM marketplace_store_profiles WHERE id=$1'+(lock?' FOR SHARE':''),[conversion.profileId||0])).rows;
  if(!profiles[0]||profiles[0].platform!==platform||profiles[0].store!==store)throw fail('店鋪設定已變更，請重新核對');
  return {numbers,sources,newNumbers,owners,scopeActivity:activity,tasks,profile:profiles[0],ids,identities:[...new Map([...numbers.map(number=>[platform,store,number]),...owners.flatMap(value=>value.sources.map(source=>[source.source_platform,source.source_store,source.source_order_number]))].map(identity=>[JSON.stringify(identity),identity])).values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))};
 }
 const fingerprint=(context,conversion,body)=>hash({context,rows:body.rows,settings:{...conversion.settings,date:undefined,batchNumber:undefined},verification:conversion.verification?.orders,sourceReview:conversion.sourceEvidence?.draftSourceReview});
 async function collect(body,refresh){
  const initial=await prepareMarketplace(body,{refresh}),context=await readContext(pool,initial);
  let conversion,projectionError=null;
  try{conversion=await prepareMarketplace(body,{refresh:false,overwriteOrderNumbers:context.numbers});}catch(error){if(error.code!=='MARKETPLACE_DRAFT_SOURCE_INVALID')throw error;conversion=initial;projectionError=error;}
  conversion.uploadedNumbers=new Set(context.numbers);
  if(hash(uploadedNumbers(conversion))!==hash(context.numbers))throw fail('商城來源範圍已變更');
  if(!projectionError&&hash(conversion.parsed.orders.map(order=>order.sourceOrderNumber).sort())!==hash(context.numbers))projectionError=fail('本次訂單含不符合銷貨條件的訂單，未產生部分轉檔','MARKETPLACE_DRAFT_SOURCE_INVALID',400);
  return {context,conversion,projectionError,previewFingerprint:fingerprint(context,conversion,body)};
 }
 function reasons(data){
  const errors=[];
  if(enabled()!==true)errors.push('混合訂單轉檔發布檢查中，尚未開放確認');
  if(data.projectionError)errors.push(data.projectionError.message);
  if(data.conversion.output?.ok!==true){const issues=(data.conversion.output?.issues||[]).filter(issue=>issue.severity==='error').map(issue=>issue.message);errors.push(...(issues.length?issues:['新版訂單商品、折扣或金額尚未核對完成']));}
  for(const value of data.context.scopeActivity)errors.push(...blockedReasons(value.batch,value.flow,value.activity));
  for(const {batch} of data.context.owners)if(protectedSettings.some(key=>clean(batch.snapshot.settings?.[key])!==clean(data.conversion.settings[key])))errors.push('店鋪、客戶、倉庫或計價設定不同，不能覆蓋原批次');
  if(data.context.tasks.length)errors.push('選入訂單已有工作單，不能重新轉銷貨');
  return [...new Set(errors)];
 }
 async function preview(body,user){
  actor(user);const data=await collect(body,true),{context,conversion}=data,blocked=reasons(data),newOrders=context.newNumbers.map(number=>{const current=conversion.verification.orders.find(order=>order.number===number);return {orderNumber:number,after:afterSummary(conversion,number),live:{totalMinor:current.totalMinor,receivedMinor:current.receivedMinor,outstandingMinor:current.outstandingMinor,quantity:current.currentQuantity}};});
  const affectedBatches=context.owners.map(({batch,sources})=>({id:Number(batch.id),batchNumber:batch.batch_number,revision:Number(batch.snapshot.draftRevision||0),retainedOrderCount:batch.snapshot.orders.filter(order=>!conversion.uploadedNumbers.has(order.sourceOrderNumber)).length,
   uploadedOrders:sources.filter(source=>conversion.uploadedNumbers.has(source.source_order_number)).map(source=>{const number=source.source_order_number,before=summary(batch.snapshot,number,source),after=afterSummary(conversion,number),diff=changes(before,after),current=conversion.verification.orders.find(order=>order.number===number),live={totalMinor:current.totalMinor,receivedMinor:current.receivedMinor,outstandingMinor:current.outstandingMinor,quantity:current.currentQuantity};return {orderNumber:number,changed:diff.length>0||source.draft_active===false,restoring:source.draft_active===false,before,after,changes:diff,live,diffAPI:live.totalMinor!==after.totalMinor||live.quantity!==after.quantity};}),
   omittedOrders:batch.snapshot.orders.filter(order=>!conversion.uploadedNumbers.has(order.sourceOrderNumber)).map(order=>({orderNumber:order.sourceOrderNumber,before:summary(batch.snapshot,order.sourceOrderNumber),preserved:true}))}));
  const existing=affectedBatches.flatMap(batch=>batch.uploadedOrders),selected=context.numbers.map(number=>afterSummary(conversion,number));
  return {scopeMode:'uploaded-file-v2',previewFingerprint:data.previewFingerprint,summary:{totalOrderCount:context.numbers.length,newOrderCount:newOrders.length,changedOrderCount:existing.filter(order=>order.changed).length,unchangedOrderCount:existing.filter(order=>!order.changed).length,quantity:selected.reduce((sum,order)=>sum+order.quantity,0),totalMinor:selected.reduce((sum,order)=>sum+(order.totalMinor||0),0)},newOrders,affectedBatches,canConfirm:blocked.length===0,blockedReasons:blocked,confirmationRequired:true};
 }
 async function apply(body,user){
  const userId=actor(user);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.commandId||'')||body.confirmed!==true||body.notImportedConfirmed!==true||!/^[a-f0-9]{64}$/.test(body.previewFingerprint||'')||(body.decisions&&Object.keys(body.decisions).length))throw fail('請確認本次完整轉檔範圍與尚未匯入 ECOUNT；未上傳原單會保留','MARKETPLACE_DRAFT_CONFIRMATION_REQUIRED',400);
  const requestHash=hash(body),previous=await command(pool,userId,body.commandId,requestHash);if(previous)return previous;
  if(enabled()!==true)throw fail('混合訂單轉檔發布檢查中，尚未開放確認','MARKETPLACE_MIXED_REEXPORT_DISABLED',423);
  const data=await collect(body,true);
  if(data.previewFingerprint!==body.previewFingerprint)throw fail('原訂單、新單範圍或商城資料已更新，請重新核對');
  if(data.projectionError)throw data.projectionError;
  if(data.conversion.output?.ok!==true)throw Object.assign(fail('新版訂單商品、折扣或金額尚未核對完成','MARKETPLACE_DRAFT_NOT_READY'),{issues:data.conversion.output?.issues||[]});
  const blocked=reasons(data);if(blocked.length)throw fail(blocked.join('；'),'MARKETPLACE_DRAFT_ALREADY_STARTED');
  if(typeof body.reason!=='undefined'&&(typeof body.reason!=='string'||body.reason.length>500))throw fail('修改原因格式無效','MARKETPLACE_DRAFT_INVALID',400);
  const reason=clean(body.reason)||'尚未匯入 ECOUNT，依本次完整訂單檔建立新版轉檔';
  const snapshots=new Map();for(const owner of data.context.owners)snapshots.set(Number(owner.batch.id),await patchOwner(owner.batch,owner.sources,data.conversion,user));
  const batchNumber=`WMS-${data.conversion.settings.date.replaceAll('-','')}-${hash([userId,body.commandId]).slice(0,6).toUpperCase()}`;
  const snapshot=await makeSnapshot(data.conversion,data.conversion.raw,{...clone(data.conversion.settings),batchNumber},user);await validateSnapshot(snapshot);
  (await import('./marketplaceIntake.mjs')).prepareEcountFinancials(snapshot);
  const db=await pool.connect();let open=false,commitAttempted=false,tainted=false;
  try{
   await db.query('BEGIN');open=true;await db.query("SET LOCAL lock_timeout='3000ms'");await db.query("SET LOCAL statement_timeout='15000ms'");
   await db.query("SELECT pg_advisory_xact_lock(hashtext('wms-draft-command'),hashtext($1))",[`${userId}:${body.commandId}`]);
   const reused=await command(db,userId,body.commandId,requestHash);if(reused){await db.query('ROLLBACK');open=false;return reused;}
   for(const identity of data.context.identities)await db.query("SELECT pg_advisory_xact_lock(hashtext('wms-marketplace-source'),hashtext($1))",[JSON.stringify(identity)]);
   const current=await readContext(db,data.conversion,{lock:true,expectedIds:data.context.ids});
   if(fingerprint(current,data.conversion,body)!==data.previewFingerprint)throw fail('來源歸屬、店鋪設定或作業狀態已變更，請重新核對');
   if(reasons({...data,context:current}).length)throw fail('訂單已開始作業，不能重新轉銷貨','MARKETPLACE_DRAFT_ALREADY_STARTED');
   const {warehouseProductDetails,mappingScanIdentity}=await import('./marketplaceIntake.mjs');
   function values(order,record){const expected=record.items.filter(item=>item.sourceOrderNumber===order.sourceOrderNumber).map(item=>({sourceLineId:item.sourceLineId,sourceSku:item.sku,productCode:record.settings.skuMappings[item.sku].erpSku,...warehouseProductDetails(item,record.settings.skuMappings[item.sku]),quantity:item.quantity,...mappingScanIdentity(record.settings.skuMappings[item.sku]),groupName:item.groupName,...(item.sourceSkuFormat?{sourceSkuFormat:item.sourceSkuFormat,sourceBarcode:item.sourceBarcode,campaignGroupName:item.campaignGroupName,campaignRound:item.campaignRound}:{})}));const ids=new Set(expected.map(item=>item.sourceLineId)),nonstock=record.rows.filter(row=>row[12]===order.sourceOrderNumber&&!ids.has(row[15])).map(row=>({sourceLineId:row[15],productCode:row[11],quantity:row[19]})),rounding=record.rounding?.orders.find(entry=>entry.identity[0]===order.sourcePlatform&&entry.identity[1]===order.sourceOrderNumber);return [JSON.stringify(expected),JSON.stringify(nonstock),JSON.stringify({source:order.sourceFinancial,ecount:order.financial,...(rounding?{erpRounding:{policy:record.rounding.policy,...rounding}}:{})})];}
   for(const {batch,sources} of current.owners){
    const next=snapshots.get(Number(batch.id));
    await db.query('INSERT INTO marketplace_draft_revisions(intake_id,revision,before_snapshot,before_sources,after_hash,actor_id,command_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[batch.id,next.draftRevision,JSON.stringify(batch.snapshot),JSON.stringify(sources),hash(next),userId,body.commandId,reason]);
    await db.query('UPDATE marketplace_intakes SET snapshot=$2 WHERE id=$1',[batch.id,JSON.stringify(next)]);
    for(const source of sources.filter(source=>data.conversion.uploadedNumbers.has(source.source_order_number))){const order=next.orders.find(order=>order.sourceOrderNumber===source.source_order_number);await db.query('UPDATE marketplace_intake_orders SET draft_active=TRUE,expected_items=$2,nonstock_items=$3,financial=$4,draft_version=draft_version+1 WHERE id=$1',[source.id,...values(order,next)]);}
   }
   const created=(await db.query('INSERT INTO marketplace_intakes(batch_number,source_platform,source_store,fingerprint,created_by,snapshot) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[batchNumber,'Shopify',clean(snapshot.settings.store),hash({mode:'uploaded-file-v2',actor:userId,commandId:body.commandId,preview:body.previewFingerprint}),userId,JSON.stringify(snapshot)])).rows[0];
   for(const number of current.newNumbers){const order=snapshot.orders.find(order=>order.sourceOrderNumber===number);await db.query('INSERT INTO marketplace_intake_orders(intake_id,source_platform,source_store,source_order_number,expected_items,nonstock_items,financial) VALUES($1,$2,$3,$4,$5,$6,$7)',[created.id,'Shopify',clean(snapshot.settings.store),number,...values(order,snapshot)]);}
   const selected=(await db.query('SELECT * FROM marketplace_intake_orders WHERE source_platform=$1 AND source_store=$2 AND source_order_number=ANY($3::text[]) ORDER BY id',['Shopify',clean(snapshot.settings.store),current.numbers])).rows;
   if(selected.length!==current.numbers.length)throw fail('保存後來源訂單範圍不完整');
   snapshot.uploadScope=scopes().createUploadScope(selected);
   for(const source of selected)await db.query('INSERT INTO marketplace_intake_scope_orders(intake_id,intake_order_id,source_version) VALUES($1,$2,$3)',[created.id,source.id,source.draft_version]);
   await db.query('UPDATE marketplace_intakes SET snapshot=$2 WHERE id=$1',[created.id,JSON.stringify(snapshot)]);
   await require('./warehouseRelease').enableFlow(db,created.id,userId);
   const exportBatch={id:Number(created.id),batchNumber,orderCount:snapshot.orders.length,activeOrderCount:snapshot.orders.length,draftRevision:0,quantity:snapshot.items.reduce((sum,item)=>sum+item.quantity,0),totalMinor:snapshot.summary.ecountTotalMinor,scopeFingerprint:snapshot.uploadScope.fingerprint};
   const response={applied:true,scopeMode:'uploaded-file-v2',commandId:body.commandId,exportBatch,batches:[exportBatch],newOrderCount:current.newNumbers.length,updatedOrderCount:current.sources.length,replayed:false};
   await db.query('INSERT INTO marketplace_draft_commands(actor_id,command_id,request_hash,response) VALUES($1,$2,$3,$4)',[userId,body.commandId,requestHash,JSON.stringify(response)]);
   commitAttempted=true;await db.query('COMMIT');open=false;return response;
  }catch(error){if(open)try{await db.query('ROLLBACK');}catch{tainted=true;}if(commitAttempted)throw fail('轉檔保存結果尚未確認，請保留同一操作識別重試讀取結果','MARKETPLACE_DRAFT_RESULT_UNKNOWN',503);if(['55P03','57014','23505'].includes(error.code))throw fail('來源訂單正在處理或已保存，請重新核對','MARKETPLACE_DRAFT_CHANGED');throw error;}finally{db.release(tainted);}
 }
 return {preview,apply};
}
module.exports={createMarketplaceMixedReexportService};
