jest.mock('../config/database', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../utils/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
const { warehouseTransaction } = require('../services/warehouseTransaction');
const { logOperation } = require('../services/operationLogService');
const { globalErrorHandler } = require('../middleware/errorHandler');

const actor = { id: 8, username: 'fixture', name: '當時的名字', role: 'admin', management_scope: 'orders' };
function transport({ failCommit = false, failRollback = false } = {}) {
    let open = false;
    const db = { query: jest.fn(async sql => {
        if (sql === 'BEGIN') open = true;
        if (sql === 'COMMIT') {
            if (failCommit) throw new Error('connection lost during COMMIT');
            open = false;
        }
        if (sql === 'ROLLBACK') {
            if (failRollback) throw new Error('connection lost during ROLLBACK');
            open = false;
        }
        return { rows: [{ id: 42, created_at: '2026-10-13T00:00:00Z', actor_snapshot: actor, work_type: 'pick' }] };
    }), release: jest.fn() };
    const pool = { connect: jest.fn(async () => db) }, io = { emit: jest.fn(() => { expect(open).toBe(false); }) };
    return { pool, db, io };
}
test('work changes persist actor and actual stage in the same audit insert without extra user queries', async () => {
    const { pool, db, io } = transport();
    const result = await warehouseTransaction(pool, io, async (client, events) => {
        await logOperation({ db: client, io: events, userId: 8, orderId: 1, actor, workType: 'pick', operationType: 'pick',
            voucherNumber: 'FIXTURE', customerName: 'Fixture customer', details: { operation_context: 'assistance', before: { picked_quantity: 0 }, after: { picked_quantity: 1 } } });
        return 'completed';
    });
    expect(result).toBe('completed');
    const [sql, params] = db.query.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO operation_logs'));
    expect(sql).toContain('actor_snapshot, work_type');
    expect(JSON.parse(params[4])).toEqual(actor);
    expect(params[5]).toBe('pick');
    expect(db.query.mock.calls.some(([sql]) => sql.startsWith('SELECT '))).toBe(false);
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(io.emit.mock.calls[0]).toEqual(['new_operation_log', expect.objectContaining({ actor_snapshot: actor, work_type: 'pick' })]);
    expect(db.release).toHaveBeenCalledWith(undefined);
});
test('a failed mutation rolls back and publishes none of the queued work events', async () => {
    const { pool, db, io } = transport();
    await expect(warehouseTransaction(pool, io, async (_client, events) => { events.emit('handoff', {}); throw new Error('write failure'); })).rejects.toThrow('write failure');
    expect(db.query).toHaveBeenCalledWith('ROLLBACK');
    expect(io.emit).not.toHaveBeenCalled();
});
test.each([{ failCommit: true }, { failRollback: true }])('uncertain transaction results are never advertised as retryable success: %j', async options => {
    const { pool, db, io } = transport(options);
    await expect(warehouseTransaction(pool, io, async (_client, events) => {
        events.emit('handoff', {});
        if (options.failRollback) throw new Error('write failed');
    })).rejects.toMatchObject({ code: 'WORK_RESULT_UNKNOWN', status: 503 });
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(io.emit).not.toHaveBeenCalled();
    expect(db.release.mock.calls[0][0]).toBeInstanceOf(Error);
});
test('unknown work outcome keeps the reload instruction and public error code', () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    globalErrorHandler({ code: 'WORK_RESULT_UNKNOWN' }, { path: '/warehouse/work-mode', method: 'PUT' }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ code: 'WORK_RESULT_UNKNOWN', message: expect.stringContaining('請勿重複送出') });
});
