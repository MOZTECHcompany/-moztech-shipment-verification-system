// Notifications are committed with the change. Socket messages only refresh the
// durable inbox; a disconnected workstation can recover them on its next poll.
const {orderChangeNoticeDetails} = require('./orderChangeNoticeDetails');
async function warehouseReviewerIds(db) {
    const rows = await db.query("SELECT id FROM users WHERE role='superadmin' OR (role='admin' AND management_scope IN ('all','warehouse')) ORDER BY id");
    if (!rows.rowCount) throw new Error('No warehouse reviewer available');
    return rows.rows.map(row => row.id);
}

async function notifyOrderChange({ db, events, orderId, actorId, exceptionId, phase, reason, deletion = false, category = 'order', previousStatus, previousProposal }) {
    const order = (await db.query(`SELECT o.*, (SELECT user_id FROM operation_logs WHERE order_id=o.id
        AND action_type='import' ORDER BY created_at DESC,id DESC LIMIT 1) AS imported_by
        FROM orders o WHERE o.id=$1`, [orderId])).rows[0];
    const reviewers = await warehouseReviewerIds(db);
    const exception = exceptionId ? (await db.query('SELECT * FROM order_exceptions WHERE id=$1 AND order_id=$2',[exceptionId,orderId])).rows[0] : null;
    deletion = deletion || exception?.snapshot?.proposal?.action === 'delete_order';
    // Both management teams receive operational changes. Notification membership
    // does not grant warehouse review or scan permissions.
    const managers = (await db.query("SELECT id FROM users WHERE role IN ('admin','superadmin') ORDER BY id")).rows.map(row=>row.id);
    const actor = (await db.query('SELECT name,username,role,management_scope FROM users WHERE id=$1',[actorId])).rows[0];
    const actorName=actor?.name || actor?.username || String(actorId);
    const actorRole=actor?.role==='superadmin'?'最高管理員':actor?.role==='admin'?
        ({orders:'訂單管理員',warehouse:'倉儲管理員',all:'跨部門管理員'}[actor.management_scope] || '管理員'):
        ({picker:'揀貨員',packer:'裝箱員',dispatcher:'拋單員'}[actor?.role] || '操作人員');
    const details=orderChangeNoticeDetails({exception,phase,deletion,previousStatus,previousProposal});
    const recipients = [...new Set([...managers, exception?.created_by, actorId, order.imported_by, order.picker_id, order.packer_id].filter(Boolean))];
    const labels = { requested:'待審核', approved:'已核准', rejected:'已駁回', resolved:'已結案', voided:'已作廢', sn_replaced:'SN 已更換' };
    const title = `${deletion ? '刪除訂單' : category === 'exception' ? '例外處理' : '訂單異動'}${labels[phase] || phase}`;
    const instruction = phase === 'requested' ? (category === 'exception' ? '請確認例外處理內容，裝箱須等待主管審核。' : '揀貨、裝箱暫停，等待主管審核。')
        : deletion && phase === 'approved' || phase === 'voided' ? '請停止出貨；訂單與作業紀錄保留。'
        : '請重新核對訂單內容與作業進度。';
    const detailText=details.lines.join('\n');
    const content = `【${title}】訂單 ${order.voucher_number}\n操作人：${actorName}（${actorRole}）\n${reason || ''}\n${details.heading}\n${detailText.length>4000?detailText.slice(0,4000)+'\n完整內容請查看異動申請':detailText}\n${instruction}`;
    const comment = (await db.query(`INSERT INTO task_comments(order_id,user_id,content,priority)
        VALUES($1,$2,$3,'urgent') RETURNING id`, [orderId, actorId, content])).rows[0];
    await db.query(`INSERT INTO task_mentions(comment_id,mentioned_user_id)
        SELECT $1,id FROM users WHERE id=ANY($2::int[])`, [comment.id, recipients]);
    events.emit('new_comment', {orderId:Number(orderId),commentId:comment.id,userId:actorId,content,priority:'urgent'});
    for (const userId of recipients) events.emit('new_mention', {userId,orderId:Number(orderId),commentId:comment.id,content,priority:'urgent'});
    const payload = {orderId:Number(orderId),voucherNumber:order.voucher_number,exceptionId:exceptionId ? Number(exceptionId) : undefined,phase,title,
        message:instruction,reason:reason || '',deletion,category,actorId,actorName,actorRole,details};
    const notice = (await db.query(`INSERT INTO order_change_notices(order_id,actor_id,payload)
        VALUES($1,$2,$3) RETURNING id`,[orderId,actorId,JSON.stringify(payload)])).rows[0];
    await db.query(`INSERT INTO order_change_notice_recipients(notice_id,user_id)
        SELECT $1,id FROM users WHERE id=ANY($2::int[]) AND id<>$3`,[notice.id,recipients,actorId]);
    events.emit('order_change_notice', {...payload,noticeId:notice.id,recipientUserIds:recipients,reviewerIds:reviewers});
}
module.exports = { warehouseReviewerIds, notifyOrderChange };
