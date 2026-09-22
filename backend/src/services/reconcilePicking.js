const { readLines, stateToken } = require('./scanSnapshot');
const { getOrderCompletion } = require('../utils/orderCompletion');
const { logOperation } = require('./operationLogService');
const { deferredEvents } = require('../utils/transactionEvents');

// Explicit, audited repair for historical picking orders. Reads stay read-only;
// this command cannot alter quantities, SN states, assignments or terminal states.
function createReconcilePicking(pool) {
    return async (req, res, next) => {
        const { expectedState, reason } = req.body || {};
        if (!/^[1-9]\d{0,9}$/.test(req.params.orderId) ||
            typeof expectedState !== 'string' || !/^[0-9a-f]{64}$/.test(expectedState) ||
            typeof reason !== 'string' || !reason.trim() || reason.length > 2000) {
            return res.status(400).json({ message: '請提供有效訂單、目前狀態識別及修復原因' });
        }
        let db, open = false, releaseError;
        const fail = (code, message) => { throw Object.assign(new Error(message), { status: code }); };
        const events = deferredEvents(req.app.get('io'));
        try {
            db = await pool.connect();
            await db.query('BEGIN'); open = true;
            await db.query("SET LOCAL lock_timeout='3000ms'");
            await db.query("SET LOCAL statement_timeout='10000ms'");
            const order = (await db.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [req.params.orderId])).rows[0];
            if (!order) fail(404, '找不到訂單');
            const { items, instances } = await readLines(db, order.id);
            if (stateToken(order, items, instances) !== expectedState) fail(409, '訂單已變更，請重新核對');
            if (!['picking', 'picked'].includes(order.status)) fail(409, '僅能修復揀貨中的訂單');
            const exceptions = await db.query("SELECT id FROM order_exceptions WHERE order_id = $1 AND status = 'open' LIMIT 1", [order.id]);
            if (exceptions.rowCount) fail(409, '尚有待處理異常，請先完成審核');
            if (!getOrderCompletion(items, instances).allPicked) fail(409, '揀貨數量或 SN 尚未完整，無法轉入待裝箱');
            const changed = order.status === 'picking';
            if (changed) {
                await db.query("UPDATE orders SET status = 'picked', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [order.id]);
                await logOperation({
                    db, io: events, userId: req.user.id, orderId: order.id,
                    operationType: 'picking_completion_reconcile',
                    details: { previousStatus: 'picking', newStatus: 'picked', reason: reason.trim(), expectedState },
                    userName: req.user.name, userRole: req.user.role,
                    voucherNumber: order.voucher_number, customerName: order.customer_name
                });
                events.emit('task_status_changed', { orderId: order.id, newStatus: 'picked' });
            }
            await db.query('COMMIT'); open = false;
            events.publish();
            res.json({ orderId: order.id, status: 'picked', changed });
        } catch (error) {
            next(error);
        } finally {
            if (open) try { await db.query('ROLLBACK'); } catch (error) { releaseError = error; }
            db?.release(releaseError);
        }
    };
}

module.exports = { createReconcilePicking };
