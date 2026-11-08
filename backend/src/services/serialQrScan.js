const { fail, serials } = require('./cartonContents');
const { assertExpectedCartonScan, lockCartonSerials } = require('./cartonGuards');

function readSerialQrSelection(body, actorId) {
    if (body.selectedSerials === undefined) return null;
    if (body.expectedActorId !== actorId) throw fail('SESSION_CHANGED', '登入人員已變更，請重新載入訂單');
    if (body.responseMode !== 'delta-v1' || Number(body.amount ?? 1) !== 1 || body.orderItemId != null ||
        typeof body.scanValue !== 'string' || body.scanValue.length > 102000) {
        throw fail('SERIAL_QR_INVALID', 'SN QR Code 核對資料無效', 400);
    }
    const label = serials(body.scanValue.split(',').map(sn => sn.trim()));
    const selected = serials(body.selectedSerials);
    const labelSet = new Set(label);
    if (label.length < 2 || !selected.length || selected.some(sn => !labelSet.has(sn))) {
        throw fail('SERIAL_QR_INVALID', '請從這張貼紙選取本次實際核對的 SN', 400);
    }
    return selected;
}

async function applySerialQrSelection(db, snapshot, selected, type) {
    const before = type === 'pick' ? 'pending' : 'picked';
    const after = type === 'pick' ? 'picked' : 'packed';
    const items = new Map(snapshot.items.map(item => [item.id, item]));
    const selectedSet = new Set(selected);
    const matches = snapshot.instances.filter(instance => selectedSet.has(instance.serial_number));
    const assignedCounts = new Map();
    for (const instance of snapshot.instances) {
        assignedCounts.set(instance.order_item_id, (assignedCounts.get(instance.order_item_id) ?? 0) + 1);
    }
    if (matches.length !== selected.length || new Set(matches.map(instance => instance.serial_number)).size !== selected.length ||
        matches.some(instance => {
            const item = items.get(instance.order_item_id);
            return instance.status !== before || !item || item.carton_serial_binding || Number(item.quantity_sign ?? 1) !== 1 ||
                assignedCounts.get(item.id) !== Number(item.quantity);
        })) {
        throw fail('SERIAL_QR_NOT_ELIGIBLE', '所選 SN 未唯一對應本單，或不符合目前的揀貨／裝箱狀態');
    }
    for (const instance of matches) assertExpectedCartonScan(items.get(instance.order_item_id).expected_carton_id);
    await lockCartonSerials(db, selected);
    const registered = await db.query('SELECT 1 FROM wms_carton_serials WHERE serial_number=ANY($1::text[]) LIMIT 1', [selected]);
    if (registered.rows.length) throw fail('CARTON_ALLOCATION_GUARD', '所選 SN 已登記在箱內容，請使用箱號揀貨或裝箱');
    const changed = await db.query(`UPDATE order_item_instances SET status=$1, updated_at=CURRENT_TIMESTAMP
        WHERE id=ANY($2::int[]) AND status=$3`, [after, matches.map(instance => instance.id), before]);
    if (changed.rowCount !== selected.length) throw fail('SERIAL_QR_NOT_ELIGIBLE', '訂單序號狀態已更新，請重新掃描核對');
    return selected;
}

module.exports = { readSerialQrSelection, applySerialQrSelection };
