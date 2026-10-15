export const ecountReferenceStatus = Object.freeze({ unlinked: '未綁定', reference_only: '待人工核對', manual_checked: '已人工核對', changed: '內容有變，待重新核對' });
export const pendingEcountReferenceKey = (actorId, orderId) => `wms_ecount_reference_pending:${actorId}:${orderId}`;

export function canonicalEcountVoucher(value) {
    const literal = String(value || '').trim();
    const match = /^(\d{4})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{1,2})\s*[-－–—]\s*(\d{1,9})$/.exec(literal);
    if (!match) return literal;
    const [year, month, day, number] = match.slice(1).map(Number), date = new Date(Date.UTC(year, month - 1, day));
    if (year < 1000 || number < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return literal;
    return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}-${number}`;
}

export function parseExternalEcountLines(value) {
    const original = String(value || '');
    if (new TextEncoder().encode(original).byteLength > 2 * 1024 * 1024) throw new Error('原單明細超過 2 MiB，內容沒有截斷；請確認單據範圍。');
    const rows = original.split(/\r?\n/).map((row, index) => ({ cells: row.split('\t').map(cell => cell.trim()), number: index + 1 })).filter(row => row.cells.some(Boolean));
    if (rows.length && /^(品項|品號|品項編碼)$/.test(rows[0].cells[0]) && rows[0].cells[1] === '數量') rows.shift();
    if (!rows.length) throw new Error('請貼上原 ECOUNT 單據的品號與數量。');
    if (rows.length > 10000) throw new Error('每次最多核對 10,000 列。');
    const serials = new Set();
    return rows.map(({ cells, number }) => {
        const [itemCode, count, serial = ''] = cells;
        if (cells.length < 2 || cells.length > 3 || !itemCode || itemCode.length > 100 || /[\u0000-\u001f\u007f]/.test(itemCode)) throw new Error(`第 ${number} 列：請以 Tab 分隔品號、數量與選填 SN。`);
        if (!/^(?:[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.0+)?$/.test(count || '')) throw new Error(`第 ${number} 列：數量須為正整數。`);
        const quantity = Number(count.replaceAll(',', ''));
        if (!Number.isSafeInteger(quantity) || quantity > 1000000) throw new Error(`第 ${number} 列：數量須為 1 至 1,000,000 的整數。`);
        if (serial && (quantity !== 1 || serial.length > 100 || /[^\x21-\x7e]|,/.test(serial) || /^(?:CARTON:|BOX-SPEC:|CTN-)/i.test(serial))) throw new Error(`第 ${number} 列：有 SN 時每列填一個實際 SN，數量為 1。`);
        if (serial && serials.has(serial)) throw new Error(`第 ${number} 列：SN「${serial}」重複。`);
        if (serial) serials.add(serial);
        return { itemCode, quantity, ...(serial ? { actualSN: [serial] } : {}) };
    });
}

export function assertEcountReferenceRequestSize(body) {
    const size = new TextEncoder().encode(JSON.stringify(body)).byteLength;
    if (size > 2 * 1024 * 1024) throw new Error('原單明細超過 2 MiB，請確認單據範圍後再核對；內容沒有截斷或送出。');
    return size;
}

export function buildEcountCartonSummary(data = {}) {
    const result = [`WMS全單出貨對照：${data.shipmentReference || `WMS-${data.orderId}`}${data.ready === false ? '（尚未完成核對）' : ''}`];
    if (data.reference?.voucherNumber) result.push(`原銷貨單：${data.reference.companyCode} / ${data.reference.voucherNumber}`);
    for (const line of data.totals || []) {
        const boxes = new Map();
        for (const row of data.rows || []) if (row.itemCode === line.itemCode) boxes.set(row.cartonId, (boxes.get(row.cartonId) || 0) + row.quantity);
        const details = [...boxes].map(([cartonId, quantity]) => `${cartonId} × ${quantity}`);
        if (line.looseQuantity) details.push(`散件 × ${line.looseQuantity}`);
        result.push(`${line.itemCode}：${details.join('、')}；此品項合計 ${line.quantity} 件`);
    }
    return result.join('\n');
}

export function validEcountReferenceResponse(data, orderId) {
    return data && Number(data.orderId) === Number(orderId) && /^[a-f0-9]{64}$/.test(data.fingerprint || '') && Object.hasOwn(ecountReferenceStatus, data.status)
        && Array.isArray(data.rows) && Array.isArray(data.totals) && Array.isArray(data.cartonSummary) && Array.isArray(data.blockers);
}
