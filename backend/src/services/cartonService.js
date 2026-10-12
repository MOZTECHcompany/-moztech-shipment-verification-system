const { randomUUID } = require('node:crypto');
const { fail, digest, text, positive, serials, normalizeLines, normalizeCarton, identity, choosePickLines } = require('./cartonContents');
const { stateToken, readLines } = require('./scanSnapshot');
const { getOrderCompletion, canAutoComplete } = require('../utils/orderCompletion');
const { deferredEvents } = require('../utils/transactionEvents');
const { lockCartonSerials } = require('./cartonGuards');
const { readCartonShipmentReferences } = require('./cartonShipmentReferences');

const asCarton = row => ({ cartonId: row.carton_id, sourceSystem: row.source_system, sourceReference: row.source_reference,
    status: row.status, contentRevision: row.content_revision, stateRevision: row.state_revision, sealedAt: row.sealed_at,
    createdAt: row.created_at, updatedAt: row.updated_at });
const asAllocation = row => ({ allocationId: row.id, cartonId: row.carton_id, orderId: row.order_id,
    contentRevision: row.content_revision, status: row.status, lines: row.lines, pickedBy: row.picked_by,
    pickedAt: row.picked_at, packedBy: row.packed_by, packedAt: row.packed_at, releasedBy: row.released_by,
    releasedAt: row.released_at, releaseReason: row.release_reason });
function revision(value) {
    if (!Number.isSafeInteger(value) || value < 1) throw fail('CARTON_INVALID_INPUT', '箱內容版本無效', 400);
    return value;
}
function command(body, orderId, operation) {
    if (typeof body.commandId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.commandId)
        || typeof body.expectedState !== 'string' || !/^[0-9a-f]{64}$/.test(body.expectedState)) {
        throw fail('CARTON_INVALID_INPUT', '掃碼識別或訂單版本無效，請重新載入', 400);
    }
    revision(body.expectedCartonRevision);
    return { id: body.commandId.toLowerCase(), hash: digest(['carton-v1', operation, orderId, body.scanValue ?? null,
        body.type ?? null, body.mode ?? 'whole', body.selections ?? null, body.allocationId ?? null, body.serialPolicy ?? 'preassigned',
        body.expectedState, body.expectedCartonRevision, body.reason ?? null, body.expectedActorId]) };
}
function expectedActor(body, user, required = false) {
    if (!required && body.expectedActorId === undefined) return;
    if (!Number.isSafeInteger(body.expectedActorId) || body.expectedActorId !== user.id) {
        throw fail('CARTON_ACTOR_CHANGED', '登入人員已變更，請重新載入核對後再操作');
    }
}
function createCartonService({ pool }) {
    async function transaction(work, { readOnly = false, io } = {}) {
        const db = await pool.connect();
        const events = deferredEvents(io);
        let open = false, attempted = false, releaseError;
        try {
            await db.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN'); open = true;
            await db.query("SET LOCAL lock_timeout='1500ms'");
            await db.query("SET LOCAL statement_timeout='8000ms'");
            const result = await work(db, events);
            attempted = true;
            await db.query('COMMIT'); open = false;
            events.publish();
            return result;
        } catch (error) {
            if (open) {
                try { await db.query('ROLLBACK'); open = false; } catch (cleanup) { releaseError = cleanup; }
            }
            if (attempted || releaseError) throw fail('SCAN_RESULT_UNKNOWN', '結果尚未確認，請重新載入核對並使用原 command ID 查詢；請勿直接重刷', 503);
            if (error.code === '55P03' || error.code === '57014') throw fail('CARTON_BUSY', '箱號作業忙碌，請重新載入後重試');
            if (error.code === '23505') throw fail('CARTON_ID_OR_SN_CONFLICT', '箱號或 SN 已被登記，請重新查詢核對');
            error.scanNotApplied = !readOnly;
            throw error;
        } finally { db.release(releaseError); }
    }
    async function staff(db, actor, manage = false) {
        const user = (await db.query('SELECT id,name,role,management_scope FROM users WHERE id=$1', [actor?.id])).rows[0];
        if (!user) throw fail('AUTH_REQUIRED', '需要有效登入', 401);
        if (!['admin','superadmin','dispatcher','picker','packer'].includes(user.role)) throw fail('CARTON_FORBIDDEN', '權限不足', 403);
        if (manage && !(user.role === 'superadmin' || (user.role === 'admin' && user.management_scope !== 'orders'))) {
            throw fail('CARTON_FORBIDDEN', '箱內容變更需倉儲管理員權限', 403);
        }
        return user;
    }
    async function readCarton(db, cartonId, lock = false) {
        const row = (await db.query(`SELECT * FROM wms_cartons WHERE carton_id=$1${lock ? ' FOR UPDATE' : ''}`, [cartonId])).rows[0];
        if (!row) throw fail('CARTON_NOT_FOUND', '找不到箱號', 404);
        const carton = asCarton(row);
        const lines = (await db.query('SELECT * FROM wms_carton_lines WHERE carton_id=$1 ORDER BY position', [cartonId])).rows;
        const snRows = (await db.query('SELECT s.* FROM wms_carton_serials s JOIN wms_carton_lines l ON l.id=s.line_id WHERE l.carton_id=$1', [cartonId])).rows;
        carton.lines = lines.map(line => ({ lineId: line.id, itemCode: line.item_code, productName: line.product_name,
            ean: line.international_barcode, internalScanCode: line.internal_scan_code, codeType: line.code_type,
            quantity: line.quantity, remainingQuantity: line.remaining_quantity, actualSN: line.actual_sns,
            remainingSN: line.actual_sns.filter(sn => snRows.some(row => row.line_id === line.id && row.serial_number === sn && row.available)) }));
        carton.allocations = (await db.query('SELECT * FROM wms_carton_allocations WHERE carton_id=$1 ORDER BY picked_at,id', [cartonId])).rows.map(asAllocation);
        carton.history = (await db.query('SELECT * FROM wms_carton_history WHERE carton_id=$1 ORDER BY id DESC LIMIT 100', [cartonId])).rows;
        return carton;
    }
    async function resolve(db, value) {
        const raw = text(value, '掃描內容', { max: 102000 });
        const id = raw.replace(/^CARTON:/i, '').trim();
        const direct = (await db.query('SELECT carton_id FROM wms_cartons WHERE carton_id=$1', [id])).rows[0];
        if (direct) return direct.carton_id;
        if (!/^CARTON:/i.test(raw) && raw.includes(',')) {
            const sns = serials(raw.split(',').map(sn => sn.trim()));
            const matches = (await db.query(`SELECT c.carton_id FROM wms_cartons c
                JOIN wms_carton_lines l ON l.carton_id=c.carton_id JOIN wms_carton_serials s ON s.line_id=l.id
                GROUP BY c.carton_id HAVING COUNT(*)=$2 AND BOOL_AND(s.serial_number=ANY($1::text[]))`, [sns, sns.length])).rows;
            if (matches.length === 1) return matches[0].carton_id;
        }
        throw fail('CARTON_NOT_FOUND', '找不到箱號；SN 清單必須完全等於已登記箱的 SN', 404);
    }
    async function history(db, cartonId, eventType, actor, details) {
        await db.query(`INSERT INTO wms_carton_history(carton_id,event_type,content_revision,state_revision,actor_id,details)
            SELECT carton_id,$2,content_revision,state_revision,$3,$4 FROM wms_cartons WHERE carton_id=$1`,
        [cartonId, eventType, actor.id, JSON.stringify(details)]);
    }
    async function insertLines(db, cartonId, lines) {
        await lockCartonSerials(db, lines.flatMap(line => line.actualSN));
        for (const [position, line] of lines.entries()) {
            const row = (await db.query(`INSERT INTO wms_carton_lines(carton_id,position,item_code,product_name,
                international_barcode,internal_scan_code,code_type,quantity,remaining_quantity,actual_sns)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) RETURNING id`, [cartonId, position, line.itemCode,
                line.productName, line.ean, line.internalScanCode, line.codeType, line.quantity, JSON.stringify(line.actualSN)])).rows[0];
            if (line.actualSN.length) await db.query('INSERT INTO wms_carton_serials(line_id,serial_number) SELECT $1,unnest($2::text[])', [row.id, line.actualSN]);
        }
    }
    async function insertCarton(db, input, user) {
        await db.query(`INSERT INTO wms_cartons(carton_id,source_system,source_reference,created_by,updated_by) VALUES($1,$2,$3,$4,$4)`,
        [input.cartonId, input.sourceSystem, input.sourceReference, user.id]);
        await insertLines(db, input.cartonId, input.lines);
        await history(db, input.cartonId, 'created', user, input);
    }
    async function sealed(db, carton, user) {
        if (carton.status === 'sealed') return;
        if (carton.status !== 'draft') throw fail('CARTON_NOT_DRAFT', '只有草稿箱可以封箱');
        const sns = carton.lines.flatMap(line => line.actualSN);
        await lockCartonSerials(db, sns);
        if (sns.length && (await db.query("SELECT 1 FROM order_item_instances WHERE serial_number=ANY($1::text[]) AND status<>'pending' LIMIT 1", [sns])).rows.length) {
            throw fail('CARTON_SN_OCCUPIED', '箱內 SN 已揀貨或裝箱，請先核對實物與原訂單；未封箱');
        }
        await db.query("UPDATE wms_cartons SET status='sealed',sealed_at=NOW(),state_revision=state_revision+1,updated_by=$2,updated_at=NOW() WHERE carton_id=$1", [carton.cartonId, user.id]);
        await history(db, carton.cartonId, 'sealed', user, { content: carton.lines });
    }
    async function create(body, actor) {
        const input = normalizeCarton(body);
        return transaction(async db => {
            const user = await staff(db, actor, true);
            expectedActor(body, user);
            await insertCarton(db, input, user);
            if (body.seal === true) await sealed(db, await readCarton(db, input.cartonId), user);
            return readCarton(db, input.cartonId);
        });
    }
    async function importManifest(body, actor) {
        if (body?.format !== 'corely-cartons-v1' || !Array.isArray(body.cartons) || !body.cartons.length || body.cartons.length > 100) {
            throw fail('CARTON_INVALID_MANIFEST', '箱號匯入需 corely-cartons-v1，且一次 1–100 箱', 400);
        }
        const inputs = body.cartons.map(carton => normalizeCarton({ ...carton,
            sourceSystem: carton.sourceSystem ?? body.sourceSystem, sourceReference: carton.sourceReference ?? body.sourceReference }));
        if (new Set(inputs.map(input => input.cartonId)).size !== inputs.length || inputs.flatMap(input => input.lines).reduce((n, line) => n + line.actualSN.length, 0) > 10000) {
            throw fail('CARTON_INVALID_MANIFEST', '同批箱號不可重複且最多 10000 筆 SN', 400);
        }
        return transaction(async db => {
            const user = await staff(db, actor, true);
            expectedActor(body, user);
            const results = [];
            // Fixed order prevents two intersecting batch imports deadlocking.
            for (const input of [...inputs].sort((a, b) => a.cartonId.localeCompare(b.cartonId))) {
                await db.query("SELECT pg_advisory_xact_lock(hashtext('wms-carton-import'),hashtext($1))", [input.cartonId]);
                const exists = (await db.query('SELECT carton_id FROM wms_cartons WHERE carton_id=$1', [input.cartonId])).rows[0];
                if (exists) {
                    const carton = await readCarton(db, input.cartonId, true);
                    if (digest(identity(carton)) !== digest(identity(input))) throw fail('CARTON_CONTENT_CONFLICT', `箱號 ${input.cartonId} 已有不同內容，整批未匯入`);
                    results.push({ cartonId: input.cartonId, replayed: true, carton });
                } else {
                    await insertCarton(db, input, user);
                    results.push({ cartonId: input.cartonId, replayed: false, carton: await readCarton(db, input.cartonId) });
                }
            }
            return { format: 'corely-cartons-v1', items: results };
        });
    }
    async function list(query, actor) {
        const limit = query?.limit === undefined ? 25 : Number(query.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw fail('CARTON_INVALID_INPUT', '查詢數量無效', 400);
        const q = query?.q ? text(query.q, '查詢文字', { max: 128 }) : '';
        return transaction(async db => {
            await staff(db, actor);
            const rows = (await db.query(`SELECT c.*,COUNT(*) OVER()::int AS total,
                (SELECT COUNT(*)::int FROM wms_carton_lines l WHERE l.carton_id=c.carton_id) AS line_count,
                (SELECT SUM(quantity)::int FROM wms_carton_lines l WHERE l.carton_id=c.carton_id) AS total_quantity,
                (SELECT SUM(remaining_quantity)::int FROM wms_carton_lines l WHERE l.carton_id=c.carton_id) AS remaining_quantity
                FROM wms_cartons c WHERE POSITION(lower($1) IN lower(c.carton_id))>0 OR $1=''
                OR EXISTS(SELECT 1 FROM wms_carton_lines l WHERE l.carton_id=c.carton_id AND POSITION(lower($1) IN lower(l.item_code))>0)
                ORDER BY c.updated_at DESC,c.carton_id LIMIT $2`, [q, limit])).rows;
            return { items: rows.map(row => ({ ...asCarton(row), lineCount: row.line_count, quantity: row.total_quantity, remainingQuantity: row.remaining_quantity })), total: rows[0]?.total ?? 0 };
        }, { readOnly: true });
    }
    async function get(cartonId, actor) {
        return transaction(async db => { await staff(db, actor); return readCarton(db, text(cartonId, '箱號', { max: 128 })); }, { readOnly: true });
    }
    async function lookup(scanValue, actor) {
        return transaction(async db => { await staff(db, actor); return readCarton(db, await resolve(db, scanValue)); }, { readOnly: true });
    }
    async function edit(cartonId, body, actor) {
        const lines = normalizeLines(body.lines);
        revision(body.expectedContentRevision);
        return transaction(async db => {
            const user = await staff(db, actor, true), carton = await readCarton(db, cartonId, true);
            expectedActor(body, user);
            if (carton.contentRevision !== body.expectedContentRevision) throw fail('CARTON_CONTENT_CHANGED', '箱內容已更新，請重新載入');
            if (carton.status !== 'draft' || carton.allocations.length) throw fail('CARTON_CONTENT_LOCKED', '封箱或已分配的內容不能改寫；請保留原紀錄');
            await db.query('DELETE FROM wms_carton_lines WHERE carton_id=$1', [cartonId]);
            await insertLines(db, cartonId, lines);
            await db.query('UPDATE wms_cartons SET content_revision=content_revision+1,state_revision=state_revision+1,updated_at=NOW(),updated_by=$2 WHERE carton_id=$1', [cartonId, user.id]);
            await history(db, cartonId, 'contents_revised', user, { before: carton.lines, after: lines });
            return readCarton(db, cartonId);
        });
    }
    async function seal(cartonId, body, actor) {
        revision(body.expectedContentRevision);
        return transaction(async db => {
            const user = await staff(db, actor, true), carton = await readCarton(db, cartonId, true);
            expectedActor(body, user);
            if (carton.contentRevision !== body.expectedContentRevision) throw fail('CARTON_CONTENT_CHANGED', '箱內容已更新，請重新載入');
            await sealed(db, carton, user);
            return readCarton(db, cartonId);
        });
    }
    async function orderSnapshot(db, orderId, lock = false) {
        const order = (await db.query(`SELECT * FROM orders WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [orderId])).rows[0];
        if (!order) throw fail('ORDER_NOT_FOUND', '找不到訂單', 404);
        const lines = await readLines(db, orderId);
        return { order, ...lines, stateToken: stateToken(order, lines.items, lines.instances) };
    }
    async function checkStation(db, snapshot, user, type) {
        const { order } = snapshot;
        const admin = user.role === 'superadmin' || (user.role === 'admin' && user.management_scope !== 'orders');
        if (!admin && !['picker','packer'].includes(user.role)) throw fail('CARTON_FORBIDDEN', '箱掃描需倉儲作業權限', 403);
        if (order.warehouse_hold) throw fail('CARTON_ORDER_HELD', '此訂單尚待來源／ERP 核對，暫停倉儲箱號作業');
        if (order.status === 'voided' || order.status === 'completed') throw fail('CARTON_ORDER_CLOSED', '此訂單已作廢或完成，不能箱掃描');
        if (type === 'pick' && !['pending','picking'].includes(order.status)) throw fail('CARTON_WRONG_STAGE', '此訂單不在揀貨階段');
        if (type === 'pack' && !['picked','packing'].includes(order.status)) throw fail('CARTON_WRONG_STAGE', '此訂單尚未揀貨完成');
        if (!admin && ((type === 'pick' && order.picker_id !== user.id) || (type === 'pack' && order.packer_id && order.packer_id !== user.id))) {
            throw fail('CARTON_NOT_ASSIGNED', '您不是此任務的指定操作員', 403);
        }
        if (!admin && type === 'pack' && !order.packer_id && order.status !== 'picked') throw fail('CARTON_NOT_ASSIGNED', '請先認領裝箱任務', 403);
        const exceptions = (await db.query("SELECT type FROM order_exceptions WHERE order_id=$1 AND status='open'", [order.id])).rows;
        if (exceptions.some(row => row.type === 'order_change') || (type === 'pack' && exceptions.length)) {
            throw fail('CARTON_ORDER_EXCEPTION', '訂單有待核可異動或例外，請先處理');
        }
    }
    async function plan(db, snapshot, carton, body) {
        if (!['pick','pack'].includes(body.type)) throw fail('CARTON_INVALID_INPUT', '箱掃描類型無效', 400);
        if (carton.status !== 'sealed') throw fail('CARTON_NOT_SEALED', '此箱尚未封箱核對，不能出貨');
        const allocation = carton.allocations.find(row => row.orderId === snapshot.order.id && row.status !== 'released');
        if (body.type === 'pick') {
            if (allocation) throw fail('CARTON_ALREADY_ALLOCATED', '此箱已分配給此訂單，重掃不會再次計數');
            return { selection: choosePickLines(carton, body, snapshot.items, snapshot.instances).map(line => ({ ...line,
                sourcePlatform: line.sourcePlatform ?? snapshot.order.source_platform ?? null,
                sourceStore: line.sourceStore ?? snapshot.order.source_store ?? null,
                sourceOrderNumber: line.sourceOrderNumber ?? snapshot.order.source_order_number ?? null,
                sourceImportBatchId: snapshot.order.import_batch_id ?? null,
                sourceSystem: carton.sourceSystem, sourceReference: carton.sourceReference })), allocation: null };
        }
        if (!allocation || (body.allocationId && body.allocationId !== allocation.allocationId)) throw fail('CARTON_ALLOCATION_NOT_FOUND', '此箱沒有此訂單的已揀分配');
        if (allocation.status === 'packed') throw fail('CARTON_ALREADY_PACKED', '此箱分配已装箱，重掃不會再次計數');
        if (body.selections !== undefined) throw fail('CARTON_PACK_SELECTION_LOCKED', '裝箱必須核對原揀貨分配，不能改數量或 SN', 400);
        for (const line of allocation.lines) {
            const item = snapshot.items.find(row => row.id === line.orderItemId);
            if (!item || Number(item.quantity_sign ?? 1) !== 1) throw fail('SIGNED_CARTON_REVIEW_REQUIRED', '負向或已變動箱分配需主管核對');
            if (line.actualSN.length) {
                if (line.actualSN.some(sn => snapshot.instances.filter(row => row.order_item_id === item.id && row.serial_number === sn && row.status === 'picked').length !== 1)) {
                    throw fail('CARTON_ALLOCATION_CHANGED', '箱內 SN 的揀貨狀態已變更，整箱未套用');
                }
            }
        }
        for (const item of snapshot.items) {
            const quantity = allocation.lines.filter(line => line.orderItemId === item.id && !line.actualSN.length).reduce((sum, line) => sum + line.quantity, 0);
            if (quantity > Number(item.picked_quantity) - Number(item.packed_quantity)) throw fail('CARTON_ALLOCATION_CHANGED', '箱分配超過尚未裝箱的已揀數量');
        }
        return { selection: allocation.lines, allocation };
    }
    async function checkSerialOwnership(db, snapshot, selection) {
        const sns = selection.flatMap(line => line.actualSN);
        if (!sns.length) return;
        const owners = (await db.query(`SELECT i.serial_number,i.order_item_id,oi.order_id FROM order_item_instances i
            JOIN order_items oi ON oi.id=i.order_item_id WHERE i.serial_number=ANY($1::text[])`, [sns])).rows;
        for (const line of selection) for (const sn of line.actualSN) {
            const matches = owners.filter(owner => owner.serial_number === sn);
            if (matches.length > 1 || matches.some(owner => owner.order_id !== snapshot.order.id || owner.order_item_id !== line.orderItemId)) {
                throw fail('CARTON_SN_OCCUPIED', '箱內 SN 已由其他訂單／品項使用或重複登記，整箱不會綁定或扣量');
            }
        }
    }
    async function preview(orderId, body, actor) {
        positive(orderId, '訂單編號');
        return transaction(async db => {
            const user = await staff(db, actor), snapshot = await orderSnapshot(db, orderId);
            expectedActor(body, user, true);
            await checkStation(db, snapshot, user, body.type);
            const carton = await readCarton(db, await resolve(db, body.scanValue));
            const result = await plan(db, snapshot, carton, body);
            if (body.type === 'pick') await checkSerialOwnership(db, snapshot, result.selection);
            return { ...snapshot, ...result, carton, expectedState: snapshot.stateToken, expectedCartonRevision: carton.stateRevision, expectedActorId: user.id };
        }, { readOnly: true });
    }
    async function receipt(db, user, request) {
        // Same namespace/table as unit scans: reusing an ID across different
        // operations is a conflict, not a second successful mutation.
        await db.query("SELECT pg_advisory_xact_lock(hashtext('wms-scan-command'),hashtext($1))", [`${user.id}:${request.id}`]);
        const saved = (await db.query('SELECT request_hash,response FROM wms_scan_commands WHERE user_id=$1 AND command_id=$2', [user.id, request.id])).rows[0];
        if (saved && saved.request_hash !== request.hash) throw fail('CARTON_COMMAND_CONFLICT', '同一 command ID 不可用於不同作業');
        return saved?.response;
    }
    async function saveReceipt(db, user, orderId, request, response) {
        await db.query('INSERT INTO wms_scan_commands(user_id,command_id,order_id,request_hash,response) VALUES($1,$2,$3,$4,$5)', [user.id, request.id, orderId, request.hash, JSON.stringify(response)]);
    }
    async function auditOrder(db, events, user, order, action, details) {
        const log = (await db.query('INSERT INTO operation_logs(user_id,order_id,action_type,details) VALUES($1,$2,$3,$4) RETURNING id,created_at',
        [user.id, order.id, action, JSON.stringify(details)])).rows[0];
        events.emit('new_operation_log', { id: log.id, created_at: log.created_at, user_id: user.id, user_name: user.name,
            user_role: user.role, order_id: order.id, voucher_number: order.voucher_number, customer_name: order.customer_name, action_type: action, details });
    }
    async function complete(db, events, orderId, user) {
        const snapshot = await orderSnapshot(db, orderId);
        const result = getOrderCompletion(snapshot.items, snapshot.instances);
        if (result.allPicked && result.allPacked && canAutoComplete(snapshot.order.status)) {
            const open = (await db.query("SELECT 1 FROM order_exceptions WHERE order_id=$1 AND status='open' LIMIT 1", [orderId])).rows.length;
            if (!open) {
                await db.query("UPDATE orders SET status='completed',completed_at=NOW(),updated_at=NOW(),packer_id=COALESCE(packer_id,$2) WHERE id=$1", [orderId, user.id]);
                events.emit('task_status_changed', { orderId, newStatus: 'completed' });
            }
        } else if (result.allPicked && ['picking','pending'].includes(snapshot.order.status)) {
            await db.query("UPDATE orders SET status='picked',updated_at=NOW() WHERE id=$1", [orderId]);
            events.emit('task_status_changed', { orderId, newStatus: 'picked' });
        }
        return orderSnapshot(db, orderId);
    }
    async function applyLines(db, selection, type) {
        for (const line of selection) {
            if (line.actualSN.length) {
                if (type === 'pick' && line.newSN?.length) {
                    await db.query('INSERT INTO order_item_instances(order_item_id,serial_number) SELECT $1,unnest($2::text[])', [line.orderItemId, line.newSN]);
                    await db.query("UPDATE order_items SET carton_serial_binding=TRUE,serial_identity_mode='exact',updated_at=NOW() WHERE id=$1", [line.orderItemId]);
                }
                const oldStatus = type === 'pick' ? 'pending' : 'picked', newStatus = type === 'pick' ? 'picked' : 'packed';
                const result = await db.query('UPDATE order_item_instances SET status=$3,updated_at=NOW() WHERE order_item_id=$1 AND serial_number=ANY($2::text[]) AND status=$4 RETURNING id',
                [line.orderItemId, line.actualSN, newStatus, oldStatus]);
                if (result.rowCount !== line.quantity) throw fail('CARTON_ALLOCATION_CHANGED', 'SN 已被其他作業變更，整箱未套用');
            } else {
                const sql = type === 'pick'
                    ? 'UPDATE order_items SET picked_quantity=picked_quantity+$2,updated_at=NOW() WHERE id=$1 AND picked_quantity+$2<=quantity RETURNING id'
                    : 'UPDATE order_items SET packed_quantity=packed_quantity+$2,updated_at=NOW() WHERE id=$1 AND packed_quantity+$2<=picked_quantity RETURNING id';
                if ((await db.query(sql, [line.orderItemId, line.quantity])).rowCount !== 1) throw fail('CARTON_ORDER_QUANTITY_EXCEEDED', '箱數量超過訂單可作業數量，整箱未套用');
            }
        }
    }
    async function scan(orderId, body, actor, io) {
        positive(orderId, '訂單編號');
        const request = command(body, orderId, 'scan');
        return transaction(async (db, events) => {
            const user = await staff(db, actor);
            expectedActor(body, user, true);
            if (user.role === 'admin' && user.management_scope === 'orders') throw fail('CARTON_FORBIDDEN', '訂單管理員不能進行倉儲作業', 403);
            const replay = await receipt(db, user, request);
            if (replay) return replay;
            const before = await orderSnapshot(db, orderId, true);
            if (before.stateToken !== body.expectedState) throw fail('STATE_CHANGED', '訂單已更新，請重新載入核對');
            await checkStation(db, before, user, body.type);
            const carton = await readCarton(db, await resolve(db, body.scanValue), true);
            if (carton.stateRevision !== body.expectedCartonRevision) throw fail('CARTON_STATE_CHANGED', '箱內容或分配已更新，請重新載入核對');
            const { selection, allocation } = await plan(db, before, carton, body);
            if (body.type === 'pick') {
                await lockCartonSerials(db, selection.flatMap(line => line.actualSN));
                await checkSerialOwnership(db, before, selection);
            }
            if (body.type === 'pack' && before.order.status === 'picked') {
                await db.query("UPDATE orders SET status='packing',packer_id=COALESCE(packer_id,$2),updated_at=NOW() WHERE id=$1", [orderId, user.id]);
                events.emit('task_status_changed', { orderId, newStatus: 'packing' });
            }
            await applyLines(db, selection, body.type);
            let allocationId = allocation?.allocationId;
            if (body.type === 'pick') {
                allocationId = randomUUID();
                await db.query(`INSERT INTO wms_carton_allocations(id,carton_id,order_id,content_revision,status,lines,picked_by)
                    VALUES($1,$2,$3,$4,'picked',$5,$6)`, [allocationId, carton.cartonId, orderId, carton.contentRevision, JSON.stringify(selection), user.id]);
                for (const line of selection) {
                    const updated = await db.query('UPDATE wms_carton_lines SET remaining_quantity=remaining_quantity-$2 WHERE id=$1 AND remaining_quantity>=$2 RETURNING id', [line.lineId, line.quantity]);
                    if (updated.rowCount !== 1) throw fail('CARTON_QUANTITY_EXCEEDED', '箱內剩餘已被其他作業分配');
                    if (line.actualSN.length) {
                        const units = await db.query('UPDATE wms_carton_serials SET available=FALSE WHERE line_id=$1 AND serial_number=ANY($2::text[]) AND available=TRUE RETURNING serial_number', [line.lineId, line.actualSN]);
                        if (units.rowCount !== line.quantity) throw fail('CARTON_SN_UNAVAILABLE', 'SN 已被其他作業分配');
                    }
                }
            } else {
                await db.query("UPDATE wms_carton_allocations SET status='packed',packed_at=NOW(),packed_by=$2 WHERE id=$1 AND status='picked'", [allocationId, user.id]);
            }
            await db.query('UPDATE wms_cartons SET state_revision=state_revision+1,updated_by=$2,updated_at=NOW() WHERE carton_id=$1', [carton.cartonId, user.id]);
            await history(db, carton.cartonId, body.type === 'pick' ? 'allocated' : 'packed', user, { orderId, allocationId, lines: selection });
            await auditOrder(db, events, user, before.order, body.type, { cartonId: carton.cartonId, allocationId, lines: selection, commandId: request.id });
            const snapshot = await complete(db, events, orderId, user), after = await readCarton(db, carton.cartonId);
            const response = { format: 'snapshot-v1', commandId: request.id, baseState: body.expectedState, ...snapshot,
                carton: after, allocation: after.allocations.find(row => row.allocationId === allocationId) };
            await saveReceipt(db, user, orderId, request, response);
            return response;
        }, { io });
    }
    async function release(allocationId, body, actor, io) {
        if (typeof allocationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(allocationId)) throw fail('CARTON_INVALID_INPUT', '分配編號無效', 400);
        const reason = text(body.reason, '退回分配原因', { max: 1000 });
        return transaction(async (db, events) => {
            const user = await staff(db, actor, true);
            expectedActor(body, user, true);
            const found = (await db.query('SELECT * FROM wms_carton_allocations WHERE id=$1', [allocationId])).rows[0];
            if (!found) throw fail('CARTON_ALLOCATION_NOT_FOUND', '找不到箱分配', 404);
            const request = command({ ...body, allocationId }, found.order_id, 'release');
            const replay = await receipt(db, user, request);
            if (replay) return replay;
            const snapshot = await orderSnapshot(db, found.order_id, true), carton = await readCarton(db, found.carton_id, true);
            if (snapshot.stateToken !== body.expectedState) throw fail('STATE_CHANGED', '訂單已更新，請重新載入核對');
            if (carton.stateRevision !== body.expectedCartonRevision) throw fail('CARTON_STATE_CHANGED', '箱分配已更新，請重新載入核對');
            const allocation = carton.allocations.find(row => row.allocationId === allocationId);
            if (allocation.status !== 'picked' || snapshot.order.status === 'completed') throw fail('CARTON_RELEASE_BLOCKED', '只能退回尚未裝箱的分配；已裝箱需獨立退貨流程');
            await lockCartonSerials(db, allocation.lines.flatMap(line => line.actualSN));
            for (const line of allocation.lines) {
                if (line.actualSN.length) {
                    const result = await db.query("UPDATE order_item_instances SET status='pending',updated_at=NOW() WHERE order_item_id=$1 AND serial_number=ANY($2::text[]) AND status='picked' RETURNING id", [line.orderItemId, line.actualSN]);
                    if (result.rowCount !== line.quantity) throw fail('CARTON_ALLOCATION_CHANGED', 'SN 狀態已變更，不能退回分配');
                    if (line.newSN?.length) {
                        await db.query("DELETE FROM order_item_instances WHERE order_item_id=$1 AND serial_number=ANY($2::text[]) AND status='pending'", [line.orderItemId, line.newSN]);
                        await db.query('UPDATE order_items oi SET carton_serial_binding=FALSE,updated_at=NOW() WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM order_item_instances i WHERE i.order_item_id=oi.id)', [line.orderItemId]);
                    }
                    await db.query('UPDATE wms_carton_serials SET available=TRUE WHERE line_id=$1 AND serial_number=ANY($2::text[])', [line.lineId, line.actualSN]);
                } else {
                    const result = await db.query('UPDATE order_items SET picked_quantity=picked_quantity-$2,updated_at=NOW() WHERE id=$1 AND picked_quantity-$2>=packed_quantity RETURNING id', [line.orderItemId, line.quantity]);
                    if (result.rowCount !== 1) throw fail('CARTON_ALLOCATION_CHANGED', '原分配已被裝箱或變更，不能退回');
                }
                await db.query('UPDATE wms_carton_lines SET remaining_quantity=remaining_quantity+$2 WHERE id=$1', [line.lineId, line.quantity]);
            }
            await db.query("UPDATE wms_carton_allocations SET status='released',released_by=$2,released_at=NOW(),release_reason=$3 WHERE id=$1", [allocationId, user.id, reason]);
            await db.query('UPDATE wms_cartons SET state_revision=state_revision+1,updated_by=$2,updated_at=NOW() WHERE carton_id=$1', [carton.cartonId, user.id]);
            if (['picked','packing'].includes(snapshot.order.status)) {
                await db.query("UPDATE orders SET status='picking',updated_at=NOW() WHERE id=$1", [found.order_id]);
                events.emit('task_status_changed', { orderId: found.order_id, newStatus: 'picking' });
            }
            await history(db, carton.cartonId, 'allocation_released', user, { allocationId, orderId: found.order_id, reason });
            await auditOrder(db, events, user, snapshot.order, 'carton_release', { cartonId: carton.cartonId, allocationId, reason });
            const response = { format: 'snapshot-v1', commandId: request.id, baseState: body.expectedState,
                ...await orderSnapshot(db, found.order_id), carton: await readCarton(db, carton.cartonId) };
            await saveReceipt(db, user, found.order_id, request, response);
            return response;
        }, { io });
    }
    async function shipments(orderId, actor) {
        positive(orderId, '訂單編號');
        return transaction(async db => {
            await staff(db, actor);
            const snapshot = await orderSnapshot(db, orderId);
            const records = (await db.query('SELECT * FROM wms_carton_allocations WHERE order_id=$1 ORDER BY picked_at,id', [orderId])).rows.map(asAllocation);
            const remaining = (await db.query('SELECT id,remaining_quantity FROM wms_carton_lines WHERE carton_id=ANY($1::text[])', [records.map(row => row.cartonId)])).rows;
            return { ...await readCartonShipmentReferences(db, snapshot.order), order: snapshot.order, stateToken: snapshot.stateToken, allocations: records.map(record => ({ ...record,
                lines: record.lines.map(line => {
                    return { ...line, currentRemainingQuantity: remaining.find(row => row.id === line.lineId)?.remaining_quantity ?? null };
                }) })) };
        }, { readOnly: true });
    }
    return { create, importManifest, list, get, lookup, edit, seal, preview, scan, release, shipments };
}
module.exports = { createCartonService };
