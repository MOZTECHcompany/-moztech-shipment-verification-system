export function workOrderBarcode(order) {
    return order?.work_barcode || order?.workBarcode || order?.voucher_number || order?.voucherNumber || '';
}

export function readImportResult(data) {
    if (!data || typeof data !== 'object') return null;
    const validId = value => Number.isSafeInteger(value) && value > 0;
    if (validId(data.batchId) && data.batchNumber && Number.isSafeInteger(data.workOrderCount) && data.workOrderCount > 0
        && Array.isArray(data.orders) && data.orders.length === data.workOrderCount
        && new Set(data.orders.map(order => order.orderId)).size === data.orders.length
        && data.orders.every(order => validId(order.orderId) && order.voucherNumber && /^WT[0-9a-f]{18}$/i.test(order.workBarcode || ''))) {
        return { ...data, isBatch: true };
    }
    if (!data.batchId && validId(data.orderId) && data.voucherNumber) return { ...data, isBatch: false };
    return null;
}

export async function loadWorkOrdersForPrint(api, summaries) {
    if (!Array.isArray(summaries) || !summaries.length) throw new Error('沒有可列印的工作單。');
    const ids = summaries.map(order => order.orderId ?? order.id);
    if (ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) throw new Error('工作單清單不完整，請重新核對匯入結果。');
    const documents = [];
    // Bound requests and render only after the entire batch is verified.
    for (let offset = 0; offset < ids.length; offset += 5) {
        const page = await Promise.all(ids.slice(offset, offset + 5).map(async id => {
            const response = await api.get(`/api/orders/${id}/work-snapshot`, { timeout: 15000 });
            const data = response.data;
            if (Number(data?.order?.id) !== id || !Array.isArray(data.items) || !workOrderBarcode(data.order)) throw new Error('工作單資料不完整，尚未開啟列印。');
            return data;
        }));
        documents.push(...page);
    }
    return documents;
}
