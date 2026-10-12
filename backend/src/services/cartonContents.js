const { createHash } = require('node:crypto');
const fail = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function text(value, name, { optional = false, max = 255 } = {}) {
    if (optional && (value === undefined || value === null || value === '')) return null;
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) {
        throw fail('CARTON_INVALID_INPUT', `${name} 無效`, 400);
    }
    return value.trim();
}
function positive(value, name) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 1000000) throw fail('CARTON_INVALID_INPUT', `${name} 必須是正整數`, 400);
    return value;
}
function serials(value = []) {
    if (!Array.isArray(value) || value.length > 1000) throw fail('CARTON_INVALID_INPUT', 'SN 清單無效或超過 1000 筆', 400);
    const out = value.map(value => {
        const sn = text(value, 'SN', { max: 100 });
        if (!/^[!-~]+$/.test(sn) || sn.includes(',') || /^(CARTON:|CTN-)/i.test(sn)) throw fail('CARTON_INVALID_INPUT', 'SN 必須是 1–100 字可列印 ASCII，不含空白、逗號或箱號前綴', 400);
        return sn;
    });
    if (new Set(out).size !== out.length) throw fail('CARTON_DUPLICATE_SN', '箱內 SN 不可重複', 400);
    return out;
}
function normalizeLines(input) {
    if (!Array.isArray(input) || !input.length || input.length > 100) throw fail('CARTON_INVALID_INPUT', '箱內容必須有 1 至 100 個品項', 400);
    const allSN = [];
    const lines = input.map(line => {
        if (!line || typeof line !== 'object') throw fail('CARTON_INVALID_INPUT', '箱內容格式無效', 400);
        const itemCode = text(line.itemCode, '品項內碼');
        const ean = text(line.ean, '國際條碼', { optional: true });
        const internalScanCode = text(line.internalScanCode, '內部掃描碼', { optional: true });
        if (internalScanCode && !/^ITM-[A-Za-z0-9._-]{1,96}$/.test(internalScanCode)) throw fail('CARTON_INVALID_INPUT', '內部掃描碼需 ITM- 前綴及 1–96 字英數、點、底線或連字號', 400);
        const quantity = positive(line.quantity, '實際數量');
        const actualSN = serials(line.actualSN);
        if (actualSN.length && actualSN.length !== quantity) throw fail('CARTON_SN_QUANTITY_MISMATCH', 'SN 筆數必須等於實際數量', 400);
        allSN.push(...actualSN);
        return { itemCode, productName: text(line.productName, '品名', { optional: true }), ean, internalScanCode,
            codeType: ean ? 'international' : internalScanCode ? 'internal' : 'legacy', quantity, actualSN };
    });
    if (allSN.length > 1000 || new Set(allSN).size !== allSN.length) throw fail('CARTON_DUPLICATE_SN', '箱內各品項 SN 不可重複且最多 1000 筆', 400);
    return lines;
}
function normalizeCarton(body) {
    return { cartonId: text(body?.cartonId, '箱號', { max: 128 }),
        sourceSystem: text(body.sourceSystem, '來源系統', { optional: true, max: 128 }),
        sourceReference: text(body.sourceReference, '來源識別', { optional: true, max: 512 }), lines: normalizeLines(body.lines) };
}
function identity(carton) {
    return [carton.cartonId, carton.sourceSystem ?? null, carton.sourceReference ?? null,
        carton.lines.map(line => [line.itemCode, line.productName ?? null, line.ean ?? null, line.internalScanCode ?? null,
            line.quantity, [...line.actualSN].sort()])];
}
function matchesItem(line, item) {
    if (line.itemCode !== item.product_code) return false;
    if (!line.ean && item.code_type === 'international') return false;
    if (!line.ean && item.internal_scan_code && item.internal_scan_code !== line.internalScanCode) return false;
    if (!line.ean && !line.internalScanCode) return true;
    // Legacy barcode has unknown code type; only exact equality is accepted.
    // No EAN inference, numeric conversion, campaign-prefix or fuzzy matching.
    if (line.ean) return [item.barcode, item.international_barcode].includes(line.ean);
    // A newly assigned ITM code may not exist on a legacy picking export. The
    // separately confirmed itemCode remains the exact identity. Once an order
    // has an explicit internal identity, a different code must not bypass it.
    if (item.internal_scan_code) return item.internal_scan_code === line.internalScanCode;
    return true;
}
function choosePickLines(carton, body, items, instances) {
    const mode = body.mode ?? 'whole';
    const serialPolicy = body.serialPolicy ?? 'preassigned';
    if (!['from-carton','preassigned'].includes(serialPolicy)) throw fail('CARTON_INVALID_INPUT', 'SN 綁定策略無效', 400);
    if (!['whole', 'split'].includes(mode)) throw fail('CARTON_INVALID_INPUT', '箱掃描模式無效', 400);
    if (body.selections !== undefined && (!Array.isArray(body.selections) || !body.selections.length || body.selections.length > 100)) {
        throw fail('CARTON_INVALID_INPUT', '拆箱選擇無效', 400);
    }
    if (mode === 'split' && !body.selections) throw fail('CARTON_SELECTION_REQUIRED', '拆箱必須明確選擇數量或實際 SN', 400);
    const byLine = new Map(carton.lines.map(line => [line.lineId, line]));
    const requests = body.selections ?? carton.lines.filter(line => line.remainingQuantity > 0).map(line => ({ lineId: line.lineId }));
    if (!requests.length) throw fail('CARTON_EMPTY', '此箱已無可分配內容');
    const selected = [], quantities = new Map(), selectedSN = new Set(), pairs = new Set();
    for (const request of requests) {
        if (!request || typeof request !== 'object') throw fail('CARTON_INVALID_INPUT', '箱內容選擇無效', 400);
        const line = byLine.get(Number(request.lineId));
        if (!line) throw fail('CARTON_INVALID_INPUT', '箱內容列不存在', 400);
        let actualSN = [];
        if (line.actualSN.length) {
            actualSN = request.actualSN === undefined ? [...line.remainingSN] : serials(request.actualSN);
            if (!actualSN.length || actualSN.some(sn => !line.remainingSN.includes(sn))) throw fail('CARTON_SN_UNAVAILABLE', '所選 SN 不在此箱剩餘內容中');
        } else if (request.actualSN !== undefined && serials(request.actualSN).length) {
            throw fail('CARTON_SN_MISMATCH', '此箱品項沒有 SN');
        }
        const quantity = request.quantity === undefined ? (actualSN.length || line.remainingQuantity) : positive(request.quantity, '拆箱數量');
        if (quantity > line.remainingQuantity || quantity <= 0) throw fail('CARTON_QUANTITY_EXCEEDED', '所選數量超過箱內剩餘');
        if (line.actualSN.length && quantity !== actualSN.length) throw fail('CARTON_EXACT_SN_REQUIRED', 'SN 拆箱必須選出確切 SN，不能只輸入數量');
        const candidates = items.filter(item => matchesItem(line, item));
        if (!candidates.length) throw fail('CARTON_ITEM_NOT_IN_ORDER', '箱內品項或掃描碼不屬於此訂單');
        const groups = new Map();
        if (actualSN.length && request.orderItemId === undefined && candidates.length > 1) {
            // Source lines with the same product are resolved only by each
            // exact SN's unique order-instance owner, never product names.
            for (const sn of actualSN) {
                const owners = instances.filter(unit => unit.serial_number === sn && candidates.some(item => item.id === unit.order_item_id));
                if (owners.length !== 1) throw fail('CARTON_ORDER_LINE_REQUIRED', 'SN 未唯一對應訂單品項列，請明確選擇');
                const id = owners[0].order_item_id;
                if (!groups.has(id)) groups.set(id, []);
                groups.get(id).push(sn);
            }
        } else {
            if (candidates.length > 1 && request.orderItemId === undefined) throw fail('CARTON_ORDER_LINE_REQUIRED', '此品項在訂單有多列，請明確選擇對應品項列');
            const item = request.orderItemId === undefined ? candidates[0] : candidates.find(item => item.id === Number(request.orderItemId));
            if (!item) throw fail('CARTON_ITEM_NOT_IN_ORDER', '指定品項列不屬於箱內品項');
            groups.set(item.id, actualSN);
        }
        for (const [itemId, groupSN] of groups) {
            const item = candidates.find(row => row.id === itemId), pair = `${line.lineId}:${itemId}`;
            if (pairs.has(pair)) throw fail('CARTON_DUPLICATE_SELECTION', '同箱品項對同訂單列不可重複選擇', 400);
            pairs.add(pair);
            if (Number(item.quantity_sign ?? 1) !== 1) throw fail('SIGNED_CARTON_REVIEW_REQUIRED', '負向箱號作業需主管核對，請沿用單品正負核對流程；不會自動補回箱數量');
            const orderSN = instances.filter(unit => unit.order_item_id === item.id);
            let newSN = [];
            if (groupSN.length) {
                const canBind = serialPolicy === 'from-carton' && (item.carton_serial_binding === true || !orderSN.length);
                if (canBind) {
                    if (Number(item.picked_quantity) || Number(item.packed_quantity)) throw fail('CARTON_SERIAL_PROGRESS_CONFLICT', '已有單品揀貨／裝箱數量，不可直接轉成箱內 SN；請先核對原進度');
                    newSN = groupSN.filter(sn => !orderSN.some(unit => unit.serial_number === sn));
                    if (groupSN.some(sn => orderSN.some(unit => unit.serial_number === sn && unit.status !== 'pending'))) throw fail('CARTON_SN_NOT_PENDING', '所選 SN 已揀貨或裝箱，不能再次分配');
                } else if (!orderSN.length) {
                    throw fail('CARTON_SERIAL_POLICY_REQUIRED', '此理貨單未預配 SN，請明確選擇由箱內容綁定實際 SN');
                } else if (orderSN.length !== item.quantity || groupSN.some(sn => orderSN.filter(unit => unit.serial_number === sn && unit.status === 'pending').length !== 1)) {
                    throw fail('CARTON_SN_NOT_PENDING', '箱內 SN 不完整、重複或不屬於此訂單待揀 SN');
                }
            } else if (orderSN.length || item.carton_serial_binding === true) {
                throw fail('CARTON_SN_MISMATCH', '箱與訂單的 SN 管控方式不一致');
            }
            for (const sn of groupSN) {
                if (selectedSN.has(sn)) throw fail('CARTON_DUPLICATE_SELECTION', '同一 SN 不可分配兩次', 400);
                selectedSN.add(sn);
            }
            const groupQuantity = groupSN.length || quantity;
            quantities.set(line.lineId, (quantities.get(line.lineId) ?? 0) + groupQuantity);
            selected.push({ lineId: line.lineId, orderItemId: item.id, itemCode: line.itemCode,
                ean: line.ean, internalScanCode: line.internalScanCode, quantity: groupQuantity, quantitySign: 1, actualSN: groupSN, newSN,
                sourceSKU: item.source_sku ?? null, sourceLineId: item.source_line_id ?? null,
                sourcePlatform: item.source_platform ?? null, sourceStore: item.source_store ?? null,
                sourceOrderNumber: item.source_order_number ?? null, sourceProductCode: item.product_code,
                sourceQuantitySign: item.quantity_sign ?? 1 });
        }
    }
    for (const line of carton.lines) {
        const quantity = quantities.get(line.lineId) ?? 0;
        if (quantity > line.remainingQuantity) throw fail('CARTON_QUANTITY_EXCEEDED', '多組分配總量超過箱內剩餘');
        if (mode === 'whole' && quantity !== line.remainingQuantity) throw fail('CARTON_SPLIT_REQUIRED', '整箱必須包含全部剩餘品項');
    }
    for (const item of items) {
        const units = selected.filter(line => line.orderItemId === item.id);
        const quantity = units.reduce((sum, line) => sum + line.quantity, 0);
        const newQuantity = units.reduce((sum, line) => sum + line.newSN.length, 0);
        if (instances.filter(unit => unit.order_item_id === item.id).length + newQuantity > item.quantity) {
            throw fail('CARTON_ORDER_QUANTITY_EXCEEDED', '新增箱內 SN 超過理貨單需求數量');
        }
        if (!units.some(line => line.actualSN.length) && quantity > Number(item.quantity) - Number(item.picked_quantity ?? 0)) {
            throw fail('CARTON_ORDER_QUANTITY_EXCEEDED', '整箱超過訂單待揀數量，請明確拆箱');
        }
    }
    return selected;
}
module.exports = { fail, digest, text, positive, serials, normalizeLines, normalizeCarton, identity, matchesItem, choosePickLines };
