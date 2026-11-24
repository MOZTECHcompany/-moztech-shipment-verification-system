const { randomUUID } = require('node:crypto');
const { appendSelection, fail, matchesItem } = require('./cartonContents');
const { lockCartonSerials, assertLegacySerialValues } = require('./cartonGuards');
const { normalizeSerialScanInput } = require('../utils/serialNumber');

const changed = () => fail('DEFECT_CUSTODY_CHANGED', '原 SN 的箱號分配或揀貨狀態已變更，請重新整理並核對實物。');

async function serialLocations(db, serials) {
    const { rows } = await db.query(`SELECT s.serial_number,s.available,l.id AS line_id,l.carton_id,l.item_code,
        l.international_barcode AS ean,l.internal_scan_code,l.actual_sns,l.remaining_quantity,c.status,c.content_revision,
        c.source_system,c.source_reference FROM wms_carton_serials s JOIN wms_carton_lines l ON l.id=s.line_id
        JOIN wms_cartons c ON c.carton_id=l.carton_id WHERE s.serial_number=ANY($1::text[])`, [serials]);
    return new Map(rows.map(row => [row.serial_number, row]));
}

// Follow normal picking's lock order: order, carton headers, then exact serials.
// Re-read ownership after locking so registration/editing racing with a swap cannot change its source.
async function lockLocations(db, keys) {
    const initial = await serialLocations(db, keys);
    const boxes = [...new Set(Array.from(initial.values(), row => row.carton_id))];
    if (boxes.length) await db.query('SELECT carton_id FROM wms_cartons WHERE carton_id=ANY($1::text[]) ORDER BY carton_id COLLATE "C" FOR UPDATE', [boxes]);
    await lockCartonSerials(db, keys);
    const locked = await serialLocations(db, keys);
    if (keys.some(key => locked.get(key)?.line_id !== initial.get(key)?.line_id)) throw changed();
    return locked;
}

async function takeUnit(db, location) {
    const serial = await db.query('UPDATE wms_carton_serials SET available=FALSE WHERE serial_number=$1 AND line_id=$2 AND available RETURNING serial_number',
        [location.serial_number, location.line_id]);
    const line = await db.query('UPDATE wms_carton_lines SET remaining_quantity=remaining_quantity-1 WHERE id=$1 AND remaining_quantity>0 RETURNING id', [location.line_id]);
    if (serial.rows.length !== 1 || line.rows.length !== 1) throw changed();
}

function withoutUnit(lines, selected, sn) {
    const rest = [];
    for (const line of lines) {
        if (line !== selected) rest.push({ ...line, wholeCarton: false });
        else if (line.quantity > 1) rest.push({ ...line, quantity: line.quantity - 1, wholeCarton: false,
            actualSN: line.actualSN.filter(value => value !== sn), newSN: (line.newSN || []).filter(value => value !== sn) });
    }
    return rest;
}

// The removed defective unit never goes back into sellable carton stock.
// Preserve the physical packer's earlier verification if only packed units remain.
async function removeFromAllocation(db, allocation, rest, userId, reason) {
    if (!rest.length) {
        await db.query("UPDATE wms_carton_allocations SET status='released',released_by=$2,released_at=NOW(),release_reason=$3 WHERE id=$1",
            [allocation.id, userId, '新品不良換貨：' + reason]);
        return;
    }
    const serials = rest.flatMap(line => line.actualSN);
    const packedUnits = (await db.query(`SELECT i.order_item_id,i.serial_number FROM order_item_instances i JOIN order_items oi ON oi.id=i.order_item_id
        WHERE oi.order_id=$1 AND i.serial_number=ANY($2::text[]) AND i.status='packed'`, [allocation.order_id, serials])).rows;
    const packed = new Set(packedUnits.map(unit => JSON.stringify([unit.order_item_id, unit.serial_number])));
    const complete = rest.every(line => line.actualSN.length
        ? line.actualSN.every(sn => packed.has(JSON.stringify([line.orderItemId, sn]))) : line.packedQuantity === line.quantity);
    let verifier = null;
    if (complete) {
        verifier = (await db.query(`SELECT actor_id,created_at FROM wms_carton_history WHERE carton_id=$1
            AND event_type IN ('pack_verified','packed') AND details->>'allocationId'=$2 ORDER BY id DESC LIMIT 1`, [allocation.carton_id, allocation.id])).rows[0];
        if (!verifier) throw changed();
    }
    await db.query('UPDATE wms_carton_allocations SET lines=$2,status=$3,packed_at=$4,packed_by=$5 WHERE id=$1',
        [allocation.id, JSON.stringify(rest), complete ? 'packed' : 'picked', verifier?.created_at || null, verifier?.actor_id || null]);
}

async function replacePicked(db, { original, replacement, allocation, selected, target, item, userId, reason }) {
    const oldSn = original.serial_number, newSn = replacement.serial_number;
    const rest = withoutUnit(allocation.lines, selected, oldSn);
    const sameBox = allocation.carton_id === replacement.carton_id;
    const dest = sameBox ? allocation : target;
    let previous = sameBox ? rest : (dest?.lines || []);
    if (dest?.status === 'packed') {
        // The box can contain another unallocated unit. Keep previously packed loose quantities verified.
        previous = previous.map(line => line.actualSN.length ? line : { ...line, packedQuantity: line.quantity });
    }
    const next = { ...selected, lineId: replacement.line_id, itemCode: replacement.item_code, ean: replacement.ean,
        internalScanCode: replacement.internal_scan_code, sourceSystem: replacement.source_system,
        sourceReference: replacement.source_reference, quantity: 1, actualSN: [newSn],
        newSN: selected.newSN?.includes(oldSn) ? [newSn] : [], wholeCarton: false };
    const lines = appendSelection(previous.map(line => ({ ...line, wholeCarton: false })), [next]);
    const id = dest?.id || randomUUID();
    if (!sameBox) await removeFromAllocation(db, allocation, rest, userId, reason);
    if (dest) {
        if (dest.content_revision !== replacement.content_revision) throw changed();
        await db.query("UPDATE wms_carton_allocations SET lines=$2,status='picked',packed_at=NULL,packed_by=NULL WHERE id=$1", [id, JSON.stringify(lines)]);
    } else {
        await db.query(`INSERT INTO wms_carton_allocations(id,carton_id,order_id,content_revision,status,lines,picked_by)
            VALUES($1,$2,$3,$4,'picked',$5,$6)`, [id, replacement.carton_id, item.order_id, replacement.content_revision, JSON.stringify(lines), userId]);
    }
    await takeUnit(db, replacement);
    return id;
}

async function exchangeCartonDefect(db, { order, item, user, oldSn, newInput, reason, assertLiveLabels, historyMeta }) {
    const raw = newInput.trim(), plain = raw.replace(/^SN\s*[:：]/i, '').trim();
    const normalized = normalizeSerialScanInput(newInput).normalized;
    const keys = [...new Set([oldSn, raw, plain, normalized])];
    const locations = await lockLocations(db, keys);
    const original = locations.get(oldSn);
    const replacement = locations.get(raw) || locations.get(plain);
    const registered = !!locations.size;
    const newSn = replacement?.serial_number || normalized;
    if (!newSn || newSn === oldSn) throw fail('DEFECT_SAME_SN', '新 SN 不可空白或與原 SN 相同', 400);
    const locationIds = [...new Set(Array.from(locations.values(), row => row.carton_id))];
    const allocations = (await db.query(`SELECT * FROM wms_carton_allocations WHERE order_id=$1 AND status IN ('picked','packed')
        AND (carton_id=ANY($2::text[]) OR lines @> $3::jsonb)`,
        [item.order_id, locationIds, JSON.stringify([{ actualSN:[oldSn] }])])).rows;
    const owners = allocations.flatMap(allocation => allocation.lines.filter(line => line.actualSN.includes(oldSn)).map(selected => ({ allocation, selected })));
    if (!registered) {
        if (owners.length) throw changed();
        if (item.serial_identity_mode === 'exact') assertLegacySerialValues([oldSn, plain]);
        return { newSn, custody: null };
    }
    if (!original) throw fail('DEFECT_CARTON_SOURCE_REQUIRED', '原 SN 沒有對應的來源箱，請先核對原品與更換品的箱號。');
    if (!replacement) throw fail('DEFECT_CARTON_SOURCE_REQUIRED', '請掃描與原品相同品號、已確認來源箱內的完整新 SN，並核對大小寫。');
    if (order.status === 'completed' || item.unit_status === 'packed') throw fail('DEFECT_ALREADY_PACKED', '原 SN 已裝箱或訂單已完成，請依退換貨流程處理。');
    if (order.warehouse_hold || Number(item.quantity_sign ?? 1) !== 1 || order.document_type === 'reversal') {
        throw fail('DEFECT_ORDER_HELD', '暫停作業或退貨的單據請先核對，無法辦理出貨換 SN。');
    }
    if (original.status !== 'sealed' || replacement.status !== 'sealed') throw fail('DEFECT_CARTON_NOT_SEALED', '原品與更換品都需要已確認、可作業的來源箱。');
    if (!replacement.available || replacement.remaining_quantity < 1) throw fail('DEFECT_NEW_SN_UNAVAILABLE', '更換品 SN 已取出或已登記不良，請選可用的新 SN。');
    const ids = [...new Set([original.carton_id, replacement.carton_id])].sort();
    if (assertLiveLabels) await assertLiveLabels(db, ids, [oldSn, newSn], item.unit_status === 'picked'
        ? { serials:[oldSn, newSn], cartons:ids } : { serials:[oldSn], cartons:[original.carton_id] });
    if (item.expected_carton_id && replacement.carton_id !== item.expected_carton_id) {
        throw fail('CARTON_EXPECTED_MISMATCH', `此理貨列指定來源箱 ${item.expected_carton_id}，請先核對指定箱號。`);
    }
    if (original.item_code !== replacement.item_code || (original.ean && replacement.ean && original.ean !== replacement.ean)
        || (original.internal_scan_code && replacement.internal_scan_code && original.internal_scan_code !== replacement.internal_scan_code)) {
        throw fail('DEFECT_PRODUCT_MISMATCH', '更換品與原品的品號或條碼不同，請核對實物。');
    }
    if (!original.actual_sns.includes(oldSn) || !replacement.actual_sns.includes(newSn)) throw changed();
    const ownersOfSerials = (await db.query('SELECT id,serial_number FROM order_item_instances WHERE serial_number=ANY($1::text[])', [[oldSn, newSn]])).rows;
    if (ownersOfSerials.some(unit => unit.serial_number === oldSn && unit.id !== item.instance_id)) throw changed();
    if (ownersOfSerials.some(unit => unit.serial_number === newSn)) throw fail('DEFECT_NEW_SN_OCCUPIED', '更換品 SN 已列在其他訂單或品項，請重新核對。');
    const bad = await db.query('SELECT 1 FROM product_defects WHERE original_sn=$1 LIMIT 1', [newSn]);
    if (bad.rows.length) throw fail('DEFECT_NEW_SN_UNAVAILABLE', '更換品 SN 已登記不良，請選可用的新 SN。');

    const from = owners[0];
    let replacementAllocationId = null;
    if (item.unit_status === 'picked') {
        if (owners.length !== 1 || from.allocation.status !== 'picked' || original.available
            || from.allocation.carton_id !== original.carton_id || from.allocation.content_revision !== original.content_revision
            || from.selected.lineId !== original.line_id || from.selected.orderItemId !== item.order_item_id
            || from.selected.quantity !== from.selected.actualSN.length || from.selected.actualSN.filter(sn => sn === oldSn).length !== 1) throw changed();
        replacementAllocationId = await replacePicked(db, { original, replacement, ...from,
            target: allocations.find(entry => entry.carton_id === replacement.carton_id), item, userId: user.id, reason });
    } else if (item.unit_status === 'pending') {
        if (owners.length || !original.available || original.remaining_quantity < 1) throw changed();
        const line = { itemCode: original.item_code, ean: original.ean, internalScanCode: original.internal_scan_code };
        if (!matchesItem(line, item) && !(original.ean && [item.barcode, item.international_barcode].includes(original.ean))) throw changed();
        await takeUnit(db, original);
    } else throw changed();

    const custody = { originalCarton: original.carton_id, replacementCarton: replacement.carton_id,
        originalAllocationId: from?.allocation.id || null, replacementAllocationId, unitStatus: item.unit_status };
    await db.query('UPDATE wms_cartons SET state_revision=state_revision+1,updated_by=$2,updated_at=NOW() WHERE carton_id=ANY($1::text[])', [ids, user.id]);
    await db.query(`INSERT INTO wms_carton_history(carton_id,event_type,content_revision,state_revision,actor_id,details)
        SELECT carton_id,'defect_exchange',content_revision,state_revision,$2,$3::jsonb FROM wms_cartons WHERE carton_id=ANY($1::text[])`,
        [ids, user.id, JSON.stringify({ orderId: item.order_id, orderItemId:item.order_item_id, oldSn, newSn, reason, ...custody, ...historyMeta })]);
    return { newSn, custody };
}

module.exports = { exchangeCartonDefect };
