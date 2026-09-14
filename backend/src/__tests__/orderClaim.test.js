jest.mock('../config/database', () => ({ pool: { connect: jest.fn(), query: jest.fn() } }));

const { randomUUID } = require('node:crypto');
const { parseClaimCommand } = require('../services/orderClaimService');
const { createWorkBarcode } = require('../services/warehouseBatch');
const { parseOrderRows } = require('../services/orderImportParser');

test('claim identity binds the exact barcode and explicit stage, not a proposed operator', () => {
    const body = { barcode: ' 001-A ', stage: 'pick', commandId: randomUUID(), expectedActorId: 3 };
    const command = parseClaimCommand(body);
    expect(command.barcode).toBe('001-A');
    expect(parseClaimCommand({ ...body, barcode: '001A' }).hash).not.toBe(command.hash);
    expect(parseClaimCommand({ ...body, stage: 'pack' }).hash).not.toBe(command.hash);
    expect(parseClaimCommand({ ...body, expectedActorId: 4 }).hash).not.toBe(command.hash);
    expect(parseClaimCommand({ ...body, commandId: body.commandId.toUpperCase() }).commandId).toBe(command.commandId);
    expect(() => parseClaimCommand({ ...body, ownerId: 4 })).toThrow();
});

test.each([null, {}, { barcode: ['wrong'] }, { barcode: 'X', stage: 'automatic', commandId: randomUUID() }, { barcode: 'X', stage: 'pick', commandId: 'not-a-uuid' }])('malformed claim input cannot become a command: %j', input => {
    expect(() => parseClaimCommand(input)).toThrow();
});

test.each([undefined, null, '3', 0, -1, 1.5])('claim requires an explicit valid actor precondition: %j', expectedActorId => {
    expect(() => parseClaimCommand({ barcode: 'X', stage: 'pick', commandId: randomUUID(), expectedActorId })).toThrow();
});

test('work barcodes are short opaque uppercase ASCII, distinct from source identifiers', () => {
    const values = Array.from({ length: 100 }, createWorkBarcode);
    expect(new Set(values).size).toBe(100);
    values.forEach(value => expect(value).toMatch(/^WT[0-9A-F]{18}$/));
});

test('batch groups keep store boundaries and each child customer while preserving same-source duplicate SKU rows', () => {
    const header = ['理貨單號', '商城訂單編號', '平台', '店鋪', '品項編碼', '品項名稱', '國際條碼', '數量', '客戶名稱'];
    const a = ['ERP-1', '0001', 'Shopify', 'A', 'SKU', 'Name', '0000000123', 1, 'Customer A'];
    const b = ['ERP-1', '0001', 'Shopify', 'B', 'SKU', 'Name', '0000000123', 2, 'Customer B'];
    const parsed = parseOrderRows([header, a, a, b]);
    expect(parsed.workOrders).toHaveLength(2);
    expect(parsed.workOrders[0].items).toHaveLength(2);
    expect(parsed.workOrders.map(o => o.customerName)).toEqual(['Customer A', 'Customer B']);
    expect(() => parseOrderRows([header, a, [...a.slice(0, -1), 'Other person']])).toThrow(/客戶名稱不一致/);
});
