const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {loadMigrationManifest}=require('../config/migrationManifest');
const {createUploadScope,uploadScopeFingerprint,scopeSourcePredicate,readIntakeSources,assertUploadScope,readSourceScopeIntakes,readSourceScopeActivity}=require('../services/marketplaceUploadScopes');

describe('upload scope membership and per-order version guards (local PGlite SQL)',()=>{
 let db,queries;
 const batch=async(number,snapshot={},platform='Shopify',store='test-store')=>(await db.query('INSERT INTO marketplace_intakes(batch_number,source_platform,source_store,snapshot) VALUES($1,$2,$3,$4) RETURNING *',[number,platform,store,JSON.stringify(snapshot)])).rows[0];
 const source=async(owner,number,version=0)=>(await db.query('INSERT INTO marketplace_intake_orders(intake_id,source_platform,source_store,source_order_number,draft_version) VALUES($1,$2,$3,$4,$5) RETURNING *',[owner.id,owner.source_platform,owner.source_store,number,version])).rows[0];
 const scope=async(run,sources)=>{
  const uploadScope=createUploadScope(sources);
  await db.query('UPDATE marketplace_intakes SET snapshot=$2 WHERE id=$1',[run.id,JSON.stringify({uploadScope})]);
  for(const entry of uploadScope.sourceManifest)await db.query('INSERT INTO marketplace_intake_scope_orders VALUES($1,$2,$3)',[run.id,entry.id,entry.version]);
  return {...run,snapshot:{uploadScope}};
 };
 const client=()=>({query:async(sql,args)=>{queries.push(sql);return db.query(sql,args);}});
 const stale=promise=>expect(promise).rejects.toMatchObject({status:409,code:'MARKETPLACE_UPLOAD_SCOPE_STALE'});
 beforeEach(async()=>{
  db=new PGlite();queries=[];
  await db.exec(`CREATE TABLE marketplace_intakes(id SERIAL PRIMARY KEY,batch_number TEXT NOT NULL UNIQUE,source_platform TEXT NOT NULL,source_store TEXT NOT NULL,snapshot JSONB NOT NULL,archived_at TIMESTAMPTZ);
   CREATE TABLE marketplace_intake_orders(id SERIAL PRIMARY KEY,intake_id INTEGER NOT NULL REFERENCES marketplace_intakes(id),source_platform TEXT NOT NULL,source_store TEXT NOT NULL,source_order_number TEXT NOT NULL,draft_active BOOLEAN NOT NULL DEFAULT TRUE,UNIQUE(source_platform,source_store,source_order_number));
   CREATE TABLE marketplace_warehouse_flows(intake_id INTEGER PRIMARY KEY REFERENCES marketplace_intakes(id),printed_at TIMESTAMPTZ,erp_confirmed_at TIMESTAMPTZ);
   CREATE TABLE marketplace_work_order_links(intake_order_id INTEGER PRIMARY KEY REFERENCES marketplace_intake_orders(id),order_id INTEGER);
   CREATE TABLE orders(id SERIAL PRIMARY KEY,source_platform TEXT,source_store TEXT,source_order_number TEXT);
   CREATE TABLE warehouse_import_batches(voucher_number TEXT);
   CREATE TABLE marketplace_warehouse_events(intake_id INTEGER,action TEXT);`);
  await db.exec(fs.readFileSync(require.resolve('../../migrations/042_marketplace_upload_scopes.sql'),'utf8'));
 });
 afterEach(async()=>{await db?.close();});

 test('migration is discovered automatically and defaults old sources to version zero',async()=>{
  expect(loadMigrationManifest().at(-1).name).toBe('042_marketplace_upload_scopes.sql');
  const owner=await batch('OLD'),saved=await source(owner,'#A');
  expect(saved.draft_version).toBe(0);
  await expect(db.query('UPDATE marketplace_intake_orders SET draft_version=-1 WHERE id=$1',[saved.id])).rejects.toMatchObject({code:'23514'});
  await expect(db.query('INSERT INTO marketplace_intake_scope_orders VALUES($1,$2,-1)',[owner.id,saved.id])).rejects.toMatchObject({code:'23514'});
 });

 test('manifest canonicalizes ordering and hashes recursively sorted keys with exact fields',async()=>{
  const a={id:2,intake_id:3,draft_version:4,source_order_number:'#B'},b={id:1,intake_id:2,draft_version:0,source_order_number:'#A'};
  const expected=[{id:1,ownerId:2,version:0,orderNumber:'#A'},{id:2,ownerId:3,version:4,orderNumber:'#B'}];
  expect(createUploadScope([a,b])).toEqual(createUploadScope([b,a]));
  expect(createUploadScope([a,b]).sourceManifest).toEqual(expected);
  const reversed=expected.map(({id,ownerId,version,orderNumber})=>({orderNumber,version,ownerId,id})).reverse();
  expect(uploadScopeFingerprint(reversed)).toBe(createUploadScope([a,b]).fingerprint);
  expect(()=>uploadScopeFingerprint([{...expected[0],extra:true}])).toThrow();
  expect(()=>createUploadScope([a,a])).toThrow();
  expect(()=>uploadScopeFingerprint([{...expected[0],version:'0'}])).toThrow();
 });

 test('legacy reads canonical owner with active filtering and optional inactive inspection',async()=>{
  const owner=await batch('OLD'),other=await batch('OTHER'),a=await source(owner,'#A'),b=await source(owner,'#B');await source(other,'#C');
  await db.query('UPDATE marketplace_intake_orders SET draft_active=FALSE WHERE id=$1',[b.id]);
  expect((await readIntakeSources(client(),owner.id)).map(row=>row.id)).toEqual([a.id]);
  expect((await readIntakeSources(client(),owner.id,{activeOnly:false})).map(row=>row.id)).toEqual([a.id,b.id]);
  expect(queries.join('\n')).not.toMatch(/profile|FOR UPDATE|pg_advisory/);
 });

 test('one run borrows an old source and owns a new source while preserving canonical owners',async()=>{
  const owner=await batch('OLD'),run=await batch('RUN'),old=await source(owner,'#A',2),outside=await source(owner,'#B'),fresh=await source(run,'#C'),runOutside=await source(run,'#D');
  const record=await scope(run,[fresh,old]);
  const rows=await assertUploadScope(client(),record);
  expect(rows.map(row=>[row.id,row.intake_id,row.draft_version])).toEqual([[old.id,owner.id,2],[fresh.id,run.id,0]]);
  expect(rows.some(row=>row.id===outside.id||row.id===runOutside.id)).toBe(false);
  expect(Object.keys(rows[0])).not.toEqual(expect.arrayContaining(['source_version','ownerId']));
  const counts=(await db.query(`SELECT i.id,(SELECT COUNT(*)::int FROM marketplace_intake_orders s WHERE ${scopeSourcePredicate('s','i.id')}) AS count FROM marketplace_intakes i ORDER BY i.id`)).rows;
  expect(counts).toEqual([{id:owner.id,count:2},{id:run.id,count:2}]);
 });

 test('scope declaration with missing ledger cannot fall back to owned rows',async()=>{
  const run=await batch('RUN'),a=await source(run,'#A');
  await db.query('UPDATE marketplace_intakes SET snapshot=$2 WHERE id=$1',[run.id,JSON.stringify({uploadScope:createUploadScope([a])})]);
  await stale(readIntakeSources(client(),run.id));
 });

 test('partial borrowing supersedes the complete legacy owner only for executable reads',async()=>{
  const owner=await batch('OLD'),run=await batch('RUN'),a=await source(owner,'#A'),b=await source(owner,'#B');
  const record=await scope(run,[a]);
  await expect(readIntakeSources(client(),owner.id)).rejects.toMatchObject({status:409,code:'MARKETPLACE_UPLOAD_SCOPE_STALE',message:expect.stringContaining('最新轉檔批次')});
  await stale(assertUploadScope(client(),owner));
  expect((await readIntakeSources(client(),owner.id,{validate:false})).map(row=>row.id)).toEqual([a.id,b.id]);
  expect((await assertUploadScope(client(),record)).map(row=>row.id)).toEqual([a.id]);
 });

 test('unrelated legacy owner and v1 revisions without scope references remain usable',async()=>{
  const owner=await batch('OLD'),unrelated=await batch('UNRELATED'),run=await batch('RUN'),a=await source(owner,'#A'),b=await source(unrelated,'#B',7);
  await scope(run,[a]);
  expect((await readIntakeSources(client(),unrelated.id)).map(row=>[row.id,row.draft_version])).toEqual([[b.id,7]]);
 });

 test('ledger without scope declaration cannot masquerade as legacy',async()=>{
  const owner=await batch('OLD'),run=await batch('RUN'),a=await source(owner,'#A');
  await db.query('INSERT INTO marketplace_intake_scope_orders VALUES($1,$2,0)',[run.id,a.id]);
  await stale(readIntakeSources(client(),run.id));
 });

 test('extra ledger members and missing ledger members are rejected',async()=>{
  const owner=await batch('OLD'),run=await batch('RUN'),a=await source(owner,'#A'),b=await source(owner,'#B');
  await scope(run,[a]);
  await db.query('INSERT INTO marketplace_intake_scope_orders VALUES($1,$2,0)',[run.id,b.id]);
  await stale(readIntakeSources(client(),run.id));
  await db.query('DELETE FROM marketplace_intake_scope_orders WHERE intake_order_id=$1',[a.id]);
  await stale(readIntakeSources(client(),run.id));
 });

 test.each(['source','membership'])('%s version drift makes the old scope stale',async(which)=>{
  const owner=await batch('OLD'),run=await batch('RUN'),a=await source(owner,'#A',1);await scope(run,[a]);
  if(which==='source')await db.query('UPDATE marketplace_intake_orders SET draft_version=2 WHERE id=$1',[a.id]);
  else await db.query('UPDATE marketplace_intake_scope_orders SET source_version=2 WHERE intake_id=$1',[run.id]);
  await stale(readIntakeSources(client(),run.id));
 });

 test('malformed scope, wrong hash, duplicate identities and noncanonical types cannot pass',async()=>{
  const owner=await batch('OLD'),run=await batch('RUN'),a=await source(owner,'#A'),record=await scope(run,[a]);
  for(const uploadScope of [null,{...record.snapshot.uploadScope,version:'unknown'},{...record.snapshot.uploadScope,fingerprint:'a'.repeat(64)},{...record.snapshot.uploadScope,sourceManifest:[...record.snapshot.uploadScope.sourceManifest,...record.snapshot.uploadScope.sourceManifest]},{...record.snapshot.uploadScope,sourceManifest:[{...record.snapshot.uploadScope.sourceManifest[0],version:'0'}]}]){
   await db.query('UPDATE marketplace_intakes SET snapshot=$2 WHERE id=$1',[run.id,JSON.stringify({uploadScope})]);
   await stale(readIntakeSources(client(),run.id));
  }
 });

 test.each(['source-store','source-platform','owner-store','owner-platform','owner-archived','run-archived','inactive','owner-id','order-number'])('%s mismatch cannot authorize a scope',async(mode)=>{
  const owner=await batch('OLD'),other=await batch('OTHER'),run=await batch('RUN'),a=await source(owner,'#A');await scope(run,[a]);
  if(mode==='source-store')await db.query("UPDATE marketplace_intake_orders SET source_store='other' WHERE id=$1",[a.id]);
  if(mode==='source-platform')await db.query("UPDATE marketplace_intake_orders SET source_platform='1Shop' WHERE id=$1",[a.id]);
  if(mode==='owner-store')await db.query("UPDATE marketplace_intakes SET source_store='other' WHERE id=$1",[owner.id]);
  if(mode==='owner-platform')await db.query("UPDATE marketplace_intakes SET source_platform='1Shop' WHERE id=$1",[owner.id]);
  if(mode==='owner-archived')await db.query('UPDATE marketplace_intakes SET archived_at=NOW() WHERE id=$1',[owner.id]);
  if(mode==='run-archived')await db.query('UPDATE marketplace_intakes SET archived_at=NOW() WHERE id=$1',[run.id]);
  if(mode==='inactive')await db.query('UPDATE marketplace_intake_orders SET draft_active=FALSE WHERE id=$1',[a.id]);
  if(mode==='owner-id')await db.query('UPDATE marketplace_intake_orders SET intake_id=$2 WHERE id=$1',[a.id,other.id]);
  if(mode==='order-number')await db.query("UPDATE marketplace_intake_orders SET source_order_number='#CHANGED' WHERE id=$1",[a.id]);
  await stale(readIntakeSources(client(),run.id,{activeOnly:false}));
 });

 test('supplied old snapshot cannot downgrade the current scope to legacy',async()=>{
  const owner=await batch('OLD'),run=await batch('RUN'),a=await source(owner,'#A');await scope(run,[a]);
  await stale(readIntakeSources(client(),run.id,{snapshot:{}}));
 });

 test('locking is explicit and takes only canonical row locks after caller locks',async()=>{
  const owner=await batch('OLD'),run=await batch('RUN'),a=await source(owner,'#A');await scope(run,[a]);
  await readIntakeSources(client(),run.id,{lock:true});
  expect(queries.filter(sql=>sql.includes('FOR UPDATE'))).toHaveLength(1);
  expect(queries.find(sql=>sql.includes('FOR UPDATE'))).toContain('FOR UPDATE OF s');
  expect(queries.join('\n')).not.toContain('pg_advisory');
  expect(()=>scopeSourcePredicate('s;DROP')).toThrow(TypeError);
  expect(()=>scopeSourcePredicate('s','$1 OR TRUE')).toThrow(TypeError);
  expect(()=>scopeSourcePredicate('s','i.id OR TRUE')).toThrow(TypeError);
  expect(()=>scopeSourcePredicate('s','i.other')).toThrow(TypeError);
  expect(()=>scopeSourcePredicate('s','i;DROP.id')).toThrow(TypeError);
  expect(scopeSourcePredicate('o','i.id')).toContain('scope_member.intake_id=i.id');
 });

 test('deleting a borrowed canonical source fails, deleting its scope cascades only membership',async()=>{
  const owner=await batch('OLD'),run=await batch('RUN'),a=await source(owner,'#A');await scope(run,[a]);
  await expect(db.query('DELETE FROM marketplace_intake_orders WHERE id=$1',[a.id])).rejects.toMatchObject({code:'23503'});
  await db.query('DELETE FROM marketplace_intakes WHERE id=$1',[run.id]);
  expect((await db.query('SELECT * FROM marketplace_intake_scope_orders')).rows).toEqual([]);
  expect((await db.query('SELECT id FROM marketplace_intake_orders')).rows).toEqual([{id:a.id}]);
 });

 test('activity includes every legacy owner and referencing run with full-scope tasks and stable context',async()=>{
  const owner=await batch('OLD'),run=await batch('RUN'),otherRun=await batch('OTHER-RUN'),outside=await batch('UNRELATED');
  const a=await source(owner,'#A'),b=await source(run,'#B'),c=await source(outside,'#C');
  await scope(run,[a,b]);await scope(otherRun,[a]);
  for(const id of [owner.id,run.id,otherRun.id])await db.query('INSERT INTO marketplace_warehouse_flows VALUES($1,NULL,NULL)',[id]);
  await db.query('INSERT INTO orders(source_platform,source_store,source_order_number) VALUES($1,$2,$3)',[b.source_platform,b.source_store,b.source_order_number]);
  await db.query("INSERT INTO marketplace_warehouse_events VALUES($1,'enable'),($2,'scan')",[owner.id,otherRun.id]);
  await db.query('INSERT INTO marketplace_work_order_links VALUES($1,77)',[a.id]);
  await db.query('INSERT INTO warehouse_import_batches VALUES($1)',[run.batch_number]);
  expect((await readSourceScopeIntakes(client(),[a.id])).map(row=>row.id)).toEqual([owner.id,run.id,otherRun.id]);
  const context=await readSourceScopeActivity(client(),[a.id]);
  expect(context.map(entry=>entry.batch.id)).toEqual([owner.id,run.id,otherRun.id]);
  expect(context[0].activity).toEqual({links:true,tasks:false,imports:false,events:false});
  expect(context[1].activity).toEqual({links:true,tasks:true,imports:true,events:false});
  expect(context[2].activity).toEqual({links:true,tasks:false,imports:false,events:true});
  expect(context[1].memberships.map(entry=>entry.intake_order_id)).toEqual([a.id,b.id]);
  expect(await readSourceScopeActivity(client(),[a.id])).toEqual(context);
  expect(queries.join('\n')).not.toMatch(/FOR UPDATE|pg_advisory/);
  expect(context.some(entry=>entry.batch.id===c.intake_id)).toBe(false);
 });

 test('all-new uploads have an empty prior-scope activity without issuing lookups',async()=>{
  expect(await readSourceScopeActivity(client(),[])).toEqual([]);
  expect(queries).toEqual([]);
 });
});
