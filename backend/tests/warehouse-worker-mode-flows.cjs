const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('node:crypto');

// Independent, disposable real-HTTP fixtures. The legacy picker/packer fixtures
// retain explicit single-stage grants to verify backward-compatible workflows.
module.exports = async ({ t, api, ok, pool, users, tokens, password, observedEvents }) => {
    let sequence = 0;
    const barcode = 'DUAL-WORK-CODE';
    async function fixture(quantity = 3, serials = []) {
        const order = (await pool.query("INSERT INTO orders(voucher_number,customer_name,status) VALUES($1,'Dual work fixture','pending') RETURNING id", ['DUAL-WORK-' + ++sequence])).rows[0].id;
        const item = (await pool.query('INSERT INTO order_items(order_id,product_code,barcode,product_name,quantity) VALUES($1,$2,$2,$3,$4) RETURNING id', [order, barcode, 'Dual work product', quantity])).rows[0].id;
        for (const sn of serials) await pool.query("INSERT INTO order_item_instances(order_item_id,serial_number,status) VALUES($1,$2,'pending')", [item, sn]);
        await pool.query("INSERT INTO operation_logs(order_id,user_id,action_type,details) VALUES($1,$2,'import','{}')", [order, users.dispatcher]);
        return { order, item };
    }
    const claim = (role, order, stage) => api(role, 'POST', `/api/orders/${order}/claim`, { stage });
    const scan = (role, order, type, amount = 1, value = barcode, extra = {}) => api(role, 'POST', '/api/orders/update_item', { orderId: order, scanValue: value, type, amount, ...extra });
    const snapshot = async (order, role = 'dualWorker') => ok(await api(role, 'GET', `/api/orders/${order}/work-snapshot`));
    const stored = async order => ({
        order: (await pool.query('SELECT * FROM orders WHERE id=$1', [order])).rows[0],
        items: (await pool.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY id', [order])).rows,
        instances: (await pool.query('SELECT i.* FROM order_item_instances i JOIN order_items oi ON oi.id=i.order_item_id WHERE oi.order_id=$1 ORDER BY i.id', [order])).rows
    });
    const audit = async order => (await pool.query('SELECT * FROM operation_logs WHERE order_id=$1 ORDER BY id', [order])).rows;
    for (const [key, role] of [['dualWorker', 'picker'], ['dualPacker', 'packer'], ['dualAlternate', 'picker']]) {
        users[key] = (await pool.query('INSERT INTO users(username,password,name,role) VALUES($1,$2,$3,$4) RETURNING id', [key, await bcrypt.hash(password, 4), 'Fixture ' + key, role])).rows[0].id;
        const login = ok(await api(null, 'POST', '/api/auth/login', { username: key, password }));
        tokens[key] = login.accessToken;
    }
    const originalIdentity = (await pool.query('SELECT id,username,password,name,role,management_scope FROM users WHERE id=$1', [users.dualWorker])).rows[0];

    await t.test('one legacy picking or packing identity receives both work grants without changing credentials, role or management scope', async () => {
        for (const role of ['dualWorker', 'dualPacker', 'orderManager', 'warehouseManager', 'superadmin']) {
            const person = ok(await api(role, 'GET', '/api/auth/me')).user;
            assert.deepEqual(person.work_types, ['pick', 'pack'], role);
            assert.equal(person.password, undefined);
            const mode = ok(await api(role, 'GET', '/api/warehouse/work-mode'));
            assert.deepEqual(mode.work_types, ['pick', 'pack']);
            assert.match(mode.work_date, /^\d{4}-\d{2}-\d{2}$/);
            assert.equal(mode.default_stage, role === 'dualPacker' ? 'pack' : 'pick');
        }
        assert.deepEqual(ok(await api('dispatcher', 'GET', '/api/auth/me')).user.work_types, []);
        assert.deepEqual(ok(await api('picker', 'GET', '/api/auth/me')).user.work_types, ['pick']);
        assert.deepEqual(ok(await api('packer', 'GET', '/api/auth/me')).user.work_types, ['pack']);
        assert.deepEqual((await pool.query('SELECT id,username,password,name,role,management_scope FROM users WHERE id=$1', [users.dualWorker])).rows[0], originalIdentity);
        assert.equal(ok(await api('orderManager', 'GET', '/api/order-reviews')).canReview, false);
    });
    await t.test('daily self selection and warehouse assignments are separate, validated and leave active order owners and progress intact', async () => {
        const { order } = await fixture();
        ok(await claim('dualWorker', order, 'pick')); ok(await scan('dualWorker', order, 'pick'));
        const before = await stored(order);
        const picked = ok(await api('dualWorker', 'PUT', '/api/warehouse/work-mode', { stage: 'pick' }));
        assert.equal(picked.choice_stage, 'pick');
        for (const role of ['dispatcher', 'orderManager', 'dualWorker']) assert.equal((await api(role, 'PUT', `/api/warehouse/operators/${users.dualWorker}/today`, { stage: 'pack' })).status, 403, role);
        assert.equal((await api('dispatcher', 'PUT', '/api/warehouse/work-mode', { stage: 'pack' })).status, 403);
        assert.equal((await api('dualWorker', 'PUT', '/api/warehouse/work-mode', { stage: 'shipping' })).status, 400);
        assert.equal((await api('warehouseManager', 'PUT', `/api/warehouse/operators/${users.picker}/today`, { stage: 'pack' })).status, 403);
        const assignment = ok(await api('warehouseManager', 'PUT', `/api/warehouse/operators/${users.dualWorker}/today`, { stage: 'pack' }));
        assert.equal(assignment.default_stage, 'pack'); assert.equal(assignment.choice_stage, 'pick');
        assert.equal(assignment.today_assignment.stage, 'pack'); assert.equal(assignment.today_assignment.assigned_by_name, 'warehouseManager');
        const choice = ok(await api('dualWorker', 'PUT', '/api/warehouse/work-mode', { stage: 'pack' }));
        assert.equal(choice.choice_stage, 'pack'); assert.equal(choice.today_assignment.stage, 'pack');
        assert.deepEqual(await stored(order), before);
        const operators = ok(await api('dualWorker', 'GET', '/api/warehouse/operators')).items;
        assert.ok(operators.find(person => person.id === users.dualWorker).work_types.includes('pack'));
        assert.ok(!operators.some(person => person.id === users.dispatcher));
        assert.equal((await api('dispatcher', 'GET', '/api/warehouse/operators')).status, 403);
        const assignedLog = (await pool.query("SELECT * FROM operation_logs WHERE action_type='work_assigned' AND details::jsonb->>'target_user_id'=$1 ORDER BY id DESC LIMIT 1", [String(users.dualWorker)])).rows[0];
        assert.equal(assignedLog.user_id, users.warehouseManager); assert.equal(assignedLog.work_type, 'pack'); assert.equal(assignedLog.actor_snapshot.id, users.warehouseManager);
        assert.ok(observedEvents.some(event => event.event === 'work_assignment_changed' && event.body.userId === users.dualWorker));
    });
    await t.test('mid-task pause and resume retain owner, signed lines and SN progress while state tokens invalidate queued scans', async () => {
        const serials = ['DUALPAUSESN01', 'DUALPAUSESN02'];
        const { order } = await fixture(2, serials);
        await pool.query("UPDATE orders SET document_type='reversal' WHERE id=$1", [order]);
        await pool.query('UPDATE order_items SET quantity_sign=-1 WHERE order_id=$1', [order]);
        ok(await claim('dualWorker', order, 'pick')); ok(await scan('dualWorker', order, 'pick', 1, serials[0]));
        const before = await snapshot(order), beforeRows = await stored(order);
        const paused = ok(await api('dualWorker', 'POST', `/api/orders/${order}/work-pause`, { stage: 'pick' }));
        assert.ok(paused.order.pick_paused_at); assert.notEqual(paused.stateToken, before.stateToken);
        const pausedRows = await stored(order);
        assert.equal(pausedRows.order.picker_id, users.dualWorker); assert.equal(pausedRows.order.status, 'picking');
        assert.deepEqual(pausedRows.items, beforeRows.items); assert.deepEqual(pausedRows.instances, beforeRows.instances);
        assert.deepEqual(pausedRows.instances.map(row => [row.serial_number, row.status]), [[serials[0], 'picked'], [serials[1], 'pending']]);
        for (const role of ['dualWorker', 'superadmin']) assert.equal((await scan(role, order, 'pick', 1, serials[1])).status, 409);
        const stale = await scan('dualWorker', order, 'pick', 1, serials[1], { responseMode: 'delta-v1', commandId: randomUUID(), expectedState: before.stateToken });
        assert.equal(stale.status, 409);
        ok(await api('dualWorker', 'PUT', '/api/warehouse/work-mode', { stage: 'pack' }));
        assert.deepEqual(await stored(order), pausedRows, 'Changing the daily mode never mutates the active task');
        ok(await api('dualWorker', 'POST', `/api/orders/${order}/work-pause`, { stage: 'pick' }));
        assert.equal((await audit(order)).filter(row => row.action_type === 'work_pause').length, 1, 'Repeated pause is idempotent');
        const resumed = ok(await api('dualWorker', 'POST', `/api/orders/${order}/work-resume`, { stage: 'pick' }));
        assert.equal(resumed.order.pick_paused_at, null); assert.notEqual(resumed.stateToken, paused.stateToken);
        const resumeRows = await stored(order);
        assert.deepEqual(resumeRows.items, pausedRows.items); assert.deepEqual(resumeRows.instances, pausedRows.instances);
        ok(await scan('dualWorker', order, 'pick', 1, serials[1]));
        assert.equal((await snapshot(order)).order.status, 'picked');
        assert.equal((await scan('dualWorker', order, 'pack', 1, serials[0])).status, 409, 'The next scan must not silently change picking to packing');
        ok(await claim('dualWorker', order, 'pack'));
        ok(await scan('dualWorker', order, 'pack', 1, serials[0]));
        const beforePackPause = await stored(order);
        const packPaused = ok(await api('dualWorker', 'POST', `/api/orders/${order}/work-pause`, { stage: 'pack' }));
        assert.ok(packPaused.order.pack_paused_at); assert.equal(packPaused.order.status, 'packing');
        assert.equal((await scan('dualWorker', order, 'pack', 1, serials[1])).status, 409);
        ok(await api('dualWorker', 'POST', `/api/orders/${order}/work-resume`, { stage: 'pack' }));
        const afterPackResume = await stored(order);
        assert.deepEqual(afterPackResume.items, beforePackPause.items); assert.deepEqual(afterPackResume.instances, beforePackPause.instances);
        ok(await scan('dualWorker', order, 'pack', 1, serials[1]));
        const complete = await snapshot(order);
        assert.equal(complete.order.status, 'completed'); assert.equal(complete.order.picker_id, users.dualWorker); assert.equal(complete.order.packer_id, users.dualWorker);
        const logs = (await audit(order)).filter(row => ['pick', 'pack'].includes(row.action_type));
        assert.deepEqual(logs.map(row => [row.user_id, row.work_type]), [[users.dualWorker, 'pick'], [users.dualWorker, 'pick'], [users.dualWorker, 'pack'], [users.dualWorker, 'pack']]);
        for (const row of logs) {
            assert.equal(row.actor_snapshot.id, users.dualWorker); assert.equal(row.actor_snapshot.role, 'picker');
            const details = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
            assert.equal(details.operation_context, 'owner'); assert.ok(details.instanceId); assert.ok(details.orderItemId);
            assert.equal(details.before.status, row.work_type === 'pick' ? 'pending' : 'picked');
            assert.equal(details.after.status, row.work_type === 'pick' ? 'picked' : 'packed');
        }
    });
    await t.test('order, warehouse and system managers perform real-stage work without replacing task owners or receiving extra approval powers', async () => {
        const { order } = await fixture(3);
        ok(await claim('dualWorker', order, 'pick'));
        for (const role of ['orderManager', 'warehouseManager', 'superadmin']) ok(await scan(role, order, 'pick'));
        let current = await snapshot(order);
        assert.equal(current.order.status, 'picked'); assert.equal(current.order.picker_id, users.dualWorker);
        ok(await claim('dualWorker', order, 'pack'));
        for (const role of ['orderManager', 'warehouseManager', 'superadmin']) ok(await scan(role, order, 'pack'));
        current = await snapshot(order); assert.equal(current.order.packer_id, users.dualWorker); assert.equal(current.order.status, 'completed');
        const logs = (await audit(order)).filter(row => ['pick', 'pack'].includes(row.action_type));
        assert.equal(logs.length, 6);
        for (const [index, role] of ['orderManager', 'warehouseManager', 'superadmin', 'orderManager', 'warehouseManager', 'superadmin'].entries()) {
            assert.equal(logs[index].user_id, users[role]); assert.equal(logs[index].actor_snapshot.id, users[role]); assert.equal(logs[index].work_type, index < 3 ? 'pick' : 'pack');
            assert.equal(logs[index].actor_snapshot.role, role === 'superadmin' ? 'superadmin' : 'admin');
            const details = typeof logs[index].details === 'string' ? JSON.parse(logs[index].details) : logs[index].details;
            assert.equal(details.operation_context, 'assistance'); assert.ok(details.orderItemId);
            assert.equal(details.after[index < 3 ? 'picked_quantity' : 'packed_quantity'] - details.before[index < 3 ? 'picked_quantity' : 'packed_quantity'], 1);
        }
        assert.equal(ok(await api('orderManager', 'GET', '/api/order-reviews')).canReview, false);
        const own = await fixture(1); ok(await claim('orderManager', own.order, 'pick')); ok(await scan('orderManager', own.order, 'pick'));
        ok(await claim('orderManager', own.order, 'pack')); ok(await scan('orderManager', own.order, 'pack'));
        const managed = await snapshot(own.order); assert.equal(managed.order.picker_id, users.orderManager); assert.equal(managed.order.packer_id, users.orderManager);
    });
    await t.test('supervisor handoff records the actual old owner, receiver, performer and pre-handoff progress, including opposite legacy roles', async () => {
        const { order } = await fixture(3);
        ok(await claim('dualWorker', order, 'pick')); ok(await scan('dualWorker', order, 'pick'));
        ok(await api('dualWorker', 'POST', `/api/orders/${order}/work-pause`, { stage: 'pick' }));
        const before = await stored(order);
        const body = { to_user_id: users.dualPacker, task_type: 'pick', reason: 'Warehouse supervisor shift handoff' };
        assert.equal((await api('dualAlternate', 'POST', `/api/tasks/${order}/transfer`, body)).status, 403);
        assert.equal((await api('warehouseManager', 'POST', `/api/tasks/${order}/transfer`, { ...body, to_user_id: users.packer })).status, 403);
        await pool.query(`CREATE FUNCTION fail_worker_handoff_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.order_id=${order} AND NEW.action_type='transfer' THEN RAISE EXCEPTION 'Fixture handoff audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_worker_handoff_audit BEFORE INSERT ON operation_logs FOR EACH ROW EXECUTE FUNCTION fail_worker_handoff_audit()`);
        try {
            assert.equal((await api('warehouseManager', 'POST', `/api/tasks/${order}/transfer`, body)).status, 500);
            assert.deepEqual(await stored(order), before, 'Audit failure rolls back reassignment, pause changes and progress');
            assert.equal(ok(await api('warehouseManager', 'GET', `/api/orders/${order}/handoffs`)).items.length, 0);
        } finally { await pool.query('DROP TRIGGER fail_worker_handoff_audit ON operation_logs; DROP FUNCTION fail_worker_handoff_audit()'); }
        ok(await api('warehouseManager', 'POST', `/api/tasks/${order}/transfer`, body));
        const after = await stored(order); assert.equal(after.order.picker_id, users.dualPacker); assert.equal(after.order.status, 'picking');
        assert.deepEqual(after.items, before.items); assert.deepEqual(after.instances, before.instances);
        const rows = ok(await api('dualPacker', 'GET', `/api/orders/${order}/handoffs`)).items; assert.equal(rows.length, 1);
        const row = rows[0]; assert.equal(row.from_user_id, users.dualWorker); assert.equal(row.to_user_id, users.dualPacker); assert.equal(row.performed_by, users.warehouseManager);
        assert.equal(row.task_type, 'pick'); assert.equal(row.has_actor_snapshot, true);
        assert.equal(row.from_snapshot.id, users.dualWorker); assert.equal(row.to_snapshot.id, users.dualPacker); assert.equal(row.actor_snapshot.id, users.warehouseManager);
        assert.equal(row.progress_snapshot.stage, 'pick'); assert.equal(row.progress_snapshot.picked_quantity, 1);
        assert.equal(row.progress_snapshot.packed_quantity, 0); assert.equal(row.progress_snapshot.items[0].picked_quantity, 1);
        assert.equal((await scan('dualWorker', order, 'pick')).status, 403);
        if (after.order.pick_paused_at) ok(await api('dualPacker', 'POST', `/api/orders/${order}/work-resume`, { stage: 'pick' }));
        ok(await scan('dualPacker', order, 'pick', 2));
        const log = (await audit(order)).find(row => row.action_type === 'transfer'); assert.equal(log.user_id, users.warehouseManager); assert.equal(log.work_type, 'pick');
        assert.ok(observedEvents.some(event => event.event === 'task_transferred' && Number(event.body.orderId) === order && event.body.from_user_id === users.dualWorker));
    });
    await t.test('stage grants from the current database immediately restrict existing JWTs without rewriting roles, password hashes or history', async () => {
        const { order } = await fixture(1);
        ok(await claim('dualAlternate', order, 'pick')); ok(await scan('dualAlternate', order, 'pick'));
        const original = (await pool.query('SELECT username,password,role FROM users WHERE id=$1', [users.dualAlternate])).rows[0];
        ok(await api('superadmin', 'PUT', `/api/admin/users/${users.dualAlternate}`, { can_pick: true, can_pack: false }));
        assert.deepEqual(ok(await api('dualAlternate', 'GET', '/api/auth/me')).user.work_types, ['pick']);
        assert.equal((await claim('dualAlternate', order, 'pack')).status, 403);
        assert.equal((await api('dualAlternate', 'PUT', '/api/warehouse/work-mode', { stage: 'pack' })).status, 403);
        assert.deepEqual((await pool.query('SELECT username,password,role FROM users WHERE id=$1', [users.dualAlternate])).rows[0], original);
        ok(await api('superadmin', 'PUT', `/api/admin/users/${users.dualAlternate}`, { can_pack: true }));
        ok(await claim('dualAlternate', order, 'pack')); ok(await scan('dualAlternate', order, 'pack'));
        assert.equal((await snapshot(order)).order.status, 'completed');
    });
    await t.test('actor snapshots and handoff names remain truthful after account names and roles change', async () => {
        const { order } = await fixture(3);
        ok(await claim('dualAlternate', order, 'pick')); ok(await scan('dualAlternate', order, 'pick'));
        ok(await api('dualAlternate', 'POST', `/api/tasks/${order}/transfer`, { task_type: 'pick', to_user_id: users.dualWorker, reason: 'Historical identity fixture' }));
        const before = await audit(order), handoffBefore = ok(await api('warehouseManager', 'GET', `/api/orders/${order}/handoffs`)).items;
        const name = 'Fixture dualAlternate';
        ok(await api('superadmin', 'PUT', `/api/admin/users/${users.dualAlternate}`, { name: 'Renamed member', role: 'packer' }));
        assert.deepEqual(await audit(order), before);
        assert.equal(before.find(row => row.action_type === 'pick').actor_snapshot.name, name);
        const handoffAfter = ok(await api('warehouseManager', 'GET', `/api/orders/${order}/handoffs`)).items;
        assert.deepEqual(handoffAfter, handoffBefore); assert.equal(handoffAfter[0].from_name, name);
        const history = ok(await api('warehouseManager', 'GET', '/api/operation-logs?orderId=' + order));
        assert.ok(JSON.stringify(history).includes(name), 'History uses the recorded actor name, not the renamed account');
        ok(await api('superadmin', 'PUT', `/api/admin/users/${users.dualAlternate}`, { name, role: 'picker' }));
    });
    await t.test('one account can batch claim and complete each explicitly chosen stage while stage-filtered lists and completed history stay correct', async () => {
        const rows = [await fixture(1), await fixture(1)];
        const orderIds = rows.map(row => row.order);
        for (const stage of ['pick', 'pack']) {
            ok(await api('dualWorker', 'PUT', '/api/warehouse/work-mode', { stage }));
            const route = stage === 'pick' ? '/api/orders/batch-claim' : '/api/orders/batch/claim';
            const claimed = ok(await api('dualWorker', 'POST', route, { orderIds, stage }));
            assert.deepEqual((claimed.orders || []).map(order => order.id).concat(claimed.results?.success || []), orderIds);
            const page = ok(await api('dualWorker', 'GET', '/api/tasks?pagination=cursor&stage=' + stage));
            for (const order of orderIds) assert.ok(page.items.some(row => row.id === order), `${stage} task ${order}`);
            assert.ok(page.items.every(row => (stage === 'pick' ? ['pending', 'picking'] : ['picked', 'packing']).includes(row.status)));
            for (const order of orderIds) ok(await scan('dualWorker', order, stage));
        }
        const completed = ok(await api('dualWorker', 'GET', '/api/tasks/completed?pagination=cursor&stage=pick'));
        for (const order of orderIds) assert.ok(completed.items.some(row => row.id === order), `Completed cross-stage history ${order}`);
    });
    await t.test('scan command receipts survive a daily mode switch and quantity undo records the real stage without double applying', async () => {
        const { order } = await fixture(3);
        ok(await claim('dualWorker', order, 'pick'));
        const initial = await snapshot(order), commandId = randomUUID();
        const body = { orderId: order, scanValue: barcode, type: 'pick', amount: 1, responseMode: 'delta-v1', commandId, expectedState: initial.stateToken };
        const first = ok(await api('dualWorker', 'POST', '/api/orders/update_item', body));
        ok(await api('dualWorker', 'PUT', '/api/warehouse/work-mode', { stage: 'pack' }));
        assert.deepEqual(ok(await api('dualWorker', 'POST', '/api/orders/update_item', body)), first);
        assert.equal((await stored(order)).items[0].picked_quantity, 1);
        assert.equal((await stored(order)).items[0].packed_quantity, 0);
        assert.equal((await stored(order)).order.status, 'picking');
        assert.equal((await scan('dualWorker', order, 'pack')).status, 409);
        const before = await snapshot(order);
        const undone = ok(await scan('dualWorker', order, 'pick', -1, barcode, { responseMode: 'delta-v1', commandId: randomUUID(), expectedState: before.stateToken }));
        assert.equal(undone.item.picked_quantity, 0);
        const logs = (await audit(order)).filter(row => row.action_type === 'pick');
        assert.equal(logs.length, 2);
        assert.deepEqual(logs.map(row => [row.user_id, row.work_type]), [[users.dualWorker, 'pick'], [users.dualWorker, 'pick']]);
        const details = typeof logs[1].details === 'string' ? JSON.parse(logs[1].details) : logs[1].details;
        assert.equal(details.before.picked_quantity, 1); assert.equal(details.after.picked_quantity, 0); assert.equal(details.operation_context, 'owner'); assert.ok(details.command_id);
    });
    await t.test('used worker accounts cannot be deleted with their responsibility history, while an unused account remains removable', async () => {
        const beforeUser = (await pool.query('SELECT * FROM users WHERE id=$1', [users.dualWorker])).rows[0];
        const beforeOrders = (await pool.query('SELECT * FROM orders WHERE picker_id=$1 OR packer_id=$1 ORDER BY id', [users.dualWorker])).rows;
        const beforeLogs = (await pool.query('SELECT * FROM operation_logs WHERE user_id=$1 ORDER BY id', [users.dualWorker])).rows;
        const beforeHandoffs = (await pool.query('SELECT * FROM task_assignments WHERE from_user_id=$1 OR to_user_id=$1 OR performed_by=$1 ORDER BY id', [users.dualWorker])).rows;
        const result = await api('superadmin', 'DELETE', `/api/admin/users/${users.dualWorker}`);
        assert.equal(result.status, 409); assert.match(result.data.message, /紀錄|記錄|歷史|作業/);
        assert.deepEqual((await pool.query('SELECT * FROM users WHERE id=$1', [users.dualWorker])).rows[0], beforeUser);
        assert.deepEqual((await pool.query('SELECT * FROM orders WHERE picker_id=$1 OR packer_id=$1 ORDER BY id', [users.dualWorker])).rows, beforeOrders);
        assert.deepEqual((await pool.query('SELECT * FROM operation_logs WHERE user_id=$1 ORDER BY id', [users.dualWorker])).rows, beforeLogs);
        assert.deepEqual((await pool.query('SELECT * FROM task_assignments WHERE from_user_id=$1 OR to_user_id=$1 OR performed_by=$1 ORDER BY id', [users.dualWorker])).rows, beforeHandoffs);
        assert.equal(ok(await api('dualWorker', 'GET', '/api/auth/me')).user.id, users.dualWorker);
        const unused = (await pool.query("INSERT INTO users(username,password,name,role) VALUES('unused-dual-removal','fixture-only','Unused worker','picker') RETURNING id")).rows[0].id;
        ok(await api('superadmin', 'DELETE', `/api/admin/users/${unused}`));
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM users WHERE id=$1', [unused])).rows[0].n, 0);
    });
    await t.test('unresolved order changes still stop both stages and transfers never bypass warehouse approvals', async () => {
        const { order } = await fixture(2);
        ok(await claim('dualWorker', order, 'pick')); ok(await scan('dualWorker', order, 'pick'));
        const request = ok(await api('orderManager', 'POST', `/api/orders/${order}/exceptions`, { type: 'order_change', reasonText: 'Still needs approval', snapshot: { proposal: { note: 'Still needs approval', items: [{ barcode, productName: 'Dual work product', quantityChange: 1, noSn: true }] } } }), 201);
        assert.equal((await scan('dualWorker', order, 'pick')).status, 409);
        assert.equal((await api('orderManager', 'PATCH', `/api/orders/${order}/exceptions/${request.id}/ack`, {})).status, 403);
        assert.equal((await claim('dualWorker', order, 'pack')).status, 409);
        ok(await api('warehouseManager', 'PATCH', `/api/orders/${order}/exceptions/${request.id}/reject`, { note: 'Resume current work' }));
        ok(await scan('dualWorker', order, 'pick')); assert.equal((await snapshot(order)).order.status, 'picked');
    });
};
