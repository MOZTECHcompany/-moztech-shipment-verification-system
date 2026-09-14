// Opt-in real HTTP + PostgreSQL; fixed loopback server and a disposable DB only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const xlsx = require('xlsx');

test('ERP batch split, explicit barcode claims and isolated warehouse workflows', { skip: process.env.WMS_SOURCE_ORDER_PG_TEST !== '1', timeout: 60000 }, async t => {
    const database = `wms_source_${randomBytes(6).toString('hex')}`;
    const config = { host: '127.0.0.1', port: 55441, user: 'wms_replay', password: 'wms_replay_local_only', database: 'postgres' };
    const control = new Client(config);
    await control.connect();
    await control.query(`CREATE DATABASE "${database}"`);
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: '', PGHOST: config.host, PGPORT: String(config.port), PGUSER: config.user,
        PGPASSWORD: config.password, PGDATABASE: database, PGOPTIONS: '', JWT_SECRET: 'source-order-local-tests-only', DB_POOL_MAX: '1',
        DB_SSL_MODE: 'disable', STORAGE_BACKEND: 'local', CORS_ORIGINS: 'http://127.0.0.1', WMS_ECPAY_ACCOUNTS_JSON: '[]', WMS_ECPAY_CALLBACKS_ENABLED: 'false' });
    const { pool } = require('../src/config/database');
    let server, io;
    t.after(async () => {
        if (io) await new Promise(resolve => io.close(resolve));
        await pool.end();
        try { await control.query(`DROP DATABASE "${database}"`); } finally { await control.end(); }
    });
    const { runMigrations } = require('../src/maintenance/migrationRunner');
    const { assertSchemaReady } = require('../src/config/schemaReadiness');
    const { loadMigrationManifest } = require('../src/config/migrationManifest');
    const manifest = loadMigrationManifest();
    assert.equal(manifest.at(-1).name, '029_warehouse_batches_and_claim_receipts.sql');
    // Exercise an upgrade from the previous schema, preserving existing rows.
    await runMigrations({ pool, targetDatabase: database, manifest: manifest.slice(0, -2) });
    const oldOrder = (await pool.query("INSERT INTO orders(voucher_number) VALUES('SOURCE-LEGACY') RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO order_items(order_id,product_code,product_name,barcode,quantity) VALUES($1,'OLD','Legacy item','OLD-BAR',1)", [oldOrder]);
    const migration = await runMigrations({ pool, targetDatabase: database });
    assert.deepEqual(migration.applied, ['028_order_item_source_identity.sql', '029_warehouse_batches_and_claim_receipts.sql']);
    await assertSchemaReady(pool);
    assert.equal((await pool.query('SELECT source_order_number FROM order_items WHERE order_id=$1', [oldOrder])).rows[0].source_order_number, null);
    assert.equal((await runMigrations({ pool, targetDatabase: database })).applied.length, 0);

    const roles = ['superadmin', 'admin', 'dispatcher', 'picker', 'packer', 'picker2'];
    const tokens = {}, users = {}, password = 'synthetic-source-workflow';
    for (const role of roles) users[role] = (await pool.query('INSERT INTO users(username,password,name,role) VALUES($1,$2,$3,$4) RETURNING id',
        [`source_${role}`, await bcrypt.hash(password, 4), `Synthetic ${role}`, role === 'picker2' ? 'picker' : role])).rows[0].id;
    ({ server, io } = require('../src/app'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function api(role, method, path, body) {
        const headers = tokens[role] ? { Authorization: `Bearer ${tokens[role]}` } : {};
        if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
        const result = await fetch(base + path, { method, headers, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
        return { status: result.status, data: await result.json() };
    }
    const ok = (result, expected = 200) => { assert.equal(result.status, expected, JSON.stringify(result.data)); return result.data; };
    const header = ['理貨單號', '序號', '商城訂單編號', '平台', '店鋪', '來源明細號', '品項編碼', '品項名稱', '國際條碼', '數量', '序號/批號', '客戶名稱'];
    const rows = () => [header,
        ['SOURCE-PICK-1', '1', 'SHOP-100', 'Shopify', 'Store-A', 'line-1', 'SKU-A', 'Item A', 'SOURCE-DUP', 2, '', 'Customer A'],
        ['SOURCE-PICK-1', '2', 'ONE-200', '1Shop', 'Store-B', 'line-1', 'SKU-A', 'Item A', 'SOURCE-DUP', 2, '', 'Customer B'],
        ['SOURCE-PICK-1', '1', 'SHOP-100', 'Shopify', 'Store-A', 'line-2', 'SKU-SN', 'Serial item', 'SOURCE-SN', 1, 'SRC000000001', 'Customer A'],
        ['SOURCE-PICK-1', '2', 'ONE-200', '1Shop', 'Store-B', 'line-2', 'SKU-SN', 'Serial item', 'SOURCE-SN', 1, 'SRC000000002', 'Customer B'],
        ['SOURCE-PICK-1', '3', 'SHOP-100', 'Shopify', 'Store-C', 'line-1', 'SKU-A', 'Item A', 'SOURCE-DUP', 1, '', 'Customer C']];
    async function upload(data = rows(), role = 'dispatcher') {
        const book = xlsx.utils.book_new(); xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet(data), '理貨明細');
        const form = new FormData(); form.set('orderFile', new Blob([xlsx.write(book, { type: 'buffer', bookType: 'xlsx' })]), 'source-fixture.xlsx');
        return api(role, 'POST', '/api/orders/import', form);
    }
    for (const role of roles) tokens[role] = ok(await api(null, 'POST', '/api/auth/login', { username: `source_${role}`, password })).accessToken;
    let imported, first, second, third, pickerRole;
    const read = async id => ok(await api('dispatcher', 'GET', `/api/orders/${id}/work-snapshot`));
    const command = (barcode, stage = 'pick') => ({ barcode, stage, commandId: randomUUID() });
    const claimCode = (role, body) => api(role, 'POST', '/api/orders/claim-by-barcode', { expectedActorId: users[role], ...body });
    const scan = (role, id, value, type, more = {}) => api(role, 'POST', '/api/orders/update_item', { orderId: id, scanValue: value, type, ...more });
    const batchRows = number => rows().map((r, i) => i ? [number, ...r.slice(1)] : r);
    const legacyRows = number => [['憑證號碼：' + number], ['國際條碼', '品項名稱', '數量'], ['LEGACY-BAR', 'Legacy [LEGACY-SKU]', 1]];
    const claimLogs = async id => (await pool.query("SELECT count(*)::int n FROM operation_logs WHERE order_id=$1 AND action_type='claim'", [id])).rows[0].n;
    async function committedResponseLoss(role, body) {
        const { createBarcodeClaimHandlers } = require('../src/services/orderClaimService');
        const injectedPool = { connect: async () => {
            const client = await pool.connect();
            return { query: async (...args) => { const result = await client.query(...args); if (args[0] === 'COMMIT') throw new Error('Synthetic committed response loss'); return result; }, release: error => client.release(error) };
        } };
        const req = { body: { expectedActorId: users[role], ...body }, user: { id: users[role], role, name: `Synthetic ${role}` }, app: { get: () => io } };
        const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(data) { this.data = data; return this; } };
        await createBarcodeClaimHandlers(injectedPool).claim(req, res);
        return { status: res.statusCode, data: res.data };
    }

    await t.test('one ERP batch atomically splits source/store tuples into three independent work orders', async () => {
        assert.equal((await upload(rows(), 'picker')).status, 403);
        imported = ok(await upload(), 201);
        assert.equal(imported.batchNumber, 'SOURCE-PICK-1'); assert.equal(imported.workOrderCount, 3);
        assert.equal(imported.itemCount, 5); assert.equal(imported.totalQuantity, 7); assert.equal(imported.serialCount, 2);
        [first, second, third] = imported.orders;
        assert.equal(new Set(imported.orders.map(o => o.workBarcode)).size, 3);
        for (const o of imported.orders) assert.match(o.workBarcode, /^WT[0-9A-F]{18}$/);
        for (const [o, customer, itemCount] of [[first, 'Customer A', 2], [second, 'Customer B', 2], [third, 'Customer C', 1]]) {
            const snapshot = await read(o.orderId);
            assert.equal(snapshot.order.batch_number, 'SOURCE-PICK-1'); assert.equal(snapshot.order.import_batch_id, imported.batchId);
            assert.equal(snapshot.order.customer_name, customer); assert.equal(snapshot.items.length, itemCount);
            assert.equal(snapshot.items.every(i => i.source_order_number === o.sourceOrderNumber && i.source_store === o.sourceStore), true);
        }
        assert.equal((await read(oldOrder)).order.import_batch_id, null);
        assert.equal((await pool.query("SELECT count(*)::int n FROM orders WHERE voucher_number='SOURCE-PICK-1'")).rows[0].n, 0);
    });
    await t.test('same ERP batch, historical unsplit voucher and cross-format concurrent imports cannot duplicate work', async () => {
        const duplicate = await upload(); assert.equal(duplicate.status, 409); assert.equal(duplicate.data.batchId, imported.batchId); assert.equal(duplicate.data.orders.length, 3);
        assert.equal((await upload(legacyRows('SOURCE-PICK-1'))).data.code, 'IMPORT_ALREADY_EXISTS');
        assert.equal((await upload(batchRows('SOURCE-LEGACY'))).data.orderId, oldOrder);
        const race = await Promise.all([upload(batchRows('SOURCE-RACE')), upload(legacyRows('SOURCE-RACE'))]);
        assert.deepEqual(race.map(r => r.status).sort(), [201, 409]);
        const stored = await pool.query("SELECT (SELECT count(*) FROM warehouse_import_batches WHERE voucher_number='SOURCE-RACE') + (SELECT count(*) FROM orders WHERE voucher_number='SOURCE-RACE') AS n");
        assert.equal(Number(stored.rows[0].n), 1);
        // Different ERP batches may be legitimate split shipments, not duplicates.
        assert.equal((await upload(batchRows('SOURCE-SPLIT-SHIPMENT'))).status, 201);
    });
    await t.test('late child failure rolls the entire batch back; duplicate SN/customer conflicts reject before writing', async () => {
        await pool.query("CREATE FUNCTION fail_source_child() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_store='FAIL-CHILD' THEN RAISE EXCEPTION 'Synthetic last child failure'; END IF; RETURN NEW; END $$");
        await pool.query('CREATE TRIGGER reject_source_child BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION fail_source_child()');
        const before = (await pool.query('SELECT count(*)::int n FROM orders')).rows[0].n;
        const failure = batchRows('SOURCE-ROLLBACK'); failure.at(-1)[4] = 'FAIL-CHILD';
        assert.equal((await upload(failure)).data.code, 'IMPORT_NOT_APPLIED');
        assert.equal((await pool.query('SELECT count(*)::int n FROM orders')).rows[0].n, before);
        assert.equal((await pool.query("SELECT count(*)::int n FROM warehouse_import_batches WHERE voucher_number='SOURCE-ROLLBACK'")).rows[0].n, 0);
        await pool.query('DROP TRIGGER reject_source_child ON orders'); await pool.query('DROP FUNCTION fail_source_child()');
        const duplicateSn = batchRows('SOURCE-DUP-SN'); duplicateSn[4][10] = 'SRC000000001';
        assert.equal((await upload(duplicateSn)).status, 400);
        const conflictingCustomer = batchRows('SOURCE-CUSTOMER'); conflictingCustomer[3][11] = 'Different customer';
        assert.equal((await upload(conflictingCustomer)).status, 400);
        const summary = batchRows('SOURCE-SUMMARY'); summary[0].push('摘要'); summary[3][10] = ''; summary[3].push('TESTSN000001');
        assert.match((await upload(summary)).data.message, /序號\/批號/);
    });
    await t.test('exact claim binds current user, serializes competing claims and leaves all product counts untouched', async () => {
        assert.equal((await claimCode(null, command(first.workBarcode))).status, 401);
        assert.equal((await claimCode('dispatcher', command(first.workBarcode))).data.reason, 'FORBIDDEN');
        assert.equal((await claimCode('packer', command(first.workBarcode))).data.reason, 'FORBIDDEN');
        assert.equal((await claimCode('picker', command(first.workBarcode + '-partial'))).status, 404);
        const staleSession = await claimCode('picker2', { ...command(first.workBarcode), expectedActorId: users.picker });
        assert.equal(staleSession.status, 409); assert.equal(staleSession.data.reason, 'SESSION_CHANGED');
        assert.equal((await read(first.orderId)).order.picker_id, null); assert.equal(await claimLogs(first.orderId), 0);
        assert.equal((await scan('admin', first.orderId, 'SOURCE-DUP', 'pick')).status, 409);
        const results = await Promise.all([claimCode('picker', command(first.workBarcode)), claimCode('picker2', command(first.workBarcode))]);
        assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
        pickerRole = results[0].status === 200 ? 'picker' : 'picker2';
        const snapshot = await read(first.orderId);
        assert.equal(snapshot.order.picker_id, users[pickerRole]); assert.equal(await claimLogs(first.orderId), 1);
        assert.equal(snapshot.items.every(i => i.picked_quantity === 0), true); assert.equal(snapshot.instances[0].status, 'pending');
        assert.equal((await scan('admin', first.orderId, 'SOURCE-DUP', 'pick')).status, 403);
        assert.equal((await scan(pickerRole, first.orderId, 'SOURCE-DUP', 'pack')).status, 403);
        assert.equal((await claimCode('admin', command(first.workBarcode))).data.reason, 'OWNED_BY_OTHER');
    });
    await t.test('durable receipts serialize simultaneous same-command requests, support resume and forbid payload/user reuse', async () => {
        const body = command(second.workBarcode);
        const pair = await Promise.all([claimCode('picker', body), claimCode('picker', body)]);
        assert.equal(pair[0].status, 200); assert.deepEqual(pair[0], pair[1]); assert.equal(pair[0].data.outcome, 'claimed');
        assert.equal(await claimLogs(second.orderId), 1);
        assert.deepEqual(ok(await api('picker', 'GET', `/api/orders/claim-commands/${body.commandId}`)), pair[0].data);
        assert.equal((await api('picker2', 'GET', `/api/orders/claim-commands/${body.commandId}`)).status, 404);
        assert.equal((await api('picker2', 'GET', `/api/orders/claim-commands/${body.commandId}?expectedActorId=${users.picker}`)).data.reason, 'SESSION_CHANGED');
        assert.deepEqual(ok(await api('picker', 'GET', `/api/orders/claim-commands/${body.commandId}?expectedActorId=${users.picker}`)), pair[0].data);
        assert.equal((await claimCode('picker2', { ...body, expectedActorId: users.picker })).data.reason, 'SESSION_CHANGED');
        assert.deepEqual(ok(await claimCode('picker', body)), pair[0].data);
        assert.equal((await api('picker', 'GET', `/api/orders/claim-commands/${randomUUID()}`)).data.code, 'CLAIM_RECEIPT_NOT_FOUND');
        assert.equal((await claimCode('picker', { ...body, stage: 'pack' })).data.reason, 'COMMAND_REUSED');
        assert.equal(ok(await claimCode('picker', command(second.workBarcode))).outcome, 'continued');
        assert.equal(await claimLogs(second.orderId), 1);
        assert.equal((await claimCode('picker', { ...command(third.workBarcode), ownerId: users.picker2 })).status, 400);
    });
    await t.test('unknown COMMIT result is recoverable with its receipt and exact same command without another claim', async () => {
        const body = { ...command(third.workBarcode), expectedActorId: users.admin };
        const res = await committedResponseLoss('admin', body);
        assert.equal(res.status, 503); assert.equal(res.data.code, 'CLAIM_RESULT_UNKNOWN');
        const receipt = ok(await api('admin', 'GET', `/api/orders/claim-commands/${body.commandId}`));
        assert.equal(receipt.orderId, third.orderId);
        assert.deepEqual(ok(await claimCode('admin', body)), receipt); assert.equal(await claimLogs(third.orderId), 1);
    });
    await t.test('durable rejections resolve unknown results and prevent late original commands from claiming', async () => {
        for (const reason of ['NOT_FOUND', 'OWNED_BY_OTHER']) {
            const voucher = `SOURCE-REJECT-${reason}`;
            let targetId;
            if (reason === 'OWNED_BY_OTHER') {
                targetId = ok(await upload(legacyRows(voucher)), 201).orderId;
                ok(await claimCode('picker', command(voucher)));
            }
            const body = { ...command(voucher), expectedActorId: users.admin };
            const lost = await committedResponseLoss('admin', body);
            assert.equal(lost.status, 503); assert.equal(lost.data.code, 'CLAIM_RESULT_UNKNOWN');
            const receipt = ok(await api('admin', 'GET', `/api/orders/claim-commands/${body.commandId}?expectedActorId=${users.admin}`));
            assert.equal(receipt.outcome, 'rejected'); assert.equal(receipt.definitive, true); assert.equal(receipt.reason, reason);
            assert.equal(receipt.commandId, body.commandId); assert.equal(receipt.expectedActorId, users.admin); assert.equal(receipt.stage, 'pick');
            if (targetId) {
                assert.equal((await read(targetId)).order.picker_id, users.picker); assert.equal(await claimLogs(targetId), 1);
                // Removing the target must not remove the immutable negative receipt.
                await pool.query('DELETE FROM orders WHERE id=$1', [targetId]);
            }
            const replacement = (await pool.query('INSERT INTO orders(voucher_number) VALUES($1) RETURNING id', [voucher])).rows[0].id;
            const late = await claimCode('admin', body);
            assert.equal(late.status, receipt.httpStatus); assert.deepEqual(late.data, receipt);
            assert.equal((await read(replacement)).order.picker_id, null); assert.equal(await claimLogs(replacement), 0);
            assert.equal((await pool.query('SELECT order_id FROM wms_claim_commands WHERE user_id=$1 AND command_id=$2', [users.admin, body.commandId])).rows[0].order_id, null);
        }
    });
    await t.test('transient command lock timeouts never create a definitive rejection receipt', async () => {
        const body = { ...command('SOURCE-BUSY-COMMAND'), expectedActorId: users.admin };
        const lockClient = new Client({ ...config, database });
        await lockClient.connect();
        try {
            await lockClient.query('BEGIN');
            await lockClient.query("SELECT pg_advisory_xact_lock(hashtext('wms-claim-command'),hashtext($1))", [`${users.admin}:${body.commandId}`]);
            const busy = await claimCode('admin', body);
            assert.equal(busy.status, 409); assert.equal(busy.data.reason, 'BUSY'); assert.equal(busy.data.definitive, undefined);
            assert.equal((await api('admin', 'GET', `/api/orders/claim-commands/${body.commandId}`)).data.code, 'CLAIM_RECEIPT_NOT_FOUND');
        } finally { await lockClient.query('ROLLBACK'); await lockClient.end(); }
        const rejected = await claimCode('admin', body);
        assert.equal(rejected.data.definitive, true); assert.equal(rejected.data.reason, 'NOT_FOUND');
    });
    await t.test('legacy exact voucher resolves, but cross-column collisions never auto-select either order', async () => {
        assert.equal(ok(await claimCode('picker', command('SOURCE-LEGACY'))).orderId, oldOrder);
        const collision = 'WT000000000000000001';
        await pool.query('UPDATE orders SET work_barcode=$1 WHERE id=$2', [collision, oldOrder]);
        await pool.query('INSERT INTO orders(voucher_number) VALUES($1)', [collision]);
        assert.equal((await claimCode('picker', command(collision))).data.reason, 'AMBIGUOUS');
        await pool.query('DELETE FROM orders WHERE voucher_number=$1', [collision]);
    });
    await t.test('explicit transfer controls the next operator; cross-work-order SN cannot mutate a sibling', async () => {
        const newRole = pickerRole === 'picker' ? 'picker2' : 'picker';
        ok(await api(pickerRole, 'POST', `/api/tasks/${first.orderId}/transfer`, { to_user_id: users[newRole], task_type: 'pick', reason: 'Synthetic handoff' }));
        assert.equal((await scan(pickerRole, first.orderId, 'SOURCE-DUP', 'pick')).status, 403);
        pickerRole = newRole;
        const snapshot = await read(first.orderId), serialItem = snapshot.items.find(i => i.barcode === 'SOURCE-SN');
        assert.equal((await scan(pickerRole, first.orderId, 'SRC000000002', 'pick', { orderItemId: serialItem.id })).status, 400);
        assert.equal((await read(second.orderId)).instances[0].status, 'pending');
        const item = snapshot.items.find(i => i.barcode === 'SOURCE-DUP');
        const body = { orderItemId: item.id, amount: 1, responseMode: 'delta-v1', commandId: randomUUID(), expectedState: snapshot.stateToken };
        const delta = ok(await scan(pickerRole, first.orderId, item.barcode, 'pick', body));
        assert.equal(delta.item.source_store, 'Store-A'); assert.equal(delta.order.batch_number, 'SOURCE-PICK-1');
        assert.deepEqual(ok(await scan(pickerRole, first.orderId, item.barcode, 'pick', body)), delta);
        assert.equal((await read(second.orderId)).items.find(i => i.barcode === 'SOURCE-DUP').picked_quantity, 0);
    });
    await t.test('batch SN uniqueness and child ownership remain protected during changes and defect replacements', async () => {
        const request = async proposal => ok(await api('dispatcher', 'POST', `/api/orders/${second.orderId}/exceptions`, {
            type: 'order_change', reasonText: 'Synthetic batch change', snapshot: { proposal: { note: 'Synthetic batch change', items: [proposal] } }
        }), 201);
        const source = { sourceOrderNumber: second.sourceOrderNumber, sourcePlatform: second.sourcePlatform, sourceStore: second.sourceStore };
        const pending = await request({ barcode: 'SOURCE-NEW', productName: 'New source item', quantityChange: 1, noSn: false, snList: ['SRC000000001'], ...source });
        assert.equal((await claimCode('picker', command(second.workBarcode))).data.reason, 'BLOCKED');
        assert.equal((await api('admin', 'PATCH', `/api/orders/${second.orderId}/exceptions/${pending.id}/ack`, {})).status, 409);
        ok(await api('admin', 'PATCH', `/api/orders/${second.orderId}/exceptions/${pending.id}/reject`, {}));
        const foreign = await request({ barcode: 'SOURCE-FOREIGN', productName: 'Foreign item', quantityChange: 1, noSn: true, ...source, sourceStore: 'ANOTHER' });
        assert.equal((await api('admin', 'PATCH', `/api/orders/${second.orderId}/exceptions/${foreign.id}/ack`, {})).status, 409);
        ok(await api('admin', 'PATCH', `/api/orders/${second.orderId}/exceptions/${foreign.id}/reject`, {}));
        assert.equal((await api('dispatcher', 'POST', `/api/orders/${second.orderId}/defect`, { oldSn: 'SRC000000002', newSn: 'SRC000000001', reason: 'Synthetic collision' })).status, 409);
    });
    await t.test('each work order completes independently, with explicit pack claim and terminal-stage rejection', async () => {
        let snapshot = await read(first.orderId);
        for (const item of snapshot.items) {
            const serials = snapshot.instances.filter(i => i.order_item_id === item.id);
            if (serials.length) for (const sn of serials) ok(await scan(pickerRole, first.orderId, sn.serial_number, 'pick', { orderItemId: item.id }));
            else if (item.quantity > item.picked_quantity) ok(await scan(pickerRole, first.orderId, item.barcode, 'pick', { orderItemId: item.id, amount: item.quantity - item.picked_quantity }));
        }
        assert.equal((await read(first.orderId)).order.status, 'picked');
        assert.equal((await claimCode(pickerRole, command(first.workBarcode))).data.reason, 'STAGE_COMPLETE');
        assert.equal((await scan('packer', first.orderId, 'SOURCE-DUP', 'pack')).status, 409);
        const pack = ok(await claimCode('packer', command(first.workBarcode, 'pack'))); assert.equal(pack.owner.id, users.packer);
        snapshot = await read(first.orderId);
        for (const item of snapshot.items) {
            const serials = snapshot.instances.filter(i => i.order_item_id === item.id);
            if (serials.length) for (const sn of serials) ok(await scan('packer', first.orderId, sn.serial_number, 'pack', { orderItemId: item.id }));
            else ok(await scan('packer', first.orderId, item.barcode, 'pack', { orderItemId: item.id, amount: item.quantity }));
        }
        assert.equal((await read(first.orderId)).order.status, 'completed');
        assert.equal((await read(second.orderId)).order.status, 'picking');
        assert.equal((await scan('packer', first.orderId, 'SOURCE-DUP', 'pack', { amount: -1 })).status, 409);
        assert.equal((await claimCode('admin', command(first.workBarcode, 'pack'))).data.reason, 'STAGE_COMPLETE');
    });
    await t.test('task queries and audit/export projections preserve batch, source and operator metadata', async () => {
        const list = ok(await api('dispatcher', 'GET', '/api/tasks?pagination=cursor&q=SOURCE-PICK-1'));
        assert.equal(list.items.length, 2); assert.equal(list.items.every(o => o.batch_number === 'SOURCE-PICK-1' && o.work_barcode), true);
        const bySource = ok(await api('dispatcher', 'GET', '/api/tasks?pagination=cursor&q=ONE-200')); assert.equal(bySource.items[0].id, second.orderId);
        const legacyList = ok(await api('dispatcher', 'GET', '/api/tasks')); assert.equal(legacyList.find(o => o.id === second.orderId).picker_name, 'Synthetic picker');
        const logs = ok(await api('admin', 'GET', `/api/operation-logs?orderId=${first.orderId}`));
        assert.ok(Array.isArray(logs.logs)); assert.equal(logs.logs[0].batch_number, 'SOURCE-PICK-1');
    });
});
