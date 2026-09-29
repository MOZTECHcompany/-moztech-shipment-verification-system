'use strict';
const { randomUUID, createHash } = require('node:crypto');
const { manager, validId, hash } = require('./corelyNativeIntake');
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const shortText = (value, max = 200) => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
function validateCommand(body, user) {
    if (!manager(user)) throw fail('交運確認需由主管或拋單人員操作', 403);
    if (!uuid(body?.commandId) || body.expectedActorId !== user.id || body.confirmed !== true) throw fail('請確認實際交運及登入人員', 400);
    const h = body.handover;
    if (!h || !['carrier_collection', 'customer_pickup'].includes(h.method)) throw fail('請選擇交運方式', 400);
    for (const field of ['carrier', 'trackingNo', 'manifestId', 'note']) if (h[field] !== undefined && !shortText(h[field], field === 'note' ? 500 : 200)) throw fail('交運證據格式無效', 400);
    if (h.method === 'carrier_collection' && (!h.carrier || !(h.trackingNo || h.manifestId))) throw fail('交物流需要承運商及追蹤號碼或交接清單編號', 400);
    if (h.method === 'customer_pickup' && !(h.manifestId || h.note)) throw fail('客戶自取需要簽收編號或交接紀錄', 400);
    if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 1000) throw fail('請選擇本次實際交運品項', 400);
    const ids = new Set();
    for (const line of body.lines) {
        if (!line || !validId(line.salesOrderLineId) || ids.has(line.salesOrderLineId) || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 50000 || !Array.isArray(line.packages) || !line.packages.length || line.packages.length > 100) throw fail('交運明細或數量無效', 400);
        ids.add(line.salesOrderLineId); const packages = new Set(); let sum = 0;
        for (const p of line.packages) {
            if (!p || !shortText(p.packageId, 100) || packages.has(p.packageId) || !Number.isSafeInteger(p.quantity) || p.quantity < 1) throw fail('箱號或箱內數量無效', 400);
            packages.add(p.packageId); sum += p.quantity;
        }
        if (sum !== line.quantity) throw fail('箱內數量合計必須等於交運數量', 400);
    }
}
async function getIntake(db, id, user, lock = false) {
    if (!manager(user)) throw fail('交運確認需由主管或拋單人員操作', 403);
    if (!/^[1-9]\d{0,8}$/.test(String(id))) throw fail('原生批次編號無效', 400);
    const intake = (await db.query(`SELECT * FROM corely_native_intakes WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0];
    if (!intake || (user.entityId && user.entityId !== intake.entity_id)) throw fail('找不到此公司的原生工作單', 404);
    return intake;
}
function verifySource(intake, order, items, hasSerials) {
    if (!intake.reservation_accepted || !intake.prepick_completed_at || order.warehouse_hold) throw fail('請先完成庫存預留與預揀放行');
    if (order.status === 'voided') throw fail('已作廢工作單不可交運');
    const p = intake.payload;
    if (hasSerials || p.items.some(i => i.tracked || i.serials.length)) throw fail('此階段交運只支援非 SN 商品');
    if (!p.reservationReference || order.warehouse !== p.reservationReference.warehouseId || p.reservationReference.salesOrderId !== intake.erp_order_id || items.length !== p.items.length) throw fail('來源工作單已異動，請先核對 ERP 原單');
    for (const item of p.items) {
        const row = items.find(r => r.source_line_id === item.id);
        if (!row || !validId(item.productId) || row.source_platform !== 'Corely' || row.source_store !== intake.entity_id || row.product_code !== item.sku || row.barcode !== item.barcode || row.quantity !== item.quantity || row.source_order_number !== p.orderNumber) throw fail('來源商品明細已異動，請先核對 ERP 原單');
    }
}
function publicShipment(row) {
    const e = row.event;
    return { id: row.id, eventId: e.eventId, occurredAt: e.occurredAt, ...e.handover, status: 'handed_over', deliveryStatus: row.delivery_status || 'pending', deliveryError: row.last_error || null, acknowledgedAt: row.acknowledged_at || null, lines: e.lines };
}
async function listShipments(pool, id, user) {
    const i = await getIntake(pool, id, user);
    const items = (await pool.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY id', [i.order_id])).rows;
    const order = (await pool.query('SELECT * FROM orders WHERE id=$1', [i.order_id])).rows[0];
    const hasSerials = (await pool.query('SELECT 1 FROM order_item_instances s JOIN order_items i ON i.id=s.order_item_id WHERE i.order_id=$1 LIMIT 1', [i.order_id])).rows.length > 0;
    let blocker = null; try { verifySource(i, order, items, hasSerials); } catch (e) { blocker = e.message; }
    const rows = (await pool.query('SELECT s.*,o.status AS delivery_status,o.last_error,o.acknowledged_at FROM corely_shipments s JOIN corely_handover_outbox o ON o.event_id=s.event_id WHERE s.intake_id=$1 ORDER BY s.occurred_at,s.id', [id])).rows;
    return { blocker, lines: i.payload.items.map(p => { const r = items.find(x => x.source_line_id === p.id); return { salesOrderLineId: p.id, productId: p.productId, sku: p.sku, name: p.name, orderedQuantity: p.quantity, packedQuantity: r?.packed_quantity || 0, handedOverQuantity: r?.handed_over_quantity || 0, availableQuantity: Math.max(0, (r?.packed_quantity || 0) - (r?.handed_over_quantity || 0)) }; }), shipments: rows.map(publicShipment) };
}
async function handover(pool, id, body, user) {
    validateCommand(body, user);
    const db = await pool.connect(); let open = false, committing = false;
    try {
        await db.query('BEGIN'); open = true;
        await db.query("SET LOCAL lock_timeout='3000ms'"); await db.query("SET LOCAL statement_timeout='15000ms'");
        await db.query("SELECT pg_advisory_xact_lock(hashtext('corely-handover-command'),hashtext($1))", [`${user.id}:${body.commandId}`]);
        const intake = await getIntake(db, id, user, true);
        const digest = hash([String(id), body]);
        const prior = (await db.query('SELECT s.*,o.status AS delivery_status FROM corely_shipments s JOIN corely_handover_outbox o ON o.event_id=s.event_id WHERE s.actor_id=$1 AND s.command_id=$2', [user.id, body.commandId])).rows[0];
        if (prior) {
            if (prior.intake_id !== Number(id) || prior.request_hash !== digest) throw fail('同一交運操作識別不可更換內容');
            await db.query('ROLLBACK'); open = false; return { ...publicShipment(prior), reused: true };
        }
        const order = (await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [intake.order_id])).rows[0];
        const items = (await db.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY id FOR UPDATE', [order.id])).rows;
        const hasSerials = (await db.query('SELECT 1 FROM order_item_instances s JOIN order_items i ON i.id=s.order_item_id WHERE i.order_id=$1 LIMIT 1', [order.id])).rows.length > 0;
        verifySource(intake, order, items, hasSerials);
        const packages = [...new Set(body.lines.flatMap(l => l.packages.map(p => p.packageId)))];
        const usedPackage = await db.query('SELECT 1 FROM corely_shipment_packages p JOIN corely_shipment_lines l ON l.id=p.shipment_line_id JOIN corely_shipments s ON s.id=l.shipment_id WHERE s.intake_id=$1 AND p.package_id=ANY($2::text[]) LIMIT 1', [id, packages]);
        if (usedPackage.rows.length) throw fail('此箱號已交運，分批交運請使用新的箱號');
        const lines = body.lines.map(l => {
            const source = intake.payload.items.find(s => s.id === l.salesOrderLineId), item = items.find(i => i.source_line_id === l.salesOrderLineId);
            if (!source || !item || l.quantity > item.packed_quantity - item.handed_over_quantity) throw fail('本次交運超過尚未交運的已裝箱數量');
            return { shipmentLineId: randomUUID(), salesOrderLineId: source.id, productId: source.productId, sku: source.sku, quantity: l.quantity, packages: l.packages.map(p => ({ packageId: p.packageId, quantity: p.quantity })) };
        });
        const { method, carrier, trackingNo, manifestId, note } = body.handover;
        const event = { contractVersion: 'corely.wms.handover.v1', eventId: randomUUID(), entityId: intake.entity_id, warehouseId: intake.payload.reservationReference.warehouseId, salesOrderId: intake.erp_order_id, nativeIntakeId: intake.id, wmsOrderId: order.id, shipmentId: randomUUID(), sourceHash: intake.payload.sourceHash, occurredAt: new Date().toISOString(), handover: { method, ...(carrier ? { carrier } : {}), ...(trackingNo ? { trackingNo } : {}), ...(manifestId ? { manifestId } : {}), operatorId: String(user.id), ...(note ? { note } : {}) }, lines };
        const wire = JSON.stringify(event), bodyHash = createHash('sha256').update(wire).digest('hex');
        const saved = (await db.query('INSERT INTO corely_shipments(id,event_id,intake_id,order_id,actor_id,command_id,request_hash,occurred_at,event) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *', [event.shipmentId, event.eventId, id, order.id, user.id, body.commandId, digest, event.occurredAt, wire])).rows[0];
        for (const l of lines) {
            await db.query('INSERT INTO corely_shipment_lines(id,shipment_id,order_item_id,sales_order_line_id,product_id,sku,quantity) VALUES($1,$2,$3,$4,$5,$6,$7)', [l.shipmentLineId, event.shipmentId, items.find(i => i.source_line_id === l.salesOrderLineId).id, l.salesOrderLineId, l.productId, l.sku, l.quantity]);
            for (const p of l.packages) await db.query('INSERT INTO corely_shipment_packages(shipment_line_id,package_id,quantity) VALUES($1,$2,$3)', [l.shipmentLineId, p.packageId, p.quantity]);
        }
        await db.query('INSERT INTO corely_handover_outbox(event_id,body_text,body_hash) VALUES($1,$2,$3)', [event.eventId, wire, bodyHash]);
        await db.query('INSERT INTO corely_intake_events(intake_id,actor_id,action,details) VALUES($1,$2,\'handover\',$3)', [id, user.id, JSON.stringify({ eventId: event.eventId, shipmentId: event.shipmentId, quantity: lines.reduce((n, l) => n + l.quantity, 0) })]);
        committing = true; await db.query('COMMIT'); open = false;
        return { ...publicShipment(saved), reused: false };
    } catch (e) {
        if (open) try { await db.query('ROLLBACK'); } catch { committing = true; }
        if (committing) throw fail('交運記錄結果待確認，請重試原操作', 503);
        if (['55P03', '57014', '23505', '23514'].includes(e.code)) throw fail('交運資料已變更或正在處理，請更新後核對');
        throw e;
    } finally { db.release(); }
}
async function requestRetry(pool, id, shipmentId, user) {
    await getIntake(pool, id, user);
    if (!uuid(shipmentId)) throw fail('出貨識別無效', 400);
    const row = (await pool.query('SELECT event_id FROM corely_shipments WHERE intake_id=$1 AND id=$2', [id, shipmentId])).rows[0];
    if (!row) throw fail('找不到出貨記錄', 404);
    await pool.query("UPDATE corely_handover_outbox SET status='retry',next_attempt_at=NOW(),last_error=NULL WHERE event_id=$1 AND status IN ('pending','retry','rejected')", [row.event_id]);
    return { status: (await pool.query('SELECT status FROM corely_handover_outbox WHERE event_id=$1', [row.event_id])).rows[0].status };
}
module.exports = { handover, listShipments, requestRetry, validateCommand, uuid };
