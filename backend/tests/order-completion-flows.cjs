const assert = require('node:assert/strict');

module.exports = async ({ t, api, ok, pool, users, observedEvents }) => {
    let sequence = 0;
    async function fixture({ quantities = [2], warranty = 300, status = 'picking', picked = true, importer = 'dispatcher' } = {}) {
        const id = (await pool.query('INSERT INTO orders(voucher_number,customer_name,status,picker_id) VALUES($1,$2,$3,$4) RETURNING id',
            [`PARITY-COMPLETION-${++sequence}`, 'Synthetic completion fixture', status, users.picker])).rows[0].id;
        for (const quantity of quantities) {
            const itemId = (await pool.query('INSERT INTO order_items(order_id,barcode,product_code,product_name,quantity) VALUES($1,$2,$2,$3,$4) RETURNING id', [id, '4711299273766', 'Synthetic SN item', quantity])).rows[0].id;
            await pool.query("INSERT INTO order_item_instances(order_item_id,serial_number,status) SELECT $1::int, 'FIX-'||($1::int)::text||'-'||n, $3 FROM generate_series(1,$2::int) n", [itemId, quantity, picked ? 'picked' : 'pending']);
        }
        if (warranty) await pool.query("INSERT INTO order_items(order_id,barcode,product_code,product_name,quantity) VALUES($1,'sample','sample','Synthetic warranty card',$2)", [id, warranty]);
        await pool.query("INSERT INTO operation_logs(user_id,order_id,action_type,details) VALUES($1,$2,'import','{}')", [users[importer], id]);
        return id;
    }
    const snapshot = async id => ok(await api('admin', 'GET', `/api/orders/${id}/work-snapshot`));
    const repair = (id, expectedState, role = 'admin') => api(role, 'POST', `/api/orders/${id}/reconcile-picking`, { expectedState, reason: 'Synthetic historical order recovery' });
    const change = (id, role = 'dispatcher', barcode = 'sample', quantityChange = -300) => api(role, 'POST', `/api/orders/${id}/exceptions`, {
        type: 'order_change', reasonText: 'Synthetic quantity change', snapshot: { proposal: { note: 'Synthetic quantity change', items: [{ barcode, productName: 'Synthetic item', quantityChange, noSn: true }] } }
    });
    const eventFor = id => observedEvents.filter(e => e.event === 'task_status_changed' && e.body.orderId === id);
    const auditCount = async id => (await pool.query("SELECT count(*)::int AS n FROM operation_logs WHERE order_id=$1 AND action_type='picking_completion_reconcile'", [id])).rows[0].n;

    await t.test('approving removal of 300 unpicked cards advances 1040 picked SNs to packing queue', async () => {
        const id = await fixture({ quantities: [145,138,112,156,176,13,200,100] });
        const before = await snapshot(id);
        assert.equal(before.order.status, 'picking');
        assert.equal(before.instances.length, 1040);
        const exception = ok(await change(id), 201);
        assert.equal((await repair(id, before.stateToken)).status, 409);
        ok(await api('admin', 'PATCH', `/api/orders/${id}/exceptions/${exception.id}/ack`, { note: 'Remove unpicked cards' }));
        const after = await snapshot(id);
        assert.equal(after.order.status, 'picked');
        assert.equal(after.order.packer_id, null);
        assert.equal(after.items.length, 8);
        assert.ok(after.items.every(i => i.picked_quantity === 0));
        assert.deepEqual(after.instances, before.instances);
        const approval = (await pool.query('SELECT snapshot FROM order_exceptions WHERE id=$1', [exception.id])).rows[0].snapshot;
        assert.equal(approval.applyResult.newStatus, 'picked');
        assert.ok(eventFor(id).some(e => e.body.newStatus === 'picked'));
        ok(await api('packer', 'POST', `/api/orders/${id}/claim`));
        const pack = ok(await api('packer', 'POST', '/api/orders/update_item', { orderId: id, scanValue: after.instances[0].serial_number, type: 'pack' }));
        assert.equal(pack.order.status, 'packing');
        assert.equal(pack.instances.filter(i => i.status === 'packed').length, 1);
    });
    await t.test('admin self-import auto-approval also recomputes completion', async () => {
        const id = await fixture({ importer: 'admin' });
        ok(await change(id, 'admin'), 201);
        assert.equal((await snapshot(id)).order.status, 'picked');
        assert.equal((await pool.query('SELECT status FROM order_exceptions WHERE order_id=$1', [id])).rows[0].status, 'ack');
    });
    await t.test('approval preserves incomplete picking and additional quantities return to picking', async () => {
        const id = await fixture({ picked: false });
        const exception = ok(await change(id), 201);
        ok(await api('admin', 'PATCH', `/api/orders/${id}/exceptions/${exception.id}/ack`, {}));
        assert.equal((await snapshot(id)).order.status, 'picking');
        const picked = await fixture({ status: 'picked', warranty: 0, importer: 'admin' });
        ok(await change(picked, 'admin', 'ADDITIONAL', 1), 201);
        assert.equal((await snapshot(picked)).order.status, 'picking');
    });
    await t.test('approval cannot advance empty or inconsistent SN orders, bypass exceptions or ship automatically', async () => {
        for (const variant of ['empty', 'missing-sn', 'already-packed', 'other-exception']) {
            const id = await fixture({ quantities: variant === 'empty' ? [] : [2], importer: 'admin' });
            if (variant === 'missing-sn') await pool.query('DELETE FROM order_item_instances WHERE id=(SELECT i.id FROM order_item_instances i JOIN order_items oi ON oi.id=i.order_item_id WHERE oi.order_id=$1 LIMIT 1)', [id]);
            if (variant === 'already-packed') await pool.query("UPDATE order_item_instances SET status='packed' WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id=$1)", [id]);
            if (variant === 'other-exception') ok(await api('picker', 'POST', `/api/orders/${id}/exceptions`, { type: 'other', reasonText: 'Synthetic unresolved issue' }), 201);
            ok(await change(id, 'admin'), 201);
            const after = await snapshot(id);
            assert.equal(after.order.status, ['empty', 'missing-sn'].includes(variant) ? 'picking' : 'picked', variant);
            assert.equal(after.order.completed_at, null);
            if (variant === 'other-exception') {
                assert.equal((await api('packer', 'POST', `/api/orders/${id}/claim`)).status, 409);
                assert.equal((await repair(id, after.stateToken)).status, 409);
            }
        }
    });
    await t.test('repair is admin-only, rejects stale state and never rewrites SNs or quantities', async () => {
        const id = await fixture({ warranty: 0 });
        const before = await snapshot(id);
        for (const role of [null, 'picker', 'packer', 'dispatcher']) assert.equal((await repair(id, before.stateToken, role)).status, role ? 403 : 401);
        assert.equal((await repair(id, '0'.repeat(64))).status, 409);
        assert.equal((await repair(id, undefined)).status, 400);
        assert.equal(await auditCount(id), 0);
        const pair = await Promise.all([repair(id, before.stateToken), repair(id, before.stateToken)]);
        assert.deepEqual(pair.map(r => r.status).sort(), [200, 409]);
        const after = await snapshot(id);
        assert.equal(after.order.status, 'picked');
        assert.equal(after.order.picker_id, before.order.picker_id);
        assert.equal(after.order.packer_id, before.order.packer_id);
        assert.deepEqual(after.items, before.items);
        assert.deepEqual(after.instances, before.instances);
        assert.equal(await auditCount(id), 1);
        assert.equal(eventFor(id).length, 1);
        assert.equal(ok(await repair(id, after.stateToken)).changed, false);
        assert.equal(await auditCount(id), 1);
    });
    await t.test('repair refuses missing SNs, pending SNs, empty orders, unfinished counts and terminal states', async () => {
        for (const variant of ['missing-sn','pending-sn','empty','unpicked-card','completed','voided','packing','pending']) {
            const id = await fixture({ warranty: variant === 'unpicked-card' ? 1 : 0, quantities: variant === 'empty' ? [] : [2], picked: variant !== 'pending-sn', status: ['completed','voided','packing','pending'].includes(variant) ? variant : 'picking' });
            if (variant === 'missing-sn') await pool.query('DELETE FROM order_item_instances WHERE id=(SELECT i.id FROM order_item_instances i JOIN order_items oi ON oi.id=i.order_item_id WHERE oi.order_id=$1 LIMIT 1)', [id]);
            const before = await snapshot(id);
            assert.equal((await repair(id, before.stateToken)).status, 409, variant);
            assert.deepEqual(await snapshot(id), before);
            assert.equal(await auditCount(id), 0);
        }
    });
    await t.test('repair rolls back status and emits no events when its audit cannot persist', async () => {
        const id = await fixture({ warranty: 0 });
        const before = await snapshot(id);
        await pool.query("CREATE FUNCTION reject_completion_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_type='picking_completion_reconcile' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$");
        await pool.query('CREATE TRIGGER reject_completion_audit BEFORE INSERT ON operation_logs FOR EACH ROW EXECUTE FUNCTION reject_completion_audit()');
        try {
            assert.equal((await repair(id, before.stateToken)).status, 500);
            assert.deepEqual(await snapshot(id), before);
            assert.equal(await auditCount(id), 0);
            assert.equal(eventFor(id).length, 0);
        } finally {
            await pool.query('DROP TRIGGER reject_completion_audit ON operation_logs');
            await pool.query('DROP FUNCTION reject_completion_audit()');
        }
    });
};
