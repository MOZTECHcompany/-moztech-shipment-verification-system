// Notifications are committed with the change. Socket messages only refresh the
// durable inbox; a disconnected workstation can recover them on its next poll.
async function warehouseReviewerIds(db) {
    const rows = await db.query("SELECT id FROM users WHERE role='superadmin' OR (role='admin' AND management_scope IN ('all','warehouse')) ORDER BY id");
    if (!rows.rowCount) throw new Error('No warehouse reviewer available');
    return rows.rows.map(row => row.id);
}

async function notifyOrderChange({ db, events, orderId, actorId, exceptionId, phase, reason, deletion = false, category = 'order' }) {
    const order = (await db.query(`SELECT o.*, (SELECT user_id FROM operation_logs WHERE order_id=o.id
        AND action_type='import' ORDER BY created_at DESC,id DESC LIMIT 1) AS imported_by
        FROM orders o WHERE o.id=$1`, [orderId])).rows[0];
    const reviewers = await warehouseReviewerIds(db);
    const requester = exceptionId ? (await db.query('SELECT created_by FROM order_exceptions WHERE id=$1 AND order_id=$2',[exceptionId,orderId])).rows[0]?.created_by : null;
    const recipients = [...new Set([...reviewers, requester, actorId, order.imported_by, order.picker_id, order.packer_id].filter(Boolean))];
    const labels = { requested:'待審核', approved:'已核准', rejected:'已駁回', resolved:'已結案', voided:'已作廢', sn_replaced:'SN 已更換' };
    const title = `${deletion ? '刪除訂單' : category === 'exception' ? '例外處理' : '訂單異動'}${labels[phase] || phase}`;
    const instruction = phase === 'requested' ? (category === 'exception' ? '請確認例外處理內容，裝箱須等待主管審核。' : '揀貨、裝箱暫停，等待主管審核。')
        : deletion && phase === 'approved' || phase === 'voided' ? '請停止出貨；訂單與作業紀錄保留。'
        : '請重新核對訂單內容與作業進度。';
    const content = `【${title}】訂單 ${order.voucher_number}\n${reason || ''}\n${instruction}`;
    const comment = (await db.query(`INSERT INTO task_comments(order_id,user_id,content,priority)
        VALUES($1,$2,$3,'urgent') RETURNING id`, [orderId, actorId, content])).rows[0];
    await db.query(`INSERT INTO task_mentions(comment_id,mentioned_user_id)
        SELECT $1,id FROM users WHERE id=ANY($2::int[])`, [comment.id, recipients]);
    events.emit('new_comment', {orderId:Number(orderId),commentId:comment.id,userId:actorId,content,priority:'urgent'});
    for (const userId of recipients) events.emit('new_mention', {userId,orderId:Number(orderId),commentId:comment.id,content,priority:'urgent'});
    events.emit('order_change_notice', {orderId:Number(orderId),voucherNumber:order.voucher_number,exceptionId,phase,title,
        message:instruction,recipientUserIds:recipients,actorId,reviewerIds:reviewers});
}
module.exports = { warehouseReviewerIds, notifyOrderChange };
