// Full HTTP + PostgreSQL + Socket workflow. Fixed, disposable loopback server only.
// Run with WMS_PARITY_PG_TEST=1; no Render/GCP credentials are read.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const xlsx = require('xlsx');
const { io: socketClient } = require('socket.io-client');

test('warehouse workflows on real isolated PostgreSQL', { skip: process.env.WMS_PARITY_PG_TEST !== '1', timeout: 180000 }, async t => {
    const database = `wms_parity_${randomBytes(6).toString('hex')}`;
    const config = { host: '127.0.0.1', port: 55441, user: 'wms_replay', password: 'wms_replay_local_only', database: 'postgres' };
    const control = new Client(config);
    await control.connect();
    await control.query(`CREATE DATABASE "${database}"`);
    Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: '', PGHOST: config.host, PGPORT: String(config.port), PGUSER: config.user,
        PGPASSWORD: config.password, PGDATABASE: database, PGOPTIONS: '', JWT_SECRET: 'isolated-warehouse-parity-only', DB_POOL_MAX: '1',
        DB_SSL_MODE: 'disable', STORAGE_BACKEND: 'local', CORS_ORIGINS: 'http://127.0.0.1,http://127.0.0.1:5173', WMS_ECPAY_ACCOUNTS_JSON: '[]', WMS_ECPAY_CALLBACKS_ENABLED: 'false' });
    const { pool } = require('../src/config/database');
    const { runMigrations } = require('../src/maintenance/migrationRunner');
    const { assertSchemaReady } = require('../src/config/schemaReadiness');
    await runMigrations({ pool, targetDatabase: database });
    await assertSchemaReady(pool);
    await t.test('maintenance preview is read-only against real PostgreSQL', async () => {
        const client = await pool.connect();
        try {
            const { runRetention } = require('../src/maintenance/retention');
            const preview = await runRetention({ client, env: { WMS_TARGET_DATABASE: database } });
            assert.equal(preview.mode, 'preview');
            assert.deepEqual(preview.result, { operation_logs: 0, task_mentions: 0, comment_reads: 0, inactive_sessions: 0 });
            await assert.rejects(runRetention({ client, env: { WMS_TARGET_DATABASE: 'another_database', WMS_RETENTION_APPLY: 'true' } }), /TARGET_DATABASE_MISMATCH/);
        } finally { client.release(); }
    });

    const roles = ['superadmin', 'admin', 'dispatcher', 'picker', 'packer'];
    const users = {}, tokens = {};
    const password = 'fixture-warehouse-password';
    for (const role of roles) users[role] = (await pool.query('INSERT INTO users(username,password,name,role) VALUES($1,$2,$3,$4) RETURNING id',
        [`fixture_${role}`, await bcrypt.hash(password, 4), `Fixture ${role}`, role])).rows[0].id;
    const { app, server, io } = require('../src/app');
    const sockets = [];
    t.after(async () => {
        sockets.forEach(socket => socket.disconnect());
        await new Promise(resolve => io.close(resolve));
        await pool.end();
        await control.query(`DROP DATABASE "${database}"`);
        await control.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const requests = [];
    async function api(role, method, path, body) {
        const headers = tokens[role] ? { Authorization: `Bearer ${tokens[role]}` } : {};
        if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
        const response = await fetch(base + path, { method, headers, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
        const text = await response.text();
        let data; try { data = JSON.parse(text); } catch { data = text; }
        requests.push({ method, path: path.split('?')[0], status: response.status, role: role || 'anonymous' });
        return { status: response.status, data };
    }
    function ok(result, status = 200) { assert.equal(result.status, status, JSON.stringify(result.data)); return result.data; }
    const claim = (role, order) => api(role, 'POST', `/api/orders/${order}/claim`);
    const scan = (role, orderId, scanValue, type, amount = 1) => api(role, 'POST', '/api/orders/update_item', { orderId, scanValue, type, amount });
    async function importOrder(voucher, qty, serials = []) {
        const book = xlsx.utils.book_new();
        const rows = [['憑證號碼', voucher], ['客戶名稱', 'Synthetic customer'], ['品項編碼', '品項名稱', '數量', 'SN'], ['FIXTURE-BARCODE', 'Synthetic item', qty, serials.join('/')]];
        xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet(rows), '出貨單');
        const form = new FormData(); form.set('orderFile', new Blob([xlsx.write(book, { type: 'buffer', bookType: 'xlsx' })]), 'fixture.xlsx');
        return api('dispatcher', 'POST', '/api/orders/import', form);
    }
    await t.test('all five roles login and admin/dispatcher/warehouse boundaries are preserved', async () => {
        for (const role of roles) {
            const login = ok(await api(null, 'POST', '/api/auth/login', { username: `fixture_${role}`, password }));
            assert.equal(login.user.role, role); tokens[role] = login.accessToken;
            const list = ok(await api(role, 'GET', '/api/tasks?pagination=cursor'));
            assert.equal(list.summary.total, 0);
            assert.equal((await api(role, 'GET', '/api/admin/users')).status, ['admin', 'superadmin'].includes(role) ? 200 : 403);
        }
        assert.equal((await api(null, 'GET', '/api/tasks')).status, 401);
    });
    const observedEvents = [];
    await t.test('authenticated Socket connects and anonymous Socket is denied', async () => {
        const authorized = socketClient(base, { auth: { token: tokens.packer }, transports: ['websocket'], reconnection: false });
        sockets.push(authorized);
        authorized.onAny((event, body) => observedEvents.push({ event, body }));
        await new Promise((resolve, reject) => { authorized.once('connect', resolve); authorized.once('connect_error', reject); });
        const anonymous = socketClient(base, { transports: ['websocket'], reconnection: false }); sockets.push(anonymous);
        await new Promise((resolve, reject) => { anonymous.once('connect_error', resolve); anonymous.once('connect', () => reject(Error('Anonymous socket accepted'))); });
    });
    let bulkOrder, snOrder;
    await t.test('scientific barcode import returns its cell and leaves all order tables unchanged', async () => {
        const tables = ['orders', 'order_items', 'order_item_instances', 'operation_logs'];
        const counts = async () => Promise.all(tables.map(async table => (await pool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count));
        const before = await counts();
        const book = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet([
            ['憑證號碼', 'PARITY-BAD-BARCODE'], ['國際條碼', '品項名稱', '數量'],
            ['4711299273766', 'Valid text item', 1], [4711299273766, 'Numeric General item', 1]
        ]), '出貨');
        const form = new FormData(); form.set('orderFile', new Blob([xlsx.write(book, { type: 'buffer', bookType: 'xlsx' })]), 'fixture.xlsx');
        const result = ok(await api('dispatcher', 'POST', '/api/orders/import', form), 400);
        assert.equal(result.reason, 'INVALID_BARCODE_FORMAT');
        assert.equal(result.issue.cell, 'A4');
        assert.equal(result.issue.storedValue, '4711299273766');
        assert.deepEqual(await counts(), before);
    });
    await t.test('XLSX import, duplicate protection, role restriction and competing claim', async () => {
        const imported = ok(await importOrder('PARITY-BULK', 500), 201); bulkOrder = imported.orderId;
        assert.equal((await importOrder('PARITY-BULK', 500)).status, 409);
        assert.equal((await api('picker', 'POST', '/api/orders/import')).status, 403);
        assert.equal((await claim('dispatcher', bulkOrder)).status, 403);
        assert.equal((await claim('packer', bulkOrder)).status, 400);
        const claims = await Promise.all([claim('picker', bulkOrder), claim('admin', bulkOrder)]);
        assert.deepEqual(claims.map(x => x.status).sort(), [200, 400]);
        // Either authorized claimant can win; all scans below use its real role.
        bulkOrder = { id: bulkOrder, picker: claims[0].status === 200 ? 'picker' : 'admin' };
    });
    await t.test('500 picks and 500 packs cross the reported 50-scan boundary without pool starvation', async () => {
        for (const [stage, role] of [['pick', bulkOrder.picker], ['pack', 'packer']]) {
            if (stage === 'pack') ok(await claim(role, bulkOrder.id));
            const durations = [];
            for (let i = 0; i < 500; i++) {
                const started = performance.now();
                const snapshot = ok(await scan(role, bulkOrder.id, 'FIXTURE-BARCODE', stage));
                durations.push(performance.now() - started);
                assert.equal(snapshot.items[0][stage === 'pick' ? 'picked_quantity' : 'packed_quantity'], i + 1);
                if (i === 499) assert.equal(snapshot.order.status, stage === 'pick' ? 'picked' : 'completed');
            }
            const sorted = [...durations].sort((a,b) => a-b);
            t.diagnostic(JSON.stringify({ stage, requests: durations.length, poolMax: 1, p50Ms: sorted[249], p95Ms: sorted[474], maxMs: sorted[499], after50P95Ms: durations.slice(50).sort((a,b) => a-b)[427] }));
        }
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM operation_logs WHERE order_id=$1 AND action_type IN ('pick','pack')", [bulkOrder.id])).rows[0].n, 1000);
        assert.equal(pool.waitingCount, 0);
    });
    const serials = ['SN0000000001', 'SN0000000002', 'SN0000000003'];
    await t.test('SN normalization, concurrent duplicate rejection, wrong code and pack-before-pick protection', async () => {
        snOrder = ok(await importOrder('PARITY-SN', 3, serials), 201).orderId;
        ok(await claim('picker', snOrder));
        assert.notEqual((await scan('packer', snOrder, serials[0], 'pack')).status, 200);
        assert.notEqual((await scan('picker', snOrder, 'UNKNOWN', 'pick')).status, 200);
        const pair = await Promise.all([scan('picker', snOrder, `SN: ${serials[0].toLowerCase()}`, 'pick'), scan('picker', snOrder, serials[0], 'pick')]);
        assert.equal(pair.filter(x => x.status === 200).length, 1);
        for (const sn of serials.slice(1)) ok(await scan('picker', snOrder, sn, 'pick'));
        const actual = ok(await api('admin', 'GET', `/api/orders/${snOrder}`));
        assert.equal(actual.order.status, 'picked');
        assert.equal(actual.instances.filter(x => x.status === 'picked').length, 3);
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM operation_logs WHERE order_id=$1 AND action_type='scan_error'", [snOrder])).rows[0].n, 2);
        const audit = ok(await api('admin', 'GET', '/api/scan-errors'));
        assert.equal(audit.errors.length, 2);
    });
    await t.test('open exceptions block packing; only supervisors can acknowledge and resolve', async () => {
        const exception = ok(await api('picker', 'POST', `/api/orders/${snOrder}/exceptions`, { type: 'other', reasonText: 'Synthetic exception' }), 201);
        const exceptionId = exception.id || exception.exception?.id;
        assert.ok(exceptionId, JSON.stringify(exception));
        assert.equal((await claim('packer', snOrder)).status, 409);
        assert.equal((await api('picker', 'PATCH', `/api/orders/${snOrder}/exceptions/${exceptionId}/ack`, { note: 'Unauthorized' })).status, 403);
        ok(await api('admin', 'PATCH', `/api/orders/${snOrder}/exceptions/${exceptionId}/ack`, { note: 'Fixture approved' }));
        ok(await claim('packer', snOrder));
        for (const sn of serials) ok(await scan('packer', snOrder, sn, 'pack'));
        ok(await api('admin', 'PATCH', `/api/orders/${snOrder}/exceptions/${exceptionId}/resolve`, { note: 'Fixture resolved', resolutionAction: 'other' }));
    });
    await t.test('comments, read markers, task pins and announcements preserve collaboration', async () => {
        const comment = ok(await api('picker', 'POST', `/api/tasks/${snOrder}/comments`, { content: 'Fixture message', priority: 'important' }), 201);
        ok(await api('packer', 'GET', `/api/tasks/${snOrder}/comments?latest=50`));
        ok(await api('packer', 'POST', `/api/tasks/${snOrder}/comments/mark-read`, { commentIds: [comment.id] }));
        ok(await api('admin', 'PUT', `/api/tasks/pins/${snOrder}`, { pinned: true }));
        assert.equal((await api('picker', 'PUT', `/api/tasks/pins/${snOrder}`, { pinned: false })).status, 403);
        const post = ok(await api('dispatcher', 'POST', '/api/team/posts', { postType: 'announcement', title: 'Synthetic announcement', content: 'Fixture only' }), 201);
        ok(await api('picker', 'GET', `/api/team/posts/${post.id}`));
        ok(await api('picker', 'POST', `/api/team/posts/${post.id}/comments`, { content: 'Read by warehouse' }), 201);
        assert.ok(observedEvents.some(x => x.event === 'task_status_changed'));
        assert.ok(observedEvents.some(x => x.event === 'new_comment'));
    });
    await t.test('user management preserves roles, protects superadmin and refuses case-colliding logins', async () => {
        const create = username => api('superadmin', 'POST', '/api/admin/users', { username, password: 'synthetic-password-2', name: 'Synthetic member', role: 'picker' });
        const results = await Promise.all([create('CaseIdentity'), create('caseidentity')]);
        assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
        const member = results.find(r => r.status === 201).data.user;
        assert.equal(member.password, undefined);
        assert.equal((await api('admin', 'PUT', `/api/admin/users/${users.superadmin}`, { role: 'picker' })).status, 403);
        assert.equal((await api('admin', 'DELETE', `/api/admin/users/${users.superadmin}`)).status, 403);
        assert.equal((await api('admin', 'POST', '/api/admin/create-user', { username: 'unauthorized-super', password, name: 'Forbidden', role: 'superadmin' })).status, 403);
        ok(await api('superadmin', 'PUT', `/api/admin/users/${member.id}`, { name: 'Synthetic updated', role: 'packer' }));
        const login = ok(await api(null, 'POST', '/api/auth/login', { username: member.username.toUpperCase(), password: 'synthetic-password-2' }));
        assert.equal(login.user.role, 'packer');
        const refreshed = ok(await api(null, 'POST', '/api/auth/refresh', { token: login.accessToken }));
        assert.ok(refreshed.accessToken);
        ok(await api('superadmin', 'DELETE', `/api/admin/users/${member.id}`));
    });
    await t.test('both legacy batch claim endpoints keep their contracts and enforce single-task rules', async () => {
        const first = ok(await importOrder('PARITY-BATCH-A', 1), 201).orderId;
        const second = ok(await importOrder('PARITY-BATCH-B', 1), 201).orderId;
        const results = await Promise.all([
            api('picker', 'POST', '/api/orders/batch-claim', { orderIds: [first, first] }),
            api('admin', 'POST', '/api/orders/batch/claim', { orderIds: [first] })
        ]);
        ok(results[0]); ok(results[1]);
        assert.equal(results[0].data.orders.length + results[1].data.results.success.length, 1);
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM operation_logs WHERE order_id=$1 AND action_type='claim'", [first])).rows[0].n, 1);
        const earlyPack = ok(await api('packer', 'POST', '/api/orders/batch/claim', { orderIds: [first] }));
        assert.equal(earlyPack.results.success.length, 0);
        assert.equal((await pool.query('SELECT status FROM orders WHERE id=$1', [first])).rows[0].status, 'picking');
        const picker = results[0].data.orders.length ? 'picker' : 'admin';
        ok(await scan(picker, first, 'FIXTURE-BARCODE', 'pick'));
        const packedClaim = ok(await api('packer', 'POST', '/api/orders/batch/claim', { orderIds: [first] }));
        assert.deepEqual(packedClaim.results.success, [first]);
        const blocked = ok(await api('picker', 'POST', `/api/orders/${second}/exceptions`, { type: 'order_change', reasonText: 'Synthetic pending change', snapshot: { proposal: { note: 'Synthetic pending change', items: [{ barcode: 'FIXTURE-BARCODE', productName: 'Synthetic item', quantityChange: 1, noSn: true }] } } }), 201);
        assert.ok(blocked.id);
        assert.equal(ok(await api('picker', 'POST', '/api/orders/batch-claim', { orderIds: [second] })).orders.length, 0);
        assert.equal((await api('dispatcher', 'POST', '/api/orders/batch/claim', { orderIds: [second] })).status, 403);
        ok(await api('admin', 'PATCH', `/api/orders/${second}/exceptions/${blocked.id}/ack`, { note: 'Synthetic quantity approval' }));
        assert.equal((await pool.query('SELECT quantity FROM order_items WHERE order_id=$1', [second])).rows[0].quantity, 2);
        assert.equal((await api('admin', 'PATCH', `/api/orders/${second}/exceptions/${blocked.id}/ack`, { note: 'Duplicate approval' })).status, 409);
        assert.equal((await pool.query('SELECT quantity FROM order_items WHERE order_id=$1', [second])).rows[0].quantity, 2);
        const reject = ok(await api('picker', 'POST', `/api/orders/${second}/exceptions`, { type: 'other', reasonText: 'Synthetic reject' }), 201);
        ok(await api('admin', 'PATCH', `/api/orders/${second}/exceptions/${reject.id}/reject`, { note: 'Synthetic rejection' }));
        assert.equal((await pool.query('SELECT status FROM order_exceptions WHERE id=$1', [reject.id])).rows[0].status, 'rejected');

        assert.equal((await api('picker', 'POST', '/api/orders/batch-claim', { orderIds: Array(101).fill(first) })).status, 400);
        assert.equal((await api('picker', 'POST', '/api/orders/batch-claim', { orderIds: [{}] })).status, 400);
    });
    await t.test('SN defect exchange and task transfer complete with only one database connection', async () => {
        ok(await api('dispatcher', 'POST', `/api/orders/${snOrder}/defect`, { oldSn: serials[0], newSn: 'SN0000000004', reason: 'Synthetic defect exchange' }));
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM product_defects WHERE order_id=$1 AND new_sn=$2', [snOrder, 'SN0000000004'])).rows[0].n, 1);
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM operation_logs WHERE order_id=$1 AND action_type='defect_exchange'", [snOrder])).rows[0].n, 1);
        assert.equal((await api('dispatcher', 'POST', `/api/orders/${snOrder}/defect`, { oldSn: 'SN0000000004', newSn: serials[1], reason: 'Duplicate target' })).status, 409);
        await pool.query("CREATE FUNCTION reject_test_defect() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='sn_replace' THEN RAISE EXCEPTION 'Synthetic storage failure'; END IF; RETURN NEW; END $$");
        await pool.query('CREATE TRIGGER reject_test_defect BEFORE INSERT ON order_exceptions FOR EACH ROW EXECUTE FUNCTION reject_test_defect()');
        assert.equal((await api('dispatcher', 'POST', `/api/orders/${snOrder}/defect`, { oldSn: 'SN0000000004', newSn: 'SN0000000005', reason: 'Rollback fixture' })).status, 500);
        await pool.query('DROP TRIGGER reject_test_defect ON order_exceptions');
        await pool.query('DROP FUNCTION reject_test_defect()');
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM product_defects WHERE order_id=$1', [snOrder])).rows[0].n, 1);
        const exchange = await Promise.all(['SN0000000005', 'SN0000000006'].map(newSn => api('dispatcher', 'POST', `/api/orders/${snOrder}/defect`, { oldSn: 'SN0000000004', newSn, reason: 'Concurrent fixture' })));
        assert.deepEqual(exchange.map(result => result.status).sort(), [200, 404]);
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM product_defects WHERE order_id=$1', [snOrder])).rows[0].n, 2);
        const currentSn = exchange[0].status === 200 ? 'SN0000000005' : 'SN0000000006';
        await pool.query("CREATE FUNCTION reject_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_type='defect_exchange' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$");
        await pool.query('CREATE TRIGGER reject_test_audit BEFORE INSERT ON operation_logs FOR EACH ROW EXECUTE FUNCTION reject_test_audit()');
        assert.equal((await api('dispatcher', 'POST', `/api/orders/${snOrder}/defect`, { oldSn: currentSn, newSn: 'SN0000000007', reason: 'Audit rollback fixture' })).status, 500);
        await pool.query('DROP TRIGGER reject_test_audit ON operation_logs');
        await pool.query('DROP FUNCTION reject_test_audit()');
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM product_defects WHERE order_id=$1', [snOrder])).rows[0].n, 2);
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM order_item_instances WHERE serial_number=$1', ['SN0000000007'])).rows[0].n, 0);
        const transferOrder = ok(await importOrder('PARITY-TRANSFER', 2), 201).orderId;
        ok(await claim('picker', transferOrder));
        assert.equal((await api('packer', 'POST', `/api/tasks/${transferOrder}/transfer`, { to_user_id: users.admin, task_type: 'pick' })).status, 403);
        assert.equal((await api('picker', 'POST', `/api/tasks/${transferOrder}/transfer`, { to_user_id: users.packer, task_type: 'pick' })).status, 400);
        assert.equal((await api('picker', 'POST', `/api/tasks/${transferOrder}/transfer`, { to_user_id: users.admin, task_type: 'wrong' })).status, 400);

        ok(await api('picker', 'POST', `/api/tasks/${transferOrder}/transfer`, { to_user_id: users.admin, task_type: 'pick', reason: 'Synthetic shift handover' }));
        assert.equal((await pool.query('SELECT picker_id FROM orders WHERE id=$1', [transferOrder])).rows[0].picker_id, users.admin);
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM operation_logs WHERE order_id=$1 AND action_type='transfer'", [transferOrder])).rows[0].n, 1);
    });
    await t.test('void keeps reason and audit together, blocks further scans, and delete honors role', async () => {
        const orderId = ok(await importOrder('PARITY-VOID', 1), 201).orderId;
        assert.equal((await api('picker', 'PATCH', `/api/orders/${orderId}/void`, { reason: 'Forbidden' })).status, 403);
        ok(await api('admin', 'PATCH', `/api/orders/${orderId}/void`, { reason: 'Synthetic cancellation' }));
        assert.deepEqual((await pool.query('SELECT status,void_reason FROM orders WHERE id=$1', [orderId])).rows[0], { status: 'voided', void_reason: 'Synthetic cancellation' });
        assert.notEqual((await scan('picker', orderId, 'FIXTURE-BARCODE', 'pick')).status, 200);
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM operation_logs WHERE order_id=$1 AND action_type='void'", [orderId])).rows[0].n, 1);
        assert.equal((await api('picker', 'DELETE', `/api/orders/${orderId}`)).status, 403);
        ok(await api('dispatcher', 'DELETE', `/api/orders/${orderId}`));
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM orders WHERE id=$1', [orderId])).rows[0].n, 0);
    });
    await require('./legacy-feature-flows.cjs')({ t, api, ok, pool, users, importOrder, observedEvents, snOrder });
    if (process.env.WMS_PARITY_BROWSER === '1') await require('./legacy-browser.cjs')({ t, api, ok, pool, users, tokens, base, output: process.env.WMS_PARITY_BROWSER_OUTPUT });
    await t.test('current DB role applies immediately even with old admin token', async () => {
        await pool.query("UPDATE users SET role='picker' WHERE id=$1", [users.admin]);
        assert.equal((await api('admin', 'GET', '/api/admin/users')).status, 403);
        const unused = (await pool.query("INSERT INTO users(username,password,name,role) VALUES('token_revoke_fixture',$1,'Revocation fixture','picker') RETURNING id", [await bcrypt.hash(password, 4)])).rows[0].id;
        tokens.revoked = ok(await api(null, 'POST', '/api/auth/login', { username: 'token_revoke_fixture', password })).accessToken;
        await pool.query('DELETE FROM users WHERE id=$1', [unused]);
        assert.equal((await api('revoked', 'GET', '/api/tasks')).status, 403);
    });
    await t.test('every legacy business route has an exercised successful mounted HTTP path', () => {
        const routes = require('../../docs/legacy-parity/legacy-routes.json');
        const excluded = routes.filter(r => r.file.endsWith('maintenanceRoutes.js') || ['/bootstrap/superadmin', '/maintenance/retention/run'].includes(r.path));
        const records = routes.filter(r => !excluded.includes(r)).map(route => {
            const file = route.file.split('/').pop();
            const prefix = file === 'authRoutes.js' ? '/api/auth' : file === 'userRoutes.js' ? '/api/admin/users'
                : ['adminRoutes.js', 'adminExceptionRoutes.js'].includes(file) ? '/api/admin' : '/api';
            const fullPath = prefix + (route.path === '/' ? '' : route.path);
            const regex = new RegExp('^' + fullPath.replace(/:[^/]+/g, '[^/]+') + '/?$');
            const matches = requests.filter(r => r.method === route.method && regex.test(r.path));
            return { method: route.method, path: fullPath, statuses: [...new Set(matches.map(r => r.status))].sort(), passed: matches.some(r => r.status >= 200 && r.status < 300) };
        });
        if (process.env.WMS_PARITY_REPORT) require('node:fs').writeFileSync(process.env.WMS_PARITY_REPORT, JSON.stringify({ kind: 'disposable_real_PostgreSQL_HTTP_coverage_not_all_UI_acceptance', records, excludedMaintenance: excluded, passed: records.every(r => r.passed) }, null, 2));
        assert.deepEqual(records.filter(r => !r.passed).map(r => r.method + ' ' + r.path), []);
    });

});
