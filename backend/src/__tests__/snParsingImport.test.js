const { describe, test, expect } = require('@jest/globals');

// 這裡用同樣的規則模擬匯入端對 summaryRaw 的解析
// 目的：避免再次退回到「每 12 碼硬切」造成 SN 被切碎。
function parseSerialNumbersFromSummary(summaryRaw, barcode) {
    if (!summaryRaw) return [];

    const normalizedBarcode = String(barcode || '').trim().toUpperCase();

    const serialNumbers = [];

    const potentialSNs = String(summaryRaw).split(/[\/\s,，、\n\rㆍ·・•]+/);
    for (const part of potentialSNs) {
        const cleanPart = String(part || '').trim();
        if (!cleanPart) continue;
        const normalized = cleanPart.replace(/^SN\s*[:：]/i, '').trim().toUpperCase();
        if (normalizedBarcode && normalized === normalizedBarcode) continue;
        if ((normalized.length === 12 || normalized.length === 13) && /^[A-Za-z0-9]+$/.test(normalized)) {
            serialNumbers.push(normalized);
        }
    }

    if (serialNumbers.length === 0) {
        const noPrefix = String(summaryRaw).replace(/SN\s*[:：]/gi, '');
        const cleanSummary = noPrefix.replace(/[\/\s,，、\n\rㆍ·・•]/g, '');
        const upper = String(cleanSummary || '').toUpperCase();
        if (upper.length > 0 && /^[A-Za-z0-9]+$/.test(upper)) {
            const chunkSizes = [12, 13];
            for (const size of chunkSizes) {
                if (upper.length % size !== 0) continue;
                for (let j = 0; j < upper.length; j += size) {
                    const chunk = upper.substring(j, j + size);
                    if (normalizedBarcode && chunk === normalizedBarcode) continue;
                    serialNumbers.push(chunk);
                }
                break;
            }
        }
    }

    return [...new Set(serialNumbers)];
}

describe('SN parsing during import', () => {
    test('parses SN: prefixed list separated by ㆍ', () => {
        const input =
            'SN:B19B52004735ㆍSN:B19B52004736ㆍSN:B19B52004737ㆍSN:B19B52004738ㆍSN:B19B52004739ㆍSN:B19B52004740';
        const result = parseSerialNumbersFromSummary(input);
        expect(result).toEqual([
            'B19B52004735',
            'B19B52004736',
            'B19B52004737',
            'B19B52004738',
            'B19B52004739',
            'B19B52004740',
        ]);
    });

    test('parses 12-char codes separated by ・/·', () => {
        const input = 'T03K52027501・T03K52027502·T03K52027503';
        const result = parseSerialNumbersFromSummary(input);
        expect(result).toEqual(['T03K52027501', 'T03K52027502', 'T03K52027503']);
    });

    test('parses 13-digit numeric SNs separated by comma/space', () => {
        const input = '4711299273766, 4711299273767 4711299273768';
        const result = parseSerialNumbersFromSummary(input);
        expect(result).toEqual(['4711299273766', '4711299273767', '4711299273768']);
    });

    test('chunks continuous 13-digit SNs when divisible by 13', () => {
        const input = '471129927376647112992737674711299273768';
        const result = parseSerialNumbersFromSummary(input);
        expect(result).toEqual(['4711299273766', '4711299273767', '4711299273768']);
    });

    test('skips EAN-13 barcode when it appears in the same field', () => {
        const barcode = '4711299273766';
        const input = '4711299273766, 4711299273767';
        const result = parseSerialNumbersFromSummary(input, barcode);
        expect(result).toEqual(['4711299273767']);
    });

    test('skips EAN-13 barcode during chunking fallback', () => {
        const barcode = '4711299273766';
        const input = '47112992737664711299273767';
        const result = parseSerialNumbersFromSummary(input, barcode);
        expect(result).toEqual(['4711299273767']);
    });

    test('does not chunk when SN prefix exists but delimiters missing', () => {
        // 若真的遇到無分隔符，且包含 SN: 前綴，原本會硬切出碎片。
        // 修正後會先移除 SN: 再判斷是否可切分，避免產生碎片。
        const input = 'SN:B19B52004735SN:B19B52004736';
        const result = parseSerialNumbersFromSummary(input);
        expect(result).toEqual(['B19B52004735', 'B19B52004736']);
    });
});
