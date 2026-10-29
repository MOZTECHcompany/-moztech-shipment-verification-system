const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {Pool,Client}=require('pg');
const XLSX=require('xlsx');
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('mixed CSV native transaction, scoped ERP return and prepick release', {skip:process.env.WMS_MIXED_NATIVE_TEST!=='1',timeout:120000},async t=>{
 const database=process.env.WMS_TEST_PG_DATABASE,port=Number(process.env.WMS_TEST_PG_PORT),directory=path.resolve(process.env.WMS_TEST_PG_DATA_DIRECTORY||''),proofPath=path.resolve(process.env.WMS_TEST_PROOF||'');
 assert.equal(process.env.WMS_TEST_PG_HOST,'127.0.0.1');assert.match(database,/^wms_mixed_native_[a-f0-9]{12}$/);assert.ok(Number.isInteger(port)&&port>=55000&&port<65000);assert.match(directory,/\/artifacts\/wms-mixed-reexport-20261029\/native-pg-[a-f0-9]{8}\/data$/);assert.equal(path.dirname(proofPath),path.dirname(directory));
 const pid=fs.readFileSync(path.join(directory,'postmaster.pid'),'utf8').trim().split('\n');assert.equal(path.resolve(pid[1]),directory);assert.equal(Number(pid[3]),port);
 Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:'',PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:process.env.WMS_TEST_PG_USER,PGDATABASE:database,PGPASSWORD:'',PGOPTIONS:'',DB_SSL_MODE:'disable',DB_POOL_MAX:'10',JWT_SECRET:'synthetic-native-only',ECOUNT_REFERENCE_OBJECT:'',GCS_BUCKET:'',STORAGE_BACKEND:'local',ERP_PORTAL_SSO_ENABLED:'false',WMS_ECPAY_CALLBACKS_ENABLED:'false'});
 const config={host:'127.0.0.1',port,user:process.env.WMS_TEST_PG_USER,database,ssl:false,max:10,application_name:'wms-mixed-native-service',connectionTimeoutMillis:3000};
 const pool=new Pool(config),observer=new Client({...config,application_name:'wms-mixed-native-observer'});await observer.connect();
 const productFiles=['services/marketplaceDraftOverwrite.js','services/marketplaceMixedReexport.js','services/marketplaceUploadScopes.js','services/marketplaceReturnImport.js','services/warehouseRelease.js','services/marketplaceBatchManagement.js','services/marketplaceDownloads.js','routes/warehouseReleaseRoutes.js'].map(name=>path.resolve(__dirname,'../src',name)),before=Object.fromEntries(productFiles.map(file=>[path.relative(path.resolve(__dirname,'..'),file),sha(file)]));
 const proof={kind:'wms-mixed-native-pg-v1',startedAt:new Date().toISOString(),database,host:'127.0.0.1',port,postgresVersion:(await observer.query('SHOW server_version')).rows[0].server_version,sourceFiles:before,testHarness:{testSha256:sha(__filename),fixtureSha256:sha(path.join(__dirname,'fixtures/marketplace-mixed-native.cjs'))},sourceUnchanged:false,passed:false,cases:[],nativeAdvisoryWaits:[],externalApiCalls:false,syntheticOnly:true};
 const migrated=await require('../src/maintenance/migrationRunner').runMigrations({pool,targetDatabase:database});proof.migrationsApplied=migrated.applied;
 const users={};for(const role of ['dispatcher','admin','picker','packer'])users[role]=(await pool.query('INSERT INTO users(username,password,name,role,management_scope) VALUES($1,$2,$1,$3,$4) RETURNING id,role,name,management_scope',['native_'+role,'synthetic-unused',role,'all'])).rows[0];
 const {createMixedFixture}=require('./fixtures/marketplace-mixed-native.cjs');
 const {readFlow,mutateFlow}=require('../src/services/warehouseRelease');
 const {importMarketplaceReturn}=require('../src/services/marketplaceReturnImport');
 const {assertUploadScope}=require('../src/services/marketplaceUploadScopes');
 const asBuffer=rows=>{const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'ECOUNT fixture');return XLSX.write(book,{type:'buffer',bookType:'xlsx'});};
 async function download(id,cookie){
  const {issueDownload,downloadFile}=require('../src/services/marketplaceDownloads'),result={status:200};
  const response={cookie:(name,value)=>{result.cookie=name+'='+value;return response;},set:()=>response,json:value=>{result.link=value;return response;},status:value=>{result.status=value;return response;},send:value=>{result.body=value;return response;}};
  if(!cookie){const row=(await pool.query('SELECT snapshot FROM marketplace_intakes WHERE id=$1',[id])).rows[0];issueDownload(response,id,'ecount',users.dispatcher.id,row.snapshot.draftRevision??0,row.snapshot.uploadScope?.fingerprint);cookie=result.cookie;}
  await downloadFile({pool})({params:{id:String(id),kind:'ecount'},headers:{cookie}},response,error=>{throw error;});return result;
 }
 const action=(id,name,user,body={})=>mutateFlow(pool,id,name,{commandId:randomUUID(),expectedActorId:user.id,...body},user);
 async function subtest(name,fn){await t.test(name,async()=>{await fn();proof.cases.push({name,passed:true});});}
 async function waitForAdvisory(count){
  const deadline=Date.now()+2200;
  while(Date.now()<deadline){const rows=(await observer.query("SELECT pid,wait_event_type,wait_event,query,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE datname=$1 AND application_name='wms-mixed-native-service' AND wait_event='advisory' ORDER BY pid",[database])).rows;if(rows.length>=count)return rows;await sleep(20);}
  throw Error('Expected native advisory lock wait was not observed');
 }
 async function blocker(namespace,key){const client=new Client({...config,application_name:'wms-mixed-native-blocker'});await client.connect();await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[namespace,key]);return {client,pid:(await client.query('SELECT pg_backend_pid() pid')).rows[0].pid};}
 try{
  await subtest('full selected CSV persists exact membership, returns only selected orders held, prints and releases their prepick',async()=>{
   const fixture=await createMixedFixture(pool,users),omitted=(await pool.query('SELECT * FROM marketplace_intake_orders WHERE source_order_number=$1',[fixture.numbers.B])).rows[0],result=await fixture.service.apply(await fixture.body(),users.dispatcher),id=result.exportBatch.id;
   const record=(await pool.query('SELECT * FROM marketplace_intakes WHERE id=$1',[id])).rows[0],selected=await assertUploadScope(pool,record);
   assert.deepEqual(selected.map(source=>source.source_order_number).sort(),[fixture.numbers.A,fixture.numbers.C].sort());assert.deepEqual(selected.map(source=>source.draft_version),[1,0]);assert.equal(selected[0].intake_id,fixture.owner.id);assert.equal(selected[1].intake_id,id);
   let data=await readFlow(pool,id);assert.equal(data.orders.length,2);assert.equal(data.products.reduce((sum,item)=>sum+item.quantity,0),3);assert.equal(data.flow.erp_confirmed_at,null);
   const {savedBatchTables}=await import('../src/services/marketplaceBatchFiles.mjs'),tables=savedBatchTables({...record.snapshot,batchNumber:record.batch_number,store:fixture.store},'prepick');assert.ok(tables.find(table=>table.name==='訂單商品明細').rows.slice(1).every(row=>[fixture.numbers.A,fixture.numbers.C].includes(row[0])));assert.equal(tables.find(table=>table.name==='訂單商品明細').rows.length,3);
   const returned=await importMarketplaceReturn(asBuffer(await fixture.receipt(id)),pool,id,users.dispatcher);assert.equal(returned.workOrderCount,2);assert.equal(returned.totalQuantity,3);
   const file=await download(id);assert.equal(file.status,200);assert.ok(Buffer.isBuffer(file.body));const book=XLSX.read(file.body),sheet=book.Sheets[book.SheetNames[0]],table=XLSX.utils.sheet_to_json(sheet,{header:1});assert.equal(table.slice(1).reduce((sum,row)=>sum+row[table[0].indexOf('數量')],0),3);assert.equal(sheet.L2.t,'s');assert.equal(sheet.L2.v,fixture.sku);
   const blockedPreview=await fixture.service.preview(fixture.request,users.dispatcher);assert.equal(blockedPreview.canConfirm,false);await assert.rejects(fixture.service.apply({...fixture.request,commandId:randomUUID(),confirmed:true,notImportedConfirmed:true,previewFingerprint:blockedPreview.previewFingerprint},users.dispatcher),error=>error.code==='MARKETPLACE_DRAFT_ALREADY_STARTED');
   data=await readFlow(pool,id);assert.deepEqual(data.orders.map(order=>order.source_order_number).sort(),[fixture.numbers.A,fixture.numbers.C].sort());assert.equal((await pool.query('SELECT COUNT(*)::int n FROM orders WHERE import_batch_id=$1 AND warehouse_hold',[data.flow.import_batch_id])).rows[0].n,2);
   await assert.rejects(action(id,'complete',users.picker),error=>error.status===403||error.status===409);
   await action(id,'print',users.admin,{kind:'all'});await action(id,'assign',users.admin,{assigneeId:users.picker.id});
   for(const product of data.products)await action(id,'scan',users.picker,{productKey:product.key,barcode:product.barcode,quantity:product.quantity});
   await action(id,'complete',users.picker);
   data=await readFlow(pool,id);assert.ok(data.flow.prepick_completed_at);assert.equal((await pool.query('SELECT COUNT(*)::int n FROM orders WHERE import_batch_id=$1 AND warehouse_hold',[data.flow.import_batch_id])).rows[0].n,0);
   assert.equal((await pool.query('SELECT COUNT(*)::int n FROM orders WHERE source_platform=$1 AND source_store=$2 AND source_order_number=$3',['Shopify',fixture.store,fixture.numbers.B])).rows[0].n,0);assert.deepEqual((await pool.query('SELECT * FROM marketplace_intake_orders WHERE id=$1',[omitted.id])).rows[0],omitted);
   assert.equal((await pool.query('SELECT COUNT(*)::int n FROM marketplace_batch_notices WHERE intake_id=$1 AND stage=$2',[id,'ready_for_print'])).rows[0].n,1);
  });
  await subtest('a real membership SQL constraint failure rolls back old snapshot/versions, new owner, scope, history and command',async()=>{
   const fixture=await createMixedFixture(pool,users),body=await fixture.body(),selected=(await pool.query('SELECT id FROM marketplace_intake_orders WHERE source_order_number=$1',[fixture.numbers.A])).rows[0].id,before=await fixture.criticalState();
   await pool.query('ALTER TABLE marketplace_intake_scope_orders ADD CONSTRAINT native_reject_member CHECK (intake_order_id <> '+selected+')');
   try{await assert.rejects(fixture.service.apply(body,users.dispatcher),error=>error.code==='23514');assert.deepEqual(await fixture.criticalState(),before);}finally{await pool.query('ALTER TABLE marketplace_intake_scope_orders DROP CONSTRAINT native_reject_member');}
  });
  await subtest('two distinct commands wait on the same real source lock; one commits and one detects stale source ownership',async()=>{
   const fixture=await createMixedFixture(pool,users),body=await fixture.body(),other={...body,commandId:randomUUID()},key=JSON.stringify(['Shopify',fixture.store,fixture.numbers.A]),held=await blocker('wms-marketplace-source',key);
   let promises;
   try{promises=[fixture.service.apply(body,users.dispatcher),fixture.service.apply(other,users.dispatcher)];const waiting=await waitForAdvisory(2);assert.equal(new Set(waiting.map(row=>row.pid)).size,2);assert.ok(waiting.every(row=>row.pid!==held.pid&&row.blockers.includes(held.pid)&&row.query.includes('wms-marketplace-source')));proof.nativeAdvisoryWaits.push({kind:'distinct-command-same-source',blockerPid:held.pid,waitingPids:waiting.map(row=>row.pid),observed:waiting,waitEvent:'advisory'});await held.client.query('COMMIT');const results=await Promise.allSettled(promises);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);const rejected=results.find(result=>result.status==='rejected');assert.equal(rejected.reason.status,409);assert.equal((await pool.query('SELECT COUNT(*)::int n FROM marketplace_draft_commands WHERE actor_id=$1 AND command_id=ANY($2::uuid[])',[users.dispatcher.id,[body.commandId,other.commandId]])).rows[0].n,1);}
   finally{await held.client.query('ROLLBACK').catch(()=>{});await held.client.end();if(promises)await Promise.allSettled(promises);}
  });
  await subtest('identical concurrent command waits on the native command lock and reads exactly one committed output',async()=>{
   const fixture=await createMixedFixture(pool,users),body=await fixture.body(),held=await blocker('wms-draft-command',`${users.dispatcher.id}:${body.commandId}`);let promises;
   try{promises=[fixture.service.apply(body,users.dispatcher),fixture.service.apply(body,users.dispatcher)];const waiting=await waitForAdvisory(2);assert.ok(waiting.every(row=>row.blockers.includes(held.pid)&&row.query.includes('wms-draft-command')));proof.nativeAdvisoryWaits.push({kind:'same-command-exactly-once',blockerPid:held.pid,waitingPids:waiting.map(row=>row.pid),observed:waiting,waitEvent:'advisory'});await held.client.query('COMMIT');const results=await Promise.all(promises);assert.equal(results[0].exportBatch.id,results[1].exportBatch.id);assert.equal(results.filter(result=>result.replayed).length,1);assert.equal((await pool.query('SELECT COUNT(*)::int n FROM marketplace_draft_commands WHERE actor_id=$1 AND command_id=$2',[users.dispatcher.id,body.commandId])).rows[0].n,1);}
   finally{await held.client.query('ROLLBACK').catch(()=>{});await held.client.end();if(promises)await Promise.allSettled(promises);}
  });
  await subtest('warehouse activity committed by a competing source owner invalidates preparation before any overwrite',async()=>{
   const fixture=await createMixedFixture(pool,users),body=await fixture.body(),before=await fixture.criticalState(),held=await blocker('wms-marketplace-source',JSON.stringify(['Shopify',fixture.store,fixture.numbers.A]));let promise;
   try{promise=fixture.service.apply(body,users.dispatcher);const waiting=await waitForAdvisory(1);assert.ok(waiting.every(row=>row.blockers.includes(held.pid)&&row.query.includes('wms-marketplace-source')));proof.nativeAdvisoryWaits.push({kind:'warehouse-writer-race',blockerPid:held.pid,waitingPids:waiting.map(row=>row.pid),observed:waiting,waitEvent:'advisory'});await held.client.query('UPDATE marketplace_warehouse_flows SET printed_at=NOW(),print_owner_id=$2 WHERE intake_id=$1',[fixture.owner.id,users.admin.id]);await held.client.query('COMMIT');await assert.rejects(promise,error=>error.status===409);const after=await fixture.criticalState();for(const name of ['marketplace_intakes','marketplace_intake_orders','marketplace_intake_scope_orders','marketplace_draft_revisions','marketplace_draft_commands'])assert.deepEqual(after[name],before[name]);}
   finally{await held.client.query('ROLLBACK').catch(()=>{});await held.client.end();if(promise)await promise.catch(()=>{});}
  });
  await subtest('old scope and incorrect or incomplete multi-line return cannot create tasks; current full scope alone is accepted',async()=>{
   const fixture=await createMixedFixture(pool,users);fixture.setQuantity('C',201);
   const first=await fixture.service.apply(await fixture.body(),users.dispatcher),oldReceipt=await fixture.receipt(first.exportBatch.id),oldFile=await download(first.exportBatch.id),second=await fixture.service.apply(await fixture.body(),users.dispatcher),id=second.exportBatch.id;
   assert.equal((await download(first.exportBatch.id,oldFile.cookie)).status,409);
   await assert.rejects(importMarketplaceReturn(asBuffer(oldReceipt),pool,first.exportBatch.id,users.dispatcher),error=>error.status===409);
   const current=await fixture.receipt(id),wrong=structuredClone(current);assert.equal(current.length,3);wrong[1][10]++;
   await assert.rejects(importMarketplaceReturn(asBuffer(current.slice(0,-1)),pool,id,users.dispatcher),error=>error.status===400&&/全部|整批/.test(error.message));
   await assert.rejects(importMarketplaceReturn(asBuffer(wrong),pool,id,users.dispatcher),error=>error.status===400);assert.equal((await pool.query('SELECT COUNT(*)::int n FROM orders WHERE source_store=$1',[fixture.store])).rows[0].n,0);
   assert.equal((await importMarketplaceReturn(asBuffer(current),pool,id,users.dispatcher)).workOrderCount,2);assert.equal((await pool.query('SELECT COUNT(*)::int n FROM orders WHERE source_store=$1 AND source_order_number=$2',[fixture.store,fixture.numbers.B])).rows[0].n,0);
  });
  proof.sourceUnchanged=productFiles.every(file=>before[path.relative(path.resolve(__dirname,'..'),file)]===sha(file));assert.equal(proof.sourceUnchanged,true);assert.equal(proof.cases.length,6);assert.equal(proof.nativeAdvisoryWaits.length,3);proof.passed=true;
 }finally{
  proof.finishedAt=new Date().toISOString();fs.writeFileSync(proofPath,JSON.stringify(proof,null,2)+'\n',{mode:0o600});await observer.end();await pool.end();
 }
});
