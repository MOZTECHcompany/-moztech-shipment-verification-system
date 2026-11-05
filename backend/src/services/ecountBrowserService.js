const { randomUUID, randomBytes } = require('node:crypto');
const { fail } = require('./cartonContents');
const { buildEcountManifest, digest } = require('./ecountReferenceManifest');
const { normalizedVoucher } = require('./ecountReferenceIdentity');
const { uuid, config, snapshot, buildPlan, verifyAfter,verifyFrozenAttempt } = require('./ecountBrowserContract');
const manage = user => ['dispatcher','admin','superadmin'].includes(user?.role);
const validId = value => Number.isSafeInteger(value) && value > 0;
const iso = value => value ? new Date(value).toISOString() : null;
const canRetryJob = row => row.status==='previewed'&&row.plan?.saveAllowed===false||row.status==='failed'&&row.definite_no_save===true;
const publicJob = row => ({ id: row.id, orderId: row.order_id, companyCode: row.company_code, voucherNumber: row.voucher_number,
    referenceRevision: row.reference_revision, manifestFingerprint: row.manifest_fingerprint, status: row.status,
    manifest: row.manifest, canRetry:canRetryJob(row), lastError: row.last_error, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), verifiedAt: iso(row.verified_at) });
async function loadShipment(db, orderId, lock = false) {
    const order = (await db.query('SELECT * FROM orders WHERE id=$1' + (lock ? ' FOR UPDATE' : ''), [orderId])).rows[0];
    if (!order) throw fail('ORDER_NOT_FOUND', '找不到訂單', 404);
    const items = (await db.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY id', [orderId])).rows;
    const instances = (await db.query('SELECT i.* FROM order_item_instances i JOIN order_items oi ON oi.id=i.order_item_id WHERE oi.order_id=$1 ORDER BY i.id', [orderId])).rows;
    const allocations = (await db.query('SELECT * FROM wms_carton_allocations WHERE order_id=$1 ORDER BY id', [orderId])).rows;
    const exceptions = (await db.query('SELECT id,type,status,updated_at FROM order_exceptions WHERE order_id=$1 ORDER BY id', [orderId])).rows;
    const binding = (await db.query('SELECT * FROM wms_ecount_order_references WHERE order_id=$1', [orderId])).rows[0];
    return { order, manifest: buildEcountManifest({ order, items, instances, allocations, exceptions }), binding };
}
async function documentLock(db, company, voucher) {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('wms-ecount-browser-document'),hashtext($1))", [JSON.stringify([company, voucher])]);
}
async function enqueue(db, orderId, settings) {
    const loaded = await loadShipment(db, orderId);
    if (!loaded.manifest.ready || !loaded.manifest.rows.length || !loaded.binding || !normalizedVoucher(loaded.binding.voucher_number).dated) return { enqueued: false, reason: 'not_ready_or_unbound' };
    const { binding, manifest } = loaded;
    if ((await db.query('SELECT order_id FROM wms_ecount_order_references WHERE company_code=$1 AND voucher_number=$2 AND order_id<>$3 LIMIT 1', [binding.company_code, binding.voucher_number, orderId])).rows.length) return { enqueued: false, reason: 'document_conflict' };
    // No queue-row/document locks while a scan owns its order row: consumers
    // revalidate the immutable binding before any external operation instead.
    const inserted = (await db.query(`INSERT INTO wms_ecount_browser_jobs(id,order_id,company_code,voucher_number,reference_revision,manifest_fingerprint,manifest)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(order_id,company_code,voucher_number,reference_revision,manifest_fingerprint) DO NOTHING RETURNING id`,
    [randomUUID(),orderId,binding.company_code,binding.voucher_number,binding.revision,manifest.fingerprint,JSON.stringify(manifest)])).rows;
    return { enqueued: !!inserted.length, reason: inserted.length ? null : 'already_recorded' };
}
// Called only inside the existing successful WMS transaction. Disabled incurs
// zero SQL. Queue failures cannot roll a valid scan/reference save back.
async function enqueueEcountBrowserSafely(db, orderId, { env = process.env, logger = console } = {}) {
    const settings = config(env); if (!settings.enabled) return { enqueued: false, reason: 'disabled' };
    await db.query('SAVEPOINT ecount_browser_enqueue');
    try { const result = await enqueue(db, Number(orderId), settings); await db.query('RELEASE SAVEPOINT ecount_browser_enqueue'); return result; }
    catch (error) {
        await db.query('ROLLBACK TO SAVEPOINT ecount_browser_enqueue'); await db.query('RELEASE SAVEPOINT ecount_browser_enqueue');
        logger.warn?.('ECOUNT browser queue deferred', { orderId: Number(orderId), code: error.code || 'QUEUE_UNAVAILABLE' });
        return { enqueued: false, reason: 'queue_deferred' };
    }
}
function createEcountBrowserService({ pool, env = process.env }) {
    const settings = () => config(env);
    async function transaction(work, readOnly = false) {
        const db = await pool.connect(); let open = false, attempted = false, releaseError;
        try {
            await db.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN'); open = true;
            await db.query("SET LOCAL lock_timeout='1500ms'"); await db.query("SET LOCAL statement_timeout='8000ms'");
            const result = await work(db); attempted = true; await db.query('COMMIT'); open = false; return result;
        } catch (error) {
            if (open) try { await db.query('ROLLBACK'); } catch (cleanup) { releaseError = cleanup; }
            if (attempted || releaseError) { releaseError ||= error; throw fail('ECOUNT_BROWSER_RESULT_UNKNOWN', '工作結果尚未確認；請使用相同識別查詢，勿重新儲存 ECOUNT', 503); }
            if (['55P03','57014'].includes(error.code)) throw fail('ECOUNT_BROWSER_BUSY', '相同銷貨單正在處理，請稍後重新載入');
            throw error;
        } finally { db.release(releaseError); }
    }
    async function staff(db, actor, management = false) {
        const user = (await db.query('SELECT id,username,name,role,management_scope FROM users WHERE id=$1' + (management ? ' FOR SHARE' : ''), [actor?.id])).rows[0];
        if (!user || !['dispatcher','admin','superadmin','picker','packer'].includes(user.role)) throw fail('AUTH_REQUIRED', '需要有效登入', 401);
        if (management && !manage(user)) throw fail('ECOUNT_BROWSER_FORBIDDEN', '僅管理員與拋單人員可以操作 ECOUNT 助手', 403);
        return user;
    }
    async function event(db, jobId, actorId, type, details = {}) {
        await db.query(`INSERT INTO wms_ecount_browser_events(job_id,actor_id,event_type,details,actor_snapshot)
            VALUES($1,$2,$3,$4,(SELECT jsonb_build_object('id',id,'username',username,'name',name,'role',role,'managementScope',management_scope) FROM users WHERE id=$2))`, [jobId,actorId,type,JSON.stringify(details)]);
    }
    function input(body, worker = false) {
        if (!body || !uuid(body.commandId) || !validId(body.expectedActorId) || worker && !uuid(body.workerId)) throw fail('ECOUNT_BROWSER_INVALID_INPUT', '工作識別或登入人員無效', 400);
        return body;
    }
    async function command(body, actor, action, work, worker = false) {
        input(body, worker); const requestHash = digest([action, { ...body,commandId:body.commandId.toLowerCase(),...(body.workerId?{workerId:body.workerId.toLowerCase()}:{}) }]);
        return transaction(async db => {
            const user = await staff(db, actor, true);
            if (user.id !== body.expectedActorId) throw fail('ECOUNT_BROWSER_ACTOR_CHANGED', '登入人員已變更，請重新載入');
            const c=settings(),operation=Array.isArray(action)?action[0]:action;
            // Pausing the bridge also revokes cached prepare/claim permissions.
            // Read-only result recovery remains available for an already
            // attempted vendor save; disabling must never trigger a resave.
            if(!c.enabled&&!['result','recover'].includes(operation))return {disabled:true,mode:'off'};
            await db.query("SELECT pg_advisory_xact_lock(hashtext('wms-ecount-browser-command'),hashtext($1))", [`${user.id}:${body.commandId}`]);
            const receipt = (await db.query('SELECT request_hash,response FROM wms_ecount_browser_commands WHERE actor_id=$1 AND command_id=$2', [user.id,body.commandId])).rows[0];
            if (receipt) {
                if (receipt.request_hash !== requestHash) throw fail('ECOUNT_BROWSER_COMMAND_CONFLICT', '同一工作識別不可用於不同內容');
                if(operation==='prepare'){
                    const job=await jobFor(db,action[1],body,user),loaded=await current(db,job),prepared=buildPlan(loaded.manifest,loaded.binding,body.before,body.capabilities,c);
                    const plan={...prepared.plan,saveAllowed:prepared.saveAllowed,acceptanceProof:c.acceptanceProof,mode:c.mode,testWriteEnabled:c.testWriteEnabled};
                    if(job.status!=='prepared'||job.plan_fingerprint!==receipt.response.planFingerprint||digest(plan)!==job.plan_fingerprint)throw fail('ECOUNT_BROWSER_STATE_CHANGED','工作、驗收設定或處理期限已改變；不可沿用舊儲存計畫');
                }else if(operation==='claim'&&receipt.response.job){
                    const job=await jobFor(db,receipt.response.job.id,{...body,leaseToken:receipt.response.leaseToken},user);
                    if(job.status!=='claimed')throw fail('ECOUNT_BROWSER_STATE_CHANGED','這筆工作已進入另一個處理步驟，請重新讀取狀態');
                    await current(db,job);
                }
                return { ...receipt.response, replayed: true };
            }
            const result = await work(db,user,c);
            // Idle polling has no claim to replay and must not grow an audit
            // table once per polling interval for every empty workstation.
            if(operation==='claim'&&result.job===null)return {...result,replayed:false};
            await db.query('INSERT INTO wms_ecount_browser_commands(actor_id,command_id,request_hash,response) VALUES($1,$2,$3,$4)', [user.id,body.commandId,requestHash,JSON.stringify(result)]);
            return { ...result, replayed: false };
        });
    }
    async function current(db, job) {
        const loaded = await loadShipment(db, job.order_id, true), binding = loaded.binding;
        if (!loaded.manifest.ready || !binding || loaded.manifest.fingerprint !== job.manifest_fingerprint
            || binding.revision !== job.reference_revision || binding.company_code !== job.company_code || binding.voucher_number !== job.voucher_number) throw fail('ECOUNT_BROWSER_SHIPMENT_CHANGED', '訂單、箱號或原單綁定已改變；不能回寫舊內容');
        const others = (await db.query('SELECT order_id FROM wms_ecount_order_references WHERE company_code=$1 AND voucher_number=$2 AND order_id<>$3 LIMIT 1', [job.company_code,job.voucher_number,job.order_id])).rows;
        if (others.length) throw fail('ECOUNT_BROWSER_DOCUMENT_CONFLICT', '原銷貨單對應多筆 WMS，必須先核對範圍');
        return loaded;
    }
    async function jobFor(db, jobId, body, user, { expired = false } = {}) {
        if (!uuid(jobId)) throw fail('ECOUNT_BROWSER_INVALID_INPUT', '工作編號無效', 400);
        const job = (await db.query('SELECT *,lease_expires_at>NOW() AS lease_valid FROM wms_ecount_browser_jobs WHERE id=$1 FOR UPDATE', [jobId])).rows[0];
        if (!job) throw fail('ECOUNT_BROWSER_NOT_FOUND', '找不到工作', 404);
        if (job.claimed_by !== user.id || job.worker_id !== body.workerId.toLowerCase() || typeof body.leaseToken !== 'string' || job.lease_token_hash !== digest(body.leaseToken)) throw fail('ECOUNT_BROWSER_LEASE_OWNERSHIP', '這筆工作由另一個登入人員或助手處理', 403);
        if (!expired && !job.lease_valid) throw fail('ECOUNT_BROWSER_LEASE_EXPIRED', '處理期限已過；若已嘗試儲存，只能重新讀取確認');
        await documentLock(db,job.company_code,job.voucher_number);
        return job;
    }
    async function status(actor, orderId) {
        if (orderId !== undefined && !validId(orderId)) throw fail('ECOUNT_BROWSER_INVALID_INPUT', '訂單編號無效', 400);
        return transaction(async db => {
            const user = await staff(db,actor), c = settings();
            const jobs = (await db.query(`SELECT j.*,(SELECT (e.details->>'definiteNoSave')='true' FROM wms_ecount_browser_events e WHERE e.job_id=j.id AND e.event_type='failed' ORDER BY e.id DESC LIMIT 1) AS definite_no_save FROM wms_ecount_browser_jobs j` + (orderId ? ' WHERE j.order_id=$1' : '') + ' ORDER BY j.created_at DESC,j.id DESC LIMIT 50', orderId ? [orderId] : [])).rows;
            return { mode:c.mode,enabled:c.enabled,canManage:manage(user),saveEnabled:false,configuration:{metadataFieldLabel:c.metadataFieldLabel,allowedDocuments:c.documents,companyMappings:c.mode==='test'?c.companyMappings:[],concurrencyRequired:true,testWriteEnabled:c.mode==='test'&&c.testWriteEnabled},jobs:jobs.map(publicJob) };
        },true);
    }
    async function reconcile(body,actor) {
        if (!Number.isSafeInteger(body?.limit) || body.limit<1 || body.limit>20 || body.orderId!==undefined&&!validId(body.orderId)) throw fail('ECOUNT_BROWSER_INVALID_INPUT', '每次最多核對 20 筆，訂單編號須有效',400);
        return command(body,actor,'reconcile',async (db,user,c) => {
            const orderIds=(await db.query(`SELECT o.id FROM orders o JOIN wms_ecount_order_references r ON r.order_id=o.id
                WHERE o.status='completed' AND o.document_type='shipment'
                AND EXISTS(SELECT 1 FROM wms_carton_allocations a WHERE a.order_id=o.id AND a.status='packed')
                AND NOT EXISTS(SELECT 1 FROM order_items i WHERE i.order_id=o.id AND i.quantity_sign<>1)
                AND NOT EXISTS(SELECT 1 FROM order_exceptions e WHERE e.order_id=o.id AND e.status='open')
                AND ($2::int IS NULL OR o.id=$2) AND ($2::int IS NOT NULL OR NOT EXISTS(SELECT 1 FROM wms_ecount_browser_jobs j WHERE j.order_id=o.id AND j.reference_revision=r.revision AND j.company_code=r.company_code AND j.voucher_number=r.voucher_number AND j.created_at>=o.updated_at))
                ORDER BY o.updated_at DESC,o.id DESC LIMIT $1 FOR UPDATE OF o SKIP LOCKED`,[body.limit,body.orderId||null])).rows;
            const results=[]; for(const row of orderIds) results.push({orderId:row.id,...await enqueueEcountBrowserSafely(db,row.id,{env})});
            return {results};
        });
    }
    async function claim(body,actor) {
        return command(body,actor,'claim',async(db,user,c)=>{
            // A lost response after a save-enabled prepare may have reached the
            // vendor. Only an explicit JSON false permission proves an expired
            // preview could not legitimately save; retain its immutable proof.
            const expired=(await db.query(`WITH expired AS (SELECT id FROM wms_ecount_browser_jobs WHERE status IN ('claimed','prepared') AND lease_expires_at<=NOW() ORDER BY lease_expires_at LIMIT 50 FOR UPDATE SKIP LOCKED)
                UPDATE wms_ecount_browser_jobs j SET status=CASE WHEN j.status='prepared' AND j.plan->'saveAllowed'='false'::jsonb THEN 'previewed' WHEN j.status='prepared' THEN 'uncertain' ELSE 'queued' END,
                last_error=CASE WHEN j.status='prepared' AND j.plan->'saveAllowed'='false'::jsonb THEN 'preview_expired_without_save_permission' WHEN j.status='prepared' THEN 'lease_expired_after_prepare' ELSE NULL END,
                updated_at=NOW() FROM expired WHERE j.id=expired.id RETURNING j.id,j.status,j.plan,j.plan_fingerprint`)).rows;
            for(const row of expired)await event(db,row.id,user.id,'lease_expired',{status:row.status,requiresReadOnlyRecovery:row.status==='uncertain',
                definiteNoSave:row.status==='previewed',...(row.status==='previewed'?{reason:'lease_expired_without_save_permission',plan:row.plan,planFingerprint:row.plan_fingerprint}:{})});
            const candidates=(await db.query("SELECT * FROM wms_ecount_browser_jobs WHERE status='queued' ORDER BY created_at,id LIMIT 20 FOR UPDATE SKIP LOCKED")).rows;
            for(const job of candidates){
                await documentLock(db,job.company_code,job.voucher_number);
                if((await db.query("SELECT id FROM wms_ecount_browser_jobs WHERE company_code=$1 AND voucher_number=$2 AND id<>$3 AND status IN ('claimed','prepared','uncertain') LIMIT 1",[job.company_code,job.voucher_number,job.id])).rows.length)continue;
                try { await current(db,job); } catch(error) {
                    if(!['ECOUNT_BROWSER_SHIPMENT_CHANGED','ECOUNT_BROWSER_DOCUMENT_CONFLICT'].includes(error.code))throw error;
                    await db.query("UPDATE wms_ecount_browser_jobs SET status='blocked',last_error=$2,updated_at=NOW() WHERE id=$1",[job.id,error.code]); await event(db,job.id,user.id,'blocked',{code:error.code}); continue;
                }
                const leaseToken=randomBytes(32).toString('hex');
                const claimed=(await db.query("UPDATE wms_ecount_browser_jobs SET status='claimed',claimed_by=$2,worker_id=$3,lease_token_hash=$4,lease_expires_at=NOW()+INTERVAL '120 seconds',updated_at=NOW() WHERE id=$1 RETURNING *",[job.id,user.id,body.workerId,digest(leaseToken)])).rows[0];
                await event(db,job.id,user.id,'claimed',{workerId:body.workerId});
                return {job:publicJob(claimed),leaseToken,leaseExpiresAt:iso(claimed.lease_expires_at)};
            }
            return {job:null};
        },true);
    }
    async function prepare(jobId,body,actor){
        return command(body,actor,['prepare',jobId],async(db,user,c)=>{
            const job=await jobFor(db,jobId,body,user); if(job.status!=='claimed')throw fail('ECOUNT_BROWSER_STATE_CHANGED','只有尚未準備儲存的工作可以建立預覽');
            const loaded=await current(db,job), prepared=buildPlan(loaded.manifest,loaded.binding,body.before,body.capabilities,c);
            const plan={...prepared.plan,saveAllowed:prepared.saveAllowed,acceptanceProof:c.acceptanceProof,mode:c.mode,testWriteEnabled:c.testWriteEnabled};
            const planFingerprint=digest(plan);
            const updated=(await db.query("UPDATE wms_ecount_browser_jobs SET status='prepared',before_snapshot=$2,plan=$3,plan_fingerprint=$4,lease_expires_at=NOW()+INTERVAL '120 seconds',updated_at=NOW() WHERE id=$1 RETURNING lease_expires_at",[jobId,JSON.stringify(prepared.before),JSON.stringify(plan),planFingerprint])).rows[0];
            await event(db,jobId,user.id,'prepared',{saveAllowed:prepared.saveAllowed,mode:c.mode,businessFingerprint:plan.businessFingerprint});
            return {job:{...publicJob(job),status:'prepared'},plan,planFingerprint,leaseExpiresAt:iso(updated.lease_expires_at),saveAllowed:prepared.saveAllowed,reason:prepared.reason};
        },true);
    }
    async function result(jobId,body,actor){
        return command(body,actor,['result',jobId],async(db,user,c)=>{
            const job=await jobFor(db,jobId,body,user,{expired:true});
            if(job.status!=='prepared'||job.plan_fingerprint!==body.planFingerprint||!['preview','saved','uncertain','failed'].includes(body.outcome))throw fail('ECOUNT_BROWSER_STATE_CHANGED','工作或回寫計畫已改變，請重新載入');
            let state=body.outcome==='preview'?'previewed':body.outcome==='failed'?'failed':'uncertain',after=null,lastError=null;
            if(body.outcome==='saved'){
                if(!job.plan.saveAllowed||!job.lease_valid||c.mode!==job.plan.mode||c.acceptanceProof!==job.plan.acceptanceProof) throw fail('ECOUNT_BROWSER_SAVE_NOT_ACCEPTED','此工作未通過儲存驗收，不能標示已回寫');
                if(c.mode==='test'&&(!c.testWriteEnabled||!c.documents.some(row=>row.companyCode===job.company_code&&row.voucherNumber===job.voucher_number)))throw fail('ECOUNT_BROWSER_SAVE_NOT_ACCEPTED','測試寫入範圍已關閉');
                try{after=snapshot(body.after);await current(db,job);verifyAfter(job.before_snapshot,after,job.plan);state=job.plan.mode==='test'?'test_verified':'verified';}catch(error){if(!error.code?.startsWith('ECOUNT_BROWSER_'))throw error;lastError=error.code;}
            }else if(body.outcome==='preview'){await current(db,job);}
            if(body.outcome==='uncertain'||body.outcome==='failed')lastError=typeof body.errorCode==='string'&&/^[A-Z0-9_]{1,100}$/.test(body.errorCode)?body.errorCode:'ASSISTANT_RESULT_UNCONFIRMED';
            await db.query("UPDATE wms_ecount_browser_jobs SET status=$2,after_snapshot=$3,last_error=$4,verified_at=CASE WHEN $2 IN ('verified','test_verified') THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$1",[jobId,state,after&&JSON.stringify(after),lastError]);
            const definiteNoSave=state==='failed'&&body.vendorSaveAttempted===false;
            await event(db,jobId,user.id,state,{businessInvariantVerified:['verified','test_verified'].includes(state),externalSaveClaimed:body.outcome==='saved',inventoryPostedByWms:false,definiteNoSave,lastError});
            return {job:publicJob({...job,status:state,last_error:lastError,definite_no_save:definiteNoSave}),verified:state==='verified',testVerified:state==='test_verified',readOnlyRecoveryRequired:state==='uncertain'};
        },true);
    }
    async function recover(jobId,body,actor){
        return command(body,actor,['recover',jobId],async(db,user,c)=>{
            const job=await jobFor(db,jobId,body,user,{expired:true});
            if(job.plan_fingerprint!==body.planFingerprint||!job.plan?.saveAllowed)throw fail('ECOUNT_BROWSER_RECOVERY_BLOCKED','此工作不屬於可唯讀確認的未知儲存結果');
            const receipt=state=>({job:{...publicJob(job),status:state,lastError:null},verified:state==='verified',testVerified:state==='test_verified',
                historicalVerified:state==='superseded_verified',historicalTestVerified:state==='superseded_verified'&&job.plan.mode==='test',newShipmentVerified:state==='verified'||state==='test_verified',recovered:true});
            const previouslyConfirmed=['verified','test_verified','superseded_verified'].includes(job.status);
            if(job.status==='superseded_verified'){
                // A previous successful recovery response may have been lost.
                // Return the immutable stored acknowledgement without another
                // vendor read/write or a duplicate success event.
                verifyFrozenAttempt(job,job.after_snapshot);
                return {...receipt(job.status),previouslyConfirmed:true};
            }
            if(!['uncertain','prepared','verified','test_verified'].includes(job.status))throw fail('ECOUNT_BROWSER_RECOVERY_BLOCKED','此工作不屬於可唯讀確認的未知儲存結果');
            const after=verifyFrozenAttempt(job,previouslyConfirmed?job.after_snapshot:body.after);
            let changedCode=null;
            try{await current(db,job);}catch(error){if(!['ECOUNT_BROWSER_SHIPMENT_CHANGED','ECOUNT_BROWSER_DOCUMENT_CONFLICT'].includes(error.code))throw error;changedCode=error.code;}
            if(changedCode){
                // The old binding is proved by its original immutable WMS
                // reference revision, not by the current replacement binding.
                const historical=(await db.query('SELECT after_state FROM wms_ecount_reference_history WHERE order_id=$1 AND revision=$2',[job.order_id,job.reference_revision])).rows;
                if(historical.length!==1||historical[0].after_state?.companyCode!==job.company_code||historical[0].after_state?.voucherNumber!==job.voucher_number
                    ||historical[0].after_state?.revision!==job.reference_revision)throw fail('ECOUNT_BROWSER_FROZEN_MAPPING_INVALID','找不到這次舊回寫所使用的原公司與銷貨單對照存證');
                await db.query("UPDATE wms_ecount_browser_jobs SET status='superseded_verified',after_snapshot=$2,last_error=$3,verified_at=NOW(),updated_at=NOW() WHERE id=$1",[jobId,JSON.stringify(after),changedCode]);
                await event(db,jobId,user.id,'superseded_attempt_readback_verified',{reason:changedCode,originalCompanyCode:job.company_code,originalVoucherNumber:job.voucher_number,originalReferenceRevision:job.reference_revision,
                    originalManifestFingerprint:job.manifest_fingerprint,before:job.before_snapshot,plan:job.plan,planFingerprint:job.plan_fingerprint,after,newShipmentVerified:false,inventoryPostedByWms:false});
                return {...receipt('superseded_verified'),newShipmentVerified:false};
            }
            if(previouslyConfirmed)return {...receipt(job.status),previouslyConfirmed:true};
            const state=job.plan.mode==='test'?'test_verified':'verified';
            await db.query("UPDATE wms_ecount_browser_jobs SET status=$3,after_snapshot=$2,last_error=NULL,verified_at=NOW(),updated_at=NOW() WHERE id=$1",[jobId,JSON.stringify(after),state]);
            await event(db,jobId,user.id,'verified_by_read_only_recovery',{inventoryPostedByWms:false});
            return receipt(state);
        },true);
    }
    async function retry(jobId,body,actor){
        if(!uuid(jobId)||body?.reason!==undefined&&(typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>1000||/[\u0000-\u001f\u007f]/.test(body.reason)))throw fail('ECOUNT_BROWSER_INVALID_INPUT','工作編號或重試原因無效',400);
        return command(body,actor,['retry',jobId],async(db,user)=>{
            const job=(await db.query(`SELECT j.*,(SELECT (e.details->>'definiteNoSave')='true' FROM wms_ecount_browser_events e WHERE e.job_id=j.id AND e.event_type='failed' ORDER BY e.id DESC LIMIT 1) AS definite_no_save FROM wms_ecount_browser_jobs j WHERE j.id=$1 FOR UPDATE OF j`,[jobId])).rows[0];
            if(!job)throw fail('ECOUNT_BROWSER_NOT_FOUND','找不到工作',404);
            if(!canRetryJob(job))throw fail('ECOUNT_BROWSER_RETRY_BLOCKED','只有確定尚未儲存的預覽或失敗工作可以重試；未知結果必須唯讀核對');
            await documentLock(db,job.company_code,job.voucher_number);await current(db,job);
            if((await db.query("SELECT id FROM wms_ecount_browser_jobs WHERE company_code=$1 AND voucher_number=$2 AND id<>$3 AND status IN ('claimed','prepared','uncertain') LIMIT 1",[job.company_code,job.voucher_number,job.id])).rows.length)throw fail('ECOUNT_BROWSER_RETRY_BLOCKED','原銷貨單仍有另一筆進行中或結果未知的工作，請先核對');
            await event(db,jobId,user.id,'retry_requested',{reason:body.reason?.trim()||'修正設定後重試未儲存工作',definiteNoSave:true,
                previous:{status:job.status,claimedBy:job.claimed_by,workerId:job.worker_id,leaseExpiresAt:iso(job.lease_expires_at),beforeSnapshot:job.before_snapshot,plan:job.plan,planFingerprint:job.plan_fingerprint,afterSnapshot:job.after_snapshot,lastError:job.last_error}});
            const updated=(await db.query("UPDATE wms_ecount_browser_jobs SET status='queued',claimed_by=NULL,worker_id=NULL,lease_token_hash=NULL,lease_expires_at=NULL,before_snapshot=NULL,plan=NULL,plan_fingerprint=NULL,after_snapshot=NULL,last_error=NULL,verified_at=NULL,updated_at=NOW() WHERE id=$1 RETURNING *",[jobId])).rows[0];
            return {job:publicJob(updated),retryQueued:true};
        });
    }
    return {status,reconcile,claim,prepare,result,recover,retry};
}
module.exports={createEcountBrowserService,enqueueEcountBrowserSafely,loadShipment,publicJob,canRetryJob};
