import test from 'node:test';
import assert from 'node:assert/strict';
import { workOrderBarcode, readImportResult, loadWorkOrdersForPrint } from '../src/utils/workOrders.js';
const orders = [{ orderId: 1, voucherNumber: 'WT001122334455667788', workBarcode: 'WT001122334455667788' }, { orderId: 2, voucherNumber: 'WT111122334455667788', workBarcode: 'WT111122334455667788' }];
test('typed work code is preferred while legacy voucher fallback remains exact', () => {
    assert.equal(workOrderBarcode({ work_barcode: orders[0].workBarcode, voucher_number: 'RAW123' }), orders[0].workBarcode);
    assert.equal(workOrderBarcode({ voucher_number: '000123' }), '000123');
});
test('source import requires the complete distinct set of work orders; legacy imports remain accepted', () => {
    const batch = { batchId: 1, batchNumber: 'ERP001', workOrderCount: 2, orders };
    assert.equal(readImportResult(batch).isBatch, true);
    assert.equal(readImportResult({ ...batch, orders: [orders[0], orders[0]] }), null);
    assert.equal(readImportResult({ ...batch, workOrderCount: 3 }), null);
    assert.equal(readImportResult({ ...batch, orders: [{ ...orders[0], workBarcode: 'raw-source' }, orders[1]] }), null);
    assert.equal(readImportResult({ orderId: 2, voucherNumber: '000123' }).isBatch, false);
});
test('batch printing reads all full snapshots and preserves per-work-order product grouping in import order', async () => {
    const reads = [];
    const api = { get: async url => { reads.push(url); const id = Number(url.split('/')[3]); return { data: { order: { id, work_barcode: orders[id - 1].workBarcode }, items: [{ id: id * 10, product_name: `Product ${id}` }] } }; } };
    const docs = await loadWorkOrdersForPrint(api, orders);
    assert.deepEqual(reads, ['/api/orders/1/work-snapshot', '/api/orders/2/work-snapshot']);
    assert.deepEqual(docs.map(doc => doc.items[0].id), [10, 20]);
});
test('a partial or wrong snapshot prevents presenting a partial batch as printable', async () => {
    await assert.rejects(loadWorkOrdersForPrint({ get: async () => ({ data: { order: { id: 999 }, items: [] } }) }, orders), /不完整/);
    await assert.rejects(loadWorkOrdersForPrint({}, [orders[0], orders[0]]), /不完整/);
});
