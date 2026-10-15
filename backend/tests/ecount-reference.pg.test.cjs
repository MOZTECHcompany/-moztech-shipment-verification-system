const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createEcountReferenceFixture } = require('./ecountReferenceFixture.cjs');

test('ECOUNT reference and exact manual evidence on disposable real PostgreSQL', {
    skip: process.env.WMS_PARITY_PG_TEST !== '1', timeout: 120000
}, async t => {
    const f = await createEcountReferenceFixture();
    t.after(() => f.close());
    f.attachReferences();
    const { api, ok } = f;
    const ref = (order, actor = 1) => api(actor, 'get', `/api/orders/${order}/ecount-reference`).then(ok);
    const input = (view, actor = 1, extra = {}) => ({ commandId: randomUUID(), expectedRevision: view.reference?.revision ?? 0,
        expectedFingerprint: view.fingerprint, expectedActorId: actor, companyCode: 'SYNTHETIC-CO', voucherNumber: `2026/10/15-${view.orderId}`, ...extra });
    const check = lines => ({ kind: 'manual-line-check', acknowledgeExistingSales: true, acknowledgeMetadataSaved: true, lines });
    const external = view => view.totals.map(row => ({ itemCode: row.itemCode, quantity: row.quantity, actualSN: row.actualSN }));
    const post = (order, body, actor = 1) => api(actor, 'post', `/api/orders/${order}/ecount-reference`, body);
    const historyEvidence = async order => (await f.db.query('SELECT evidence FROM wms_ecount_reference_history WHERE order_id=$1 ORDER BY revision DESC LIMIT 1',[order])).rows[0].evidence;
    const metadataCounts = async order => Object.fromEntries(await Promise.all([
        ['wms_ecount_order_references', 'order_id'], ['wms_ecount_reference_history', 'order_id'], ['wms_ecount_reference_commands', 'order_id']
    ].map(async ([table, field]) => [table, (await f.db.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${field}=$1`, [order])).rows[0].n])));
    const shipments = await f.complete25WithReleased();
    let lastView, originalCommand;

    await t.test('packed-only 25-unit manifest excludes released custody and GET is read-only for every staff role', async () => {
        const before = await f.businessSnapshot();
        for (const actor of [1,2,3,4,5,7,8]) {
            const view = await ref(shipments.order.id, actor);
            assert.equal(view.status, 'unlinked'); assert.equal(view.reference, null); assert.equal(view.ready, true);
            assert.deepEqual(view.blockers, []); assert.match(view.fingerprint, /^[a-f0-9]{64}$/);
            assert.deepEqual(view.cartonSummary, [{ cartonId: 'N1', quantity: 5 }, { cartonId: 'N2', quantity: 10 }, { cartonId: 'N3', quantity: 10 }]);
            assert.deepEqual(view.totals, [{ itemCode: 'SKU-25', quantity: 25, requiredQuantity: 25, boxedQuantity: 25, looseQuantity: 0, actualSN: [] }]);
            assert.equal(view.rows.reduce((n,row) => n + row.quantity, 0), 25); assert.equal(view.rows.length, 3);
            assert.ok(view.rows.every(row => row.cartonId !== 'N-RELEASED'));
            assert.equal(view.canManage, [1,4,5,7,8].includes(actor));
        }
        assert.deepEqual(await f.businessSnapshot(), before);
        assert.deepEqual(await metadataCounts(shipments.order.id), { wms_ecount_order_references: 0, wms_ecount_reference_history: 0, wms_ecount_reference_commands: 0 });
        const raw = ok(await api(1, 'get', `/api/orders/${shipments.order.id}/carton-shipments`));
        assert.equal(raw.allocations.length, 4); assert.equal(raw.allocations.filter(a => a.status === 'released').length, 1);
    });
    await t.test('saving an existing external sales number changes only local metadata and immutable audit, never warehouse quantities or identities', async () => {
        const before = await f.businessSnapshot();
        originalCommand = input(await ref(shipments.order.id));
        lastView = ok(await post(shipments.order.id, originalCommand));
        assert.equal(lastView.status, 'reference_only'); assert.equal(lastView.reference.revision, 1);
        assert.equal(lastView.reference.companyCode, 'SYNTHETIC-CO'); assert.equal(lastView.reference.voucherNumber, `2026/10/15-${shipments.order.id}`);
        assert.equal(lastView.reference.confirmedFingerprint, null); assert.equal(lastView.reference.confirmedBy, null);
        assert.equal(lastView.history.length, 1); assert.equal(lastView.history[0].eventType, 'reference_saved');
        assert.deepEqual(await f.businessSnapshot(), before);
        const audit = (await f.db.query("SELECT details::jsonb AS details,actor_snapshot FROM operation_logs WHERE order_id=$1 AND action_type='ecount_reference_saved'", [shipments.order.id])).rows;
        assert.equal(audit.length, 1); assert.equal(audit[0].actor_snapshot.id, 1);
        assert.equal(audit[0].details.externalSystemWritten, false); assert.equal(audit[0].details.inventoryPosted, false);
    });
    await t.test('manual evidence requires both acknowledgments and exact complete SKU/quantity coverage before confirmation', async () => {
        const before = await f.businessSnapshot(), counts = await metadataCounts(shipments.order.id);
        for (const confirmation of [check([{ itemCode: 'WRONG', quantity: 25, actualSN: [] }]), check([{ itemCode: 'SKU-25', quantity: 26, actualSN: [] }]),
            { ...check(external(lastView)), acknowledgeExistingSales: false }, { ...check(external(lastView)), acknowledgeMetadataSaved: false }]) {
            const result = await post(shipments.order.id, input(lastView, 1, { confirmation }));
            assert.equal(result.status, confirmation.acknowledgeExistingSales && confirmation.acknowledgeMetadataSaved ? 409 : 400);
        }
        assert.deepEqual(await metadataCounts(shipments.order.id), counts); assert.deepEqual(await f.businessSnapshot(), before);
        lastView = ok(await post(shipments.order.id, input(lastView, 4, { confirmation: check([
            { itemCode: 'SKU-25', quantity: 13, actualSN: [] }, { itemCode: 'SKU-25', quantity: 12, actualSN: [] }
        ]) }), 4));
        assert.equal(lastView.status, 'manual_checked'); assert.equal(lastView.reference.revision, 2);
        assert.equal(lastView.reference.confirmationKind, 'manual-line-check'); assert.equal(lastView.reference.confirmedFingerprint, lastView.fingerprint);
        assert.equal(lastView.reference.confirmedBy.id, 4); assert.equal(lastView.reference.confirmedBy.role, 'dispatcher');
        assert.equal(lastView.history[0].actorSnapshot.id, 4); assert.equal((await historyEvidence(shipments.order.id)).lines.length, 2);assert.equal((await historyEvidence(shipments.order.id)).shipmentSnapshot.fingerprint,lastView.fingerprint);
        assert.ok(lastView.history.every(event => !Object.hasOwn(event, 'evidence')));
        assert.match(lastView.history[0].evidenceFingerprint, /^[a-f0-9]{64}$/);
        assert.deepEqual(await f.businessSnapshot(), before);
    });
    await t.test('a reference-only save using an equivalent dated document is a no-op that cannot erase a completed manual check', async () => {
        const before = await f.businessSnapshot(), counts = await metadataCounts(shipments.order.id);
        const command = input(lastView, 4, { companyCode:' SYNTHETIC-CO ', voucherNumber:`2026.10.15－${String(shipments.order.id).padStart(5,'0')}`, confirmation:null });
        const unchanged = ok(await post(shipments.order.id, command, 4));
        assert.equal(unchanged.status, 'manual_checked'); assert.equal(unchanged.unchanged, true); assert.deepEqual(unchanged.reference, lastView.reference);
        assert.deepEqual(unchanged.history, lastView.history); assert.deepEqual(await f.businessSnapshot(), before);
        const after = await metadataCounts(shipments.order.id);
        assert.equal(after.wms_ecount_order_references, counts.wms_ecount_order_references);
        assert.equal(after.wms_ecount_reference_history, counts.wms_ecount_reference_history);
        assert.equal(after.wms_ecount_reference_commands, counts.wms_ecount_reference_commands + 1);
        assert.equal(ok(await post(shipments.order.id, command, 4)).replayed, true);
        assert.deepEqual(await metadataCounts(shipments.order.id), after);
    });
    await t.test('an old UUID replays the latest saved reference before stale checks and never duplicates a history row', async () => {
        const counts = await metadataCounts(shipments.order.id);
        const replay = ok(await post(shipments.order.id, originalCommand));
        assert.equal(replay.replayed, true); assert.equal(replay.status, 'manual_checked'); assert.equal(replay.reference.revision, 2);
        assert.deepEqual(await metadataCounts(shipments.order.id), counts);
        const conflict = await post(shipments.order.id, { ...originalCommand, voucherNumber: 'DIFFERENT-EC-NUMBER' });
        assert.equal(conflict.status, 409); assert.equal(conflict.body.code, 'ECOUNT_REFERENCE_COMMAND_CONFLICT');
    });
    await t.test('stale revision, stale fingerprint, changed actor and unreasoned sales-number replacement leave metadata unchanged', async () => {
        const counts = await metadataCounts(shipments.order.id), before = await f.businessSnapshot();
        for (const [extra, code, status] of [
            [{ expectedRevision: 1 }, 'ECOUNT_REFERENCE_VERSION_CHANGED', 409],
            [{ expectedFingerprint: '0'.repeat(64) }, 'ECOUNT_REFERENCE_SHIPMENT_CHANGED', 409],
            [{ expectedActorId: 8 }, 'ECOUNT_REFERENCE_ACTOR_CHANGED', 409],
            [{ voucherNumber: 'NEW-NUMBER' }, 'ECOUNT_REFERENCE_REASON_REQUIRED', 400]
        ]) {
            const result = await post(shipments.order.id, input(lastView, 1, extra));
            assert.equal(result.status, status); assert.equal(result.body.code, code);
        }
        assert.deepEqual(await metadataCounts(shipments.order.id), counts); assert.deepEqual(await f.businessSnapshot(), before);
    });
    await t.test('new sales-number reference with reason clears prior manual confirmation and preserves original before/after actor evidence', async () => {
        const previous = lastView.reference;
        lastView = ok(await post(shipments.order.id, input(lastView, 5, { voucherNumber: 'ALREADY-SAVED-EC-002', reason: 'Sales staff corrected the original reference' }), 5));
        assert.equal(lastView.status, 'reference_only'); assert.equal(lastView.reference.confirmedFingerprint, null);
        assert.equal(lastView.reference.revision, 3); assert.equal(lastView.history[0].before.voucherNumber, previous.voucherNumber);
        assert.equal(lastView.history[0].after.voucherNumber, 'ALREADY-SAVED-EC-002'); assert.equal(lastView.history[0].actorSnapshot.management_scope, 'orders');
        assert.equal(lastView.history[1].actorSnapshot.id, 4);
    });
    await t.test('all manager duties and dispatcher may record references while ordinary operators cannot, even with a fabricated actor claim', async () => {
        for (const actor of [1,4,5,7,8]) {
            const target = await f.completeOrdinary();
            const saved = ok(await post(target.order.id, input(await ref(target.order.id, actor), actor), actor));
            assert.equal(saved.reference.updatedBy.id, actor);
        }
        const target = await f.completeOrdinary(), view = await ref(target.order.id);
        for (const actor of [2,3]) assert.equal((await post(target.order.id, input(view, actor), actor)).status, 403);
        const { createEcountReferenceService } = require('../src/services/ecountReferenceService');
        await assert.rejects(createEcountReferenceService({ pool: f.pool }).save(target.order.id, input(view, 2), { id: 2, role: 'superadmin' }), error => error.status === 403);
        await f.db.query("UPDATE users SET role='picker' WHERE id=7");
        try { assert.equal((await post(target.order.id, input(view, 7), 7)).status, 403); }
        finally { await f.db.query("UPDATE users SET role='admin' WHERE id=7"); }
        assert.equal((await api(null, 'get', `/api/orders/${target.order.id}/ecount-reference`)).status, 401);
    });
    await t.test('concurrent same-command attempts replay once and independent stale edits cannot overwrite the winning reference', async () => {
        const target = await f.completeOrdinary(), view = await ref(target.order.id), command = input(view);
        const duplicates = await Promise.all([post(target.order.id, command), post(target.order.id, command)]);
        assert.deepEqual(duplicates.map(res => ok(res).replayed).sort(), [false, true]);
        assert.equal((await metadataCounts(target.order.id)).wms_ecount_reference_history, 1);
        const next = await ref(target.order.id);
        const edits = await Promise.all([post(target.order.id, input(next, 1, { voucherNumber: 'CONCURRENT-A', reason: 'First proposal' })), post(target.order.id, input(next, 5, { voucherNumber: 'CONCURRENT-B', reason: 'Second proposal' }), 5)]);
        assert.deepEqual(edits.map(res => res.status).sort(), [200,409]);
        assert.equal((await ref(target.order.id)).reference.revision, 2);
        assert.equal((await metadataCounts(target.order.id)).wms_ecount_reference_history, 2);
    });
    await t.test('the same dated ECOUNT document can be referenced by several orders but concurrent manual confirmation belongs to exactly one order', async () => {
        const a=await f.completeOrdinary(),b=await f.completeOrdinary(),company='CONCURRENT-DOCUMENT';
        const recorded=[];
        for(const target of [a,b])recorded.push(ok(await post(target.order.id,input(await ref(target.order.id),1,{companyCode:company,voucherNumber:'2026.10.15－000999'}))));
        assert.ok(recorded.every(view=>view.reference.voucherNumber==='2026/10/15-999'&&view.status==='reference_only'));
        const before=await f.businessSnapshot();
        const results=await Promise.all([a,b].map((target,index)=>post(target.order.id,input(recorded[index],1,{companyCode:company,voucherNumber:'2026-10-15-999',confirmation:check(external(recorded[index]))}))));
        assert.deepEqual(results.map(res=>res.status).sort(),[200,409]);assert.equal(results.find(res=>res.status===409).body.code,'ECOUNT_REFERENCE_DOCUMENT_CONFLICT');
        assert.equal((await f.db.query("SELECT count(*)::int AS n FROM wms_ecount_order_references WHERE company_code=$1 AND confirmation_kind IS NOT NULL",[company])).rows[0].n,1);
        assert.deepEqual(await f.businessSnapshot(),before);
    });
    await t.test('non-dated identifiers may remain a reference but cannot be asserted as manually verified sales', async () => {
        const target=await f.completeOrdinary(),saved=ok(await post(target.order.id,input(await ref(target.order.id),4,{companyCode:'FORMAT-CHECK',voucherNumber:'INTERNAL-BATCH-NOT-SALES'}),4));
        assert.equal(saved.status,'reference_only');
        const invalid=await post(target.order.id,input(saved,4,{companyCode:'FORMAT-CHECK',voucherNumber:'INTERNAL-BATCH-NOT-SALES',confirmation:check(external(saved))}),4);
        assert.equal(invalid.status,400);assert.equal(invalid.body.code,'ECOUNT_REFERENCE_VOUCHER_FORMAT');
        const canonical=ok(await post(target.order.id,input(saved,4,{companyCode:'FORMAT-CHECK',voucherNumber:'2026/10/15 -0001',reason:'Replace internal identifier with actual saved document',confirmation:check(external(saved))}),4));
        assert.equal(canonical.status,'manual_checked');assert.equal(canonical.reference.voucherNumber,'2026/10/15-1');
    });
    await t.test('a lost COMMIT response reports unknown and retrying the original UUID recovers exactly one reference without business changes', async () => {
        const target = await f.completeOrdinary(), view = await ref(target.order.id), command = input(view);
        const before = await f.businessSnapshot();
        f.failAfterNext(sql => sql === 'COMMIT');
        const uncertain = await post(target.order.id, command);
        assert.equal(uncertain.status, 503); assert.equal(uncertain.body.code, 'ECOUNT_REFERENCE_RESULT_UNKNOWN');
        const replay = ok(await post(target.order.id, command));
        assert.equal(replay.replayed, true); assert.equal(replay.reference.revision, 1);
        assert.equal((await metadataCounts(target.order.id)).wms_ecount_reference_history, 1); assert.deepEqual(await f.businessSnapshot(), before);
    });
    await t.test('failure to persist audit rolls back reference, evidence, command and every warehouse row', async () => {
        const target = await f.completeOrdinary(), command = input(await ref(target.order.id));
        const before = await f.businessSnapshot();
        f.failNext(sql => sql.includes('INSERT INTO operation_logs'));
        assert.equal((await post(target.order.id, command)).status, 500);
        assert.deepEqual(await metadataCounts(target.order.id), { wms_ecount_order_references: 0, wms_ecount_reference_history: 0, wms_ecount_reference_commands: 0 });
        assert.deepEqual(await f.businessSnapshot(), before);
    });
    await t.test('incomplete, signed, held or unresolved-change shipments may store a reference but cannot claim manual confirmation', async () => {
        await f.db.exec('ALTER TABLE orders ADD COLUMN warehouse_hold BOOLEAN DEFAULT FALSE');
        for (const kind of ['incomplete','signed','held','change']) {
            const target = kind === 'incomplete' ? await f.seed(2) : kind === 'signed' ? await f.seed(2, { sign: -1, status: 'completed' }) : await f.completeOrdinary(2);
            if (kind === 'signed') await f.db.query('UPDATE order_items SET picked_quantity=2,packed_quantity=2 WHERE order_id=$1', [target.order.id]);
            if (kind === 'held') await f.db.query('UPDATE orders SET warehouse_hold=TRUE WHERE id=$1', [target.order.id]);
            if (kind === 'change') await f.db.query("INSERT INTO order_exceptions(order_id,type,status,reason_text,created_by) VALUES($1,'order_change','open','Pending warehouse review',4)", [target.order.id]);
            const view = await ref(target.order.id);
            assert.equal(view.ready, false); assert.ok(view.blockers.some(row => ({ incomplete:'ORDER_NOT_COMPLETED', signed:'SIGNED_ORDER', held:'ORDER_HELD', change:'PENDING_EXCEPTION' })[kind] === row.code));
            const reference = ok(await post(target.order.id, input(view)));
            const lines = kind === 'incomplete' ? [{ itemCode:'SKU-25',quantity:2,actualSN:[] }] : external(view);
            const denied = await post(target.order.id, input(reference, 1, { confirmation: check(lines) }));
            assert.equal(denied.status, 409); assert.equal(denied.body.code, 'ECOUNT_REFERENCE_NOT_READY');
        }
    });
    await t.test('boxed and loose ordinary/SN contents remain exact, complete and case-sensitive in manual external evidence', async () => {
        const sns=['000Case/01','000case+02'],looseSN='000Loose/01';
        const box=await f.carton('REFERENCE-EXACT-SNS',2,{itemCode:'SN-EXACT',barcode:'4710000000091',actualSN:sns});
        const target=await f.seed(2,{itemCode:'SN-EXACT',barcode:'4710000000091',actualSN:sns,serialMode:'exact'});
        await f.db.query("INSERT INTO order_items(order_id,product_code,barcode,product_name,quantity) VALUES($1,'LOOSE-UNITS','LOOSE-QTY-CODE','Synthetic loose units',3)",[target.order.id]);
        const serialItem=(await f.db.query("INSERT INTO order_items(order_id,product_code,barcode,product_name,quantity,serial_identity_mode) VALUES($1,'LOOSE-SERIAL','LOOSE-SN-CODE','Synthetic loose serial',1,'exact') RETURNING id",[target.order.id])).rows[0].id;
        await f.db.query('INSERT INTO order_item_instances(order_item_id,serial_number) VALUES($1,$2)',[serialItem,looseSN]);
        const unit=(stage,scanValue)=>api(2,'post','/api/orders/update_item',{orderId:target.order.id,type:stage,scanValue,amount:1}).then(ok);
        await f.scan(target.order.id,box.cartonId,'pick');for(let n=0;n<3;n++)await unit('pick','LOOSE-QTY-CODE');await unit('pick',looseSN);
        await f.claim(target.order.id,'pack');await f.scan(target.order.id,box.cartonId,'pack');for(let n=0;n<3;n++)await unit('pack','LOOSE-QTY-CODE');await unit('pack',looseSN);
        const view=await ref(target.order.id);assert.equal(view.ready,true);assert.equal(view.rows.length,1);assert.equal(view.rows[0].quantity,2);assert.deepEqual(view.rows[0].actualSN,sns);
        assert.equal(view.looseRows.length,2);assert.equal(view.looseRows.reduce((n,row)=>n+row.quantity,0),4);assert.equal(view.totals.reduce((n,row)=>n+row.quantity,0),6);
        const lines=[...sns.map(sn=>({itemCode:'SN-EXACT',quantity:1,actualSN:[sn]})),{itemCode:'LOOSE-UNITS',quantity:3,actualSN:[]},{itemCode:'LOOSE-SERIAL',quantity:1,actualSN:[looseSN]}];
        const before=await f.businessSnapshot();
        for(const kind of ['wrong-case','missing-leading-zeros','missing-sns','duplicate-sns']) {
            const changed=structuredClone(lines);
            if(kind==='wrong-case')changed[0].actualSN=['000CASE/01'];
            if(kind==='missing-leading-zeros')changed[0].actualSN=['Case/01'];
            if(kind==='missing-sns')changed[0].actualSN=[];
            if(kind==='duplicate-sns')changed[1].actualSN=[sns[0]];
            assert.equal((await post(target.order.id,input(view,4,{confirmation:check(changed)}),4)).status,kind==='duplicate-sns'?400:409);
        }
        assert.deepEqual(await f.businessSnapshot(),before);
        const saved=ok(await post(target.order.id,input(view,4,{confirmation:check(lines)}),4));assert.equal(saved.status,'manual_checked');assert.equal((await historyEvidence(target.order.id)).lines.length,4);
        assert.deepEqual((await historyEvidence(target.order.id)).lines.flatMap(line=>line.actualSN).sort(),[...sns,looseSN].sort());
        assert.deepEqual(await f.businessSnapshot(),before);
    });
    await t.test('real shared source-batch receipts map only exact source lines to each work order and never auto-confirm metadata', async () => {
        await f.db.exec(`ALTER TABLE orders ADD COLUMN import_batch_id INTEGER, ADD COLUMN source_platform TEXT, ADD COLUMN source_store TEXT, ADD COLUMN source_order_number TEXT;
            ALTER TABLE order_items ADD COLUMN source_line_id TEXT;
            CREATE TABLE warehouse_import_batches(id INTEGER PRIMARY KEY,voucher_number TEXT);
            CREATE TABLE marketplace_intake_orders(id INTEGER PRIMARY KEY,intake_id TEXT);
            CREATE TABLE marketplace_work_order_links(order_id INTEGER,intake_order_id INTEGER);
            CREATE TABLE marketplace_warehouse_flows(intake_id TEXT,erp_receipt JSONB);`);
        const a=await f.completeOrdinary(2),b=await f.completeOrdinary(3);
        await f.db.query("INSERT INTO warehouse_import_batches VALUES(42,'SOURCE-SHARED-BATCH')");
        await f.db.query("INSERT INTO marketplace_intake_orders VALUES(1,'SHARED-INTAKE'),(2,'SHARED-INTAKE')");
        await f.db.query('INSERT INTO marketplace_work_order_links VALUES($1,1),($2,2)',[a.order.id,b.order.id]);
        for(const [order,source,line]of [[a.order.id,'SOURCE-A','LINE-A'],[b.order.id,'SOURCE-B','LINE-B']]) {
            await f.db.query("UPDATE orders SET import_batch_id=42,source_platform='MARKET',source_store='STORE',source_order_number=$1 WHERE id=$2",[source,order]);
            await f.db.query('UPDATE order_items SET source_line_id=$1 WHERE order_id=$2',[line,order]);
        }
        const receipt={fingerprint:'a'.repeat(64),verificationKind:'sales-receipt',vouchers:['EXTERNAL-EC-A','EXTERNAL-EC-B'],lines:[
            {identity:['MARKET','STORE','SOURCE-A','LINE-A'],productCode:'SKU-25',quantity:2,voucher:'EXTERNAL-EC-A'},
            {identity:['MARKET','STORE','SOURCE-B','LINE-B'],productCode:'SKU-25',quantity:3,voucher:'EXTERNAL-EC-B'}]};
        await f.db.query("INSERT INTO marketplace_warehouse_flows VALUES('SHARED-INTAKE',$1)",[JSON.stringify(receipt)]);
        for(const [order,voucher]of [[a.order.id,'EXTERNAL-EC-A'],[b.order.id,'EXTERNAL-EC-B']]) {
            const raw=ok(await api(1,'get',`/api/orders/${order}/carton-shipments`));assert.deepEqual(raw.ecountVouchers,[voucher]);assert.equal(raw.allocations.length,1);
            const view=await ref(order);assert.equal(view.reference,null);assert.equal(view.status,'unlinked');
        }
        delete receipt.lines;await f.db.query("UPDATE marketplace_warehouse_flows SET erp_receipt=$1",[JSON.stringify(receipt)]);
        const raw=ok(await api(1,'get',`/api/orders/${a.order.id}/carton-shipments`));assert.deepEqual(raw.ecountVouchers,[]);assert.ok(raw.referenceWarning);assert.equal(raw.allocations[0].status,'packed');
    });
    await t.test('same quantities with a different physical-carton identity invalidate stale confirmation while another order remainder never does', async () => {
        const box = await f.carton('REFERENCE-TAIL-STABILITY', 10), first = await f.seed(5);
        await f.scan(first.order.id, box.cartonId, 'pick', { mode:'split', selections:[{lineId:box.lines[0].lineId,quantity:5}] });
        await f.scan(first.order.id, box.cartonId, 'pack');
        const initial = await ref(first.order.id);
        const checked = ok(await post(first.order.id, input(initial, 1, { confirmation:check(external(initial)) })));
        const second = await f.seed(5); await f.scan(second.order.id, box.cartonId, 'pick'); await f.scan(second.order.id, box.cartonId, 'pack');
        const afterOtherOrder = await ref(first.order.id);
        assert.equal(afterOtherOrder.fingerprint, checked.fingerprint); assert.equal(afterOtherOrder.status, 'manual_checked');
        const replacement = await f.carton('REFERENCE-CORRECTED-BOX', 5);
        // Simulate a persisted legacy custody correction with the same quantities.
        // The public carton API correctly forbids rewriting a packed allocation.
        await f.db.query('UPDATE wms_carton_allocations SET carton_id=$1 WHERE order_id=$2', [replacement.cartonId,first.order.id]);
        const changed = await ref(first.order.id); assert.equal(changed.status, 'changed'); assert.notEqual(changed.fingerprint, checked.fingerprint);
        const denied = await post(first.order.id, input(checked, 1, { confirmation:check(external(checked)) }));
        assert.equal(denied.status,409); assert.equal(denied.body.code,'ECOUNT_REFERENCE_SHIPMENT_CHANGED');
        const counts = await metadataCounts(first.order.id), before = await f.businessSnapshot();
        const alias = ok(await post(first.order.id, input(changed, 4, { voucherNumber:`2026-10-15-${String(first.order.id).padStart(5,'0')}`, confirmation:null }), 4));
        assert.equal(alias.status, 'changed'); assert.equal(alias.unchanged, true); assert.deepEqual(alias.reference, checked.reference);
        assert.deepEqual(alias.history, changed.history); assert.deepEqual(await f.businessSnapshot(), before);
        const after = await metadataCounts(first.order.id);
        assert.equal(after.wms_ecount_reference_history, counts.wms_ecount_reference_history);
        assert.equal(after.wms_ecount_reference_commands, counts.wms_ecount_reference_commands + 1);
        const third = await f.completeOrdinary(5), other = await ref(third.order.id);
        const duplicate = await post(third.order.id, input(other, 1, { voucherNumber:checked.reference.voucherNumber, confirmation:check(external(other)) }));
        assert.equal(duplicate.status,409); assert.equal(duplicate.body.code,'ECOUNT_REFERENCE_DOCUMENT_CONFLICT');
        assert.equal((await ref(first.order.id)).status, 'changed');
    });
});
