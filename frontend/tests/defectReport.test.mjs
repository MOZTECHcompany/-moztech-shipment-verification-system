import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defectRows, defectCsv } from '../src/utils/defectReport.js';

test('defect report preserves every exchange and exports voucher, quotes, newlines and safe spreadsheet cells', () => {
    const rows = defectRows([{ product_name: '產品 "A", B', product_barcode: '0012', details: [
        { id: 1, order_id: 123, voucher_number: 'ORD-0008', original_sn: '001', new_sn: '002', reason: '裂痕\n更換', reporter: '=FORMULA()', created_at: '2026-09-14T00:00:00Z' },
        { id: 2, order_id: 124, original_sn: '003', new_sn: '004', created_at: '2026-09-14T00:00:00Z' },
    ] }]);
    assert.deepEqual(rows.map(r => r.id), [2, 1]);
    const csv = defectCsv(rows);
    assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes('"ORD-0008"'));
    assert.ok(csv.includes('"產品 ""A"", B"')); assert.ok(csv.includes('"裂痕\n更換"'));
    assert.ok(csv.includes('"\'=FORMULA()"')); assert.ok(csv.includes('"124"'));
    assert.ok(!csv.includes('undefined')); assert.deepEqual(defectRows([]), []);
});
