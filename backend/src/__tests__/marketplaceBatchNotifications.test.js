const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { deferredEvents } = require('../utils/transactionEvents');
const { notifyMarketplaceBatch, listMarketplaceBatchNotices, markMarketplaceBatchNoticeSeen } = require('../services/marketplaceBatchNotifications');
const { createMarketplaceBatchNoticeRouter } = require('../routes/marketplaceBatchNoticeRoutes');

let db, events;
const warehouse = { id: 2, role: 'admin', management_scope: 'warehouse' };
const notify = (stage = 'prepared', extra = {}) => notifyMarketplaceBatch({ db, events, intakeId: 21, actorId: 1, stage, ...extra });

beforeAll(async () => {
    db = new PGlite();
    await db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,name TEXT,role TEXT,management_scope TEXT DEFAULT 'all');
        CREATE TABLE marketplace_intakes(id INTEGER PRIMARY KEY,batch_number TEXT,source_platform TEXT,source_store TEXT,archived_at TIMESTAMPTZ);
        CREATE TABLE marketplace_warehouse_flows(intake_id INTEGER PRIMARY KEY REFERENCES marketplace_intakes(id),erp_confirmed_at TIMESTAMPTZ,printed_at TIMESTAMPTZ,prepick_completed_at TIMESTAMPTZ);
        CREATE TABLE orders(id INTEGER PRIMARY KEY,status TEXT,warehouse_hold BOOLEAN);`);
    await db.exec(fs.readFileSync(path.resolve(__dirname, '../../migrations/036_marketplace_batch_notices.sql'), 'utf8'));
}, 30000);
beforeEach(async () => {
    await db.exec(`TRUNCATE users,marketplace_intakes,marketplace_warehouse_flows,orders,marketplace_batch_notices,marketplace_batch_notice_recipients RESTART IDENTITY CASCADE;
        INSERT INTO users(id,username,name,role,management_scope) VALUES
            (1,'dispatch','拋單人員','dispatcher','all'),(2,'warehouse','倉儲主管','admin','warehouse'),
            (3,'manager','管理員','admin','all'),(4,'owner','最高管理員','superadmin','all'),
            (5,'orders','訂單主管','admin','orders'),(6,'pick','揀貨人員','picker','all'),
            (7,'pack','裝箱人員','packer','all'),(8,'view','唯讀人員','viewer','all');
        INSERT INTO marketplace_intakes VALUES(21,'BATCH-21','SHOPLINE','bonson',NULL);
        INSERT INTO marketplace_warehouse_flows(intake_id) VALUES(21);
        INSERT INTO orders VALUES(71,'pending',TRUE);`);
    events = { emit: jest.fn() };
});
afterAll(async () => db?.close());

test('saved batches notify warehouse managers with a durable inbox and no order creation or release', async () => {
    const result = await notify();
    expect(result).toMatchObject({ stage: 'prepared', title: '待理貨回匯', intakeId: 21, recipientUserIds: [2, 3, 4], href: '/warehouse-intakes/21', reused: false });
    expect((await db.query('SELECT user_id FROM marketplace_batch_notice_recipients ORDER BY user_id')).rows.map(r => r.user_id)).toEqual([2, 3, 4]);
    expect((await listMarketplaceBatchNotices(db, warehouse)).notices[0]).toMatchObject({ noticeId: result.noticeId, actorName: '拋單人員', batchNumber: 'BATCH-21' });
    expect((await db.query('SELECT * FROM orders')).rows).toEqual([{ id: 71, status: 'pending', warehouse_hold: true }]);
    expect(events.emit.mock.calls.map(([name]) => name)).toEqual(['marketplace_batch_notice', 'warehouse_tasks_changed']);
    expect(events.emit).toHaveBeenCalledWith('marketplace_batch_notice', {});
    expect(result.store).toBe('bonson');
});

test('retrying a saved batch neither duplicates recipients nor resets a previously seen notice', async () => {
    const first = await notify();
    await markMarketplaceBatchNoticeSeen(db, warehouse, first.noticeId);
    events.emit.mockClear();
    const retried = await notify('prepared', { actorId: 5 });
    expect(retried).toMatchObject({ noticeId: first.noticeId, reused: true });
    expect(events.emit).not.toHaveBeenCalled();
    expect(await listMarketplaceBatchNotices(db, warehouse)).toEqual({ total: 0, notices: [] });
    expect((await db.query('SELECT actor_id,actor_name FROM marketplace_batch_notices')).rows).toEqual([{ actor_id: 1, actor_name: '拋單人員' }]);
    expect((await db.query('SELECT COUNT(*)::int AS count FROM marketplace_batch_notice_recipients')).rows[0].count).toBe(3);
});

test('only a persisted successful ERP return creates the printable-stage notice, while picking remains held', async () => {
    await notify();
    await expect(notify('ready_for_print')).rejects.toMatchObject({ status: 409, code: 'ERP_RETURN_REQUIRED' });
    await db.query('UPDATE marketplace_warehouse_flows SET erp_confirmed_at=NOW() WHERE intake_id=$1', [21]);
    const ready = await notify('ready_for_print');
    expect((await listMarketplaceBatchNotices(db, warehouse)).notices.map(n => n.stage)).toEqual(['ready_for_print']);
    await markMarketplaceBatchNoticeSeen(db, warehouse, ready.noticeId);
    expect((await db.query('SELECT * FROM orders')).rows[0]).toMatchObject({ status: 'pending', warehouse_hold: true });
    expect((await db.query('SELECT printed_at,prepick_completed_at FROM marketplace_warehouse_flows')).rows[0]).toEqual({ printed_at: null, prepick_completed_at: null });
    expect((await notify('ready_for_print')).reused).toBe(true);
});

test('a printed or archived batch exits the actionable inbox and retains its notice ledger', async () => {
    await db.query('UPDATE marketplace_warehouse_flows SET erp_confirmed_at=NOW() WHERE intake_id=$1', [21]);
    await notify('ready_for_print');
    await db.query('UPDATE marketplace_warehouse_flows SET printed_at=NOW() WHERE intake_id=$1', [21]);
    expect((await listMarketplaceBatchNotices(db, warehouse)).total).toBe(0);
    expect((await db.query('SELECT COUNT(*)::int AS count FROM marketplace_batch_notices')).rows[0].count).toBe(1);
    await db.query('UPDATE marketplace_intakes SET archived_at=NOW() WHERE id=$1', [21]);
    await expect(notify()).rejects.toMatchObject({ status: 409, code: 'BATCH_UNAVAILABLE' });
});

test.each([5, 6, 7, 8])('role %s cannot read or acknowledge a warehouse notice', async id => {
    const notice = await notify();
    await expect(listMarketplaceBatchNotices(db, { id })).rejects.toMatchObject({ status: 403 });
    await expect(markMarketplaceBatchNoticeSeen(db, { id }, notice.noticeId)).rejects.toMatchObject({ status: 403 });
});

test('current DB management scope overrides stale caller role and acknowledgement belongs to its recipient only', async () => {
    const notice = await notify();
    await db.query("UPDATE users SET management_scope='orders' WHERE id=2");
    await expect(listMarketplaceBatchNotices(db, warehouse)).rejects.toMatchObject({ status: 403 });
    await expect(markMarketplaceBatchNoticeSeen(db, warehouse, notice.noticeId)).rejects.toMatchObject({ status: 403 });
    await expect(markMarketplaceBatchNoticeSeen(db, { id: 4 }, '999')).rejects.toMatchObject({ status: 404 });
    await expect(markMarketplaceBatchNoticeSeen(db, { id: 3 }, '1e1')).rejects.toMatchObject({ status: 400 });
    const seen = await markMarketplaceBatchNoticeSeen(db, { id: 3 }, notice.noticeId);
    expect(seen.seenAt).toBeTruthy();
    expect((await listMarketplaceBatchNotices(db, { id: 4 })).total).toBe(1);
});

test('the actor does not get a redundant self-notice, and historical actor name survives later changes', async () => {
    const notice = await notify('prepared', { actorId: 2 });
    expect(notice.recipientUserIds).toEqual([3, 4]);
    await db.query("UPDATE users SET name='新顯示名稱' WHERE id=2");
    expect((await listMarketplaceBatchNotices(db, { id: 3 })).notices[0].actorName).toBe('倉儲主管');
    await expect(markMarketplaceBatchNoticeSeen(db, warehouse, notice.noticeId)).rejects.toMatchObject({ status: 404 });
});

test('rollback removes the notification ledger and no event is published before commit', async () => {
    const io = { emit: jest.fn() };
    const pendingEvents = deferredEvents(io);
    await db.query('BEGIN');
    await notify('prepared', { events: pendingEvents });
    expect(io.emit).not.toHaveBeenCalled();
    await db.query('ROLLBACK');
    expect((await listMarketplaceBatchNotices(db, warehouse)).total).toBe(0);
    expect(io.emit).not.toHaveBeenCalled();
});

test('missing batch, invalid stage, and absent warehouse managers create no partial ledger', async () => {
    await expect(notify('prepared', { intakeId: 999 })).rejects.toMatchObject({ status: 409 });
    await expect(notify('released')).rejects.toMatchObject({ status: 400 });
    await db.query("UPDATE users SET role='dispatcher' WHERE id IN (2,3,4)");
    await expect(notify()).rejects.toMatchObject({ status: 503, code: 'WAREHOUSE_MANAGER_UNAVAILABLE' });
    expect((await db.query('SELECT COUNT(*)::int AS count FROM marketplace_batch_notices')).rows[0].count).toBe(0);
});

test('the HTTP router denies anonymous requests and returns the authenticated recipient inbox without caching', async () => {
    await notify();
    const router = createMarketplaceBatchNoticeRouter({ pool: db });
    const handler = router.stack.find(layer => layer.route?.path === '/' && layer.route.methods.get).route.stack[0].handle;
    const res = { set: jest.fn().mockReturnThis(), status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() }, next = jest.fn();
    await handler({ user: undefined }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    res.json.mockClear();
    await handler({ user: warehouse }, res, next);
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.json.mock.calls[0][0]).toMatchObject({ total: 1, notices: [{ intakeId: 21, stage: 'prepared' }] });
});
