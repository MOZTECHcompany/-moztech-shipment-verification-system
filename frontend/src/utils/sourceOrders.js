const clean = value => String(value ?? '').trim();

export function sourceOrderKey(item) {
    const number = clean(item?.source_order_number);
    return number ? JSON.stringify([clean(item.source_platform), clean(item.source_store), number]) : null;
}

export function sourceOrderLabel(item) {
    if (!sourceOrderKey(item)) return '';
    return [clean(item.source_platform) || '未提供平台', clean(item.source_store) || '未提供店鋪', clean(item.source_order_number)].join(' · ');
}

// Group only for display and printing. Each original item and its quantities stay intact.
export function groupSourceOrders(items = []) {
    const groups = new Map();
    for (const item of items) {
        const key = sourceOrderKey(item);
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, { key, number: clean(item.source_order_number), label: sourceOrderLabel(item), items: [] });
        groups.get(key).items.push(item);
    }
    return [...groups.values()];
}

export function findSourceOrders(groups, query) {
    const number = clean(query);
    return number ? groups.filter(group => group.number === number) : [];
}

export function filterSourceWorkItems(rows, { query = '', selectedKey = '' } = {}) {
    if (!clean(query) && !selectedKey) return rows;
    if (!selectedKey) return [];
    return rows.filter(row => sourceOrderKey(row.item) === selectedKey);
}

// Source selection adds a boundary to the existing scanner. The backend remains
// authoritative for permissions, SN normalization, quantities and command receipts.
export function resolveSourceScanTarget({ items = [], instances = [], selectedKey = '', unresolved = false, scanValue, type }) {
    if (unresolved) return { error: '請先選擇商城訂單的平台與店鋪，或清除商城訂單篩選。' };
    const raw = clean(scanValue);
    const barcodeItems = items.filter(item => clean(item.barcode) === raw);
    if (!selectedKey) {
        if (barcodeItems.length > 1 && barcodeItems.some(item => sourceOrderKey(item))) {
            return { error: '此商品條碼對應多筆商城訂單明細，請先定位商城訂單，或使用指定商品列的數量按鈕。' };
        }
        return {};
    }
    const normalized = raw.replace(/^SN\s*[:：]/i, '').trim().toUpperCase();
    let serialMatches = instances.filter(instance => clean(instance.serial_number).toUpperCase() === normalized);
    if (!serialMatches.length && (/^SN\s*[:：]/i.test(raw) || (/^\d+$/.test(raw) && !barcodeItems.length))) {
        const digits = (normalized.match(/\d+/g) || []).at(-1) || '';
        if (digits.length >= 8) serialMatches = instances.filter(instance => clean(instance.serial_number).replace(/\D/g, '') === digits);
    }
    if (serialMatches.length > 1) return { error: '此掃描值對應多筆 SN，請掃描完整序號。' };
    if (serialMatches.length === 1) {
        const item = items.find(row => String(row.id) === String(serialMatches[0].order_item_id));
        return item && sourceOrderKey(item) === selectedKey
            ? { orderItemId: item.id }
            : { error: '此 SN 不屬於目前選定的商城訂單。' };
    }
    const candidates = barcodeItems.filter(item => sourceOrderKey(item) === selectedKey
        && !instances.some(instance => String(instance.order_item_id) === String(item.id))
        && (type === 'pick' ? Number(item.picked_quantity || 0) < Number(item.quantity)
            : Number(item.packed_quantity || 0) < Number(item.picked_quantity || 0)));
    if (candidates.length === 1) return { orderItemId: candidates[0].id };
    if (candidates.length > 1) return { error: '此商城訂單有多列相同商品，請使用指定商品列的數量按鈕。' };
    return { error: '此條碼不屬於選定商城訂單的可作業商品，或需掃描完整 SN／已無剩餘數量。' };
}

export function orderChangeItemIdentity(row) {
    if (!row.isNew && row.orderItemId) return { orderItemId: row.orderItemId };
    return row.isNew ? {
        sourceOrderNumber: clean(row.sourceOrderNumber) || null,
        sourcePlatform: clean(row.sourcePlatform) || null,
        sourceStore: clean(row.sourceStore) || null,
        sourceLineId: clean(row.sourceLineId) || null,
    } : {};
}
