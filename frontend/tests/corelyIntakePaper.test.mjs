import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
const source = await fs.readFile(new URL('../src/components/CorelyIntake.jsx', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'jsx', format: 'cjs' }), module = { exports: {} };
vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    if (name === '@/api/api.js') return {};
    if (name === './CorelyHandover') return { default: () => null };
    if (name === '@/ui') return { Button: () => null };
    if (name === './OrderBarcode') return { OrderBarcode: ({ value, label }) => React.createElement('span', { 'data-barcode': value }, label) };
    if (name === 'react-to-print') return { useReactToPrint: () => () => {} };
    return require(name);
} });
test('Corely packet keeps aggregate quantities and all source lines with work barcode and SN requirement', () => {
    const items = Array.from({ length: 80 }, (_, i) => ({ id: 'line-' + i, sku: 'SKU-' + i, name: '商品-' + i, barcode: '000' + i, quantity: 2, serials: i === 79 ? [{ value: 'SN-1' }, { value: 'SN-2' }] : [] }));
    const data = { orderNumber: 'CORELY-ORDER', brand: 'MOZTECH', printOwnerName: '領單人', products: [{ sku: 'SKU', name: '商品', barcode: '0000', quantity: 160 }], snapshot: { workBarcode: 'WT0123456789ABCDEF01', items } };
    const html = renderToStaticMarkup(React.createElement(module.exports.CorelyIntakePaper, { data }));
    assert.match(html, /Corely 預揀總表/); assert.match(html, /Corely 訂單作業明細/);
    assert.match(html, /SKU-79/); assert.match(html, /160/); assert.match(html, /須核對 2 組 SN/);
    assert.match(html, /data-barcode="WT0123456789ABCDEF01"/);
    assert.doesNotMatch(html, /ECOUNT|已核銷|正式出庫/);
});
