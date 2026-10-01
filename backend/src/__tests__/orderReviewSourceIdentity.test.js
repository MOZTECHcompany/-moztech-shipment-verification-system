jest.mock('../services/operationLogService', () => ({ logOperation: jest.fn() }));
jest.mock('../services/orderChangeNotifications', () => ({ notifyOrderChange: jest.fn() }));
const { PGlite } = require('@electric-sql/pglite');
const { requestChange } = require('../services/orderReviewService');
const { orderChangeNoticeDetails } = require('../services/orderChangeNoticeDetails');
let db;
beforeAll(async () => {
    db = new PGlite();
    await db.exec(`CREATE TABLE orders(id INTEGER PRIMARY KEY,status TEXT,picker_id INTEGER,packer_id INTEGER);
        CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,barcode TEXT,quantity INTEGER,picked_quantity INTEGER,packed_quantity INTEGER,
            source_order_number TEXT,source_platform TEXT,source_store TEXT,source_line_id TEXT);
        CREATE TABLE order_item_instances(id INTEGER PRIMARY KEY,order_item_id INTEGER,status TEXT,serial_number TEXT);
        CREATE TABLE order_exceptions(id SERIAL PRIMARY KEY,order_id INTEGER,type TEXT,status TEXT,reason_code TEXT,reason_text TEXT,created_by INTEGER,snapshot JSONB);
        INSERT INTO orders VALUES(1,'pending',NULL,NULL);
        INSERT INTO order_items VALUES(10,1,'4711299273087',1,0,0,'SL-100','SHOPLINE','bonson','L1'),
            (20,1,'4711299273087',2,0,0,'SL-100','SHOPLINE','bonson','L2');
        INSERT INTO order_item_instances VALUES(200,20,'pending','SN-A'),(201,20,'pending','SN-B');`);
}, 30000);
afterAll(async () => db?.close());
test('request captures item/source identities for duplicate barcodes without changing either SN line', async () => {
    const pool = { connect: async () => ({ query: async (...args) => {
        const result = await db.query(...args);
        return { ...result, rowCount: result.rows.length };
    }, release() {} }) };
    const proposal = { note: '來源明細核對', items: [{ orderItemId: 10, barcode: '4711299273087', productName: '商品', quantityChange: -1, noSn: true },
        { orderItemId: 20, barcode: '4711299273087', productName: '商品', quantityChange: -1, noSn: false, removedSnList: ['SN-B'] }] };
    const result = await requestChange({ pool, io: { emit: jest.fn() }, orderId: 1, user: { id: 7, role: 'admin', management_scope: 'orders' }, reason: '來源明細核對', proposal });
    const snapshot = (await db.query('SELECT snapshot FROM order_exceptions WHERE id=$1', [result.id])).rows[0].snapshot;
    expect(snapshot.baselineItems).toEqual([
        { orderItemId: 10, barcode: '4711299273087', quantity: 1, sourceOrderNumber: 'SL-100', sourcePlatform: 'SHOPLINE', sourceStore: 'bonson', sourceLineId: 'L1' },
        { orderItemId: 20, barcode: '4711299273087', quantity: 2, sourceOrderNumber: 'SL-100', sourcePlatform: 'SHOPLINE', sourceStore: 'bonson', sourceLineId: 'L2' },
    ]);
    expect(orderChangeNoticeDetails({ phase: 'requested', exception: { type: 'order_change', snapshot } }).lines).toEqual([
        '商品 · 4711299273087 · 1 → 0 件', '商品 · 4711299273087 · 2 → 1 件', '移除 SN：SN-B',
    ]);
    expect((await db.query('SELECT id,quantity FROM order_items ORDER BY id')).rows).toEqual([{ id: 10, quantity: 1 }, { id: 20, quantity: 2 }]);
    expect((await db.query('SELECT serial_number,status FROM order_item_instances ORDER BY id')).rows).toEqual([{ serial_number: 'SN-A', status: 'pending' }, { serial_number: 'SN-B', status: 'pending' }]);
});
