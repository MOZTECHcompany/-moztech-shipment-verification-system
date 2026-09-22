jest.mock('../config/database', () => ({ pool: { connect: jest.fn(), query: jest.fn() } }));
jest.mock('../utils/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
const xlsx = require('xlsx');
const { IMPORT_LIMITS, parseOrderImport, parseOrderRows } = require('../services/orderImportParser');
const { pool } = require('../config/database');
const router = require('../routes/orderRoutes');
const route = router.stack.find(layer => layer.route?.path === '/orders/import').route;
const importOrder = route.stack.at(-1).handle;
const uploadImport = route.stack.at(-2).handle;
const makeRows = (items = [['4710000000001', 'Product [SKU-1]', 2, '']], summary = '摘要') => [
    ['出貨單'], ['憑證號碼：TEST-20260909-1'], ['客戶名稱：Fixture Company'], ['國際條碼', '品項名稱', '數量', summary], ...items
];
function workbook(data, bookType = 'xlsx') {
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(data), '出貨');
    return xlsx.write(wb, { type: 'buffer', bookType });
}

test.each(['xlsx', 'biff8', 'csv'])('parses actual %s workbook using the existing labels and SKU syntax', bookType => {
    const parsed = parseOrderImport(workbook(makeRows(), bookType));
    expect(parsed).toMatchObject({ voucherNumber: 'TEST-20260909-1', customerName: 'Fixture Company', totalQuantity: 2, serialCount: 0 });
    expect(parsed.items[0]).toMatchObject({ barcode: '4710000000001', productCode: 'SKU-1', productName: 'Product', quantity: 2 });
});

test('supports adjacent labels, separate model column, ordinary notes, totals and repeated headers', () => {
    const parsed = parseOrderRows([
        ['Voucher', 'REFERENCE-2'], ['Customer', 'Fixture'],
        ['品項編碼', '品項名稱', '數量', '品項型號', '摘要'],
        [' CODE ', 'Name', '1,000', 'MODEL', '促銷品，請輕放'],
        ['品項編碼', '品項名稱', '數量', '品項型號', '摘要'],
        ['小計', '', 1000], [], ['TOTAL', '', 1000]
    ]);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({ barcode: 'CODE', productCode: 'MODEL', quantity: 1000, serials: [] });
});

test.each([
    ['SN:B19B52004735ㆍSN:B19B52004736', ['B19B52004735', 'B19B52004736']],
    ['T03K52027501・T03K52027502', ['T03K52027501', 'T03K52027502']],
    ['4711299273766, 4711299273767', ['4711299273766', '4711299273767']],
    ['47112992737664711299273767', ['4711299273766', '4711299273767']],
    ['SN:B19B52004735SN:B19B52004736', ['B19B52004735', 'B19B52004736']],
    ['4710000000001 SN: B19B52004735\nSN：B19B52004736', ['B19B52004735', 'B19B52004736']]
])('preserves representative serial format %s', (summary, expected) => {
    const parsed = parseOrderImport(workbook(makeRows([['4710000000001', 'Serial item', 2, summary]])));
    expect(parsed.items[0].serials).toEqual(expected);
});

test('uses expected quantity to disambiguate a continuous 156-character 13-digit list', () => {
    const serials = Array.from({ length: 12 }, (_, i) => `471129927${String(i).padStart(4, '0')}`);
    expect(parseOrderRows(makeRows([['BAR', 'Item', 12, serials.join('')]])).items[0].serials).toEqual(serials);
});

const sourceHeader = ['理貨單號', '序號', '商城訂單編號', '平台', '店鋪', '來源明細號', '品項編碼', '品項名', '國際條碼', '數量', '序號 / 批號'];
const sourceRows = () => [sourceHeader,
    ['PICK-DEMO-1', '1', 'SHOP-100', 'Shopify', 'Demo store', 'line-1', 'SKU-A', 'Product A', '4710000000013', 1, 'DEMO00000001'],
    ['PICK-DEMO-1', '2', 'ONE-200', '1Shop', 'Demo store', 'line-1', 'SKU-A', 'Product A', '4710000000013', 2, '']];

const ecountExportRows = () => [
    ['公司名稱 : 合成測試公司 / 2026/09/14  ~ 2026/09/14 '],
    ['理貨單號', '品項編碼', '品項名稱', '序號/批號', '商城訂單編號', '平台', '店鋪', '來源明細號', '國際條碼', '品項名稱(規格)', '數量', '倉庫/工廠名稱', '客戶/供應商名稱', '聯繫方式', '摘要'],
    ['TEST-ERP-1', 'SKU-1', 'Synthetic item A', 'TESTSN000001', 'TEST-ORDER-A', 'Shopify', 'Test store A', 'LINE-1', '0012345678905', 'Synthetic item A', 1, 'Test warehouse', 'Test customer A', '', ''],
    ['TEST-ERP-1', 'SKU-1', 'Synthetic item A', '', 'TEST-ORDER-B', '1Shop', 'Test store B', 'LINE-1', '0012345678905', 'Synthetic item A', 2, 'Test warehouse', 'Test customer B', '', ''],
    ['TEST-ERP-1', 'SKU-2', 'Synthetic item B', '', 'TEST-ORDER-C', 'Shopify', 'Test store C', 'LINE-1', '4710000000013', 'Synthetic item B', 1, 'Test warehouse', 'Test customer C', '', ''],
    ['2026/09/14 (一) 23:56:04']
];

test.each(['xlsx', 'biff8', 'csv'])('recognizes the confirmed ECOUNT envelope in %s without changing source row numbers', bookType => {
    const parsed = parseOrderImport(workbook(ecountExportRows(), bookType));
    expect(parsed).toMatchObject({ importFormat: 'source-details', voucherNumber: 'TEST-ERP-1', totalQuantity: 4, serialCount: 1 });
    expect(parsed.workOrders).toHaveLength(3);
    expect(parsed.items.map(item => item.sourceRow)).toEqual([3, 4, 5]);
    expect(parsed.items[0].barcode).toBe('0012345678905');
    expect(parsed.items[0].serials).toEqual(['TESTSN000001']);
    expect(pool.connect).not.toHaveBeenCalled();
});

test.each(['xlsx', 'biff8', 'csv'])('preserves date-like source identifiers and leading zeros in %s', bookType => {
    const parsed = parseOrderImport(workbook([
        ['理貨單號', '商城訂單編號', '品項編碼', '品項名稱', '國際條碼', '數量'],
        ['0001/02', '001-002', '01-02', 'Synthetic item', '0012345678905', '1,000']
    ], bookType));
    expect(parsed).toMatchObject({ voucherNumber: '0001/02', totalQuantity: 1000 });
    expect(parsed.items[0]).toMatchObject({ sourceOrderNumber: '001-002', productCode: '01-02', barcode: '0012345678905', quantity: 1000 });
});

test('legacy CSV preserves adjacent voucher/model identifiers and still validates quantities explicitly', () => {
    const rows = [
        ['Voucher', '001-002'], ['Customer', 'Synthetic customer'],
        ['國際條碼', '品項名稱', '數量', '品項型號', '摘要'],
        ['0012345678905', 'Synthetic item', '1,000', '0001/02', '請輕放']
    ];
    const parsed = parseOrderImport(workbook(rows, 'csv'));
    expect(parsed).toMatchObject({ voucherNumber: '001-002', totalQuantity: 1000 });
    expect(parsed.items[0]).toMatchObject({ barcode: '0012345678905', productCode: '0001/02', quantity: 1000, serials: [] });
    rows[3][2] = '2026/09/14';
    expect(() => parseOrderImport(workbook(rows, 'csv'))).toThrow(/第 4 列.*數量必須為正整數/);
});

test('accepts only the last nonempty timestamp, leaving blank trailing rows harmless', () => {
    expect(parseOrderRows([...ecountExportRows(), [], ['', ' ']]).workOrders).toHaveLength(3);
});

test.each([
    ['missing company envelope', rows => { rows[0][0] = 'Synthetic export'; }, /第 6 列/],
    ['preamble has a second value', rows => { rows[0][1] = 'Extra'; }, /第 6 列/],
    ['invalid date range', rows => { rows[0][0] = '公司名稱 : 合成測試公司 / 2026/02/30 ~ 2026/09/14'; }, /第 6 列/],
    ['reversed date range', rows => { rows[0][0] = '公司名稱 : 合成測試公司 / 2026/09/15 ~ 2026/09/14'; }, /第 6 列/],
    ['timestamp in the middle', rows => { rows.splice(3, 0, ['2026/09/14 (一) 23:56:04']); }, /第 4 列/],
    ['timestamp has product data', rows => { rows[5][1] = 'SKU-EXTRA'; }, /第 6 列/],
    ['unknown trailing text', rows => { rows[5][0] = 'End of synthetic report'; }, /第 6 列/],
    ['subtotal row', rows => { rows[5] = ['小計', '', '', '', '', '', '', '', '', '', 4]; }, /第 6 列/],
    ['invalid timestamp day', rows => { rows[5][0] = '2026/02/30 (一) 23:56:04'; }, /第 6 列/],
    ['incorrect weekday', rows => { rows[5][0] = '2026/09/14 (二) 23:56:04'; }, /第 6 列/],
    ['invalid timestamp time', rows => { rows[5][0] = '2026/09/14 (一) 24:00:00'; }, /第 6 列/],
    ['another batch', rows => { rows[3][0] = 'TEST-ERP-2'; }, /第 4 列.*只能包含一張理貨單/],
    ['missing marketplace source', rows => { rows[3][4] = ''; }, /第 4 列.*商城訂單編號必填/],
    ['missing barcode', rows => { rows[3][8] = ''; }, /第 4 列.*國際條碼必填/],
    ['invalid quantity retains original row', rows => { rows[4][10] = -1; }, /第 5 列.*數量必須為正整數/]
])('ECOUNT envelope never hides %s', (_, change, message) => {
    const rows = ecountExportRows(); change(rows);
    expect(() => parseOrderImport(workbook(rows))).toThrow(message);
    expect(pool.connect).not.toHaveBeenCalled();
});

test.each(['xlsx', 'biff8', 'csv'])('source detail %s retains one ERP batch and groups separate marketplace work orders', bookType => {
    const parsed = parseOrderImport(workbook(sourceRows(), bookType));
    expect(parsed).toMatchObject({ voucherNumber: 'PICK-DEMO-1', totalQuantity: 3, serialCount: 1 });
    expect(parsed.items).toHaveLength(2);
    expect(parsed.workOrders).toHaveLength(2);
    expect(parsed.items[0]).toMatchObject({ productCode: 'SKU-A', barcode: '4710000000013', sourceOrderNumber: 'SHOP-100', sourcePlatform: 'Shopify', sourceStore: 'Demo store', sourceLineId: 'line-1', serials: ['DEMO00000001'], sourceRow: 2 });
    expect(parsed.items[1]).toMatchObject({ sourceOrderNumber: 'ONE-200', sourcePlatform: '1Shop', sourceLineId: 'line-1', quantity: 2, serials: [] });
});

test('explicit aliases and neutral field names map without replacing SKU with barcode', () => {
    const parsed = parseOrderRows([
        ['voucher_number', 'source_order_number', 'product_code', 'product_name', 'barcode', 'quantity'],
        ['PICK-1', 'ORDER-1', 'SKU-1', 'Name', '00001234', 1],
        ['PICK-1', 'ORDER-1', 'SKU-1', 'Name', '00001234', 2]
    ]);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items.map(item => item.sourceLineId)).toEqual([null, null]);
    expect(parsed.items[0]).toMatchObject({ barcode: '00001234', productCode: 'SKU-1', sourceOrderNumber: 'ORDER-1' });
    const aliases = sourceRows(); aliases[0] = [...sourceHeader]; aliases[0][0] = '理貨單單號'; aliases[0][2] = '商城訂單號';
    expect(parseOrderRows(aliases).voucherNumber).toBe('PICK-DEMO-1');
});

test.each([
    ['different warehouse documents', rows => { rows[2][0] = 'PICK-DEMO-2'; }, /只能包含一張理貨單/],
    ['blank marketplace order', rows => { rows[1][2] = ''; }, /商城訂單編號必填/],
    ['blank warehouse document', rows => { rows[1][0] = ''; }, /理貨單號必填/],
    ['blank SKU', rows => { rows[1][6] = ''; }, /SKU/],
    ['blank barcode', rows => { rows[1][8] = ''; }, /國際條碼必填/],
    ['duplicate source line', rows => { rows[2][2] = 'SHOP-100'; rows[2][3] = 'Shopify'; }, /来源|來源明細號重複/],
    ['row-group sequence is not SN', rows => { rows[1][10] = 'BAD'; }, /第 2 列.*SN/],
    ['duplicate barcode columns', rows => { rows[0] = [...sourceHeader, '條碼']; }, /表頭重複/]
])('rejects source detail %s without a DB connection', (_, change, error) => {
    const rows = sourceRows(); change(rows);
    expect(() => parseOrderImport(workbook(rows))).toThrow(error);
    expect(pool.connect).not.toHaveBeenCalled();
});

test('source detail refuses multiple worksheets rather than silently losing another document', () => {
    const book = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet(sourceRows()), 'First');
    xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet(sourceRows()), 'Second');
    expect(() => parseOrderImport(xlsx.write(book, {type: 'buffer', bookType: 'xlsx'}))).toThrow(/單一工作表/);
});

test.each(['TESTSN000001ㆍTESTSN000002','SN:TESTSN000001ㆍSN:TESTSN000002','TESTSN000001TESTSN000002'])('source detail preserves legacy summary SN %s', summary => {
    const rows=sourceRows();rows[0]=[...sourceHeader,'摘要'];rows[2][10]='';rows[2][11]=summary;
    const item=parseOrderImport(workbook(rows)).items[1];
    expect(item.serials).toEqual(['TESTSN000001','TESTSN000002']);
    expect(item.sourceSummary).toBe(summary);expect(item.serialSource).toBe('摘要');
});
test.each([['TESTSN000001ㆍTESTSN000002',1],['SN：待補',2]])('source summary invalid SN fails closed %s', (summary,quantity)=>{
    const rows=sourceRows();rows[0]=[...sourceHeader,'摘要'];rows[2][9]=quantity;rows[2][10]='';rows[2][11]=summary;
    expect(()=>parseOrderImport(workbook(rows))).toThrow(/第 3 列.*SN/);
});
test('both serial fields must identify the same physical items',()=>{
    const rows=sourceRows();rows[0]=[...sourceHeader,'摘要'];rows[2][10]='TESTSN000001 TESTSN000002';rows[2][11]='SN:TESTSN000002 SN:TESTSN000001';
    expect(parseOrderImport(workbook(rows)).items[1].serialSource).toBe('序號/批號');
    rows[2][11]='TESTSN000003 TESTSN000004';expect(()=>parseOrderImport(workbook(rows))).toThrow(/SN 不一致/);
});

test.each(['', '促銷品，請輕放', '請下午配送；訂單備註待確認', '4710000000013'])('source detail permits ordinary summary %s without treating it as SN', summary => {
    const rows = sourceRows(); rows[0] = [...sourceHeader, '摘要']; rows[2][11] = summary;
    expect(parseOrderImport(workbook(rows)).items[1].serials).toEqual([]);
});

test('moving ECOUNT summary serials into the explicit column preserves both item instances', () => {
    const rows = sourceRows(); rows[0] = [...sourceHeader, '摘要'];
    rows[2][10] = 'TESTSN000001ㆍTESTSN000002'; rows[2][11] = '請輕放';
    expect(parseOrderImport(workbook(rows)).items[1].serials).toEqual(['TESTSN000001', 'TESTSN000002']);
});

test.each([
    ['missing voucher', [['title'], [], [], ['國際條碼', '品項名稱', '數量']]],
    ['empty items', makeRows([])],
    ['missing name', makeRows([['BAR', '', 1, '']])],
    ['fractional quantity', makeRows([['BAR', 'Name', 1.5, '']])],
    ['negative quantity', makeRows([['BAR', 'Name', -1, '']])],
    ['partial SN list', makeRows([['BAR', 'Name', 2, 'SN:B19B52004735']])],
    ['duplicate SN within item', makeRows([['BAR', 'Name', 2, 'SN:B19B52004735 SN:B19B52004735']])],
    ['duplicate SN across items', makeRows([['BAR-A', 'Name', 1, 'SN:B19B52004735'], ['BAR-B', 'Name', 1, 'SN:B19B52004735']])],
    ['malformed explicit SN', makeRows([['BAR', 'Name', 1, 'SN:bad']])],
    ['partial malformed explicit SN', makeRows([['BAR', 'Name', 1, 'SN:B19B52004735 SN:bad']])],
    ['malformed dedicated SN column', makeRows([['BAR', 'Name', 1, 'bad']], 'SN列表')]
])('rejects %s before any persistence', (label, input) => {
    expect(() => parseOrderRows(input)).toThrow();
    expect(pool.connect).not.toHaveBeenCalled();
});

test('rejects oversized file, row range, columns, item count and quantity rather than silently truncating', () => {
    expect(() => parseOrderImport(Buffer.alloc(IMPORT_LIMITS.fileBytes + 1))).toThrow(/10 MiB/);
    expect(() => parseOrderImport(workbook([...makeRows(), ...Array.from({ length: IMPORT_LIMITS.sheetRows }, () => ['x'])]))).toThrow(/範圍超限/);
    expect(() => parseOrderRows([Array(101).fill('x')])).toThrow(/100 欄/);
    expect(() => parseOrderRows(makeRows(Array.from({ length: 1001 }, (_, i) => [`BAR-${i}`, 'Name', 1])))).toThrow(/1000 個品項/);
    expect(() => parseOrderRows(makeRows([['BAR', 'Name', 50001]]))).toThrow(/50000/);
});

test('rejects total SN count beyond the limit', () => {
    const serials = Array.from({ length: 10001 }, (_, i) => `T${String(i).padStart(11, '0')}`);
    expect(() => parseOrderRows(makeRows([['BAR', 'Name', 10001, serials.join(',')]]))).toThrow(/10000 筆 SN/);
});

function multipart(parts) {
    const { Readable } = require('node:stream');
    const boundary = 'wms-fixture-boundary';
    const chunks = parts.flatMap(part => [
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${part.field || 'orderFile'}"${part.name ? `; filename="${part.name}"` : ''}\r\n${part.name ? 'Content-Type: application/octet-stream\r\n' : ''}\r\n`),
        part.buffer || Buffer.from('fixture'), Buffer.from('\r\n')
    ]);
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(chunks);
    return new Promise((resolve, reject) => {
        const req = Readable.from([body]);
        req.headers = { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(body.length) };
        const res = { status(value) { this.statusCode = value; return this; }, json(value) { resolve({ status: this.statusCode, body: value }); } };
        uploadImport(req, res, error => error ? reject(error) : resolve({ file: req.file }));
    });
}

test('real multipart middleware accepts the orderFile field and rejects extra files/fields or wrong extension before the route', async () => {
    expect((await multipart([{ name: 'fixture.csv' }])).file.originalname).toBe('fixture.csv');
    for (const parts of [[{ name: 'x.xlsx' }, { name: 'y.xlsx' }], [{ field: 'extra' }], [{ name: 'x.pdf' }]]) {
        expect(await multipart(parts)).toMatchObject({ status: 400, body: { code: 'IMPORT_NOT_APPLIED' } });
    }
    expect(pool.connect).not.toHaveBeenCalled();
});

test('real multipart middleware rejects bytes beyond 10 MiB', async () => {
    expect(await multipart([{ name: 'large.xlsx', buffer: Buffer.alloc(IMPORT_LIMITS.fileBytes + 1) }])).toMatchObject({ status: 413, body: { code: 'IMPORT_NOT_APPLIED' } });
    expect(pool.connect).not.toHaveBeenCalled();
});

function database({ existing = false, failLog = false, failCommit = false, failRollback = false } = {}) {
    let state = { orders: [], items: [], instances: [], logs: [] }, pending;
    let earlyEvents = 0;
    const result = values => ({ rows: structuredClone(values), rowCount: values.length });
    const client = {
        release: jest.fn(),
        query: jest.fn(async (sql, values = []) => {
            if (sql === 'BEGIN') { pending = structuredClone(state); return result([]); }
            if (sql.startsWith('SET LOCAL') || sql.includes('pg_advisory_xact_lock')) return result([]);
            if (sql === 'ROLLBACK') { if (failRollback) throw new Error('rollback lost'); pending = undefined; return result([]); }
            if (sql === 'COMMIT') { if (failCommit) throw new Error('commit lost'); state = pending; pending = undefined; return result([]); }
            if (sql.startsWith('SELECT id FROM warehouse_import_batches')) return result([]);
            if (sql.startsWith('SELECT * FROM marketplace_intake_orders')) return result([]);
            if (sql.startsWith('INSERT INTO warehouse_import_batches')) return result([{ id: 20 }]);
            if (sql.startsWith('SELECT id FROM orders')) return result(existing ? [{ id: 42 }] : []);
            if (sql.startsWith('INSERT INTO orders')) { pending.orders.push(values); return result([{ id: 11 + pending.orders.length }]); }
            if (sql.startsWith('INSERT INTO order_items')) { pending.items.push(values); return result([{ id: pending.items.length }]); }
            if (sql.startsWith('INSERT INTO order_item_instances')) { pending.instances.push(...values[1]); return result([]); }
            if (sql.startsWith('INSERT INTO operation_logs')) {
                if (failLog) throw new Error('required import log failed');
                pending.logs.push(values); return result([{ id: 22, created_at: '2026-09-09T00:00:00Z' }]);
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        })
    };
    pool.connect.mockResolvedValue(client);
    pool.query.mockImplementation(sql => { if(sql.startsWith('WITH source_keys AS'))return {rows:[]};throw new Error('second pool connection is forbidden'); });
    const io = { emit: jest.fn(() => { if (pending) earlyEvents++; }) };
    return { client, io, state: () => state, earlyEvents: () => earlyEvents };
}
async function invoke(db, buffer = workbook(makeRows([['BAR', 'Name', 2, 'SN:B19B52004735 SN:B19B52004736']]))) {
    const req = { file: { buffer }, user: { id: 7, name: 'Fixture', role: 'dispatcher' }, app: { get: () => db.io } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await importOrder(req, res);
    return { status: res.status.mock.calls.at(-1)?.[0], body: res.json.mock.calls.at(-1)?.[0] };
}

test('valid import writes required log using one client before commit and returns voucherNumber', async () => {
    const db = database();
    const result = await invoke(db);
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ voucherNumber: 'TEST-20260909-1', orderId: 12, serialCount: 2, itemCount: 1, totalQuantity: 2 });
    expect(db.state().logs).toHaveLength(1);
    expect(db.state().instances).toEqual(['B19B52004735', 'B19B52004736']);
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(pool.query).not.toHaveBeenCalled();
    expect(db.earlyEvents()).toBe(0);
    expect(db.io.emit.mock.calls.map(([event]) => event)).toEqual(['new_operation_log', 'new_task']);
    expect(db.io.emit.mock.calls[1][1]).toMatchObject({ imported_by_user_id: 7 });
    expect(db.client.release).toHaveBeenCalledTimes(1);
});

test('source detail persists one batch and distinct marketplace work orders atomically', async () => {
    const db = database();
    const result = await invoke(db, workbook(sourceRows()));
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ batchId: 20, batchNumber: 'PICK-DEMO-1', workOrderCount: 2 });
    expect(db.state().orders).toHaveLength(2);
    expect(db.state().orders.map(row => row.slice(3, 7))).toEqual([[20, 'SHOP-100', 'Shopify', 'Demo store'], [20, 'ONE-200', '1Shop', 'Demo store']]);
    expect(db.state().items).toHaveLength(2);
    expect(db.state().items[0]).toEqual([12, 'SKU-A', 'Product A', 1, '4710000000013', 'SHOP-100', 'Shopify', 'Demo store', 'line-1']);
    expect(db.state().items[1].slice(5)).toEqual(['ONE-200', '1Shop', 'Demo store', 'line-1']);
    expect(db.state().items[1][0]).toBe(13);
    expect(db.earlyEvents()).toBe(0);
});

test('parse failure does not acquire a database connection', async () => {
    const db = database();
    const result = await invoke(db, workbook(makeRows([['BAR', 'Name', 2, 'SN:B19B52004735']])));
    expect(result.body.code).toBe('IMPORT_NOT_APPLIED');
    expect(result.body.message).toMatch(/第 5 列/);
    expect(pool.connect).not.toHaveBeenCalled();
});

test('malformed summary SN rejects before persistence even when explicit SN column is absent', async () => {
    const db = database();
    const rows = sourceRows().map(row => row.slice(0, -1));
    rows[0].push('summary'); rows[2].push('SN:bad');
    const result = await invoke(db, workbook(rows));
    expect(result).toMatchObject({ status: 400, body: { code: 'IMPORT_NOT_APPLIED' } });
    expect(result.body.message).toMatch(/第 3 列.*SN/);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(db.state()).toEqual({ orders: [], items: [], instances: [], logs: [] });
});

test.each(['4.7113E+12', '4.7113e12', '4.7113E+012', '4.7113 E + 12', '4711299273766.0', '4,711,299,273,766'])('rejects malformed barcode %s before a transaction and returns actionable location', async barcode => {
    const db = database();
    const result = await invoke(db, workbook(makeRows([['4711299273766', 'Valid item', 1, ''], [barcode, 'Bad item', 1, '']])));
    expect(result).toMatchObject({ status: 400, body: { code: 'IMPORT_NOT_APPLIED', reason: 'INVALID_BARCODE_FORMAT', issue: { sheet: '出貨', row: 6, cell: 'A6', value: barcode } } });
    expect(result.body.message).toMatch(/文字/);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(db.io.emit).not.toHaveBeenCalled();
    expect(db.state()).toEqual({ orders: [], items: [], instances: [], logs: [] });
});

test.each(['xlsx', 'biff8'])('numeric General barcode in %s is blocked even when underlying digits survive', bookType => {
    const input = workbook(makeRows([[4711299273766, 'Item', 1, '']]), bookType);
    try { parseOrderImport(input); throw Error('expected rejection'); }
    catch (error) {
        expect(error.reason).toBe('INVALID_BARCODE_FORMAT');
        expect(error.issue).toMatchObject({ cell: 'A5', storedValue: '4711299273766' });
        expect(error.message).toMatch(/科學記號/);
    }
});

test('explicit text keeps leading zeros and never expands a truncated CSV exponent', () => {
    const parsed = parseOrderImport(workbook(makeRows([['004711299273766', 'Item', 1, '']]), 'csv'));
    expect(parsed.items[0].barcode).toBe('004711299273766');
    expect(() => parseOrderImport(workbook(makeRows([['4.7113E+12', 'Item', 1, '']]), 'csv'))).toThrow(/科學記號/);
    expect(parseOrderRows(makeRows([['SKU-ALPHA', 'Item', 1, '']])).items[0].barcode).toBe('SKU-ALPHA');
});

test('rejects numeric precision loss and stale formula cells even with a digits-only display', () => {
    for (const cell of [{ t: 'n', v: 1234567890123456, z: '0' }, { t: 'n', v: 4711299273766, z: '0', f: 'B99' }]) {
        const wb = xlsx.utils.book_new();
        const sheet = xlsx.utils.aoa_to_sheet(makeRows([['placeholder', 'Item', 1, '']]));
        sheet.A5 = cell;
        xlsx.utils.book_append_sheet(wb, sheet, '出貨');
        expect(() => parseOrderImport(xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }))).toThrow(/條碼/);
    }
});

test('duplicate voucher returns existing order without modifying it', async () => {
    const db = database({ existing: true });
    const result = await invoke(db);
    expect(result).toMatchObject({ status: 409, body: { code: 'IMPORT_ALREADY_EXISTS', orderId: 42, voucherNumber: 'TEST-20260909-1' } });
    expect(db.state().orders).toHaveLength(0);
    expect(db.io.emit).not.toHaveBeenCalled();
});

test('a required import log failure rolls back the entire order', async () => {
    const db = database({ failLog: true });
    const result = await invoke(db);
    expect(result.body.code).toBe('IMPORT_NOT_APPLIED');
    expect(db.state()).toEqual({ orders: [], items: [], instances: [], logs: [] });
    expect(db.io.emit).not.toHaveBeenCalled();
});

test.each([{ failCommit: true }, { failLog: true, failRollback: true }])('uncertain transaction outcome never reports a safe retry: %j', async options => {
    const db = database(options);
    const result = await invoke(db);
    expect(result.status).toBe(503);
    expect(result.body.code).toBe('IMPORT_RESULT_UNKNOWN');
    expect(db.io.emit).not.toHaveBeenCalled();
    expect(db.client.release.mock.calls[0][0]).toBeInstanceOf(Error);
});

test('notification failure after commit still returns the confirmed order', async () => {
    const db = database();
    db.io.emit.mockImplementation(() => { throw new Error('socket unavailable'); });
    expect((await invoke(db)).status).toBe(201);
    expect(db.state().orders).toHaveLength(1);
});

function pickingSheetRows(footer = '2026/09/17 (四) 17:45:26') {
    return [
        ['理貨單'], ['憑證號碼：TEST-FOOTER-1'], ['接收-客戶/供應商：Footer fixture'], ['出庫倉庫：工業店'],
        ['品項編碼', '品項名稱(規格)', '數量', '摘要'], ['4711299274671', 'Fixture product [SKU-1]', 1, ''],
        ['總計', '', 1], [footer], [], ['', ' ', '', '']
    ];
}

test.each(['xlsx', 'biff8', 'csv'])('ignores the standalone eighth-row print timestamp in a real %s picking sheet', bookType => {
    const parsed = parseOrderImport(workbook(pickingSheetRows(), bookType));
    expect(parsed).toMatchObject({ voucherNumber: 'TEST-FOOTER-1', customerName: 'Footer fixture', totalQuantity: 1, serialCount: 0 });
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({ barcode: '4711299274671', productName: 'Fixture product', quantity: 1, sourceRow: 6 });
});

test.each(['2026/09/17(四)17:45:26', '2026/9/17 （星期四） 17:45:26', '２０２６／０９／１７（四）１７：４５：２６', '2026-09-17 17:45', '2028/02/29 00:00:00'])('recognizes valid timestamp layout %s only at the end', footer => {
    expect(parseOrderRows(pickingSheetRows(footer)).items).toHaveLength(1);
});

test.each(['xlsx', 'biff8'])('supports merged text and formatted Excel date footer cells in %s', bookType => {
    for (const typed of [false, true]) {
        const wb = xlsx.utils.book_new();
        const sheet = xlsx.utils.aoa_to_sheet(pickingSheetRows());
        sheet['!merges'] = [{s:{r:7,c:0},e:{r:7,c:3}}];
        if (typed) sheet.A8 = {t:'n', v:46282.75, z:'yyyy/mm/dd hh:mm:ss'};
        xlsx.utils.book_append_sheet(wb, sheet, '理貨單');
        expect(parseOrderImport(xlsx.write(wb,{type:'buffer',bookType})).items).toHaveLength(1);
    }
});

test.each(['2026/09/17', '2026/02/30 (四) 17:45:26', '2026/09/17 (四) 24:45:26', '2026/09/17 (四) 17:60:26', '2026/09/17 (四) 17:45:60', '4.7113E+12', 'INVALID'])('does not silently discard an unrecognized or invalid final row: %s', footer => {
    expect(() => parseOrderRows(pickingSheetRows(footer))).toThrow(/第 8 列/);
});

test('timestamp-looking rows with product data and timestamps inside the item table still receive validation', () => {
    const rows = pickingSheetRows();
    rows[7].push('Product missing quantity');
    expect(() => parseOrderRows(rows)).toThrow(/第 8 列.*皆必填/);
    rows[7] = ['2026/09/17 (四) 17:45:26'];
    rows.push(['4710000000002', 'Another product', 1]);
    expect(() => parseOrderRows(rows)).toThrow(/第 8 列.*皆必填/);
    const scientific = pickingSheetRows();
    scientific[5][0] = '4.7113E+12';
    expect(() => parseOrderRows(scientific)).toThrow(/第 6 列.*科學記號/);
    const quantity = pickingSheetRows();
    quantity[5][2] = '';
    expect(() => parseOrderRows(quantity)).toThrow(/第 6 列.*皆必填/);
});

test('footer-only sheets cannot create an empty order', () => {
    expect(() => parseOrderRows(makeRows([['2026/09/17 (四) 17:45:26']]))).toThrow(/皆必填/);
});

test('import endpoint saves only the product when the workbook ends with a print timestamp', async () => {
    const db = database();
    const result = await invoke(db, workbook(pickingSheetRows()));
    expect(result).toMatchObject({status:201,body:{voucherNumber:'TEST-FOOTER-1',itemCount:1,totalQuantity:1,serialCount:0}});
    expect(db.state().items).toHaveLength(1);
    expect(db.state().orders).toHaveLength(1);
    expect(db.state().logs).toHaveLength(1);
    expect(db.earlyEvents()).toBe(0);
});

test('source-order imports retain barcode cell validation and source row identity after merge', () => {
    const rows = sourceRows();
    const barcodeColumn = rows[0].findIndex(v => v === '國際條碼');
    expect(barcodeColumn).toBeGreaterThanOrEqual(0);
    const book = xlsx.utils.book_new();
    const sheet = xlsx.utils.aoa_to_sheet(rows);
    const address = xlsx.utils.encode_cell({ r: 1, c: barcodeColumn });
    sheet[address] = { t: 'n', v: 1234567890123456, z: '0' };
    xlsx.utils.book_append_sheet(book, sheet, '來源理貨');
    try { parseOrderImport(xlsx.write(book, { type: 'buffer', bookType: 'xlsx' })); throw Error('expected rejection'); }
    catch (error) {
        expect(error.reason).toBe('INVALID_BARCODE_FORMAT');
        expect(error.issue).toMatchObject({ sheet: '來源理貨', row: 2, cell: address });
    }
});
