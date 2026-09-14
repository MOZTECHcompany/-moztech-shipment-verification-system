import JsBarcode from 'jsbarcode';

export const ORDER_BARCODE_WIDTH_MM = 74;

// Keep the original identifier unchanged. Unsupported values get a visible
// manual-entry fallback rather than silently printing another order's code.
export function encodeOrderBarcode(value) {
  const text = String(value ?? '');
  if (!text || text.length > 80 || !/^[\x20-\x7e]+$/.test(text)) return null;
  try {
    const encoded = {};
    JsBarcode(encoded, text, { format: 'CODE128', displayValue: false, margin: 0 });
    const bits = encoded.encodings.map(row => row.data).join('');
    // A 100 mm sheet minus 8 mm page margins and 5 mm content padding
    // on each side leaves 74 mm. Keep modules at least 0.25 mm wide.
    if (!bits || (bits.length + 20) * 0.25 > ORDER_BARCODE_WIDTH_MM) return null;
    const bars = [];
    for (let x = 0; x < bits.length;) {
      if (bits[x] === '0') { x++; continue; }
      const start = x;
      while (bits[x] === '1') x++;
      bars.push({ x: start + 10, width: x - start });
    }
    return { text, bits, bars, width: bits.length + 20, height: 64 };
  } catch { return null; }
}
