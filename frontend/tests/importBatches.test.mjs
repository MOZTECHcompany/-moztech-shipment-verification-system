import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { transform } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as batches from '../src/utils/importBatches.js';
import * as sourceOrders from '../src/utils/sourceOrders.js';

const totals = { workOrderCount: 3, activeWorkOrderCount: 2, itemCount: 4, totalQuantity: 7, pickedQuantity: 3, packedQuantity: 1, serialCount: 3, serialMismatchCount: 0,
    statusCounts: { pending: 1, picking: 0, picked: 0, packing: 1, completed: 0, voided: 1 }, voidedTotals: { workOrderCount: 1, itemCount: 1, totalQuantity: 9 } };
const page = (changes = {}) => ({ batch: { id: 8, batch_number: 'TEST-BATCH', created_by_name: 'Test Dispatcher', created_at: '2026-09-15T00:00:00Z' },
    children: [{ id: 1, import_batch_id: 8, source_platform: 'Shopify', source_store: 'A', source_order_number: 'SAME', work_barcode: 'WT001122334455667788', status: 'packing', picker_name: 'Test Picker', packer_name: 'Test Packer', total_quantity: 4, picked_quantity: 3, packed_quantity: 1 }],
    summary: totals, productTotals: [{ product_code: 'SKU-A', barcode: '001-002', product_names: ['Test Product'], work_order_count: 2, total_quantity: 7, picked_quantity: 3, packed_quantity: 1 }],
    pagination: { limit: 30, nextCursor: 'next', totalWorkOrders: 3 }, workOrderIds: [1, 2, 3], printableWorkOrderIds: [1, 2], ...changes });
const deferredApi = () => {
    const requests = [];
    return { requests, get: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })) };
};

test('batch route ids and page identities reject partial, cross-batch, or ambiguous data', () => {
    for (const value of ['8x', '-1', '0', '', '2147483648', '9007199254740992']) assert.equal(batches.importBatchId(value), null);
    assert.equal(batches.importBatchId('8'), 8);
    assert.equal(batches.validateBatchPage(page(), 8).summary.totalQuantity, 7);
    for (const bad of [page({ batch: { id: 9 } }), page({ children: [{ id: 1, import_batch_id: 9 }] }), page({ printableWorkOrderIds: [2, 2] }), page({ printableWorkOrderIds: [1, 9] }), page({ workOrderIds: [1, 1, 3] })]) {
        assert.throws(() => batches.validateBatchPage(bad, 8), /不完整/);
    }
});

test('batch reads take complete server totals while paginating only child rows', async () => {
    const api = deferredApi(), updates = [];
    const reader = batches.createBatchReader({ api, batchId: 8, onState: state => updates.push(state) });
    const first = reader.load();
    assert.equal(api.requests[0].url, '/api/order-import-batches/8');
    assert.deepEqual(api.requests[0].options.params, { limit: 30 });
    api.requests[0].resolve({ data: page() }); await first;
    const second = reader.load('next');
    assert.deepEqual(api.requests[1].options.params, { limit: 30, cursor: 'next' });
    api.requests[1].resolve({ data: page({ children: [{ id: 3, import_batch_id: 8, status: 'voided' }], pagination: { limit: 30, nextCursor: null, totalWorkOrders: 3 } }) });
    assert.equal(await second, true);
    assert.equal(reader.getState().data.summary.totalQuantity, 7);
    assert.deepEqual(reader.getState().data.children.map(child => child.id), [3]);
    assert.deepEqual(reader.getState().data.printableWorkOrderIds, [1, 2]);
    assert.equal(reader.getState().cursor, 'next');
    reader.dispose();
});

test('a later refresh supersedes an older page even when the transport ignores abort', async () => {
    const api = deferredApi();
    const reader = batches.createBatchReader({ api, batchId: 8, onState: () => {} });
    const old = reader.load('next'); const fresh = reader.load();
    assert.equal(api.requests[0].options.signal.aborted, true);
    api.requests[1].resolve({ data: page({ summary: { ...totals, packedQuantity: 2 } }) }); await fresh;
    api.requests[0].resolve({ data: page() }); assert.equal(await old, false);
    assert.equal(reader.getState().data.summary.packedQuantity, 2);
    assert.equal(reader.getState().cursor, null);
    reader.dispose();
});

test('leaving the batch page aborts its read and suppresses all late state changes', async () => {
    const api = deferredApi(), states = [];
    const reader = batches.createBatchReader({ api, batchId: 8, onState: state => states.push(state) });
    const read = reader.load(); reader.dispose();
    assert.equal(api.requests[0].options.signal.aborted, true);
    api.requests[0].resolve({ data: page() }); assert.equal(await read, false);
    assert.deepEqual(states.map(state => state.phase), ['loading']);
    assert.equal(await reader.load(), false);
    assert.equal(api.requests.length, 1);
});

test('account or token changes clear prior batch data and block both new and late reads', async () => {
    const storage = new Map([['wms_user', JSON.stringify({ id: 7, role: 'picker' })], ['wms_token', JSON.stringify('token-a')]]);
    const session = () => batches.batchSessionMatches({ getItem: key => storage.get(key) }, { id: 7, role: 'picker' }, 'token-a');
    assert.equal(session(), true);
    const api = deferredApi(), reader = batches.createBatchReader({ api, batchId: 8, onState: () => {}, isCurrentSession: session });
    const pending = reader.load(); storage.set('wms_token', JSON.stringify('token-b'));
    api.requests[0].resolve({ data: page() }); assert.equal(await pending, false);
    assert.equal(reader.getState().phase, 'sessionChanged'); assert.equal(reader.getState().data, null);
    assert.equal(await reader.load(), false); assert.equal(api.requests.length, 1);
    storage.set('wms_token', JSON.stringify('token-a')); storage.set('wms_user', JSON.stringify({ id: 9, role: 'picker' }));
    assert.equal(session(), false);
    reader.dispose();
});

test('read failures keep an explicitly stale snapshot and never fabricate empty totals', async () => {
    const api = deferredApi(), reader = batches.createBatchReader({ api, batchId: 8, onState: () => {} });
    const initial = reader.load(); api.requests[0].resolve({ data: page() }); await initial;
    const refresh = reader.load(); api.requests[1].reject({ response: { status: 503, data: { message: '暫時無法查詢' } } });
    assert.equal(await refresh, false);
    assert.equal(reader.getState().phase, 'error'); assert.equal(reader.getState().message, '暫時無法查詢');
    assert.equal(reader.getState().data.summary.totalQuantity, 7);
    reader.dispose();
});

test('the actual batch page displays active totals, voided history, owners, and only active print ids', async () => {
    const require = createRequire(import.meta.url);
    const source = await readFile(new URL('../src/components/ImportBatchView.jsx', import.meta.url), 'utf8');
    const { code } = await transform(source, { loader: 'jsx', format: 'cjs' });
    let stateIndex = 0, printProps;
    const fakeReact = { ...React, useEffect: () => {}, useRef: initial => ({ current: initial }), useState: initial => [stateIndex++ === 0 ? { phase: 'ready', data: page(), loadedAt: '2026-09-15T00:00:01Z' } : initial, () => {}] };
    const overrides = {
        react: fakeReact,
        'react-router-dom': { useParams: () => ({ batchId: '8' }), Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children) },
        '@/api/api.js': {}, '@/ui': { Button: ({ children, ...props }) => React.createElement('button', props, children) },
        './LabelPrinter': { BatchPrintLabels: props => { printProps = props; return React.createElement('button', null, '批量列印工作單'); } },
        '../utils/sourceOrders': sourceOrders, '../utils/importBatches': batches,
    };
    const module = { exports: {} };
    vm.runInNewContext(code, { module, exports: module.exports, require: name => overrides[name] || require(name), localStorage: { getItem: () => null } });
    const html = renderToStaticMarkup(React.createElement(module.exports.ImportBatchView, { user: { id: 7, role: 'picker' } }));
    assert.match(html, /TEST-BATCH/); assert.match(html, /批次商品總表/); assert.match(html, /001-002/);
    assert.match(html, /Test Picker/); assert.match(html, /Test Packer/); assert.match(html, /已作廢 1 張、1 個品項、9 件/);
    assert.match(html, /href="\/order\/1"/); assert.match(html, /前往作業看板認領/);
    assert.deepEqual(Array.from(printProps.orders, row => row.id), [1, 2]); assert.equal(printProps.expectedBatchId, 8);
    assert.doesNotMatch(html, /認領整批|封箱|已出貨/);
});
