const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { PGlite } = require('@electric-sql/pglite');
const { accessLogFormat } = require('../src/utils/accessLogFormat');

test('operation log queries preserve permissions, literal search and stable Taipei pagination', async t => {
    const db = new PGlite(), queries = [];
    const pool = { query: async (query, values) => {
        const text = typeof query === 'object' ? query.text : query;
        queries.push({ text, values: typeof query === 'object' ? query.values : values });
        return db.query(text, typeof query === 'object' ? query.values : values);
    } };
    // Supply an in-memory fixture before importing routes; never load database.js
    // or .env, and never start the server/migration entry point.
    const configPath = require.resolve('../src/config/database');
    const oldConfig = require.cache[configPath], oldSecret = process.env.JWT_SECRET;
    require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: { pool, reportPool: pool } };
    process.env.JWT_SECRET = 'synthetic-operation-log-test-key-only';
    const { authenticateToken } = require('../src/middleware/auth');
    const app = express();
    app.use('/api', authenticateToken, require('../src/routes/analyticsRoutes'));
    const token = id => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const get = (query = {}, path = '/api/operation-logs', actor = 1) => request(app).get(path).query(query).set('Authorization', `Bearer ${token(actor)}`);
    const ids = response => { assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body.logs.map(row => row.id); };
    const add = (id, userId, orderId, action, details, at, snapshot = { name: '舊姓名', username: 'old.employee', role: 'picker' }, stage = null) =>
        db.query('INSERT INTO operation_logs VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, userId, orderId, action, details, at, snapshot, stage]);
    try {
        await db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,name TEXT,role TEXT,management_scope TEXT,can_pick BOOLEAN,can_pack BOOLEAN);
            CREATE TABLE orders(id INTEGER PRIMARY KEY,voucher_number TEXT,customer_name TEXT,status TEXT);
            CREATE TABLE operation_logs(id INTEGER PRIMARY KEY,user_id INTEGER,order_id INTEGER,action_type TEXT,details TEXT,created_at TIMESTAMPTZ,actor_snapshot JSONB,work_type TEXT);
            INSERT INTO users VALUES(1,'synthetic.manager','測試管理員','superadmin','all',true,true),(2,'current.employee','新姓名','picker','all',true,false);
            INSERT INTO orders VALUES(42,'20261106-12','萬摩客戶','picking'),(43,'2026/11/06-13','萬摩客戶','picking'),
                (44,'120045','數字單號客戶','pending'),(45,'20261107-1','其它客戶','completed'),
                (46,'PERCENT%_\\','Literal','pending'),(47,'CURSOR','分頁客戶','pending'),(123,'ID-ONLY','ID 客戶','pending');`);
        await add(1, 2, 42, 'pick', JSON.stringify({ serialNumber: 'SN-Mixed-001', scanRaw: 'SN:SN-Mixed-001' }), '2026-11-05T16:00:00Z');
        await add(2, 2, 42, 'pack', JSON.stringify({ barcode: '004711000000010' }), '2026-11-06T15:59:59.999999Z');
        await add(3, 2, 43, 'claim', '{}', '2026-11-06T09:00:00Z', undefined, 'pick');
        await add(4, 2, 45, 'pick', '{}', '2026-11-05T15:59:59.999999Z');
        await add(5, 2, 45, 'pack', '{}', '2026-11-06T16:00:00Z');
        await add(6, null, null, 'complete', 'historical free text', '2026-11-06T10:00:00Z', { name: '已離職', username: 'departed.employee' });
        await add(7, 2, 44, 'import', '{}', '2026-11-06T11:00:00Z');
        await add(8, 2, 46, 'pick', 'not JSON', '2026-11-06T11:00:01Z');
        await add(9, 2, 46, 'scan_error', '{"barcode":"\\u0000"}', '2026-11-06T11:00:02Z');
        await add(10, 2, 46, 'defect_exchange', '{"barcode":1e1000000}', '2026-11-06T11:00:03Z');
        await add(11, 2, 46, 'pick', JSON.stringify({ barcode: 'SAFE-CODE', reason: 'DO-NOT-SEARCH-RAW-DETAILS' }), '2026-11-06T11:00:04Z');
        await add(12, 2, 46, 'pick', JSON.stringify({ barcode: 'OVERSIZE-ONLY', padding: 'x'.repeat(66000) }), '2026-11-06T11:00:05Z');
        await add(13, 2, 46, 'defect_exchange', JSON.stringify({ oldSn: 'OLD-UNIT-001', newSn: 'NEW-UNIT-002' }), '2026-11-06T11:00:06Z');
        await add(14, 2, 123, 'import', '{}', '2026-11-06T11:00:07Z');
        for (let i = 0; i < 10; i++) await add(100 + i, 2, 47, 'pick', '{}', `2026-11-06T12:00:00.${String(123450 + Math.floor(i / 2)).padStart(6, '0')}Z`);

        await t.test('requires a current manager; revoked roles and unauthenticated callers cannot read logs or stats', async () => {
            for (const path of ['/api/operation-logs', '/api/operation-logs/stats']) {
                assert.equal((await request(app).get(path)).status, 401);
                assert.equal((await get({}, path, 2)).status, 403);
            }
            await db.exec("UPDATE users SET role='picker' WHERE id=1");
            assert.equal((await get()).status, 403);
            await db.exec("UPDATE users SET role='superadmin' WHERE id=1");
            const result = await get();
            assert.equal(result.headers['cache-control'], 'private, no-store');
            assert.equal(ids(result).length, 24);
            assert.equal(result.body.total, result.body.logs.length);
        });
        await t.test('ANDs adjacent terms across historical/current name, account, customer and Chinese work stage', async () => {
            assert.deepEqual(ids(await get({ q: '舊姓名 萬摩 揀貨' })), [3, 1]);
            assert.deepEqual(ids(await get({ q: '新姓名 萬摩 裝貨' })), [2]);
            assert.deepEqual(ids(await get({ q: 'old.employee 萬摩 認領' })), [3]);
            assert.deepEqual(ids(await get({ q: 'current.employee 萬摩' })), [2, 3, 1]);
            assert.deepEqual(ids(await get({ q: '已離職' })), [6]);
            assert.deepEqual(ids(await get({ q: '舊姓名 不存在的客戶' })), []);
        });
        await t.test('normalizes ERP separators/fullwidth dates but q dates do not silently become operation dates', async () => {
            for (const q of ['20261106-12', '2026/11/06-12', '2026-11-06-12', '２０２６１１０６—１２', '2026/11/06 -12', '2026/11/06 - 12']) {
                assert.deepEqual(ids(await get({ q })), [2, 1], q);
            }
            for (const q of ['20261106', '2026/11/06', '2026-11-06']) assert.deepEqual(ids(await get({ q })), [2, 3, 1]);
            assert.deepEqual(ids(await get({ q: '120045' })), [7]);
            assert.deepEqual(ids(await get({ q: '123' })), [14]);
            assert.deepEqual(ids(await get({ orderId: '42' })), [2, 1]);
            assert.deepEqual(ids(await get({ orderId: '2026/11/06-12' })), [2, 1]);
            assert.deepEqual(ids(await get({ orderId: '120045' })), [], 'legacy numeric orderId remains a DB ID');
        });
        await t.test('wildcards, backslashes and SQL text are literal rather than query syntax', async () => {
            assert.deepEqual(ids(await get({ q: '%_\\' })), [13, 12, 11, 10, 9, 8]);
            assert.deepEqual(ids(await get({ q: "' OR 1=1 --" })), []);
            for (const q of ['constructor', '__proto__', 'toString']) assert.deepEqual(ids(await get({ q })), []);
        });
        await t.test('known scan fields are searchable without casting malformed TEXT or scanning arbitrary details', async () => {
            for (const [q, wanted] of [['sn-mixed-001', [1]], ['004711000000010', [2]], ['SAFE-CODE', [11]], ['OLD-UNIT-001', [13]], ['NEW-UNIT-002', [13]]]) {
                assert.deepEqual(ids(await get({ q })), wanted);
            }
            for (const q of ['DO-NOT-SEARCH-RAW-DETAILS', 'OVERSIZE-ONLY', 'not JSON']) assert.deepEqual(ids(await get({ q })), []);
        });
        await t.test('Taipei dates include midnight and final microsecond, independent of connection timezone', async () => {
            for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Taipei']) {
                await db.exec(`SET TIME ZONE '${zone}'`);
                const found = ids(await get({ startDate: '2026-11-06', endDate: '2026-11-06' }));
                assert.ok(found.includes(1)); assert.ok(found.includes(2));
                assert.ok(!found.includes(4)); assert.ok(!found.includes(5));
                assert.equal(found.length, 22);
            }
        });
        await t.test('stats share all filters, ignore page limit/cursor and return the existing shape', async () => {
            const filters = { q: '舊姓名 萬摩', workType: 'pick', userId: '2', startDate: '2026-11-06', endDate: '2026-11-06' };
            assert.deepEqual(ids(await get(filters)), [3, 1]);
            const stats = await get({ ...filters, limit: '-1', cursor: ['bad', 'also-bad'] }, '/api/operation-logs/stats');
            assert.equal(stats.status, 200, JSON.stringify(stats.body));
            assert.equal(stats.headers['cache-control'], 'private, no-store');
            assert.equal(stats.body.total, 2);
            assert.deepEqual(stats.body.byActionType.map(row => row.action_type).sort(), ['claim', 'pick']);
            assert.ok(stats.body.byActionType.every(row => Number(row.count) === 1 && Number(row.unique_users) === 1 && Number(row.unique_orders) === 1));
            assert.equal((await get({ ...filters, actionType: 'pick' }, '/api/operation-logs/stats')).body.total, 1);
            assert.deepEqual((await get({ q: 'no-such-customer' }, '/api/operation-logs/stats')).body, { total: 0, byActionType: [] });
        });
        await t.test('keyset preserves ties/microseconds and does not duplicate rows when new logs arrive', async () => {
            const expected = ids(await get({ q: 'CURSOR', limit: '100' }));
            let result = await get({ q: 'CURSOR', limit: '2' }), actual = ids(result);
            const firstCursor = result.body.nextCursor;
            assert.ok(firstCursor); assert.ok(!Object.hasOwn(result.body.logs[0], 'cursor_created_at'));
            await add(1000, 2, 47, 'pick', '{}', '2026-11-07T00:00:00Z');
            while (result.body.nextCursor) {
                result = await get({ q: 'CURSOR', limit: '3', cursor: result.body.nextCursor });
                actual.push(...ids(result));
            }
            assert.deepEqual(actual, expected); assert.equal(new Set(actual).size, expected.length);
            assert.equal(result.body.nextCursor, null);
            assert.equal((await get({ q: 'different-filter', cursor: firstCursor })).status, 400);
        });
        await t.test('rejects malformed dates, repeated parameters and unbounded searches before SQL search', async () => {
            for (const query of [
                { startDate: '2026-02-30' }, { startDate: '2026-11-07', endDate: '2026-11-06' },
                { q: 'x'.repeat(201) }, { q: '1 2 3 4 5 6 7 8 9' }, { q: ['a', 'b'] },
                { userId: '1 OR 1=1' }, { workType: 'all' }, { actionType: ['pick', 'pack'] },
                { limit: '-1' }, { cursor: 'garbage' }, { cursor: ['a', 'b'] },
            ]) assert.equal((await get(query)).status, 400, JSON.stringify(query));
        });
        await t.test('all runtime queries are SELECT-only and the fixture keeps its audit records', async () => {
            assert.ok(queries.length > 40);
            assert.ok(queries.every(query => /^\s*SELECT\b/i.test(query.text)));
            assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM operation_logs')).rows[0].count, 25);
        });
        await t.test('canonical Chinese labels search exact actions and Chinese-only terms avoid JSON parsing', async () => {
            const labels = [['掃描異常', 'scan_error'], ['核可訂單異動', 'order_change_ack'], ['作廢', 'void'],
                ['建立例外', 'exception_create'], ['補正揀貨完成', 'picking_completion_reconcile']];
            for (const [index, [q, action]] of labels.entries()) {
                await add(2000 + index, 2, 47, action, '{}', '2026-11-07T01:00:00Z');
                assert.ok(ids(await get({ q })).includes(2000 + index));
                assert.ok(!queries.at(-1).text.includes('pg_input_is_valid'));
            }
        });
    } finally {
        if (oldConfig) require.cache[configPath] = oldConfig; else delete require.cache[configPath];
        if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
        await db.close();
    }
});

test('access logs preserve timings and status without search values', () => {
    const tokens = { method: () => 'GET', status: () => '200', 'response-time': () => '12.3', res: () => '512' };
    const output = accessLogFormat(tokens, { originalUrl: '/api/operation-logs?q=private-name&userId=23' }, {});
    assert.equal(output, 'GET /api/operation-logs 200 12.3 ms - 512');
    assert.ok(!output.includes('private-name')); assert.ok(!output.includes('userId'));
    assert.ok(!accessLogFormat(tokens, { originalUrl: '/API/Operation-Logs/STATS/?q=secret' }, {}).includes('secret'));
    assert.ok(accessLogFormat(tokens, { originalUrl: '/api/analytics?range=7days' }, {}).includes('?range=7days'));
});

test('optional stats use the reserved report pool and statement timeouts have an actionable safe response', async () => {
    const { createOperationLogRouter } = require('../src/routes/operationLogRoutes');
    const calls = { list: 0, stats: 0 };
    let timeout = false;
    const pool = kind => ({ query: async () => {
        calls[kind]++;
        if (timeout) throw Object.assign(new Error('private SQL/input must not escape'), { code: '57014' });
        return { rows: [] };
    } });
    const app = express();
    app.use((req, res, next) => { req.user = { id: 1, role: 'superadmin' }; next(); });
    app.use('/api', createOperationLogRouter({ pool: pool('list'), reportPool: pool('stats') }));
    for (const path of ['/api/operation-logs', '/api/operation-logs/stats']) assert.equal((await request(app).get(path)).status, 200);
    assert.deepEqual(calls, { list: 1, stats: 1 });
    timeout = true;
    for (const path of ['/api/operation-logs', '/api/operation-logs/stats']) {
        const response = await request(app).get(path);
        assert.equal(response.status, 503); assert.equal(response.body.code, 'OPERATION_LOG_QUERY_TIMEOUT');
        assert.match(response.body.message, /縮短日期範圍/);
        assert.ok(!JSON.stringify(response.body).includes('private'));
    }
});
