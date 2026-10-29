const {createHash}=require('node:crypto');

const VERSION='uploaded-file-v2';
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const integer=(value,min=1)=>Number.isInteger(value)&&value>=min&&value<=2147483647;
const fail=(message='本次訂單版本已更新或關聯不完整，請重新核對並產檔')=>Object.assign(new Error(message),{status:409,code:'MARKETPLACE_UPLOAD_SCOPE_STALE'});
const need=value=>{if(!value)throw fail();};
function canonical(value){
 if(value instanceof Date)return value.toISOString();
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function normalizedManifest(manifest){
 need(Array.isArray(manifest)&&manifest.length>0);
 const ids=new Set(),numbers=new Set();
 const result=manifest.map(entry=>{
  need(entry&&typeof entry==='object'&&!Array.isArray(entry)&&Object.keys(entry).sort().join(',')==='id,orderNumber,ownerId,version');
  const {id,ownerId,version,orderNumber}=entry;
  need(integer(id)&&integer(ownerId)&&integer(version,0)&&typeof orderNumber==='string'&&orderNumber.length>0&&orderNumber.length<=100&&orderNumber.trim()===orderNumber);
  need(!ids.has(id)&&!numbers.has(orderNumber));ids.add(id);numbers.add(orderNumber);
  return {id,ownerId,version,orderNumber};
 });
 return result.sort((a,b)=>a.orderNumber<b.orderNumber?-1:a.orderNumber>b.orderNumber?1:a.id-b.id);
}
function uploadScopeFingerprint(manifest){return digest(normalizedManifest(manifest));}
function createUploadScope(sources){
 need(Array.isArray(sources));
 const sourceManifest=normalizedManifest(sources.map(source=>({id:source.id,ownerId:source.intake_id,version:source.draft_version,orderNumber:source.source_order_number})));
 return {version:VERSION,sourceManifest,fingerprint:uploadScopeFingerprint(sourceManifest)};
}

// This predicate selects scope membership when present, otherwise the original
// canonical owner. Validation below rejects a declared scope with no ledger.
function scopeSourcePredicate(alias='s',parameter='$1'){
 if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)||!(/^(?:\$[1-9]\d*|[A-Za-z_][A-Za-z0-9_]*\.id)$/.test(parameter)))throw new TypeError('Invalid scope SQL identifier');
 return `(EXISTS (SELECT 1 FROM marketplace_intake_scope_orders scope_member WHERE scope_member.intake_id=${parameter} AND scope_member.intake_order_id=${alias}.id) OR (NOT EXISTS (SELECT 1 FROM marketplace_intake_scope_orders scope_empty WHERE scope_empty.intake_id=${parameter}) AND ${alias}.intake_id=${parameter}))`;
}
async function memberships(db,id){
 return (await db.query('SELECT intake_id,intake_order_id,source_version FROM marketplace_intake_scope_orders WHERE intake_id=$1 ORDER BY intake_order_id',[id])).rows;
}
function declaredScope(snapshot){return own(snapshot,'uploadScope');}
function validateScopeShape(snapshot){
 const scope=snapshot?.uploadScope;
 need(scope&&typeof scope==='object'&&!Array.isArray(scope)&&scope.version===VERSION&&typeof scope.fingerprint==='string'&&/^[a-f0-9]{64}$/.test(scope.fingerprint));
 const manifest=normalizedManifest(scope.sourceManifest);
 need(scope.fingerprint===uploadScopeFingerprint(manifest));
 return manifest;
}

async function readIntakeSources(db,intakeId,{snapshot,activeOnly=true,validate=true,lock=false}={}){
 const id=Number(intakeId);need(integer(id));
 const record=(await db.query('SELECT * FROM marketplace_intakes WHERE id=$1',[id])).rows[0];need(record);
 const effective=snapshot===undefined?record.snapshot:snapshot;
 if(validate&&snapshot!==undefined)need(declaredScope(snapshot)===declaredScope(record.snapshot)&&digest(snapshot?.uploadScope??null)===digest(record.snapshot?.uploadScope??null));
 const ledger=await memberships(db,id),scoped=declaredScope(effective);
 if(validate)need(scoped?ledger.length>0:ledger.length===0);
 const rows=(await db.query(`SELECT s.* FROM marketplace_intake_orders s WHERE ${scopeSourcePredicate('s','$1')}${!scoped&&activeOnly?' AND s.draft_active=TRUE':''} ORDER BY s.id${lock?' FOR UPDATE OF s':''}`,[id])).rows;
 if(!validate)return activeOnly?rows.filter(source=>source.draft_active!==false):rows;
 if(!scoped){
  const borrowed=(await db.query(`SELECT EXISTS(SELECT 1 FROM marketplace_intake_scope_orders m JOIN marketplace_intake_orders s ON s.id=m.intake_order_id WHERE s.intake_id=$1) AS borrowed`,[id])).rows[0];
  need(borrowed&&typeof borrowed.borrowed==='boolean');
  if(borrowed.borrowed)throw fail('原批次已有新的整份轉檔版本，請從最新轉檔批次接續下載與回匯');
  return rows;
 }
 const manifest=validateScopeShape(effective);
 need(!record.archived_at&&manifest.length===ledger.length&&manifest.length===rows.length);
 const owners=(await db.query('SELECT id,source_platform,source_store,archived_at FROM marketplace_intakes WHERE id=ANY($1::int[]) ORDER BY id',[[...new Set(rows.map(source=>source.intake_id))]])).rows;
 const ownerById=new Map(owners.map(owner=>[owner.id,owner])),sourceById=new Map(rows.map(source=>[source.id,source])),ledgerById=new Map(ledger.map(member=>[member.intake_order_id,member]));
 for(const entry of manifest){
  const source=sourceById.get(entry.id),member=ledgerById.get(entry.id),owner=ownerById.get(entry.ownerId);
  need(source&&member&&owner&&!owner.archived_at&&source.draft_active===true&&source.intake_id===entry.ownerId&&source.draft_version===entry.version&&source.source_order_number===entry.orderNumber&&member.source_version===entry.version&&member.intake_id===id&&source.source_platform===record.source_platform&&source.source_store===record.source_store&&owner.source_platform===record.source_platform&&owner.source_store===record.source_store);
 }
 return rows;
}
async function assertUploadScope(db,record,{lock=false}={}){
 need(record&&integer(Number(record.id)));
 return readIntakeSources(db,record.id,{snapshot:record.snapshot,lock});
}

function sourceIds(values){
 need(Array.isArray(values)&&values.every(value=>integer(value)));
 return [...new Set(values)].sort((a,b)=>a-b);
}
async function readSourceScopeIntakes(db,selectedSourceIds){
 const ids=sourceIds(selectedSourceIds);
 if(!ids.length)return [];
 return (await db.query(`SELECT i.* FROM marketplace_intakes i WHERE i.id IN (
  SELECT s.intake_id FROM marketplace_intake_orders s WHERE s.id=ANY($1::int[])
  UNION SELECT m.intake_id FROM marketplace_intake_scope_orders m WHERE m.intake_order_id=ANY($1::int[])
 ) ORDER BY i.id`,[ids])).rows;
}
// No row/advisory locks are acquired here. The caller owns the shared source ->
// batch -> flow lock order, and re-reads this stable activity context under it.
async function readSourceScopeActivity(db,selectedSourceIds){
 const batches=await readSourceScopeIntakes(db,selectedSourceIds),result=[];
 for(const batch of batches){
  const flow=(await db.query('SELECT * FROM marketplace_warehouse_flows WHERE intake_id=$1',[batch.id])).rows[0]||null;
  const ledger=await memberships(db,batch.id);
  const activity=(await db.query(`SELECT
   EXISTS(SELECT 1 FROM marketplace_work_order_links l JOIN marketplace_intake_orders s ON s.id=l.intake_order_id WHERE ${scopeSourcePredicate('s','$1')}) AS links,
   EXISTS(SELECT 1 FROM orders o JOIN marketplace_intake_orders s ON s.source_platform=o.source_platform AND s.source_store=o.source_store AND s.source_order_number=o.source_order_number WHERE ${scopeSourcePredicate('s','$1')}) AS tasks,
   EXISTS(SELECT 1 FROM warehouse_import_batches WHERE voucher_number=$2) AS imports,
   EXISTS(SELECT 1 FROM marketplace_warehouse_events WHERE intake_id=$1 AND action<>'enable') AS events`,[batch.id,batch.batch_number])).rows[0];
  need(activity&&['links','tasks','imports','events'].every(key=>typeof activity[key]==='boolean'));
  result.push({batch,flow,memberships:ledger,activity});
 }
 return result;
}

module.exports={VERSION,createUploadScope,uploadScopeFingerprint,scopeSourcePredicate,readIntakeSources,assertUploadScope,readSourceScopeIntakes,readSourceScopeActivity};
