const { activeAllocations } = require('./cartonGuards');

const PICKING_FREIGHT_CODE = '00001';

function isPickingFreight(code, name) {
    return code === PICKING_FREIGHT_CODE && String(name ?? '').trim() === '運費';
}

// Older ECOUNT print imports stored the item code as the scan key.
// Preserve the stored line and exclude it only from the warehouse work view.
async function projectPickingItems(db, orderId, items, instances) {
    const serialItemIds = new Set(instances.map(instance => Number(instance.order_item_id)));
    const candidates = items.filter(item =>
        isPickingFreight(item.product_code, item.product_name) &&
        item.barcode === PICKING_FREIGHT_CODE &&
        item.code_type === 'legacy' && item.serial_identity_mode !== 'exact' &&
        Number.isSafeInteger(item.quantity) && item.quantity > 0 &&
        Number(item.quantity_sign ?? 1) === 1 &&
        !item.international_barcode && !item.internal_scan_code &&
        !item.expected_carton_id && !item.carton_serial_binding &&
        !item.source_order_number && !item.source_line_id &&
        !item.source_platform && !item.source_store && !item.source_sku &&
        !serialItemIds.has(Number(item.id))
    );
    if (!candidates.length) return { items, exemptItemIds: [] };

    // The current importer already classified the original worksheet. A row
    // it retained may have had explicit scan evidence absent from old rows.
    const importLog = (await db.query(`
        SELECT details FROM operation_logs
        WHERE order_id = $1 AND action_type = 'import'
        ORDER BY created_at DESC, id DESC LIMIT 1`, [orderId])).rows[0];
    // Import logs can expire. Absence is not proof of a legacy import.
    let details;
    try { details = JSON.parse(importLog?.details ?? 'null'); }
    catch { return { items, exemptItemIds: [] }; }
    if (!details || typeof details.voucherNumber !== 'string' || details.batchId || details.pickingFreightReviewed) {
        return { items, exemptItemIds: [] };
    }

    const allocations = await activeAllocations(db, orderId);
    const allocatedItemIds = new Set(allocations.flatMap(allocation => allocation.lines.map(line => Number(line.orderItemId))));
    const exemptIds = new Set(candidates.map(item => Number(item.id)).filter(id => !allocatedItemIds.has(id)));
    return {
        items: items.filter(item => !exemptIds.has(Number(item.id))),
        exemptItemIds: [...exemptIds]
    };
}

module.exports = { PICKING_FREIGHT_CODE, isPickingFreight, projectPickingItems };
