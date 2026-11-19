const {readOrderImportRows,parseOrderRows,SOURCE_HEADERS,sourceHeaderIndex,matchesSourceHeader,isEcountPickingExport,positivePickingQuantity,summaryRequiresExplicitSerials}=require('./orderImportParser');
const {readEcountPickingIdentities}=require('./ecountPickingIdentities');
const {normalizeSourceIdentity}=require('./orderSourceIdentity');
const clean=v=>String(v??'').trim();
const key=g=>JSON.stringify([clean(g.sourcePlatform),clean(g.sourceStore),clean(g.sourceOrderNumber)]);
const fail=(message,status=409)=>Object.assign(new Error(message),{status,code:'MARKETPLACE_IMPORT_MISMATCH'});
const columnsFor=header=>Object.fromEntries(Object.keys(SOURCE_HEADERS).map(field=>[field,header.findIndex(v=>matchesSourceHeader(v,field))]));
const getRecord=async(db,g)=>(await db.query('SELECT * FROM marketplace_intake_orders WHERE source_platform=$1 AND source_store=$2 AND source_order_number=$3',[clean(g.sourcePlatform),clean(g.sourceStore),clean(g.sourceOrderNumber)])).rows[0];
async function readSavedFreight(db, sourceOrders){
 if(!sourceOrders.size)return new Map();
 const identities=[...sourceOrders.values()];
 const records=(await db.query(`
  SELECT o.source_platform,o.source_store,o.source_order_number,o.intake_id,o.draft_active,o.nonstock_items
  FROM marketplace_intake_orders o
  JOIN unnest($1::text[],$2::text[],$3::text[]) AS s(platform,store,order_number)
    ON (o.source_platform,o.source_store,o.source_order_number)=(s.platform,s.store,s.order_number)
 `,[identities.map(o=>o.sourcePlatform),identities.map(o=>o.sourceStore),identities.map(o=>o.sourceOrderNumber)])).rows;
 return new Map(records.map(o=>[key({sourcePlatform:o.source_platform,sourceStore:o.source_store,sourceOrderNumber:o.source_order_number}),o]));
}
async function parseMarketplaceLinkedImport(buffer,db,requiredIntakeId){
 const data=readOrderImportRows(buffer),headerIndex=sourceHeaderIndex(data);
 if(headerIndex<0)return parseOrderRows(data);
 const columns=columnsFor(data[headerIndex]);
 const ecount=!requiredIntakeId&&isEcountPickingExport(data,headerIndex)
  ? await readEcountPickingIdentities(db,data.slice(headerIndex+1),columns):undefined;
 const sourceOrders=new Map(),sourceLines=[];
 for(let index=headerIndex+1;index<data.length;index++){
  const row=data[index],cell=field=>columns[field]<0?'':clean(row[columns[field]]);
  const identity={sourceOrderNumber:cell('sourceOrderNumber'),sourceLineId:cell('sourceLineId'),sourcePlatform:cell('sourcePlatform'),sourceStore:cell('sourceStore')};
  if(!Object.values(identity).every(Boolean))continue;
  let group;
  try{group=normalizeSourceIdentity(identity);}
  catch(error){throw fail(`第 ${index+1} 列：${error.message}`,400);}
  const sourceKey=key(group);
  sourceOrders.set(sourceKey,group);
  sourceLines.push({index,cell,group,sourceKey});
 }
 const records=await readSavedFreight(db,sourceOrders);
 const omittedSourceRows=new Map(),seen=new Set();
 for(const {index,cell,group,sourceKey} of sourceLines){
  const record=records.get(sourceKey);
  const fee=record?.nonstock_items?.find(item=>item.sourceLineId===group.sourceLineId);
  if(!fee)continue;
  if(record.draft_active===false||requiredIntakeId&&String(record.intake_id)!==String(requiredIntakeId)){
   throw fail(`第 ${index+1} 列：運費來源明細不屬於本次轉檔批次，未匯入`);
  }
  const lineKey=JSON.stringify([sourceKey,group.sourceLineId]);
  if(seen.has(lineKey))throw fail(`第 ${index+1} 列：運費來源明細重複，未匯入`);
  seen.add(lineKey);
  const productCode=cell('productCode'),barcode=cell('barcode');
  let quantity;
  try{quantity=positivePickingQuantity(cell('quantity'));}
  catch(error){throw fail(`第 ${index+1} 列：${error.message}`,400);}
  if(fee.productCode!==productCode||quantity!==fee.quantity||(barcode&&barcode!==productCode)||
   cell('internalScanCode')||cell('serials')||cell('actualSN')||cell('cartonId')||summaryRequiresExplicitSerials(cell('summary'),productCode,quantity)){
   throw fail(`第 ${index+1} 列：非庫存運費與已保存轉檔資料不同，未匯入`);
  }
  omittedSourceRows.set(index,{voucherNumber:cell('voucherNumber'),...group,productCode,productName:cell('productName'),quantity,sourceRow:index+1});
 }
 const parsed=parseOrderRows(data,{ecount,omittedSourceRows});
 return {...parsed,omittedNonStock:parsed.omittedNonStock||[]};
}
function compareMarketplaceItems(expected,actual,number){
 if(expected.length!==actual.length)throw fail(`商城訂單 ${number} 的商品明細列數與轉檔資料不同，未建立工作單`);
 const received=new Map(actual.map(i=>[i.sourceLineId,i]));
 for(const item of expected){
  const got=received.get(item.sourceLineId);
  if(!got||got.productCode!==item.productCode||got.quantity!==item.quantity||(item.barcode&&got.barcode!==item.barcode))throw fail(`商城訂單 ${number} 的明細 ${item.sourceLineId} 在品項、數量或條碼上不一致，請核對 ECOUNT 匯出`);
 }
}
async function matchMarketplaceWorkOrders(db,groups,requiredIntakeId,omittedNonStock=[]){
 if(requiredIntakeId&&(!/^[1-9]\d{0,9}$/.test(String(requiredIntakeId))||Number(requiredIntakeId)>2147483647))throw fail('來源轉檔批次編號無效',400);
 const results=new Map();
 const ordered=[...groups].filter(g=>g.sourceOrderNumber).sort((a,b)=>key(a).localeCompare(key(b)));
 for(const group of ordered)await db.query("SELECT pg_advisory_xact_lock(hashtext('wms-marketplace-source'),hashtext($1))",[key(group)]);
 for(const group of ordered){
  const record=await getRecord(db,group);
  if(!record){if(requiredIntakeId)throw fail(`商城訂單 ${group.sourceOrderNumber} 找不到對應轉檔資料，請核對平台、店鋪與訂單號`);continue;}
  if(record.draft_active===false)throw fail(`商城訂單 ${group.sourceOrderNumber} 已由新版移出本次出貨，請使用最新版銷貨檔`);
  if((await db.query('SELECT 1 FROM marketplace_intake_scope_orders WHERE intake_order_id=$1 LIMIT 1',[record.id])).rowCount)throw fail('此訂單已納入整份轉檔版本，請從最新轉檔批次回匯 ECOUNT 理貨單');
  if(requiredIntakeId&&Number(record.intake_id)!==Number(requiredIntakeId))throw fail(`商城訂單 ${group.sourceOrderNumber} 不屬於指定轉檔批次`);
  if ((await db.query('SELECT 1 FROM marketplace_warehouse_flows WHERE intake_id=$1',[record.intake_id])).rowCount)throw fail('本批使用銷貨核對流程，請由批次頁回傳 ECOUNT 銷貨結果；不可用舊理貨入口繞過核對');
  await db.query('SELECT id FROM marketplace_intake_orders WHERE id=$1 FOR UPDATE',[record.id]);
  const linked=(await db.query('SELECT order_id FROM marketplace_work_order_links WHERE intake_order_id=$1',[record.id])).rows[0];
  if(linked)throw fail(`商城訂單 ${group.sourceOrderNumber} 已建立過 WMS 工作單，未重複匯入`);
  compareMarketplaceItems(record.expected_items,group.items,group.sourceOrderNumber);
  results.set(key(group),record);
 }
 // Recheck omitted fees under the source locks. Each must belong to a
 // matched source order represented by physical work in this import.
 for(const fee of omittedNonStock){
  if(!fee.sourceLineId)continue;
  const saved=results.get(key(fee))?.nonstock_items?.find(item=>item.sourceLineId===fee.sourceLineId);
  if(!saved||saved.productCode!==fee.productCode||saved.quantity!==fee.quantity)throw fail('運費來源或已保存轉檔資料已變更，請核對原批次後再匯入');
 }
 if(requiredIntakeId){
  const count=(await db.query('SELECT COUNT(*)::int AS count FROM marketplace_intake_orders WHERE intake_id=$1 AND draft_active=TRUE',[requiredIntakeId])).rows[0].count;
  if(!count||count!==groups.length||results.size!==groups.length)throw fail('理貨單未包含指定轉檔批次的全部訂單，請核對是否漏單或選錯批次');
 }
 if(!requiredIntakeId&&results.size){
  if(results.size!==groups.length)throw fail('此理貨單混有已轉檔與未對應的訂單，請核對所有來源，不會部分建立工作單');
  const counts=new Map();
  for(const record of results.values())counts.set(record.intake_id,(counts.get(record.intake_id)||0)+1);
  for(const [id,received] of counts){
   const expected=(await db.query('SELECT COUNT(*)::int AS count FROM marketplace_intake_orders WHERE intake_id=$1 AND draft_active=TRUE',[id])).rows[0].count;
   if(expected!==received)throw fail(`轉檔批次 #${id} 的訂單未全部回匯，請核對是否漏單`);
  }
 }
 return results;
}
module.exports={parseMarketplaceLinkedImport,compareMarketplaceItems,matchMarketplaceWorkOrders,marketplaceSourceKey:key};
