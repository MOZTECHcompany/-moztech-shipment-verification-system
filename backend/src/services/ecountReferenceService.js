const { fail, text } = require('./cartonContents');
const { actorSnapshot } = require('../utils/warehouseWork');
const { buildEcountManifest, digest, ordered, compare } = require('./ecountReferenceManifest');
const { readCartonShipmentReferences } = require('./cartonShipmentReferences');
const canManage = user => ['dispatcher','admin','superadmin'].includes(user?.role);
const validId = value => Number.isSafeInteger(value) && value > 0;
const iso = value => value ? new Date(value).toISOString() : null;
const referenceColumns = 'order_id,company_code,voucher_number,revision,manifest_fingerprint,confirmed_fingerprint,confirmation_kind,confirmed_at,confirmed_actor_snapshot,updated_at,updated_actor_snapshot';
function normalizedVoucher(value) {
    const literal = text(value, 'ECOUNT 既有銷貨單號', { max: 100 });
    const match = /^(\d{4})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{1,2})\s*[-－–—]\s*(\d{1,9})$/.exec(literal);
    if (!match) return { value: literal, dated: false };
    const [year, month, day, number] = match.slice(1).map(Number), date = new Date(Date.UTC(year, month - 1, day));
    if (year < 1000 || number < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return { value: literal, dated: false };
    return { value: `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}-${number}`, dated: true };
}
function referenceView(row) {
    return row ? { companyCode: row.company_code, voucherNumber: row.voucher_number, revision: row.revision,
        manifestFingerprint: row.manifest_fingerprint, confirmedFingerprint: row.confirmed_fingerprint,
        confirmationKind: row.confirmation_kind, confirmedAt: iso(row.confirmed_at), confirmedBy: row.confirmed_actor_snapshot,
        updatedAt: iso(row.updated_at), updatedBy: row.updated_actor_snapshot } : null;
}
function confirmationInput(value) {
    if (value === undefined || value === null) return null;
    if (!value || Array.isArray(value) || value.kind !== 'manual-line-check' || value.acknowledgeExistingSales !== true
        || value.acknowledgeMetadataSaved !== true || !Array.isArray(value.lines) || !value.lines.length || value.lines.length > 10000) {
        throw fail('ECOUNT_REFERENCE_INVALID_INPUT', '請輸入既有銷貨單的實際明細，並確認已完成核對與註記', 400);
    }
    const seenSN = new Set(), quantities = new Map(); let totalQuantity = 0;
    const lines = value.lines.map(line => {
        const itemCode = text(line?.itemCode, 'ECOUNT 品號', { max: 255 }), quantity = line?.quantity, sns = line?.actualSN ?? [];
        if (!validId(quantity) || !Array.isArray(sns) || sns.length > 10000 || sns.length && sns.length !== quantity) throw fail('ECOUNT_REFERENCE_INVALID_INPUT', '明細數量需為正整數，SN 筆數須等於該列件數', 400);
        totalQuantity += quantity;
        const itemQuantity = (quantities.get(itemCode) || 0) + quantity;
        if (!Number.isSafeInteger(totalQuantity) || !Number.isSafeInteger(itemQuantity)) throw fail('ECOUNT_REFERENCE_INVALID_INPUT', '核對明細累計數量超過可安全處理的整數範圍', 400);
        quantities.set(itemCode, itemQuantity);
        for (const sn of sns) {
            if (typeof sn !== 'string' || !sn || sn.length > 100 || /[\u0000-\u0020\u007f]/.test(sn) || seenSN.has(sn)) throw fail('ECOUNT_REFERENCE_INVALID_INPUT', '實際 SN 不可空白、重複或改寫原字串', 400);
            seenSN.add(sn);
        }
        if (seenSN.size > 10000) throw fail('ECOUNT_REFERENCE_INVALID_INPUT', '核對 SN 最多 10000 筆', 400);
        return { itemCode, quantity, actualSN: ordered(sns) };
    });
    return { kind: 'manual-line-check', acknowledgeExistingSales: true, acknowledgeMetadataSaved: true,
        lines: lines.sort((a, b) => compare(a.itemCode, b.itemCode) || compare(JSON.stringify(a), JSON.stringify(b))) };
}
function checkConfirmation(confirmation, manifest) {
    if (!manifest.ready) throw fail('ECOUNT_REFERENCE_NOT_READY', manifest.blockers.map(row => row.message).join('；'));
    const actual = new Map();
    for (const line of confirmation.lines) {
        const row = actual.get(line.itemCode) || { itemCode: line.itemCode, quantity: 0, actualSN: [] };
        row.quantity += line.quantity; row.actualSN.push(...line.actualSN); actual.set(line.itemCode, row);
    }
    if (actual.size !== manifest.totals.length) throw fail('ECOUNT_REFERENCE_LINES_MISMATCH', 'ECOUNT 明細品號範圍與實際出貨不一致');
    for (const expected of manifest.totals) {
        const row = actual.get(expected.itemCode);
        if (!row || row.quantity !== expected.quantity || JSON.stringify(ordered(row.actualSN)) !== JSON.stringify(expected.actualSN)) {
            throw fail('ECOUNT_REFERENCE_LINES_MISMATCH', 'ECOUNT 明細品號、實際數量或 SN 與出貨紀錄不一致');
        }
    }
}
function parseInput(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)
        || typeof body.commandId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.commandId)
        || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 || !validId(body.expectedActorId)
        || typeof body.expectedFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedFingerprint)) throw fail('ECOUNT_REFERENCE_INVALID_INPUT', '核對識別或版本無效，請重新載入', 400);
    const voucher = normalizedVoucher(body.voucherNumber), confirmation = confirmationInput(body.confirmation);
    if (confirmation && !voucher.dated) throw fail('ECOUNT_REFERENCE_VOUCHER_FORMAT', '人工核對請填 ECOUNT 日期與序號，例如 2026/10/15-1；其他識別只能先保存參考', 400);
    return { commandId: body.commandId.toLowerCase(), expectedRevision: body.expectedRevision, expectedFingerprint: body.expectedFingerprint,
        expectedActorId: body.expectedActorId, companyCode: text(body.companyCode, 'ECOUNT 公司代碼', { max: 64 }),
        voucherNumber: voucher.value,
        reason: text(body.reason, '異動原因', { optional: true, max: 1000 }), confirmation };
}
function createEcountReferenceService({ pool }) {
    async function transaction(work, readOnly = false) {
        const db = await pool.connect(); let open = false, attempted = false, releaseError;
        try {
            await db.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN'); open = true;
            await db.query("SET LOCAL lock_timeout='1500ms'"); await db.query("SET LOCAL statement_timeout='8000ms'");
            const result = await work(db); attempted = true; await db.query('COMMIT'); open = false; return result;
        } catch (error) {
            if (open) try { await db.query('ROLLBACK'); } catch (cleanup) { releaseError = cleanup; }
            if (attempted || releaseError) { releaseError ||= error; throw fail('ECOUNT_REFERENCE_RESULT_UNKNOWN', '儲存結果尚未確認，請用相同識別重新確認，勿新增另一筆', 503); }
            if (['55P03','57014'].includes(error.code)) throw fail('ECOUNT_REFERENCE_BUSY', '對照正在更新，請重新載入後重試');
            if (error.code === '23505') throw fail('ECOUNT_REFERENCE_DOCUMENT_CONFLICT', '同一公司這張 ECOUNT 原銷貨單已有 WMS 對照，分批出貨須先人工核對合併範圍');
            throw error;
        } finally { db.release(releaseError); }
    }
    async function staff(db, actor, manage = false) {
        const user = (await db.query('SELECT id,username,name,role,management_scope FROM users WHERE id=$1' + (manage ? ' FOR SHARE' : ''), [actor?.id])).rows[0];
        if (!user || !['dispatcher','admin','superadmin','picker','packer'].includes(user.role)) throw fail('AUTH_REQUIRED', '需要有效登入', 401);
        if (manage && !canManage(user)) throw fail('ECOUNT_REFERENCE_FORBIDDEN', '僅銷貨／拋單人員與管理員可以保存銷貨對照', 403);
        return user;
    }
    async function load(db, orderId, lock = false) {
        const order = (await db.query('SELECT * FROM orders WHERE id=$1' + (lock ? ' FOR UPDATE' : ''), [orderId])).rows[0];
        if (!order) throw fail('ORDER_NOT_FOUND', '找不到訂單', 404);
        const items = (await db.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY id', [orderId])).rows;
        const instances = (await db.query('SELECT i.* FROM order_item_instances i JOIN order_items oi ON oi.id=i.order_item_id WHERE oi.order_id=$1 ORDER BY i.id', [orderId])).rows;
        const allocations = (await db.query('SELECT * FROM wms_carton_allocations WHERE order_id=$1 ORDER BY id', [orderId])).rows;
        const exceptions = (await db.query('SELECT id,type,status,updated_at FROM order_exceptions WHERE order_id=$1 ORDER BY id', [orderId])).rows;
        return { order, manifest: buildEcountManifest({ order, items, instances, allocations, exceptions }) };
    }
    async function output(db, loaded, user) {
        const row = (await db.query(`SELECT ${referenceColumns} FROM wms_ecount_order_references WHERE order_id=$1`, [loaded.order.id])).rows[0];
        const history = (await db.query('SELECT id,revision,event_type,reason,actor_snapshot,created_at,before_state,after_state FROM wms_ecount_reference_history WHERE order_id=$1 ORDER BY revision DESC LIMIT 100', [loaded.order.id])).rows;
        const reference = referenceView(row), legacy = await readCartonShipmentReferences(db, loaded.order);
        return { ...loaded.manifest, reference, status: !row ? 'unlinked' : row.manifest_fingerprint !== loaded.manifest.fingerprint ? 'changed'
            : row.confirmation_kind === 'manual-line-check' ? 'manual_checked' : 'reference_only', canManage: canManage(user),
            ...(legacy.referenceWarning ? { referenceWarning: legacy.referenceWarning } : {}),
            history: history.map(event => ({ id: event.id, revision: event.revision, eventType: event.event_type,
                reason: event.reason, actorSnapshot: event.actor_snapshot, createdAt: iso(event.created_at), before: event.before_state,
                after: event.after_state, evidenceFingerprint: event.after_state?.manifestFingerprint || null })) };
    }
    async function get(orderId, actor) {
        if (!validId(orderId)) throw fail('ECOUNT_REFERENCE_INVALID_INPUT', '訂單編號無效', 400);
        return transaction(async db => { const user = await staff(db, actor); return output(db, await load(db, orderId), user); }, true);
    }
    async function save(orderId, body, actor) {
        if (!validId(orderId)) throw fail('ECOUNT_REFERENCE_INVALID_INPUT', '訂單編號無效', 400);
        const input = parseInput(body), requestHash = digest(['ecount-reference-v1', orderId, input]);
        return transaction(async db => {
            const user = await staff(db, actor, true);
            if (user.id !== input.expectedActorId) throw fail('ECOUNT_REFERENCE_ACTOR_CHANGED', '登入人員已變更，請重新載入');
            await db.query("SELECT pg_advisory_xact_lock(hashtext('wms-ecount-reference-command'),hashtext($1))", [`${user.id}:${input.commandId}`]);
            const receipt = (await db.query('SELECT * FROM wms_ecount_reference_commands WHERE user_id=$1 AND command_id=$2', [user.id, input.commandId])).rows[0];
            if (receipt) {
                if (receipt.request_hash !== requestHash) throw fail('ECOUNT_REFERENCE_COMMAND_CONFLICT', '同一儲存識別不可用於不同對照內容');
                return { ...await output(db, await load(db, orderId, true), user), commandId: input.commandId,
                    replayed: true, unchanged: receipt.reference_revision === input.expectedRevision };
            }
            const loaded = await load(db, orderId, true);
            const before = (await db.query(`SELECT ${referenceColumns} FROM wms_ecount_order_references WHERE order_id=$1 FOR UPDATE`, [orderId])).rows[0];
            if ((before?.revision || 0) !== input.expectedRevision) throw fail('ECOUNT_REFERENCE_VERSION_CHANGED', '對照已被其他人更新，請重新載入');
            if (loaded.manifest.fingerprint !== input.expectedFingerprint) throw fail('ECOUNT_REFERENCE_SHIPMENT_CHANGED', '訂單或箱號內容已變更，請重新載入核對');
            if (before && (before.company_code !== input.companyCode || before.voucher_number !== input.voucherNumber) && !input.reason) throw fail('ECOUNT_REFERENCE_REASON_REQUIRED', '變更既有公司或銷貨單號時，請填寫原因', 400);
            if (before && before.company_code === input.companyCode && before.voucher_number === input.voucherNumber && !input.confirmation) {
                // Re-entering the same canonical document is not a new check.
                // Preserve its original confirmation, fingerprint and reservation.
                await db.query('INSERT INTO wms_ecount_reference_commands(user_id,command_id,order_id,request_hash,reference_revision) VALUES($1,$2,$3,$4,$5)',
                    [user.id, input.commandId, orderId, requestHash, before.revision]);
                return { ...await output(db, loaded, user), commandId: input.commandId, replayed: false, unchanged: true };
            }
            if (input.confirmation) {
                checkConfirmation(input.confirmation, loaded.manifest);
                await db.query("SELECT pg_advisory_xact_lock(hashtext('wms-ecount-confirmed-document'),hashtext($1))", [JSON.stringify([input.companyCode, input.voucherNumber])]);
                const occupied = (await db.query(`SELECT order_id FROM wms_ecount_order_references
                    WHERE company_code=$1 AND voucher_number=$2 AND confirmation_kind IS NOT NULL AND order_id<>$3 LIMIT 1`, [input.companyCode, input.voucherNumber, orderId])).rows.length;
                if (occupied) throw fail('ECOUNT_REFERENCE_DOCUMENT_CONFLICT', '同一公司這張 ECOUNT 原銷貨單已有 WMS 對照，分批出貨須先人工核對合併範圍');
            }
            const revision = (before?.revision || 0) + 1, snapshot = actorSnapshot(user), confirmation = input.confirmation;
            // Freeze the exact local shipment alongside the independently typed
            // manual evidence. Later loose-unit/order edits must not rewrite what
            // the clerk actually compared at this revision.
            const evidence = { ...(confirmation || {}), shipmentSnapshot: loaded.manifest };
            await db.query(`INSERT INTO wms_ecount_order_references(order_id,company_code,voucher_number,revision,manifest_fingerprint,
                confirmed_fingerprint,confirmation_kind,confirmation_evidence,confirmed_by,confirmed_actor_snapshot,confirmed_at,updated_by,updated_actor_snapshot)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $7::text IS NULL THEN NULL ELSE NOW() END,$11,$12)
                ON CONFLICT(order_id) DO UPDATE SET company_code=EXCLUDED.company_code,voucher_number=EXCLUDED.voucher_number,
                revision=EXCLUDED.revision,manifest_fingerprint=EXCLUDED.manifest_fingerprint,confirmed_fingerprint=EXCLUDED.confirmed_fingerprint,
                confirmation_kind=EXCLUDED.confirmation_kind,confirmation_evidence=EXCLUDED.confirmation_evidence,confirmed_by=EXCLUDED.confirmed_by,
                confirmed_actor_snapshot=EXCLUDED.confirmed_actor_snapshot,confirmed_at=EXCLUDED.confirmed_at,updated_by=EXCLUDED.updated_by,
                updated_actor_snapshot=EXCLUDED.updated_actor_snapshot,updated_at=NOW()`,
            [orderId, input.companyCode, input.voucherNumber, revision, loaded.manifest.fingerprint,
                confirmation ? loaded.manifest.fingerprint : null, confirmation?.kind || null, confirmation ? JSON.stringify(evidence) : null,
                confirmation ? user.id : null, confirmation ? JSON.stringify(snapshot) : null, user.id, JSON.stringify(snapshot)]);
            const after = (await db.query(`SELECT ${referenceColumns} FROM wms_ecount_order_references WHERE order_id=$1`, [orderId])).rows[0];
            const event = confirmation ? 'manually_checked' : 'reference_saved';
            await db.query(`INSERT INTO wms_ecount_reference_history(order_id,revision,event_type,actor_id,actor_snapshot,reason,before_state,after_state,evidence)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [orderId, revision, event, user.id, JSON.stringify(snapshot), input.reason,
                before ? JSON.stringify(referenceView(before)) : null, JSON.stringify(referenceView(after)), JSON.stringify(evidence)]);
            await db.query(`INSERT INTO operation_logs(user_id,order_id,action_type,details,actor_snapshot)
                VALUES($1,$2,$3,$4,$5)`, [user.id, orderId, confirmation ? 'ecount_reference_manually_checked' : 'ecount_reference_saved',
                JSON.stringify({ companyCode: input.companyCode, voucherNumber: input.voucherNumber, revision, fingerprint: loaded.manifest.fingerprint,
                    confirmationKind: confirmation?.kind || null, externalSystemWritten: false, inventoryPosted: false, commandId: input.commandId }), JSON.stringify(snapshot)]);
            await db.query('INSERT INTO wms_ecount_reference_commands(user_id,command_id,order_id,request_hash,reference_revision) VALUES($1,$2,$3,$4,$5)', [user.id, input.commandId, orderId, requestHash, revision]);
            return { ...await output(db, loaded, user), commandId: input.commandId, replayed: false, unchanged: false };
        });
    }
    return { get, save };
}
module.exports = { createEcountReferenceService, confirmationInput, checkConfirmation, parseInput, canManage, normalizedVoucher };
