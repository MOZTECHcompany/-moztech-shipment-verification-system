const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {resolveUploadReturnScope}=require('../services/marketplaceReturnImport');
const {createUploadScope,assertUploadScope}=require('../services/marketplaceUploadScopes');

describe('ECOUNT return resolves the exact uploaded-file scope across canonical owners (local SQL)',()=>{
 let db,pool,queries,ownerA,ownerB,run,a,b;
 const batch=async(number)=>(await db.query("INSERT INTO marketplace_intakes(batch_number,source_platform,source_store,snapshot) VALUES($1,'Shopify','test-store','{}') RETURNING *",[number])).rows[0];
 const source=async(owner,number)=>(await db.query("INSERT INTO marketplace_intake_orders(intake_id,source_platform,source_store,source_order_number) VALUES($1,'Shopify','test-store',$2) RETURNING *",[owner.id,number])).rows[0];
 const saveScope=async(record,sources)=>{
  const uploadScope=createUploadScope(sources);
  await db.query('UPDATE marketplace_intakes SET snapshot=$2 WHERE id=$1',[record.id,JSON.stringify({uploadScope})]);
  for(const entry of uploadScope.sourceManifest)await db.query('INSERT INTO marketplace_intake_scope_orders VALUES($1,$2,$3)',[record.id,entry.id,entry.version]);
  return {...record,snapshot:{uploadScope}};
 };
 const identity=number=>['Shopify','test-store',number];
 const resolve=async(identities,requiredId)=>{
  const keys=identities.map(([platform,store,number])=>({platform,store,number}));
  const found=(await pool.query(`WITH source_keys AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(platform text,store text,number text))
   SELECT o.intake_id AS id FROM marketplace_intake_orders o JOIN source_keys k ON o.source_platform=k.platform AND o.source_store=k.store AND o.source_order_number=k.number
   UNION SELECT i.id FROM marketplace_intakes i JOIN source_keys k ON i.source_platform=k.platform AND i.source_store=k.store AND i.batch_number=k.number`,[JSON.stringify(keys)])).rows;
  return resolveUploadReturnScope(pool,identities,keys,found,requiredId);
 };
 beforeEach(async()=>{
  db=new PGlite();queries=[];
  await db.exec(`CREATE TABLE marketplace_intakes(id SERIAL PRIMARY KEY,batch_number TEXT UNIQUE,source_platform TEXT,source_store TEXT,snapshot JSONB,archived_at TIMESTAMPTZ);
   CREATE TABLE marketplace_intake_orders(id SERIAL PRIMARY KEY,intake_id INTEGER REFERENCES marketplace_intakes(id),source_platform TEXT,source_store TEXT,source_order_number TEXT,draft_active BOOLEAN NOT NULL DEFAULT TRUE);`);
  await db.exec(fs.readFileSync(require.resolve('../../migrations/042_marketplace_upload_scopes.sql'),'utf8'));
  pool={query:async(sql,args)=>{queries.push(sql);if(!/^(?:SELECT|WITH)\b/.test(sql))throw Error('Return resolver must remain read-only');return db.query(sql,args);}};
  ownerA=await batch('OWNER-A');ownerB=await batch('OWNER-B');run=await batch('RUN-CURRENT');
  a=await source(ownerA,'#A');b=await source(ownerB,'#B');run=await saveScope(run,[a,b]);
 });
 afterEach(async()=>{await db.close();});

 test('ungrouped exact complete order identities select one current run across two original owners',async()=>{
  expect(await resolve([identity('#B'),identity('#A')])).toBe(run.id);
  expect((await db.query('SELECT id,intake_id FROM marketplace_intake_orders ORDER BY id')).rows).toEqual([{id:a.id,intake_id:ownerA.id},{id:b.id,intake_id:ownerB.id}]);
  expect(queries.some(sql=>/FOR UPDATE|pg_advisory|^(?:UPDATE|INSERT|DELETE)/.test(sql))).toBe(false);
 });
 test('grouped AG layout uses the current run batch identity rather than original owner numbers',async()=>{
  expect(await resolve([identity(run.batch_number)])).toBe(run.id);
 });
 test('explicit current-run entry validates membership and version without moving canonical ownership',async()=>{
  expect(await resolve([identity('#A'),identity('#B')],String(run.id))).toBe(run.id);
 });
 test('missing or extra original orders cannot auto-select a full scope, and the old owner is superseded',async()=>{
  expect(await resolve([identity('#A')])).toBeNull();
  expect(await resolve([identity('#A'),identity('#B'),identity('#FOREIGN')])).toBeNull();
  await expect(assertUploadScope(pool,ownerA)).rejects.toMatchObject({status:409,code:'MARKETPLACE_UPLOAD_SCOPE_STALE'});
 });
 test.each(['store','platform','order'])('foreign %s identity cannot be attributed to this scope',async(which)=>{
  const identities=[identity('#A'),identity('#B')];
  if(which==='store')identities[1][1]='another-store';
  if(which==='platform')identities[1][0]='SHOPLINE';
  if(which==='order')identities[1][2]='#UNKNOWN';
  expect(await resolve(identities)).toBeNull();
 });
 test('stale old run is skipped when a unique exact current run exists, but explicit old run fails',async()=>{
  await db.exec('UPDATE marketplace_intake_orders SET draft_version=1');
  const fresh=(await db.query('SELECT * FROM marketplace_intake_orders ORDER BY id')).rows,newRun=await saveScope(await batch('RUN-NEXT'),fresh);
  expect(await resolve([identity('#A'),identity('#B')])).toBe(newRun.id);
  expect(await resolve([identity(newRun.batch_number)])).toBe(newRun.id);
  await expect(resolve([identity('#A'),identity('#B')],run.id)).rejects.toMatchObject({status:409,code:'MARKETPLACE_UPLOAD_SCOPE_STALE'});
  await expect(resolve([identity(run.batch_number)])).rejects.toMatchObject({status:409,code:'MARKETPLACE_UPLOAD_SCOPE_STALE'});
 });
 test('two valid candidate scopes with identical order membership fail closed instead of choosing newest',async()=>{
  const duplicate=await saveScope(await batch('RUN-AMBIGUOUS'),[a,b]);
  await expect(resolve([identity('#A'),identity('#B')])).rejects.toMatchObject({status:400,message:expect.stringContaining('多個轉檔版本')});
  expect(await resolve([identity(duplicate.batch_number)])).toBe(duplicate.id);
 });
 test.each(['inactive','archived-owner','changed-version','missing-membership','corrupt-fingerprint'])('%s cannot produce a current return scope',async(which)=>{
  if(which==='inactive')await db.query('UPDATE marketplace_intake_orders SET draft_active=FALSE WHERE id=$1',[a.id]);
  if(which==='archived-owner')await db.query('UPDATE marketplace_intakes SET archived_at=NOW() WHERE id=$1',[ownerA.id]);
  if(which==='changed-version')await db.query('UPDATE marketplace_intake_orders SET draft_version=1 WHERE id=$1',[a.id]);
  if(which==='missing-membership')await db.query('DELETE FROM marketplace_intake_scope_orders WHERE intake_order_id=$1',[a.id]);
  if(which==='corrupt-fingerprint')await db.query("UPDATE marketplace_intakes SET snapshot=jsonb_set(snapshot,'{uploadScope,fingerprint}',$2::jsonb) WHERE id=$1",[run.id,JSON.stringify('a'.repeat(64))]);
  await expect(resolve([identity('#A'),identity('#B')])).rejects.toMatchObject({status:409,code:'MARKETPLACE_UPLOAD_SCOPE_STALE'});
 });
 test.each([['object',{}],['null',null],['invalid-entry',[null]]])('malformed %s manifest grouped return fails with structured409 instead of a map error',async(_label,manifest)=>{
  await db.query("UPDATE marketplace_intakes SET snapshot=jsonb_set(snapshot,'{uploadScope,sourceManifest}',$2::jsonb) WHERE id=$1",[run.id,JSON.stringify(manifest)]);
  await expect(resolve([identity(run.batch_number)])).rejects.toMatchObject({status:409,code:'MARKETPLACE_UPLOAD_SCOPE_STALE'});
 });
 test('ordinary legacy input without any uploaded scope leaves resolution to its existing path',async()=>{
  const legacy=await batch('UNRELATED-LEGACY');await source(legacy,'#LEGACY');
  expect(await resolve([identity('#LEGACY')])).toBeNull();
  expect(await resolve([identity('#LEGACY')],legacy.id)).toBeNull();
 });
});
