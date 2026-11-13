const assert = require('node:assert/strict');
const { choosePickLines } = require('../services/cartonContents');
const { parseOrderRows } = require('../services/orderImportParser');

const barcode = '4711299270741';
const carton = {
    cartonId: 'CTN-270101-OF-W1-004',
    lines: [{ lineId: 1, itemCode: 'OF-W1', ean: barcode, remainingQuantity: 20, actualSN: [], remainingSN: [] }],
};

function importedOrderItem(quantity, overrides = {}) {
    const { items } = parseOrderRows([
        ['理貨單'],
        ['憑證號碼 : TEST-LEGACY-FAN'],
        ['客戶名稱 : 測試'],
        ['品項編碼', '品項名稱(規格)', '數量', '摘要'],
        [barcode, '章魚風扇', String(quantity), ''],
    ]);
    const [item] = items;
    return {
        id: 1, product_code: item.productCode, barcode: item.barcode, code_type: 'legacy',
        quantity: item.quantity, picked_quantity: 0, ...overrides,
    };
}

test.each([['whole', 20], ['split', 5]])('matches the legacy barcode-as-item-code row for %s pick of %i', (mode, quantity) => {
    const item = importedOrderItem(quantity);
    assert.equal(item.product_code, barcode);
    const selections = mode === 'split' ? [{ lineId: 1, orderItemId: item.id, quantity, actualSN: [] }] : undefined;
    const result = choosePickLines(carton, { mode, selections }, [item], []);
    expect(result).toEqual([expect.objectContaining({ orderItemId: item.id, itemCode: 'OF-W1',
        sourceProductCode: barcode, quantity, actualSN: [] })]);
});

test.each([
    ['different SKU', { product_code: 'OTHER' }],
    ['different scan key', { barcode: '4711299270758' }],
    ['nonlegacy order row', { code_type: 'international', international_barcode: barcode }],
    ['different explicit international barcode', { international_barcode: '4711299270758' }],
    ['internal scan identity', { internal_scan_code: 'ITM-FAN' }],
    ['explicit source SKU', { source_sku: 'OTHER' }],
    ['carton-bound SN', { carton_serial_binding: true }],
    ['exact serial mode', { serial_identity_mode: 'exact' }],
    ['return line', { quantity_sign: -1 }],
])('rejects fallback for %s', (_label, overrides) => {
    assert.throws(() => choosePickLines(carton, {}, [importedOrderItem(20, overrides)], []), { code: 'CARTON_ITEM_NOT_IN_ORDER' });
});

test('rejects a competing order line or carton item that shares the barcode', () => {
    const item = importedOrderItem(20);
    const otherOrderItems = [
        { ...item, id: 2 },
        { ...item, id: 2, product_code: 'OTHER', barcode: 'OTHER', international_barcode: barcode },
        { ...item, id: 2, product_code: 'OF-W1', barcode: '4711299270758' },
    ];
    for (const other of otherOrderItems) {
        assert.throws(() => choosePickLines(carton, {}, [item, other], []), { code: 'CARTON_ITEM_NOT_IN_ORDER' });
    }
    const otherCartonItem = { ...carton.lines[0], lineId: 2, itemCode: 'OTHER' };
    const mixedCarton = { ...carton, lines: [...carton.lines, otherCartonItem] };
    assert.throws(() => choosePickLines(mixedCarton, {}, [item], []), { code: 'CARTON_ITEM_NOT_IN_ORDER' });
});

test('never treats a serialized or internal carton identity as a quantity-only fallback', () => {
    const item = importedOrderItem(20);
    const serials = ['TEST-FAN-0001'];
    const serialCarton = { ...carton, lines: [{ ...carton.lines[0], actualSN: serials, remainingSN: serials }] };
    const internalCarton = { ...carton, lines: [{ ...carton.lines[0], internalScanCode: 'ITM-FAN' }] };
    assert.throws(() => choosePickLines(carton, {}, [item], [{ order_item_id: item.id }]), { code: 'CARTON_ITEM_NOT_IN_ORDER' });
    assert.throws(() => choosePickLines(serialCarton, {}, [item], []), { code: 'CARTON_ITEM_NOT_IN_ORDER' });
    assert.throws(() => choosePickLines(internalCarton, {}, [item], []), { code: 'CARTON_ITEM_NOT_IN_ORDER' });
});

test('keeps expected carton, pending quantity and explicit target checks for the fallback', () => {
    const item = importedOrderItem(5);
    assert.throws(() => choosePickLines(carton, {}, [item], []), { code: 'CARTON_ORDER_QUANTITY_EXCEEDED' });
    const split = { mode: 'split', selections: [{ lineId: 1, quantity: 5 }] };
    const wrongCarton = { ...item, expected_carton_id: 'CTN-OTHER' };
    assert.throws(() => choosePickLines(carton, split, [wrongCarton], []), { code: 'CARTON_EXPECTED_MISMATCH' });
    const wrongTarget = { ...split, selections: [{ ...split.selections[0], orderItemId: 999 }] };
    assert.throws(() => choosePickLines(carton, wrongTarget, [item], []), { code: 'CARTON_ITEM_NOT_IN_ORDER' });
});

test('keeps the exact SKU match as the first choice', () => {
    const alias = importedOrderItem(20);
    const exact = { ...alias, id: 2, product_code: 'OF-W1' };
    expect(choosePickLines(carton, {}, [alias, exact], [])).toEqual([expect.objectContaining({ orderItemId: exact.id })]);
});

test('whole carton barcode fallback needs every carton SN uniquely preassigned and pending', () => {
    const serials = ['FAN-0001', 'FAN-0002'];
    const serialCarton = { ...carton, lines: [{ ...carton.lines[0], remainingQuantity: 2, actualSN: serials, remainingSN: serials }] };
    const item = importedOrderItem(2);
    const assigned = serials.map(serial_number => ({ order_item_id: item.id, serial_number, status: 'pending' }));
    const request = { mode: 'whole', serialPolicy: 'from-carton' };
    for (const candidate of [item, { ...item, product_code: 'OLD-ALIAS', code_type: 'international', international_barcode: barcode }]) {
        expect(choosePickLines(serialCarton, request, [candidate], assigned)).toEqual([
            expect.objectContaining({ orderItemId: item.id, quantity: 2, actualSN: serials, newSN: [] }),
        ]);
    }
    for (const wrong of [[], assigned.slice(0, 1), [assigned[0], { ...assigned[1], status: 'picked' }],
        [assigned[0], { ...assigned[1], serial_number: 'WRONG-SN' }], [...assigned, { ...assigned[0], order_item_id: 2 }]]) {
        assert.throws(() => choosePickLines(serialCarton, request, [item], wrong), { code: 'CARTON_ITEM_NOT_IN_ORDER' });
    }
});
