const { logOperation } = require('./operationLogService');
const { deferredEvents } = require('../utils/transactionEvents');
const {isWarehouseAdmin} = require('../utils/managementScope');
const logger = require('../utils/logger');
const { validateOrderChangeProposal, applyOrderChangeProposal } = require('./orderChangeService');
const { notifyOrderChange } = require('./orderChangeNotifications');

// A deletion is an order-change proposal. Existing scan/claim guards therefore
// pause work while it is open, without changing quantities or removing history.
const DELETE_ACTION = 'delete_order';
const isDeletionRequest = row => row?.type === 'order_change' && row?.snapshot?.proposal?.action === DELETE_ACTION;
const fail = (status, message) => Object.assign(new Error(message), { status });

async function transact(pool, io, work) {
    const db = await pool.connect();
    const events = deferredEvents(io);
    let open = false, commitAttempted = false, releaseError;
    try {
        await db.query('BEGIN'); open = true;
        await db.query("SET LOCAL lock_timeout = '5s'");
        const result = await work(db, events);
        commitAttempted = true;
        await db.query('COMMIT'); open = false;
        events.publish();
        return result;
    } catch (error) {
        if (open) try { await db.query('ROLLBACK'); } catch (e) { releaseError = e; }
        if (commitAttempted || releaseError) {
            releaseError ||= error;
            throw fail(503, '審核結果尚未確認，請重新整理訂單核對，勿重複送出。');
        }
        if (error.code === '55P03') throw fail(409, '訂單作業中，請稍候再試');
        throw error;
    } finally { db.release(releaseError); }
}

async function requestChange({ pool, io, orderId, user, reason, proposal, requestId }) {
    const deletion = proposal?.action === DELETE_ACTION;
    let validated;
    if (!deletion) {
        validated = validateOrderChangeProposal(proposal);
        if (!validated.ok) throw fail(400, validated.message);
    }
    if (!(deletion ? ['dispatcher','admin','superadmin'] : ['dispatcher','admin','superadmin','picker','packer']).includes(user.role)) throw fail(403, '此角色不可申請訂單異動');
    if (!/^[1-9]\d{0,9}$/.test(String(orderId))) throw fail(400, '訂單 ID 無效');
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 2000) throw fail(400, '請填寫異動原因（最多 2000 字）');
    reason = reason.trim();
    return transact(pool, io, async (db, events) => {
        const order = (await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
        if (!order) throw fail(404, '找不到訂單');
        if (!deletion && order.document_type && order.document_type!=='shipment') throw fail(409, '此理貨單含 ERP 負數數量，請在 ERP 修正後匯入新的理貨單，不可直接改動品項數量');
        if (user.role === 'dispatcher') {
            const importer = (await db.query("SELECT user_id FROM operation_logs WHERE order_id=$1 AND action_type='import' ORDER BY created_at DESC,id DESC LIMIT 1", [orderId])).rows[0];
            if (Number(importer?.user_id) !== Number(user.id)) throw fail(403, '僅可申請自己拋單的訂單異動');
        }
        if (order.status === 'voided' || (deletion && order.status === 'completed')) throw fail(409, '已完成或已作廢的訂單不可申請刪除');
        const pending = await db.query("SELECT id FROM order_exceptions WHERE order_id=$1 AND type='order_change' AND status='open'", [orderId]);
        if (pending.rowCount) throw fail(409, '此訂單已有待審核異動，請先完成審核');
        const progress = (await db.query(`SELECT COALESCE(SUM(quantity),0)::int AS quantity,
            COALESCE(SUM(CASE WHEN sn.n>0 THEN sn.picked ELSE oi.picked_quantity END),0)::int AS picked,
            COALESCE(SUM(CASE WHEN sn.n>0 THEN sn.packed ELSE oi.packed_quantity END),0)::int AS packed
            FROM order_items oi LEFT JOIN LATERAL (SELECT COUNT(*) AS n,COUNT(*) FILTER(WHERE status IN ('picked','packed')) AS picked,
            COUNT(*) FILTER(WHERE status='packed') AS packed FROM order_item_instances WHERE order_item_id=oi.id) sn ON TRUE WHERE oi.order_id=$1`, [orderId])).rows[0];
        const baselineItems = (await db.query('SELECT barcode,SUM(quantity)::int AS quantity FROM order_items WHERE order_id=$1 GROUP BY barcode',[orderId])).rows;
        const snapshot = { baselineItems, proposal: { ...(deletion ? { action:DELETE_ACTION,note:reason } : validated.value), proposedBy:user.id,proposedAt:new Date().toISOString() },
            previousStatus: order.status, pickerId: order.picker_id, packerId: order.packer_id, progress, requestId };
        const item = (await db.query(`INSERT INTO order_exceptions(order_id,type,status,reason_code,reason_text,created_by,snapshot)
            VALUES($1,'order_change','open',$5,$2,$3,$4::jsonb) RETURNING id,status`, [orderId, reason, user.id, JSON.stringify(snapshot),deletion ? DELETE_ACTION : null])).rows[0];
        await logOperation({ userId:user.id,orderId,operationType:deletion ? 'order_delete_requested' : 'exception_create',db,io:events,
            details:{exceptionId:item.id,type:'order_change',status:'open',reason,previousStatus:order.status,progress,requestId} });
        await notifyOrderChange({db,events,orderId,actorId:user.id,exceptionId:item.id,phase:'requested',reason,deletion});
        events.emit('order_exception_changed', { orderId: order.id, exceptionId: item.id, action: 'created', type: 'order_change', proposalAction: deletion ? DELETE_ACTION : 'change_items', status: 'open', voucherNumber: order.voucher_number });
        events.emit('order_deletion_changed', { orderId: order.id, pending: true });
        return {message:deletion ? '刪除申請已送出，等待主管審核；訂單與作業紀錄已保留' : '異動申請已送出，等待主管審核',id:item.id,item};
    });
}

async function reviewChange({ pool, io, orderId, exceptionId, user, decision, note, requestId }) {
    if (!isWarehouseAdmin(user)) throw fail(403, '僅倉儲管理員可審核異動申請');
    if (!['approve','reject'].includes(decision)) throw fail(400, '審核動作無效');
    const reviewNote = typeof note === 'string' ? note.trim() : '';
    if (reviewNote.length > 2000 || (decision === 'reject' && !reviewNote)) throw fail(400, '請填寫駁回原因或有效審核備註（最多 2000 字）');
    return transact(pool, io, async (db, events) => {
        // Same lock order as scan and request: order first, then the proposal.
        const order = (await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [orderId])).rows[0];
        const row = (await db.query('SELECT * FROM order_exceptions WHERE id=$1 AND order_id=$2 FOR UPDATE', [exceptionId, orderId])).rows[0];
        if (!order || row?.type !== 'order_change') throw fail(404, '找不到異動申請');
        const deletion = isDeletionRequest(row);
        if (row.status !== 'open') throw fail(409, '此異動申請已審核，請重新整理');
        if (decision==='approve' && !deletion && order.document_type && order.document_type!=='shipment') throw fail(409, '此理貨單含 ERP 負數數量，請在 ERP 修正後匯入新的理貨單，不可直接改動品項數量');
        if (decision === 'approve' && (order.status === 'voided' || (deletion && order.status === 'completed'))) throw fail(409, '訂單狀態已變更，請駁回此申請後重新確認');
        let item;
        if (decision === 'approve' && !deletion) {
            const applyResult = await applyOrderChangeProposal({client:db,orderId,proposal:row.snapshot.proposal,actorUserId:user.id});
            item = (await db.query(`UPDATE order_exceptions SET status='ack',ack_by=$1,ack_at=NOW(),ack_note=$2,
                snapshot=jsonb_set(snapshot,'{applyResult}',$3::jsonb,true) WHERE id=$4 RETURNING id,status`,[user.id,reviewNote || null,JSON.stringify(applyResult),exceptionId])).rows[0];
            await logOperation({userId:user.id,orderId,operationType:'order_change_ack',db,io:events,details:{exceptionId:row.id,applyResult,note:reviewNote,requestId}});
            events.emit('task_status_changed',{orderId:order.id,newStatus:applyResult.newStatus});
        } else if (decision === 'approve') {
            await db.query("UPDATE orders SET status='voided',void_reason=$2,updated_at=NOW() WHERE id=$1", [orderId, row.reason_text]);
            item = (await db.query(`UPDATE order_exceptions SET status='resolved',ack_by=$1,ack_at=NOW(),ack_note=$2,
                resolved_by=$1,resolved_at=NOW(),resolution_action='void',resolution_note=$2 WHERE id=$3 RETURNING id,status`, [user.id, reviewNote || null, exceptionId])).rows[0];
            await logOperation({ userId: user.id, orderId, operationType: 'void', db, io: events,
                details: { source: 'approved_deletion', exceptionId: row.id, requestedBy: row.created_by, reason: row.reason_text, note: reviewNote, previousStatus: order.status, requestId } });
            events.emit('task_status_changed', { orderId: order.id, newStatus: 'voided' });
        } else {
            item = (await db.query(`UPDATE order_exceptions SET status='rejected',rejected_by=$1,rejected_at=NOW(),rejected_note=$2
                WHERE id=$3 RETURNING id,status`, [user.id, reviewNote, exceptionId])).rows[0];
            await logOperation({ userId: user.id, orderId, operationType: deletion ? 'order_delete_rejected' : 'order_change_reject', db, io: events,
                details: { exceptionId: row.id, requestedBy: row.created_by, reason: row.reason_text, note: reviewNote, requestId } });
        }
        await notifyOrderChange({db,events,orderId,actorId:user.id,exceptionId:row.id,phase:decision === 'approve' ? 'approved' : 'rejected',reason:reviewNote || row.reason_text,deletion});
        events.emit('order_exception_changed', { orderId: order.id, exceptionId: row.id, action: decision === 'approve' ? (deletion ? 'resolved' : 'acked') : 'rejected', type: 'order_change', proposalAction: deletion ? DELETE_ACTION : 'change_items' });
        events.emit('order_deletion_changed', { orderId: order.id, pending: false });
        return { message: decision === 'approve' ? (deletion ? '刪除申請已核准，訂單已作廢並保留完整紀錄' : '異動已核准並套用') : '異動申請已駁回，可繼續原作業', item };
    });
}

function sendError(res, error) {
    if (!error.status) logger.error('異動審核交易失敗', { message: error.message });
    return res.status(error.status || 500).json({ message: error.status ? error.message : '異動審核失敗，請重新整理後再試' });
}
const requestDeletion = args => requestChange({...args,proposal:{action:DELETE_ACTION}});
const deletionRequestHandler = pool => async (req, res) => {
    try { res.status(202).json(await requestDeletion({ pool, io: req.app.get('io'), orderId: req.params.orderId, user: req.user,
        reason: req.body?.reason ?? req.body?.reasonText, requestId: req.requestId })); }
    catch (error) { sendError(res, error); }
};
const deletionReviewMiddleware = (pool, decision) => async (req, res, next) => {
    try {
        const row = (await pool.query('SELECT type,snapshot FROM order_exceptions WHERE id=$1 AND order_id=$2', [req.params.exceptionId,req.params.orderId])).rows[0];
        if (row?.type !== 'order_change') return next();
        if (!decision) throw fail(409, '異動申請只能由主管核准或駁回，不可變更處理內容');
        res.json(await reviewChange({ pool, io:req.app.get('io'), orderId:req.params.orderId, exceptionId:req.params.exceptionId,
            user:req.user, decision, note:req.body?.note, requestId:req.requestId }));
    } catch(error) { sendError(res,error); }
};
async function resolveException({pool,io,orderId,exceptionId,user,action,note,requestId}) {
    if (!isWarehouseAdmin(user)) throw fail(403,'僅倉儲管理員可結案例外');
    return transact(pool,io,async(db,events)=>{
        await db.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE',[orderId]);
        const row=(await db.query('SELECT * FROM order_exceptions WHERE id=$1 AND order_id=$2 FOR UPDATE',[exceptionId,orderId])).rows[0];
        if(!row) throw fail(404,'找不到例外事件');
        if(row.status!=='ack') throw fail(409,'例外必須先核可才能結案');
        const item=(await db.query(`UPDATE order_exceptions SET status='resolved',resolved_by=$1,resolved_at=NOW(),resolution_action=$2,resolution_note=$3
            WHERE id=$4 RETURNING id,type,status,resolved_at`,[user.id,action,note,exceptionId])).rows[0];
        await logOperation({db,io:events,userId:user.id,orderId,operationType:'exception_resolve',details:{exceptionId:row.id,status:'resolved',resolutionAction:action,note,requestId}});
        await notifyOrderChange({db,events,orderId,actorId:user.id,exceptionId:row.id,phase:'resolved',reason:note || row.reason_text,category:row.type==='order_change'?'order':'exception'});
        events.emit('order_exception_changed',{orderId:Number(orderId),exceptionId:row.id,action:'resolved'});
        return {message:'例外已結案',item};
    });
}
module.exports = { DELETE_ACTION, isDeletionRequest, requestChange, requestDeletion, reviewChange, resolveException, deletionRequestHandler, deletionReviewMiddleware };
