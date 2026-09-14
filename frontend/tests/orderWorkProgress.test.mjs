import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkItems, filterWorkItems, workStage } from '../src/utils/orderWorkProgress.js';

const items = [
    { id: 1, quantity: 2, product_name: '隨行充電器', product_code: 'CHARGER', barcode: '001', picked_quantity: 2, packed_quantity: 0 },
    { id: 2, quantity: 2, product_name: '傳輸線', product_code: 'CABLE', barcode: '002', picked_quantity: 0, packed_quantity: 0 }
];
const instances = [
    { order_item_id: 2, serial_number: 'SN-A', status: 'picked' },
    { order_item_id: 2, serial_number: 'SN-B', status: 'pending' }
];

test('picking focus hides picked quantity rows but preserves partial serial rows; packing still needs both', () => {
    const pick = buildWorkItems(items, instances, 'pick');
    assert.deepEqual(filterWorkItems(pick, '', true).map(row => row.item.id), [2]);
    assert.equal(pick[1].remaining, 1);
    assert.equal(pick[1].ratio, 0.5);
    const pack = buildWorkItems(items, instances, 'pack');
    assert.equal(filterWorkItems(pack, '', true).length, 2);
    assert.equal(pack.reduce((sum, row) => sum + row.remaining, 0), 4);
});

test('missing or extra serials and zero demand never appear complete', () => {
    for (const quantity of [0, 1, 3]) {
        const row = buildWorkItems([{ ...items[1], quantity, picked_quantity: 100 }], instances.map(s => ({ ...s, status: 'packed' })), 'pack')[0];
        assert.equal(row.complete, false);
        assert.equal(filterWorkItems([row], '', true).length, 1);
        assert.ok(Number.isFinite(row.ratio));
    }
});

test('product, barcode and SN search is trimmed and case insensitive, while focus remains explicit', () => {
    const rows = buildWorkItems(items, instances, 'pick');
    for (const query of ['傳輸', ' CABLE ', '002', ' sn-b ']) assert.equal(filterWorkItems(rows, query)[0].item.id, 2);
    assert.equal(filterWorkItems(rows, 'charger', true).length, 0);
    assert.equal(filterWorkItems(rows, 'charger', false).length, 1);
    assert.equal(filterWorkItems(rows, 'unknown').length, 0);
});

test('stage follows warehouse role and admin current task', () => {
    assert.equal(workStage('picker', 'picked'), 'pick');
    assert.equal(workStage('packer', 'picked'), 'pack');
    assert.equal(workStage('admin', 'picking'), 'pick');
    assert.equal(workStage('superadmin', 'packing'), 'pack');
});


test('packing cannot appear complete when ordinary quantity data lacks picking verification', () => {
    const row = buildWorkItems([{ id: 1, quantity: 2, picked_quantity: 1, packed_quantity: 2 }], [], 'pack')[0];
    assert.equal(row.complete, false);
    assert.equal(filterWorkItems([row], '', true).length, 1);
});
