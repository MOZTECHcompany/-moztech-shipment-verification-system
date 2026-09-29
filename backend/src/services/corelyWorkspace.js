'use strict';
const { createHash } = require('node:crypto');
const { commandSnapshot, hash, validId } = require('./corelyNativeIntake');
const { stateToken, readLines } = require('./scanSnapshot');

const fail = (status, code) => Object.assign(new Error(code), { status, code });
const numericId = value => /^[1-9]\d{0,9}$/.test(String(value)) && Number(value) <= 2147483647;
const stationRoles = {
    pick: ['picker', 'admin', 'superadmin'], pack: ['packer', 'admin', 'superadmin'],
    dispatch: ['dispatcher', 'admin', 'superadmin'], shipping: ['dispatcher', 'admin', 'superadmin'],
    overview: ['picker', 'packer', 'dispatcher', 'admin', 'superadmin']
};
const idempotencyKey = (scope, requestId) => {
    const hex = createHash('sha256').update(JSON.stringify([scope.entityId, scope.actorId, requestId])).digest('hex').slice(0, 32).split('');
    hex[12] = '4'; hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
    return `${hex.slice(0,8).join('')}-${hex.slice(8,12).join('')}-${hex.slice(12,16).join('')}-${hex.slice(16,20).join('')}-${hex.slice(20).join('')}`;
};

async function actor(db, scope) {
    if (!validId(scope.entityId) || !validId(scope.actorId) || !Object.hasOwn(stationRoles, scope.station)) throw fail(403, 'WMS_SCOPE_DENIED');
    const row = (await db.query(`SELECT u.id,u.name,u.role FROM erp_staff_identities e JOIN users u ON u.id=e.wms_user_id
        WHERE e.erp_user_id=$1 AND e.entity_id=$2`, [scope.actorId, scope.entityId])).rows[0];
    if (!row || !stationRoles[scope.station].includes(row.role)) throw fail(403, 'WMS_SCOPE_DENIED');
    return row;
}
async function intake(db, scope, id) {
    if (!validId(id)) throw fail(400, 'WMS_ORDER_ID_INVALID');
    const row = (await db.query(`SELECT i.* FROM corely_native_intakes i WHERE i.entity_id=$1 AND i.erp_order_id=$2`,
        [scope.entityId, id])).rows[0];
    if (!row) throw fail(404, 'WMS_ORDER_NOT_ACCESSIBLE');
    if (scope.station === 'dispatch') {
        const grant = (await db.query(`SELECT 1 FROM corely_dispatch_grants g WHERE g.entity_id=$1 AND g.erp_actor_id=$2
            AND g.brand=$3 AND g.revoked_at IS NULL`, [scope.entityId, scope.actorId, row.payload.brand])).rows[0];
        if (!grant) throw fail(403, 'WMS_SCOPE_DENIED');
    }
    return row;
}

async function snapshot(db, scope, source, user, writable = false) {
    const native = await commandSnapshot(db, source);
    const order = (await db.query(`SELECT o.*,p.name AS picker_name,pk.name AS packer_name FROM orders o
        LEFT JOIN users p ON p.id=o.picker_id LEFT JOIN users pk ON pk.id=o.packer_id WHERE o.id=$1`, [source.order_id])).rows[0];
    if (!order) throw fail(409, 'WMS_NATIVE_ORDER_MISSING');
    const open = (await db.query(`SELECT type FROM order_exceptions WHERE order_id=$1 AND status='open' LIMIT 20`, [order.id])).rows;
    const blockers = [...native.blockers];
    if (!source.prepick_completed_at && !blockers.includes('待預揀核對完成')) blockers.push('待預揀核對完成');
    if (open.some(row => row.type === 'order_change')) blockers.push('訂單異動尚未核可');
    if (scope.station === 'pack' && open.length && !open.some(row => row.type === 'order_change')) blockers.push('尚有未核可例外');
    if (order.status === 'voided') blockers.push('工作單已作廢');
    const ownerId = scope.station === 'pick' ? order.picker_id : scope.station === 'pack' ? order.packer_id : null;
    if (ownerId && ownerId !== user.id) blockers.push('已由其他人員認領');
    const allowedActions = [];
    if (writable && ['pick','pack'].includes(scope.station) && blockers.length === 0) {
        const ready = scope.station === 'pick' ? 'pending' : 'picked';
        const active = scope.station === 'pick' ? 'picking' : 'packing';
        if (order.status === ready || (order.status === active && (!ownerId || ownerId === user.id))) allowedActions.push(`${scope.station}:claim`);
        if (order.status === active && ownerId === user.id) allowedActions.push(`${scope.station}:scan`);
    }
    const assignee = scope.station === 'pick' ? order.picker_name : scope.station === 'pack' ? order.packer_name : null;
    // Corely's dispatch receipt is returned only by the native dispatch endpoint.
    const { nativeIntakeId, wmsOrderId, batchId, workBarcode, reservationAccepted, revision, ...base } = native;
    const projected = { ...base, assignee: assignee || null, blockers, allowedActions };
    if (!writable) return { ...projected, contractVersion: 'wms.workspace-read.v1', allowedActions: [] };
    return { ...projected, revision: parseInt(hash(projected).slice(0, 12), 16) + 1 };
}

async function detail(db, scope, id, writable = false) {
    const user = await actor(db, scope);
    const source = await intake(db, scope, id);
    return snapshot(db, scope, source, user, writable);
}

async function list(db, scope, query) {
    const user = await actor(db, scope);
    const page = query.page === undefined ? 1 : Number(query.page);
    const pageSize = query.pageSize === undefined ? 25 : Number(query.pageSize);
    const search = query.search === undefined ? '' : query.search;
    const view = query.view === undefined ? 'all' : query.view;
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
        typeof search !== 'string' || search.length > 120 || !['all','pending','picking','packing','completed','logistics','returns'].includes(view) ||
        Object.keys(query).some(key => !['page','pageSize','search','view'].includes(key))) throw fail(400, 'WMS_QUERY_INVALID');
    const params = [scope.entityId, scope.actorId, scope.station, search.trim(), view, user.id, pageSize, (page - 1) * pageSize];
    const where = `i.entity_id=$1 AND ($3::text<>'dispatch' OR EXISTS
        (SELECT 1 FROM corely_dispatch_grants g WHERE g.entity_id=i.entity_id AND g.erp_actor_id=$2 AND g.brand=i.payload->>'brand' AND g.revoked_at IS NULL))
        AND ($4::text='' OR i.erp_order_id ILIKE '%'||$4||'%' OR i.payload->>'orderNumber' ILIKE '%'||$4||'%' OR i.payload->>'brand' ILIKE '%'||$4||'%')
        AND ($3::text NOT IN ('pick','pack') OR ($3='pick' AND (o.picker_id IS NULL OR o.picker_id=$6))
          OR ($3='pack' AND (o.packer_id IS NULL OR o.packer_id=$6)))
        AND (($5::text='all' AND ($3 NOT IN ('pick','pack') OR ($3='pick' AND o.status IN ('pending','picking'))
          OR ($3='pack' AND o.status IN ('picked','packing'))))
          OR ($5='pending' AND o.status='pending') OR ($5='picking' AND o.status IN ('picking','picked'))
          OR ($5='packing' AND o.status='packing') OR ($5='completed' AND o.status='completed')
          OR ($5='logistics' AND EXISTS(SELECT 1 FROM corely_shipments s WHERE s.intake_id=i.id)))`;
    const total = Number((await db.query(`SELECT count(*)::int AS total FROM corely_native_intakes i JOIN orders o ON o.id=i.order_id WHERE ${where}`, params.slice(0,6))).rows[0].total);
    const rows = (await db.query(`SELECT i.erp_order_id,i.payload,o.status,o.warehouse_hold,o.updated_at,p.name AS picker_name,pk.name AS packer_name,
        COALESCE(st.required,0)::int AS required,COALESCE(st.picked,0)::int AS picked,COALESCE(st.packed,0)::int AS packed
        FROM corely_native_intakes i JOIN orders o ON o.id=i.order_id
        LEFT JOIN users p ON p.id=o.picker_id LEFT JOIN users pk ON pk.id=o.packer_id
        LEFT JOIN LATERAL (SELECT sum(x.quantity) AS required,sum(CASE WHEN x.serial_count>0 THEN x.picked_serials ELSE x.picked_quantity END) AS picked,
           sum(CASE WHEN x.serial_count>0 THEN x.packed_serials ELSE x.packed_quantity END) AS packed FROM
           (SELECT oi.id,oi.quantity,oi.picked_quantity,oi.packed_quantity,count(s.id) AS serial_count,
             count(s.id) FILTER (WHERE s.status IN ('picked','packed')) AS picked_serials,
             count(s.id) FILTER (WHERE s.status='packed') AS packed_serials
             FROM order_items oi LEFT JOIN order_item_instances s ON s.order_item_id=oi.id WHERE oi.order_id=o.id GROUP BY oi.id) x) st ON true
        WHERE ${where} ORDER BY o.updated_at DESC,o.id DESC LIMIT $7 OFFSET $8`, params)).rows;
    const ready = ['pick','pack'].includes(scope.station) ? (await db.query(`SELECT i.erp_order_id FROM corely_native_intakes i JOIN orders o ON o.id=i.order_id
        WHERE i.entity_id=$1 AND i.reservation_accepted AND i.prepick_completed_at IS NOT NULL AND o.warehouse_hold=FALSE
        AND (($2::text='pick' AND o.status IN ('pending','picking') AND (o.picker_id IS NULL OR o.picker_id=$3))
          OR ($2='pack' AND o.status IN ('picked','packing') AND (o.packer_id IS NULL OR o.packer_id=$3)))
        ORDER BY o.id LIMIT 5001`, [scope.entityId,scope.station,user.id])).rows.map(r=>r.erp_order_id) : null;
    return { contractVersion: 'wms.workspace-read.v1', source: 'wms', mode: 'read_only', total,
        ...(ready && ready.length <= 5000 && JSON.stringify(ready).length <= 650000 ? { readyKeys:ready } : {}), items: rows.map(r => ({
        id: r.erp_order_id, orderNumber: r.payload.orderNumber, brand: r.payload.brand, state: r.status,
        warehouseLabel: r.warehouse_hold ? '待預揀核對' : ({ pending:'待揀貨',picking:'揀貨中',picked:'待裝箱',packing:'裝箱中',completed:'裝箱完成',voided:'已作廢' }[r.status] || '狀態待確認'),
        logisticsLabel: '交運尚未核對', receiptLabel: 'Corely 庫存尚未核銷',
        assignee: scope.station === 'pick' ? r.picker_name : scope.station === 'pack' ? r.packer_name : null,
        updatedAt: new Date(r.updated_at).toISOString(), required: Number(r.required), picked: Number(r.picked), packed: Number(r.packed)
    })) };
}

async function guardLocked(db, scope, id, orderId, expectedRevision) {
    const user = await actor(db, scope);
    const source = await intake(db, scope, id);
    if (source.order_id !== Number(orderId)) throw fail(409, 'WMS_ORDER_CHANGED');
    const current = await snapshot(db, scope, source, user, true);
    if (current.revision !== expectedRevision) throw fail(409, 'WMS_REVISION_CHANGED');
    if (current.blockers.length) throw fail(409, 'WMS_WORKFLOW_BLOCKED');
    return current;
}
async function nativeState(db, orderId) {
    const order = (await db.query('SELECT * FROM orders WHERE id=$1', [orderId])).rows[0];
    if (!order) throw fail(404, 'WMS_ORDER_NOT_ACCESSIBLE');
    const lines = await readLines(db, order.id);
    return stateToken(order, lines.items, lines.instances);
}
async function nativeItemId(db, orderId, sourceLineId) {
    if (!numericId(orderId) || !validId(sourceLineId)) throw fail(400, 'WMS_SOURCE_LINE_INVALID');
    const rows = (await db.query(`SELECT id FROM order_items WHERE order_id=$1 AND source_platform='Corely'
        AND source_line_id=$2 LIMIT 2`, [orderId,sourceLineId])).rows;
    if (rows.length !== 1 || !numericId(rows[0].id)) throw fail(409, 'WMS_SOURCE_LINE_CHANGED');
    return Number(rows[0].id);
}

module.exports = { actor, intake, snapshot, detail, list, guardLocked, nativeState, nativeItemId, idempotencyKey, fail };
