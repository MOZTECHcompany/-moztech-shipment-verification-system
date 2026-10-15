const { createHash } = require('node:crypto');
const compare = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
const ordered = values => [...values].sort(compare);
const validCount = value => Number.isSafeInteger(value) && value >= 0;
const canonical = value => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const sources = item => ({ sourcePlatform: item.source_platform ?? null, sourceStore: item.source_store ?? null,
    sourceOrderNumber: item.source_order_number ?? null, sourceLineId: item.source_line_id ?? null, sourceSKU: item.source_sku ?? null });

function buildEcountManifest({ order, items, instances, allocations, exceptions = [] }) {
    const blockers = [], codes = new Set(), rows = [], looseRows = [], totalsByCode = new Map(), boxedByItem = new Map(), usedSN = new Set(), allPackedSN = new Set();
    const block = (code, message) => { if (!codes.has(code)) { codes.add(code); blockers.push({ code, message }); } };
    if (order.status !== 'completed') block('ORDER_NOT_COMPLETED', order.status === 'voided' ? '訂單已作廢，不能確認銷貨對照' : '請先完成揀貨與裝箱核對');
    if (order.document_type && order.document_type !== 'shipment' || items.some(item => Number(item.quantity_sign ?? 1) !== 1)) block('SIGNED_ORDER', '含負數沖正或正負異動的單據，僅能保存參考單號');
    if (order.warehouse_hold) block('ORDER_HELD', '此訂單尚待來源或 ERP 核對');
    if (exceptions.some(row => row.status === 'open')) block('PENDING_EXCEPTION', '訂單仍有待處理異動或例外');
    if (allocations.some(row => row.status === 'picked')) block('UNPACKED_ALLOCATION', '仍有已揀貨但未裝箱的箱分配');
    const byId = new Map(items.map(item => [Number(item.id), item]));
    const unitsByItem = new Map(), packedSerialOwners = new Map();
    for (const unit of instances) {
        if (!unitsByItem.has(unit.order_item_id)) unitsByItem.set(unit.order_item_id, []);
        unitsByItem.get(unit.order_item_id).push(unit);
        if (unit.status === 'packed') {
            const key = JSON.stringify([unit.order_item_id, unit.serial_number]);
            packedSerialOwners.set(key, (packedSerialOwners.get(key) || 0) + 1);
        }
    }
    for (const allocation of [...allocations].sort((a, b) => compare(a.id, b.id))) {
        if (allocation.status !== 'packed') continue;
        if (!Array.isArray(allocation.lines)) { block('INVALID_ALLOCATION', '箱分配資料需先核對'); continue; }
        const seenLines = new Set();
        for (const line of [...allocation.lines].sort((a, b) => Number(a.lineId) - Number(b.lineId) || Number(a.orderItemId) - Number(b.orderItemId))) {
            const item = byId.get(Number(line.orderItemId)), sns = line.actualSN || [], lineKey = `${line.lineId}:${line.orderItemId}`;
            if (!item || line.itemCode !== item.product_code || !Number.isSafeInteger(line.quantity) || line.quantity < 1
                || line.quantitySign !== 1 || !Array.isArray(sns) || sns.length && sns.length !== line.quantity || seenLines.has(lineKey)) {
                block('INVALID_ALLOCATION', '箱分配品項、數量或 SN 與訂單不一致'); continue;
            }
            seenLines.add(lineKey);
            for (const sn of sns) {
                if (typeof sn !== 'string' || !sn || usedSN.has(sn)
                    || packedSerialOwners.get(JSON.stringify([item.id, sn])) !== 1) block('INVALID_SERIALS', '箱內實際 SN 未完整裝箱或重複');
                usedSN.add(sn);
            }
            const boxed = boxedByItem.get(item.id) || { quantity: 0, serials: [] };
            boxed.quantity += line.quantity; boxed.serials.push(...sns); boxedByItem.set(item.id, boxed);
            rows.push({ allocationId: allocation.id, cartonId: allocation.carton_id, contentRevision: allocation.content_revision,
                cartonLineId: line.lineId, orderItemId: item.id, itemCode: line.itemCode, productName: item.product_name || null,
                quantity: line.quantity, actualSN: ordered(sns), ean: line.ean ?? null, internalScanCode: line.internalScanCode ?? null,
                ...Object.fromEntries(['sourcePlatform','sourceStore','sourceOrderNumber','sourceLineId','sourceSKU'].map(key => [key, line[key] ?? null])),
                packedAt: allocation.packed_at });
        }
    }
    for (const item of [...items].sort((a, b) => a.id - b.id)) {
        const units = unitsByItem.get(item.id) || [], actualSN = units.filter(unit => unit.status === 'packed').map(unit => unit.serial_number);
        for (const sn of actualSN) { if (allPackedSN.has(sn)) block('INVALID_SERIALS', '實際 SN 不可重複'); allPackedSN.add(sn); }
        const packed = units.length ? actualSN.length : item.packed_quantity, boxed = boxedByItem.get(item.id) || { quantity: 0, serials: [] };
        // SN instances are authoritative in the existing WMS contract. Their
        // legacy quantity counters are deliberately not backfilled or redefined.
        if (!validCount(item.quantity) || !validCount(packed) || packed !== item.quantity || units.length && units.length !== item.quantity
            || !units.length && (!validCount(item.picked_quantity) || item.picked_quantity !== item.quantity)) block('INCOMPLETE_QUANTITY', '商品實際揀貨與裝箱數量尚未完整核對');
        if (boxed.quantity > packed || units.length && boxed.serials.length !== boxed.quantity || !units.length && boxed.serials.length) block('BOX_QUANTITY_MISMATCH', '箱分配與商品裝箱數量不一致');
        if (!item.product_code || actualSN.some(sn => typeof sn !== 'string' || !sn) || new Set(actualSN).size !== actualSN.length) block('INVALID_ITEM', '商品品號或實際 SN 資料需核對');
        const total = totalsByCode.get(item.product_code) || { itemCode: item.product_code, quantity: 0, requiredQuantity: 0, boxedQuantity: 0, looseQuantity: 0, actualSN: [] };
        total.quantity += validCount(packed) ? packed : 0; total.requiredQuantity += validCount(item.quantity) ? item.quantity : 0;
        total.boxedQuantity += boxed.quantity; total.looseQuantity += Math.max(0, (validCount(packed) ? packed : 0) - boxed.quantity); total.actualSN.push(...actualSN);
        totalsByCode.set(item.product_code, total);
        const looseQuantity = Math.max(0, (validCount(packed) ? packed : 0) - boxed.quantity);
        if (looseQuantity) looseRows.push({ orderItemId: item.id, itemCode: item.product_code, productName: item.product_name || null,
            quantity: looseQuantity, actualSN: ordered(actualSN.filter(sn => !usedSN.has(sn))), ...sources(item) });
    }
    const totals = [...totalsByCode.values()].filter(total => total.quantity || total.requiredQuantity).sort((a, b) => compare(a.itemCode, b.itemCode));
    for (const total of totals) { total.actualSN = ordered(total.actualSN); if (new Set(total.actualSN).size !== total.actualSN.length) block('INVALID_SERIALS', '實際 SN 不可重複'); }
    if (!totals.length) block('EMPTY_SHIPMENT', '此單沒有可核對的出貨商品');
    const summary = new Map();
    for (const row of rows) summary.set(row.cartonId, (summary.get(row.cartonId) || 0) + row.quantity);
    const fingerprint = digest(['ecount-carton-manifest-v1',
        { id: order.id, voucher: order.voucher_number, customer: order.customer_name ?? null, status: order.status, documentType: order.document_type || 'shipment',
            warehouse: order.warehouse ?? null, held: !!order.warehouse_hold, source: sources(order) },
        [...items].sort((a, b) => a.id - b.id).map(item => ({ id: item.id, itemCode: item.product_code, productName: item.product_name,
            quantity: item.quantity, quantitySign: item.quantity_sign ?? 1, picked: item.picked_quantity, packed: item.packed_quantity,
            barcode: item.barcode, serialIdentityMode: item.serial_identity_mode, cartonSerialBinding: item.carton_serial_binding, ...sources(item) })),
        [...instances].sort((a, b) => a.id - b.id).map(unit => [unit.id, unit.order_item_id, unit.serial_number, unit.status]),
        [...allocations].sort((a, b) => compare(a.id, b.id)).map(allocation => ({ id: allocation.id, cartonId: allocation.carton_id,
            contentRevision: allocation.content_revision, status: allocation.status, pickedAt: allocation.picked_at, packedAt: allocation.packed_at,
            releasedAt: allocation.released_at, lines: [...(allocation.lines || [])].sort((a, b) => Number(a.lineId) - Number(b.lineId) || Number(a.orderItemId) - Number(b.orderItemId)) })),
        [...exceptions].sort((a, b) => a.id - b.id).map(row => [row.id, row.type, row.status, row.updated_at])]);
    return { orderId: order.id, wmsVoucherNumber: order.voucher_number, shipmentReference: 'WMS-' + order.id, fingerprint,
        ready: !blockers.length, blockers, rows, looseRows, totals,
        cartonSummary: [...summary].sort(([a], [b]) => compare(a, b)).map(([cartonId, quantity]) => ({ cartonId, quantity })) };
}
module.exports = { buildEcountManifest, digest, compare, ordered };
