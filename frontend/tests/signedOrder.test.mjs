import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import XLSX from 'xlsx';
import * as signedOrder from '../src/utils/signedOrder.js';
import * as shippingNotes from '../src/utils/shippingNotes.js';
import * as managementScope from '../src/utils/managementScope.js';
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
    const imports = { react, '@/utils/signedOrder': signedOrder, '@/utils/shippingNotes': shippingNotes, '@/utils/managementScope': managementScope,
        'react-to-print': { useReactToPrint: () => () => {} }, 'date-fns': { format: () => '2026-10-02 12:00' } };
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

const notes = [{ sourceRow: 8, text: '先裝紙箱\n外箱勿貼價格' }, { sourceRow: 12, text: '=1+1 原樣保留' }, { sourceRow: 14, text: '先裝紙箱\n外箱勿貼價格' }];

test('downloaded WMS XLSX keeps one literal, zero-quantity model-code row per source note with blank scan counts', () => {
    const snapshot = {
        order: { document_type: 'adjustment', shipping_notes: notes },
        items: [{ ...items[0], barcode: '0012345', product_code: 'SKU-EXISTING', product_name: '原有品項', picked_quantity: 1, packed_quantity: 1 }],
        instances: [{ order_item_id: 1, serial_number: '000ExactSN' }],
    };
    const rows = signedOrder.signedOrderReportRows(snapshot);
    assert.deepEqual(rows.slice(0, 1), signedOrder.signedOrderReportRows({ ...snapshot, order: { document_type: 'adjustment' } }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '出貨報告');
    const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const sheet = XLSX.read(bytes, { type: 'buffer' }).Sheets['出貨報告'];
    const exported = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    assert.equal(exported.length, 1 + notes.length);
    assert.deepEqual(exported[0], {
        '國際條碼': '0012345', '品項型號': 'SKU-EXISTING', '品項名稱': '原有品項', '應出數量': -1,
        '作業方向': '沖正', '核對件數': 1, '已揀數量(計數)': 1, '已裝箱數量(計數)': 1, 'SN列表': '000ExactSN',
    });
    assert.deepEqual(exported.slice(1), notes.map(note => ({
        '國際條碼': '', '品項型號': 'WMS-NOTE', '品項名稱': note.text, '應出數量': 0,
        '作業方向': '', '核對件數': '', '已揀數量(計數)': '', '已裝箱數量(計數)': '', 'SN列表': '',
    })));
    assert.equal(sheet.C4.t, 's', 'formula-like note content stays a string cell');
    assert.equal(sheet.C4.f, undefined);
    assert.equal(sheet.D4.t, 'n');
    assert.equal(snapshot.items.length, 1);
    assert.equal(snapshot.instances.length, 1);
});

const header = await component('WarehouseOrderHeader.jsx', 'WarehouseOrderHeader');
const noteArea = tree => nodes(tree, node => node.type === 'aside' && node.props['aria-label'] === '出貨備註｜不用掃描');

test('picking and packing headers show notes beside the voucher in focus mode without changing item progress', () => {
    const props = { user: { id: 7, role: 'picker' }, items, stats: { packedSkus: 1, totalSkus: 2, totalQuantity: 2, totalPickedQty: 2, totalPackedQty: 1 } };
    for (const status of ['picking', 'packing']) for (const isFocusMode of [false, true]) {
        const order = { voucher_number: 'FIXTURE-WMS-001', customer_name: '測試客戶', status, shipping_notes: notes };
        const tree = header({ ...props, order, isFocusMode });
        const group = nodes(tree, node => node.type === 'div' && node.props.children.some(child => child?.type === 'h1' && text(child) === order.voucher_number));
        assert.equal(group.length, 1);
        const areas = noteArea(group[0]);
        assert.equal(areas.length, 1);
        assert.deepEqual(nodes(areas[0], node => node.type === 'li').map(text), notes.map(note => note.text));
        assert.equal(nodes(areas[0], node => node.type === 'ul')[0].props.tabIndex, 0);
        assert.ok(nodes(tree, node => ['ShippingLabel','PickingList'].includes(node.type)).every(node => node.props.items === items));
        assert.equal(text(tree).includes('應核對件數'), !isFocusMode);
    }
    const legacy = header({ ...props, order: { voucher_number: 'LEGACY', status: 'picking' } });
    assert.equal(noteArea(legacy).length, 0);
});
