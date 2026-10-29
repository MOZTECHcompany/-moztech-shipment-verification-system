const {randomUUID}=require('node:crypto');
const {readOrderImportRows,parseOrderRows,matchesSourceHeader}=require('./orderImportParser');
const {mutateFlow}=require('./warehouseRelease');
const {assertUploadScope}=require('./marketplaceUploadScopes');
const clean=v=>String(v??'').trim();
const fail=message=>Object.assign(new Error(message),{status:400});
const aliases={sourcePlatform:'平台',sourceStore:'店鋪',sourceOrderNumber:'商城訂單編號',sourceLineId:'來源明細號',productCode:'品項編碼',quantity:'數量',barcode:'國際條碼',internalScanCode:'內部掃描碼',sourceSku:'來源SKU',serials:'序號/批號',summary:'摘要'};
async function resolveUploadReturnScope(pool,identities,keys,found,requiredId){
 if(requiredId){
  const record=(await pool.query('SELECT * FROM marketplace_intakes WHERE id=$1',[Number(requiredId)])).rows[0];
  if(record?.snapshot?.uploadScope){await assertUploadScope(pool,record);return Number(record.id);}
  return null;
 }
 const candidates=(await pool.query(`WITH source_keys AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(platform text,store text,number text))
 SELECT DISTINCT m.intake_id AS id FROM marketplace_intake_scope_orders m JOIN marketplace_intake_orders s ON s.id=m.intake_order_id
 JOIN source_keys k ON s.source_platform=k.platform AND s.source_store=k.store AND s.source_order_number=k.number`,[JSON.stringify(keys)])).rows;
 const ids=[...new Set([...found,...candidates].map(row=>Number(row.id)))];
 const records=ids.length?(await pool.query('SELECT * FROM marketplace_intakes WHERE id=ANY($1::int[]) ORDER BY id',[ids])).rows:[];
 const valid=[];let referencedStale=null;
 for(const record of records){
  if(!record.snapshot?.uploadScope)continue;
  const manifest=record.snapshot.uploadScope.sourceManifest;
  const numbers=new Set(Array.isArray(manifest)?manifest.map(source=>source?.orderNumber):[]);
  const grouped=identities.every(([platform,store,number])=>platform===record.source_platform&&store===record.source_store&&number===record.batch_number);
  const exact=identities.length===numbers.size&&identities.every(([platform,store,number])=>platform===record.source_platform&&store===record.source_store&&numbers.has(number));
  if(!grouped&&!exact)continue;
  try{await assertUploadScope(pool,record);valid.push(Number(record.id));}
  catch(error){if(error.code!=='MARKETPLACE_UPLOAD_SCOPE_STALE')throw error;referencedStale=error;}
 }
 if(valid.length>1)throw fail('回匯檔案對應多個轉檔版本，請從這次轉檔的匯回入口上傳整份檔案');
 if(valid.length===1)return valid[0];
 if(referencedStale)throw referencedStale;
 return null;
}
function normalizeReturnRows(rows){
 const vouchers=['理貨單號','理貨單單號','理貨單編號','出貨單號','出貨單單號','ECOUNT實際銷貨單號'];
 const header=rows.findIndex(r=>r.some(v=>vouchers.includes(clean(v)))&&r.some(v=>matchesSourceHeader(v,'sourceLineId')));
 if(header<0)return null;
 const logistics=!rows[header].some(v=>clean(v)==='ECOUNT實際銷貨單號');
 const normalized=rows.slice(header).map(r=>[...r]);
 normalized[0]=normalized[0].map(v=>{
  if(vouchers.includes(clean(v)))return 'ECOUNT實際銷貨單號';
  return Object.entries(aliases).find(([k])=>matchesSourceHeader(v,k))?.[1]||clean(v);
 });
 for(const name of ['ECOUNT實際銷貨單號','平台','店鋪','商城訂單編號','來源明細號','品項編碼','數量'])if(normalized[0].filter(v=>v===name).length!==1)throw fail('回匯欄位缺漏或重複：'+name);
 return {rows:normalized,logistics};
}
async function importMarketplaceReturn(buffer,pool,requiredId,user){
 const raw=readOrderImportRows(buffer);
 const source=normalizeReturnRows(raw);
 if(!source)return null;
 // Validate native source sheets before a database lookup, preserving original
 // Excel cell metadata, row numbers and the existing SN grammar.
 const nativeHeader=raw.find(r=>r.some(v=>matchesSourceHeader(v,'voucherNumber')));
 if(nativeHeader&&nativeHeader.some(v=>matchesSourceHeader(v,'productName'))){
  try{parseOrderRows(raw);}catch(e){if(!/^第 \d+ 列：國際條碼必填/.test(e.message))throw e;}
 }
 const names=source.rows[0],get=(r,n)=>clean(r[names.indexOf(n)]);
 const identities=[...new Map(source.rows.slice(1).filter(r=>get(r,'來源明細號')).map(r=>{
  const identity=['平台','店鋪','商城訂單編號'].map(n=>get(r,n));return [JSON.stringify(identity),identity];
 })).values()];
 if(!identities.length)throw fail('回匯檔案沒有商品明細');
 if(identities.length>1000)throw fail('回匯訂單數量超過上限');
 const keys=identities.map(([platform,store,number])=>({platform,store,number}));
 const found=(await pool.query(`WITH source_keys AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(platform text,store text,number text))
 SELECT o.intake_id AS id FROM marketplace_intake_orders o JOIN source_keys k ON o.source_platform=k.platform AND o.source_store=k.store AND o.source_order_number=k.number
 UNION SELECT i.id FROM marketplace_intakes i JOIN source_keys k ON i.source_platform=k.platform AND i.source_store=k.store AND i.batch_number=k.number`,[JSON.stringify(keys)])).rows;
 const matches=new Set(found.map(r=>Number(r.id)));
 if(requiredId&&(!/^[1-9]\d{0,9}$/.test(String(requiredId))||Number(requiredId)>2147483647))throw fail('來源批次編號無效');
 const scopeId=await resolveUploadReturnScope(pool,identities,keys,found,requiredId);
 if(scopeId){matches.clear();matches.add(scopeId);}else if(requiredId)matches.add(Number(requiredId));
 if(!matches.size){
  if(!source.logistics||source.rows.slice(1).some(r=>get(r,'來源明細號').startsWith('AG-')))throw fail('找不到原商城轉檔批次，請核對平台、店鋪與來源編號');
  return null; // Original independent, non-marketplace imports retain their existing path.
 }
 if(matches.size!==1)throw fail('請從這次轉檔的「匯回 ECOUNT 理貨單」入口上傳整份檔案，以核對完整轉檔版本');
 const id=[...matches][0];
 try{return await mutateFlow(pool,id,source.logistics?'confirm-return':'confirm-sales',{rows:source.rows,savedSalesConfirmed:true,commandId:randomUUID(),expectedActorId:user.id},user);}catch(e){e.warehouseIntakeId=id;throw e;}
}
module.exports={normalizeReturnRows,importMarketplaceReturn,resolveUploadReturnScope};
