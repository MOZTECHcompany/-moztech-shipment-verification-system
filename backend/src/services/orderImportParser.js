const xlsx = require('xlsx');

const IMPORT_LIMITS = Object.freeze({
    fileBytes: 10 * 1024 * 1024,
    sheetRows: 5000,
    sheetColumns: 100,
    items: 1000,
    serials: 10000,
    totalQuantity: 50000,
    cellCharacters: 200000
});

function invalid(message, status = 400) {
    return Object.assign(new Error(message), { status, code: 'IMPORT_NOT_APPLIED' });
}

function validateBarcode(value, cell, location) {
    const scientific = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*[eE]\s*[+-]?\s*\d+$/;
    let reason;
    if (scientific.test(value)) reason = '條碼顯示為科學記號，無法作為掃碼核對依據';
    else if (cell?.f) reason = '條碼為公式，請核對後貼上完整條碼值';
    else if (cell?.t === 'n' && (!Number.isSafeInteger(cell.v) || cell.v < 0 || String(cell.v).length > 15)) reason = '條碼數值可能已失去精度或包含小數';
    else if (cell?.t === 'n' && !/^\d+$/.test(value)) reason = '條碼套用了數字、日期或其他非條碼格式';
    else if (/^[+-]?\d+[.,]\d+$/.test(value) || /^\d{1,3}(?:,\d{3})+$/.test(value)) reason = '條碼包含小數點或千分位格式';
    if (!reason) return;
    const storedValue = cell?.t === 'n' && Number.isSafeInteger(cell.v) && cell.v >= 0 && String(cell.v).length <= 15 ? String(cell.v) : undefined;
    const message = `${reason}（${value.slice(0, 80)}）。請將 Excel 條碼欄設為「文字」，依商品標籤或原始品項資料重新填入完整條碼後再匯入。${storedValue ? `檔案目前儲存值：${storedValue}，請核對；系統未自動套用。` : '請勿直接補零或推算缺少的數字。'}`;
    throw Object.assign(invalid(message), { reason: 'INVALID_BARCODE_FORMAT', issue: { ...location, value: value.slice(0, 80), ...(storedValue ? { storedValue } : {}) } });
}

function labelValue(data, labels) {
    for (const row of data.slice(0, 50)) for (let c = 0; c < Math.min(row.length, 50); c++) {
        const text = String(row[c] ?? '').trim();
        if (!labels.some(label => text.includes(label))) continue;
        const parts = text.split(/[:：]/);
        const value = parts.length > 1 ? parts.slice(1).join(':').trim() : String(row[c + 1] ?? '').trim();
        if (value) return value;
    }
    return '';
}

function parseSerials(raw, barcode, expectedQuantity, dedicatedColumn) {
    const normalizedBarcode = barcode.toUpperCase();
    const input = String(raw || '').trim();
    if (!input) return [];
    const hasPrefix = /SN\s*[:：]/i.test(input);
    const tokens = input.replace(/SN\s*[:：]\s*/gi, '').split(/[\/\s,，、ㆍ·・•]+/).filter(Boolean).map(value => value.toUpperCase());
    const valid = value => /^(?:[A-Z0-9]{12}|[A-Z0-9]{13})$/.test(value);
    let serials = tokens.filter(value => value !== normalizedBarcode && valid(value));
    let invalidTokens = tokens.filter(value => value !== normalizedBarcode && !valid(value));
    if (!serials.length) {
        const joined = tokens.join('');
        if (/^[A-Z0-9]+$/.test(joined)) {
            const candidates = [12, 13].filter(size => joined.length % size === 0).map(size => {
                const values = [];
                for (let start = 0; start < joined.length; start += size) {
                    const value = joined.slice(start, start + size);
                    if (value !== normalizedBarcode) values.push(value);
                }
                return values;
            });
            if (candidates.length) {
                serials = candidates.find(values => values.length === expectedQuantity) || candidates[0];
                invalidTokens = [];
            }
        }
    }
    if (((dedicatedColumn || hasPrefix) && invalidTokens.length) || (hasPrefix && !serials.length)) {
        throw invalid('SN 欄位包含無法辨識的序號，請確認為 12 或 13 碼英數字');
    }
    // Free-form 摘要 notes remain valid for ordinary, untracked items.
    if (!serials.length) return [];
    if (new Set(serials).size !== serials.length) throw invalid('同一品項包含重複 SN，請修正後再匯入');
    if (serials.length !== expectedQuantity) throw invalid(`需求數量 ${expectedQuantity} 與 SN 數量 ${serials.length} 不符`);
    return serials;
}

// ECOUNT print footer: one timestamp cell, never a product row with other values.
function isPrintTimestampRow(row) {
    const values = row.map(value => String(value ?? '').trim()).filter(Boolean);
    if (values.length !== 1) return false;
    const match = values[0].normalize('NFKC').match(/^(\d{4})([/-])(\d{1,2})\2(\d{1,2})\s*(?:\((?:(?:星期|週|周)?[一二三四五六日天])\)\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return false;
    const [, year, , month, day, hour, minute, second = '0'] = match;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return date.getUTCFullYear() === Number(year) && date.getUTCMonth() + 1 === Number(month) &&
        date.getUTCDate() === Number(day) && Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60;
}

function parseOrderRows(data, { worksheet, sheetName } = {}) {
    if (!Array.isArray(data) || data.length > IMPORT_LIMITS.sheetRows) throw invalid(`工作表最多 ${IMPORT_LIMITS.sheetRows} 列`, 413);
    for (const row of data) {
        if (row.length > IMPORT_LIMITS.sheetColumns) throw invalid(`工作表最多 ${IMPORT_LIMITS.sheetColumns} 欄`, 413);
        if (row.some(value => String(value ?? '').length > IMPORT_LIMITS.cellCharacters)) throw invalid('單一儲存格內容過長', 413);
    }
    const fallback = index => String(data[index]?.[0] ?? '').split(/[:：]/).slice(1).join(':').trim();
    const voucherNumber = labelValue(data, ['憑證號碼', '憑證號', '訂單編號', '訂單號碼', '訂單號', '單號', 'Voucher']) || fallback(1);
    const customerName = labelValue(data, ['客戶名稱', '客戶', '收貨人', 'Customer']) || fallback(2) || null;
    if (!voucherNumber) throw invalid('找不到訂單號碼（憑證號碼），請確認檔案含「憑證號碼：xxxx」或「訂單編號：xxxx」');
    if (voucherNumber.length > 255 || (customerName?.length || 0) > 255) throw invalid('訂單號碼或客戶名稱不可超過 255 字');
    const isBarcodeHeader = value => /品項編碼|國際條碼|條碼/.test(String(value));
    const headerIndex = data.findIndex(row => row.some(isBarcodeHeader) && row.some(value => String(value).includes('品項名稱')) && row.some(value => String(value).includes('數量')));
    if (headerIndex < 0) throw invalid('找不到完整品項表頭：需包含品項編碼／國際條碼、品項名稱、數量');
    const header = data[headerIndex];
    const barcodeIndex = header.findIndex(isBarcodeHeader);
    const nameIndex = header.findIndex(value => String(value).includes('品項名稱'));
    const quantityIndex = header.findIndex(value => String(value).includes('數量'));
    const modelIndex = header.findIndex(value => /品項型號|型號|Product Code/.test(String(value)));
    const summaryIndex = header.findIndex(value => /摘要|SN|序號/i.test(String(value)));
    const dedicatedSerialColumn = summaryIndex >= 0 && !String(header[summaryIndex]).includes('摘要');
    const items = [];
    const seenSerials = new Set();
    let totalQuantity = 0;
    const lastContentIndex = data.findLastIndex(row => row.some(value => String(value ?? '').trim()));
    for (let index = headerIndex + 1; index < data.length; index++) {
        const row = data[index];
        if (index === lastContentIndex && items.length > 0 && isPrintTimestampRow(row)) continue;
        const barcode = String(row[barcodeIndex] ?? '').trim();
        const rawName = String(row[nameIndex] ?? '').trim();
        const rawQuantity = String(row[quantityIndex] ?? '').trim();
        if (!barcode && !rawName && !rawQuantity) continue;
        if (/^(?:合計|總計|小計|備註|以下空白|TOTAL|SUBTOTAL)[:：]?$/i.test(barcode) && !rawName) continue;
        if (isBarcodeHeader(barcode) && rawName.includes('品項名稱') && rawQuantity.includes('數量')) continue;
        try {
            if (!barcode || !rawName || !rawQuantity) throw invalid('品項編碼、名稱與數量皆必填');
            const cellAddress = xlsx.utils.encode_cell({ r: index, c: barcodeIndex });
            validateBarcode(barcode, worksheet?.[cellAddress] || (typeof row[barcodeIndex] === 'number' ? { t: 'n', v: row[barcodeIndex] } : undefined), { sheet: sheetName, row: index + 1, cell: cellAddress });
            const normalizedQuantity = /^\d{1,3}(?:,\d{3})+(?:\.0+)?$/.test(rawQuantity) ? rawQuantity.replace(/,/g, '') : rawQuantity;
            const quantity = Number(normalizedQuantity);
            if (!Number.isSafeInteger(quantity) || quantity <= 0) throw invalid('數量必須為正整數');
            let productCode = modelIndex >= 0 ? String(row[modelIndex] ?? '').trim() : '';
            let productName = rawName;
            if (!productCode) {
                const match = rawName.match(/\[(.*?)\]/);
                if (match) { productCode = match[1].trim(); productName = rawName.slice(0, match.index).trim(); }
            }
            productCode ||= barcode;
            if (!productName) throw invalid('品項名稱不可為空');
            if ([barcode, productCode, productName].some(value => value.length > 255)) throw invalid('品項編碼、型號與名稱不可超過 255 字');
            const serials = parseSerials(summaryIndex >= 0 ? row[summaryIndex] : '', barcode, quantity, dedicatedSerialColumn);
            for (const serial of serials) {
                if (seenSerials.has(serial)) throw invalid(`SN ${serial} 在其他品項已出現，請勿重複匯入`);
                seenSerials.add(serial);
            }
            totalQuantity += quantity;
            if (items.length >= IMPORT_LIMITS.items) throw invalid(`每單最多 ${IMPORT_LIMITS.items} 個品項`, 413);
            if (seenSerials.size > IMPORT_LIMITS.serials) throw invalid(`每單最多 ${IMPORT_LIMITS.serials} 筆 SN`, 413);
            if (totalQuantity > IMPORT_LIMITS.totalQuantity) throw invalid(`每單總數量最多 ${IMPORT_LIMITS.totalQuantity}`, 413);
            items.push({ barcode, productCode, productName, quantity, serials, sourceRow: index + 1 });
        } catch (error) {
            if (error.code === 'IMPORT_NOT_APPLIED') error.message = `第 ${index + 1} 列：${error.message}`;
            throw error;
        }
    }
    if (!items.length) throw invalid('沒有可匯入的品項，未建立訂單');
    return { voucherNumber, customerName, items, totalQuantity, serialCount: seenSerials.size };
}

function parseOrderImport(buffer) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw invalid('沒有可讀取的檔案內容');
    if (buffer.length > IMPORT_LIMITS.fileBytes) throw invalid('檔案不可超過 10 MiB', 413);
    let worksheet, sheetName;
    try {
        // raw preserves CSV text identifiers (including leading zeros and literal
        // exponent strings). XLS/XLSX retain typed cells for precision checks.
        const workbook = xlsx.read(buffer, { type: 'buffer', raw: true, sheets: 0, sheetRows: IMPORT_LIMITS.sheetRows + 1, cellStyles: false });
        sheetName = workbook.SheetNames[0];
        worksheet = workbook.Sheets[sheetName];
    } catch { throw invalid('無法讀取檔案，請確認是未加密的 .xlsx、.xls 或 .csv'); }
    if (!worksheet?.['!ref']) throw invalid('第一個工作表沒有資料');
    const range = xlsx.utils.decode_range(worksheet['!fullref'] || worksheet['!ref']);
    if (range.e.r >= IMPORT_LIMITS.sheetRows || range.e.c >= IMPORT_LIMITS.sheetColumns) {
        throw invalid(`工作表範圍超限，最多 ${IMPORT_LIMITS.sheetRows} 列、${IMPORT_LIMITS.sheetColumns} 欄；請縮小後匯入`, 413);
    }
    const data = xlsx.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '', range: 0 });
    try { return parseOrderRows(data, { worksheet, sheetName }); }
    catch (error) {
        if (error.code === 'IMPORT_NOT_APPLIED') error.message = `工作表「${sheetName}」${error.issue?.cell ? ` ${error.issue.cell}` : ''}，${error.message}`;
        throw error;
    }
}

module.exports = { IMPORT_LIMITS, parseOrderImport, parseOrderRows };
