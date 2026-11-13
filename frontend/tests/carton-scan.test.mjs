import test from 'node:test';
import assert from 'node:assert/strict';
import { addCartonSplitSerial, cartonSerialScanTarget, cartonSplitOrderItems, isCartonScan, applyCartonResponse, applyStickerSerialResponse, getStickerSerialReview, sendCartonCommand, makeCartonCommand } from '../src/utils/cartonScan.js';

const previous = 'a'.repeat(64), next = 'b'.repeat(64);
const snapshot = { order: { id: 7 }, items: [], instances: [], stateToken: previous };
test('carton QR and existing carton labels resolve separately from ordinary product and SN codes', () => {
    assert.equal(isCartonScan('CARTON:BOX-A'), true);
    assert.equal(isCartonScan('CTN-261012-ABC-001'), true);
    assert.equal(isCartonScan('SN01,SN02'), true);
    assert.equal(isCartonScan('04711299273087'), false);
    assert.equal(isCartonScan('SN01'), false);
});
test('bulk snapshot cannot update a different order or an out of date local snapshot', () => {
    const result = { ...snapshot, format: 'snapshot-v1', baseState: previous, stateToken: next };
    assert.deepEqual(applyCartonResponse(snapshot, result).stateToken, next);
    assert.throws(() => applyCartonResponse(snapshot, { ...result, order: { id: 8 } }));
    assert.throws(() => applyCartonResponse(snapshot, { ...result, baseState: 'c'.repeat(64) }));
    assert.throws(() => makeCartonCommand({ expectedState: previous, expectedCartonRevision: null }, {}));
});
test('an uncertain response retries with identical command; conflicts do not retry', async () => {
    const calls = [], command = { commandId: 'same', scanValue: 'CARTON:A' };
    const api = { post: async (url, body) => { calls.push({ url, body }); if (calls.length === 1) throw new Error('connection lost'); return { data: 'receipt' }; } };
    assert.equal((await sendCartonCommand(api, 7, command)).data, 'receipt');
    assert.equal(calls.length, 2); assert.strictEqual(calls[0].body, calls[1].body);
    let conflicts = 0;
    await assert.rejects(sendCartonCommand({ post: async () => { conflicts++; throw { response: { status: 409 } }; } }, 7, command));
    assert.equal(conflicts, 1);
});
test('account/token change during an uncertain response never retries under the replacement login', async () => {
    let session = 'old-session', sends = 0;
    const api = { getSessionIdentity: () => session, post: async () => { sends++; session = 'new-session'; throw new Error('connection lost'); } };
    await assert.rejects(sendCartonCommand(api, 7, { commandId: 'same' }), error => error.code === 'SESSION_CHANGED');
    assert.equal(sends, 1);
});

test('unregistered sticker offers only the exact SNs eligible at this order stage', () => {
    const serials = Array.from({ length: 32 }, (_, index) => `SYN-${String(index + 1).padStart(2, '0')}`);
    const order = {
        items: [
            { id: 1, product_name: 'Assigned item', quantity: 15 },
            { id: 2, product_name: 'Expected carton', quantity: 1, expected_carton_id: 'BOX' },
            { id: 3, product_name: 'Partially assigned item', quantity: 2 }
        ],
        instances: [
            ...serials.slice(0, 15).map((serial_number, index) => ({ order_item_id: 1, serial_number, status: index === 0 ? 'picked' : 'pending' })),
            { order_item_id: 2, serial_number: serials[15], status: 'pending' },
            { order_item_id: 3, serial_number: serials[16], status: 'pending' }
        ]
    };
    const scanValue = serials.join(', ');
    const pick = getStickerSerialReview(scanValue, 'pick', order);
    assert.deepEqual(pick.candidates.map(row => row.serial), serials.slice(1, 15));
    assert.equal(pick.excluded, 18);
    assert.equal(getStickerSerialReview(scanValue, 'pack', order), null);
    assert.deepEqual(getStickerSerialReview('syn-02,SYN-03', 'pick', order).candidates.map(row => row.serial), ['SYN-03']);
    assert.deepEqual(getStickerSerialReview('SYN-02,SYN-03', 'pick', {
        items: [...order.items, { id: 4, quantity: 1 }],
        instances: [...order.instances, { ...order.instances[1], order_item_id: 4 }]
    }).candidates.map(row => row.serial), ['SYN-03']);
    assert.equal(getStickerSerialReview('SYN-01,SYN-01', 'pick', order), null);
    assert.equal(getStickerSerialReview('CARTON:ABC,DEF', 'pick', order), null);
});

test('registered-SN lookup keeps positive serial work separate from quantity barcodes and returns', () => {
    const items = [{ id: 1, barcode: '000123' }, { id: 2, quantity_sign: -1 }];
    const instances = [{ order_item_id: 1, serial_number: '000123' }, { order_item_id: 2, serial_number: 'RETURN-1' }];
    assert.equal(cartonSerialScanTarget('000123', { items, instances }), true);
    assert.equal(cartonSerialScanTarget('000123', { items, instances: [] }), false);
    assert.equal(cartonSerialScanTarget('NEW-SN', { items, instances }), true);
    assert.equal(cartonSerialScanTarget('RETURN-1', { items, instances }), false);
});

test('the split dialog offers the one legacy barcode line and respects the order remainder', () => {
    const line = { itemCode: 'OF-W1', ean: '4711299270741', actualSN: [] };
    const carton = { cartonId: 'CTN-OF-W1', lines: [line] };
    const item = { id: 1, product_code: line.ean, barcode: line.ean, quantity: 5, picked_quantity: 0 };
    assert.deepEqual(cartonSplitOrderItems(line, [item], [], carton), [item]);
    assert.deepEqual(cartonSplitOrderItems(line, [{ ...item, expected_carton_id: 'OTHER' }], [], carton), []);
    assert.deepEqual(cartonSplitOrderItems(line, [item, { ...item, id: 2 }], [], carton), []);
    assert.deepEqual(cartonSplitOrderItems(line, [item], [{ order_item_id: 1 }], carton), []);
});

test('sticker confirmation applies only the full snapshot from the same command and exact selected SNs', () => {
    const command = { commandId: 'receipt-1', selectedSerials: ['SYN-02', 'SYN-03'] };
    const receipt = { ...snapshot, stateToken: next, baseState: previous, commandId: command.commandId, confirmedSerials: ['SYN-03', 'SYN-02'] };
    assert.deepEqual(applyStickerSerialResponse(snapshot, receipt, command), { ...snapshot, stateToken: next });
    assert.throws(() => applyStickerSerialResponse(snapshot, { ...receipt, order: { id: 8 } }, command));
    assert.throws(() => applyStickerSerialResponse(snapshot, { ...receipt, commandId: 'receipt-2' }, command));
    assert.throws(() => applyStickerSerialResponse(snapshot, { ...receipt, baseState: next }, command));
    assert.throws(() => applyStickerSerialResponse(snapshot, { ...receipt, confirmedSerials: ['SYN-02', 'syn-03'] }, command));
});


test('scanning individual carton SN adds exact available units and preserves earlier scans', () => {
    const carton = { lines: [{ lineId: 11, remainingSN: ['Unit-01', 'Unit-02', 'Unit-03'] }] };
    const selections = [{ lineId: 11, orderItemId: 8, actualSN: [], quantity: 0 }];
    const instances = ['Unit-01', 'Unit-02'].map(serial_number => ({ serial_number, order_item_id: 8, status: 'pending' }));
    const first = addCartonSplitSerial(carton, selections, instances, ' Unit-01 ');
    const second = addCartonSplitSerial(carton, first, instances, 'Unit-02');
    assert.deepEqual(second, [{ lineId: 11, orderItemId: 8, actualSN: ['Unit-01', 'Unit-02'], quantity: 2 }]);
    assert.deepEqual(selections[0].actualSN, []);
    assert.throws(() => addCartonSplitSerial(carton, second, instances, 'Unit-01'), /已選取/);
    assert.throws(() => addCartonSplitSerial(carton, second, instances, 'unit-01'), /不在來源箱/);
    assert.throws(() => addCartonSplitSerial(carton, second, instances, 'Unit-03'), /不在所選理貨單/);
    assert.throws(() => addCartonSplitSerial(carton, selections, [{ ...instances[0], status: 'picked' }], 'Unit-01'), /已核對/);
});
