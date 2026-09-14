const xlsx = require('xlsx');
const { normalizeSourceIdentity, sourceIdentityValues } = require('./orderSourceIdentity');
const { groupSourceWorkOrders } = require('./warehouseBatch');

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

function summaryRequiresExplicitSerials(raw, barcode, quantity) {
    const input = String(raw ?? '').trim();
    if (!input) return false;
    if (/SN\s*[:：]/i.test(input)) return true;
    // Recognize legacy serial-bearing summaries only to prevent losing them.
    // Never silently turn a free-form note into the new contract's SN field.
    try { return parseSerials(input, barcode, Number(quantity), false).length > 0; }
    catch (error) {
        if (error.code === 'IMPORT_NOT_APPLIED') return true;
        throw error;
    }
}

const normalizedHeader = value => String(value ?? '').trim().replace(/\s/g, '').replace(/／/g, '/').toLowerCase();
const SOURCE_HEADERS = {
    voucherNumber: ['理貨單號', '理貨單單號', '理貨單編號', 'voucher_number'],
    sourceOrderNumber: ['商城訂單編號', '商城訂單號', '平台訂單編號', 'source_order_number'],
    sourcePlatform: ['平台', '來源平台', 'source_platform'],
    sourceStore: ['店鋪', '店舖', '商店', 'source_store'],
    sourceLineId: ['來源明細號', '來源明細編號', '商城明細編號', 'source_line_id'],
    productCode: ['品項編碼', 'sku', 'product_code'],
    productName: ['品項名稱', '品項名', 'product_name'],
    barcode: ['國際條碼', '條碼', 'barcode'],
    quantity: ['數量', 'quantity'],
    serials: ['序號/批號', 'sn', 'sn列表', 'serials'],
    summary: ['摘要', 'summary'],
    customerName: ['客戶名稱', '客戶/供應商名稱', 'customer_name']
};
const matchesSourceHeader = (value, field) => SOURCE_HEADERS[field].includes(normalizedHeader(value));

function sourceHeaderIndex(data) {
    return data.findIndex(row =>
        row.some(value => matchesSourceHeader(value, 'sourceOrderNumber') || matchesSourceHeader(value, 'voucherNumber')) &&
        row.some(value => matchesSourceHeader(value, 'productCode') || matchesSourceHeader(value, 'barcode') || matchesSourceHeader(value, 'quantity')));
}

function parseSourceOrderRows(data, headerIndex) {
    const header = data[headerIndex];
    const columns = {};
    for (const field of Object.keys(SOURCE_HEADERS)) {
        const matches = header.flatMap((value, index) => matchesSourceHeader(value, field) ? [index] : []);
        if (matches.length > 1) throw invalid(`明細表頭重複：${SOURCE_HEADERS[field][0]}`);
        columns[field] = matches[0] ?? -1;
    }
    for (const field of ['voucherNumber', 'sourceOrderNumber', 'productCode', 'productName', 'barcode', 'quantity']) {
        if (columns[field] < 0) throw invalid(`理貨明細缺少欄位：${SOURCE_HEADERS[field][0]}`);
    }
    let voucherNumber = null, customerName = null;
    const identities = [], seenLines = new Set();
    // Reuse the established quantity/SN validation through an explicit internal
    // mapping. Never let the legacy fuzzy headers interpret import grouping 序號.
    const normalizedRows = [['憑證號碼：SOURCE-DOCUMENT'], ['國際條碼', '品項型號', '品項名稱', '數量', 'SN列表']];
    for (let index = headerIndex + 1; index < data.length; index++) {
        const row = data[index];
        if (row.every(value => String(value ?? '').trim() === '')) continue;
        if (header.every((value, column) => normalizedHeader(value) === normalizedHeader(row[column]))) continue;
        const cell = field => columns[field] < 0 ? '' : String(row[columns[field]] ?? '').trim();
        const sourceRow = index + 1;
        try {
            const voucher = cell('voucherNumber');
            if (!voucher || voucher.length > 255 || /[\u0000-\u001f\u007f]/.test(voucher)) throw invalid('理貨單號必填，最多 255 字');
            if (voucherNumber !== null && voucherNumber !== voucher) throw invalid('同一檔案只能包含一張理貨單，請分開匯入');
            voucherNumber = voucher;
            if (!cell('sourceOrderNumber')) throw invalid('商城訂單編號必填');
            const source = normalizeSourceIdentity(Object.fromEntries(Object.keys(SOURCE_HEADERS).filter(key => key.startsWith('source')).map(key => [key, cell(key)])));
            if (!source.sourceOrderNumber) throw invalid('商城訂單編號必填');
            if (!cell('productCode')) throw invalid('品項編碼（SKU）必填，不能用國際條碼代替');
            if (!cell('barcode')) throw invalid('國際條碼必填，不能用品項編碼代替');
            if (!cell('productName') || !cell('quantity')) throw invalid('品項名稱與數量必填');
            if (!cell('serials') && summaryRequiresExplicitSerials(cell('summary'), cell('barcode'), cell('quantity'))) {
                throw invalid('摘要含有可辨識的 SN 或 SN: 標記，請將序號移至「序號/批號」欄後再匯入，避免以無 SN 商品核對');
            }
            if (source.sourceLineId) {
                const key = JSON.stringify(sourceIdentityValues(source));
                if (seenLines.has(key)) throw invalid('同一商城訂單的來源明細號重複，請核對後再匯入');
                seenLines.add(key);
            }
            const customer = cell('customerName');
            if (customer.length > 255) throw invalid('客戶名稱不可超過 255 字');
            // Per-order customers may differ inside one warehouse document.
            // Only expose a document-level customer if every supplied value agrees.
            if (customer) customerName = customerName === null ? customer : customerName === customer ? customerName : '';
            normalizedRows.push([cell('barcode'), cell('productCode'), cell('productName'), cell('quantity'), cell('serials')]);
            identities.push({ ...source, sourceRow, customerName: customer || null });
        } catch (error) {
            throw invalid(`第 ${sourceRow} 列：${error.message}`);
        }
    }
    if (!identities.length) throw invalid('沒有可匯入的品項，未建立訂單');
    let parsed;
    try { parsed = parseOrderRows(normalizedRows); }
    catch (error) {
        const match = error.message.match(/^第 (\d+) 列：/);
        if (match && identities[Number(match[1]) - 3]) error.message = error.message.replace(/^第 \d+ 列：/, `第 ${identities[Number(match[1]) - 3].sourceRow} 列：`);
        throw error;
    }
    if (parsed.items.length !== identities.length) throw invalid('理貨明細包含無法辨識的商品列，未建立訂單');
    const result = { ...parsed, importFormat: 'source-details', voucherNumber, customerName: customerName || null, items: parsed.items.map((item, index) => ({ ...item, ...identities[index] })) };
    result.workOrders = groupSourceWorkOrders(result);
    return result;
}

function parseOrderRows(data) {
    if (!Array.isArray(data) || data.length > IMPORT_LIMITS.sheetRows) throw invalid(`工作表最多 ${IMPORT_LIMITS.sheetRows} 列`, 413);
    for (const row of data) {
        if (!Array.isArray(row)) throw invalid('工作表列格式錯誤');
        if (row.length > IMPORT_LIMITS.sheetColumns) throw invalid(`工作表最多 ${IMPORT_LIMITS.sheetColumns} 欄`, 413);
        if (row.some(value => String(value ?? '').length > IMPORT_LIMITS.cellCharacters)) throw invalid('單一儲存格內容過長', 413);
    }
    const sourceIndex = sourceHeaderIndex(data);
    if (sourceIndex >= 0) return parseSourceOrderRows(data, sourceIndex);
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
    for (let index = headerIndex + 1; index < data.length; index++) {
        const row = data[index];
        const barcode = String(row[barcodeIndex] ?? '').trim();
        const rawName = String(row[nameIndex] ?? '').trim();
        const rawQuantity = String(row[quantityIndex] ?? '').trim();
        if (!barcode && !rawName && !rawQuantity) continue;
        if (/^(?:合計|總計|小計|備註|以下空白|TOTAL|SUBTOTAL)[:：]?$/i.test(barcode) && !rawName) continue;
        if (isBarcodeHeader(barcode) && rawName.includes('品項名稱') && rawQuantity.includes('數量')) continue;
        try {
            if (!barcode || !rawName || !rawQuantity) throw invalid('品項編碼、名稱與數量皆必填');
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
    let worksheet, sheetCount;
    try {
        const workbook = xlsx.read(buffer, { type: 'buffer', sheets: 0, sheetRows: IMPORT_LIMITS.sheetRows + 1, cellStyles: false });
        worksheet = workbook.Sheets[workbook.SheetNames[0]];
        sheetCount = workbook.SheetNames.length;
    } catch { throw invalid('無法讀取檔案，請確認是未加密的 .xlsx、.xls 或 .csv'); }
    if (!worksheet?.['!ref']) throw invalid('第一個工作表沒有資料');
    const range = xlsx.utils.decode_range(worksheet['!fullref'] || worksheet['!ref']);
    if (range.e.r >= IMPORT_LIMITS.sheetRows || range.e.c >= IMPORT_LIMITS.sheetColumns) {
        throw invalid(`工作表範圍超限，最多 ${IMPORT_LIMITS.sheetRows} 列、${IMPORT_LIMITS.sheetColumns} 欄；請縮小後匯入`, 413);
    }
    const data = xlsx.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '', range: 0 });
    if (sheetCount > 1 && sourceHeaderIndex(data) >= 0) throw invalid('逐筆理貨明細請使用單一工作表，避免漏讀其他理貨單');
    return parseOrderRows(data);
}

module.exports = { IMPORT_LIMITS, parseOrderImport, parseOrderRows };
