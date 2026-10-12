const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createCartonFixture } = require('./cartonFixture.cjs');
const { guardUnitScan, assertNoCartonAllocations } = require('../src/services/cartonGuards');
const { matchesItem } = require('../src/services/cartonContents');
const { assertSchemaReady } = require('../src/config/schemaReadiness');

async function suite(t, postgres) {
    const f = await createCartonFixture({ postgres });
    t.after(() => f.close());
    const api = (user, method, path, body) => {
        const call = request(f.app)[method](path);
        if (user) call.set('x-fixture-user', String(user));
        const boundBody = body !== undefined && user ? { ...body, expectedActorId: body.expectedActorId ?? Number(user) } : body;
        return boundBody === undefined ? call : call.send(boundBody);
    };
    const ok = (response, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.body)); return response.body; };
    const box = (cartonId, quantity = 10, actualSN = [], extra = {}) => ({ cartonId, seal: true,
        lines: [{ itemCode: 'ITEM', ean: '4710000000010', quantity, actualSN, ...extra }] });
    const create = async body => ok(await api(1, 'post', '/api/cartons', body), 201);
    const preview = async (id, input, user = 2) => ok(await api(user, 'post', `/api/orders/${id}/carton-preview`, input));
    const scanBody = (data, input) => ({ ...input, commandId: randomUUID(), expectedState: data.expectedState, expectedCartonRevision: data.expectedCartonRevision, expectedActorId: data.expectedActorId });
    const scan = async (id, input, user = 2) => {
        const body = scanBody(await preview(id, input, user), input);
        return ok(await api(user, 'post', `/api/orders/${id}/carton-scan`, body));
    };

    await t.test('empty additive migration is ready and retains legacy foundations', async () => {
        await assertSchemaReady(f.pool);
        assert.equal((await f.db.query('SELECT COUNT(*)::int AS n FROM orders')).rows[0].n, 0);
    });
    await t.test('HTTP rechecks DB role: anonymous, picker and scoped order manager cannot mutate cartons', async () => {
        assert.equal((await api(null, 'get', '/api/cartons')).status, 401);
        assert.equal((await api(2, 'post', '/api/cartons', box('NO-PICKER'))).status, 403);
        assert.equal((await api(5, 'post', '/api/cartons', box('NO-ORDER-MANAGER'))).status, 403);
        assert.equal((await f.db.query('SELECT COUNT(*)::int AS n FROM wms_cartons')).rows[0].n, 0);
    });
    await t.test('manifest imports draft, inherits batch provenance, replays exact content and does not reset remaining', async () => {
        const manifest = { format: 'corely-cartons-v1', sourceSystem: 'ERP', sourceReference: 'BATCH-1', cartons: [box('MANIFEST')] };
        const first = ok(await api(1, 'post', '/api/cartons/import', manifest));
        assert.equal(first.items[0].carton.status, 'draft');
        assert.equal(first.items[0].carton.sourceSystem, 'ERP');
        assert.equal(first.items[0].carton.sourceReference, 'BATCH-1');
        const replay = ok(await api(1, 'post', '/api/cartons/import', manifest));
        assert.equal(replay.items[0].replayed, true);
        assert.equal(replay.items[0].carton.history.length, 1);
        ok(await api(1, 'post', '/api/cartons/MANIFEST/seal', { expectedContentRevision: 1 }));
        const { order } = await f.seedOrder({ quantity: 3 });
        const lineId = first.items[0].carton.lines[0].lineId;
        await scan(order.id, { scanValue: 'MANIFEST', type: 'pick', mode: 'split', selections: [{ lineId, quantity: 3 }] });
        const again = ok(await api(1, 'post', '/api/cartons/import', manifest));
        assert.equal(again.items[0].carton.lines[0].remainingQuantity, 7);
        assert.equal(again.items[0].carton.status, 'sealed');
        const next = { ...manifest, cartons: [box('MANIFEST-2', 2)] };
        assert.equal(ok(await api(1, 'post', '/api/cartons/import', next)).items[0].replayed, false);
    });
    await t.test('batch conflict rolls back earlier new cartons and their history', async () => {
        await create(box('Z-CONFLICT'));
        const response = await api(1, 'post', '/api/cartons/import', { format: 'corely-cartons-v1', cartons: [box('A-ROLLED-BACK'), box('Z-CONFLICT', 9)] });
        assert.equal(response.status, 409);
        assert.equal(response.body.code, 'CARTON_CONTENT_CONFLICT');
        assert.equal((await f.db.query("SELECT COUNT(*)::int AS n FROM wms_cartons WHERE carton_id='A-ROLLED-BACK'")).rows[0].n, 0);
    });
    await t.test('draft revisions preserve history, reject stale edits and freeze sealed contents', async () => {
        await create({ ...box('REVISION'), seal: false });
        const draft = ok(await api(1, 'patch', '/api/cartons/REVISION', { expectedContentRevision: 1, lines: box('x', 2).lines }));
        assert.equal(draft.contentRevision, 2);
        assert.equal(draft.history.length, 2);
        assert.equal((await api(1, 'patch', '/api/cartons/REVISION', { expectedContentRevision: 1, lines: box('x', 3).lines })).status, 409);
        await api(1, 'post', '/api/cartons/REVISION/seal', { expectedContentRevision: 2 });
        assert.equal((await api(1, 'patch', '/api/cartons/REVISION', { expectedContentRevision: 2, lines: box('x', 3).lines })).body.code, 'CARTON_CONTENT_LOCKED');
        assert.ok(ok(await api(2, 'get', '/api/cartons?q=ITEM')).items.length);
    });
    await t.test('10 ordinary units pick once, pack same allocation without deducting remaining twice', async () => {
        await create(box('ORDINARY'));
        const { order } = await f.seedOrder();
        const picked = await scan(order.id, { scanValue: 'CARTON:ORDINARY', type: 'pick' });
        assert.equal(picked.order.status, 'picked'); assert.equal(picked.items[0].picked_quantity, 10);
        assert.equal(picked.carton.lines[0].remainingQuantity, 0);
        const packed = await scan(order.id, { scanValue: 'ORDINARY', type: 'pack' }, 3);
        assert.equal(packed.order.status, 'completed'); assert.equal(packed.items[0].packed_quantity, 10);
        assert.equal(packed.carton.lines[0].remainingQuantity, 0); assert.equal(packed.allocation.status, 'packed');
        assert.equal((await api(3, 'post', `/api/orders/${order.id}/carton-preview`, { scanValue: 'ORDINARY', type: 'pack' })).status, 409);
        await assert.rejects(f.db.query('DELETE FROM orders WHERE id=$1', [order.id]), error => ['23503','23001'].includes(error.code) && error.message.includes('wms_carton_allocations_order_id_fkey'));
        assert.equal(ok(await api(2, 'get', `/api/orders/${order.id}/carton-shipments`)).allocations[0].lines[0].quantity, 10);
    });
    await t.test('no EAN and newly assigned ITM code use confirmed item identity, while wrong product/EAN never matches', async () => {
        const { order } = await f.seedOrder({ quantity: 2, itemCode: 'NO-EAN', barcode: null });
        await create(box('INTERNAL', 2, [], { itemCode: 'NO-EAN', ean: null, internalScanCode: 'ITM-SOURCE-SKU' }));
        assert.equal((await scan(order.id, { scanValue: 'INTERNAL', type: 'pick' })).items[0].picked_quantity, 2);
        const line = { itemCode: 'P', ean: null, internalScanCode: 'ITM-P' };
        assert.equal(matchesItem(line, { product_code: 'P', code_type: 'international', international_barcode: 'REAL' }), false);
        assert.equal(matchesItem(line, { product_code: 'P', code_type: 'internal', internal_scan_code: 'OTHER' }), false);
        assert.equal(matchesItem({ ...line, ean: 'WRONG' }, { product_code: 'P', barcode: 'REAL' }), false);
        assert.equal(matchesItem(line, { product_code: 'OTHER' }), false);
    });
    await t.test('10 exact SNs expand atomically, legacy comma QR resolves only the entire exact set', async () => {
        const sns = Array.from({ length: 10 }, (_, index) => `Vendor-A-${String(index + 1).padStart(2, '0')}`);
        await create(box('SERIAL', 10, sns));
        assert.equal(ok(await api(2, 'get', `/api/cartons/lookup?scanValue=${encodeURIComponent([...sns].reverse().join(','))}`)).cartonId, 'SERIAL');
        assert.equal((await api(2, 'get', `/api/cartons/lookup?scanValue=${encodeURIComponent(sns.slice(0, 9).join(','))}`)).status, 404);
        const { order } = await f.seedOrder({ actualSN: sns });
        const picked = await scan(order.id, { scanValue: sns.join(','), type: 'pick' });
        assert.ok(picked.instances.every(unit => unit.status === 'picked'));
        const packed = await scan(order.id, { scanValue: 'CARTON:SERIAL', type: 'pack' }, 3);
        assert.ok(packed.instances.every(unit => unit.status === 'packed'));
        assert.equal(packed.order.status, 'completed'); assert.equal(packed.items[0].picked_quantity, 0);
    });
    await t.test('exact SN ownership rejects double registration and count mismatch without partial carton', async () => {
        const duplicate = await api(1, 'post', '/api/cartons', box('DUP-SN', 1, ['Vendor-A-01']));
        assert.equal(duplicate.status, 409);
        assert.equal((await api(1, 'get', '/api/cartons/DUP-SN')).status, 404);
        assert.equal((await api(1, 'post', '/api/cartons', box('BAD-SN-QTY', 2, ['Only-one']))).status, 400);
    });
    await t.test('overfill requires explicit split, leaves actual remainder and same-carton pack uses selected quantity', async () => {
        const carton = await create(box('SPLIT'));
        const first = await f.seedOrder({ quantity: 3 }), second = await f.seedOrder({ quantity: 7 });
        assert.equal((await api(2, 'post', `/api/orders/${first.order.id}/carton-preview`, { scanValue: 'SPLIT', type: 'pick' })).body.code, 'CARTON_ORDER_QUANTITY_EXCEEDED');
        const input = { scanValue: 'SPLIT', type: 'pick', mode: 'split', selections: [{ lineId: carton.lines[0].lineId, quantity: 3 }] };
        const a = await scan(first.order.id, input);
        assert.equal(a.carton.lines[0].remainingQuantity, 7);
        await scan(second.order.id, { scanValue: 'SPLIT', type: 'pick' });
        const packed = await scan(first.order.id, { scanValue: 'SPLIT', type: 'pack' }, 3);
        assert.equal(packed.items[0].packed_quantity, 3); assert.equal(packed.carton.lines[0].remainingQuantity, 0);
    });
    await t.test('SN split requires selected real SNs and preserves unselected SN ownership', async () => {
        const sns = ['Split-SN-01', 'Split-SN-02', 'Split-SN-03'];
        const carton = await create(box('SN-SPLIT', 3, sns));
        const { order } = await f.seedOrder({ quantity: 2, actualSN: sns.slice(0, 2) });
        const input = { scanValue: 'SN-SPLIT', type: 'pick', mode: 'split', selections: [{ lineId: carton.lines[0].lineId, quantity: 2 }] };
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-preview`, input)).body.code, 'CARTON_EXACT_SN_REQUIRED');
        input.selections[0].actualSN = sns.slice(0, 2);
        const picked = await scan(order.id, input);
        assert.deepEqual(picked.carton.lines[0].remainingSN, ['Split-SN-03']);
    });
    await t.test('one SN carton spans two source rows using exact owners, and no-SN groups require explicit per-row quantities', async () => {
        const sns = Array.from({ length: 10 }, (_, index) => `Multi-SN-${index}`);
        await create(box('MULTI-SN', 10, sns));
        const { order, item } = await f.seedOrder({ quantity: 5, actualSN: sns.slice(0, 5) });
        const second = (await f.db.query('INSERT INTO order_items(order_id,product_code,barcode,quantity) VALUES($1,$2,$3,5) RETURNING id', [order.id, item.product_code, item.barcode])).rows[0];
        await f.db.query('INSERT INTO order_item_instances(order_item_id,serial_number) SELECT $1,unnest($2::text[])', [second.id, sns.slice(5)]);
        const picked = await scan(order.id, { scanValue: 'MULTI-SN', type: 'pick' });
        assert.equal(picked.allocation.lines.length, 2); assert.ok(picked.allocation.lines.every(line => line.quantity === 5));
        assert.equal((await scan(order.id, { scanValue: 'MULTI-SN', type: 'pack' }, 3)).order.status, 'completed');
        const carton = await create(box('MULTI-QTY', 5)), quantityOrder = await f.seedOrder({ quantity: 3 });
        const other = (await f.db.query('INSERT INTO order_items(order_id,product_code,barcode,quantity) VALUES($1,$2,$3,2) RETURNING id', [quantityOrder.order.id, quantityOrder.item.product_code, quantityOrder.item.barcode])).rows[0];
        const result = await scan(quantityOrder.order.id, { scanValue: 'MULTI-QTY', type: 'pick', selections: [
            { lineId: carton.lines[0].lineId, orderItemId: quantityOrder.item.id, quantity: 3 },
            { lineId: carton.lines[0].lineId, orderItemId: other.id, quantity: 2 }
        ] });
        assert.equal(result.carton.lines[0].remainingQuantity, 0); assert.equal(result.order.status, 'picked');
    });
    await t.test('explicit from-carton binds all 10 real SNs onto an untouched quantity-only order and completes normally', async () => {
        const sns = Array.from({ length: 10 }, (_, index) => `Bind-SN-${index}`);
        await create(box('BIND-10', 10, sns));
        const { order } = await f.seedOrder();
        const input = { scanValue: 'BIND-10', type: 'pick', serialPolicy: 'from-carton' };
        const picked = await scan(order.id, input);
        assert.equal(picked.order.status, 'picked'); assert.equal(picked.instances.length, 10);
        assert.ok(picked.instances.every(unit => unit.status === 'picked'));
        assert.equal(picked.items[0].carton_serial_binding, true);
        const packed = await scan(order.id, { ...input, type: 'pack' }, 3);
        assert.equal(packed.order.status, 'completed'); assert.equal(packed.carton.lines[0].remainingQuantity, 0);
    });
    await t.test('from-carton partial 6 plus another 4 binds only actual units and completes a demand of 10', async () => {
        const firstSN = Array.from({ length: 6 }, (_, index) => `Continue-A-${index}`), lastSN = Array.from({ length: 4 }, (_, index) => `Continue-B-${index}`);
        await create(box('BIND-6', 6, firstSN)); await create(box('BIND-4', 4, lastSN));
        const { order } = await f.seedOrder();
        const first = await scan(order.id, { scanValue: 'BIND-6', type: 'pick', serialPolicy: 'from-carton' });
        assert.equal(first.order.status, 'picking'); assert.equal(first.instances.length, 6);
        const second = await scan(order.id, { scanValue: 'BIND-4', type: 'pick', serialPolicy: 'from-carton' });
        assert.equal(second.order.status, 'picked'); assert.equal(second.instances.length, 10);
        await scan(order.id, { scanValue: 'BIND-6', type: 'pack', serialPolicy: 'from-carton' }, 3);
        assert.equal((await scan(order.id, { scanValue: 'BIND-4', type: 'pack', serialPolicy: 'from-carton' }, 3)).order.status, 'completed');
    });
    await t.test('from-carton cannot convert existing manual progress or take one SN occupied by another order; all 10 roll back', async () => {
        const sns = Array.from({ length: 10 }, (_, index) => `Occupied-SN-${index}`);
        await create(box('BIND-BLOCKED', 10, sns)); const { order, item } = await f.seedOrder();
        await f.db.query('UPDATE order_items SET picked_quantity=2 WHERE id=$1', [item.id]);
        const input = { scanValue: 'BIND-BLOCKED', type: 'pick', serialPolicy: 'from-carton' };
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-preview`, input)).body.code, 'CARTON_SERIAL_PROGRESS_CONFLICT');
        await f.db.query('UPDATE order_items SET picked_quantity=0 WHERE id=$1', [item.id]);
        const pending = await preview(order.id, input), body = scanBody(pending, input);
        await f.seedOrder({ quantity: 1, actualSN: [sns[9]] });
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-scan`, body)).body.code, 'CARTON_SN_OCCUPIED');
        assert.equal((await f.db.query('SELECT COUNT(*)::int AS n FROM order_item_instances WHERE order_item_id=$1', [item.id])).rows[0].n, 0);
        assert.equal((await f.db.query('SELECT carton_serial_binding FROM order_items WHERE id=$1', [item.id])).rows[0].carton_serial_binding, false);
        const carton = ok(await api(2, 'get', '/api/cartons/BIND-BLOCKED'));
        assert.equal(carton.lines[0].remainingQuantity, 10); assert.equal(carton.allocations.length, 0);
    });
    await t.test('releasing newly bound SN restores contents without making another carton own those serials', async () => {
        const sns = ['Unbind-SN-1', 'Unbind-SN-2']; await create(box('UNBIND', 2, sns));
        const { order, item } = await f.seedOrder({ quantity: 2 });
        const picked = await scan(order.id, { scanValue: 'UNBIND', type: 'pick', serialPolicy: 'from-carton' });
        await assert.rejects(guardUnitScan(f.pool, order.id, { instanceId: picked.instances[0].id, type: 'pack', amount: 1 }), { code: 'CARTON_ALLOCATION_GUARD' });
        const released = ok(await api(1, 'post', `/api/cartons/allocations/${picked.allocation.allocationId}/release`, {
            commandId: randomUUID(), expectedState: picked.stateToken, expectedCartonRevision: picked.carton.stateRevision, reason: 'Put actual units back'
        }));
        assert.equal(released.instances.length, 0); assert.equal(released.items.find(row => row.id === item.id).carton_serial_binding, false);
        assert.deepEqual(released.carton.lines[0].remainingSN, sns);
        assert.equal((await api(1, 'post', '/api/cartons', box('UNBIND-OTHER', 2, sns))).status, 409);
    });
    await t.test('actor identity is bound through preview, scan and release; a changed login cannot reuse the prior preview', async () => {
        await create(box('ACTOR', 1)); const { order } = await f.seedOrder({ quantity: 1 });
        const input = { scanValue: 'ACTOR', type: 'pick' }, body = scanBody(await preview(order.id, input), input);
        assert.equal((await api(6, 'post', `/api/orders/${order.id}/carton-scan`, body)).body.code, 'CARTON_ACTOR_CHANGED');
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-preview`, { ...input, expectedActorId: 6 })).body.code, 'CARTON_ACTOR_CHANGED');
        assert.equal((await api(1, 'post', '/api/cartons', { ...box('ACTOR-MANAGEMENT'), expectedActorId: 2 })).body.code, 'CARTON_ACTOR_CHANGED');
    });
    await t.test('request retries replay exactly once, while fresh IDs cannot physically rescan the same allocation', async () => {
        const carton = await create(box('RETRY'));
        const { order } = await f.seedOrder();
        const input = { scanValue: 'RETRY', type: 'pick', mode: 'split', selections: [{ lineId: carton.lines[0].lineId, quantity: 3 }] };
        const body = scanBody(await preview(order.id, input), input);
        const results = await Promise.all([api(2, 'post', `/api/orders/${order.id}/carton-scan`, body), api(2, 'post', `/api/orders/${order.id}/carton-scan`, body)]);
        assert.deepEqual(ok(results[0]), ok(results[1]));
        const current = results[0].body;
        assert.equal(current.items[0].picked_quantity, 3); assert.equal(current.carton.lines[0].remainingQuantity, 7);
        const newBody = { ...body, commandId: randomUUID(), expectedState: current.stateToken, expectedCartonRevision: current.carton.stateRevision };
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-scan`, newBody)).body.code, 'CARTON_ALREADY_ALLOCATED');
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-scan`, { ...body, mode: 'whole' })).body.code, 'CARTON_COMMAND_CONFLICT');
    });
    await t.test('two operators on different orders competing for one box produce one pick and one version conflict', async () => {
        await create(box('RACE'));
        const a = await f.seedOrder(), b = await f.seedOrder({ pickerId: 6 });
        const input = { scanValue: 'RACE', type: 'pick' };
        const bodyA = scanBody(await preview(a.order.id, input, 2), input), bodyB = scanBody(await preview(b.order.id, input, 6), input);
        const results = await Promise.all([api(2, 'post', `/api/orders/${a.order.id}/carton-scan`, bodyA), api(6, 'post', `/api/orders/${b.order.id}/carton-scan`, bodyB)]);
        assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
        assert.equal(results.find(result => result.status === 409).body.code, 'CARTON_STATE_CHANGED');
        assert.equal((await f.db.query('SELECT SUM(picked_quantity)::int AS n FROM order_items WHERE order_id=ANY($1::int[])', [[a.order.id, b.order.id]])).rows[0].n, 10);
        assert.equal(ok(await api(2, 'get', '/api/cartons/RACE')).lines[0].remainingQuantity, 0);
    });
    await t.test('snapshot or durable receipt failure rolls back quantity, SN, allocation, history and events together', async () => {
        const sns = ['Rollback-SN-1', 'Rollback-SN-2'];
        await create(box('ROLLBACK', 2, sns));
        const { order } = await f.seedOrder({ quantity: 2, actualSN: sns });
        const input = { scanValue: 'ROLLBACK', type: 'pick' }, body = scanBody(await preview(order.id, input), input);
        const io = { emitted: [], emit(...args) { this.emitted.push(args); } };
        f.app.set('io', io);
        f.failNext(sql => sql.startsWith('INSERT INTO wms_scan_commands'));
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-scan`, body)).status, 500);
        assert.equal((await f.db.query('SELECT COUNT(*)::int AS n FROM order_item_instances WHERE order_item_id=$1 AND status<>\'pending\'', [(await f.db.query('SELECT id FROM order_items WHERE order_id=$1', [order.id])).rows[0].id])).rows[0].n, 0);
        const carton = ok(await api(2, 'get', '/api/cartons/ROLLBACK'));
        assert.equal(carton.lines[0].remainingQuantity, 2); assert.equal(carton.allocations.length, 0); assert.equal(carton.history.length, 2);
        assert.equal(io.emitted.length, 0);
        ok(await api(2, 'post', `/api/orders/${order.id}/carton-scan`, body));
        assert.ok(io.emitted.length > 0); f.app.set('io', undefined);
    });
    await t.test('lost COMMIT response reports unknown, original command reconciles the durable result without double deduction', async () => {
        await create(box('UNKNOWN', 1)); const { order } = await f.seedOrder({ quantity: 1 });
        const input = { scanValue: 'UNKNOWN', type: 'pick' }, body = scanBody(await preview(order.id, input), input);
        f.failAfterNext(sql => sql === 'COMMIT');
        const first = await api(2, 'post', `/api/orders/${order.id}/carton-scan`, body);
        assert.equal(first.status, 503); assert.equal(first.body.code, 'SCAN_RESULT_UNKNOWN');
        const replay = ok(await api(2, 'post', `/api/orders/${order.id}/carton-scan`, body));
        assert.equal(replay.items[0].picked_quantity, 1); assert.equal(replay.carton.lines[0].remainingQuantity, 0);
        assert.equal(replay.carton.allocations.length, 1);
    });
    await t.test('changed state, wrong station, draft and open changes/exceptions reject without mutation', async () => {
        const carton = await create(box('BLOCKED', 1));
        const { order } = await f.seedOrder({ quantity: 1 });
        const input = { scanValue: 'BLOCKED', type: 'pick' }, body = scanBody(await preview(order.id, input), input);
        assert.equal((await api(6, 'post', `/api/orders/${order.id}/carton-preview`, input)).status, 403);
        await f.db.query("UPDATE orders SET customer_name='Changed' WHERE id=$1", [order.id]);
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-scan`, body)).body.code, 'STATE_CHANGED');
        await f.db.query("INSERT INTO order_exceptions(order_id,type,created_by) VALUES($1,'order_change',1)", [order.id]);
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-preview`, input)).body.code, 'CARTON_ORDER_EXCEPTION');
        assert.equal(ok(await api(2, 'get', '/api/cartons/BLOCKED')).stateRevision, carton.stateRevision);
        const draft = await create({ ...box('UNSEALED', 1), seal: false });
        const other = await f.seedOrder({ quantity: 1 });
        assert.equal((await api(2, 'post', `/api/orders/${other.order.id}/carton-preview`, { scanValue: draft.cartonId, type: 'pick' })).body.code, 'CARTON_NOT_SEALED');
    });
    await t.test('duplicate product rows require explicit line; negative documents never replenish cartons', async () => {
        const carton = await create(box('MULTI', 1)), { order, item } = await f.seedOrder({ quantity: 1 });
        await f.db.query('INSERT INTO order_items(order_id,product_code,barcode,quantity) VALUES($1,$2,$3,1)', [order.id, item.product_code, item.barcode]);
        const input = { scanValue: 'MULTI', type: 'pick' };
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-preview`, input)).body.code, 'CARTON_ORDER_LINE_REQUIRED');
        await scan(order.id, { ...input, selections: [{ lineId: carton.lines[0].lineId, orderItemId: item.id }] });
        await create(box('NEGATIVE', 1));
        const reversed = await f.seedOrder({ quantity: 1, sign: -1 });
        assert.equal((await api(2, 'post', `/api/orders/${reversed.order.id}/carton-preview`, { scanValue: 'NEGATIVE', type: 'pick' })).body.code, 'SIGNED_CARTON_REVIEW_REQUIRED');
        assert.equal(ok(await api(2, 'get', '/api/cartons/NEGATIVE')).lines[0].remainingQuantity, 1);
    });
    await t.test('admin release restores once, preserves history, permits repick and rejects packed or operator releases', async () => {
        await create(box('RELEASE', 2));
        const { order } = await f.seedOrder({ quantity: 2 });
        const picked = await scan(order.id, { scanValue: 'RELEASE', type: 'pick' });
        const body = { commandId: randomUUID(), expectedState: picked.stateToken, expectedCartonRevision: picked.carton.stateRevision, reason: 'Synthetic physical put-back' };
        const path = `/api/cartons/allocations/${picked.allocation.allocationId}/release`;
        assert.equal((await api(2, 'post', path, body)).status, 403);
        const released = ok(await api(1, 'post', path, body));
        assert.equal(released.carton.lines[0].remainingQuantity, 2); assert.equal(released.items[0].picked_quantity, 0);
        assert.equal(released.order.status, 'picking'); assert.equal(released.carton.allocations[0].status, 'released');
        assert.deepEqual(ok(await api(1, 'post', path, body)), released);
        const repicked = await scan(order.id, { scanValue: 'RELEASE', type: 'pick' });
        const packed = await scan(order.id, { scanValue: 'RELEASE', type: 'pack' }, 3);
        assert.equal((await api(1, 'post', `/api/cartons/allocations/${repicked.allocation.allocationId}/release`, {
            ...body, commandId: randomUUID(), expectedState: packed.stateToken, expectedCartonRevision: packed.carton.stateRevision })).body.code, 'CARTON_RELEASE_BLOCKED');
    });
    await t.test('legacy unit mutations protect allocated contents but leave non-box units usable', async () => {
        const carton = await create(box('GUARD', 3)), { order, item } = await f.seedOrder({ quantity: 5 });
        await scan(order.id, { scanValue: 'GUARD', type: 'pick' });
        await assert.rejects(guardUnitScan(f.pool, order.id, { orderItemId: item.id, type: 'pick', amount: -1 }), { code: 'CARTON_ALLOCATION_GUARD' });
        await assert.rejects(guardUnitScan(f.pool, order.id, { orderItemId: item.id, type: 'pack', amount: 1 }), { code: 'CARTON_ALLOCATION_GUARD' });
        await assert.rejects(assertNoCartonAllocations(f.pool, order.id), { code: 'CARTON_ALLOCATION_GUARD' });
        await guardUnitScan(f.pool, order.id, { orderItemId: item.id, type: 'pick', amount: 1 });
        await f.db.query('UPDATE order_items SET picked_quantity=5 WHERE id=$1', [item.id]);
        await guardUnitScan(f.pool, order.id, { orderItemId: item.id, type: 'pack', amount: 2 });
        await assert.rejects(guardUnitScan(f.pool, order.id, { orderItemId: item.id, type: 'pack', amount: 3 }), { code: 'CARTON_ALLOCATION_GUARD' });
        assert.equal(carton.lines[0].quantity, 3);
        const other = await f.seedOrder({ quantity: 1 });
        await assertNoCartonAllocations(f.pool, other.order.id);
        await guardUnitScan(f.pool, other.order.id, { orderItemId: other.item.id, type: 'pick', amount: -1 });
    });
    await t.test('real legacy HTTP cannot consume reserved box units, replace SN or void; ordinary two units remain usable', async () => {
        f.attachLegacyRoutes();
        const { order } = await f.seedOrder(), carton = await create(box('LEGACY-MIX', 8));
        const unitInput = { orderId: order.id, scanValue: '4710000000010', type: 'pick', amount: 2 };
        ok(await api(2, 'post', '/api/orders/update_item', unitInput));
        await scan(order.id, { scanValue: carton.cartonId, type: 'pick' });
        const unitPack = { ...unitInput, type: 'pack' };
        ok(await api(3, 'post', '/api/orders/update_item', unitPack));
        assert.equal((await api(3, 'post', '/api/orders/update_item', { ...unitPack, amount: 1 })).status, 409);
        assert.equal((await api(2, 'post', '/api/orders/update_item', { ...unitInput, amount: -1 })).status, 409);
        assert.equal((await api(1, 'patch', `/api/orders/${order.id}/void`, { reason: 'Fixture cancellation' })).status, 409);
        assert.equal((await scan(order.id, { scanValue: carton.cartonId, type: 'pack' }, 3)).order.status, 'completed');
        const sns = ['Legacy-Reserved-SN']; await create(box('LEGACY-SN', 1, sns));
        const serialOrder = await f.seedOrder({ quantity: 1, actualSN: sns });
        const pending = await api(2, 'post', '/api/orders/update_item', { orderId: serialOrder.order.id, scanValue: sns[0], type: 'pick' });
        assert.equal(pending.status, 409);
        assert.equal(ok(await api(2, 'get', '/api/cartons/LEGACY-SN')).lines[0].remainingQuantity, 1);
        await scan(serialOrder.order.id, { scanValue: 'LEGACY-SN', type: 'pick', mode: 'split', selections: [{ lineId: ok(await api(2, 'get', '/api/cartons/LEGACY-SN')).lines[0].lineId, actualSN: sns }] });
        assert.equal((await api(3, 'post', '/api/orders/update_item', { orderId: serialOrder.order.id, scanValue: sns[0], type: 'pack' })).status, 409);
        assert.equal((await api(1, 'post', `/api/orders/${serialOrder.order.id}/defect`, { oldSn: sns[0], newSn: 'New-SN', reason: 'Fixture exchange' })).status, 409);
    });
    await t.test('mixed loose corrections reopen the stage while preserving picked and packed carton reservations', async () => {
        f.attachLegacyRoutes();
        const { order } = await f.seedOrder(), carton = await create(box('LOOSE-UNDO', 8));
        const unit = (type, amount, user) => api(user, 'post', '/api/orders/update_item', { orderId: order.id, scanValue: '4710000000010', type, amount });
        ok(await unit('pick', 2, 2));
        const picked = await scan(order.id, { scanValue: carton.cartonId, type: 'pick' });
        const undoPick = ok(await unit('pick', -2, 2));
        assert.equal(undoPick.order.status, 'picking'); assert.equal(undoPick.items[0].picked_quantity, 8);
        assert.equal((await unit('pick', -1, 2)).status, 409);
        assert.equal((await unit('pack', 1, 3)).status, 409);
        ok(await unit('pick', 2, 2)); ok(await unit('pack', 2, 3));
        const packed = await scan(order.id, { scanValue: carton.cartonId, type: 'pack' }, 3);
        assert.equal(packed.order.status, 'completed'); assert.ok(packed.order.completed_at);
        const undoPack = ok(await unit('pack', -2, 3));
        assert.equal(undoPack.order.status, 'packing'); assert.equal(undoPack.order.completed_at, null);
        assert.equal(undoPack.items[0].packed_quantity, 8);
        assert.equal((await unit('pack', -1, 3)).status, 409);
        const undoLoose = ok(await unit('pick', -2, 2));
        assert.equal(undoLoose.order.status, 'picking'); assert.equal(undoLoose.items[0].picked_quantity, 8);
        assert.equal((await unit('pick', -1, 2)).status, 409);
        const current = ok(await api(2, 'get', `/api/cartons/${carton.cartonId}`));
        assert.equal(current.lines[0].remainingQuantity, 0);
        assert.equal(current.stateRevision, packed.carton.stateRevision);
        assert.equal(current.allocations[0].allocationId, picked.allocation.allocationId);
        assert.equal(current.allocations[0].status, 'packed');
        ok(await unit('pick', 2, 2)); assert.equal(ok(await unit('pack', 2, 3)).order.status, 'completed');
    });
    await t.test('actual SN CSV import and exact raw single scans preserve case; canonical collisions do not fall through', async () => {
        const csv = '\uFEFF憑證號碼：EXACT-CSV\n客戶名稱：Synthetic\n品項編碼,品項名稱,數量,實際SN\n4710000000010,Vendor,2,"Vendor-a02,Vendor-A02"\n';
        const imported = await request(f.app).post('/api/orders/import').set('x-fixture-user', '1').attach('orderFile', Buffer.from(csv), 'exact.csv');
        const result = ok(imported, 201), orderId = result.orderId ?? result.id;
        const actual = (await f.db.query('SELECT i.serial_number FROM order_item_instances i JOIN order_items oi ON oi.id=i.order_item_id WHERE oi.order_id=$1 ORDER BY i.id', [orderId])).rows.map(row => row.serial_number);
        assert.deepEqual(actual, ['Vendor-a02','Vendor-A02']);
        assert.equal((await f.db.query('SELECT serial_identity_mode FROM order_items WHERE order_id=$1', [orderId])).rows[0].serial_identity_mode, 'exact');
        await f.db.query("UPDATE orders SET status='picking',picker_id=2,packer_id=3 WHERE id=$1", [orderId]);
        const ambiguous = await api(2, 'post', '/api/orders/update_item', { orderId, scanValue: 'vendor-a02', type: 'pick' });
        assert.equal(ambiguous.status, 409);
        const first = ok(await api(2, 'post', '/api/orders/update_item', { orderId, scanValue: 'Vendor-a02', type: 'pick' }));
        assert.equal(first.instances.find(row => row.serial_number === 'Vendor-a02').status, 'picked');
        assert.equal(first.instances.find(row => row.serial_number === 'Vendor-A02').status, 'pending');
        ok(await api(2, 'post', '/api/orders/update_item', { orderId, scanValue: 'Vendor-A02', type: 'pick' }));
    });
    await t.test('negative unit SN verification remains usable for a registered carton without restocking or deduction', async () => {
        const sns = ['NEG000000001']; await create(box('NEGATIVE-UNIT', 1, sns));
        const { order } = await f.seedOrder({ quantity: 1, actualSN: sns, sign: -1 });
        ok(await api(2, 'post', '/api/orders/update_item', { orderId: order.id, scanValue: sns[0], type: 'pick' }));
        const packed = ok(await api(3, 'post', '/api/orders/update_item', { orderId: order.id, scanValue: sns[0], type: 'pack' }));
        assert.equal(packed.order.document_type, 'reversal'); assert.equal(packed.order.status, 'completed');
        assert.equal(ok(await api(2, 'get', '/api/cartons/NEGATIVE-UNIT')).lines[0].remainingQuantity, 1);
        assert.equal(ok(await api(2, 'get', '/api/cartons/NEGATIVE-UNIT')).allocations.length, 0);
    });
    await t.test('legacy SN import and new carton binding share custody locks and cannot assign one real SN to two orders', async () => {
        const sn = 'Race-Import-SN'; await create(box('IMPORT-RACE', 1, [sn])); const { order } = await f.seedOrder({ quantity: 1 });
        const input = { scanValue: 'IMPORT-RACE', type: 'pick', serialPolicy: 'from-carton' }, body = scanBody(await preview(order.id, input), input);
        const csv = `\uFEFF憑證號碼：IMPORT-RACE\n客戶名稱：Synthetic\n品項編碼,品項名稱,數量,實際SN\n4710000000010,Vendor,1,${sn}\n`;
        const results = await Promise.all([
            request(f.app).post('/api/orders/import').set('x-fixture-user', '1').attach('orderFile', Buffer.from(csv), 'race.csv'),
            api(2, 'post', `/api/orders/${order.id}/carton-scan`, body)
        ]);
        assert.equal(results.filter(result => [200,201].includes(result.status)).length, 1);
        assert.equal(results.filter(result => result.status === 409).length, 1);
        assert.equal((await f.db.query('SELECT COUNT(*)::int AS n FROM order_item_instances WHERE serial_number=$1', [sn])).rows[0].n, 1);
    });
    await t.test('actual SN CSV to sealed carton to pick and pack retains exact manufacturer case through real HTTP', async () => {
        const sns = ['Chain-v02','Chain-V02'];
        const csv = `\uFEFF憑證號碼：EXACT-CHAIN\n客戶名稱：Synthetic\n品項編碼,品項名稱,數量,實際SN\n4710000000010,Vendor,2,"${sns.join(',')}"\n`;
        const imported = ok(await request(f.app).post('/api/orders/import').set('x-fixture-user', '1').attach('orderFile', Buffer.from(csv), 'chain.csv'), 201);
        const orderId = imported.orderId;
        await f.db.query("UPDATE orders SET status='picking',picker_id=2,packer_id=3 WHERE id=$1", [orderId]);
        await create(box('EXACT-CHAIN', 2, sns, { itemCode: '4710000000010' }));
        await scan(orderId, { scanValue: 'EXACT-CHAIN', type: 'pick' });
        const packed = await scan(orderId, { scanValue: 'EXACT-CHAIN', type: 'pack' }, 3);
        assert.equal(packed.order.status, 'completed');
        assert.deepEqual(packed.instances.map(unit => unit.serial_number), sns);
    });
    await t.test('registered SNs stay protected after allocation release, and vendor exact SN cannot enter legacy editing', async () => {
        const sns = ['EDIT00000001']; await create(box('EDIT-GUARD', 1, sns));
        const { order } = await f.seedOrder({ quantity: 1, actualSN: sns });
        const picked = await scan(order.id, { scanValue: 'EDIT-GUARD', type: 'pick' });
        ok(await api(1, 'post', `/api/cartons/allocations/${picked.allocation.allocationId}/release`, {
            commandId: randomUUID(), expectedState: picked.stateToken, expectedCartonRevision: picked.carton.stateRevision, reason: 'Editing guard fixture'
        }));
        assert.equal((await api(1, 'post', `/api/orders/${order.id}/defect`, { oldSn: sns[0], newSn: 'EDIT00000002', reason: 'Blocked old editor' })).status, 409);
        const plain = await f.seedOrder({ quantity: 1 });
        await assert.rejects(require('../src/services/orderChangeService').applyOrderChangeProposal({
            client: f.pool, orderId: plain.order.id, actorUserId: 1,
            proposal: { note: 'Cannot add registered carton SN with old editor', items: [{ barcode: plain.item.barcode,
                productName: 'Synthetic', quantityChange: 1, noSn: false, snList: sns }] }
        }), { code: 'CARTON_SERIAL_EDIT_GUARD' });
        assert.equal((await f.db.query('SELECT quantity FROM order_items WHERE id=$1', [plain.item.id])).rows[0].quantity, 1);
        const vendor = await f.seedOrder({ quantity: 1, actualSN: ['Vendor-a/A'], serialMode: 'exact' });
        const edit = await api(1, 'post', `/api/orders/${vendor.order.id}/defect`, { oldSn: 'Vendor-a/A', newSn: 'VENDOR-a/B', reason: 'Unsupported legacy editor' });
        assert.equal(edit.status, 409); assert.ok(edit.body.message.includes('實際 SN'));
        assert.equal((await f.db.query('SELECT serial_number FROM order_item_instances WHERE order_item_id=$1', [vendor.item.id])).rows[0].serial_number, 'Vendor-a/A');
        const short = await f.seedOrder({ quantity: 1, actualSN: ['FIX-1'] });
        ok(await api(1, 'post', `/api/orders/${short.order.id}/defect`, { oldSn: 'FIX-1', newSn: 'SN: feature-final', reason: 'Existing short legacy workflow' }));
        assert.equal((await f.db.query('SELECT serial_number FROM order_item_instances WHERE order_item_id=$1', [short.item.id])).rows[0].serial_number, 'FEATURE-FINAL');
    });
    await t.test('unallocated exact or registered SN editing guards do not block unrelated loose order-line changes', async () => {
        const { order, item } = await f.seedOrder({ quantity: 1, actualSN: ['Vendor-c/C'], serialMode: 'exact' });
        const looseId = (await f.db.query("INSERT INTO order_items(order_id,product_code,product_name,barcode,quantity) VALUES($1,'LOOSE','Synthetic loose','LOOSE',2) RETURNING id", [order.id])).rows[0].id;
        const apply = async proposal => {
            const client = await f.pool.connect();
            try {
                await client.query('BEGIN');
                const result = await require('../src/services/orderChangeService').applyOrderChangeProposal({ client, orderId: order.id, actorUserId: 1, proposal });
                await client.query('COMMIT'); return result;
            } catch (error) { await client.query('ROLLBACK'); throw error; }
            finally { client.release(); }
        };
        const loose = { note: 'Ordinary loose line change', items: [{ barcode: 'LOOSE', productName: 'Synthetic loose', quantityChange: 1, noSn: true }] };
        await apply(loose);
        await assert.rejects(apply({ note: 'Do not normalize vendor identity', items: [{ barcode: item.barcode, productName: 'Vendor', quantityChange: -1, noSn: false, removedSnList: ['Vendor-c/C'] }] }), { code: 'EXACT_SN_LEGACY_EDIT_UNSUPPORTED' });
        await create(box('UNALLOCATED-EDITOR', 1, ['Vendor-c/C']));
        await apply(loose);
        await assert.rejects(apply({ note: 'Do not remove registered serial', items: [{ barcode: item.barcode, productName: 'Vendor', quantityChange: -1, noSn: false }] }), { code: 'CARTON_SERIAL_EDIT_GUARD' });
        assert.equal((await f.db.query('SELECT quantity FROM order_items WHERE id=$1', [looseId])).rows[0].quantity, 4);
        assert.equal((await f.db.query('SELECT serial_number FROM order_item_instances WHERE order_item_id=$1', [item.id])).rows[0].serial_number, 'Vendor-c/C');
    });
    await t.test('shipment source snapshots survive released order line edits and include current remainder separately', async () => {
        await f.db.exec('ALTER TABLE order_items ADD COLUMN source_sku TEXT, ADD COLUMN source_platform TEXT, ADD COLUMN source_store TEXT, ADD COLUMN source_order_number TEXT, ADD COLUMN source_line_id TEXT');
        await create(box('TRACE', 1)); const { order, item } = await f.seedOrder({ quantity: 1 });
        await f.db.query("UPDATE order_items SET source_sku='Full-Campaign-SKU',source_platform='EC',source_store='Store',source_order_number='EC-001',source_line_id='L01' WHERE id=$1", [item.id]);
        const picked = await scan(order.id, { scanValue: 'TRACE', type: 'pick' });
        await api(1, 'post', `/api/cartons/allocations/${picked.allocation.allocationId}/release`, { commandId: randomUUID(), expectedState: picked.stateToken, expectedCartonRevision: picked.carton.stateRevision, reason: 'Trace fixture' });
        await f.db.query("UPDATE order_items SET source_sku='REPLACED',source_line_id='L99' WHERE id=$1", [item.id]);
        const trace = ok(await api(2, 'get', `/api/orders/${order.id}/carton-shipments`)).allocations[0].lines[0];
        assert.equal(trace.sourceSKU, 'Full-Campaign-SKU'); assert.equal(trace.sourceLineId, 'L01'); assert.equal(trace.sourcePlatform, 'EC');
        assert.equal(trace.currentRemainingQuantity, 1);
        await assert.rejects(f.db.query('DELETE FROM orders WHERE id=$1', [order.id]), error => ['23503','23001'].includes(error.code) && error.message.includes('wms_carton_allocations_order_id_fkey'));
    });
}
test('carton HTTP + PostgreSQL semantics on disposable PGlite (transactions serialized)', { timeout: 120000 }, t => suite(t, false));
test('carton HTTP + actual multi-connection PostgreSQL lock contention on disposable loopback database', {
    skip: process.env.WMS_CARTON_PG !== '1', timeout: 120000
}, t => suite(t, true));
