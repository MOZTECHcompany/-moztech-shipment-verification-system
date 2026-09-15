const {readOrderImportRows,parseOrderRows,SOURCE_HEADERS,sourceHeaderIndex,matchesSourceHeader}=require('./orderImportParser');
const {normalizeSourceIdentity}=require('./orderSourceIdentity');
const clean=v=>String(v??'').trim();
const key=g=>JSON.stringify([clean(g.sourcePlatform),clean(g.sourceStore),clean(g.sourceOrderNumber)]);
const fail=(message,status=409)=>Object.assign(new Error(message),{status,code:'MARKETPLACE_IMPORT_MISMATCH'});
const columnsFor=header=>Object.fromEntries(Object.keys(SOURCE_HEADERS).map(field=>[field,header.findIndex(v=>matchesSourceHeader(v,field))]));
const getRecord=async(db,g)=>(await db.query('SELECT * FROM marketplace_intake_orders WHERE source_platform=$1 AND source_store=$2 AND source_order_number=$3',[clean(g.sourcePlatform),clean(g.sourceStore),clean(g.sourceOrderNumber)])).rows[0];
async function parseMarketplaceLinkedImport(buffer,db,requiredIntakeId){
 const data=readOrderImportRows(buffer),headerIndex=sourceHeaderIndex(data);
 if(headerIndex<0)return parseOrderRows(data);
 try {
  const parsed=parseOrderRows(data);
  if(!requiredIntakeId)return {...parsed,omittedNonStock:[]};
 } catch(error) {
  if(!/^第 \d+ 列：國際條碼必填/.test(error.message))throw error;
 }
 const columns=columnsFor(data[headerIndex]);
 const cache=new Map(),omittedNonStock=[],seenNonStock=new Set();
 const filtered=data.map(r=>[...r]);
 for(let i=headerIndex+1;i<data.length;i++){
  const row=data[i],cell=field=>columns[field]<0?'':clean(row[columns[field]]);
  if(!cell('sourceOrderNumber')||!cell('sourceLineId')||!cell('sourcePlatform')||!cell('sourceStore'))continue;
  const group=normalizeSourceIdentity({sourcePlatform:cell('sourcePlatform'),sourceStore:cell('sourceStore'),sourceOrderNumber:cell('sourceOrderNumber'),sourceLineId:cell('sourceLineId')});
  const k=key(group);if(!cache.has(k))cache.set(k,await getRecord(db,group));
  const record=cache.get(k);if(!record)continue;
  const nonstock=record.nonstock_items.find(item=>item.sourceLineId===group.sourceLineId);
  if(nonstock){
   const lineKey=JSON.stringify([k,group.sourceLineId]);
   if(seenNonStock.has(lineKey))throw fail(`第 ${i+1} 列：運費來源明細重複，未匯入`);
   seenNonStock.add(lineKey);
   if(nonstock.productCode!==cell('productCode')||Number(cell('quantity'))!==nonstock.quantity||cell('serials')||cell('summary'))throw fail(`第 ${i+1} 列：非庫存運費與已保存轉檔資料不同，未匯入`);
   omittedNonStock.push({voucherNumber:cell('voucherNumber'),sourceOrderNumber:group.sourceOrderNumber,sourceLineId:group.sourceLineId,productCode:nonstock.productCode,quantity:nonstock.quantity});
   filtered[i]=[];
  }
 }
 const parsed=parseOrderRows(filtered);
 if(omittedNonStock.some(item=>item.voucherNumber!==parsed.voucherNumber))throw fail('運費與商品不屬於同一張理貨單，未匯入');
 return {...parsed,omittedNonStock};
}
function compareMarketplaceItems(expected,actual,number){
 if(expected.length!==actual.length)throw fail(`商城訂單 ${number} 的商品明細列數與轉檔資料不同，未建立工作單`);
 const received=new Map(actual.map(i=>[i.sourceLineId,i]));
 for(const item of expected){
  const got=received.get(item.sourceLineId);
  if(!got||got.productCode!==item.productCode||got.quantity!==item.quantity||(item.barcode&&got.barcode!==item.barcode))throw fail(`商城訂單 ${number} 的明細 ${item.sourceLineId} 在品項、數量或條碼上不一致，請核對 ECOUNT 匯出`);
 }
}
async function matchMarketplaceWorkOrders(db,groups,requiredIntakeId){
 if(requiredIntakeId&&(!/^[1-9]\d{0,9}$/.test(String(requiredIntakeId))||Number(requiredIntakeId)>2147483647))throw fail('來源轉檔批次編號無效',400);
 const results=new Map();
 const ordered=[...groups].filter(g=>g.sourceOrderNumber).sort((a,b)=>key(a).localeCompare(key(b)));
 for(const group of ordered)await db.query("SELECT pg_advisory_xact_lock(hashtext('wms-marketplace-source'),hashtext($1))",[key(group)]);
 for(const group of ordered){
  const record=await getRecord(db,group);
  if(!record){if(requiredIntakeId)throw fail(`商城訂單 ${group.sourceOrderNumber} 找不到對應轉檔資料，請核對平台、店鋪與訂單號`);continue;}
  if(requiredIntakeId&&Number(record.intake_id)!==Number(requiredIntakeId))throw fail(`商城訂單 ${group.sourceOrderNumber} 不屬於指定轉檔批次`);
  await db.query('SELECT id FROM marketplace_intake_orders WHERE id=$1 FOR UPDATE',[record.id]);
  const linked=(await db.query('SELECT order_id FROM marketplace_work_order_links WHERE intake_order_id=$1',[record.id])).rows[0];
  if(linked)throw fail(`商城訂單 ${group.sourceOrderNumber} 已建立過 WMS 工作單，未重複匯入`);
  compareMarketplaceItems(record.expected_items,group.items,group.sourceOrderNumber);
  results.set(key(group),record);
 }
 if(requiredIntakeId){
  const count=(await db.query('SELECT COUNT(*)::int AS count FROM marketplace_intake_orders WHERE intake_id=$1',[requiredIntakeId])).rows[0].count;
  if(!count||count!==groups.length||results.size!==groups.length)throw fail('理貨單未包含指定轉檔批次的全部訂單，請核對是否漏單或選錯批次');
 }
 if(!requiredIntakeId&&results.size){
  if(results.size!==groups.length)throw fail('此理貨單混有已轉檔與未對應的訂單，請核對所有來源，不會部分建立工作單');
  const counts=new Map();
  for(const record of results.values())counts.set(record.intake_id,(counts.get(record.intake_id)||0)+1);
  for(const [id,received] of counts){
   const expected=(await db.query('SELECT COUNT(*)::int AS count FROM marketplace_intake_orders WHERE intake_id=$1',[id])).rows[0].count;
   if(expected!==received)throw fail(`轉檔批次 #${id} 的訂單未全部回匯，請核對是否漏單`);
  }
 }
 return results;
}
module.exports={parseMarketplaceLinkedImport,compareMarketplaceItems,matchMarketplaceWorkOrders,marketplaceSourceKey:key};
