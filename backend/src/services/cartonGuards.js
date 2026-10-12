const blocked = () => Object.assign(new Error('此內容已有箱號分配，請先解除未裝箱分配；已裝箱需另外處理退貨／箱號，不可直接改單品數量或 SN'),
    { status: 409, code: 'CARTON_ALLOCATION_GUARD' });
async function activeAllocations(db, orderId) {
    return (await db.query("SELECT status,lines FROM wms_carton_allocations WHERE order_id=$1 AND status IN ('picked','packed')", [orderId])).rows;
}
async function lockCartonSerials(db, sns) {
    if (!sns.length) return;
    await db.query(`WITH ordered AS MATERIALIZED(SELECT DISTINCT unnest($1::text[]) AS sn ORDER BY sn)
        SELECT pg_advisory_xact_lock(hashtext('wms-carton-sn'),hashtext(sn)) FROM ordered`, [sns]);
}
async function guardSerialImport(db, orderId, sns) {
    if (!sns.length) return;
    await lockCartonSerials(db, sns);
    const occupied = await db.query(`SELECT 1 FROM wms_carton_serials s JOIN order_item_instances i ON i.serial_number=s.serial_number
        JOIN order_items oi ON oi.id=i.order_item_id WHERE s.serial_number=ANY($1::text[]) AND oi.order_id<>$2 LIMIT 1`, [sns, orderId]);
    if (occupied.rows.length) throw blocked();
}
// Call only after locking the order. Carton scans/releases take this same lock.
async function assertNoCartonAllocations(db, orderId) {
    if ((await activeAllocations(db, orderId)).length) throw blocked();
}
async function assertNoRegisteredSerials(db, sns) {
    if (!sns.length) return;
    await lockCartonSerials(db, sns);
    if ((await db.query('SELECT 1 FROM wms_carton_serials WHERE serial_number=ANY($1::text[]) LIMIT 1', [sns])).rows.length) {
        throw Object.assign(new Error('此 SN 已登記在箱內容；不能用舊編輯直接改動序號或歸屬，請透過箱號與實物核對流程處理'), { status: 409, code: 'CARTON_SERIAL_EDIT_GUARD' });
    }
}
function assertLegacySerialValues(sns) {
    // Existing self-built uppercase 12/13 codes remain supported. Do not feed
    // manufacturer case-sensitive/punctuated SNs through legacy normalizers.
    if (sns.some(sn => !/^[A-Z0-9]+$/.test(sn))) throw Object.assign(new Error('此實際 SN 不適用舊序號編輯；請保留原大小寫並透過實際 SN／箱號流程處理'),
        { status: 409, code: 'EXACT_SN_LEGACY_EDIT_UNSUPPORTED' });
}
async function assertLegacyOrderSerialEditing(db, orderId, proposal) {
    const changes = proposal?.items ?? [];
    const affectedBarcodes = new Set(changes.map(item => String(item?.barcode ?? '').trim().slice(0, 200)));
    const units = (await db.query('SELECT i.serial_number,oi.barcode,oi.serial_identity_mode FROM order_item_instances i JOIN order_items oi ON oi.id=i.order_item_id WHERE oi.order_id=$1', [orderId])).rows
        .filter(unit => affectedBarcodes.has(unit.barcode));
    await assertNoRegisteredSerials(db, units.map(unit => unit.serial_number));
    const exact = units.filter(unit => unit.serial_identity_mode === 'exact');
    if (exact.length) {
        assertLegacySerialValues(exact.map(unit => unit.serial_number));
        const exactBarcodes = new Set(exact.map(unit => unit.barcode));
        const proposed = changes.filter(item => exactBarcodes.has(String(item?.barcode ?? '').trim().slice(0, 200)))
            .flatMap(item => [item.snList,item.removedSnList].flatMap(value => Array.isArray(value) ? value : []))
            .map(value => String(value ?? '').trim().replace(/^SN\s*[:：]/i, '').trim()).filter(Boolean);
        assertLegacySerialValues(proposed);
    }
}
async function guardUnitScan(db, orderId, { orderItemId, instanceId, serialNumber, quantitySign, type, amount }) {
    let unit;
    if (instanceId) {
        const sign = quantitySign ?? (await db.query("SELECT COALESCE((to_jsonb(oi)->>'quantity_sign')::int,1) AS quantity_sign FROM order_item_instances i JOIN order_items oi ON oi.id=i.order_item_id WHERE i.id=$1", [instanceId])).rows[0]?.quantity_sign;
        // An independent negative document verifies the reversal; it does not
        // remove or restore carton contents. Keep that established unit flow.
        if (Number(sign) === -1) return;
        unit = serialNumber ? { serial_number: serialNumber } : (await db.query('SELECT order_item_id,serial_number FROM order_item_instances WHERE id=$1', [instanceId])).rows[0];
        if (unit) {
            await lockCartonSerials(db, [unit.serial_number]);
            const sealed = await db.query(`SELECT c.carton_id FROM wms_carton_serials s JOIN wms_carton_lines l ON l.id=s.line_id
                JOIN wms_cartons c ON c.carton_id=l.carton_id WHERE s.serial_number=$1 AND c.status='sealed'`, [unit.serial_number]);
            if (sealed.rows.length) throw Object.assign(new Error('此 SN 已登記在封箱內容，請掃描箱號或拆箱選擇此 SN'), { status: 409, code: 'CARTON_ALLOCATION_GUARD' });
        }
    }
    const allocations = await activeAllocations(db, orderId);
    if (!allocations.length) return;
    const context = { hasAllocations: true };
    if (instanceId) {
        unit = (await db.query('SELECT order_item_id,serial_number FROM order_item_instances WHERE id=$1', [instanceId])).rows[0];
        if (unit && allocations.some(allocation => allocation.lines.some(line => line.orderItemId === unit.order_item_id && line.actualSN.includes(unit.serial_number)))) throw blocked();
        return context;
    }
    const lines = allocations.flatMap(allocation => allocation.lines.map(line => ({ ...line, allocationStatus: allocation.status })))
        .filter(line => line.orderItemId === orderItemId && !line.actualSN.length);
    if (!lines.length) return context;
    const item = (await db.query('SELECT picked_quantity,packed_quantity FROM order_items WHERE id=$1', [orderItemId])).rows[0];
    if (!item) throw blocked();
    const boxedPicked = lines.reduce((n, line) => n + line.quantity, 0);
    const boxedPacked = lines.filter(line => line.allocationStatus === 'packed').reduce((n, line) => n + line.quantity, 0);
    // Undo only loose units. A picked carton reserves its units until carton
    // pack/release, while a packed carton must retain both picked and packed.
    if (amount < 0) {
        const floor = type === 'pick' ? boxedPicked + Math.max(0, Number(item.packed_quantity) - boxedPacked) : boxedPacked;
        const current = Number(type === 'pick' ? item.picked_quantity : item.packed_quantity);
        if (current + amount < floor) throw blocked();
    }
    if (type === 'pack') {
        const reserved = boxedPicked - boxedPacked;
        if (amount > 0 && amount > Number(item.picked_quantity) - Number(item.packed_quantity) - reserved) throw blocked();
    }
    return context;
}
module.exports = { assertNoCartonAllocations, guardUnitScan, lockCartonSerials, guardSerialImport,
    assertNoRegisteredSerials, assertLegacySerialValues, assertLegacyOrderSerialEditing };
