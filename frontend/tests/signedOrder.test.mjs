import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as signedOrder from '../src/utils/signedOrder.js';
import { buildWorkItems } from '../src/utils/orderWorkProgress.js';

const items = [
    { id: 1, barcode: '4711299274640', quantity: 1, quantity_sign: -1, signed_quantity: -1, picked_quantity: 0, packed_quantity: 0 },
    { id: 2, barcode: '4711299274633', quantity: 1, quantity_sign: 1, signed_quantity: 1, picked_quantity: 0, packed_quantity: 0 },
];
test('mixed signed quantities remain faithful to ERP and need two scan targets despite a zero net', () => {
    assert.deepEqual(items.map(signedOrder.signedQuantity), [-1, 1]);
    assert.deepEqual(signedOrder.signedOrderTotals(items), { positive: 1, negative: 1, work: 2, net: 0 });
    for (const stage of ['pick', 'pack']) {
        const rows = buildWorkItems(items, [], stage);
        assert.equal(rows.reduce((sum, row) => sum + row.remaining, 0), 2);
        assert.ok(rows.every(row => row.complete === false));
    }
    assert.equal(signedOrder.printedQuantity(items[0], { document_type: 'adjustment' }), '-1');
    assert.equal(signedOrder.printedQuantity(items[1], { document_type: 'adjustment' }), '+1');
    assert.equal(signedOrder.printedQuantity(items[1], { document_type: 'shipment' }), '1');
});
test('ordinary existing orders retain positive quantities and do not gain reversal labels', () => {
    const ordinary = { quantity: 5 };
    assert.equal(signedOrder.signedQuantity(ordinary), 5);
    assert.equal(signedOrder.signedDocumentLabel(undefined), null);
    assert.equal(signedOrder.isSignedDocument({}), false);
    assert.deepEqual(signedOrder.signedOrderTotals([ordinary]), { positive: 5, negative: 0, work: 5, net: 5 });
});

test('signed Excel report retains ERP signed amounts, independent verification counts and the correct row SN', () => {
    const rows = signedOrder.signedOrderReportRows({ order: { document_type: 'adjustment' }, items,
        instances: [{ order_item_id: 1, serial_number: 'REMOVED-SN' }, { order_item_id: 2, serial_number: 'ADDED-SN' }],
    });
    assert.deepEqual(rows.map(row => row['應出數量']), [-1, 1]);
    assert.deepEqual(rows.map(row => row['核對件數']), [1, 1]);
    assert.deepEqual(rows.map(row => row['作業方向']), ['沖正', '新增']);
    assert.deepEqual(rows.map(row => row['SN列表']), ['REMOVED-SN', 'ADDED-SN']);
    assert.deepEqual(rows.map(row => row['國際條碼']), ['4711299274640', '4711299274633']);
});

async function component(file, name) {
    const source = await readFile(new URL(`../src/components/${file}`, import.meta.url), 'utf8');
    const { code } = await transform(source, { loader: 'jsx', format: 'cjs' });
    const module = { exports: {} };
    const generic = new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) });
    const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), useRef: () => ({ current: null }) };
    const imports = { react, '@/utils/signedOrder': signedOrder, 'react-to-print': { useReactToPrint: () => () => {} }, 'date-fns': { format: () => '2026-10-02 12:00' } };
    vm.runInNewContext(code, { module, exports: module.exports, require: value => imports[value] || generic });
    return module.exports[name];
}
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : (node.props?.children || []).flat(Infinity).map(text).join(' ');
const nodes = (node, predicate) => !node || typeof node !== 'object' ? [] : [...(predicate(node) ? [node] : []), ...(node.props?.children || []).flat(Infinity).flatMap(child => nodes(child, predicate))];
const notice = await component('SignedOrderNotice.jsx', 'SignedOrderNotice');
const badge = await component('SignedOrderNotice.jsx', 'SignedQuantityBadge');
const printSummary = await component('SignedOrderNotice.jsx', 'SignedOrderPrintSummary');
const shipping = await component('LabelPrinter.jsx', 'ShippingLabel');
const picking = await component('LabelPrinter.jsx', 'PickingList');

test('signed work notice explains added and reversed targets without old-order lookup or extra approvals', () => {
    const tree = notice({ order: { document_type: 'adjustment' }, items });
    assert.match(text(tree), /異動理貨單/);
    assert.match(text(tree), /新增\s+1\s+件／沖正\s+1\s+件，共需核對\s+2\s+件/);
    assert.doesNotMatch(text(tree), /原單|退貨|審核|暫停|已完成/);
    assert.match(text(badge({ item: items[0] })), /-1\s+件 ·\s+沖正/);
    assert.match(text(badge({ item: items[1], showPositive: true })), /\+\s+1\s+件 ·\s+新增/);
    assert.equal(notice({ order: {}, items }), null);
    assert.equal(badge({ item: items[1] }), null);
});
test('both printable documents preserve negative and positive ERP row quantities and absolute verification counts', () => {
    const props = { order: { voucher_number: '2026/10/02 -27', document_type: 'adjustment' }, items };
    for (const render of [shipping, picking]) {
        const tree = render(props);
        const cells = nodes(tree, node => node.type === 'td').map(text);
        assert.ok(cells.includes('-1'));
        assert.ok(cells.includes('+1'));
        assert.match(text(tree), /核對件數/);
        assert.ok(nodes(tree, node => node.type === 'SignedOrderPrintSummary').length === 1);
    }
    assert.match(text(printSummary(props)), /新增\s+1\s+件／沖正\s+1\s+件 · 核對\s+2\s+件/);
});
