export function importBatchId(value) {
    const text = String(value ?? '');
    if (!/^[1-9]\d*$/.test(text)) return null;
    const id = Number(text);
    return Number.isSafeInteger(id) && id <= 2147483647 ? id : null;
}

export function batchSessionMatches(storage, user, token) {
    try {
        const current = JSON.parse(storage.getItem('wms_user'));
        return !!token && JSON.parse(storage.getItem('wms_token')) === token
            && Number(current?.id) === Number(user.id) && current?.role === user.role;
    } catch { return false; }
}

export function validateBatchPage(data, batchId) {
    const ids = data?.workOrderIds;
    const printable = data?.printableWorkOrderIds;
    if (Number(data?.batch?.id) !== batchId || !data.batch.batch_number
        || !Array.isArray(data.children) || !Array.isArray(data.productTotals)
        || !data.summary?.statusCounts || !data.summary?.voidedTotals || !data.pagination
        || !Array.isArray(ids) || !Array.isArray(printable)
        || ids.some(id => importBatchId(id) !== id) || new Set(ids).size !== ids.length
        || printable.some(id => !ids.includes(id)) || new Set(printable).size !== printable.length
        || data.children.some(order => !ids.includes(order.id) || Number(order.import_batch_id) !== batchId)
        || new Set(data.children.map(order => order.id)).size !== data.children.length
        || Number(data.summary.workOrderCount) !== ids.length
        || Number(data.summary.activeWorkOrderCount) !== printable.length
        || Number(data.pagination.totalWorkOrders) !== ids.length) {
        throw new Error('批次資料不完整，請重新載入。');
    }
    return data;
}

// A page is one server snapshot. Never combine earlier page totals with new rows.
export function createBatchReader({ api, batchId, onState, isCurrentSession = () => true }) {
    let disposed = false, sequence = 0, controller;
    let state = { phase: 'idle', data: null, cursor: null };
    const publish = next => { state = next; onState(next); };
    const sessionChanged = () => {
        controller?.abort(); sequence++;
        if (!disposed) publish({ phase: 'sessionChanged', data: null, cursor: null, message: '登入帳號已變更，請重新整理並確認登入人員。' });
    };
    return {
        getState: () => state,
        sessionChanged,
        async load(cursor = null) {
            if (disposed) return false;
            if (!isCurrentSession()) { sessionChanged(); return false; }
            controller?.abort();
            const request = ++sequence;
            const abort = controller = new AbortController();
            publish({ ...state, phase: 'loading', message: '' });
            try {
                const response = await api.get(`/api/order-import-batches/${batchId}`, {
                    params: { limit: 30, ...(cursor ? { cursor } : {}) }, signal: abort.signal, timeout: 15000,
                });
                if (disposed || sequence !== request) return false;
                if (!isCurrentSession()) { sessionChanged(); return false; }
                const data = validateBatchPage(response.data, batchId);
                publish({ phase: 'ready', data, cursor, loadedAt: new Date() });
                return true;
            } catch (error) {
                if (disposed || sequence !== request) return false;
                if (!isCurrentSession()) { sessionChanged(); return false; }
                publish({ ...state, phase: 'error', message: error.response?.status === 404 ? '找不到這個理貨批次。'
                    : error.response?.data?.message || error.message || '無法載入理貨批次，請重試。' });
                return false;
            }
        },
        dispose() { disposed = true; sequence++; controller?.abort(); },
    };
}
