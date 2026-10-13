const express = require('express');
const { pool } = require('../config/database');
const { isWarehouseAdmin } = require('../utils/managementScope');
const { workTypes, actorSnapshot, assertStage, assertWork, requireWarehouseWorker, pauseField,
    assertPauseWork, taipeiWorkDate, defaultStage, failure } = require('../utils/warehouseWork');
const { warehouseTransaction } = require('../services/warehouseTransaction');
const { logOperation } = require('../services/operationLogService');
const { stateToken, readLines } = require('../services/scanSnapshot');
const router = express.Router();

async function currentMode(db, user, date = taipeiWorkDate()) {
    const row = (await db.query(`SELECT m.*, m.assigned_by_snapshot->>'name' AS assigned_by_name
        FROM warehouse_daily_modes m WHERE user_id=$1 AND work_date=$2`, [user.id, date])).rows[0];
    const allowed = workTypes(user);
    return { work_types: allowed, work_date: date, default_stage: defaultStage(user, row?.assigned_stage),
        choice_stage: allowed.includes(row?.choice_stage) ? row.choice_stage : null,
        today_assignment: row?.assigned_stage ? { stage: row.assigned_stage, assigned_by_name: row.assigned_by_name,
            assigned_at: row.assigned_at } : null };
}
router.get('/warehouse/work-mode', async (req, res, next) => {
    try { res.set('Cache-Control', 'private, no-store').json(await currentMode(pool, req.user)); } catch (error) { next(error); }
});
router.put('/warehouse/work-mode', async (req, res, next) => {
    try {
        const stage = assertStage(req.body?.stage);
        assertWork(req.user, stage);
        const date = taipeiWorkDate();
        const result = await warehouseTransaction(pool, req.app.get('io'), async (db, events) => {
            await db.query(`INSERT INTO warehouse_daily_modes(user_id,work_date,choice_stage) VALUES($1,$2,$3)
                ON CONFLICT(user_id,work_date) DO UPDATE SET choice_stage=EXCLUDED.choice_stage,updated_at=NOW()`, [req.user.id, date, stage]);
            await logOperation({ db, io: events, userId: req.user.id, orderId: null, operationType: 'work_mode_selected',
                workType: stage, actor: req.user, details: { stage, work_date: date } });
            return currentMode(db, req.user, date);
        });
        res.json(result);
    } catch (error) { next(error); }
});
router.get('/warehouse/operators', requireWarehouseWorker, async (req, res, next) => {
    try {
        const result = await pool.query(`SELECT u.id,u.name,u.username,u.role,u.management_scope,u.can_pick,u.can_pack,
            m.choice_stage,m.assigned_stage FROM users u
            LEFT JOIN warehouse_daily_modes m ON m.user_id=u.id AND m.work_date=$1 ORDER BY u.id`, [taipeiWorkDate()]);
        res.json({ items: result.rows.map(user => ({ id: user.id, name: user.name, username: user.username,
            role: user.role, management_scope: user.management_scope, work_types: workTypes(user),
            default_stage: defaultStage(user, user.assigned_stage),
            choice_stage: workTypes(user).includes(user.choice_stage) ? user.choice_stage : null,
            today_stage: workTypes(user).includes(user.choice_stage) ? user.choice_stage : defaultStage(user, user.assigned_stage) }))
            .filter(user => user.work_types.length) });
    } catch (error) { next(error); }
});
router.put('/warehouse/operators/:id/today', async (req, res, next) => {
    try {
        if (!isWarehouseAdmin(req.user)) throw failure(403, '僅倉儲主管或系統管理員可以指派今日工作');
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) throw failure(400, '人員編號無效');
        const stage = assertStage(req.body?.stage), date = taipeiWorkDate();
        const result = await warehouseTransaction(pool, req.app.get('io'), async (db, events) => {
            const target = (await db.query('SELECT id,username,name,role,management_scope,can_pick,can_pack FROM users WHERE id=$1 FOR SHARE', [id])).rows[0];
            if (!target) throw failure(404, '找不到作業人員');
            assertWork(target, stage);
            await db.query(`INSERT INTO warehouse_daily_modes(user_id,work_date,assigned_stage,assigned_by,assigned_by_snapshot,assigned_at)
                VALUES($1,$2,$3,$4,$5,NOW()) ON CONFLICT(user_id,work_date) DO UPDATE
                SET assigned_stage=EXCLUDED.assigned_stage,assigned_by=EXCLUDED.assigned_by,
                    assigned_by_snapshot=EXCLUDED.assigned_by_snapshot,assigned_at=NOW(),updated_at=NOW()`,
            [id, date, stage, req.user.id, JSON.stringify(actorSnapshot(req.user))]);
            await logOperation({ db, io: events, userId: req.user.id, orderId: null, operationType: 'work_assigned',
                workType: stage, actor: req.user, details: { target_user_id: id, target_snapshot: actorSnapshot(target), stage, work_date: date } });
            const mode = await currentMode(db, target, date);
            events.emit('work_assignment_changed', { userId: id, actorId: req.user.id, ...mode });
            return { user_id: id, ...mode };
        });
        res.json(result);
    } catch (error) { next(error); }
});
for (const action of ['pause', 'resume']) {
    router.post(`/orders/:orderId/work-${action}`, requireWarehouseWorker, async (req, res, next) => {
        try {
            const stage = assertStage(req.body?.stage), id = Number(req.params.orderId);
            if (!Number.isSafeInteger(id) || id <= 0) throw failure(400, '訂單編號無效');
            const result = await warehouseTransaction(pool, req.app.get('io'), async (db, events) => {
                const order = (await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
                if (!order) throw failure(404, '找不到訂單');
                assertPauseWork(req.user, order, stage);
                const field = pauseField(stage), already = Boolean(order[field]);
                if ((action === 'pause') !== already) {
                    const updated = await db.query(`UPDATE orders SET ${field}=${action === 'pause' ? 'NOW()' : 'NULL'},updated_at=NOW() WHERE id=$1 RETURNING *`, [id]);
                    Object.assign(order, updated.rows[0]);
                    await logOperation({ db, io: events, userId: req.user.id, orderId: id, operationType: `work_${action}`,
                        workType: stage, actor: req.user, details: { stage, paused_at: order[field], owner_id: order[stage === 'pick' ? 'picker_id' : 'packer_id'] } });
                    events.emit('task_work_paused', { orderId: id, stage, paused: action === 'pause', actorId: req.user.id });
                    events.emit('task_status_changed', { orderId: id, newStatus: order.status });
                }
                const { items, instances } = await readLines(db, id);
                return { order, stateToken: stateToken(order, items, instances) };
            });
            res.json(result);
        } catch (error) { next(error); }
    });
}
router.get('/orders/:orderId/handoffs', async (req, res, next) => {
    try {
        const id = Number(req.params.orderId);
        if (!Number.isSafeInteger(id) || id <= 0) throw failure(400, '訂單編號無效');
        const result = await pool.query(`SELECT a.*,a.created_at AT TIME ZONE 'UTC' AS created_at,COALESCE(a.from_snapshot->>'name',f.name) AS from_name,
            COALESCE(a.to_snapshot->>'name',t.name) AS to_name,COALESCE(a.actor_snapshot->>'name',p.name) AS performed_by_name,
            a.actor_snapshot IS NOT NULL AS has_actor_snapshot
            FROM task_assignments a LEFT JOIN users f ON f.id=a.from_user_id LEFT JOIN users t ON t.id=a.to_user_id
            LEFT JOIN users p ON p.id=a.performed_by WHERE a.order_id=$1 ORDER BY a.created_at,a.id LIMIT 200`, [id]);
        res.json({ items: result.rows });
    } catch (error) { next(error); }
});
module.exports = router;
