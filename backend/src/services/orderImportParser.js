const xlsx = require('xlsx');
const { parseExactSerialList } = require('../utils/serialNumber');
const isActualSNHeader = value => ['實際sn','actualsn','actual_sn'].includes(String(value ?? '').trim().replace(/\s/g,'').toLowerCase());
function exactSerials(value, quantity) {
    try { return parseExactSerialList(value, Math.abs(Number(quantity))); }
    catch(error) { throw invalid(error.message); }
}

const importSheetContext = new WeakMap();
const { normalizeSourceIdentity, sourceIdentityValues } = require('./orderSourceIdentity');
const { isPickingFreight, PICKING_FREIGHT_CODE } = require('./pickingFreight');
const { readOrderImportWorkbook } = require('./orderImportWorkbook');

const IMPORT_LIMITS = Object.freeze({
    fileBytes: 10 * 1024 * 1024,
    sheetRows: 5000,
    sheetColumns: 100,
    items: 1000,
    serials: 10000,
    totalQuantity: 50000,
    shippingNotes: 100,
    shippingNoteCharacters: 2000,
    shippingNotesCharacters: 10000,
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
        // An original-order reference must never become the new voucher number.
        if (/^(?:備註\s*[:：]\s*)?(?:原|沖正原)/.test(text)) continue;
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

function positivePickingQuantity(value) {
    const normalized = /^\d{1,3}(?:,\d{3})+(?:\.0+)?$/.test(value) ? value.replace(/,/g, '') : value;
    const quantity = Number(normalized);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw invalid('數量必須為正整數');
    return quantity;
}

function summaryRequiresExplicitSerials(raw, barcode, quantity) {
    const input = String(raw ?? '').trim();
    if (!input) return false;
    if (/SN\s*[:：]/i.test(input)) return true;
    // Preserve the established summary SN grammar; ordinary notes are not SN.
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
    internalScanCode: ['內部掃描碼', '內碼', 'internal_scan_code'],
    sourceSku: ['來源sku', '來源貨號', 'source_sku'],
    quantity: ['數量', 'quantity'],
    serials: ['序號/批號', 'sn', 'sn列表', 'serials'],
    actualSN: ['實際sn','actualsn','actual_sn'],
    summary: ['摘要', 'summary'],
    customerName: ['客戶名稱', '客戶/供應商名稱', 'customer_name']
};
const matchesSourceHeader = (value, field) => SOURCE_HEADERS[field].includes(normalizedHeader(value));
const isCartonHeader = value => ['箱號', '箱批號', 'cartonid', 'carton_id'].includes(normalizedHeader(value));

function sourceHeaderIndex(data) {
    return data.findIndex(row =>
        row.some(value => matchesSourceHeader(value, 'sourceOrderNumber') || matchesSourceHeader(value, 'voucherNumber')) &&
        row.some(value => matchesSourceHeader(value, 'productCode') || matchesSourceHeader(value, 'barcode') || matchesSourceHeader(value, 'quantity')));
}

function exportDate(value) {
    const match = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(value);
    if (!match) return null;
    const [year, month, day] = match.slice(1).map(Number);
    if (year < 1000) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

const onlyFirstCell = row => row.slice(1).every(value => String(value ?? '').trim() === '');

function hasEcountPickingPreamble(data, headerIndex) {
    if (headerIndex !== 1 || !onlyFirstCell(data[0])) return false;
    const preamble = /^公司名稱 *[:：] *\S[^\r\n]*? *\/ *(\d{4}\/\d{2}\/\d{2}) *~ *(\d{4}\/\d{2}\/\d{2})$/.exec(String(data[0][0] ?? '').trim());
    if (!preamble) return false;
    const start = exportDate(preamble[1]), end = exportDate(preamble[2]);
    return Boolean(start && end && start <= end);
}

function hasEcountSerialColumn(data, headerIndex) {
    return data[headerIndex].some(value => normalizedHeader(value) === '序號/批號');
}

function ecountTerminalFooterIndex(data, headerIndex) {
    if (!hasEcountPickingPreamble(data, headerIndex)) return -1;
    let index = data.length - 1;
    while (index > headerIndex && data[index].every(value => String(value ?? '').trim() === '')) index--;
    if (index <= headerIndex || !onlyFirstCell(data[index])) return -1;
    const footer = /^(\d{4}\/\d{2}\/\d{2}) \(([日一二三四五六])\) ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.exec(String(data[index][0] ?? '').trim());
    if (!footer) return -1;
    const date = exportDate(footer[1]);
    return date && '日一二三四五六'[date.getUTCDay()] === footer[2] ? index : -1;
}

function isEcountPickingExport(data, headerIndex = sourceHeaderIndex(data)) {
    return ecountTerminalFooterIndex(data, headerIndex) >= 0 && hasEcountSerialColumn(data, headerIndex);
}

function ecountSerialTokens(value) {
    return value.replace(/SN\s*[:：]\s*/gi, '').split(/[\/\s,，、ㆍ·・•]+/).filter(Boolean);
}

function parseSourceOrderRows(data, headerIndex, ecount) {
    const header = data[headerIndex];
    const columns = {};
    for (const field of Object.keys(SOURCE_HEADERS)) {
        const matches = header.flatMap((value, index) => matchesSourceHeader(value, field) ? [index] : []);
        if (matches.length > 1) throw invalid(`明細表頭重複：${SOURCE_HEADERS[field][0]}`);
        columns[field] = matches[0] ?? -1;
    }
    for (const field of ['voucherNumber', 'sourceOrderNumber', 'productCode', 'productName', 'quantity']) {
        if (columns[field] < 0) throw invalid(`理貨明細缺少欄位：${SOURCE_HEADERS[field][0]}`);
    }
    if(columns.barcode<0&&columns.internalScanCode<0&&!ecount)throw invalid('理貨明細缺少欄位：國際條碼／內部掃描碼');
    let voucherNumber = null, customerName = null;
    const identities = [], seenLines = new Set(), omittedNonStock = [];
    let freightExemptQuantity = 0;
    // Reuse the established quantity/SN validation through an explicit internal
    // mapping. Never let the legacy fuzzy headers interpret import grouping 序號.
    const normalizedRows = [['憑證號碼：SOURCE-DOCUMENT'], ['國際條碼', '品項型號', '品項名稱', '數量', 'SN列表','實際SN']];
    const terminalFooterIndex = ecountTerminalFooterIndex(data, headerIndex);
    // An otherwise identified fee does not depend on the trailing print time.
    // Physical carton and SKU lookups still require the full ECOUNT envelope.
    const hasEcountFreightColumns = hasEcountPickingPreamble(data, headerIndex) && hasEcountSerialColumn(data, headerIndex);
    const cartonEvidenceIndexes = header.flatMap((value, index) => isCartonHeader(value) ? [index] : []);
    for (let index = headerIndex + 1; index < data.length; index++) {
        if (index === terminalFooterIndex) continue;
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
            const productCode = cell('productCode');
            if (!productCode) throw invalid('品項編碼（SKU）必填，不能用國際條碼代替');
            const internationalBarcode = cell('barcode') || null;
            let internalScanCode = cell('internalScanCode') || null;
            if (hasEcountFreightColumns && !source.sourceLineId && isPickingFreight(productCode, cell('productName')) &&
                (!internationalBarcode || internationalBarcode === PICKING_FREIGHT_CODE) &&
                !internalScanCode && !cell('serials') && !cell('actualSN') &&
                !cartonEvidenceIndexes.some(column => String(row[column] ?? '').trim()) &&
                !summaryRequiresExplicitSerials(cell('summary'), productCode, cell('quantity'))) {
                const quantity = positivePickingQuantity(cell('quantity'));
                omittedNonStock.push({ productCode, productName: cell('productName'), quantity, sourceRow });
                freightExemptQuantity += quantity;
                continue;
            }
            if (!internationalBarcode && !internalScanCode && ecount) {
                const codes = ecount.scanCodes.get(productCode) ?? [];
                if (codes.length !== 1) throw invalid(`國際條碼必填；品項 ${productCode} ${codes.length ? '對應多個內部掃描碼，請確認唯一對照' : '尚無對應的內部掃描碼，請先建立品項對照'}`);
                [internalScanCode] = codes;
            }
            if(!internationalBarcode&&!internalScanCode)throw invalid('國際條碼必填；無國條商品請明確提供內部掃描碼，不能用品項編碼代替');
            if(internalScanCode&&!/^ITM-[A-Za-z0-9._-]{1,96}$/.test(internalScanCode))throw invalid('內部掃描碼須為 ITM- 開頭的完整文字識別');
            const scanCode=internationalBarcode||internalScanCode;
            const codeType=internationalBarcode?'international':'internal';
            if(cell('sourceSku').length>255||/[\u0000-\u001f\u007f]/.test(cell('sourceSku')))throw invalid('來源SKU不可超過255字或含控制字元');
            const context = importSheetContext.get(data) || {};
            const scanColumn = internationalBarcode ? columns.barcode : cell('internalScanCode') ? columns.internalScanCode : -1;
            if (scanColumn >= 0) {
                const address = xlsx.utils.encode_cell({ r: index, c: scanColumn });
                validateBarcode(scanCode, context.worksheet?.[address], { sheet: context.sheetName, row: sourceRow, cell: address });
            }
            if (!cell('productName') || !cell('quantity')) throw invalid('品項名稱與數量必填');
            const sourceSerials = cell('serials');
            const carton = ecount?.cartons.get(sourceSerials);
            const tokens = ecount && !carton ? ecountSerialTokens(sourceSerials) : [];
            if (tokens.some(token => ecount.cartons.has(token))) {
                throw invalid('同列包含箱批號與其他識別，請在 ECOUNT 按箱分列');
            }
            const actual = exactSerials(cell('actualSN'), cell('quantity'));
            const nativeSNs = tokens.filter(token => token.toUpperCase() !== cell('barcode').toUpperCase());
            const nativeExact = nativeSNs.length && nativeSNs.every(token => /^[A-Za-z0-9]{12,13}$/.test(token) || /^TRY-[A-Z0-9]{12,14}$/.test(token))
                ? exactSerials(nativeSNs, cell('quantity')) : [];
            if (actual.length && nativeExact.length && JSON.stringify([...actual].sort()) !== JSON.stringify([...nativeExact].sort())) {
                throw invalid('實際SN與序號/批號欄的 SN 不一致');
            }
            const exact = actual.length ? actual : nativeExact;
            if (carton) {
                if (carton.serialCollision) throw invalid('序號/批號同時對應箱號與單件 SN，請核對識別');
                if (carton.status !== 'sealed') throw invalid(`箱批號 ${sourceSerials} 尚未封箱或已作廢`);
                const matchingLines = carton.lines.filter(line => line.item_code === productCode &&
                    (internationalBarcode ? line.international_barcode === internationalBarcode : line.internal_scan_code === internalScanCode));
                if (!matchingLines.length) throw invalid(`箱批號 ${sourceSerials} 的品項或掃描碼與理貨單不符`);
                if (exact.some(sn => !matchingLines.some(line => line.actual_sns.includes(sn)))) {
                    throw invalid(`箱批號 ${sourceSerials} 不含理貨單指定的實際 SN`);
                }
            }
            const explicit = carton || nativeExact.length ? [] : parseSerials(sourceSerials, cell('barcode'), Number(cell('quantity')), true);
            const legacySummary = summaryRequiresExplicitSerials(cell('summary'), cell('barcode'), cell('quantity'));
            const fromSummary = legacySummary ? parseSerials(cell('summary'), cell('barcode'), Number(cell('quantity')), false) : [];
            if (explicit.length && fromSummary.length && JSON.stringify([...explicit].sort()) !== JSON.stringify([...fromSummary].sort())) {
                throw invalid('摘要與序號/批號欄的 SN 不一致，請核對後再匯入');
            }
            const legacy=explicit.length?explicit:fromSummary;
            if(exact.length&&legacy.length&&JSON.stringify([...exact].sort())!==JSON.stringify([...legacy].sort()))throw invalid('實際SN與舊SN欄不一致');
            const serials=exact.length?exact:legacy;
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
            normalizedRows.push([scanCode, productCode, cell('productName'), cell('quantity'), exact.length?'':legacy.join(' '),exact.join(',')]);
            identities.push({ ...source, sourceSku:cell('sourceSku')||null,internationalBarcode,internalScanCode,codeType,sourceRow, sourceSummary:cell('summary'), sourceSerials, serialSource:actual.length?'實際SN':carton?'箱批號':nativeExact.length||explicit.length?'序號/批號':fromSummary.length?'摘要':'無 SN', customerName: customer || null,
                ...(carton ? { expectedCartonId: sourceSerials } : {}) });
        } catch (error) {
            if (error.code === 'IMPORT_NOT_APPLIED') error.message = `第 ${sourceRow} 列：${error.message}`;
            throw error;
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
    if (parsed.items.length + omittedNonStock.length > IMPORT_LIMITS.items) throw invalid(`每單最多 ${IMPORT_LIMITS.items} 個品項`, 413);
    if (parsed.totalQuantity + freightExemptQuantity > IMPORT_LIMITS.totalQuantity) throw invalid(`每單總數量最多 ${IMPORT_LIMITS.totalQuantity}`, 413);
    const result = { ...parsed, importFormat: 'source-details', voucherNumber, customerName: customerName || null, items: parsed.items.map((item, index) => ({ ...item, ...identities[index] })) };
    if (omittedNonStock.length) Object.assign(result, { omittedNonStock, freightExemptQuantity });
    return result;
}

function parseOrderRows(data, { worksheet, sheetName } = {}) {
    if (!Array.isArray(data) || data.length > IMPORT_LIMITS.sheetRows) throw invalid(`工作表最多 ${IMPORT_LIMITS.sheetRows} 列`, 413);
    for (const row of data) {
        if (row.length > IMPORT_LIMITS.sheetColumns) throw invalid(`工作表最多 ${IMPORT_LIMITS.sheetColumns} 欄`, 413);
        if (row.some(value => String(value ?? '').length > IMPORT_LIMITS.cellCharacters)) throw invalid('單一儲存格內容過長', 413);
    }
    const isBarcodeHeader = value => /品項編碼|國際條碼|條碼/.test(String(value));
    const headerIndex = data.findIndex(row => row.some(isBarcodeHeader) && row.some(value => String(value).includes('品項名稱')) && row.some(value => String(value).includes('數量')));
    const header = headerIndex >= 0 ? data[headerIndex] : [];
    const itemCodeIndices = header.flatMap((value, index) => /品項編碼/.test(String(value)) ? [index] : []);
    const itemCodeIndex = itemCodeIndices[0] ?? -1;
    // Instructions can contain labels such as 客戶採購單號 or 訂單編號. They
    // cannot supply document identity, including the legacy fixed-row fallback.
    const metadata = data.map((row, index) => index > headerIndex && itemCodeIndex >= 0 &&
        String(row[itemCodeIndex] ?? '').trim() === 'WMS-NOTE' ? [] : row);
    const fallback = index => {
        const text = String(metadata[index]?.[0] ?? '').trim();
        return /^(?:備註\s*[:：]\s*)?(?:原|沖正原)/.test(text) ? '' : text.split(/[:：]/).slice(1).join(':').trim();
    };
    const voucherNumber = labelValue(metadata, ['憑證號碼', '憑證號', '訂單編號', '訂單號碼', '訂單號', '單號', 'Voucher']) || fallback(1);
    const customerName = labelValue(metadata, ['客戶名稱', '客戶', '收貨人', 'Customer']) || fallback(2) || null;
    if (!voucherNumber) throw invalid('找不到訂單號碼（憑證號碼），請確認檔案含「憑證號碼：xxxx」或「訂單編號：xxxx」');
    if (voucherNumber.length > 255 || (customerName?.length || 0) > 255) throw invalid('訂單號碼或客戶名稱不可超過 255 字');
    if (headerIndex < 0) throw invalid('找不到完整品項表頭：需包含品項編碼／國際條碼、品項名稱、數量');
    const barcodeIndex = header.findIndex(isBarcodeHeader);
    // Only the actual item-code column reserves WMS-NOTE. A separate barcode
    // or model column must never silently turn a real zero-quantity SKU into a note.
    const physicalBarcodeIndices = header.flatMap((value, index) => /國際條碼|條碼/.test(String(value)) && !/品項編碼/.test(String(value)) ? [index] : []);
    const serialIndices = header.flatMap((value, index) => /SN|序號/i.test(String(value)) && !/摘要/.test(String(value)) ? [index] : []);
    const summaryIndices = header.flatMap((value, index) => /摘要/.test(String(value)) ? [index] : []);
    const freightCodeIndex = itemCodeIndices.length === 1 && normalizedHeader(header[itemCodeIndex]) === '品項編碼' ? itemCodeIndex : -1;
    const freightScanIndices = header.flatMap((value, index) =>
        physicalBarcodeIndices.includes(index) || matchesSourceHeader(value, 'internalScanCode') || matchesSourceHeader(value, 'barcode') ? [index] : []);
    const freightEvidenceIndices = header.flatMap((value, index) =>
        serialIndices.includes(index) || matchesSourceHeader(value, 'serials') || isActualSNHeader(value) || isCartonHeader(value) ? [index] : []);
    const nameIndex = header.findIndex(value => String(value).includes('品項名稱'));
    const quantityIndex = header.findIndex(value => String(value).includes('數量'));
    const modelIndex = header.findIndex(value => /品項型號|型號|Product Code/.test(String(value)));
    const summaryIndex = header.findIndex(value => !isActualSNHeader(value) && /摘要|SN|序號/i.test(String(value)));
    const actualIndices = header.flatMap((value,index) => isActualSNHeader(value) ? [index] : []);
    if(actualIndices.length>1)throw invalid('實際SN表頭重複');
    const actualSNIndex=actualIndices[0]??-1;
    const dedicatedSerialColumn = summaryIndex >= 0 && !String(header[summaryIndex]).includes('摘要');
    const items = [];
    const shippingNotes = [];
    const omittedNonStock = [];
    let freightExemptQuantity = 0;
    let shippingNotesCharacters = 0;
    const seenSerials = new Set();
    let totalQuantity = 0;
    const lastContentIndex = data.findLastIndex(row => row.some(value => String(value ?? '').trim()));
    for (let index = headerIndex + 1; index < data.length; index++) {
        const row = data[index];
        if (index === lastContentIndex && (items.length || shippingNotes.length || omittedNonStock.length) && isPrintTimestampRow(row)) continue;
        const barcode = String(row[barcodeIndex] ?? '').trim();
        const rawName = String(row[nameIndex] ?? '').trim();
        const rawQuantity = String(row[quantityIndex] ?? '').trim();
        if (itemCodeIndex >= 0 && String(row[itemCodeIndex] ?? '').trim() === 'WMS-NOTE') {
            try {
                if (itemCodeIndices.length !== 1) throw invalid('品項編碼欄位重複，無法確認 WMS-NOTE 備註列');
                if (rawQuantity && !/^[+-]?0+(?:\.0+)?$/.test(rawQuantity)) throw invalid('WMS-NOTE 備註列的數量只能為 0 或空白');
                if (!rawName) throw invalid('WMS-NOTE 備註列必須在品項名稱填寫備註文字');
                if (physicalBarcodeIndices.some(column => String(row[column] ?? '').trim())) throw invalid('WMS-NOTE 備註列不可填寫獨立的國際條碼／條碼');
                if (serialIndices.some(column => String(row[column] ?? '').trim())) throw invalid('WMS-NOTE 備註列不可包含 SN／序號');
                for (const column of summaryIndices) {
                    try { parseSerials(row[column], 'WMS-NOTE', 0, false); }
                    catch { throw invalid('WMS-NOTE 備註列不可在摘要填寫 SN／序號'); }
                }
                if (rawName.length > IMPORT_LIMITS.shippingNoteCharacters) throw invalid(`每則出貨備註最多 ${IMPORT_LIMITS.shippingNoteCharacters} 字`, 413);
                if (shippingNotes.length >= IMPORT_LIMITS.shippingNotes || shippingNotesCharacters + rawName.length > IMPORT_LIMITS.shippingNotesCharacters) {
                    throw invalid(`每單出貨備註最多 ${IMPORT_LIMITS.shippingNotes} 則、合計 ${IMPORT_LIMITS.shippingNotesCharacters} 字`, 413);
                }
                shippingNotes.push({ sourceRow: index + 1, text: rawName });
                shippingNotesCharacters += rawName.length;
                continue;
            } catch (error) {
                if (error.code === 'IMPORT_NOT_APPLIED') error.message = `第 ${index + 1} 列：${error.message}`;
                throw error;
            }
        }
        if (!barcode && !rawName && !rawQuantity) continue;
        if (/^(?:合計|總計|小計|備註|以下空白|TOTAL|SUBTOTAL)[:：]?$/i.test(barcode) && !rawName) continue;
        if (isBarcodeHeader(barcode) && rawName.includes('品項名稱') && rawQuantity.includes('數量')) continue;
        try {
            const normalizedQuantity = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.0+)?$/.test(rawQuantity) ? rawQuantity.replace(/,/g, '') : rawQuantity;
            const quantity = Number(normalizedQuantity);
            let productCode = modelIndex >= 0 ? String(row[modelIndex] ?? '').trim() : '';
            const explicitProductCode = String(row[freightCodeIndex] ?? '').trim();
            const freight = quantity > 0 && isPickingFreight(explicitProductCode, rawName) &&
                (!productCode || productCode === explicitProductCode) &&
                freightScanIndices.every(column => {
                    const value = String(row[column] ?? '').trim();
                    return !value || (matchesSourceHeader(header[column], 'barcode') && value === PICKING_FREIGHT_CODE);
                }) &&
                !freightEvidenceIndices.some(column => String(row[column] ?? '').trim()) &&
                !summaryIndices.some(column => summaryRequiresExplicitSerials(row[column], explicitProductCode, quantity));
            if ((!barcode && !freight) || !rawName || !rawQuantity) throw invalid('品項編碼、名稱與數量皆必填');
            const identifierIndex = freight ? freightCodeIndex : barcodeIndex;
            const cellAddress = xlsx.utils.encode_cell({ r: index, c: identifierIndex });
            const identifierCell = row[identifierIndex];
            validateBarcode(freight ? explicitProductCode : barcode,
                worksheet?.[cellAddress] || (typeof identifierCell === 'number' ? { t: 'n', v: identifierCell } : undefined),
                { sheet: sheetName, row: index + 1, cell: cellAddress });
            if (!Number.isSafeInteger(quantity) || quantity === 0) throw invalid('數量必須為非零整數，可填正數或負數');
            if (items.length + omittedNonStock.length >= IMPORT_LIMITS.items) throw invalid(`每單最多 ${IMPORT_LIMITS.items} 個品項`, 413);
            if (totalQuantity + freightExemptQuantity + Math.abs(quantity) > IMPORT_LIMITS.totalQuantity) throw invalid(`每單總數量最多 ${IMPORT_LIMITS.totalQuantity}`, 413);
            if (freight) {
                omittedNonStock.push({ productCode: explicitProductCode, productName: rawName, quantity, sourceRow: index + 1 });
                freightExemptQuantity += quantity;
                continue;
            }
            let productName = rawName;
            if (!productCode) {
                const match = rawName.match(/\[(.*?)\]/);
                if (match) { productCode = match[1].trim(); productName = rawName.slice(0, match.index).trim(); }
            }
            productCode ||= barcode;
            if (!productName) throw invalid('品項名稱不可為空');
            if ([barcode, productCode, productName].some(value => value.length > 255)) throw invalid('品項編碼、型號與名稱不可超過 255 字');
            const exact = exactSerials(actualSNIndex >= 0 ? row[actualSNIndex] : '', quantity);
            const legacy = parseSerials(summaryIndex >= 0 ? row[summaryIndex] : '', barcode, Math.abs(quantity), dedicatedSerialColumn);
            if(exact.length&&legacy.length&&JSON.stringify([...exact].sort())!==JSON.stringify([...legacy].sort()))throw invalid('實際SN與舊SN欄不一致');
            const serials=exact.length?exact:legacy;
            const serialMode=exact.length?'exact':'legacy';
            for (const serial of serials) {
                if (seenSerials.has(serial)) throw invalid(`SN ${serial} 在其他品項已出現，請勿重複匯入`);
                seenSerials.add(serial);
            }
            totalQuantity += Math.abs(quantity);
            if (seenSerials.size > IMPORT_LIMITS.serials) throw invalid(`每單最多 ${IMPORT_LIMITS.serials} 筆 SN`, 413);
            items.push({ barcode, productCode, productName, quantity, serials, serialMode,sourceRow: index + 1 });
        } catch (error) {
            if (error.code === 'IMPORT_NOT_APPLIED') error.message = `第 ${index + 1} 列：${error.message}`;
            throw error;
        }
    }
    if (!items.length) {
        if (shippingNotes.length) throw invalid('只有出貨備註（WMS-NOTE），沒有可匯入的品項。請重新匯出含商品明細的理貨單。');
        throw invalid('沒有可匯入的品項，未建立訂單');
    }
    const negativeQuantity = items.filter(item => item.quantity < 0).reduce((sum, item) => sum + Math.abs(item.quantity), 0);
    const positiveQuantity = totalQuantity - negativeQuantity;
    const signedTotalQuantity = positiveQuantity - negativeQuantity;
    const documentType = negativeQuantity ? positiveQuantity ? 'adjustment' : 'reversal' : 'shipment';
    return { voucherNumber, customerName, items, shippingNotes, totalQuantity, serialCount: seenSerials.size,
        documentType, signedTotalQuantity, positiveQuantity, negativeQuantity,
        ...(omittedNonStock.length ? { omittedNonStock, freightExemptQuantity } : {}) };
}

function readOrderImportRows(buffer) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw invalid('沒有可讀取的檔案內容');
    if (buffer.length > IMPORT_LIMITS.fileBytes) throw invalid('檔案不可超過 10 MiB', 413);
    let worksheet, sheetName;
    try {
        // raw preserves CSV text identifiers (including leading zeros and literal
        // exponent strings). XLS/XLSX retain typed cells for precision checks.
        const workbook = readOrderImportWorkbook(buffer, { type: 'buffer', raw: true, sheets: 0, sheetRows: IMPORT_LIMITS.sheetRows + 1, cellStyles: false });
        sheetName = workbook.SheetNames[0];
        worksheet = workbook.Sheets[sheetName];
    } catch { throw invalid('無法讀取檔案，請確認是未加密的 .xlsx、.xls 或 .csv'); }
    if (!worksheet?.['!ref']) throw invalid('第一個工作表沒有資料');
    const range = xlsx.utils.decode_range(worksheet['!fullref'] || worksheet['!ref']);
    if (range.e.r >= IMPORT_LIMITS.sheetRows || range.e.c >= IMPORT_LIMITS.sheetColumns) {
        throw invalid(`工作表範圍超限，最多 ${IMPORT_LIMITS.sheetRows} 列、${IMPORT_LIMITS.sheetColumns} 欄；請縮小後匯入`, 413);
    }
    const data = xlsx.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '', range: 0 });
    importSheetContext.set(data, { worksheet, sheetName });
    return { data, worksheet, sheetName };
}

function parseWorksheet({ data, worksheet, sheetName }, ecount) {
    try {
        const index = sourceHeaderIndex(data);
        return index < 0 ? parseOrderRows(data, { worksheet, sheetName }) : parseSourceOrderRows(data, index, ecount);
    }
    catch (error) {
        if (error.code === 'IMPORT_NOT_APPLIED') error.message = `工作表「${sheetName}」${error.issue?.cell ? ` ${error.issue.cell}` : ''}，${error.message}`;
        throw error;
    }
}

function parseOrderImport(buffer) {
    return parseWorksheet(readOrderImportRows(buffer));
}

async function parsePickingImport(buffer, db) {
    const sheet = readOrderImportRows(buffer);
    const index = sourceHeaderIndex(sheet.data);
    if (index < 0 || !isEcountPickingExport(sheet.data, index)) return parseWorksheet(sheet);
    const header = sheet.data[index];
    const columns = Object.fromEntries(Object.keys(SOURCE_HEADERS).map(key => [key, header.findIndex(value => matchesSourceHeader(value, key))]));
    const { readEcountPickingIdentities } = require('./ecountPickingIdentities');
    return parseWorksheet(sheet, await readEcountPickingIdentities(db, sheet.data.slice(index+1), columns));
}
module.exports = { IMPORT_LIMITS, parseOrderImport, parsePickingImport, parseOrderRows, ecountSerialTokens };
