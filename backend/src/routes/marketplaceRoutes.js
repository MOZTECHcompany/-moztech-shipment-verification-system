const express=require('express');
const {createHash}=require('node:crypto');
const {authorizeRoles}=require('../middleware/auth');
const {captureHandler,batchHandler}=require('../services/marketplaceHandler');
const {validId,listBatches,batchLinks,changeBatch}=require('../services/marketplaceBatchManagement');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clean=value=>String(value??'').trim();
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(value||{},k)).map(k=>[k,value[k]]));
function safeSettings(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Object.assign(new Error('轉檔設定格式無效'),{status:400});
 const value=pick(input,['salesExportMode','projectOwner','salesOwner','erpStaffCode','erpProjectCode','erpResponsibilityConfirmed','store','customerCode','customerName','warehouseCode','date','batchSequence','batchNumber','currency','taxMode','taxType','taxConfirmed','erpCurrencyCode','erpCurrencyConfirmed','includeTestOrders','bundleZeroConfirmed','discountAllocationConfirmed','summaryNote']);
 const booleans=new Set(['erpResponsibilityConfirmed','taxConfirmed','erpCurrencyConfirmed','includeTestOrders','bundleZeroConfirmed','discountAllocationConfirmed','barcodeConfirmed','confirmed','erpConfirmed','nonStock']);
 function validate(record){
  for(const [name,v] of Object.entries(record)){
   if(booleans.has(name)?typeof v!=='boolean':typeof v!=='string'||v.length>255||/[\u0000-\u001f\u007f]/.test(v))throw Object.assign(new Error('轉檔設定欄位格式或長度無效：'+name),{status:400});
  }
  return record;
 }
 validate(value);
 if(!input.skuMappings||typeof input.skuMappings!=='object'||Array.isArray(input.skuMappings)||Object.keys(input.skuMappings).length>1000)throw Object.assign(new Error('商品對照格式無效'),{status:400});
 value.skuMappings=Object.fromEntries(Object.entries(input?.skuMappings||{}).map(([sku,m])=>[sku,pick(m,['erpSku','erpName','spec','barcode','barcodeConfirmed','confirmed','erpConfirmed','category'])]));
 value.shippingSku=pick(input?.shippingSku,['erpSku','name','confirmed','nonStock']);
 for(const [sku,m] of Object.entries(value.skuMappings)){
  if(!sku||sku.length>100||!Object.keys(m).length)throw Object.assign(new Error('來源貨號或商品對照無效'),{status:400});
  validate(m);
  if(clean(m.erpSku).length>100||clean(m.barcode).length>100)throw Object.assign(new Error('商品編碼或條碼最多 100 字'),{status:400});
 }
 validate(value.shippingSku);
 return value;
}
const publicRecord=row=>({id:row.id,batchNumber:row.batch_number,platform:row.source_platform,store:row.source_store,createdAt:row.created_at,archivedAt:row.archived_at,...row.snapshot});
function createMarketplaceRouter({pool}){
 const router=express.Router();
 router.use(authorizeRoles('admin','dispatcher'));
 require('../services/marketplaceStoreProfiles').mountStoreProfiles(router,pool);
 router.get('/',async(req,res,next)=>{try{
  res.set('Cache-Control','private, no-store').json(await listBatches(pool,req.query));
 }catch(e){if(e.status)return res.status(e.status).json({message:e.message});next(e);}});
 router.get('/:id',async(req,res,next)=>{try{
  if(!validId(req.params.id))return res.status(400).json({message:'轉檔批次編號無效'});
  const rows=await pool.query('SELECT * FROM marketplace_intakes WHERE id=$1',[req.params.id]);
  if(!rows.rows.length)return res.status(404).json({message:'找不到轉檔批次'});
  let reviewWarning='';
  const snapshot=rows.rows[0].snapshot;
  try{await require('../services/marketplaceProductCatalog').verifyCatalogMappings(pool,snapshot.settings,[...new Set(snapshot.items.map(i=>i.sku))]);}catch(e){if(e.status===400)reviewWarning=e.message;else throw e;}
  let financials=null,financialWarning='';
  try{financials=(await import('../services/marketplaceIntake.mjs')).prepareEcountFinancials(snapshot).financials;}catch(e){financialWarning=e.message;}
  res.set('Cache-Control','private, no-store').json({financials,financialWarning,...publicRecord(rows.rows[0]),handler:await batchHandler(pool,rows.rows[0]),reviewWarning,links:await batchLinks(pool,req.params.id)});
 }catch(e){if(e.status)return res.status(e.status).json({message:e.message});next(e);}});
 router.post('/:id/download-link',async(req,res,next)=>{try{
  if(!validId(req.params.id))return res.status(400).json({message:'批次編號無效'});
  const record=(await pool.query('SELECT snapshot FROM marketplace_intakes WHERE id=$1',[req.params.id])).rows[0];
  if(!record)return res.status(404).json({message:'找不到轉檔批次'});
  if(['ecount','ecount-grouped'].includes(req.body?.kind)){
   await require('../services/marketplaceProductCatalog').verifyCatalogMappings(pool,record.snapshot.settings,[...new Set(record.snapshot.items.map(i=>i.sku))]);
   try{(await import('../services/marketplaceBatchFiles.mjs')).savedBatchTables(record.snapshot,req.body.kind);}catch(e){throw Object.assign(e,{status:400});}
  }
  require('../services/marketplaceDownloads').issueDownload(res,req.params.id,req.body?.kind,req.user.id);
 }catch(e){if(e.status)return res.status(e.status).json({message:e.message});next(e);}});
 for(const [method,path,action] of [['patch','/:id/archive','archive'],['patch','/:id/restore','restore'],['delete','/:id','delete']]){
  router[method](path,async(req,res,next)=>{try{
   res.json(await changeBatch(pool,req.params.id,action,req.user.id,req.body));
  }catch(e){if(e.status)return res.status(e.status).json({message:e.message});next(e);}});
 }
 router.post('/',async(req,res,next)=>{
  let db,open=false,commitAttempted=false,tainted=false;
  try{
   const {buildUnifiedConversion}=await import('../services/unifiedMarketplace.mjs');
   const settings=safeSettings(req.body?.settings);
   const conversion=buildUnifiedConversion(req.body?.rows,settings);
   const {parsed,output,source,raw}=conversion;
   await require('../services/marketplaceProductCatalog').verifyCatalogMappings(pool,settings,[...new Set(parsed.items.map(i=>i.sku))]);
   const identity=parsed.orders.map(o=>[o.sourcePlatform,clean(settings.store),o.sourceOrderNumber]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
   const fingerprint=hash({platform:source.platform,settings:{...settings,batchNumber:undefined},rows:source.rows});
   const snapshot={handler:captureHandler(req.user),settings,summary:output.summary,headers:output.headers,rows:output.rows,...(output.salesLayout?{salesLayout:output.salesLayout}:{}),reportHeaders:output.reportHeaders,reportRows:output.reportRows,
    orders:parsed.orders.map(o=>({...o,sourceFinancial:raw.orders.find(r=>r.sourceOrderNumber===o.sourceOrderNumber)?.financial})),items:parsed.items,
    prepick:{headers:conversion.prepick.headers,rows:conversion.prepick.rows}};
   db=await pool.connect();await db.query('BEGIN');open=true;
   await db.query("SET LOCAL lock_timeout='2000ms'");await db.query("SET LOCAL statement_timeout='10000ms'");
   for(const key of identity)await db.query("SELECT pg_advisory_xact_lock(hashtext('wms-marketplace-source'),hashtext($1))",[JSON.stringify(key)]);
   const existing=(await db.query('SELECT * FROM marketplace_intakes WHERE fingerprint=$1',[fingerprint])).rows[0];
   if(existing){await db.query('ROLLBACK');open=false;return res.status(200).json({...publicRecord(existing),reused:true});}
   for(const key of identity){
    const previous=(await db.query('SELECT intake_id FROM marketplace_intake_orders WHERE source_platform=$1 AND source_store=$2 AND source_order_number=$3',key)).rows[0];
    if(previous)throw Object.assign(new Error(`商城訂單 ${key[2]} 已保存於轉檔批次 #${previous.intake_id}，請開啟原批次，未重複轉銷貨`),{status:409,code:'MARKETPLACE_SOURCE_EXISTS'});
    const legacy=(await db.query('SELECT id FROM orders WHERE source_platform=$1 AND source_store=$2 AND source_order_number=$3 LIMIT 1',key)).rows[0];
    if(legacy)throw Object.assign(new Error(`商城訂單 ${key[2]} 已存在 WMS 工作單 #${legacy.id}，未再次轉銷貨`),{status:409,code:'MARKETPLACE_SOURCE_EXISTS'});
   }
   const record=(await db.query('INSERT INTO marketplace_intakes(batch_number,source_platform,source_store,fingerprint,created_by,snapshot) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[clean(settings.batchNumber),source.platform,clean(settings.store),fingerprint,req.user.id,JSON.stringify(snapshot)])).rows[0];
   for(const order of parsed.orders){
    const items=parsed.items.filter(i=>i.sourceOrderNumber===order.sourceOrderNumber).map(i=>({sourceLineId:i.sourceLineId,sourceSku:i.sku,productCode:clean(settings.skuMappings[i.sku].erpSku),productName:clean(settings.skuMappings[i.sku].erpName||i.productName),quantity:i.quantity,barcode:settings.skuMappings[i.sku].barcodeConfirmed===true?clean(settings.skuMappings[i.sku].barcode):'',groupName:i.groupName}));
    const physicalIds=new Set(items.map(i=>i.sourceLineId));
    const nonstock=output.rows.filter(r=>r[12]===order.sourceOrderNumber&&!physicalIds.has(r[15])).map(r=>({sourceLineId:r[15],productCode:r[11],quantity:r[19]}));
    await db.query('INSERT INTO marketplace_intake_orders(intake_id,source_platform,source_store,source_order_number,expected_items,nonstock_items,financial) VALUES($1,$2,$3,$4,$5,$6,$7)',[record.id,order.sourcePlatform,clean(settings.store),order.sourceOrderNumber,JSON.stringify(items),JSON.stringify(nonstock),JSON.stringify({source:raw.orders.find(r=>r.sourceOrderNumber===order.sourceOrderNumber).financial,ecount:order.financial})]);
   }
   await require('../services/warehouseRelease').enableFlow(db,record.id,req.user.id);
   commitAttempted=true;await db.query('COMMIT');open=false;
   res.status(201).json(publicRecord(record));
  }catch(e){
   if(open)try{await db.query('ROLLBACK');}catch{e.status=503;tainted=true;}
   if(commitAttempted)return res.status(503).json({code:'MARKETPLACE_RESULT_UNKNOWN',message:'保存結果尚未確認，請先重新讀取已保存批次，再以相同內容重試；不要改單號重送'});
   if(e.code==='23505')return res.status(409).json({code:'MARKETPLACE_ALREADY_EXISTS',message:'來源訂單或追蹤單號已存在，請查原批次，未重複保存'});
   if(['55P03','57014'].includes(e.code))return res.status(409).json({code:'MARKETPLACE_RETRY',message:'同一批訂單正在處理，請讀取已保存批次後重試'});
   if(e.status)return res.status(e.status).json({code:e.code,message:e.message,issues:e.issues});
   next(e);
  }finally{db?.release(tainted);}
 });
 return router;
}
module.exports={createMarketplaceRouter,safeSettings};
