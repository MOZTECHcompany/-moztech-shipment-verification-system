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

export async function loadWorkOrdersForPrint(api, summaries, { signal, isCurrentSession = () => true, expectedBatchId } = {}) {
    if (!Array.isArray(summaries) || !summaries.length) throw new Error('沒有可列印的工作單。');
    const ids = summaries.map(order => order.orderId ?? order.id);
    if (ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) throw new Error('工作單清單不完整，請重新核對匯入結果。');
    const documents = [];
    const checkSession = () => {
        if (signal?.aborted || !isCurrentSession()) throw new Error('頁面或登入帳號已變更，尚未開啟列印。');
    };
    // Bound requests and render only after the entire batch is verified.
    for (let offset = 0; offset < ids.length; offset += 5) {
        checkSession();
        const page = await Promise.all(ids.slice(offset, offset + 5).map(async id => {
            checkSession();
            const response = await api.get(`/api/orders/${id}/work-snapshot`, { timeout: 15000, signal });
            checkSession();
            const data = response.data;
            if (Number(data?.order?.id) !== id || !Array.isArray(data.items) || !workOrderBarcode(data.order)) throw new Error('工作單資料不完整，尚未開啟列印。');
            if (expectedBatchId && (Number(data.order.import_batch_id) !== expectedBatchId || data.order.status === 'voided')) throw new Error('批次工作單已變更或作廢，請更新批次後再列印。');
            return data;
        }));
        documents.push(...page);
    }
    return documents;
}

// react-to-print invokes this after iframe resources load. Closing the dialog
// (including Cancel) is not evidence of a physical print or a shipment.
export async function printPreparedWorkOrders(frame, { canPrint, title, mobile = false }) {
    const ensureCurrent = () => {
        if (!canPrint()) {
            frame?.remove?.();
            throw new Error('頁面或登入帳號已變更，尚未開啟列印。');
        }
    };
    ensureCurrent();
    const target = frame?.contentWindow;
    if (typeof target?.print !== 'function') throw new Error('此瀏覽器無法開啟列印，請改用支援列印的瀏覽器。');
    const ownerTitle = frame.ownerDocument?.title;
    const frameTitle = frame.contentDocument?.title;
    try {
        if (title && frame.ownerDocument) frame.ownerDocument.title = title;
        if (title && frame.contentDocument) frame.contentDocument.title = title;
        ensureCurrent();
        target.print();
    } finally {
        if (frame.ownerDocument) frame.ownerDocument.title = ownerTitle;
        if (frame.contentDocument) frame.contentDocument.title = frameTitle;
    }
    // Match react-to-print's delay before removing the frame on mobile browsers.
    if (mobile) await new Promise(resolve => setTimeout(resolve, 500));
}
