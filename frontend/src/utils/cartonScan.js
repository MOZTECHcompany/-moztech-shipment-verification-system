export const isCartonScan = value => /^(?:CARTON:|CTN-)/i.test(String(value).trim()) || String(value).includes(',');
export const cartonSessionKey = (api, user) => JSON.stringify([user?.id, user?.role, user?.management_scope, api.getSessionIdentity?.() ?? api.defaults?.headers?.common?.Authorization ?? '']);

export function parseSerialInput(value) {
    return String(value || '').split(/[\r\n,]+/).map(v => v.trim()).filter(Boolean);
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
