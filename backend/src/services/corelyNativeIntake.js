'use strict';
const { createHash } = require('node:crypto');
const { createWorkBarcode } = require('./warehouseBatch');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const manager = user => ['admin', 'superadmin', 'dispatcher'].includes(user?.role);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const text = (value, max = 255) => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const productKey = item => JSON.stringify([item.sku, item.barcode]);
function products(items) {
    const result = new Map();
    for (const item of items) {
        const key = productKey(item);
        if (!result.has(key)) result.set(key, { key, sku: item.sku, name: item.name, barcode: item.barcode, quantity: 0 });
        result.get(key).quantity += item.quantity;
    }
    return [...result.values()];
}
function validateDispatch(id, body) {
    const p = body?.order;
    if (!validId(id) || !validId(body?.requestId) || body.requestId.length > 64 || !p || !text(p.orderNumber, 200) || !text(p.brand, 128) || !/^[a-f0-9]{64}$/.test(p.sourceHash || '') || !Array.isArray(p.items) || !p.items.length || p.items.length > 1000) throw fail('Corely 拋單資料不完整', 400);
    const ids = new Set(), serials = new Set(), barcodes = new Map();
    let total = 0;
    for (const i of p.items) {
        if (!i || !validId(i.id) || ids.has(i.id) || !text(i.sku) || !text(i.name) || !text(i.barcode, 100) || !Number.isSafeInteger(i.quantity) || i.quantity < 1 || typeof i.tracked !== 'boolean' || !Array.isArray(i.serials) || (i.tracked ? i.serials.length !== i.quantity : i.serials.length !== 0)) throw fail('Corely 商品、來源明細或 SN 格式無效', 400);
        if (i.productId !== undefined && !validId(i.productId)) throw fail('Corely 商品識別無效', 400);
        if (barcodes.has(i.barcode) && barcodes.get(i.barcode) !== i.sku) throw fail('不同商品不可共用作業條碼', 400);
        barcodes.set(i.barcode, i.sku); ids.add(i.id); total += i.quantity;
        for (const sn of i.serials) {
            if (!text(sn, 100) || /\s/.test(sn) || serials.has(sn)) throw fail('SN 缺漏、重複或格式無效', 400);
            serials.add(sn);
        }
    }
    if (total > 50000 || serials.size > 10000) throw fail('Corely 拋單數量超過上限', 400);
    let reservationAccepted = false;
    if (p.reservationReference !== undefined) {
        const r = p.reservationReference;
        if (!r || r.salesOrderId !== id || !validId(r.warehouseId) || !Array.isArray(r.quantitiesByProduct) || !r.quantitiesByProduct.length || r.quantitiesByProduct.length > 1000) throw fail('Corely 預留證據格式無效', 400);
        const expected = new Map();
        for (const i of p.items) {
            if (!validId(i.productId)) throw fail('預留核對需要每筆商品識別', 400);
            expected.set(i.productId, (expected.get(i.productId) || 0) + i.quantity);
        }
        const seen = new Set();
        for (const q of r.quantitiesByProduct) {
            if (!q || !validId(q.productId) || seen.has(q.productId) || !Number.isSafeInteger(q.quantity) || q.quantity < 1 || expected.get(q.productId) !== q.quantity) throw fail('Corely 預留量與出貨明細不符', 400);
            seen.add(q.productId);
        }
        if (seen.size !== expected.size) throw fail('Corely 預留證據缺少商品', 400);
        reservationAccepted = true;
    }
    return { payload: p, reservationAccepted };
}
async function dispatch(pool, scope, id, body) {
    const { payload, reservationAccepted } = validateDispatch(id, body);
    if (scope.station !== 'dispatch' || !validId(scope.entityId) || !validId(scope.actorId)) throw fail('無 Corely 拋單權限', 403);
    const db = await pool.connect(); let open = false, committing = false;
    try {
        await db.query('BEGIN'); open = true;
        await db.query("SET LOCAL lock_timeout='3000ms'");
        await db.query("SET LOCAL statement_timeout='15000ms'");
        const grant = (await db.query(`SELECT g.wms_user_id FROM corely_dispatch_grants g JOIN users u ON u.id=g.wms_user_id
            WHERE g.entity_id=$1 AND g.erp_actor_id=$2 AND g.brand=$3 AND g.revoked_at IS NULL
            AND u.role IN ('dispatcher','admin','superadmin') FOR SHARE OF g,u`, [scope.entityId, scope.actorId, payload.brand])).rows[0];
        if (!grant) throw fail('Corely 公司、品牌或拋單人員尚未授權', 403);
        // A request cannot be reassigned to a different order. Locks use a fixed
        // command -> order sequence; retries still recheck the current grant.
        await db.query("SELECT pg_advisory_xact_lock(hashtext('corely-request'),hashtext($1))", [JSON.stringify([scope.entityId, scope.actorId, body.requestId])]);
        await db.query("SELECT pg_advisory_xact_lock(hashtext('corely-order'),hashtext($1))", [JSON.stringify([scope.entityId, id])]);
        const digest = hash(payload);
        const byRequest = (await db.query('SELECT erp_order_id,payload_hash FROM corely_native_intakes WHERE entity_id=$1 AND erp_actor_id=$2 AND request_id=$3', [scope.entityId, scope.actorId, body.requestId])).rows[0];
        if (byRequest && (byRequest.erp_order_id !== id || byRequest.payload_hash !== digest)) throw fail('同一拋單識別不可重用於不同訂單或內容');
        let intake = (await db.query('SELECT * FROM corely_native_intakes WHERE entity_id=$1 AND erp_order_id=$2 FOR UPDATE', [scope.entityId, id])).rows[0];
        let reused = !!intake;
        if (intake && intake.request_id !== body.requestId) throw fail('此訂單已有拋單識別，請使用原請求重試');
        if (intake && intake.payload_hash !== digest) throw fail('此 Corely 訂單已拋轉不同版本，請核對原單');
        if (!intake) {
            const workBarcode = createWorkBarcode();
            const batch = (await db.query('INSERT INTO warehouse_import_batches(voucher_number,created_by) VALUES($1,$2) RETURNING id', ['CORELY-' + workBarcode, grant.wms_user_id])).rows[0];
            const order = (await db.query(`INSERT INTO orders(voucher_number,customer_name,warehouse,import_batch_id,source_order_number,source_platform,source_store,work_barcode,warehouse_hold)
                VALUES($1::text,$2::text,$3,$4,$2::text,'Corely',$5,$1::text,TRUE) RETURNING id`, [workBarcode, payload.orderNumber, payload.reservationReference?.warehouseId || null, batch.id, scope.entityId])).rows[0];
            for (const item of payload.items) {
                const row = (await db.query(`INSERT INTO order_items(order_id,product_code,product_name,quantity,barcode,source_order_number,source_platform,source_store,source_line_id)
                    VALUES($1,$2,$3,$4,$5,$6,'Corely',$7,$8) RETURNING id`, [order.id, item.sku, item.name, item.quantity, item.barcode, payload.orderNumber, scope.entityId, item.id])).rows[0];
                for (const sn of item.serials) await db.query('INSERT INTO order_item_instances(order_item_id,serial_number) VALUES($1,$2)', [row.id, sn]);
            }
            intake = (await db.query(`INSERT INTO corely_native_intakes(entity_id,erp_order_id,erp_actor_id,request_id,payload_hash,payload,reservation_accepted,order_id,import_batch_id,created_by)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [scope.entityId, id, scope.actorId, body.requestId, digest, JSON.stringify(payload), reservationAccepted, order.id, batch.id, grant.wms_user_id])).rows[0];
            await db.query("INSERT INTO operation_logs(user_id,order_id,action_type,details) VALUES($1,$2,'import',$3)", [grant.wms_user_id, order.id, JSON.stringify({ method: 'corely_native', entityId: scope.entityId, erpOrderId: id, erpActorId: scope.actorId, sourceHash: payload.sourceHash, reservationAccepted, warehouseHold: true })]);
            await db.query("INSERT INTO corely_intake_events(intake_id,actor_id,action,details) VALUES($1,$2,'dispatch',$3)", [intake.id, grant.wms_user_id, JSON.stringify({ sourceHash: payload.sourceHash, reservationAccepted })]);
        }
        const response = await commandSnapshot(db, intake);
        committing = true; await db.query('COMMIT'); open = false;
        return { ...response, reused };
    } catch (error) {
        if (open) try { await db.query('ROLLBACK'); } catch { committing = true; }
        if (committing) throw fail('拋單結果尚未確認，請以原請求重試核對', 503);
        if (['55P03', '57014', '23505'].includes(error.code)) throw fail('拋單正在處理，請以原請求重試');
        throw error;
    } finally { db.release(); }
}
async function commandSnapshot(db, intake) {
    const o = (await db.query('SELECT * FROM orders WHERE id=$1', [intake.order_id])).rows[0];
    const rows = (await db.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY id', [o.id])).rows;
    const sns = (await db.query('SELECT s.* FROM order_item_instances s JOIN order_items i ON i.id=s.order_item_id WHERE i.order_id=$1 ORDER BY s.id', [o.id])).rows;
    const items = rows.map(i => {
        const serials = sns.filter(s => s.order_item_id === i.id).map(s => ({ value: s.serial_number, status: s.status }));
        return { id: i.source_line_id, sku: i.product_code, name: i.product_name, barcode: i.barcode, quantity: i.quantity,
            picked: serials.length ? serials.filter(s => s.status !== 'pending').length : i.picked_quantity,
            packed: serials.length ? serials.filter(s => s.status === 'packed').length : i.packed_quantity, serials };
    });
    const snapshot = { contractVersion: 'wms.workspace-command.v1', source: 'wms', id: intake.erp_order_id,
        orderNumber: intake.payload.orderNumber, brand: intake.payload.brand, state: o.status,
        warehouseLabel: o.warehouse_hold ? '待預揀核對' : ({ pending: '待揀貨', picking: '揀貨中', picked: '待裝箱', packing: '裝箱中', completed: '裝箱完成', voided: '已作廢' }[o.status]),
        logisticsLabel: '交運尚未核對', receiptLabel: 'Corely 庫存尚未核銷', assignee: null, updatedAt: new Date(o.updated_at).toISOString(),
        required: items.reduce((n, i) => n + i.quantity, 0), picked: items.reduce((n, i) => n + i.picked, 0), packed: items.reduce((n, i) => n + i.packed, 0),
        items, allowedActions: [], blockers: !intake.reservation_accepted ? ['Corely 尚未提供完整預留證據'] : o.warehouse_hold ? ['待預揀核對完成'] : [],
        nativeIntakeId: intake.id, wmsOrderId: o.id, batchId: intake.import_batch_id, workBarcode: o.work_barcode, reservationAccepted: intake.reservation_accepted };
    return { ...snapshot, revision: parseInt(hash(snapshot).slice(0, 12), 16) + 1 };
}
async function readIntake(db, id, user) {
    if (!/^[1-9]\d{0,8}$/.test(String(id))) throw fail('Corely 批次編號無效', 400);
    const intake = (await db.query(`SELECT i.*,p.name AS print_owner_name,u.name AS prepick_owner_name
        FROM corely_native_intakes i LEFT JOIN users p ON p.id=i.print_owner_id LEFT JOIN users u ON u.id=i.prepick_owner_id WHERE i.id=$1`, [id])).rows[0];
    if (!intake || (user.entityId && intake.entity_id !== user.entityId) || (!manager(user) && intake.prepick_owner_id !== user.id)) throw fail('找不到可操作的 Corely 批次', 404);
    const snapshot = await commandSnapshot(db, intake);
    return { id: intake.id, orderNumber: intake.payload.orderNumber, brand: intake.payload.brand,
        reservationAccepted: intake.reservation_accepted, printOwnerName: intake.print_owner_name, printedAt: intake.printed_at,
        prepickOwnerId: intake.prepick_owner_id, prepickOwnerName: intake.prepick_owner_name, prepickCompletedAt: intake.prepick_completed_at,
        products: products(intake.payload.items), counts: intake.prepick_counts, snapshot };
}
async function mutatePrepick(pool, id, action, body, user) {
    if (!['print', 'assign', 'scan', 'complete'].includes(action) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body?.commandId || '') || body.expectedActorId !== user.id) throw fail('操作識別或登入人員無效', 400);
    if (['print', 'assign'].includes(action) && !manager(user)) throw fail('需要主管或拋單人員', 403);
    const db = await pool.connect(); let open = false, committing = false;
    try {
        await db.query('BEGIN'); open = true;
        await db.query("SET LOCAL lock_timeout='3000ms'"); await db.query("SET LOCAL statement_timeout='15000ms'");
        await db.query("SELECT pg_advisory_xact_lock(hashtext('corely-prepick-command'),hashtext($1))", [`${user.id}:${body.commandId}`]);
        const digest = hash([String(id), action, body]);
        const old = (await db.query('SELECT * FROM corely_intake_commands WHERE actor_id=$1 AND command_id=$2', [user.id, body.commandId])).rows[0];
        if (old) {
            // Revoked assignment must not expose a saved response through replay.
            await readIntake(db, id, user);
            if (old.request_hash !== digest) throw fail('同一操作識別不可更換內容');
            await db.query('ROLLBACK'); open = false; return { ...old.response, reused: true };
        }
        if (!/^[1-9]\d{0,8}$/.test(String(id))) throw fail('Corely 批次編號無效', 400);
        const intake = (await db.query('SELECT * FROM corely_native_intakes WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!intake) throw fail('找不到 Corely 批次', 404);
        const order = (await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [intake.order_id])).rows[0];
        const current = await readIntake(db, id, user);
        // Never release a changed or voided work order using an old source snapshot.
        const actual = current.snapshot.items;
        const source = intake.payload.items;
        if (order.status === 'voided' || source.length !== actual.length || source.some(i => { const a = actual.find(r => r.id === i.id); return !a || a.sku !== i.sku || a.barcode !== i.barcode || a.quantity !== i.quantity || JSON.stringify(a.serials.map(s => s.value).sort()) !== JSON.stringify([...i.serials].sort()); })) throw fail('工作單已異動，請先核對 Corely 原單');
        if (action === 'print') {
            await db.query('UPDATE corely_native_intakes SET print_owner_id=COALESCE(print_owner_id,$2),printed_at=COALESCE(printed_at,NOW()) WHERE id=$1', [id, user.id]);
        } else if (action === 'assign') {
            if (!intake.printed_at || intake.prepick_completed_at) throw fail('請先列印；已完成預揀不可改派');
            const assignee = (await db.query("SELECT id FROM users WHERE id=$1 AND role IN ('picker','packer','admin','superadmin')", [Number.isSafeInteger(body.assigneeId) ? body.assigneeId : 0])).rows[0];
            if (!assignee) throw fail('請選擇有效預揀人員', 400);
            await db.query('UPDATE corely_native_intakes SET prepick_owner_id=$2 WHERE id=$1', [id, assignee.id]);
        } else {
            if (intake.prepick_owner_id !== user.id) throw fail('請由指派預揀人員操作', 403);
            if (intake.prepick_completed_at) throw fail('預揀已完成');
            if (action === 'scan') {
                const product = current.products.find(p => p.key === body.productKey && p.barcode === body.barcode);
                if (!product || !Number.isSafeInteger(body.quantity) || body.quantity < 1) throw fail('商品條碼或實點數量無效', 400);
                const counts = { ...intake.prepick_counts, [product.key]: (intake.prepick_counts[product.key] || 0) + body.quantity };
                if (counts[product.key] > product.quantity) throw fail('實點數量超過需求');
                await db.query('UPDATE corely_native_intakes SET prepick_counts=$2 WHERE id=$1', [id, JSON.stringify(counts)]);
            } else {
                if (!intake.reservation_accepted) throw fail('Corely 尚未提供完整預留證據，不能放行');
                if (current.products.some(p => intake.prepick_counts[p.key] !== p.quantity)) throw fail('預揀數量尚未全部核對');
                if (order.status !== 'pending') throw fail('工作單狀態不允許預揀放行');
                await db.query('UPDATE corely_native_intakes SET prepick_completed_at=NOW() WHERE id=$1', [id]);
                await db.query('UPDATE orders SET warehouse_hold=FALSE,updated_at=NOW() WHERE id=$1', [intake.order_id]);
            }
        }
        await db.query('INSERT INTO corely_intake_events(intake_id,actor_id,action,details) VALUES($1,$2,$3,$4)', [id, user.id, action, JSON.stringify(body)]);
        const response = { ok: true, intakeId: Number(id), action, orderId: intake.order_id };
        await db.query('INSERT INTO corely_intake_commands(actor_id,command_id,request_hash,response) VALUES($1,$2,$3,$4)', [user.id, body.commandId, digest, JSON.stringify(response)]);
        committing = true; await db.query('COMMIT'); open = false; return response;
    } catch (error) {
        if (open) try { await db.query('ROLLBACK'); } catch { committing = true; }
        if (committing) throw fail('操作結果尚未確認，請重試原操作', 503);
        if (['55P03', '57014', '23505'].includes(error.code)) throw fail('批次正在處理，請重试原操作');
        throw error;
    } finally { db.release(); }
}
module.exports = { hash, validId, products, validateDispatch, dispatch, commandSnapshot, readIntake, mutatePrepick, manager };
