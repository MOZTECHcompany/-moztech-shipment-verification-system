export function workStage(role, status) {
    if (role === 'picker') return 'pick';
    if (role === 'packer') return 'pack';
    return status === 'pending' || status === 'picking' ? 'pick' : 'pack';
}

// Index serials once per response instead of re-scanning all serials for every card.
export function buildWorkItems(items = [], instances = [], stage = 'pack') {
    const byItem = new Map();
    for (const instance of instances) {
        const key = String(instance.order_item_id);
        if (!byItem.has(key)) byItem.set(key, []);
        byItem.get(key).push(instance);
    }
    return items.map(item => {
        const serials = byItem.get(String(item.id)) || [];
        const quantity = Number(item.quantity) || 0;
        const picked = serials.length ? serials.filter(s => s.status === 'picked' || s.status === 'packed').length : Number(item.picked_quantity) || 0;
        const packed = serials.length ? serials.filter(s => s.status === 'packed').length : Number(item.packed_quantity) || 0;
        const count = stage === 'pick' ? picked : packed;
        const serialMismatch = serials.length > 0 && serials.length !== quantity;
        const complete = quantity > 0 && !serialMismatch && count >= quantity && (stage === 'pick' || picked >= quantity);
        return { item, instances: serials, quantity, picked, packed, count, serialMismatch, complete,
            remaining: Math.max(0, quantity - count), ratio: quantity > 0 ? Math.min(count / quantity, 1) : 0 };
    });
}

export function filterWorkItems(rows, query = '', remainingOnly = false) {
    const text = query.trim().toLocaleLowerCase();
    return rows.filter(row => {
        if (remainingOnly && row.complete) return false;
        if (!text) return true;
        return [row.item.product_name, row.item.product_code, row.item.barcode, ...row.instances.map(s => s.serial_number)]
            .some(value => String(value ?? '').toLocaleLowerCase().includes(text));
    }).sort((a, b) => a.ratio - b.ratio);
}
