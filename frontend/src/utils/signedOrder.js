export function signedQuantity(item) {
    const quantity = Math.abs(Number(item?.quantity) || 0);
    return Number(item?.quantity_sign) === -1 ? -quantity : quantity;
}

export function signedOrderTotals(items = []) {
    let positive = 0, negative = 0;
    for (const item of items) {
        const quantity = signedQuantity(item);
        if (quantity < 0) negative += Math.abs(quantity);
        else positive += quantity;
    }
    return { positive, negative, work: positive + negative, net: positive - negative };
}

export function signedDocumentLabel(type) {
    return type === 'adjustment' ? '異動理貨單' : type === 'reversal' ? '沖正理貨單' : null;
}

export function isSignedDocument(order) {
    return ['adjustment', 'reversal'].includes(order?.document_type);
}

export function printedQuantity(item, order) {
    const quantity = signedQuantity(item);
    return isSignedDocument(order) && quantity > 0 ? `+${quantity}` : String(quantity);
}

export function signedScanChoices(snapshot, barcode, stage) {
    const matches = (snapshot?.items || []).filter(item => String(item.barcode) === barcode);
    if (new Set(matches.map(item => Number(item.quantity_sign) === -1 ? -1 : 1)).size < 2) return null;
    const withSerials = new Set((snapshot.instances || []).map(instance => String(instance.order_item_id)));
    return matches.filter(item => !withSerials.has(String(item.id))
        && (stage === 'pick' ? Number(item.picked_quantity || 0) < Number(item.quantity)
            : Number(item.packed_quantity || 0) < Number(item.picked_quantity || 0)));
}

export function signedOrderReportRows(snapshot) {
    const serialsByItem = new Map();
    for (const instance of snapshot.instances || []) {
        const serials = serialsByItem.get(instance.order_item_id) || [];
        serials.push(instance.serial_number);
        serialsByItem.set(instance.order_item_id, serials);
    }
    return (snapshot.items || []).map(item => ({
        '國際條碼': item.barcode, '品項型號': item.product_code, '品項名稱': item.product_name,
        '應出數量': signedQuantity(item),
        ...(isSignedDocument(snapshot.order) ? { '作業方向': signedQuantity(item) < 0 ? '沖正' : '新增', '核對件數': item.quantity } : {}),
        '已揀數量(計數)': item.picked_quantity, '已裝箱數量(計數)': item.packed_quantity,
        'SN列表': (serialsByItem.get(item.id) || []).join(', '),
    }));
}
