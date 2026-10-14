import { parseSerialInput } from './cartonScan.js';

export const canManageCartons = user => ['admin', 'superadmin'].includes(user?.role);
export const pendingBoxCreationKey = (userId, specId) => `corely:wms:pending-box-creation:v1:${userId}:${specId}`;
export const pendingCartonEditorKey = userId => `corely:wms:pending-carton-editor:v1:${userId}`;
export const blankCartonLine = () => ({ editorLineId: crypto.randomUUID(), itemCode: '', productName: '', ean: '', internalScanCode: '', quantity: '', serialInput: '', hasSerials: false });
export function uniqueExactCartonItem(items, query) {
    const text = String(query || '').trim();
    const matches = items.filter(item => item.itemCode === text || item.importedBarcode === text || item.productName === text);
    return matches.length === 1 ? matches[0] : null;
}
export function validateActualSerial(raw) {
    const value = String(raw ?? '').trim();
    if (!value || value.length > 100 || !/^[!-~]+$/.test(value) || value.includes(',') || /^(CARTON:|CTN-|BOX-SPEC:)/i.test(value)) throw new Error('請掃描商品實際 SN，保留原大小寫，不可使用商品條碼清單或箱號。');
    return value;
}
export function appendCartonSerial(lines, index, raw) {
    const value = validateActualSerial(raw);
    const existing = lines.findIndex(line => parseSerialInput(line.serialInput).includes(value));
    if (existing !== -1) throw new Error(`SN ${value} 已在品項 ${existing + 1}，未重複加入。`);
    const current = parseSerialInput(lines[index].serialInput);
    const quantity = Number(lines[index].quantity);
    if (Number.isSafeInteger(quantity) && quantity > 0 && current.length >= quantity) throw new Error(`已掃滿 ${quantity} 件，SN ${value} 未加入。請先核對件數。`);
    return lines.map((line, i) => i === index ? { ...line, hasSerials: true, serialInput: [...current, value].join('\n') } : line);
}
export function editorLinePayload(lines, kind = 'physical') {
    if (!lines.length || lines.length > 100) throw new Error('請加入 1 至 100 個品項。');
    const allSN = new Set();
    const text = (raw, label, optional = false) => {
        const value = String(raw ?? '').trim();
        if (!value && optional) return null;
        if (!value || value.length > 255 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label}必須填寫有效內容。`);
        return value;
    };
    const payload = lines.map((line, index) => {
        const label = `品項 ${index + 1}：`;
        const quantity = Number(line.quantity);
        if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) throw new Error(`${label}請填每箱實際數量（正整數）。`);
        const actualSN = parseSerialInput(line.serialInput).map(validateActualSerial);
        if (kind === 'spec' && (line.hasSerials || actualSN.length)) throw new Error(`${label}有 SN 的商品請使用序號箱。`);
        if (!line.hasSerials && actualSN.length) throw new Error(`${label}已有 SN，請保留「此商品有 SN」或先移除 SN。`);
        if (line.hasSerials && actualSN.length !== quantity) throw new Error(`${label}已掃 ${actualSN.length}／${quantity} 件，SN 必須與實際數量一致。`);
        for (const sn of actualSN) {
            if (allSN.has(sn)) throw new Error(`SN ${sn} 在箱內重複，請修正後再確認。`);
            allSN.add(sn);
        }
        const internalScanCode = text(line.internalScanCode, `${label}內部掃描碼`, true);
        if (internalScanCode && !/^ITM-[A-Za-z0-9._-]{1,96}$/.test(internalScanCode)) throw new Error(`${label}內部掃描碼需 ITM- 前綴。`);
        return { itemCode: text(line.itemCode, `${label}品號／型號`), productName: text(line.productName, `${label}品名`, true), ean: text(line.ean, `${label}國際條碼`, true), internalScanCode, quantity,
            ...(kind === 'spec' ? {} : { actualSN }) };
    });
    if (allSN.size > 1000) throw new Error('一箱最多登錄 1000 個 SN。');
    return payload;
}
export const editorPayloadKey = (lines, kind) => JSON.stringify(editorLinePayload(lines, kind));
export function cartonLabelSize(width, height) {
    const w = Number(width), h = Number(height);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 30 || w > 150 || h < 40 || h > 200) throw new Error('貼紙寬度可設 30–150 mm，高度可設 40–200 mm。');
    return { width: w, height: h, qr: Math.max(20, Math.min(w - 8, h - 25, 65)) };
}
