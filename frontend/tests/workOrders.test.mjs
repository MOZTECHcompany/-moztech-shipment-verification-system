import test from 'node:test';
import assert from 'node:assert/strict';
import { workOrderBarcode, readImportResult, loadWorkOrdersForPrint, printPreparedWorkOrders } from '../src/utils/workOrders.js';
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
test('batch page printing rejects a work order voided after overview load or moved outside the batch', async () => {
    for (const order of [{ id: 1, import_batch_id: 8, status: 'voided' }, { id: 1, import_batch_id: 9, status: 'pending' }]) {
        const api = { get: async () => ({ data: { order: { ...order, work_barcode: orders[0].workBarcode }, items: [] } }) };
        await assert.rejects(loadWorkOrdersForPrint(api, [orders[0]], { expectedBatchId: 8 }), /已變更或作廢/);
    }
});
test('batch print preparation stops on session changes and aborted navigation without presenting a document', async () => {
    let actor = true, called = 0;
    const controller = new AbortController();
    const api = { get: async (_url, options) => {
        called++; assert.equal(options.signal, controller.signal); actor = false;
        return { data: { order: { id: 1, work_barcode: orders[0].workBarcode }, items: [] } };
    } };
    await assert.rejects(loadWorkOrdersForPrint(api, [orders[0]], { signal: controller.signal, isCurrentSession: () => actor }), /登入帳號已變更/);
    controller.abort();
    await assert.rejects(loadWorkOrdersForPrint(api, [orders[0]], { signal: controller.signal }), /頁面或登入帳號已變更/);
    assert.equal(called, 1);
});
test('the final print boundary blocks a delayed iframe after logout or page disposal', async () => {
    let current = true, printed = 0, removed = 0;
    const frame = { contentWindow: { print: () => printed++ }, remove: () => removed++ };
    // Resource loading has finished after the original click's page disappeared.
    const delayedPrint = () => printPreparedWorkOrders(frame, { canPrint: () => current });
    current = false;
    await assert.rejects(delayedPrint(), /頁面或登入帳號已變更/);
    assert.equal(printed, 0); assert.equal(removed, 1);
});
test('the print boundary restores titles when the browser dialog closes or throws', async () => {
    let printed = 0;
    const frame = { ownerDocument: { title: 'WMS' }, contentDocument: { title: 'frame' }, contentWindow: { print: () => { printed++; assert.equal(frame.ownerDocument.title, 'Batch'); } } };
    await printPreparedWorkOrders(frame, { canPrint: () => true, title: 'Batch' });
    assert.equal(printed, 1); assert.equal(frame.ownerDocument.title, 'WMS'); assert.equal(frame.contentDocument.title, 'frame');
    frame.contentWindow.print = () => { throw new Error('Printer unavailable'); };
    await assert.rejects(printPreparedWorkOrders(frame, { canPrint: () => true, title: 'Batch' }), /Printer unavailable/);
    assert.equal(frame.ownerDocument.title, 'WMS'); assert.equal(frame.contentDocument.title, 'frame');
});
