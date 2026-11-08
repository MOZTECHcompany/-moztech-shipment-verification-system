export const isCartonScan = value => /^(?:CARTON:|CTN-)/i.test(String(value).trim()) || String(value).includes(',');
export const cartonSessionKey = (api, user) => JSON.stringify([user?.id, user?.role, user?.management_scope, api.getSessionIdentity?.() ?? api.defaults?.headers?.common?.Authorization ?? '']);

export function parseSerialInput(value) {
    return String(value || '').split(/[\r\n,]+/).map(v => v.trim()).filter(Boolean);
}

export function getStickerSerialReview(value, type, snapshot) {
    if (!value.includes(',') || /^(?:CARTON:|CTN-)/i.test(value.trim()) || !['pick', 'pack'].includes(type)) return null;
    const serials = value.split(',').map(serial => serial.trim());
    if (serials.some(serial => !serial) || new Set(serials).size !== serials.length) return null;
    const items = new Map(snapshot.items.map(item => [item.id, item]));
    const instances = new Map(), assignedCounts = new Map();
    for (const unit of snapshot.instances) {
        instances.set(unit.serial_number, instances.has(unit.serial_number) ? null : unit);
        assignedCounts.set(unit.order_item_id, (assignedCounts.get(unit.order_item_id) ?? 0) + 1);
    }
    const requiredStatus = type === 'pick' ? 'pending' : 'picked';
    const candidates = [];
    for (const serial of serials) {
        const unit = instances.get(serial);
        const item = items.get(unit?.order_item_id);
        if (unit?.status === requiredStatus && item && Number(item.quantity_sign ?? 1) === 1
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
