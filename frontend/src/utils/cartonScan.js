export const isCartonScan = value => /^(?:CARTON:|BOX-SPEC:|CTN-)/i.test(String(value).trim()) || String(value).includes(',');
export const cartonSessionKey = (api, user) => JSON.stringify([user?.id, user?.role, user?.management_scope,
    user?.can_pick, user?.can_pack, user?.work_types,
    api.getSessionIdentity?.() ?? api.defaults?.headers?.common?.Authorization ?? '']);

export function cartonSerialScanTarget(value, snapshot) {
    const exact = snapshot.instances.find(unit => unit.serial_number === value);
    if (exact) {
        return Number(snapshot.items.find(item => item.id === exact.order_item_id)?.quantity_sign ?? 1) === 1;
    }
    return !snapshot.items.some(item => [item.barcode, item.international_barcode, item.internal_scan_code].includes(value));
}

export function cartonSplitOrderItems(line, items, instances, carton) {
    const usable = items.filter(item => Number(item.quantity_sign ?? 1) === 1
        && (!item.expected_carton_id || item.expected_carton_id === carton.cartonId));
    const exact = items.filter(item => item.product_code === line.itemCode);
    if (exact.length) return usable.filter(item => item.product_code === line.itemCode);
    const ean = line.ean;
    if (line.actualSN.length || line.internalScanCode || !/^(?:\d{8}|\d{12,14})$/.test(ean || '')
        || carton.lines.some(other => other.ean === ean && other.itemCode !== line.itemCode)) return [];
    const matches = items.filter(item => [item.barcode, item.international_barcode].includes(ean));
    if (matches.length !== 1) return [];
    const item = matches[0];
    return usable.includes(item) && (item.code_type ?? 'legacy') === 'legacy' && item.product_code === ean && item.barcode === ean
        && !item.internal_scan_code && !item.source_sku && !item.carton_serial_binding && item.serial_identity_mode !== 'exact'
        && (!item.international_barcode || item.international_barcode === ean)
        && !instances.some(unit => unit.order_item_id === item.id) ? [item] : [];
}

export function parseSerialInput(value) {
    return String(value || '').split(/[\r\n,]+/).map(v => v.trim()).filter(Boolean);
}

export function addCartonSplitSerial(carton, selections, instances, value) {
    const serial = value.trim();
    const line = carton.lines.find(row => row.remainingSN.includes(serial));
    if (!line) throw new Error('此 SN 不在來源箱的可揀內容中');
    if (selections.some(selection => selection.actualSN.includes(serial))) throw new Error('此 SN 已選取');

    const owners = instances.filter(unit => unit.serial_number === serial);
    if (owners.length > 1 || owners.some(unit => unit.status !== 'pending')) {
        throw new Error('此 SN 已核對或無法唯一對應本單待揀明細');
    }
    const groups = selections.filter(selection => selection.lineId === line.lineId);
    const owner = owners[0];
    const unassigned = groups.filter(selection => !selection.orderItemId);
    const target = (owner && groups.find(selection => Number(selection.orderItemId) === owner.order_item_id))
        || (unassigned.length === 1 ? unassigned[0] : null)
        || (!owner && groups.length === 1 ? groups[0] : null);
    if (!target) throw new Error('請先選擇此 SN 對應的理貨單品項');
    if (!owner && target.orderItemId && instances.some(unit => unit.order_item_id === Number(target.orderItemId))) {
        throw new Error('此 SN 不在所選理貨單品項的待揀清單中');
    }
    const actualSN = [...target.actualSN, serial];
    return selections.map(selection => selection === target ? { ...target, actualSN, quantity: actualSN.length } : selection);
}

export function getStickerSerialReview(value, type, snapshot) {
    if (!value.includes(',') || /^(?:CARTON:|CTN-)/i.test(value.trim()) || type !== 'pick') return null;
    const serials = value.split(',').map(serial => serial.trim());
    if (serials.some(serial => !serial) || new Set(serials).size !== serials.length) return null;
    const items = new Map(snapshot.items.map(item => [item.id, item]));
    const instances = new Map(), assignedCounts = new Map();
    for (const unit of snapshot.instances) {
        instances.set(unit.serial_number, instances.has(unit.serial_number) ? null : unit);
        assignedCounts.set(unit.order_item_id, (assignedCounts.get(unit.order_item_id) ?? 0) + 1);
    }
    const candidates = [];
    for (const serial of serials) {
        const unit = instances.get(serial);
        const item = items.get(unit?.order_item_id);
        if (unit?.status === 'pending' && item && Number(item.quantity_sign ?? 1) === 1
            && assignedCounts.get(item.id) === Number(item.quantity) && !item.expected_carton_id && !item.carton_serial_binding) {
            candidates.push({ serial, productName: item.product_name });
        }
    }
    return { candidates, excluded: serials.length - candidates.length };
}

export function applyStickerSerialResponse(snapshot, result, command) {
    const confirmedSerials = result?.confirmedSerials;
    if (!result?.order || String(result.order.id) !== String(snapshot.order?.id) || result.commandId !== command.commandId
        || result.baseState !== snapshot.stateToken || !/^[0-9a-f]{64}$/.test(result.stateToken || '')
        || !Array.isArray(result.items) || !Array.isArray(result.instances)
        || !Array.isArray(confirmedSerials) || confirmedSerials.length !== command.selectedSerials.length
        || !command.selectedSerials.every(serial => confirmedSerials.includes(serial))) {
        throw new Error('SN 清單掃描回應不完整，請重新核對');
    }
    return { order: result.order, items: result.items, instances: result.instances, stateToken: result.stateToken };
}

export function makeCartonCommand(preview, input) {
    const expectedState = preview.expectedState || preview.stateToken;
    const revision = preview.expectedCartonRevision ?? preview.carton?.stateRevision;
    if (!/^[0-9a-f]{64}$/.test(expectedState || '') || !Number.isInteger(revision)) {
        throw new Error('箱號或訂單版本不完整，請重新載入');
    }
    if (preview.expectedActorId !== input.expectedActorId) throw new Error('登入人員已變更，請重新載入');
    return { ...input, commandId: crypto.randomUUID(), expectedState, expectedCartonRevision: revision };
}

export async function sendCartonMutation(api, url, command) {
    const session = api.getSessionIdentity?.();
    const send = () => {
        if (session !== api.getSessionIdentity?.()) throw Object.assign(new Error('登入已更新，請重新載入核對'), { code: 'SESSION_CHANGED' });
        return api.post(url, command, { timeout: 15000 });
    };
    try { return await send(); }
    catch (error) {
        const status = error.response?.status;
        if (error.code === 'SESSION_CHANGED' || (status && status < 500) || error.response?.data?.code === 'SCAN_NOT_APPLIED') throw error;
        // Durable receipts make this retry safe only with the exact same UUID/body.
        return send();
    }
}
export const sendCartonCommand = (api, orderId, command) => sendCartonMutation(api, `/api/orders/${orderId}/carton-scan`, command);

export function applyCartonResponse(snapshot, result) {
    if (result?.format !== 'snapshot-v1' || String(result.order?.id) !== String(snapshot.order?.id)
        || result.baseState !== snapshot.stateToken || !/^[0-9a-f]{64}$/.test(result.stateToken || '')
        || !Array.isArray(result.items) || !Array.isArray(result.instances)) {
        throw new Error('箱號掃描回應不完整，請重新核對');
    }
    return { order: result.order, items: result.items, instances: result.instances, stateToken: result.stateToken };
}
