const SHEET = '箱號明細';
const SUPPORTED_SHEETS = [SHEET, '箱號明細.範本', '倉儲明細', '倉儲明細.範本'];
const REQUIRED = ['箱號', '品號', '數量', 'SN'];
const FIELDS = [...REQUIRED, '品名', '國際條碼', '內部掃描碼', '來源系統', '來源識別'];
const LIMITS = { cartons: 100, lines: 100, cartonSN: 1000, totalSN: 10000, rows: 20001, columns: 256 };
const sheetIssue = (sheet, row, message) => new Error(`「${sheet}」第 ${row} 列：${message}`);

function cellValue(cell, label, row, XLSX, issue, { max = 255, identifier = true, multiline = false } = {}) {
    if (!cell) return '';
    if (cell.f != null || cell.F != null) throw issue(row, `${label}不能使用公式，請貼上純值`);
    if (cell.t === 'e') throw issue(row, `${label}含 Excel 錯誤值，請改為文字或數字`);
    if (cell.v == null || cell.t === 'z') return '';
    let value;
    if (cell.t === 's' || cell.t === 'str') {
        if (typeof cell.v !== 'string') throw issue(row, `${label}文字格式無效`);
        value = cell.v;
    } else if (cell.t === 'n') {
        if (identifier && (!Number.isSafeInteger(cell.v) || cell.v < 0 || cell.v >= 1e15)) {
            throw issue(row, `${label}數字可能已失去精度，請用原始資料重新貼為文字`);
        }
        // SheetJS may cache formatted text on the cell. Format a copy so parsing never edits the workbook.
        value = String(cell.w ?? XLSX.utils.format_cell({ ...cell }));
        if (identifier && (!/^\d+$/.test(value) || value.replace(/^0+(?=\d)/, '') !== String(cell.v))) {
            throw issue(row, `${label}數字顯示不明確，請用原始資料重新貼為文字`);
        }
    } else {
        throw issue(row, `${label}請使用文字或數字`);
    }
    const control = multiline ? /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
    if (value.length > max || control.test(value)) throw issue(row, `${label}超過 ${max} 字或含不允許的字元`);
    return value.trim();
}

export function parseCartonExcel(workbook, XLSX) {
    const name = SUPPORTED_SHEETS.find(title => workbook?.Sheets?.[title]);
    const sheet = name && workbook.Sheets[name];
    if (!sheet) throw new Error(`找不到「${SHEET}」工作表`);
    const issue = (row, message) => sheetIssue(name, row, message);
    if (!sheet['!ref']) throw issue(1, '缺少欄位表頭');
    const range = XLSX.utils.decode_range(sheet['!ref']);
    if (![range.s.r, range.s.c, range.e.r, range.e.c].every(Number.isSafeInteger)
        || range.s.r !== 0 || range.s.c < 0 || range.e.r < range.s.r || range.e.c < range.s.c) {
        throw issue(1, '表頭必須在第 1 列，且工作表範圍必須有效');
    }
    if (range.e.r >= LIMITS.rows || range.e.c >= LIMITS.columns) {
        throw issue(1, `工作表不得超過 ${LIMITS.rows} 列或 ${LIMITS.columns} 欄，請移除多餘範圍或分批匯入`);
    }
    const dense = Array.isArray(sheet) ? sheet : sheet['!data'];
    const get = (r, c) => dense ? dense[r]?.[c] : sheet[XLSX.utils.encode_cell({ r, c })];
    const columns = new Map();
    for (let c = range.s.c; c <= range.e.c; c++) {
        const header = get(0, c);
        if (header?.f != null || header?.F != null) throw issue(1, '表頭不能使用公式');
        const label = typeof header?.v === 'string' ? header.v.trim().replace(/\s*(?:\(必填\)|（必填）)$/, '') : '';
        if (!FIELDS.includes(label)) continue;
        if (columns.has(label)) throw issue(1, `${label}欄重複`);
        columns.set(label, c);
    }
    const legacyBarcodeLayout = name !== SHEET && !columns.has('品號') && columns.has('國際條碼');
    const missing = REQUIRED.filter(field => !columns.has(field) && !(field === '品號' && legacyBarcodeLayout));
    if (missing.length) throw issue(1, `缺少欄位：${missing.join('、')}`);

    const cartons = new Map(), seenSN = new Map();
    for (let r = 1; r <= range.e.r; r++) {
        const row = r + 1;
        const read = (label, options) => columns.has(label) ? cellValue(get(r, columns.get(label)), label, row, XLSX, issue, options) : '';
        const cartonId = read('箱號', { max: 128 });
        const itemCode = read('品號');
        const qty = read('數量', { max: 32, identifier: false });
        const snText = read('SN', { max: 105000, multiline: true });
        const productName = read('品名', { identifier: false }) || null;
        const ean = read('國際條碼') || null;
        const internalScanCode = read('內部掃描碼', { max: 100 }) || null;
        const sourceSystem = read('來源系統', { max: 128 });
        const sourceReference = read('來源識別', { max: 512 });
        if (!cartonId && !itemCode && !qty && !snText && !productName && !ean && !internalScanCode && !sourceSystem && !sourceReference) continue;
        if (!cartonId || (!itemCode && !legacyBarcodeLayout)) throw issue(row, '箱號、品號必填');
        if (legacyBarcodeLayout && !/^\d{8,14}$/.test(ean ?? '')) throw issue(row, '缺少品號時須提供完整國際條碼');
        if (Boolean(sourceSystem) !== Boolean(sourceReference)) throw issue(row, '來源系統與來源識別須一起填寫');
        // Quantity is the numeric value rather than a formatted number with grouping separators.
        const qtyCell = get(r, columns.get('數量'));
        if (qtyCell?.t === 'n' && typeof qtyCell.z === 'string' && XLSX.SSF?.is_date?.(qtyCell.z)) {
            throw issue(row, '數量不能使用日期或時間格式');
        }
        const quantity = qtyCell?.t === 'n' ? qtyCell.v : /^\d+$/.test(qty) ? Number(qty) : NaN;
        if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1000000) {
            throw issue(row, '數量須為 1 至 1,000,000 的正整數');
        }
        if (internalScanCode && !/^ITM-[A-Za-z0-9._-]{1,96}$/.test(internalScanCode)) {
            throw issue(row, '內部掃描碼需以 ITM- 開頭，後接 1–96 字英數、點、底線或連字號');
        }
        const actualSN = snText ? snText.split(/[,，、\r\n]+/).map(sn => sn.trim()).filter(Boolean) : [];
        if (snText && (!actualSN.length || actualSN.length !== quantity)) throw issue(row, 'SN 筆數須等於數量；無 SN 請留空');
        let entry = cartons.get(cartonId);
        if (!entry) {
            if (cartons.size === LIMITS.cartons) throw issue(row, `一次最多匯入 ${LIMITS.cartons} 箱`);
            entry = { cartonId, lines: [], snCount: 0, sourceSystem, sourceReference };
            cartons.set(cartonId, entry);
        }
        if (entry.sourceSystem !== sourceSystem || entry.sourceReference !== sourceReference) {
            throw issue(row, '同一箱號的來源資料須一致');
        }
        if (entry.lines.length === LIMITS.lines) throw issue(row, `同箱最多 ${LIMITS.lines} 筆品項`);
        if (entry.snCount + actualSN.length > LIMITS.cartonSN) throw issue(row, `同箱最多 ${LIMITS.cartonSN} 筆 SN`);
        if (seenSN.size + actualSN.length > LIMITS.totalSN) throw issue(row, `一次最多匯入 ${LIMITS.totalSN} 筆 SN`);
        for (const sn of actualSN) {
            if (!/^[!-~]{1,100}$/.test(sn) || /^(CARTON:|CTN-)/i.test(sn)) throw issue(row, 'SN 須為 1–100 字可列印 ASCII，不含空白或箱號前綴');
            if (seenSN.has(sn)) throw issue(row, `SN ${sn} 重複（首次出現於第 ${seenSN.get(sn)} 列）`);
            seenSN.set(sn, row);
        }
        entry.snCount += actualSN.length;
        entry.lines.push({
            itemCode, quantity, actualSN, productName, ean, internalScanCode,
            ...(legacyBarcodeLayout ? { excelSource: { name, row } } : {}),
        });
    }
    if (!cartons.size) throw issue(2, '沒有可匯入的箱號明細');
    return {
        format: 'corely-cartons-v1',
        cartons: [...cartons.values()].map(({ cartonId, lines, sourceSystem, sourceReference }) => ({
            cartonId, lines, ...(sourceSystem ? { sourceSystem, sourceReference } : {}),
        })),
    };
}

export async function resolveCartonExcelItems(manifest, lookup) {
    const missing = manifest.cartons.flatMap(carton => carton.lines).filter(line => line.excelSource);
    if (!missing.length) return manifest;
    const barcodes = [...new Set(missing.map(line => line.ean))];
    const products = new Map();
    for (let offset = 0; offset < barcodes.length; offset += 1000) {
        const keys = barcodes.slice(offset, offset + 1000);
        const result = await lookup(keys);
        for (const barcode of keys) products.set(barcode, result?.products?.[barcode]);
    }
    return {
        ...manifest,
        cartons: manifest.cartons.map(carton => ({
            ...carton,
            lines: carton.lines.map(({ excelSource, ...line }) => {
                if (!excelSource) return line;
                const match = products.get(line.ean);
                const product = match?.status === 'matched' && match.matches?.length === 1 ? match.matches[0] : null;
                if (!product?.active || !product.erp_sku
                    || (product.barcode ? product.barcode !== line.ean : product.erp_sku !== line.ean)) {
                    throw sheetIssue(excelSource.name, excelSource.row,
                        `國際條碼 ${line.ean} 無法唯一對應啟用中的 ECOUNT 品號，請核對主檔或填入品號欄`);
                }
                return { ...line, itemCode: product.erp_sku };
            }),
        })),
    };
}
