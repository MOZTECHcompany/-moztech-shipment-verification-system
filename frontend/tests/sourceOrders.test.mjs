import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOrderKey, groupSourceOrders, findSourceOrders, filterSourceWorkItems, resolveSourceScanTarget, orderChangeItemIdentity } from '../src/utils/sourceOrders.js';
import { buildWorkItems } from '../src/utils/orderWorkProgress.js';

const item = (id, number, platform = '蝦皮', store = 'A', extra = {}) => ({
    id, barcode: '471001', quantity: 2, picked_quantity: 0, packed_quantity: 0,
    source_order_number: number, source_platform: platform, source_store: store, ...extra,
});

test('source identity keeps original order IDs, store boundaries and individual repeated SKU lines', () => {
    const items = [item(1, '000123'), item(2, '000123', '蝦皮', 'A', { source_line_id: 'second' }), item(3, '000123', '1Shop'), item(4, '123'), item(5, null)];
    const groups = groupSourceOrders(items);
    assert.equal(groups.length, 3);
    assert.deepEqual(groups[0].items.map(row => row.id), [1, 2]);
    assert.equal(findSourceOrders(groups, '000123').length, 2);
    assert.equal(findSourceOrders(groups, '123').length, 1);
    assert.equal(findSourceOrders(groups, '00123').length, 0);
    assert.notEqual(sourceOrderKey(item(6, 'x', 'a|b', 'c')), sourceOrderKey(item(7, 'x', 'a', 'b|c')));
    assert.equal(sourceOrderKey({}), null);
});

test('selection narrows the view without mutating batch totals or dropping unassigned legacy rows', () => {
    const rows = buildWorkItems([item(1, 'A'), item(2, 'B'), item(3, null)], [], 'pick');
    const selected = filterSourceWorkItems(rows, { query: 'A', selectedKey: sourceOrderKey(rows[0].item) });
    assert.deepEqual(selected.map(row => row.item.id), [1]);
    assert.equal(rows.reduce((sum, row) => sum + row.quantity, 0), 6);
    assert.equal(filterSourceWorkItems(rows), rows);
    assert.deepEqual(filterSourceWorkItems(rows, { query: 'missing' }), []);
});

test('quantity scan targets only the selected marketplace order and refuses ambiguous lines', () => {
    const items = [item(1, 'A'), item(2, 'B')];
    const args = { items, scanValue: '471001', type: 'pick' };
    assert.ok(resolveSourceScanTarget(args).error);
    assert.deepEqual(resolveSourceScanTarget({ ...args, selectedKey: sourceOrderKey(items[1]) }), { orderItemId: 2 });
    assert.ok(resolveSourceScanTarget({ ...args, selectedKey: sourceOrderKey(items[1]), unresolved: true }).error);
    assert.ok(resolveSourceScanTarget({ ...args, items: [...items, item(3, 'B')], selectedKey: sourceOrderKey(items[1]) }).error);
    assert.ok(resolveSourceScanTarget({ ...args, selectedKey: sourceOrderKey(items[1]), type: 'pack' }).error);
    assert.ok(resolveSourceScanTarget({ ...args, items: [items[0], { ...items[1], picked_quantity: 2 }], selectedKey: sourceOrderKey(items[1]) }).error);
    assert.deepEqual(resolveSourceScanTarget({ ...args, items: [item(1, null), item(2, null)] }), {}, 'legacy scanning remains server allocated');
});

test('selected source validates SN ownership and preserves full, prefixed and supported numeric scans', () => {
    const items = [item(1, 'A'), item(2, 'B')];
    const instances = [{ order_item_id: 1, serial_number: 'ABC12345678' }, { order_item_id: 2, serial_number: 'SNOTHER99' }];
    const args = { items, instances, selectedKey: sourceOrderKey(items[0]), type: 'pick' };
    for (const scanValue of ['ABC12345678', 'SN：abc12345678', '12345678']) {
        assert.deepEqual(resolveSourceScanTarget({ ...args, scanValue }), { orderItemId: 1 });
    }
    assert.ok(resolveSourceScanTarget({ ...args, scanValue: 'SNOTHER99' }).error);
    assert.ok(resolveSourceScanTarget({ ...args, scanValue: '471001' }).error, 'SN item cannot become a quantity scan');
    assert.ok(resolveSourceScanTarget({ ...args, instances: [...instances, { order_item_id: 2, serial_number: 'XYZ12345678' }], scanValue: '12345678' }).error);
});

test('existing item changes identify a row and never overwrite its marketplace ownership', () => {
    assert.deepEqual(orderChangeItemIdentity({ isNew: false, orderItemId: 4, sourceOrderNumber: 'WRONG' }), { orderItemId: 4 });
    assert.deepEqual(orderChangeItemIdentity({ isNew: false }), {});
    assert.deepEqual(orderChangeItemIdentity({ isNew: true, sourceOrderNumber: ' 000123 ', sourcePlatform: '1Shop', sourceStore: 'Store', sourceLineId: '003' }), {
        sourceOrderNumber: '000123', sourcePlatform: '1Shop', sourceStore: 'Store', sourceLineId: '003',
    });
});
