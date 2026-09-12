import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { encodeOrderBarcode, ORDER_BARCODE_WIDTH_MM } from '../src/utils/orderBarcode.js';
const require = createRequire(import.meta.url);
const { BitArray, Code128Reader } = require('@zxing/library');

for (const text of ['LOCAL-UI-TEST', '202609090001', '00012345', 'A-2026/09:17', 'Abc_19.2', '1234567890123456789012345678901234567890']) {
  test(`printed bars decode to the exact original order: ${text}`, () => {
    const code = encodeOrderBarcode(text);
    assert.ok(code);
    assert.ok(ORDER_BARCODE_WIDTH_MM / code.width >= 0.25, 'barcode becomes too dense on 100 mm paper');
    const scale = 3;
    const row = new BitArray(code.width * scale);
    for (const bar of code.bars) {
      for (let x = bar.x * scale; x < (bar.x + bar.width) * scale; x++) row.set(x);
    }
    assert.equal(new Code128Reader().decodeRow(0, row).getText(), text);
    assert.ok(code.bars[0].x >= 10);
    assert.ok(code.width - (code.bars.at(-1).x + code.bars.at(-1).width) >= 10);
  });
}
test('unsupported or overly dense identifiers keep a manual-entry fallback', () => {
  for (const value of [null, undefined, '', '中文訂單', 'A\nB', 'A'.repeat(27), 'A'.repeat(80), '9'.repeat(81)]) assert.equal(encodeOrderBarcode(value), null);
});
