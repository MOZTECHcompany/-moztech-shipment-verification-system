const { createHash } = require('node:crypto');
const { logOperation } = require('./operationLogService');
const { deferredEvents } = require('../utils/transactionEvents');

const fail = (status, reason, message) => Object.assign(new Error(message), { status, reason, code: 'CLAIM_NOT_APPLIED' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const definitiveReasons = new Set(['NOT_FOUND', 'AMBIGUOUS', 'FORBIDDEN', 'OWNED_BY_OTHER', 'STAGE_COMPLETE', 'INVALID_STAGE', 'BLOCKED']);
const orderProjection = `SELECT o.*, b.voucher_number AS batch_number, p.name AS picker_name, pk.name AS packer_name
    FROM orders o LEFT JOIN warehouse_import_batches b ON b.id=o.import_batch_id
    LEFT JOIN users p ON p.id=o.picker_id LEFT JOIN users pk ON pk.id=o.packer_id WHERE o.id=$1`;

async function transitionClaim({ client, order, user, stage, events, allowContinue = false, method = 'task' }) {
    const admin = ['admin', 'superadmin'].includes(user.role);
    if (!['pick', 'pack'].includes(stage) || (!admin && user.role !== (stage === 'pick' ? 'picker' : 'packer'))) {
        throw fail(403, 'FORBIDDEN', '此角色不可認領該作業');
    }
    if (order.warehouse_hold) throw fail(409, 'BLOCKED', '本批尚未完成預揀核對，請先至預揀作業完成整批查核。');
    const blocked = await client.query("SELECT EXISTS(SELECT 1 FROM order_exceptions WHERE order_id=$1 AND status='open' AND (type='order_change' OR $2='pack')) AS blocked", [order.id, stage]);
    if (blocked.rows[0]?.blocked) throw fail(409, 'BLOCKED', '此訂單存在未核可例外或異動，請先主管核可後再作業。');
    const activeStatus = stage === 'pick' ? 'picking' : 'packing';
    const readyStatus = stage === 'pick' ? 'pending' : 'picked';
    const ownerId = stage === 'pick' ? order.picker_id : order.packer_id;
    let outcome;
    if (allowContinue && order.status === activeStatus && ownerId === user.id) outcome = 'continued';
    else if ((order.status === readyStatus || (stage === 'pick' && order.status === activeStatus && !ownerId)) && (!ownerId || ownerId === user.id)) {
        await client.query(stage === 'pick'
            ? "UPDATE orders SET status='picking', picker_id=$1, updated_at=NOW() WHERE id=$2"
            : "UPDATE orders SET status='packing', packer_id=$1, updated_at=NOW() WHERE id=$2", [user.id, order.id]);
        await logOperation({ userId: user.id, orderId: order.id, operationType: 'claim', details: { new_status: activeStatus, stage, method }, db: client, io: events });
        outcome = 'claimed';
    } else if (ownerId && ownerId !== user.id && [readyStatus, activeStatus].includes(order.status)) {
        throw fail(409, 'OWNED_BY_OTHER', '此工作已由其他人認領，請由原負責人或主管轉交。');
    } else if (order.status === 'completed' || (stage === 'pick' && ['picked', 'packing'].includes(order.status))) {
        throw fail(409, 'STAGE_COMPLETE', '此階段已完成，未變更責任人或商品數量。');
    } else throw fail(409, 'INVALID_STAGE', `目前狀態「${order.status}」不可認領${stage === 'pick' ? '揀貨' : '裝箱'}。`);
    const updated = (await client.query(orderProjection, [order.id])).rows[0];
    if (outcome === 'claimed') events.emit('task_claimed', { ...updated, task_type: stage, current_user: user.name });
    return { order: updated, outcome, stage };
}

function parseClaimCommand(body) {
    if (!body || typeof body !== 'object' || typeof body.barcode !== 'string' || !body.barcode.trim() || body.barcode.trim().length > 255 || /[\u0000-\u001f\u007f]/.test(body.barcode.trim())
        || !['pick', 'pack'].includes(body.stage) || typeof body.commandId !== 'string' || !UUID.test(body.commandId)
        || !Number.isSafeInteger(body.expectedActorId) || body.expectedActorId <= 0
        || ['userId', 'ownerId', 'picker_id', 'packer_id', 'to_user_id'].some(key => body[key] !== undefined)) {
        throw fail(400, 'INVALID_INPUT', '請提供工作條碼、作業階段與有效的認領識別；負責人由登入身分決定。');
    }
    const barcode = body.barcode.trim(), stage = body.stage, commandId = body.commandId.toLowerCase(), expectedActorId = body.expectedActorId;
    // Existing warehouse receipts retain their original hash. ERP-origin
    // commands additionally bind the optimistic revision to the same key.
    const hashInput = [barcode, stage, expectedActorId];
    if (body.expectedRevision !== undefined) {
        if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1) throw fail(400, 'INVALID_INPUT', '作業版本無效');
        hashInput.push(body.expectedRevision);
    }
    return { barcode, stage, commandId, expectedActorId, hash: createHash('sha256').update(JSON.stringify(hashInput)).digest('hex') };
}

function createBarcodeClaimHandlers(pool) {
    const claim = async (req, res) => {
        let command;
        try { command = parseClaimCommand(req.body); }
        catch (error) { return res.status(error.status).json({ code: error.code, reason: error.reason, message: error.message }); }
        if (command.expectedActorId !== req.user.id) return res.status(409).json({ code: 'CLAIM_NOT_APPLIED', reason: 'SESSION_CHANGED', message: '登入帳號已變更，請確認原帳號與待確認的認領結果。' });
        let db, open = false, commitAttempted = false, releaseError;
        const events = deferredEvents(req.app.get('io'));
        try {
            db = await pool.connect(); await db.query('BEGIN'); open = true;
            await db.query("SET LOCAL lock_timeout='1500ms'");
            await db.query("SET LOCAL statement_timeout='8000ms'");
            await db.query("SELECT pg_advisory_xact_lock(hashtext('wms-claim-command'),hashtext($1))", [`${req.user.id}:${command.commandId}`]);
            const receipt = (await db.query('SELECT request_hash,response FROM wms_claim_commands WHERE user_id=$1 AND command_id=$2', [req.user.id, command.commandId])).rows[0];
            if (receipt) {
                if (receipt.request_hash !== command.hash) throw fail(409, 'COMMAND_REUSED', '同一認領識別不可用於不同條碼或階段。');
                await db.query('ROLLBACK'); open = false;
                return res.status(receipt.response.httpStatus || 200).json(receipt.response);
            }
            let response, matchedOrderId = null;
            await db.query('SAVEPOINT claim_business');
            try {
                const matches = await db.query('SELECT * FROM orders WHERE work_barcode=$1 OR voucher_number=$1 ORDER BY id FOR UPDATE', [command.barcode]);
                if (!matches.rows.length) throw fail(404, 'NOT_FOUND', '找不到此工作條碼，請掃描 WMS 工作單條碼。');
                if (matches.rows.length !== 1) throw fail(409, 'AMBIGUOUS', '此條碼對應多張工作單，請重新列印唯一工作條碼。');
                matchedOrderId = matches.rows[0].id;
                if (req.workspaceGuard) await req.workspaceGuard(db, matchedOrderId);
                const result = await transitionClaim({ client: db, order: matches.rows[0], user: req.user, stage: command.stage, events, allowContinue: true, method: 'order_barcode' });
                response = { commandId: command.commandId, orderId: result.order.id, voucherNumber: result.order.voucher_number,
                    workBarcode: result.order.work_barcode || result.order.voucher_number, stage: command.stage,
                    outcome: result.outcome, owner: { id: req.user.id, name: req.user.name }, order: result.order };
            } catch (error) {
                if (error.code !== 'CLAIM_NOT_APPLIED' || !definitiveReasons.has(error.reason)) throw error;
                // Keep the command lock, but undo every business write before making
                // the rejection durable. Late copies of this command cannot claim.
                await db.query('ROLLBACK TO SAVEPOINT claim_business');
                response = { commandId: command.commandId, stage: command.stage, expectedActorId: command.expectedActorId,
                    outcome: 'rejected', definitive: true, code: 'CLAIM_NOT_APPLIED', reason: error.reason,
                    message: error.message, httpStatus: error.status };
            }
            await db.query('RELEASE SAVEPOINT claim_business');
            await db.query('INSERT INTO wms_claim_commands(user_id,command_id,request_hash,order_id,stage,response) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
                [req.user.id, command.commandId, command.hash, matchedOrderId, command.stage, JSON.stringify(response)]);
            commitAttempted = true; await db.query('COMMIT'); open = false;
            if (response.outcome !== 'rejected') events.publish();
            res.status(response.httpStatus || 200).json(response);
        } catch (error) {
            if (open) { try { await db.query('ROLLBACK'); } catch (rollbackError) { releaseError = rollbackError; } }
            if (commitAttempted || releaseError) {
                releaseError ||= error;
                return res.status(503).json({ code: 'CLAIM_RESULT_UNKNOWN', commandId: command.commandId, message: '認領結果待確認，請查詢同一認領識別；不要改用新識別重送。' });
            }
            const busy = ['55P03', '57014'].includes(error.code);
            return res.status(error.status || (busy ? 409 : 500)).json({ code: 'CLAIM_NOT_APPLIED', reason: error.reason || (busy ? 'BUSY' : 'FAILED'), message: error.status ? error.message : '本次認領未套用，請稍後再試。' });
        } finally { db?.release(releaseError); }
    };
    const receipt = async (req, res, next) => {
        if (!UUID.test(req.params.commandId || '')) return res.status(400).json({ code: 'CLAIM_NOT_APPLIED', reason: 'INVALID_INPUT', message: '認領識別無效' });
        if (req.query.expectedActorId !== undefined) {
            const value = req.query.expectedActorId;
            if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) return res.status(400).json({ code: 'CLAIM_NOT_APPLIED', reason: 'INVALID_INPUT', message: '登入者識別無效' });
            if (Number(value) !== req.user.id) return res.status(409).json({ code: 'CLAIM_NOT_APPLIED', reason: 'SESSION_CHANGED', message: '登入帳號已變更，請使用原認領帳號查詢收據。' });
        }
        try {
            const row = (await pool.query('SELECT response FROM wms_claim_commands WHERE user_id=$1 AND command_id=$2', [req.user.id, req.params.commandId])).rows[0];
            res.set('Cache-Control', 'private, no-store');
            if (!row) return res.status(404).json({ code: 'CLAIM_RECEIPT_NOT_FOUND', message: '尚未找到已提交收據；可能仍在處理，這不表示認領已取消。' });
            return res.json(row.response);
        } catch (error) { next(error); }
    };
    return { claim, receipt };
}

module.exports = { transitionClaim, parseClaimCommand, createBarcodeClaimHandlers };
