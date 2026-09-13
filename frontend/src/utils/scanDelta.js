export function makeScanCommand(snapshot, input) {
    if (!snapshot.stateToken) return input; // Compatibility with an older backend snapshot.
    return { ...input, responseMode: 'delta-v1', commandId: crypto.randomUUID(), expectedState: snapshot.stateToken };
}
export function applyScanResponse(snapshot, response) {
    if (response?.format !== 'delta-v1') {
        if (!response?.order || !Array.isArray(response.items) || !Array.isArray(response.instances)) throw new Error('掃碼回應不完整，請重新核對');
        return response;
    }
    if (response.baseState !== snapshot.stateToken || String(response.order?.id) !== String(snapshot.order?.id) || !/^[0-9a-f]{64}$/.test(response.stateToken || '')) throw new Error('訂單已更新，請重新核對掃碼結果');
    if (response.item && !snapshot.items.some(i => i.id === response.item.id && i.order_id === response.item.order_id)) throw new Error('品項資料已異動，請重新核對');
    if (response.instance && !snapshot.instances.some(i => i.id === response.instance.id && i.order_item_id === response.instance.order_item_id)) throw new Error('序號資料已異動，請重新核對');
    return { ...snapshot, order: { ...snapshot.order, ...response.order }, stateToken: response.stateToken,
        items: response.item ? snapshot.items.map(i => i.id === response.item.id ? response.item : i) : snapshot.items,
        instances: response.instance ? snapshot.instances.map(i => i.id === response.instance.id ? response.instance : i) : snapshot.instances };
}

// Retry once only when the server supports durable command receipts. Both
// attempts use the identical UUID/body; legacy quantity scans are never retried.
export async function sendScanCommand(api, command) {
    const send = () => api.post('/api/orders/update_item', command, { timeout: 15000 });
    try { return await send(); }
    catch (error) {
        const status = error.response?.status;
        if (!command.commandId || error.response?.data?.code === 'SCAN_NOT_APPLIED' || (status && status < 500)) throw error;
        return send();
    }
}
