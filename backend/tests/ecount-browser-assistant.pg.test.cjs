// Independent synthetic native PostgreSQL integration. No real ERP session or API.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createEcountReferenceFixture } = require('./ecountReferenceFixture.cjs');
const { createEcountBrowserRouter } = require('../src/routes/ecountBrowserRoutes');
const { enqueueEcountBrowserSafely, createEcountBrowserService } = require('../src/services/ecountBrowserService');

function externalDocument(view, { metadata = '', versionToken = 'original-version-1' } = {}) {
    return { schemaVersion:1, companyCode:'SYNTHETIC-CO', voucherNumber:`2026/10/16-${view.orderId}`, versionToken,
        capturedAt:'2026-10-16T01:00:00.000Z', customerCode:'CUSTOMER-PRESERVE', warehouseCode:'WAREHOUSE-PRESERVE', currencyCode:'TWD', approvalStatus:'posted',
        linkedDocuments:['ORIGINAL-SALE-LEDGER','ORIGINAL-AR-ENTRY'], totals:{ netAmount:'2500.00', taxAmount:'125.00', grossAmount:'2625.00' },
        otherBusinessFields:{ remarks:'Salesperson original note; do not replace', project:'PRESERVED-PROJECT', inventoryPosted:true, inventoryPostingIdentity:'STOCK-ORIGINAL-001', receivablePostingIdentity:'AR-ORIGINAL-001' },
        rows:view.totals.map((row,i)=>({ rowId:'original-row-'+i, itemCode:row.itemCode, sourceLineId:null, quantity:String(row.quantity), unitPrice:'100.00', netAmount:'2500.00', taxAmount:'125.00', grossAmount:'2625.00', warehouseCode:'WAREHOUSE-PRESERVE', actualSN:[...row.actualSN], metadata })) };
}
const body = (actor=1, extra={}) => ({ commandId:randomUUID(), expectedActorId:actor, ...extra });

test('durable ECOUNT assistant queue, leases and metadata-only receipts on isolated native PostgreSQL', {
    skip:process.env.WMS_PARITY_PG_TEST!=='1', timeout:120000
}, async t=>{
    const originalMode=process.env.ECOUNT_BROWSER_ASSISTANT_MODE;
    process.env.ECOUNT_BROWSER_ASSISTANT_MODE='off';
    t.after(()=>{if(originalMode===undefined)delete process.env.ECOUNT_BROWSER_ASSISTANT_MODE;else process.env.ECOUNT_BROWSER_ASSISTANT_MODE=originalMode;});
    const f=await createEcountReferenceFixture(); t.after(()=>f.close()); f.attachReferences();
    const env={ ECOUNT_BROWSER_ASSISTANT_MODE:'preview' };
    f.app.use('/api/ecount-browser',createEcountBrowserRouter({ pool:f.pool,env }));
    const { api,ok }=f, base='/api/ecount-browser';
    const ref=id=>api(1,'get',`/api/orders/${id}/ecount-reference`).then(ok);
    const bind=async(id,extra={})=>{const view=await ref(id);return ok(await api(1,'post',`/api/orders/${id}/ecount-reference`,body(1,{expectedRevision:view.reference?.revision??0,expectedFingerprint:view.fingerprint,companyCode:'SYNTHETIC-CO',voucherNumber:`2026/10/16-${id}`,...extra})));};
    const reconcile=orderId=>api(1,'post',base+'/reconcile',body(1,{limit:20,...(orderId?{orderId}:{})})).then(ok);
    const count=async(table)=>Number((await f.db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n);
    const jobs=async()=> (await f.db.query('SELECT * FROM wms_ecount_browser_jobs ORDER BY created_at,id')).rows;
    const queueCounts=async()=>({jobs:await count('wms_ecount_browser_jobs'),events:await count('wms_ecount_browser_events'),commands:await count('wms_ecount_browser_commands')});
    const claimed=async actor=>{
        const workerId=randomUUID(); const value=ok(await api(actor,'post',base+'/claim',body(actor,{workerId})));
        return {...value,workerId,actor};
    };
    const lease=(claim,extra={})=>body(claim.actor,{workerId:claim.workerId,leaseToken:claim.leaseToken,...extra});
    const prepare=(claim,before,capabilities={})=>api(claim.actor,'post',`${base}/jobs/${claim.job.id}/prepare`,lease(claim,{before,capabilities}));
    const result=(claim,plan,extra={})=>api(claim.actor,'post',`${base}/jobs/${claim.job.id}/result`,lease(claim,{planFingerprint:plan.planFingerprint,...extra}));
    const finishPreview=async claim=>{
        const view=await ref(claim.job.orderId), plan=ok(await prepare(claim,externalDocument(view)));
        assert.equal(plan.saveAllowed,false);assert.equal(ok(await result(claim,plan,{outcome:'preview'})).job.status,'previewed');return plan;
    };
    const isolatedBusiness=async()=>({tables:await f.businessSnapshot(), reference:(await f.db.query('SELECT to_jsonb(t) row FROM wms_ecount_order_references t ORDER BY order_id')).rows,
        sequences:(await f.db.query("SELECT sequencename,last_value FROM pg_sequences WHERE schemaname='public' AND sequencename NOT LIKE 'wms_ecount_browser_%' ORDER BY sequencename")).rows});
    let target,view,claim,prepared;

    await t.test('disabled completion hook performs zero SQL including zero savepoints',async()=>{
        let queries=0;const inert={query(){queries++;throw Error('disabled hook must not query');}};
        for(const mode of ['off','invalid',undefined]){
            const value=await enqueueEcountBrowserSafely(inert,123,{env:mode===undefined?{}:{ECOUNT_BROWSER_ASSISTANT_MODE:mode}});
            assert.deepEqual(value,{enqueued:false,reason:'disabled'});
        }
        assert.equal(queries,0);
    });
    await t.test('25 units use N1 remaining five then N2/N3 ten each; unbound and off flows remain unchanged',async()=>{
        target=await f.complete25WithReleased();view=await ref(target.order.id);
        assert.deepEqual(view.cartonSummary,[{cartonId:'N1',quantity:5},{cartonId:'N2',quantity:10},{cartonId:'N3',quantity:10}]);
        assert.equal(await count('wms_ecount_browser_jobs'),0);
        await reconcile();assert.equal(await count('wms_ecount_browser_jobs'),0);
        view=await bind(target.order.id);assert.equal(await count('wms_ecount_browser_jobs'),0);
        const before=await isolatedBusiness();await reconcile();await reconcile();
        assert.equal(await count('wms_ecount_browser_jobs'),1);assert.deepEqual(await isolatedBusiness(),before);
        assert.deepEqual((await jobs())[0].manifest.cartonSummary,view.cartonSummary);
    });
    await t.test('ordinary operators cannot claim and actor reauthentication defeats forged manager identity',async()=>{
        for(const actor of [2,3,6])assert.equal((await api(actor,'post',base+'/claim',body(actor,{workerId:randomUUID()}))).status,403);
        assert.equal((await api(null,'get',base+'/status')).status,401);
        assert.equal((await api(1,'post',base+'/claim',body(5,{workerId:randomUUID()}))).body.code,'ECOUNT_BROWSER_ACTOR_CHANGED');
        const service=createEcountBrowserService({pool:f.pool,env});
        await assert.rejects(service.claim(body(2,{workerId:randomUUID()}),{id:2,role:'superadmin'}),e=>e.status===403);
        const before=await isolatedBusiness();for(const actor of [1,2,3,4,5,7,8])assert.equal(ok(await api(actor,'get',`${base}/status?orderId=${target.order.id}`)).jobs.length,1);
        assert.deepEqual(await isolatedBusiness(),before);
    });
    await t.test('concurrent claim gives exactly one worker a lease; wrong person, worker or token cannot prepare',async()=>{
        const workers=[randomUUID(),randomUUID()];
        const responses=await Promise.all(workers.map(workerId=>api(1,'post',base+'/claim',body(1,{workerId}))));
        const winner=responses.findIndex(res=>ok(res).job);assert.notEqual(winner,-1);assert.equal(responses.filter(res=>res.body.job).length,1);
        claim={...responses[winner].body,workerId:workers[winner],actor:1};assert.equal(claim.job.orderId,target.order.id);
        for(const [actor,extra]of [[5,{}],[1,{workerId:randomUUID()}],[1,{leaseToken:'wrong-token'}]]){
            const response=await api(actor,'post',`${base}/jobs/${claim.job.id}/prepare`,body(actor,{workerId:claim.workerId,leaseToken:claim.leaseToken,before:externalDocument(view),...extra}));
            assert.equal(response.status,403);assert.equal(response.body.code,'ECOUNT_BROWSER_LEASE_OWNERSHIP');
        }
    });
    await t.test('preview preserves unrelated notes and every business field; no capability can turn preview into saved',async()=>{
        const before=await isolatedBusiness();const external=externalDocument(view,{metadata:'Original delivery note\n請下午送貨'});
        prepared=ok(await prepare(claim,external,{atomicMetadataOnlyUpdate:true,optimisticConcurrency:true,versionToken:external.versionToken}));
        assert.equal(prepared.saveAllowed,false);assert.equal(prepared.plan.rows.length,1);
        assert.match(prepared.plan.rows[0].metadata,/^Original delivery note\n請下午送貨\n/);
        for(const fragment of ['N1 出 5 件','N2 出 10 件','N3 出 10 件'])assert.ok(prepared.plan.rows[0].metadata.includes(fragment));
        const fabricatedAfter=structuredClone(external);fabricatedAfter.rows[0].metadata=prepared.plan.rows[0].metadata;
        const denied=await result(claim,prepared,{outcome:'saved',after:fabricatedAfter});assert.equal(denied.status,409);assert.equal(denied.body.code,'ECOUNT_BROWSER_SAVE_NOT_ACCEPTED');
        assert.equal(ok(await result(claim,prepared,{outcome:'preview'})).job.status,'previewed');assert.deepEqual(await isolatedBusiness(),before);
    });
    await t.test('only preview or proven-before-save failures can requeue the same job; original plan, operator and history are retained',async()=>{
        const retryUrl=`${base}/jobs/${claim.job.id}/retry`,before=await isolatedBusiness(),command=body(5,{reason:'Verified no save; repair local field setting'});
        assert.equal((await api(2,'post',retryUrl,body(2))).status,403);
        const retried=ok(await api(5,'post',retryUrl,command));assert.equal(retried.retryQueued,true);assert.equal(retried.job.id,claim.job.id);assert.equal(retried.job.status,'queued');
        const queued=(await jobs()).find(j=>j.id===claim.job.id);
        for(const field of ['claimed_by','worker_id','lease_token_hash','lease_expires_at','before_snapshot','plan','plan_fingerprint','after_snapshot','last_error','verified_at'])assert.equal(queued[field],null);
        const archive=(await f.db.query("SELECT actor_id,actor_snapshot,details FROM wms_ecount_browser_events WHERE job_id=$1 AND event_type='retry_requested' ORDER BY id DESC LIMIT 1",[claim.job.id])).rows[0];
        assert.equal(archive.actor_id,5);assert.equal(archive.actor_snapshot.id,5);assert.equal(archive.details.previous.claimedBy,1);assert.equal(archive.details.previous.workerId,claim.workerId);
        assert.equal(archive.details.previous.planFingerprint,prepared.planFingerprint);assert.deepEqual(archive.details.previous.plan,prepared.plan);assert.ok(archive.details.previous.beforeSnapshot.rows[0].metadata.startsWith('Original delivery note'));
        const eventCount=await count('wms_ecount_browser_events');assert.equal(ok(await api(5,'post',retryUrl,command)).replayed,true);assert.equal(await count('wms_ecount_browser_events'),eventCount);assert.deepEqual(await isolatedBusiness(),before);
        const c=await claimed(5),p=ok(await prepare(c,externalDocument(view)));assert.equal(c.job.id,claim.job.id);
        assert.equal((await api(5,'post',retryUrl,body(5))).body.code,'ECOUNT_BROWSER_RETRY_BLOCKED');
        const failed=ok(await result(c,p,{outcome:'failed',errorCode:'PREVIEW_ONLY_FIELD_UNSUPPORTED',vendorSaveAttempted:false}));assert.equal(failed.job.canRetry,true);
        const latest=ok(await api(1,'get',`${base}/status?orderId=${target.order.id}`));assert.equal(latest.jobs[0].canRetry,true);
        await f.db.query("UPDATE users SET role='picker' WHERE id=5");try{assert.equal((await api(5,'post',retryUrl,body(5))).status,403);}finally{await f.db.query("UPDATE users SET role='admin' WHERE id=5");}
        assert.equal(ok(await api(1,'post',retryUrl,body(1))).retryQueued,true);
        const c2=await claimed(1),p2=ok(await prepare(c2,externalDocument(view)));ok(await result(c2,p2,{outcome:'failed',errorCode:'UNKNOWN_FAILURE_NO_DECLARATION'}));
        assert.equal((await api(1,'post',retryUrl,body(1))).body.code,'ECOUNT_BROWSER_RETRY_BLOCKED');
        assert.equal(ok(await api(1,'get',`${base}/status?orderId=${target.order.id}`)).jobs[0].canRetry,false);
    });
    await t.test('lease expiry retries only an explicit false-save preview; true, missing or nonboolean permission stays uncertain',async()=>{
        const a=await f.completeOrdinary(),v=await bind(a.order.id);await reconcile();const c=await claimed(1),p=ok(await prepare(c,externalDocument(v)));assert.equal(p.saveAllowed,false);
        await f.db.query("UPDATE wms_ecount_browser_jobs SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[c.job.id]);assert.equal((await claimed(1)).job,null);
        const preview=ok(await api(1,'get',`${base}/status?orderId=${a.order.id}`)).jobs[0];assert.equal(preview.status,'previewed');assert.equal(preview.canRetry,true);
        const expired=(await f.db.query("SELECT actor_snapshot,details FROM wms_ecount_browser_events WHERE job_id=$1 AND event_type='lease_expired' ORDER BY id DESC LIMIT 1",[c.job.id])).rows[0];
        assert.equal(expired.details.definiteNoSave,true);assert.equal(expired.details.planFingerprint,p.planFingerprint);assert.deepEqual(expired.details.plan,p.plan);assert.equal(expired.actor_snapshot.id,1);
        ok(await api(5,'post',`${base}/jobs/${c.job.id}/retry`,body(5)));const replacement=await claimed(5);assert.equal(replacement.job.id,c.job.id);assert.notEqual(replacement.leaseToken,c.leaseToken);await finishPreview(replacement);
        for(const permission of [true,null,'false']){
            const row=await f.completeOrdinary(),view=await bind(row.order.id);await reconcile();const claim=await claimed(1),plan=ok(await prepare(claim,externalDocument(view)));
            if(permission===null)await f.db.query('UPDATE wms_ecount_browser_jobs SET plan=NULL WHERE id=$1',[claim.job.id]);
            else await f.db.query("UPDATE wms_ecount_browser_jobs SET plan=jsonb_set(plan,'{saveAllowed}',$2::jsonb) WHERE id=$1",[claim.job.id,JSON.stringify(permission)]);
            await f.db.query("UPDATE wms_ecount_browser_jobs SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[claim.job.id]);assert.equal((await claimed(1)).job,null);
            const status=ok(await api(1,'get',`${base}/status?orderId=${row.order.id}`)).jobs[0];assert.equal(status.status,'uncertain');assert.equal(status.canRetry,false);
            assert.equal((await api(1,'post',`${base}/jobs/${claim.job.id}/retry`,body(1))).body.code,'ECOUNT_BROWSER_RETRY_BLOCKED');
        }
    });
    await t.test('reference save and every duplicate completion converge to one ready job; missing binding/signed/held/pending exception never queue',async()=>{
        process.env.ECOUNT_BROWSER_ASSISTANT_MODE='preview';
        const auto=await f.completeOrdinary(2);await bind(auto.order.id);const existing=await count('wms_ecount_browser_jobs');
        assert.ok((await jobs()).some(j=>j.order_id===auto.order.id));
        const db=await f.pool.connect();try{await db.query('BEGIN');await enqueueEcountBrowserSafely(db,auto.order.id);await enqueueEcountBrowserSafely(db,auto.order.id);await db.query('COMMIT');}finally{db.release();}
        assert.equal(await count('wms_ecount_browser_jobs'),existing);
        const next=await claimed(4);assert.equal(next.job.orderId,auto.order.id);await finishPreview(next);
        await f.db.exec('ALTER TABLE orders ADD COLUMN warehouse_hold BOOLEAN DEFAULT FALSE');
        for(const kind of ['incomplete','signed','held','pending','no-binding']){
            const row=kind==='incomplete'?await f.seed(2):kind==='signed'?await f.seed(2,{sign:-1,status:'completed'}):await f.completeOrdinary(2);
            if(kind==='signed')await f.db.query('UPDATE order_items SET picked_quantity=2,packed_quantity=2 WHERE order_id=$1',[row.order.id]);
            if(kind==='held')await f.db.query('UPDATE orders SET warehouse_hold=TRUE WHERE id=$1',[row.order.id]);
            if(kind==='pending')await f.db.query("INSERT INTO order_exceptions(order_id,type,status,reason_text,created_by) VALUES($1,'order_change','open','Synthetic pending review',4)",[row.order.id]);
            if(kind!=='no-binding')await bind(row.order.id);
            const client=await f.pool.connect();try{await client.query('BEGIN');const value=await enqueueEcountBrowserSafely(client,row.order.id,{env});assert.equal(value.enqueued,false);await client.query('COMMIT');}finally{client.release();}
            assert.ok(!(await jobs()).some(j=>j.order_id===row.order.id));
        }
    });
    await t.test('queue failure is contained in its savepoint and does not poison a successful warehouse transaction',async()=>{
        const row=await f.completeOrdinary();await bind(row.order.id);
        const client=await f.pool.connect();let warned=false;
        try{await client.query('BEGIN');f.failNext(sql=>sql.includes('INSERT INTO wms_ecount_browser_jobs'));
            const value=await enqueueEcountBrowserSafely(client,row.order.id,{env,logger:{warn(){warned=true;}}});
            assert.equal(value.reason,'queue_deferred');assert.equal((await client.query('SELECT 1 AS still_usable')).rows[0].still_usable,1);await client.query('COMMIT');
        }finally{client.release();}
        assert.equal(warned,true);
        const leftover=await claimed(1);if(leftover.job)await finishPreview(leftover);
    });
    await t.test('changed WMS fingerprint blocks a queued job before any vendor plan and duplicate binding blocks both orders',async()=>{
        const row=await f.completeOrdinary();await bind(row.order.id);await f.db.query("UPDATE order_items SET product_name=product_name||' corrected' WHERE order_id=$1",[row.order.id]);
        const noJob=await claimed(1);assert.equal(noJob.job,null);assert.equal((await jobs()).find(j=>j.order_id===row.order.id).status,'blocked');
        const a=await f.completeOrdinary(),b=await f.completeOrdinary();await bind(a.order.id,{voucherNumber:'2026/10/16-999999'});await bind(b.order.id,{voucherNumber:'2026/10/16-999999'});
        assert.equal((await claimed(1)).job,null);assert.equal((await jobs()).find(j=>j.order_id===a.order.id).status,'blocked');assert.ok(!(await jobs()).some(j=>j.order_id===b.order.id));
    });
    await t.test('test save is restricted to exactly the allowlisted original voucher and stays separate from live verified',async()=>{
        const row=await f.completeOrdinary(3);const v=await bind(row.order.id);const c=await claimed(5);assert.equal(c.job.orderId,row.order.id);
        env.ECOUNT_BROWSER_ASSISTANT_MODE='test';env.ECOUNT_BROWSER_ASSISTANT_TEST_WRITE_ENABLED='true';env.ECOUNT_BROWSER_ASSISTANT_DOCUMENTS=JSON.stringify([{companyCode:'SYNTHETIC-CO',voucherNumber:`2026/10/16-${row.order.id}`}]);
        const external=externalDocument(v),before=await isolatedBusiness();
        const p=ok(await prepare(c,external,{acceptanceTestExclusiveDocument:true,versionToken:external.versionToken}));assert.equal(p.saveAllowed,true);
        const after=structuredClone(external);after.versionToken='version-2';after.capturedAt='2026-10-16T01:00:01.000Z';after.rows[0].metadata=p.plan.rows[0].metadata;
        const done=ok(await result(c,p,{outcome:'saved',after}));assert.equal(done.testVerified,true);assert.equal(done.verified,false);assert.equal(done.job.status,'test_verified');assert.deepEqual(await isolatedBusiness(),before);
        assert.equal((await api(1,'post',`${base}/jobs/${c.job.id}/retry`,body(1))).body.code,'ECOUNT_BROWSER_RETRY_BLOCKED');
        env.ECOUNT_BROWSER_ASSISTANT_MODE='preview';
    });
    await t.test('exact mixed-case and leading-zero SN, loose quantities and wrong company/date/line identities are checked before prepare',async()=>{
        const row=await f.completeMixed();const v=await bind(row.order.id),c=await claimed(1);assert.equal(c.job.orderId,row.order.id);
        const external=externalDocument(v);
        for(const [change,status] of [[d=>d.companyCode='WRONG',409],[d=>d.voucherNumber='2026/10/15-1',409],[d=>{const r=d.rows.find(r=>r.actualSN.length);r.actualSN[0]=r.actualSN[0].toUpperCase();},409],[d=>{const r=d.rows.find(r=>r.actualSN.length);r.actualSN[0]=r.actualSN[0].replace(/^0+/,'');},409],[d=>{const r=d.rows.find(r=>r.actualSN.length);r.quantity=String(Number(r.quantity)+1);},400]]){
            const altered=structuredClone(external);change(altered);const denied=await prepare(c,altered);assert.equal(denied.status,status,JSON.stringify(denied.body));
        }
        const p=ok(await prepare(c,external));assert.equal(p.plan.rows.length,3);assert.ok(p.plan.rows.some(r=>r.metadata.includes('散件 3 件')));assert.equal(ok(await result(c,p,{outcome:'preview'})).job.status,'previewed');
    });
    await t.test('same SKU on several external rows needs unique matching source-line identities and is never assigned by row order',async()=>{
        const row=await f.completeOrdinary(5),v=await bind(row.order.id),c=await claimed(1);assert.equal(c.job.orderId,row.order.id);
        const external=externalDocument(v),baseRow=external.rows[0];external.rows=[{...baseRow,rowId:'r1',quantity:'2'},{...baseRow,rowId:'r2',quantity:'3'}];
        const denied=await prepare(c,external);assert.equal(denied.status,409);assert.equal(denied.body.code,'ECOUNT_BROWSER_AMBIGUOUS_LINE');
        await finishPreview(c);
    });
    await t.test('existing bindings enqueue from final carton, loose unit, exact-SN and legacy GET completion paths without repeating a job',async()=>{
        let sequence=0;
        const completeAndCheck=async(row,complete)=>{
            await bind(row.order.id);assert.ok(!(await jobs()).some(j=>j.order_id===row.order.id));
            await complete();assert.ok((await jobs()).some(j=>j.order_id===row.order.id));
            const c=await claimed(1);assert.equal(c.job.orderId,row.order.id);await finishPreview(c);
        };
        const box=await f.carton('HOOK-CARTON',1),a=await f.seed(1);await f.scan(a.order.id,box.cartonId,'pick');await f.claim(a.order.id,'pack');
        await completeAndCheck(a,()=>f.scan(a.order.id,box.cartonId,'pack'));
        const b=await f.seed(2),unitBox=await f.carton('HOOK-LOOSE',1),unit=(row,stage,scanValue)=>api(2,'post','/api/orders/update_item',{orderId:row.order.id,type:stage,scanValue,amount:1}).then(ok);
        await f.scan(b.order.id,unitBox.cartonId,'pick');await unit(b,'pick','4710000000025');await f.claim(b.order.id,'pack');await f.scan(b.order.id,unitBox.cartonId,'pack');
        await completeAndCheck(b,()=>unit(b,'pack','4710000000025'));
        const sns=['000HookCase/01','000hookcase+02'],snBox=await f.carton('HOOK-EXACT-SN',1,{itemCode:'HOOK-SN',barcode:'HOOK-SN-CODE',actualSN:[sns[0]]});
        const c=await f.seed(2,{itemCode:'HOOK-SN',barcode:'HOOK-SN-CODE',actualSN:sns,serialMode:'exact'});
        await f.scan(c.order.id,snBox.cartonId,'pick');await unit(c,'pick',sns[1]);await f.claim(c.order.id,'pack');await f.scan(c.order.id,snBox.cartonId,'pack');
        await completeAndCheck(c,()=>unit(c,'pack',sns[1]));
        const d=await f.completeOrdinary(2);await f.db.query("UPDATE orders SET status='packing',completed_at=NULL WHERE id=$1",[d.order.id]);
        await completeAndCheck(d,()=>api(1,'get',`/api/orders/${d.order.id}`).then(ok));
        const before=await count('wms_ecount_browser_jobs');await api(1,'get',`/api/orders/${d.order.id}`).then(ok);await reconcile();assert.equal(await count('wms_ecount_browser_jobs'),before);
    });
    await t.test('unknown vendor save can only be read back; lease expiration never places prepared work back on a save queue',async()=>{
        env.ECOUNT_BROWSER_ASSISTANT_MODE='live';env.ECOUNT_BROWSER_ASSISTANT_ACCEPTANCE_PROOF='a'.repeat(64);env.ECOUNT_BROWSER_ASSISTANT_CONCURRENCY_CAPABILITY='native-compare-and-set';
        const row=await f.completeOrdinary(2),v=await bind(row.order.id),c=await claimed(7);assert.equal(c.job.orderId,row.order.id);
        const external=externalDocument(v);const p=ok(await prepare(c,external,{atomicMetadataOnlyUpdate:true,optimisticConcurrency:true,versionToken:external.versionToken}));assert.equal(p.saveAllowed,true);
        await f.db.query("UPDATE wms_ecount_browser_jobs SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[c.job.id]);
        assert.equal((await claimed(1)).job,null);assert.equal((await jobs()).find(j=>j.id===c.job.id).status,'uncertain');
        assert.equal((await api(1,'post',`${base}/jobs/${c.job.id}/retry`,body(1))).body.code,'ECOUNT_BROWSER_RETRY_BLOCKED');
        assert.equal((await result(c,p,{outcome:'saved',after:external})).status,409);
        const after=structuredClone(external);after.versionToken='version-after-save';after.rows[0].metadata=p.plan.rows[0].metadata;
        const before=await isolatedBusiness();const recovered=ok(await api(c.actor,'post',`${base}/jobs/${c.job.id}/recover`,lease(c,{planFingerprint:p.planFingerprint,after})));
        assert.equal(recovered.verified,true);assert.equal(recovered.recovered,true);assert.equal(recovered.job.status,'verified');assert.deepEqual(await isolatedBusiness(),before);
        const events=(await f.db.query('SELECT event_type,details FROM wms_ecount_browser_events WHERE job_id=$1 ORDER BY id',[c.job.id])).rows;
        assert.ok(events.some(e=>e.event_type==='verified_by_read_only_recovery'&&e.details.inventoryPostedByWms===false));
        env.ECOUNT_BROWSER_ASSISTANT_MODE='preview';
    });
    await t.test('before/after changes to quantity, price, exact SN, ledger identity, unrelated note or header fail closed as uncertain',async()=>{
        env.ECOUNT_BROWSER_ASSISTANT_MODE='live';
        for(const change of [d=>d.rows[0].quantity='2',d=>d.rows[0].unitPrice='101.00',d=>d.rows[0].metadata+=' replaced note',d=>d.otherBusinessFields.inventoryPostingIdentity='SECOND-STOCK',d=>d.otherBusinessFields.remarks='OVERWRITTEN',d=>d.customerCode='WRONG-CUSTOMER',d=>d.totals.grossAmount='3000.00']){
            const row=await f.completeOrdinary(),v=await bind(row.order.id),c=await claimed(1),external=externalDocument(v),before=await isolatedBusiness();
            const p=ok(await prepare(c,external,{atomicMetadataOnlyUpdate:true,optimisticConcurrency:true,versionToken:external.versionToken}));
            const after=structuredClone(external);after.rows[0].metadata=p.plan.rows[0].metadata;change(after);
            const done=ok(await result(c,p,{outcome:'saved',after}));assert.equal(done.verified,false);assert.equal(done.job.status,'uncertain');assert.deepEqual(await isolatedBusiness(),before);
            // Isolate distinct vouchers: uncertain work is retained, never retried.
        }
        env.ECOUNT_BROWSER_ASSISTANT_MODE='preview';
    });
    await t.test('same command replay is durable and a lost COMMIT response recovers once without new jobs or external save',async()=>{
        const command=body(1,{limit:20});const before=await queueCounts();f.failAfterNext(sql=>sql==='COMMIT');
        const unknown=await api(1,'post',base+'/reconcile',command);assert.equal(unknown.status,503);assert.equal(unknown.body.code,'ECOUNT_BROWSER_RESULT_UNKNOWN');
        const after=await queueCounts();const replay=ok(await api(1,'post',base+'/reconcile',command));assert.equal(replay.replayed,true);assert.deepEqual(await queueCounts(),after);
        assert.equal(after.commands,before.commands+1);
        const conflict=await api(1,'post',base+'/reconcile',{...command,limit:19});assert.equal(conflict.status,409);assert.equal(conflict.body.code,'ECOUNT_BROWSER_COMMAND_CONFLICT');
    });
    await t.test('real server plan interoperates with the extension engine and a native-CAS vendor fixture without changing any sales business field',async()=>{
        const { createEngine,businessSnapshot }=await import('../../tools/ecount-browser-assistant/src/engine.mjs');
        const { nativeFixture,memoryReceipts }=await import('../../tools/ecount-browser-assistant/fixtures/native-cas-adapter.mjs');
        env.ECOUNT_BROWSER_ASSISTANT_MODE='live';
        const row=await f.seed(25);for(const [id,quantity]of [['CAS-N1',5],['CAS-N2',10],['CAS-N3',10]])await f.carton(id,quantity);
        for(const id of ['CAS-N1','CAS-N2','CAS-N3'])await f.scan(row.order.id,id,'pick');
        for(const id of ['CAS-N1','CAS-N2','CAS-N3'])await f.scan(row.order.id,id,'pack');
        const v=await bind(row.order.id),c=await claimed(1),document=externalDocument(v,{metadata:'Unrelated original sales note',versionToken:'native:1'});
        const vendor=nativeFixture(document),receipts=memoryReceipts(),engine=createEngine({adapter:vendor.adapter,receipts});
        const p=ok(await prepare(c,document,await vendor.adapter.capabilities()));assert.equal(p.saveAllowed,true);
        const {preview}=await engine.preview({jobId:c.job.id,plan:p.plan});assert.equal(preview.planFingerprint,p.planFingerprint);
        const before=await isolatedBusiness(),original=businessSnapshot(vendor.document);
        const saved=await engine.apply({jobId:c.job.id,preview,permit:{mode:'live',saveAllowed:true,expiresAt:Date.now()+60000,companyCode:c.job.companyCode,voucherNumber:c.job.voucherNumber,jobId:c.job.id,planFingerprint:p.planFingerprint}});
        assert.equal(saved.outcome,'saved');assert.deepEqual(businessSnapshot(vendor.document),original);assert.equal(vendor.document.rows[0].quantity,'25');
        assert.match(vendor.document.rows[0].metadata,/^Unrelated original sales note\n/);
        for(const [id,quantity]of [['CAS-N1',5],['CAS-N2',10],['CAS-N3',10]])assert.ok(vendor.document.rows[0].metadata.includes(`${id} 出 ${quantity} 件`));
        assert.equal(vendor.events.length,1);assert.deepEqual(vendor.inventoryPostings,[]);
        assert.equal(ok(await result(c,p,saved)).verified,true);assert.deepEqual(await isolatedBusiness(),before);
    });
    await t.test('lost native vendor response survives extension-engine restart and server recovery with exactly one metadata update',async()=>{
        const { createEngine,businessSnapshot }=await import('../../tools/ecount-browser-assistant/src/engine.mjs');
        const { nativeFixture,memoryReceipts }=await import('../../tools/ecount-browser-assistant/fixtures/native-cas-adapter.mjs');
        const row=await f.completeOrdinary(2),v=await bind(row.order.id),c=await claimed(5),document=externalDocument(v,{versionToken:'native:1'});
        const vendor=nativeFixture(document),receipts=memoryReceipts(),engine=createEngine({adapter:vendor.adapter,receipts});
        const p=ok(await prepare(c,document,await vendor.adapter.capabilities())),{preview}=await engine.preview({jobId:c.job.id,plan:p.plan});
        vendor.failAfterNextSave();const unknown=await engine.apply({jobId:c.job.id,preview,permit:{mode:'live',saveAllowed:true,expiresAt:Date.now()+60000,companyCode:c.job.companyCode,voucherNumber:c.job.voucherNumber,jobId:c.job.id,planFingerprint:p.planFingerprint}});
        assert.equal(unknown.outcome,'uncertain');assert.equal(ok(await result(c,p,unknown)).readOnlyRecoveryRequired,true);
        const recovery=await createEngine({adapter:vendor.adapter,receipts}).recover({jobId:c.job.id,preview});assert.equal(recovery.outcome,'saved');assert.equal(recovery.recovered,true);
        const confirmed=ok(await api(c.actor,'post',`${base}/jobs/${c.job.id}/recover`,lease(c,{planFingerprint:p.planFingerprint,after:recovery.after})));
        assert.equal(confirmed.verified,true);assert.equal(vendor.events.length,1);assert.deepEqual(vendor.inventoryPostings,[]);assert.deepEqual(businessSnapshot(vendor.document),businessSnapshot(document));
        env.ECOUNT_BROWSER_ASSISTANT_MODE='preview';
    });
    async function historicalAttempt({actor=1,mode='live',confirmed=false}={}) {
        env.ECOUNT_BROWSER_ASSISTANT_MODE=mode;
        const row=await f.completeOrdinary(2),v=await bind(row.order.id);
        if(mode==='test'){
            env.ECOUNT_BROWSER_ASSISTANT_TEST_WRITE_ENABLED='true';
            env.ECOUNT_BROWSER_ASSISTANT_DOCUMENTS=JSON.stringify([{companyCode:'SYNTHETIC-CO',voucherNumber:`2026/10/16-${row.order.id}`}]);
        }
        const c=await claimed(actor);assert.equal(c.job.orderId,row.order.id);
        const before=externalDocument(v,{metadata:'Original note to retain'});
        const p=ok(await prepare(c,before,mode==='test'?{acceptanceTestExclusiveDocument:true,versionToken:before.versionToken}:{atomicMetadataOnlyUpdate:true,optimisticConcurrency:true,versionToken:before.versionToken}));
        assert.equal(p.saveAllowed,true);
        const after=structuredClone(before);after.versionToken='after-original-save';after.capturedAt='2026-10-16T02:00:00.000Z';
        for(const line of after.rows)line.metadata=p.plan.rows.find(r=>r.rowId===line.rowId).metadata;
        const done=ok(await result(c,p,confirmed?{outcome:'saved',after}:{outcome:'uncertain',errorCode:'SAVE_RESPONSE_LOST'}));
        assert.equal(done.job.status,confirmed?(mode==='test'?'test_verified':'verified'):'uncertain');
        return {row,v,c,p,before,after};
    }
    const recoverAttempt=(attempt,extra={},actor=attempt.c.actor)=>api(actor,'post',`${base}/jobs/${attempt.c.job.id}/recover`,body(actor,{workerId:attempt.c.workerId,leaseToken:attempt.c.leaseToken,planFingerprint:attempt.p.planFingerprint,after:attempt.after,...extra}));
    async function finishReplacement(orderId){
        env.ECOUNT_BROWSER_ASSISTANT_MODE='preview';const c=await claimed(1);assert.equal(c.job.orderId,orderId);
        const external=externalDocument(await ref(orderId));external.companyCode=c.job.companyCode;external.voucherNumber=c.job.voucherNumber;
        const plan=ok(await prepare(c,external));assert.equal(plan.saveAllowed,false);assert.equal(ok(await result(c,plan,{outcome:'preview'})).job.status,'previewed');return c;
    }
    await t.test('an unknown old voucher after reference replacement may confirm only immutable historical evidence and never the new shipment',async()=>{
        const attempt=await historicalAttempt({actor:5}),newVoucher=`2026/10/16-${500000+attempt.row.order.id}`;
        await bind(attempt.row.order.id,{voucherNumber:newVoucher,reason:'Synthetic replacement original sales reference'});
        const before=await isolatedBusiness();const recovered=ok(await recoverAttempt(attempt));
        assert.equal(recovered.job.status,'superseded_verified');assert.equal(recovered.historicalVerified,true);assert.equal(recovered.historicalTestVerified,false);
        assert.equal(recovered.verified,false);assert.equal(recovered.testVerified,false);assert.equal(recovered.newShipmentVerified,false);assert.deepEqual(await isolatedBusiness(),before);
        const events=(await f.db.query("SELECT actor_snapshot,details FROM wms_ecount_browser_events WHERE job_id=$1 AND event_type='superseded_attempt_readback_verified'",[attempt.c.job.id])).rows;
        assert.equal(events.length,1);assert.equal(events[0].actor_snapshot.id,5);
        const proof=events[0].details;assert.equal(proof.originalCompanyCode,attempt.c.job.companyCode);assert.equal(proof.originalVoucherNumber,attempt.c.job.voucherNumber);
        assert.equal(proof.originalReferenceRevision,attempt.c.job.referenceRevision);assert.equal(proof.originalManifestFingerprint,attempt.c.job.manifestFingerprint);
        assert.equal(proof.planFingerprint,attempt.p.planFingerprint);assert.deepEqual(proof.before,attempt.before);assert.deepEqual(proof.plan,attempt.p.plan);assert.deepEqual(proof.after,attempt.after);
        assert.equal(proof.newShipmentVerified,false);assert.equal(proof.inventoryPostedByWms,false);
        assert.equal((await api(1,'post',`${base}/jobs/${attempt.c.job.id}/retry`,body(1))).body.code,'ECOUNT_BROWSER_RETRY_BLOCKED');
        const next=await finishReplacement(attempt.row.order.id);assert.equal(next.job.voucherNumber,newVoucher);
    });
    await t.test('a changed manifest on the same original voucher remains blocked until the old uncertain attempt is historically read back',async()=>{
        const attempt=await historicalAttempt();
        await f.db.query("UPDATE order_items SET product_name=product_name||' source correction' WHERE order_id=$1",[attempt.row.order.id]);
        await reconcile(attempt.row.order.id);const oldAndNew=(await jobs()).filter(j=>j.order_id===attempt.row.order.id);assert.equal(oldAndNew.length,2);
        assert.equal((await claimed(1)).job,null,'Old uncertain attempt blocks another save of the same voucher');
        const before=await isolatedBusiness();const historic=ok(await recoverAttempt(attempt));assert.equal(historic.historicalVerified,true);assert.equal(historic.newShipmentVerified,false);assert.deepEqual(await isolatedBusiness(),before);
        const next=await finishReplacement(attempt.row.order.id);assert.equal(next.job.voucherNumber,attempt.c.job.voucherNumber);assert.notEqual(next.job.manifestFingerprint,attempt.c.job.manifestFingerprint);
    });
    await t.test('wrong old company, voucher, quantity or metadata and missing historical mapping cannot discharge uncertainty',async()=>{
        const attempt=await historicalAttempt();await bind(attempt.row.order.id,{voucherNumber:`2026/10/16-${600000+attempt.row.order.id}`,reason:'Synthetic reference correction'});
        const beforeJob=(await jobs()).find(j=>j.id===attempt.c.job.id),before=await isolatedBusiness();
        for(const change of [d=>d.companyCode='WRONG-COMPANY',d=>d.voucherNumber='2026/10/15-1',d=>d.rows[0].quantity='3',d=>d.rows[0].metadata+='not the exact old plan']){
            const invalid=structuredClone(attempt.after);change(invalid);const denied=await recoverAttempt(attempt,{after:invalid});assert.equal(denied.status,409);
            assert.equal((await jobs()).find(j=>j.id===attempt.c.job.id).status,'uncertain');
        }
        const original=(await f.db.query('SELECT after_state FROM wms_ecount_reference_history WHERE order_id=$1 AND revision=$2',[attempt.row.order.id,attempt.c.job.referenceRevision])).rows[0].after_state;
        await f.db.query("UPDATE wms_ecount_reference_history SET after_state=jsonb_set(after_state,'{companyCode}','\"CORRUPTED-MAPPING\"') WHERE order_id=$1 AND revision=$2",[attempt.row.order.id,attempt.c.job.referenceRevision]);
        assert.equal((await recoverAttempt(attempt)).body.code,'ECOUNT_BROWSER_FROZEN_MAPPING_INVALID');
        await f.db.query('UPDATE wms_ecount_reference_history SET after_state=$3 WHERE order_id=$1 AND revision=$2',[attempt.row.order.id,attempt.c.job.referenceRevision,JSON.stringify(original)]);
        const historyRow=(await f.db.query('DELETE FROM wms_ecount_reference_history WHERE order_id=$1 AND revision=$2 RETURNING *',[attempt.row.order.id,attempt.c.job.referenceRevision])).rows[0];
        assert.equal((await recoverAttempt(attempt)).body.code,'ECOUNT_BROWSER_FROZEN_MAPPING_INVALID');
        await f.db.query('INSERT INTO wms_ecount_reference_history SELECT * FROM json_populate_record(NULL::wms_ecount_reference_history,$1::json)',[JSON.stringify(historyRow)]);
        const originalPlan=beforeJob.plan;
        await f.db.query("UPDATE wms_ecount_browser_jobs SET plan=jsonb_set(plan,'{voucherNumber}','\"2026/10/16-999999\"') WHERE id=$1",[attempt.c.job.id]);
        assert.equal((await recoverAttempt(attempt)).body.code,'ECOUNT_BROWSER_FROZEN_EVIDENCE_INVALID');
        await f.db.query('UPDATE wms_ecount_browser_jobs SET plan=$2 WHERE id=$1',[attempt.c.job.id,JSON.stringify(originalPlan)]);
        assert.deepEqual((await jobs()).find(j=>j.id===attempt.c.job.id),beforeJob);assert.deepEqual(await isolatedBusiness(),before);
        assert.equal(ok(await recoverAttempt(attempt)).historicalVerified,true);await finishReplacement(attempt.row.order.id);
    });
    await t.test('historical recovery reauthenticates the original owner and worker, including after a role is revoked',async()=>{
        const attempt=await historicalAttempt({actor:5});await bind(attempt.row.order.id,{voucherNumber:`2026/10/16-${700000+attempt.row.order.id}`,reason:'Synthetic replacement binding'});
        for(const [actor,extra]of [[1,{}],[5,{workerId:randomUUID()}],[5,{leaseToken:'wrong-owner-token'}]])assert.equal((await recoverAttempt(attempt,extra,actor)).status,403);
        await f.db.query("UPDATE users SET role='picker' WHERE id=5");try{assert.equal((await recoverAttempt(attempt)).status,403);}finally{await f.db.query("UPDATE users SET role='admin' WHERE id=5");}
        assert.equal((await jobs()).find(j=>j.id===attempt.c.job.id).status,'uncertain');assert.equal(ok(await recoverAttempt(attempt)).historicalVerified,true);await finishReplacement(attempt.row.order.id);
    });
    await t.test('a lost historical recovery response replays the same command or the stored terminal acknowledgement without another event',async()=>{
        const attempt=await historicalAttempt();await bind(attempt.row.order.id,{voucherNumber:`2026/10/16-${800000+attempt.row.order.id}`,reason:'Synthetic replacement before response loss'});
        const command=lease(attempt.c,{planFingerprint:attempt.p.planFingerprint,after:attempt.after});
        f.failAfterNext(sql=>sql==='COMMIT');const unknown=await api(attempt.c.actor,'post',`${base}/jobs/${attempt.c.job.id}/recover`,command);assert.equal(unknown.status,503);
        const countBefore=await count('wms_ecount_browser_events');
        const replay=ok(await api(attempt.c.actor,'post',`${base}/jobs/${attempt.c.job.id}/recover`,command));assert.equal(replay.replayed,true);assert.equal(replay.historicalVerified,true);
        const current=await isolatedBusiness();
        const already=ok(await recoverAttempt(attempt,{after:{invalid:'Ignored only because immutable stored terminal evidence has already been checked'}}));
        assert.equal(already.previouslyConfirmed,true);assert.equal(already.historicalVerified,true);assert.equal(already.newShipmentVerified,false);assert.equal(await count('wms_ecount_browser_events'),countBefore);assert.deepEqual(await isolatedBusiness(),current);
        await finishReplacement(attempt.row.order.id);
    });
    await t.test('already verified TEST receipts become historical after a later reference change and never confirm the replacement shipment',async()=>{
        const attempt=await historicalAttempt({mode:'test',confirmed:true});
        const beforeEvents=await count('wms_ecount_browser_events');const oldAck=ok(await recoverAttempt(attempt,{after:null}));
        assert.equal(oldAck.previouslyConfirmed,true);assert.equal(oldAck.testVerified,true);assert.equal(await count('wms_ecount_browser_events'),beforeEvents);
        await bind(attempt.row.order.id,{voucherNumber:`2026/10/16-${900000+attempt.row.order.id}`,reason:'Synthetic new reference after TEST was verified'});
        const before=await isolatedBusiness(),historic=ok(await recoverAttempt(attempt,{after:null}));
        assert.equal(historic.historicalVerified,true);assert.equal(historic.historicalTestVerified,true);assert.equal(historic.testVerified,false);assert.equal(historic.verified,false);assert.equal(historic.newShipmentVerified,false);assert.deepEqual(await isolatedBusiness(),before);
        await finishReplacement(attempt.row.order.id);
    });
});

module.exports={externalDocument};
