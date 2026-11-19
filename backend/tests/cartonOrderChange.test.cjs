const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createCartonFixture } = require('./cartonFixture.cjs');

test('reviewed order changes preserve carton custody through picking and packing', { timeout: 120000 }, async t => {
    const f = await createCartonFixture();
    t.after(() => f.close());
    f.attachLegacyRoutes();
    const databasePath = require.resolve('../src/config/database'), prior = require.cache[databasePath];
    require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: { pool: f.pool } };
    try {
        delete require.cache[require.resolve('../src/routes/exceptionRoutes')];
        f.app.use('/api', require('../src/routes/exceptionRoutes'));
        f.app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message, code: error.code }));
    } finally { if (prior) require.cache[databasePath] = prior; else delete require.cache[databasePath]; }
    const server = await new Promise(resolve => { const http = f.app.listen(0, '127.0.0.1', () => resolve(http)); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const api = (user, method, path, body) => {
        const call = request(server)[method](path).set('x-fixture-user', String(user));
        return body === undefined ? call : call.send({ ...body, expectedActorId: user });
    };
    const ok = (response, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.body)); return response.body; };
    const barcode = '4710000000027';
    const change = (quantityChange, noSn, sns = [], code = barcode) => ({ barcode: code, productName: 'Synthetic item',
        quantityChange, noSn, ...(quantityChange > 0 ? { snList: sns } : { removedSnList: sns }) });
    const propose = async (orderId, items) => ok(await api(2, 'post', `/api/orders/${orderId}/exceptions`, {
        type: 'order_change', reasonText: 'Synthetic reviewed change', snapshot: { proposal: { note: 'Synthetic reviewed change', items } }
    }), 201).id;
    const review = (orderId, id, user = 1, action = 'ack') => api(user, 'patch', `/api/orders/${orderId}/exceptions/${id}/${action}`, { note: 'Synthetic verification' });
    const cartons = async (id, sns, seal = true, extra = {}) => ok(await api(1, 'post', '/api/cartons', {
        cartonId: id, seal, lines: [{ itemCode: 'BO-A28', ean: barcode, quantity: sns.length, actualSN: sns, ...extra }]
    }), 201);
    const boxState = async id => ok(await api(1, 'get', `/api/cartons/${id}`));
    const lines = async id => (await f.db.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY id', [id])).rows;
    const units = async id => (await f.db.query(`SELECT i.* FROM order_item_instances i JOIN order_items oi ON oi.id=i.order_item_id
        WHERE oi.order_id=$1 ORDER BY i.serial_number`, [id])).rows;
    const exception = async id => (await f.db.query('SELECT * FROM order_exceptions WHERE id=$1', [id])).rows[0];
    const command = async (orderId, input, user = 2) => {
        const preview = ok(await api(user, 'post', `/api/orders/${orderId}/carton-preview`, input));
        return { ...input, commandId: randomUUID(), expectedState: preview.expectedState,
            expectedCartonRevision: preview.expectedCartonRevision, expectedActorId: user };
    };
    const scan = async (orderId, input, user = 2) => ok(await api(user, 'post', `/api/orders/${orderId}/carton-scan`, await command(orderId, input, user)));

    await t.test('sample-code no-SN to registered-SN change approves once; draft requires confirmation; split SN ships once with its source', async () => {
        const sns = ['SYNAMEND0001', 'SYNAMEND0002'];
        const carton = await cartons('SYN-AMENDMENT-SAMPLE', sns, false);
        const { order, item } = await f.seedOrder({ quantity: 1, itemCode: '樣品', barcode, packerId: null, voucherNumber: 'SYN-20261119-11' });
        await f.db.query("UPDATE order_items SET source_sku='SAMPLE-SKU',source_platform='EC',source_store='Fixture',source_order_number='SYN-EC-11',source_line_id='L1' WHERE id=$1", [item.id]);
        const id = await propose(order.id, [change(-1, true), change(1, false, [sns[0]])]);
        for (const actor of [2, 3, 5]) assert.equal((await review(order.id, id, actor)).status, 403);
        assert.equal((await exception(id)).status, 'open');
        const concurrent = await Promise.all([review(order.id, id), review(order.id, id)]);
        assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 409]);
        assert.equal((await exception(id)).status, 'ack');
        const saved = await lines(order.id);
        assert.equal(saved.length, 1); assert.equal(saved[0].quantity, 1); assert.equal(saved[0].product_code, '樣品');
        assert.equal(saved[0].source_sku, 'SAMPLE-SKU'); assert.equal(saved[0].source_line_id, 'L1');
        assert.deepEqual((await units(order.id)).map(unit => [unit.serial_number, unit.status]), [[sns[0], 'pending']]);
        assert.deepEqual(await boxState(carton.cartonId), carton);
        const input = { scanValue: sns[0], type: 'pick', mode: 'serial' };
        const draft = await api(2, 'post', `/api/orders/${order.id}/carton-preview`, { scanValue: carton.cartonId, type: 'pick' });
        assert.equal(draft.body.code, 'CARTON_NOT_SEALED');
        assert.match(draft.body.message, /SYN-AMENDMENT-SAMPLE.*確認箱內內容/);
        ok(await api(1, 'post', `/api/cartons/${carton.cartonId}/seal`, {
            expectedContentRevision: carton.contentRevision, expectedStateRevision: carton.stateRevision
        }));
        const pickCommand = await command(order.id, input);
        const picked = ok(await api(2, 'post', `/api/orders/${order.id}/carton-scan`, pickCommand));
        assert.equal(picked.order.status, 'picked'); assert.equal(picked.carton.lines[0].remainingQuantity, 1);
        assert.equal(picked.allocation.lines[0].wholeCarton, false);
        ok(await api(2, 'post', `/api/orders/${order.id}/carton-scan`, pickCommand));
        assert.equal((await boxState(carton.cartonId)).lines[0].remainingQuantity, 1);
        ok(await api(3, 'post', `/api/orders/${order.id}/claim`, { stage: 'pack' }));
        const wholePack = await api(3, 'post', `/api/orders/${order.id}/carton-preview`, { scanValue: carton.cartonId, type: 'pack' });
        assert.equal(wholePack.body.code, 'CARTON_PACK_SERIAL_REQUIRED');
        const packCommand = await command(order.id, { ...input, type: 'pack' }, 3);
        assert.equal(ok(await api(3, 'post', `/api/orders/${order.id}/carton-scan`, packCommand)).order.status, 'completed');
        ok(await api(3, 'post', `/api/orders/${order.id}/carton-scan`, packCommand));
        assert.deepEqual((await units(order.id)).map(unit => [unit.serial_number, unit.status]), [[sns[0], 'packed']]);
        const trace = ok(await api(1, 'get', `/api/orders/${order.id}/carton-shipments`));
        assert.equal(trace.allocations.length, 1); assert.equal(trace.allocations[0].cartonId, carton.cartonId);
        assert.deepEqual(trace.allocations[0].lines[0].actualSN, [sns[0]]);
        assert.equal(trace.allocations[0].lines[0].sourceSKU, 'SAMPLE-SKU');
        assert.equal(trace.allocations[0].lines[0].currentRemainingQuantity, 1);
        assert.equal((await review(order.id, id)).status, 409);
        assert.equal((await boxState(carton.cartonId)).lines[0].remainingQuantity, 1);
        const logs = (await f.db.query("SELECT action_type,COUNT(*)::int AS n FROM operation_logs WHERE order_id=$1 AND action_type IN ('order_change_ack','pick','pack') GROUP BY action_type", [order.id])).rows;
        assert.deepEqual(Object.fromEntries(logs.map(log => [log.action_type, log.n])), { order_change_ack: 1, pick: 1, pack: 1 });
    });

    await t.test('a draft with legacy shipped SNs keeps its individual-SN workflow after approval without inventing carton balances', async () => {
        const sns = ['AMENDLEGACY01', 'AMENDLEGACY02'];
        const carton = await cartons('SYN-AMENDMENT-LEGACY', sns, false);
        const prior = await f.seedOrder({ quantity: 1, itemCode: '樣品', barcode, actualSN: [sns[0]], status: 'completed' });
        await f.db.query("UPDATE order_item_instances SET status='packed' WHERE order_item_id=$1", [prior.item.id]);
        const { order } = await f.seedOrder({ quantity: 1, itemCode: '樣品', barcode, packerId: null });
        const id = await propose(order.id, [change(-1, true), change(1, false, [sns[1]])]);
        ok(await review(order.id, id));
        const seal = await api(1, 'post', `/api/cartons/${carton.cartonId}/seal`, { expectedContentRevision: carton.contentRevision });
        assert.equal(seal.body.code, 'CARTON_SN_OCCUPIED');
        for (const [type, user] of [['pick', 2], ['pack', 3]]) {
            if (type === 'pack') ok(await api(user, 'post', `/api/orders/${order.id}/claim`, { stage: 'pack' }));
            // This fallback predates carton rollout and is still used for old stock.
            const probe = await api(user, 'post', `/api/orders/${order.id}/carton-preview`, { scanValue: sns[1], type, mode: 'serial' });
            assert.equal(probe.body.code, 'CARTON_SERIAL_NOT_REGISTERED');
            const state = ok(await api(user, 'get', `/api/orders/${order.id}/work-snapshot`));
            const cmd = { orderId: order.id, type, scanValue: sns[1], responseMode: 'delta-v1', commandId: randomUUID(), expectedState: state.stateToken };
            ok(await api(user, 'post', '/api/orders/update_item', cmd));
            ok(await api(user, 'post', '/api/orders/update_item', cmd));
        }
        assert.deepEqual((await units(order.id)).map(unit => [unit.serial_number, unit.status]), [[sns[1], 'packed']]);
        assert.equal((await f.db.query('SELECT status FROM orders WHERE id=$1', [order.id])).rows[0].status, 'completed');
        assert.equal((await review(order.id, id)).status, 409);
        assert.deepEqual(await boxState(carton.cartonId), carton);
        assert.equal(ok(await api(1, 'get', `/api/orders/${order.id}/carton-shipments`)).allocations.length, 0);
        assert.equal((await f.db.query("SELECT COUNT(*)::int AS n FROM operation_logs WHERE order_id=$1 AND action_type IN ('pick','pack')", [order.id])).rows[0].n, 2);
    });

    await t.test('pending registered SNs can be replaced, increased, reduced and changed back to no SN without moving carton contents', async () => {
        const sns = ['AMENDPENDING01', 'AMENDPENDING02', 'AMENDPENDING03'];
        const carton = await cartons('SYN-AMENDMENT-PENDING', sns);
        const { order } = await f.seedOrder({ quantity: 1, itemCode: 'BO-A28', barcode, actualSN: [sns[0]], serialMode: 'exact' });
        ok(await review(order.id, await propose(order.id, [change(-1, false, [sns[0]]), change(1, false, [sns[1]])])));
        assert.deepEqual((await units(order.id)).map(unit => unit.serial_number), [sns[1]]);
        assert.equal((await lines(order.id))[0].serial_identity_mode, 'exact');
        ok(await review(order.id, await propose(order.id, [change(1, false, [sns[2]])])));
        assert.equal((await lines(order.id))[0].quantity, 2);
        ok(await review(order.id, await propose(order.id, [change(-1, false, [sns[1]])])));
        assert.deepEqual((await units(order.id)).map(unit => unit.serial_number), [sns[2]]);
        ok(await review(order.id, await propose(order.id, [change(-1, false, [sns[2]]), change(1, true)])));
        assert.equal((await lines(order.id))[0].product_code, 'BO-A28');
        assert.equal((await lines(order.id))[0].quantity, 1); assert.equal((await units(order.id)).length, 0);
        assert.deepEqual(await boxState(carton.cartonId), carton);
    });

    await t.test('no-EAN cartons accept the matching internal scan code', async () => {
        const sn = 'AMENDINTERNAL01', code = 'ITM-BO-A28';
        const carton = await cartons('SYN-AMENDMENT-INTERNAL', [sn], true, { ean: null, internalScanCode: code });
        const { order } = await f.seedOrder({ quantity: 1, itemCode: 'BO-A28', barcode: code });
        await f.db.query("UPDATE order_items SET code_type='internal',internal_scan_code=$2 WHERE order_id=$1", [order.id, code]);
        ok(await review(order.id, await propose(order.id, [change(-1, true, [], code), change(1, false, [sn], code)])));
        assert.equal((await lines(order.id))[0].internal_scan_code, code);
        const picked = await scan(order.id, { scanValue: sn, type: 'pick', mode: 'serial' });
        assert.equal(picked.carton.cartonId, carton.cartonId); assert.equal(picked.carton.lines[0].remainingQuantity, 0);
    });

    await t.test('invalid sources and occupied SNs leave the entire proposal pending and all quantities unchanged', async () => {
        for (const kind of ['wrong-product', 'void', 'unavailable', 'other-order', 'late-failure']) {
            const sn = 'AMENDGUARD' + kind.replace(/-/g, '').toUpperCase();
            const carton = await cartons('SYN-AMENDMENT-' + kind, [sn], kind !== 'void');
            if (kind === 'void') ok(await api(1, 'post', `/api/cartons/${carton.cartonId}/void`, {
                expectedContentRevision: carton.contentRevision, expectedStateRevision: carton.stateRevision, reason: 'Synthetic void'
            }));
            if (kind === 'unavailable') await f.db.query('UPDATE wms_carton_serials SET available=FALSE WHERE serial_number=$1', [sn]);
            if (kind === 'other-order') await f.seedOrder({ quantity: 1, barcode, actualSN: [sn] });
            const code = kind === 'wrong-product' ? '4710000000001' : barcode;
            const { order } = await f.seedOrder({ quantity: 1, barcode: code });
            const before = await lines(order.id), beforeBox = await boxState(carton.cartonId);
            const changes = [change(-1, true, [], code), change(1, false, [sn], code)];
            if (kind === 'late-failure') changes.push(change(-1, true, [], 'MISSING-LINE'));
            const id = await propose(order.id, changes);
            const response = await review(order.id, id);
            assert.ok([400, 409].includes(response.status), JSON.stringify(response.body));
            assert.equal((await exception(id)).status, 'open');
            assert.deepEqual(await lines(order.id), before); assert.deepEqual(await units(order.id), []);
            assert.deepEqual(await boxState(carton.cartonId), beforeBox);
            assert.equal((await f.db.query("SELECT COUNT(*)::int AS n FROM operation_logs WHERE order_id=$1 AND action_type='order_change_ack'", [order.id])).rows[0].n, 0);
            ok(await review(order.id, id, 1, 'reject'));
        }
    });

    await t.test('unrelated carton allocation permits loose-line changes but affected picked/packed items and deletion stay guarded', async () => {
        for (const packed of [false, true]) {
            const sn = 'AMENDALLOC' + (packed ? 'PACKED' : 'PICKED');
            const carton = await cartons('SYN-AMENDMENT-ALLOC-' + packed, [sn]);
            const { order, item } = await f.seedOrder({ quantity: 1, itemCode: 'BO-A28', barcode, actualSN: [sn] });
            await scan(order.id, { scanValue: carton.cartonId, type: 'pick' });
            if (packed) {
                ok(await api(3, 'post', `/api/orders/${order.id}/claim`, { stage: 'pack' }));
                await scan(order.id, { scanValue: carton.cartonId, type: 'pack' }, 3);
            }
            const beforeBox = await boxState(carton.cartonId);
            const beforeItem = (await lines(order.id))[0];
            const loose = (await f.db.query("INSERT INTO order_items(order_id,product_code,product_name,barcode,quantity) VALUES($1,'LOOSE','Loose item','LOOSE',2) RETURNING id", [order.id])).rows[0];
            ok(await review(order.id, await propose(order.id, [change(1, true, [], 'LOOSE')])));
            assert.equal((await lines(order.id)).find(line => line.id === loose.id).quantity, 3);
            assert.deepEqual((await lines(order.id)).find(line => line.id === item.id), beforeItem);
            assert.deepEqual(await boxState(carton.cartonId), beforeBox);
            const id = await propose(order.id, [change(-1, false, [sn])]);
            const response = await review(order.id, id);
            assert.equal(response.status, 409); assert.match(response.body.message, /箱號分配/);
            ok(await review(order.id, id, 1, 'reject'));
            const deletion = ok(await api(1, 'post', `/api/orders/${order.id}/exceptions`, { type: 'order_change', reasonText: 'Synthetic delete', snapshot: { proposal: { action: 'delete_order' } } }), 201).id;
            assert.equal((await review(order.id, deletion)).status, 409);
            ok(await review(order.id, deletion, 1, 'reject'));
            assert.deepEqual(await boxState(carton.cartonId), beforeBox);
        }
    });

    await t.test('lost approval response commits once and a retry reads the final review state', async () => {
        const sn = 'AMENDLOSTRESPONSE';
        const carton = await cartons('SYN-AMENDMENT-LOST', [sn]);
        const { order } = await f.seedOrder({ quantity: 1, barcode });
        const id = await propose(order.id, [change(-1, true), change(1, false, [sn])]);
        f.failAfterNext(sql => sql === 'COMMIT');
        assert.equal((await review(order.id, id)).status, 503);
        assert.equal((await exception(id)).status, 'ack');
        assert.equal((await review(order.id, id)).status, 409);
        assert.equal((await lines(order.id))[0].quantity, 1);
        assert.deepEqual((await units(order.id)).map(unit => unit.serial_number), [sn]);
        assert.deepEqual(await boxState(carton.cartonId), carton);
    });
});
