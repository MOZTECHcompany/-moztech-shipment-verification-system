jest.mock('../config/database', () => ({ pool: { connect: jest.fn(), query: jest.fn() } }));
jest.mock('../utils/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { pool } = require('../config/database');
const router = require('../routes/orderRoutes');

const handlerFor = path => router.stack.find(layer => layer.route?.path === path).route.stack[0].handle;
const scan = handlerFor('/orders/update_item');
const claim = handlerFor('/orders/:orderId/claim');

// A single-client pool fails immediately if a handler tries a second checkout.
// Only SQL transport is replaced; the real route and logOperation service run.
function singleClientDatabase({ status = 'picking', failSnapshot = false, failCommit = false, failRollback = false } = {}) {
    let committed = {
        order: { id: 1, status, picker_id: status === 'pending' ? null : 1, packer_id: 2, voucher_number: 'TEST-1', customer_name: 'Fixture' },
        item: { id: 11, order_id: 1, barcode: 'ITEM', quantity: 100, picked_quantity: 0, packed_quantity: 0 },
        logs: []
    };
    let transaction;
    let held = false;
    let commitCount = 0;
    let eventsBeforeCommit = 0;
    const sqlCalls = [];
    const rows = values => ({ rows: structuredClone(values), rowCount: values.length });
    const client = {
        query: jest.fn(async (sql, params = []) => {
            const q = sql.replace(/\s+/g, ' ').trim();
            sqlCalls.push(q);
            if (q === 'BEGIN') { transaction = structuredClone(committed); return rows([]); }
            if (q.startsWith('SET LOCAL')) return rows([]);
            if (q === 'ROLLBACK') { if (failRollback) throw new Error('rollback connection failure'); transaction = undefined; return rows([]); }
            if (q === 'COMMIT') {
                if (failCommit) throw new Error('connection lost during COMMIT');
                committed = transaction;
                transaction = undefined;
                commitCount++;
                return rows([]);
            }
            const state = transaction || committed;
            if (q.includes('AS has_open')) return rows([{ has_open: false }]);
            if (q.startsWith('SELECT * FROM orders')) return rows([state.order]);
            if (q.startsWith('SELECT i.id, i.status')) return rows([]);
            if (q.startsWith('SELECT oi.id,')) {
                const amount = params[2];
                const type = params[3];
                const count = type === 'pick' ? state.item.picked_quantity : state.item.packed_quantity;
                const limit = type === 'pick' ? state.item.quantity : state.item.picked_quantity;
                return rows(params[1] === state.item.barcode && count + amount <= limit ? [state.item] : []);
            }
            if (q.startsWith('UPDATE order_items SET picked_quantity')) { state.item.picked_quantity = params[0]; return rows([]); }
            if (q.startsWith('UPDATE order_items SET packed_quantity')) { state.item.packed_quantity = params[0]; return rows([]); }
            if (q.startsWith('INSERT INTO operation_logs')) {
                const log = { id: state.logs.length + 1, created_at: '2026-09-09T00:00:00Z', action_type: params[2] };
                state.logs.push(log);
                return rows([log]);
            }
            if (q.startsWith('WITH instance_stats AS')) return rows([{ has_unpicked: state.item.picked_quantity < 100, has_unpacked: state.item.packed_quantity < 100 }]);
            if (q.startsWith('UPDATE orders SET status = $1,')) { state.order.status = params[0]; state.order.picker_id = params[1]; return rows([]); }
            if (q.startsWith('UPDATE orders SET status')) {
                state.order.status = q.includes("status = 'completed'") ? 'completed' : q.includes("status = 'packing'") ? 'packing' : 'picked';
                return rows([]);
            }
            if (q.startsWith('SELECT * FROM order_items')) {
                if (failSnapshot) throw new Error('snapshot unavailable');
                return rows([state.item]);
            }
            if (q.startsWith('SELECT i.* FROM order_item_instances')) return rows([]);
            if (q.startsWith('SELECT name, role FROM users')) return rows([{ name: 'Fixture operator', role: 'picker' }]);
            if (q.startsWith('SELECT voucher_number, customer_name FROM orders')) return rows([state.order]);
            if (q.startsWith('SELECT o.*, u.name as current_user')) return rows([{ ...state.order, current_user: 'Fixture operator' }]);
            throw new Error(`Unexpected SQL: ${q}`);
        }),
        release: jest.fn(() => { held = false; })
    };
    pool.connect.mockImplementation(async () => {
        if (held) throw new Error('single-client pool exhausted');
        held = true;
        return client;
    });
    pool.query.mockImplementation(async () => { throw new Error(held ? 'single-client pool exhausted' : 'unexpected pool query'); });
    const io = { emit: jest.fn(() => { if (transaction) eventsBeforeCommit++; }) };
    return { client, io, state: () => committed, inTransaction: () => !!transaction, commits: () => commitCount, earlyEvents: () => eventsBeforeCommit, sqlCalls };
}

async function invoke(handler, db, body = {}, user = { id: 1, role: 'picker', name: 'Fixture operator' }) {
    const req = { body, params: { orderId: '1' }, user, app: { get: () => db.io } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();
    await handler(req, res, next);
    return { res, next };
}

test('100 pick and 100 pack requests complete with one pool client and one mutation each', async () => {
    const db = singleClientDatabase();
    for (const type of ['pick', 'pack']) {
        for (let i = 1; i <= 100; i++) {
            const user = { id: type === 'pick' ? 1 : 2, role: type === 'pick' ? 'picker' : 'packer', name: 'Fixture operator' };
            const { res, next } = await invoke(scan, db, { orderId: 1, scanValue: 'ITEM', type }, user);
            expect(next).not.toHaveBeenCalled();
            expect(res.json.mock.calls[0][0].items[0][type === 'pick' ? 'picked_quantity' : 'packed_quantity']).toBe(i);
        }
    }
    expect(db.state().order.status).toBe('completed');
    expect(db.commits()).toBe(200);
    expect(db.earlyEvents()).toBe(0);
    expect(db.state().logs).toHaveLength(200);
    expect(db.client.release).toHaveBeenCalledTimes(200);
    expect(pool.query).not.toHaveBeenCalled();
    expect(db.io.emit.mock.calls.filter(([event]) => event === 'task_status_changed').map(([, data]) => data.newStatus)).toEqual(['picked', 'packing', 'completed']);
});

test('snapshot failure rolls back mutation and publishes no event', async () => {
    const db = singleClientDatabase({ failSnapshot: true });
    const { next } = await invoke(scan, db, { orderId: 1, scanValue: 'ITEM', type: 'pick' });
    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].scanNotApplied).toBe(true);
    expect(db.state().item.picked_quantity).toBe(0);
    expect(db.state().logs).toHaveLength(0);
    expect(db.commits()).toBe(0);
    expect(db.io.emit).not.toHaveBeenCalled();
    expect(db.client.release).toHaveBeenCalledTimes(1);
});

test('failed first packing scan does not broadcast a rolled-back packing transition', async () => {
    const db = singleClientDatabase({ status: 'picked' });
    const { next } = await invoke(scan, db, { orderId: 1, scanValue: 'WRONG', type: 'pack' }, { id: 2, role: 'packer' });
    expect(next).toHaveBeenCalled();
    expect(db.state().order.status).toBe('picked');
    expect(db.io.emit.mock.calls.map(([event, body]) => [event, body.action_type])).toEqual([['new_operation_log', 'scan_error']]);
    expect(db.state().logs).toHaveLength(1);
    expect(db.state().item.packed_quantity).toBe(0);
});

test('COMMIT connection error explicitly reports an unknown result and never publishes success', async () => {
    const db = singleClientDatabase({ failCommit: true });
    const { res, next } = await invoke(scan, db, { orderId: 1, scanValue: 'ITEM', type: 'pick' });
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json.mock.calls[0][0].code).toBe('SCAN_RESULT_UNKNOWN');
    expect(next).not.toHaveBeenCalled();
    expect(db.io.emit).not.toHaveBeenCalled();
    expect(db.client.release).toHaveBeenCalledTimes(1);
});

test('a notification transport failure does not turn a committed scan into a failed response', async () => {
    const db = singleClientDatabase();
    db.io.emit.mockImplementation(() => { throw new Error('socket unavailable'); });
    const { res, next } = await invoke(scan, db, { orderId: 1, scanValue: 'ITEM', type: 'pick' });
    expect(next).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].items[0].picked_quantity).toBe(1);
    expect(db.commits()).toBe(1);
    expect(db.sqlCalls.filter(q => q === 'ROLLBACK')).toHaveLength(0);
});

test('claim logs and prepares its event using the same single client', async () => {
    const db = singleClientDatabase({ status: 'pending' });
    const { res, next } = await invoke(claim, db);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(db.state().order.status).toBe('picking');
    expect(db.earlyEvents()).toBe(0);
    expect(db.state().logs).toHaveLength(1);
    expect(pool.query).not.toHaveBeenCalled();
    expect(db.io.emit.mock.calls.map(([event]) => event)).toEqual(['new_operation_log', 'task_claimed']);
});


test('rollback failure reports unknown and discards the client', async () => {
    const db = singleClientDatabase({ failSnapshot: true, failRollback: true });
    const { res, next } = await invoke(scan, db, { orderId: 1, scanValue: 'ITEM', type: 'pick' });
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json.mock.calls[0][0].code).toBe('SCAN_RESULT_UNKNOWN');
    expect(next).not.toHaveBeenCalled();
    expect(db.client.release.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(db.io.emit).not.toHaveBeenCalled();
});

test('the existing global error handler preserves status and adds confirmed scan result metadata', () => {
    const { globalErrorHandler } = require('../middleware/errorHandler');
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const error = Object.assign(new Error('invalid scan'), { status: 409, scanNotApplied: true });
    globalErrorHandler(error, { path: '/api/orders/update_item', method: 'POST' }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].code).toBe('SCAN_NOT_APPLIED');
});


test.each([{ type: 'typo' }, { amount: 1.5 }, { amount: 0 }, { amount: Number.MAX_SAFE_INTEGER + 1 }])('malformed scan is rejected before taking a transaction connection: %j', async invalid => {
    const db = singleClientDatabase();
    const { res } = await invoke(scan, db, { orderId: 1, scanValue: 'ITEM', type: 'pick', ...invalid });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('SCAN_NOT_APPLIED');
    expect(pool.connect).not.toHaveBeenCalled();
    expect(db.state().item.picked_quantity).toBe(0);
});
