jest.mock('../config/database', () => ({ pool: { connect: jest.fn(), query: jest.fn() } }));
jest.mock('../utils/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { pool } = require('../config/database');
const router = require('../routes/orderRoutes');
const handler = (path, method) => router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route.stack[0].handle;
const detail = handler('/orders/:orderId', 'get');
const scan = handler('/orders/update_item', 'post');
const rows = values => ({ rows: structuredClone(values), rowCount: values.length });
const item = (id, quantity, picked = 0, packed = 0) => ({
    id, order_id: 1, quantity, picked_quantity: picked, packed_quantity: packed, barcode: `BARCODE-${id}`
});
const instance = (id, itemId, status) => ({ id, order_item_id: itemId, status, serial_number: `SERIAL-${id}` });

async function invoke(action, io, body = {}) {
    const req = {
        params: { orderId: '1' }, body,
        user: { id: 2, role: 'packer', name: 'Fixture Packer' },
        app: { get: () => io }
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();
    await action(req, res, next);
    return { res, next };
}

function detailFixture({ status = 'packing', items = [], instances = [], openException = false, voidDuringRead = false, failRefresh = false }) {
    let committed = { id: 1, status };
    let transaction;
    let orderReads = 0;
    let earlyEvents = 0;
    const io = { emit: jest.fn(() => { if (transaction) earlyEvents++; }) };
    const client = {
        release: jest.fn(),
        query: jest.fn(async (sql, params) => {
            if (sql === 'BEGIN') { transaction = structuredClone(committed); return rows([]); }
            if (sql.startsWith('SET LOCAL')) return rows([]);
            if (sql === 'ROLLBACK') { transaction = undefined; return rows([]); }
            if (sql === 'COMMIT') { committed = transaction; transaction = undefined; return rows([]); }
            const order = transaction || committed;
            if (sql.startsWith('SELECT o.*')) {
                orderReads++;
                if (failRefresh && orderReads === 2) throw new Error('refresh unavailable');
                return rows([order]);
            }
            if (sql.startsWith('SELECT * FROM order_items')) return rows(items);
            if (sql.startsWith('SELECT i.*')) return rows(instances);
            if (sql.includes('AS has_open')) return rows([{ has_open: openException }]);
            if (sql.startsWith('UPDATE orders SET status')) {
                if (voidDuringRead) order.status = 'voided';
                if (order.status !== params[1]) return rows([]);
                order.status = sql.includes("status = 'completed'") ? 'completed' : 'picked';
                return { rows: [], rowCount: 1 };
            }
            throw new Error(`Unexpected detail SQL: ${sql}`);
        })
    };
    pool.connect.mockResolvedValue(client);
    pool.query.mockImplementation(() => { throw new Error('Detail repair must reuse its single checked-out client'); });
    return {
        io, client, state: () => committed, reads: () => orderReads, earlyEvents: () => earlyEvents,
        updates: () => client.query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE'))
    };
}

test.each([
    ['voided order with packed stock', { status: 'voided', items: [item(1, 1, 1, 1)] }, 'voided'],
    ['empty pending order', { status: 'pending' }, 'pending'],
    ['empty packing order', {}, 'packing'],
    ['zero-demand order', { items: [item(1, 0)] }, 'packing'],
    ['SN list missing required units', { items: [item(1, 3, 3, 3)], instances: [instance(1, 1, 'packed'), instance(2, 1, 'packed')] }, 'packing'],
    ['SN list with excess units', { items: [item(1, 1)], instances: [instance(1, 1, 'packed'), instance(2, 1, 'packed')] }, 'packing'],
    ['mixed order with one barcode unit still unpacked', { items: [item(1, 1), item(2, 2, 2, 1)], instances: [instance(1, 1, 'packed')] }, 'packing'],
    ['packed counter without required picking', { items: [item(1, 2, 1, 2)] }, 'packing']
])('detail read preserves %s', async (label, fixture, expected) => {
    const db = detailFixture(fixture);
    const { res, next } = await invoke(detail, db.io);
    expect(next).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].order.status).toBe(expected);
    expect(db.updates()).toHaveLength(0);
    expect(db.io.emit).not.toHaveBeenCalled();
});

test.each([
    ['fully verified SN', [item(1, 2)], [instance(1, 1, 'packed'), instance(2, 1, 'packed')]],
    ['fully verified barcode', [item(1, 2, 2, 2)], []],
    ['fully verified mixed order', [item(1, 1), item(2, 2, 2, 2)], [instance(1, 1, 'packed')]]
])('detail still repairs a %s order to completed', async (label, items, instances) => {
    const db = detailFixture({ items, instances });
    const { res, next } = await invoke(detail, db.io);
    expect(next).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].order.status).toBe('completed');
    expect(db.io.emit).toHaveBeenCalledWith('task_status_changed', { orderId: 1, newStatus: 'completed' });
});

test('detail does not promote picking when the available SN list is incomplete', async () => {
    const db = detailFixture({ status: 'picking', items: [item(1, 2)], instances: [instance(1, 1, 'picked')] });
    const { res } = await invoke(detail, db.io);
    expect(res.json.mock.calls[0][0].order.status).toBe('picking');
    expect(db.updates()).toHaveLength(0);
});

test('an open exception still blocks automatic completion', async () => {
    const db = detailFixture({ items: [item(1, 1, 1, 1)], openException: true });
    const { res } = await invoke(detail, db.io);
    expect(res.json.mock.calls[0][0].order.status).toBe('packing');
    expect(db.updates()).toHaveLength(0);
});

test('a conditional no-op returns the stored status without a completion event', async () => {
    const db = detailFixture({ items: [item(1, 1, 1, 1)], voidDuringRead: true });
    const { res, next } = await invoke(detail, db.io);
    expect(next).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].order.status).toBe('voided');
    expect(db.reads()).toBe(2);
    expect(db.io.emit).not.toHaveBeenCalled();
});

test('detail locks the order before reading item progress and commits before notification', async () => {
    const db = detailFixture({ items: [item(1, 1, 1, 1)] });
    const { next } = await invoke(detail, db.io);
    expect(next).not.toHaveBeenCalled();
    const queries = db.client.query.mock.calls.map(([sql]) => sql);
    const lockIndex = queries.findIndex(sql => sql.includes('FOR UPDATE OF o'));
    const itemIndex = queries.findIndex(sql => sql.startsWith('SELECT * FROM order_items'));
    expect(lockIndex).toBeGreaterThan(queries.indexOf('BEGIN'));
    expect(lockIndex).toBeLessThan(itemIndex);
    expect(queries.at(-1)).toBe('COMMIT');
    expect(db.earlyEvents()).toBe(0);
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(pool.query).not.toHaveBeenCalled();
    expect(db.client.release).toHaveBeenCalledTimes(1);
});

test('failed detail response preparation rolls back auto-repair without publishing', async () => {
    const db = detailFixture({ items: [item(1, 1, 1, 1)], failRefresh: true });
    const { next } = await invoke(detail, db.io);
    expect(next).toHaveBeenCalled();
    expect(db.state().status).toBe('packing');
    expect(db.io.emit).not.toHaveBeenCalled();
    expect(db.client.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
    expect(db.client.release).toHaveBeenCalledTimes(1);
});

// Use real route, transaction/event handling, operation logging and completion helper.
// Only SQL transport is synthetic, as in the existing scan transaction regression suite.
function scanFixture({ status = 'packing', items, instances }) {
    let committed = {
        order: { id: 1, status, picker_id: 1, packer_id: 2, voucher_number: 'FIXTURE-1', customer_name: 'Synthetic' },
        items, instances, logs: []
    };
    let transaction;
    const io = { emit: jest.fn() };
    const client = {
        release: jest.fn(),
        query: jest.fn(async (sql, params = []) => {
            const q = sql.replace(/\s+/g, ' ').trim();
            if (q === 'BEGIN') { transaction = structuredClone(committed); return rows([]); }
            if (q.startsWith('SET LOCAL')) return rows([]);
            if (q === 'COMMIT') { committed = transaction; transaction = undefined; return rows([]); }
            if (q === 'ROLLBACK') { transaction = undefined; return rows([]); }
            const state = transaction || committed;
            if (q.startsWith('SELECT * FROM orders')) return rows([state.order]);
            if (q.includes('AS has_open')) return rows([{ has_open: false }]);
            if (q.startsWith('SELECT i.id, i.status')) return rows(state.instances.filter(value => value.serial_number === params[1]));
            if (q.startsWith('SELECT oi.id,')) return rows(state.items.filter(value => value.barcode === params[1]));
            if (q.startsWith('UPDATE order_item_instances')) {
                state.instances.find(value => value.id === params[1]).status = params[0]; return rows([]);
            }
            if (q.startsWith('UPDATE order_items SET packed_quantity')) {
                state.items.find(value => value.id === params[1]).packed_quantity = params[0]; return rows([]);
            }
            if (q.startsWith('INSERT INTO operation_logs')) {
                const log = { id: state.logs.length + 1, action_type: params[2], created_at: '2026-09-09T00:00:00Z' };
                state.logs.push(log); return rows([log]);
            }
            if (q.startsWith('SELECT * FROM order_items')) return rows(state.items);
            if (q.startsWith('SELECT i.*')) return rows(state.instances);
            if (q.startsWith('UPDATE orders SET status')) {
                state.order.status = q.includes("status = 'completed'") ? 'completed' : 'picked'; return { rows: [], rowCount: 1 };
            }
            throw new Error(`Unexpected scan SQL: ${q}`);
        })
    };
    pool.connect.mockResolvedValue(client);
    pool.query.mockImplementation(() => { throw new Error('Scan must keep its single checked-out client'); });
    return { io, client, state: () => committed };
}

test.each([1, 3])('last available SN cannot complete a demand of %i with two instances', async quantity => {
    const db = scanFixture({ items: [item(1, quantity)], instances: [instance(1, 1, 'packed'), instance(2, 1, 'picked')] });
    const { res, next } = await invoke(scan, db.io, { orderId: 1, type: 'pack', scanValue: 'SERIAL-2' });
    expect(next).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].order.status).toBe('packing');
    expect(db.state().instances.every(value => value.status === 'packed')).toBe(true);
    expect(db.state().logs).toHaveLength(1);
    expect(db.io.emit.mock.calls.some(([event]) => event === 'task_status_changed')).toBe(false);
});

test('mixed order completes only after the last ordinary barcode unit is packed', async () => {
    const db = scanFixture({ items: [item(1, 1), item(2, 2, 2, 0)], instances: [instance(1, 1, 'packed')] });
    for (let expected = 1; expected <= 2; expected++) {
        const { res, next } = await invoke(scan, db.io, { orderId: 1, type: 'pack', scanValue: 'BARCODE-2' });
        expect(next).not.toHaveBeenCalled();
        expect(res.json.mock.calls[0][0].order.status).toBe(expected === 1 ? 'packing' : 'completed');
        expect(res.json.mock.calls[0][0].items[1].packed_quantity).toBe(expected);
    }
    expect(db.state().logs).toHaveLength(2);
    expect(db.io.emit.mock.calls.filter(([event]) => event === 'task_status_changed')).toHaveLength(1);
});

test('voided order refuses a scan without changing instances, quantities or logs', async () => {
    const db = scanFixture({ status: 'voided', items: [item(1, 1)], instances: [instance(1, 1, 'picked')] });
    const before = structuredClone(db.state());
    const { next } = await invoke(scan, db.io, { orderId: 1, type: 'pack', scanValue: 'SERIAL-1' });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 409, scanNotApplied: true }));
    expect(db.state()).toEqual(before);
    expect(db.io.emit).not.toHaveBeenCalled();
    expect(db.client.release).toHaveBeenCalledTimes(1);
});
