const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { PGlite } = require('@electric-sql/pglite');

test('task search keeps lifecycle/ACL boundaries while distinguishing vouchers and actual completion dates', async t => {
    const db = new PGlite(), runtimeQueries = [];
    const pool = { query: async (text, values) => { runtimeQueries.push(text); return db.query(text, values); } };
    const configPath = require.resolve('../src/config/database'), original = require.cache[configPath];
    require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: { pool } };
    const app = express();
    app.use((req, res, next) => {
        const role = req.headers['x-test-role'] || 'admin';
        req.user = { id: 7, role, can_pick: role !== 'packer', can_pack: role !== 'picker' };
        next();
    });
    app.use('/api', require('../src/routes/taskRoutes'));
    const get = (query = {}, view = 'completed', role = 'admin') => request(app)
        .get(`/api/tasks${view === 'completed' ? '/completed' : ''}`)
        .query({ pagination: 'cursor', limit: '100', ...query }).set('x-test-role', role);
    const items = response => { assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body.items; };
    const ids = response => items(response).map(row => row.id).sort((a, b) => a - b);
    const add = (id, voucher, status, completedAt, owner = 7, customer = '台北 客戶', updatedAt = '2026-11-06T00:00:00Z') => db.query(
        `INSERT INTO orders(id,voucher_number,customer_name,status,picker_id,packer_id,created_at,updated_at,completed_at)
         VALUES($1,$2,$3,$4,$5,$5,'2026-10-01T00:00:00Z',$6,$7)`, [id, voucher, customer, status, owner, updatedAt, completedAt]);
    try {
        await db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT,username TEXT);
            CREATE TABLE orders(id INTEGER PRIMARY KEY,voucher_number TEXT,customer_name TEXT,status TEXT,document_type TEXT,
                picker_id INTEGER,packer_id INTEGER,pick_paused_at TIMESTAMPTZ,pack_paused_at TIMESTAMPTZ,is_urgent BOOLEAN DEFAULT false,
                created_at TIMESTAMPTZ,updated_at TIMESTAMPTZ,completed_at TIMESTAMPTZ);
            CREATE TABLE operation_logs(id INTEGER PRIMARY KEY,order_id INTEGER,user_id INTEGER,action_type TEXT,created_at TIMESTAMPTZ);
            CREATE TABLE task_comments(id INTEGER PRIMARY KEY,order_id INTEGER,user_id INTEGER,content TEXT,priority TEXT,created_at TIMESTAMPTZ);
            CREATE TABLE task_comment_reads(comment_id INTEGER,user_id INTEGER);
            CREATE TABLE order_exceptions(id INTEGER PRIMARY KEY,order_id INTEGER,type TEXT,status TEXT,snapshot JSONB);
            CREATE TABLE task_pins(order_id INTEGER);
            INSERT INTO users VALUES(7,'合成操作員','synthetic.seven'),(8,'其它操作員','synthetic.eight');`);
        await add(1, ' 2026/10/22-01 ', 'completed', '2026-10-21T16:00:00Z');
        await add(2, '20261022-02', 'completed', '2026-10-23T00:00:00Z');
        await add(3, 'OTHER-03', 'completed', '2026-10-22T15:59:59.999999Z');
        await add(4, '20261022-04', 'packing', null);
        await add(5, '20261022-05', 'pending', null);
        await add(6, '20261022-06', 'voided', '2026-10-22T00:00:00Z');
        await add(7, '2026/10/22-07', 'picked', null);
        await add(8, 'LEGACY-08', 'completed', null, 7, '舊完成資料', '2026-10-22T00:00:00Z');
        await add(9, '000123', 'pending', null, null);
        await add(10, '123', 'pending', null, null);
        await add(11, '000123-X', 'pending', null, null);
        await add(12, 'CUSTOMER-ONLY', 'pending', null, null, '000123');
        await add(13, 'PERCENT%_\\', 'pending', null, null);
        await add(14, '20261022-14', 'completed', '2026-10-22T01:00:00Z', 8);
        await add(15, 'HISTORY-15', 'completed', '2026-10-22T02:00:00Z', 8);
        await add(16, 'BEFORE-16', 'completed', '2026-10-21T15:59:59.999999Z');
        await add(17, 'AFTER-17', 'completed', '2026-10-22T16:00:00Z');
        await add(18, '2026/10/22-019', 'pending', null);
        await add(19, '2026/10/22-19', 'pending', null);
        await add(20, '2026-10-22-19', 'pending', null);
        await db.exec("INSERT INTO operation_logs VALUES(1,15,7,'pack','2026-10-22T02:00:00Z'),(2,4,7,'pack','2026-11-06T00:00:00Z'),(3,6,7,'pack','2026-10-22T00:00:00Z')");

        await t.test('the historical zero-result trigger is the explicit update date, not unsupported 20261022 syntax', async () => {
            const withoutDate = ids(await get({ q: '20261022' }));
            assert.deepEqual(withoutDate, [1, 2, 3, 4, 7, 14, 15]);
            assert.deepEqual(ids(await get({ q: '20261022', date: '2026-11-07' })), []);
            assert.deepEqual(ids(await get({ q: '20261022', date: '2026-11-06' })), withoutDate);
        });
        await t.test('normalizes complete calendar-date tokens and ANDs the customer without widening lifecycle scope', async () => {
            for (const q of ['20261022', '2026/10/22', '2026-10-22', '２０２６１０２２']) {
                assert.deepEqual(ids(await get({ q: `${q} 台北` })), [1, 2, 3, 4, 7, 14, 15]);
                assert.deepEqual(ids(await get({ q }, 'active')), [4, 5, 7, 18, 19, 20]);
            }
            assert.deepEqual(ids(await get({ q: '20261022 不存在客戶' })), []);
            assert.deepEqual(ids(await get({ q: '2026/10/22 - 19 台北' }, 'active')), [19, 20]);
        });
        await t.test('explicit completion dates use completed_at, preserve the default update-date contract and include Taipei microseconds', async () => {
            for (const zone of ['UTC', 'Asia/Taipei', 'America/Los_Angeles']) {
                await db.exec(`SET TIME ZONE '${zone}'`);
                assert.deepEqual(ids(await get({ date: '2026-10-22', dateType: 'completed' })), [1, 3, 14, 15]);
                assert.deepEqual(ids(await get({ date: '2026-10-22' })), [8]);
                assert.deepEqual(ids(await get({ q: '20261022', dateType: 'completed' })), [1, 2, 3, 4, 7, 14, 15], 'dateType without a date must not hide picked/packing');
            }
        });
        await t.test('returned completion time is recorded completion, never a later update or a partially packed order', async () => {
            const result = items(await get({ q: '2026/10/22-01' }))[0];
            assert.equal(new Date(result.completed_at).toISOString(), '2026-10-21T16:00:00.000Z');
            assert.equal(new Date(result.updated_at).toISOString(), '2026-11-06T00:00:00.000Z');
            for (const id of [4, 7, 8]) {
                const record = items(await get()).find(row => row.id === id);
                assert.equal(record.completed_at, null);
            }
            const legacy = await request(app).get('/api/tasks/completed').set('x-test-role', 'admin');
            assert.equal(legacy.status, 200);
            assert.equal(new Date(legacy.body.find(row => row.id === 1).completed_at).toISOString(), '2026-11-06T00:00:00.000Z', 'legacy array clients retain their original field semantics');
            assert.equal(Object.hasOwn(legacy.body[0], 'updated_at'), false);
        });
        await t.test('pack audit events and completed orders remain separate even after a void or a partial pack', async () => {
            const events = (await db.query("SELECT order_id FROM operation_logs WHERE action_type='pack' ORDER BY order_id")).rows.map(row => row.order_id);
            assert.deepEqual(events, [4, 6, 15]);
            const done = ids(await get({ q: '20261022', status: 'completed' }));
            assert.deepEqual(done, [1, 2, 3, 14, 15]);
            assert.ok(!done.includes(4) && !done.includes(6));
        });
        await t.test('exact mode preserves leading zeros and punctuation and never matches customers or internal IDs', async () => {
            assert.deepEqual(ids(await get({ q: '000123', match: 'exact' }, 'active')), [9]);
            assert.deepEqual(ids(await get({ q: '１２３', match: 'exact' }, 'active')), [10]);
            assert.deepEqual(ids(await get({ q: '9', match: 'exact' }, 'active')), []);
            assert.deepEqual(ids(await get({ q: '2026/10/22-19', match: 'exact' }, 'active')), [19]);
            assert.deepEqual(ids(await get({ q: '2026102219', match: 'exact' }, 'active')), []);
            assert.deepEqual(ids(await get({ q: '20261022', match: 'exact' })), [], 'exact dates are voucher literals only');
            assert.deepEqual(ids(await get({ q: '2026/10/22-01', match: 'exact' })), [1], 'outer whitespace is not an identity difference');
            assert.deepEqual(ids(await get({ q: '000123' }, 'active')), [9, 11, 12]);
        });
        await t.test('stage, ownership/history, role and status restrictions remain in force during smart/exact searches', async () => {
            assert.deepEqual(ids(await get({ q: '20261022' }, 'completed', 'picker')), [1, 2, 3, 4, 7, 15]);
            assert.deepEqual(ids(await get({ q: '20261022-14', match: 'exact' }, 'completed', 'picker')), []);
            assert.deepEqual(ids(await get({ q: '20261022', stage: 'pack' }, 'active')), [4, 7]);
            assert.deepEqual(ids(await get({ q: '20261022', stage: 'pick' }, 'active')), [5, 18, 19, 20]);
            assert.deepEqual(ids(await get({ q: '20261022', status: 'completed' }, 'active')), []);
        });
        await t.test('LIKE symbols and SQL-looking input stay literal; invalid input fails before data queries', async () => {
            assert.deepEqual(ids(await get({ q: '%_\\' }, 'active')), [13]);
            assert.deepEqual(ids(await get({ q: "' OR 1=1 --" }, 'active')), []);
            for (const query of [{ match: 'exact', q: '' }, { match: 'wild' }, { match: ['exact', 'smart'] },
                { dateType: 'invalid' }, { date: '2026-02-30' }, { q: ['a', 'b'] }, { q: '1 2 3 4 5 6 7 8 9' }]) {
                assert.equal((await get(query)).status, 400, JSON.stringify(query));
            }
            assert.equal((await get({ dateType: 'completed' }, 'active')).status, 400);
        });
        await t.test('server-side search and keyset still cover rows beyond the first page, with new modes bound to cursor scope', async () => {
            for (let index = 0; index < 75; index++) await add(1000 + index, `MANY-${index}`, 'completed', '2026-10-22T01:00:00.123456Z', 7, '分頁客戶');
            assert.deepEqual(ids(await get({ q: 'MANY-74' })), [1074]);
            const all = [], query = { q: '20261022 分頁客戶', limit: '17' };
            let cursor, firstCursor;
            do {
                const response = await get({ ...query, ...(cursor ? { cursor } : {}) });
                all.push(...ids(response)); cursor = response.body.nextCursor;
                firstCursor ||= cursor;
            } while (cursor);
            assert.equal(all.length, 75); assert.equal(new Set(all).size, 75);
            assert.equal((await get({ ...query, cursor: firstCursor, match: 'exact' })).status, 400);
            assert.equal((await get({ ...query, cursor: firstCursor, dateType: 'completed' })).status, 400);
            assert.equal((await get({ ...query, cursor: firstCursor }, 'completed', 'picker')).status, 400);
        });
        await t.test('the task endpoints only issue read queries', async () => {
            assert.ok(runtimeQueries.every(text => /^\s*(SELECT|WITH)\b/.test(text)));
            assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM orders')).rows[0].count, 95);
        });
    } finally {
        if (original) require.cache[configPath] = original; else delete require.cache[configPath];
        await db.close();
    }
});
