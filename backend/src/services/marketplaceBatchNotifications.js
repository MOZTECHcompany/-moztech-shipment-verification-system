const { isWarehouseAdmin } = require('../utils/managementScope');

const STAGES = Object.freeze({
    prepared: '待理貨回匯',
    ready_for_print: '可列印預揀單',
});
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
function positiveId(value) {
    if (!/^[1-9]\d{0,9}$/.test(String(value))) return null;
    const id = Number(value);
    return Number.isSafeInteger(id) && id <= 2147483647 ? id : null;
}

async function assertWarehouseRecipient(db, user) {
    const id = positiveId(user?.id);
    if (!id) throw fail(401, 'AUTH_REQUIRED', '請重新登入');
    const current = (await db.query('SELECT id, role, management_scope FROM users WHERE id=$1', [id])).rows[0];
    if (!isWarehouseAdmin(current)) throw fail(403, 'WAREHOUSE_MANAGER_REQUIRED', '僅倉儲主管可查看批次通知');
    return id;
}

// Caller supplies its transaction client and publishes deferred events after COMMIT.
// A notice never creates orders, clears warehouse_hold, or approves a return file.
async function notifyMarketplaceBatch({ db, events, intakeId, actorId, stage }) {
    intakeId = positiveId(intakeId);
    actorId = positiveId(actorId);
    if (!intakeId || !actorId || !Object.hasOwn(STAGES, stage)) throw fail(400, 'INVALID_BATCH_NOTICE', '批次通知資料無效');
    const batch = (await db.query(`SELECT i.id,i.batch_number,i.source_platform,i.source_store,i.archived_at,
        f.erp_confirmed_at,f.printed_at,f.prepick_completed_at
        FROM marketplace_intakes i LEFT JOIN marketplace_warehouse_flows f ON f.intake_id=i.id
        WHERE i.id=$1`, [intakeId])).rows[0];
    if (!batch || batch.archived_at) throw fail(409, 'BATCH_UNAVAILABLE', '批次不存在或已封存');
    if (stage === 'ready_for_print' && !batch.erp_confirmed_at) throw fail(409, 'ERP_RETURN_REQUIRED', '須先完成 ECOUNT 回匯核對');
    const actor = (await db.query('SELECT id,name,username,role,management_scope FROM users WHERE id=$1', [actorId])).rows[0];
    if (!actor) throw fail(401, 'ACTOR_UNAVAILABLE', '操作人員不存在');
    const supervisors = (await db.query(`SELECT id FROM users WHERE role='superadmin'
        OR (role='admin' AND COALESCE(management_scope,'all') IN ('all','warehouse')) ORDER BY id`)).rows.map(row => Number(row.id));
    if (!supervisors.length) throw fail(503, 'WAREHOUSE_MANAGER_UNAVAILABLE', '尚未設定倉儲主管');
    const notice = (await db.query(`INSERT INTO marketplace_batch_notices(intake_id,stage,actor_id,actor_name,actor_role)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(intake_id,stage) DO NOTHING RETURNING id`,
    [intakeId, stage, actorId, actor.name || actor.username || String(actorId), actor.role])).rows[0];
    if (!notice) {
        const existing = (await db.query('SELECT id FROM marketplace_batch_notices WHERE intake_id=$1 AND stage=$2', [intakeId, stage])).rows[0];
        return { noticeId: String(existing.id), intakeId, stage, reused: true };
    }
    const recipients = supervisors.filter(id => id !== actorId);
    await db.query(`INSERT INTO marketplace_batch_notice_recipients(notice_id,user_id)
        SELECT $1,id FROM users WHERE id=ANY($2::int[])`, [notice.id, recipients]);
    const payload = { noticeId: String(notice.id), intakeId, stage, title: STAGES[stage],
        batchNumber: batch.batch_number, platform: batch.source_platform, store: batch.source_store,
        actorId, actorName: actor.name || actor.username || String(actorId), recipientUserIds: recipients,
        href: `/warehouse-intakes/${intakeId}` };
    // Company-wide sockets carry only a refresh signal. The scoped HTTP inbox
    // resolves recipient membership and returns batch details to supervisors.
    events?.emit('marketplace_batch_notice', {});
    events?.emit('warehouse_tasks_changed', { intakeId });
    return { ...payload, reused: false };
}

async function listMarketplaceBatchNotices(db, user) {
    const userId = await assertWarehouseRecipient(db, user);
    const result = await db.query(`SELECT n.id,n.intake_id,n.stage,n.actor_id,n.actor_name,n.actor_role,n.created_at,
        i.batch_number,i.source_platform,i.source_store,COUNT(*) OVER()::int AS total
        FROM marketplace_batch_notice_recipients r JOIN marketplace_batch_notices n ON n.id=r.notice_id
        JOIN marketplace_intakes i ON i.id=n.intake_id
        LEFT JOIN marketplace_warehouse_flows f ON f.intake_id=i.id
        WHERE r.user_id=$1 AND r.seen_at IS NULL AND i.archived_at IS NULL
        AND ((n.stage='prepared' AND f.erp_confirmed_at IS NULL)
            OR (n.stage='ready_for_print' AND f.erp_confirmed_at IS NOT NULL AND f.printed_at IS NULL AND f.prepick_completed_at IS NULL))
        ORDER BY n.id DESC LIMIT 50`, [userId]);
    return { total: Number(result.rows[0]?.total || 0), notices: result.rows.map(row => ({
        noticeId: String(row.id), intakeId: row.intake_id, stage: row.stage, title: STAGES[row.stage],
        batchNumber: row.batch_number, platform: row.source_platform, store: row.source_store,
        actorId: row.actor_id, actorName: row.actor_name, actorRole: row.actor_role, createdAt: row.created_at,
        href: `/warehouse-intakes/${row.intake_id}`,
    })) };
}

async function markMarketplaceBatchNoticeSeen(db, user, noticeId) {
    const userId = await assertWarehouseRecipient(db, user);
    if (!/^[1-9]\d{0,18}$/.test(String(noticeId)) || BigInt(noticeId) > 9223372036854775807n) throw fail(400, 'INVALID_NOTICE_ID', '通知編號無效');
    const seen = (await db.query(`UPDATE marketplace_batch_notice_recipients SET seen_at=COALESCE(seen_at,NOW())
        WHERE notice_id=$1 AND user_id=$2 RETURNING seen_at`, [String(noticeId), userId])).rows[0];
    if (!seen) throw fail(404, 'NOTICE_NOT_FOUND', '找不到此通知');
    return { noticeId: String(noticeId), seenAt: seen.seen_at };
}

module.exports = { STAGES, notifyMarketplaceBatch, listMarketplaceBatchNotices, markMarketplaceBatchNoticeSeen };
