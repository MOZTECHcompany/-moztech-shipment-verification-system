import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { transform } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as sourceOrders from '../src/utils/sourceOrders.js';
import * as orderBarcode from '../src/utils/orderBarcode.js';
import * as workOrders from '../src/utils/workOrders.js';

const require = createRequire(import.meta.url);
async function component(file, overrides = {}) {
    const source = await readFile(new URL(`../src/components/${file}.jsx`, import.meta.url), 'utf8');
    const { code } = await transform(source, { loader: 'jsx', format: 'cjs' });
    const module = { exports: {} };
    vm.runInNewContext(code, { module, exports: module.exports, require: name => overrides[name] || require(name) });
    return module.exports;
}
const barcodeComponents = await component('OrderBarcode', { '../utils/orderBarcode': orderBarcode });
const { PickingList, ShippingLabel } = await component('LabelPrinter', {
    './OrderBarcode': barcodeComponents,
    '../utils/sourceOrders': sourceOrders,
    '../utils/workOrders': workOrders,
    '@/api/api.js': {},
    'react-to-print': { useReactToPrint: () => () => {} },
});
const order = { voucher_number: 'BATCH-001', customer_name: '合成測試' };
const items = [
    { id: 1, product_name: '來源一商品甲', product_code: 'SKU-A', barcode: '471001', quantity: 2, source_order_number: '000123', source_platform: '蝦皮', source_store: 'A' },
    { id: 2, product_name: '來源一商品乙', product_code: 'SKU-B', barcode: '471002', quantity: 3, source_order_number: '000123', source_platform: '蝦皮', source_store: 'A', source_line_id: 'L2' },
    { id: 3, product_name: '來源二商品', product_code: 'SKU-A', barcode: '471001', quantity: 1, source_order_number: 'OTHER-1', source_platform: '1Shop', source_store: 'B' },
];

test('picking print retains the parent code and prints exactly one barcode per source group with its product rows', () => {
    const html = renderToStaticMarkup(React.createElement(PickingList, { order, items }));
    assert.equal((html.match(/aria-label="理貨主單條碼 BATCH-001"/g) || []).length, 1);
    assert.equal((html.match(/aria-label="商城訂單定位條碼（不可認領） 000123"/g) || []).length, 1);
    assert.equal((html.match(/aria-label="商城訂單定位條碼（不可認領） OTHER-1"/g) || []).length, 1);
    const firstGroup = html.split('data-source-order="000123"')[1].split('data-source-order="OTHER-1"')[0];
    assert.match(firstGroup, /來源一商品甲/);
    assert.match(firstGroup, /來源一商品乙/);
    assert.match(firstGroup, /明細 L2/);
    assert.doesNotMatch(firstGroup, /來源二商品/);
    assert.match(html, /6 件/);
});

test('same source number in two stores stays in two labelled print groups and unsupported IDs stay visible', () => {
    const rows = [items[0], { ...items[2], source_order_number: '000123' }, { ...items[2], id: 4, source_order_number: '中文訂單' }];
    const html = renderToStaticMarkup(React.createElement(PickingList, { order, items: rows }));
    assert.equal((html.match(/data-source-order="000123"/g) || []).length, 2);
    assert.match(html, /蝦皮 · A · 000123/);
    assert.match(html, /1Shop · B · 000123/);
    assert.match(html, /中文訂單/);
    assert.match(html, /此單號請手動輸入，未產生條碼。/);
});

test('legacy print keeps all rows and the original shipping barcode without source sections', () => {
    const rows = items.map(({ id, product_name, product_code, barcode, quantity }) => ({ id, product_name, product_code, barcode, quantity }));
    const picking = renderToStaticMarkup(React.createElement(PickingList, { order, items: rows }));
    const shipping = renderToStaticMarkup(React.createElement(ShippingLabel, { order, items: rows }));
    assert.doesNotMatch(picking, /商城訂單分單對照/);
    for (const row of rows) assert.ok(picking.includes(row.product_name));
    assert.match(shipping, /aria-label="訂單條碼 BATCH-001"/);
});


test('independent marketplace work order prints one typed claim barcode and ERP/source/owners with all its items', () => {
    const work = { ...order, id: 4, voucher_number: 'WT012345678901234567', work_barcode: 'WT012345678901234567', import_batch_id: 1, batch_number: 'ERP-BATCH-001', source_order_number: '000123', source_platform: 'Shopify', source_store: '店 A', picker_name: '合成揀貨員', packer_name: '合成裝箱員' };
    const html = renderToStaticMarkup(React.createElement(PickingList, { order: work, items: items.slice(0, 2), instances: [{ order_item_id: 2, serial_number: 'TESTSN000001' }, { order_item_id: 99, serial_number: 'OTHER0000001' }] }));
    assert.equal((html.match(/aria-label="工作單認領條碼 WT012345678901234567"/g) || []).length, 1);
    assert.doesNotMatch(html, /商城訂單定位條碼/);
    for (const text of ['ERP-BATCH-001', 'Shopify · 店 A · 000123', '合成揀貨員', '合成裝箱員', '來源一商品甲', '來源一商品乙', '5 件', 'TESTSN000001']) assert.ok(html.includes(text), text);
    assert.doesNotMatch(html, /來源二商品|OTHER0000001/);
});
