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
            if (sql.startsWith('SELECT id FROM orders')) return result(existing ? [{ id: 42 }] : []);
            if (sql.startsWith('INSERT INTO orders')) { pending.orders.push(values); return result([{ id: 12 }]); }
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
    pool.query.mockImplementation(() => { throw new Error('second pool connection is forbidden'); });
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

test('parse failure does not acquire a database connection', async () => {
    const db = database();
    const result = await invoke(db, workbook(makeRows([['BAR', 'Name', 2, 'SN:B19B52004735']])));
    expect(result.body.code).toBe('IMPORT_NOT_APPLIED');
    expect(result.body.message).toMatch(/第 5 列/);
    expect(pool.connect).not.toHaveBeenCalled();
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
