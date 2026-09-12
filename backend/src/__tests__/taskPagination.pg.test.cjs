// Synthetic PostgreSQL route integration; only a fixed disposable loopback DB.
// Uses TEMP tables on one connection, never migrations or existing WMS records.
// Run: node --test backend/src/__tests__/taskPagination.pg.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { Client } = require('pg');
const { parseTaskPage } = require('../utils/taskPagination');
const client = new Client({ host: '127.0.0.1', port: 55441, database: 'wms_scan_replay', user: 'wms_replay', password: 'wms_replay_local_only', connectionTimeoutMillis: 3000 });
const originalLoad = Module._load;
Module._load = function (name, ...args) {
    if (name === '../config/database') return { pool: { query: (...params) => client.query(...params) } };
    if (name === '../utils/logger') return { debug() {}, info() {}, error() {} };
    return originalLoad.call(this, name, ...args);
};
const router = require('../routes/taskRoutes');
Module._load = originalLoad;
async function request(query = {}, { view = 'active', role = 'admin', id = 7 } = {}) {
    const handler = router.stack.find(layer => layer.route?.path === `/tasks${view === 'completed' ? '/completed' : ''}`).route.stack[0].handle;
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ user: { id, role }, query }, response);
    return response;
}
test.before(async () => {
    await client.connect();
    await client.query(`
        CREATE TEMP TABLE users (id int PRIMARY KEY, name text, username text);
        CREATE TEMP TABLE orders (id int PRIMARY KEY, voucher_number text, customer_name text, status text, picker_id int, packer_id int, is_urgent bool DEFAULT false, created_at timestamptz, updated_at timestamptz);
        CREATE TEMP TABLE operation_logs (id int PRIMARY KEY, order_id int, user_id int, action_type text, created_at timestamptz);
        CREATE TEMP TABLE task_comments (id int PRIMARY KEY, order_id int, user_id int, content text, priority text, created_at timestamptz);
        CREATE TEMP TABLE task_comment_reads (comment_id int, user_id int);
        CREATE TEMP TABLE task_pins (order_id int);
        INSERT INTO users VALUES (7, 'Operator Seven', 'seven'), (8, 'Other Operator', 'eight');
        INSERT INTO orders SELECT i, '2026/09/09-' || lpad(i::text, 4, '0'), CASE WHEN i=250 THEN '台北 客戶' ELSE 'Fixture' END, 'pending', NULL, NULL, false, '2026-09-09 00:00:00.123456+00', '2026-09-09 00:00:00.123456+00' FROM generate_series(1, 500) i;
        INSERT INTO orders SELECT i, 'DONE-' || i, CASE WHEN i=1250 THEN '完成第250筆' ELSE 'Completed Fixture' END, 'completed', 7, 8, false, '2026-09-08 00:00:00+00', '2026-09-09 00:00:00.123456+00' FROM generate_series(1001, 1250) i;
        INSERT INTO orders VALUES (2001,'OWN-PICK','Fixture','picking',7,NULL,false,'2026-09-09+00','2026-09-09+00'), (2002,'OTHER-PICK','Fixture','picking',8,NULL,false,'2026-09-09+00','2026-09-09+00'), (2003,'OWN-PACK','Fixture','packing',7,7,false,'2026-09-09+00','2026-09-09+00'), (2004,'READY-PACK','Fixture','picked',8,NULL,true,'2026-09-09+00','2026-09-09+00');
        INSERT INTO task_pins VALUES (500);
        INSERT INTO operation_logs VALUES (1, 499, 7, 'import', '2026-09-09+00');
    `);
});
test.after(async () => { await client.end(); });

test('legacy routes still return arrays and completed retains its old limit', async () => {
    const active = await request();
    assert.equal(active.statusCode, 200);
    assert.equal(Array.isArray(active.body), true);
    assert.equal(active.body.length, 504);
    const completed = await request({ limit: '200', date: '2026-09-09' }, { view: 'completed' });
    assert.equal(completed.statusCode, 200);
    assert.equal(Array.isArray(completed.body), true);
    assert.equal(completed.body.length, 200);
});
test('keyset traverses all matching completed rows past 200 with identical microsecond timestamps', async () => {
    const ids = []; let cursor;
    do {
        const res = await request({ pagination: 'cursor', limit: '50', date: '2026-09-09', status: 'completed', ...(cursor ? { cursor } : {}) }, { view: 'completed' });
        assert.equal(res.statusCode, 200, JSON.stringify(res.body));
        assert.ok(res.body.items.length <= 50);
        ids.push(...res.body.items.map(item => item.id));
        cursor = res.body.nextCursor;
    } while (cursor);
    assert.deepEqual(ids, Array.from({ length: 250 }, (_, i) => i + 1001));
});
test('server search finds completed row 250 and combines date, status, customer/order terms', async () => {
    const completed = await request({ pagination: 'cursor', q: '1250 完成第250筆', date: '2026-09-09', status: 'completed' }, { view: 'completed' });
    assert.equal(completed.statusCode, 200, JSON.stringify(completed.body));
    assert.deepEqual(completed.body.items.map(row => row.id), [1250]);
    const active = await request({ pagination: 'cursor', q: '台北 ２０２６０９０９０２５０', status: 'pending', date: '2026-09-09' });
    assert.equal(active.statusCode, 200, JSON.stringify(active.body));
    assert.deepEqual(active.body.items.map(row => row.id), [250]);
    const literal = await request({ pagination: 'cursor', q: '%' });
    assert.equal(literal.body.items.length, 0, 'wildcards must be searched literally');
});
test('role constraints cannot be widened by a status filter', async () => {
    for (const role of ['picker', 'packer']) {
        const own = await request({ pagination: 'cursor', q: 'OWN' }, { role });
        assert.deepEqual(own.body.items.map(row => row.id), role === 'picker' ? [2001] : [2003]);
    }
    const denied = await request({ pagination: 'cursor', status: 'packing' }, { role: 'picker' });
    assert.deepEqual(denied.body.items, []);
    const completedOther = await request({ pagination: 'cursor', q: 'DONE' }, { role: 'packer', view: 'completed' });
    assert.deepEqual(completedOther.body.items, []);
});
test('shared pins and dispatcher imports precede remaining pages; urgent filter is server-side', async () => {
    const admin = await request({ pagination: 'cursor', limit: '2' });
    assert.deepEqual(admin.body.items.map(row => row.id), [500, 2004]);
    const dispatcher = await request({ pagination: 'cursor', limit: '2' }, { role: 'dispatcher' });
    assert.deepEqual(dispatcher.body.items.map(row => row.id), [499, 500]);
    const urgent = await request({ pagination: 'cursor', urgent: 'true' });
    assert.deepEqual(urgent.body.items.map(row => row.id), [2004]);
    assert.equal(urgent.body.hasMore, false);
});
test('cursor is bound to role/user/query and bad input returns an actionable 400', async () => {
    const first = await request({ pagination: 'cursor' });
    assert.equal((await request({ pagination: 'cursor', cursor: first.body.nextCursor, q: 'changed' })).statusCode, 400);
    assert.equal((await request({ pagination: 'cursor', cursor: first.body.nextCursor }, { role: 'picker' })).statusCode, 400);
    assert.equal((await request({ pagination: 'cursor', cursor: 'not-json' })).statusCode, 400);
    assert.equal((await request({ pagination: 'cursor', date: '2026-02-30' })).statusCode, 400);
    assert.equal((await request({ pagination: 'cursor', q: ['array'] })).statusCode, 400);
    assert.equal(parseTaskPage({ id: 7, role: 'admin' }, { limit: '9999' }, 'active').limit, 100);
});
test('active page traversal is bounded and does not lose or duplicate rows', async () => {
    let cursor; const ids = [];
    do {
        const res = await request({ pagination: 'cursor', limit: '37', ...(cursor ? { cursor } : {}) });
        assert.equal(res.statusCode, 200, JSON.stringify(res.body));
        assert.ok(res.body.items.length <= 37);
        ids.push(...res.body.items.map(item => item.id)); cursor = res.body.nextCursor;
    } while (cursor);
    assert.equal(ids.length, 504);
    assert.equal(new Set(ids).size, 504);
});


test('Taiwan midnight boundaries are inclusive/exclusive on the timestamp parameters for both views', async () => {
    const times = ['2026-09-08 15:59:59.999999+00', '2026-09-08 16:00:00+00', '2026-09-09 15:59:59.999999+00', '2026-09-09 16:00:00+00'];
    const createdIds = [];
    try {
        for (const [view, base] of [['active', 4000], ['completed', 5000]]) {
            for (let i = 0; i < times.length; i++) {
                const id = base + i;
                await client.query('INSERT INTO orders (id, voucher_number, customer_name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$5)', [id, `TZBOUND-${id}`, 'Timezone fixture', view === 'completed' ? 'completed' : 'pending', times[i]]);
                createdIds.push(id);
            }
            const res = await request({ pagination: 'cursor', date: '2026-09-09', q: 'TZBOUND' }, { view });
            assert.equal(res.statusCode, 200, JSON.stringify(res.body));
            assert.deepEqual(res.body.items.map(row => row.id).sort(), [base + 1, base + 2]);
        }
    } finally {
        await client.query('DELETE FROM orders WHERE id = ANY($1::int[])', [createdIds]);
    }
});

test('card counts cover all authorized matches independently of page and selected group', async () => {
    const first = await request({ pagination: 'cursor', limit: '2', group: 'pick' });
    assert.equal(first.statusCode, 200, JSON.stringify(first.body));
    assert.deepEqual(first.body.summary, { total: 504, pick: 502, pack: 2, inProgress: 3, mine: 0, picked: 2, done: 0 });
    assert.equal(first.body.countScope, 'filtered');
    assert.equal(first.body.items.length, 2);
    const next = await request({ pagination: 'cursor', limit: '2', group: 'pick', cursor: first.body.nextCursor });
    assert.deepEqual(next.body.summary, first.body.summary);
    assert.ok(next.body.items.every(row => ['pending', 'picking'].includes(row.status)));
    assert.equal((await request({ pagination: 'cursor', limit: '2', group: 'pack', cursor: first.body.nextCursor })).statusCode, 400);
    const busy = await request({ pagination: 'cursor', group: 'inProgress' });
    assert.deepEqual(busy.body.items.map(row => row.id), [2001, 2002, 2003]);
    const empty = await request({ pagination: 'cursor', group: 'done' });
    assert.deepEqual(empty.body.items, []);
    assert.equal(empty.body.summary.total, 504);
    assert.equal((await request({ pagination: 'cursor', group: 'invalid' })).statusCode, 400);
});

test('card counts and membership respect search, status, urgent, completed date and role', async () => {
    for (const [role, total, own] of [['picker', 501, 2001], ['packer', 2, 2003], ['dispatcher', 504, 499]]) {
        const response = await request({ pagination: 'cursor', group: 'mine' }, { role });
        assert.equal(response.body.summary.total, total);
        assert.equal(response.body.summary.mine, 1);
        assert.deepEqual(response.body.items.map(row => row.id), [own]);
    }
    const forbidden = await request({ pagination: 'cursor', group: 'pack' }, { role: 'picker' });
    assert.equal(forbidden.body.summary.pack, 0);
    assert.deepEqual(forbidden.body.items, []);
    const urgent = await request({ pagination: 'cursor', urgent: 'true' });
    assert.equal(urgent.body.summary.total, 1);
    const match = await request({ pagination: 'cursor', q: 'OWN', status: 'picking' });
    assert.equal(match.body.summary.total, 1);
    const completed = await request({ pagination: 'cursor', date: '2026-09-09', group: 'done' }, { view: 'completed', role: 'picker' });
    assert.equal(completed.body.summary.total, 251);
    assert.equal(completed.body.summary.done, 250);
    assert.equal(completed.body.summary.mine, 251);
    const noMatch = await request({ pagination: 'cursor', q: 'no-such-fixture' });
    assert.equal(noMatch.body.summary.total, 0);
    assert.deepEqual(noMatch.body.items, []);
});
