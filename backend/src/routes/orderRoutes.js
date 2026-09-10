// backend/src/routes/orderRoutes.js
// 訂單操作相關端點（需先通過 authenticateToken）

const express = require('express');
const multer = require('multer');
const { IMPORT_LIMITS, parseOrderImport } = require('../services/orderImportParser');
const rateLimit = require('express-rate-limit');
const { pool } = require('../config/database');
const logger = require('../utils/logger');
const { authorizeAdmin, authorizeRoles } = require('../middleware/auth');
const { logOperation } = require('../services/operationLogService');
const { normalizeSerialScanInput } = require('../utils/serialNumber');
const { getOrderCompletion, canAutoComplete } = require('../utils/orderCompletion');

const router = express.Router();

const scanPerfWindow = [];
const SCAN_PERF_WINDOW_SIZE = 300;
const SCAN_PERF_LOG_EVERY = 30;

function percentile(values, p) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    const safeIndex = Math.max(0, Math.min(index, sorted.length - 1));
    return sorted[safeIndex];
}

function recordScanPerf(durationMs, meta = {}) {
    scanPerfWindow.push(durationMs);
    if (scanPerfWindow.length > SCAN_PERF_WINDOW_SIZE) {
        scanPerfWindow.shift();
    }

    const p50 = percentile(scanPerfWindow, 50);
    const p95 = percentile(scanPerfWindow, 95);
    const sampleCount = scanPerfWindow.length;
    const baseMeta = {
        sampleCount,
        durationMs,
        p50,
        p95,
        ...meta
    };

    if (durationMs >= 1500) {
        logger.warn('[scan_perf] slow_scan_detected', baseMeta);
        return;
    }

    if (sampleCount % SCAN_PERF_LOG_EVERY === 0) {
        logger.info('[scan_perf] rolling_latency', baseMeta);
    }
}

async function hasOpenExceptions(db, orderId) {
    try {
        const result = await db.query(
            `SELECT EXISTS(
                SELECT 1
                FROM order_exceptions
                WHERE order_id = $1 AND status = 'open'
            ) AS has_open`,
            [orderId]
        );
        return !!result.rows[0]?.has_open;
    } catch (err) {
        // 若尚未套用 migration，避免擋住既有流程
        if (err && (err.code === '42P01' || /order_exceptions/i.test(err.message || ''))) {
            return false;
        }
        throw err;
    }
}

async function hasOpenOrderChange(db, orderId) {
    try {
        const result = await db.query(
            `SELECT EXISTS(
                SELECT 1
                FROM order_exceptions
                WHERE order_id = $1 AND status = 'open' AND type = 'order_change'
            ) AS has_open`,
            [orderId]
        );
        return !!result.rows[0]?.has_open;
    } catch (err) {
        // 若尚未套用 migration，避免擋住既有流程
        if (err && (err.code === '42P01' || /order_exceptions/i.test(err.message || ''))) {
            return false;
        }
        throw err;
    }
}

// Transactional events must never advertise data that can still roll back.
function deferredEvents(io) {
    const events = [];
    return {
        emit: (name, payload) => events.push([name, payload]),
        publish: () => {
            for (const [name, payload] of events) {
                try { io?.emit(name, payload); }
                catch (error) { logger.warn('已提交作業的即時通知發送失敗:', { event: name, message: error.message }); }
            }
        }
    };
}

const importUpload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: IMPORT_LIMITS.fileBytes, fields: 0 },
    fileFilter: (req, file, cb) => {
        if (/\.(xlsx|xls|csv)$/i.test(file.originalname || '')) return cb(null, true);
        cb(new Error('不支援的檔案格式，請上傳 .xlsx / .xls / .csv'));
    }
}).single('orderFile');

function uploadImport(req, res, next) {
    importUpload(req, res, error => {
        if (!error) return next();
        const tooLarge = error.code === 'LIMIT_FILE_SIZE';
        return res.status(tooLarge ? 413 : 400).json({
            code: 'IMPORT_NOT_APPLIED',
            message: tooLarge ? '檔案不可超過 10 MiB，未建立訂單'
                : ['LIMIT_UNEXPECTED_FILE', 'LIMIT_FILE_COUNT'].includes(error.code) ? '請一次上傳一個訂單檔案'
                    : error.code === 'LIMIT_FIELD_COUNT' ? '請只上傳訂單檔案，不要附加其他欄位' : error.message
        });
    });
}

const importLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => {
        // 匯入是已登入操作，優先按 userId 限流，避免同 IP 共享影響
        const userId = req.user?.id ? String(req.user.id) : '';
        return userId ? `user:${userId}` : `ip:${req.ip}`;
    },
    handler: (req, res) => {
        return res.status(429).json({ message: '匯入嘗試次數過多，請稍後再試' });
    }
});

// POST /api/orders/batch-claim
router.post('/orders/batch-claim', async (req, res) => {
    try {
        const { orderIds } = req.body;
        const userId = req.user.id;
        const role = req.user.role;
        const isAdminLike = role === 'admin' || role === 'superadmin';

        if (!(role === 'picker' || isAdminLike)) {
            return res.status(403).json({ message: '權限不足' });
        }

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return res.status(400).json({ message: '請提供訂單ID列表' });
        }

                const result = await pool.query(
                        `UPDATE orders 
                         SET picker_id = $1, status = 'picking', updated_at = NOW()
                         WHERE id = ANY($2)
                             AND (
                                 status = 'pending'
                                 OR (status = 'picking' AND picker_id IS NULL)
                             )
                         RETURNING id, voucher_number`,
                        [userId, orderIds]
                );

        res.json({ 
            message: `成功認領 ${result.rows.length} 個訂單`,
            orders: result.rows
        });
    } catch (error) {
        logger.error('[/api/orders/batch-claim] 批次認領失敗:', error);
        res.status(500).json({ message: '批次認領失敗' });
    }
});

// POST /api/orders/batch/claim
router.post('/orders/batch/claim', async (req, res) => {
    const { orderIds } = req.body;
    const { id: userId, role } = req.user;
    const isAdminLike = role === 'admin' || role === 'superadmin';
    const io = req.app.get('io');

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ message: '請提供訂單 ID 列表' });
    }

    try {
        const results = { success: [], failed: [] };

        for (const orderId of orderIds) {
            try {
                const result = await pool.query(
                    'SELECT id, status, picker_id FROM orders WHERE id = $1',
                    [orderId]
                );

                if (result.rows.length === 0) {
                    results.failed.push({ orderId, reason: '訂單不存在' });
                    continue;
                }

                const order = result.rows[0];

                if ((role === 'picker' || isAdminLike) && (order.status === 'pending' || (order.status === 'picking' && !order.picker_id))) {
                    await pool.query(
                        "UPDATE orders SET status = 'picking', picker_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
                        [userId, orderId]
                    );
                    await logOperation({
                        userId,
                        orderId,
                        operationType: 'claim',
                        details: { previous_status: 'pending', new_status: 'picking' },
                        io
                    });
                    io?.emit('task_status_changed', { orderId, newStatus: 'picking' });
                    results.success.push(orderId);
                } else if (order.status === 'picking' && (role === 'packer' || isAdminLike)) {
                    // 若存在未核可例外，禁止進入裝箱流程
                    const hasOpen = await hasOpenExceptions(pool, orderId);
                    if (hasOpen) {
                        results.failed.push({ orderId, reason: '此訂單存在未核可例外，請先主管核可後再裝箱' });
                        continue;
                    }
                    await pool.query(
                        "UPDATE orders SET status = 'packing', packer_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
                        [userId, orderId]
                    );
                    await logOperation({
                        userId,
                        orderId,
                        operationType: 'claim',
                        details: { previous_status: 'picking', new_status: 'packing' },
                        io
                    });
                    io?.emit('task_status_changed', { orderId, newStatus: 'packing' });
                    results.success.push(orderId);
                } else {
                    results.failed.push({ orderId, reason: '訂單狀態不符或權限不足' });
                }
            } catch (error) {
                results.failed.push({ orderId, reason: error.message });
            }
        }

        res.json({
            message: `批次認領完成: 成功 ${results.success.length} 筆, 失敗 ${results.failed.length} 筆`,
            results
        });
    } catch (error) {
        logger.error('[/api/orders/batch/claim] 失敗:', error);
        res.status(500).json({ message: '批次認領失敗' });
    }
});

// POST /api/orders/:orderId/claim
router.post('/orders/:orderId/claim', async (req, res, next) => {
    const { orderId } = req.params;
    const { id: userId, role } = req.user;
    const isAdminLike = role === 'admin' || role === 'superadmin';
    const io = req.app.get('io');
    logger.debug(`[/orders/${orderId}/claim] 使用者嘗試認領任務 - userId: ${userId}, role: ${role}`);

    if (role === 'dispatcher') {
        return res.status(403).json({ message: '拋單員不可認領任務' });
    }

    let client;
    let transactionOpen = false;
    let commitAttempted = false;
    const events = deferredEvents(io);
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        transactionOpen = true;
        const orderResult = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
        if (orderResult.rows.length === 0) {
            logger.warn(`[/orders/${orderId}/claim] 錯誤: 找不到訂單`);
            await client.query('ROLLBACK');
            return res.status(404).json({ message: '找不到該訂單' });
        }
        const order = orderResult.rows[0];

        // 訂單異動審核中：禁止認領/作業
        const hasPendingChange = await hasOpenOrderChange(client, orderId);
        if (hasPendingChange) {
            await client.query('ROLLBACK');
            return res.status(409).json({ message: '此訂單異動審核中，請先主管核可後再作業。' });
        }
        logger.debug(`[/orders/${orderId}/claim] 訂單狀態: ${order.status}, picker_id: ${order.picker_id}, packer_id: ${order.packer_id}`);
        let newStatus = '', task_type = '';
        if ((role === 'picker' || isAdminLike) && (order.status === 'pending' || (order.status === 'picking' && !order.picker_id))) {
            newStatus = 'picking'; task_type = 'pick';
            await client.query('UPDATE orders SET status = $1, picker_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [newStatus, userId, orderId]);
            logger.info(`[/orders/${orderId}/claim] 成功認領揀貨任務`);
        } else if ((role === 'packer' || isAdminLike) && order.status === 'picked') {
            const hasOpen = await hasOpenExceptions(client, orderId);
            if (hasOpen) {
                await client.query('ROLLBACK');
                return res.status(409).json({ message: '此訂單存在未核可例外，請先主管核可（ack）後再認領裝箱任務。' });
            }
            newStatus = 'packing'; task_type = 'pack';
            await client.query('UPDATE orders SET status = $1, packer_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [newStatus, userId, orderId]);
            logger.info(`[/orders/${orderId}/claim] 成功認領裝箱任務`);
        } else {
            logger.warn(`[/orders/${orderId}/claim] 認領失敗 - 角色: ${role}, 訂單狀態: ${order.status}`);
            await client.query('ROLLBACK');
            return res.status(400).json({ message: `無法認領該任務，訂單狀態為「${order.status}」，可能已被他人處理。` });
        }
        await logOperation({ userId, orderId, operationType: 'claim', details: { new_status: newStatus }, io: events, db: client });
        const updatedOrder = (await client.query('SELECT o.*, u.name as current_user FROM orders o LEFT JOIN users u ON (CASE WHEN $1 = \'pick\' THEN o.picker_id WHEN $1 = \'pack\' THEN o.packer_id END) = u.id WHERE o.id = $2', [task_type, orderId])).rows[0];
        events.emit('task_claimed', { ...updatedOrder, task_type });
        commitAttempted = true;
        await client.query('COMMIT');
        transactionOpen = false;
        events.publish();
        res.status(200).json({ message: '任務認領成功' });
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('ROLLBACK'); }
            catch (rollbackError) { logger.warn('認領交易回復失敗:', rollbackError.message); }
        }
        logger.error(`[/orders/${orderId}/claim] 發生錯誤:`, error);
        if (commitAttempted) {
            return res.status(503).json({ code: 'CLAIM_RESULT_UNKNOWN', message: '認領結果尚未確認，請重新載入任務列表核對，請勿直接重試。' });
        }
        next(error);
    } finally {
        client?.release();
    }
});

// GET /api/orders/:orderId
router.get('/orders/:orderId', async (req, res, next) => {
    const { orderId } = req.params;
    const events = deferredEvents(req.app.get('io'));
    let client;
    let transactionOpen = false;
    let releaseError;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        transactionOpen = true;
        await client.query("SET LOCAL lock_timeout = '1500ms'");
        await client.query("SET LOCAL statement_timeout = '8000ms'");
        // Scans, claims and order changes lock this same row before changing items.
        // Lock only o because users are on nullable sides of the LEFT JOINs.
        const orderResult = await client.query(
            'SELECT o.*, p.name as picker_name, pk.name as packer_name FROM orders o LEFT JOIN users p ON o.picker_id = p.id LEFT JOIN users pk ON o.packer_id = pk.id WHERE o.id = $1 FOR UPDATE OF o',
            [orderId]
        );
        if (orderResult.rows.length === 0) {
            await client.query('ROLLBACK');
            transactionOpen = false;
            return res.status(404).json({ message: '找不到訂單' });
        }
        const order = orderResult.rows[0];
        const itemsResult = await client.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
        const instancesResult = await client.query(
            'SELECT i.* FROM order_item_instances i JOIN order_items oi ON i.order_item_id = oi.id WHERE oi.order_id = $1 ORDER BY i.id',
            [orderId]
        );

        // Keep the detail view and scan response on the same completion rules.
        const { allPicked, allPacked } = getOrderCompletion(itemsResult.rows, instancesResult.rows);
        let statusChanged = false;
        let updateAttempted = false;
        let newStatus = order.status;

        // Empty orders, inconsistent SN counts and terminal statuses cannot auto-complete.
        if (allPicked && allPacked && canAutoComplete(order.status)) {
            const hasOpen = await hasOpenExceptions(client, orderId);
            if (!hasOpen) {
                updateAttempted = true;
                const updated = await client.query(
                    "UPDATE orders SET status = 'completed', completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = $2",
                    [orderId, order.status]
                );
                statusChanged = updated.rowCount > 0;
                if (statusChanged) newStatus = 'completed';
            }
        } else if (allPicked && (order.status === 'picking' || order.status === 'pending')) {
            updateAttempted = true;
            const updated = await client.query(
                "UPDATE orders SET status = 'picked', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = $2",
                [orderId, order.status]
            );
            statusChanged = updated.rowCount > 0;
            if (statusChanged) newStatus = 'picked';
        }

        const responseOrder = updateAttempted
            ? (await client.query(
                'SELECT o.*, p.name as picker_name, pk.name as packer_name FROM orders o LEFT JOIN users p ON o.picker_id = p.id LEFT JOIN users pk ON o.packer_id = pk.id WHERE o.id = $1',
                [orderId]
            )).rows[0]
            : order;
        if (statusChanged) events.emit('task_status_changed', { orderId: parseInt(orderId, 10), newStatus });
        await client.query('COMMIT');
        transactionOpen = false;
        events.publish();
        return res.json({ order: responseOrder, items: itemsResult.rows, instances: instancesResult.rows });
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('ROLLBACK'); }
            catch (rollbackError) {
                releaseError = rollbackError;
                logger.warn('訂單讀取交易回復失敗:', rollbackError.message);
            }
        }
        if (error?.code === '55P03' || /lock timeout|statement timeout|canceling statement/i.test(error?.message || '')) {
            error.status = 409;
            error.message = '訂單作業中，請稍候重新整理';
        }
        next(error);
    } finally {
        client?.release(releaseError);
    }
});

// PATCH /api/orders/:orderId/void
router.patch('/orders/:orderId/void', authorizeAdmin, async (req, res) => {
    const { orderId } = req.params;
    const { reason } = req.body;
    const io = req.app.get('io');
    const result = await pool.query("UPDATE orders SET status = 'voided', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING voucher_number", [orderId]);
    if (result.rowCount === 0) return res.status(404).json({ message: '找不到要作廢的訂單' });
    await logOperation({ userId: req.user.id, orderId, operationType: 'void', details: { reason }, io });
    io?.emit('task_status_changed', { orderId: parseInt(orderId, 10), newStatus: 'voided' });
    res.json({ message: `訂單 ${result.rows[0].voucher_number} 已成功作廢` });
});

// PATCH /api/orders/:orderId/urgent
// admin/superadmin：可操作所有訂單
// dispatcher：僅可操作自己拋單(imported_by_user_id)的訂單
router.patch('/orders/:orderId/urgent', authorizeRoles('admin', 'dispatcher'), async (req, res) => {
    const { orderId } = req.params;
    const { isUrgent } = req.body;
    const io = req.app.get('io');

    if (typeof isUrgent !== 'boolean') {
        return res.status(400).json({ message: 'isUrgent 必須是布林值' });
    }

    try {
        if (req.user?.role === 'dispatcher') {
            const own = await pool.query(
                `SELECT 1
                 FROM orders o
                 WHERE o.id = $1
                   AND (
                     SELECT ol.user_id
                     FROM operation_logs ol
                     WHERE ol.order_id = o.id AND ol.action_type = 'import'
                     ORDER BY ol.created_at DESC
                     LIMIT 1
                   ) = $2`,
                [orderId, req.user.id]
            );
            if (own.rowCount === 0) {
                return res.status(403).json({ message: '僅允許操作自己拋單的訂單' });
            }
        }

        const result = await pool.query(
            'UPDATE orders SET is_urgent = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, voucher_number, is_urgent',
            [isUrgent, orderId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ message: '找不到該訂單' });
        }

        await logOperation({
            userId: req.user.id,
            orderId,
            operationType: 'set_urgent',
            details: { is_urgent: isUrgent },
            io
        });

        io?.emit('task_urgent_changed', {
            orderId: parseInt(orderId, 10),
            isUrgent,
            voucherNumber: result.rows[0].voucher_number
        });

        logger.info(`[/api/orders/${orderId}/urgent] 訂單 ${result.rows[0].voucher_number} 緊急狀態已更新為: ${isUrgent}`);
        res.json({
            message: `訂單 ${result.rows[0].voucher_number} 已${isUrgent ? '標記為緊急' : '取消緊急標記'}`,
            order: result.rows[0]
        });
    } catch (error) {
        logger.error(`[/api/orders/${orderId}/urgent] 更新失敗:`, error);
        res.status(500).json({ message: '更新緊急狀態失敗' });
    }
});

// DELETE /api/orders/:orderId
// admin/superadmin：可刪除所有訂單
// dispatcher：僅可刪除自己拋單的訂單
router.delete('/orders/:orderId', authorizeRoles('admin', 'dispatcher'), async (req, res) => {
    const { orderId } = req.params;
    const io = req.app.get('io');
    const result = req.user?.role === 'dispatcher'
                ? await pool.query(
                        `DELETE FROM orders o
                         WHERE o.id = $1
                             AND (
                                 SELECT ol.user_id
                                 FROM operation_logs ol
                                 WHERE ol.order_id = o.id AND ol.action_type = 'import'
                                 ORDER BY ol.created_at DESC
                                 LIMIT 1
                             ) = $2
                         RETURNING voucher_number`,
                        [orderId, req.user.id]
                )
        : await pool.query('DELETE FROM orders WHERE id = $1 RETURNING voucher_number', [orderId]);
    if (result.rowCount === 0) return res.status(404).json({ message: '找不到要刪除的訂單' });
    io?.emit('task_deleted', { orderId: parseInt(orderId, 10) });
    res.status(200).json({ message: `訂單 ${result.rows[0].voucher_number} 已被永久刪除` });
});

// POST /api/orders/import
router.post('/orders/import', authorizeRoles('admin', 'dispatcher'), importLimiter, uploadImport, async (req, res) => {
    let parsed;
    try {
        parsed = parseOrderImport(req.file?.buffer);
    } catch (error) {
        return res.status(error.status || 400).json({ code: 'IMPORT_NOT_APPLIED', message: error.message });
    }

    const { voucherNumber, customerName, items, totalQuantity, serialCount } = parsed;
    const events = deferredEvents(req.app.get('io'));
    let client;
    let transactionOpen = false;
    let commitAttempted = false;
    let releaseError;
    let orderId;
    const startedAt = Date.now();
    const checkDeadline = () => {
        if (Date.now() - startedAt > 15000) throw new Error('本次匯入超過處理時間，請縮小檔案後再試');
    };
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        transactionOpen = true;
        await client.query("SET LOCAL lock_timeout = '1500ms'");
        await client.query("SET LOCAL statement_timeout = '8000ms'");
        // Serialize only the same voucher, including concurrent uploads, without new schema.
        await client.query("SELECT pg_advisory_xact_lock(hashtext('wms-order-import'), hashtext($1))", [voucherNumber]);
        const existingOrder = await client.query('SELECT id FROM orders WHERE voucher_number = $1', [voucherNumber]);
        if (existingOrder.rows.length) {
            await client.query('ROLLBACK');
            transactionOpen = false;
            return res.status(409).json({ code: 'IMPORT_ALREADY_EXISTS', message: `訂單 ${voucherNumber} 已存在，未重複建立`, voucherNumber, orderId: existingOrder.rows[0].id });
        }
        const orderResult = await client.query('INSERT INTO orders (voucher_number, customer_name, status) VALUES ($1, $2, $3) RETURNING id', [voucherNumber, customerName, 'pending']);
        orderId = orderResult.rows[0].id;
        const instanceItemIds = [];
        const serialValues = [];
        for (const item of items) {
            checkDeadline();
            const inserted = await client.query('INSERT INTO order_items (order_id, product_code, product_name, quantity, barcode) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                [orderId, item.productCode, item.productName, item.quantity, item.barcode]);
            for (const serial of item.serials) {
                instanceItemIds.push(inserted.rows[0].id);
                serialValues.push(serial);
            }
        }
        if (serialValues.length) {
            checkDeadline();
            await client.query('INSERT INTO order_item_instances (order_item_id, serial_number) SELECT * FROM unnest($1::int[], $2::text[])', [instanceItemIds, serialValues]);
        }
        // Import attribution is still based on this log, so it is required and may not be swallowed.
        const details = { voucherNumber, itemCount: items.length, totalQuantity, serialCount };
        const log = await client.query('INSERT INTO operation_logs (user_id, order_id, action_type, details) VALUES ($1, $2, $3, $4) RETURNING id, created_at',
            [req.user.id, orderId, 'import', JSON.stringify(details)]);
        events.emit('new_operation_log', {
            id: log.rows[0].id, created_at: log.rows[0].created_at,
            user_id: req.user.id, user_name: req.user.name, user_role: req.user.role,
            order_id: orderId, voucher_number: voucherNumber, customer_name: customerName,
            action_type: 'import', details
        });
        events.emit('new_task', { id: orderId, voucher_number: voucherNumber, customer_name: customerName, status: 'pending', task_type: 'pick', imported_by_user_id: req.user.id });
        checkDeadline();
        commitAttempted = true;
        await client.query('COMMIT');
        transactionOpen = false;
        events.publish();
        return res.status(201).json({ message: `訂單 ${voucherNumber} 匯入成功`, orderId, voucherNumber, itemCount: items.length, totalQuantity, serialCount });
    } catch (error) {
        let notApplied = !transactionOpen && !commitAttempted;
        if (transactionOpen) {
            try { await client.query('ROLLBACK'); notApplied = !commitAttempted; }
            catch (rollbackError) { releaseError = rollbackError; }
        }
        if (!notApplied) {
            releaseError ||= error;
            return res.status(503).json({ code: 'IMPORT_RESULT_UNKNOWN', message: '匯入結果尚未確認，請先到作業看板核對訂單號碼，請勿直接重送', voucherNumber });
        }
        logger.error('匯入訂單失敗:', { code: error.code, message: error.message });
        const busy = error.code === '55P03' || error.code === '57014';
        return res.status(busy ? 409 : 500).json({
            code: 'IMPORT_NOT_APPLIED', voucherNumber,
            message: busy ? '匯入暫時忙碌，本次未建立訂單，請稍後再試' : '本次匯入未完成且已取消，請確認檔案或稍後再試'
        });
    } finally {
        client?.release(releaseError);
    }
});

// POST /api/orders/update_item
router.post('/orders/update_item', async (req, res, next) => {
    const { orderId, scanValue, type, amount = 1, orderItemId } = req.body;
    const { id: userId, role } = req.user;
    const isAdminLike = role === 'admin' || role === 'superadmin';
    const io = req.app.get('io');
    const scanRequestStartedAt = Date.now();
    let scanOutcome = 'unknown';
    const stageTimings = {};
    const queryTimings = [];
    let stageStartedAt = scanRequestStartedAt;
    const markStage = (stageName) => {
        const now = Date.now();
        stageTimings[stageName] = now - stageStartedAt;
        stageStartedAt = now;
    };
    const trackedQuery = async (db, label, sql, params = []) => {
        const startedAt = Date.now();
        const result = await db.query(sql, params);
        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs >= 120) {
            queryTimings.push({ label, elapsedMs });
        }
        return result;
    };

    if (!(isAdminLike || role === 'picker' || role === 'packer')) {
        scanOutcome = 'forbidden';
        return res.status(403).json({ message: '權限不足' });
    }

    const scanRaw = String(scanValue ?? '').trim();
    if (!scanRaw) {
        scanOutcome = 'invalid_input';
        return res.status(400).json({ message: '掃描值不可為空' });
    }

    let client;
    let transactionOpen = false;
    let releaseError;
    let commitAttempted = false;
    const events = deferredEvents(io);
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        transactionOpen = true;
        await client.query("SET LOCAL lock_timeout = '1500ms'");
        await client.query("SET LOCAL statement_timeout = '8000ms'");
        const amountNum = Number(amount ?? 1);
        if (!Number.isFinite(amountNum) || amountNum === 0) {
            throw new Error('數量 amount 無效');
        }
        const orderResult = await trackedQuery(client, 'load_order', 'SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
        if (orderResult.rows.length === 0) throw new Error(`找不到 ID 為 ${orderId} 的訂單`);
        const order = orderResult.rows[0];
        if (order.status === 'voided') {
            const error = new Error('此訂單已作廢，無法進行掃碼作業');
            error.status = 409;
            throw error;
        }

        // 訂單異動審核中：禁止揀貨/裝箱
        const hasPendingChange = await hasOpenOrderChange(client, orderId);
        if (hasPendingChange) {
            await client.query('ROLLBACK');
            scanOutcome = 'blocked_order_change';
            return res.status(409).json({ message: '此訂單異動審核中，請先主管核可後再作業。' });
        }

        // 例外流程控管：有 open（未核可）例外時，禁止 pack 相關操作與自動完成
        if (type === 'pack') {
            const hasOpen = await hasOpenExceptions(client, orderId);
            if (hasOpen) {
                await client.query('ROLLBACK');
                scanOutcome = 'blocked_open_exception';
                return res.status(409).json({ message: '此訂單存在未核可例外，請先主管核可（ack）後再進行裝箱作業。' });
            }
        }

        // Auto-transition from picked to packing if type is pack
        if (type === 'pack' && order.status === 'picked') {
             await client.query("UPDATE orders SET status = 'packing', packer_id = COALESCE(packer_id, $1), updated_at = CURRENT_TIMESTAMP WHERE id = $2", [userId, orderId]);
             order.status = 'packing';
             if (!order.packer_id) order.packer_id = userId;
             events.emit('task_status_changed', { orderId: parseInt(orderId, 10), newStatus: 'packing' });
        }

        if ((type === 'pick' && order.picker_id !== userId && !isAdminLike) || (type === 'pack' && order.packer_id !== userId && !isAdminLike)) {
            throw new Error('您不是此任務的指定操作員');
        }
        markStage('precheckMs');

        const scanInfo = normalizeSerialScanInput(scanRaw);

        let instanceRow = null;
        let matchedBy = 'exact';

        // 先走精準匹配（支援舊貨掃到 SN: 前綴）
        const instanceResult = await trackedQuery(
            client,
            'match_instance_exact_for_update',
            `SELECT i.id, i.status
             FROM order_item_instances i
             JOIN order_items oi ON i.order_item_id = oi.id
             WHERE oi.order_id = $1 AND i.serial_number = $2
             FOR UPDATE`,
            [orderId, scanInfo.normalized]
        );

        if (instanceResult.rows.length > 0) {
            instanceRow = instanceResult.rows[0];
        } else {
            // 純數字新條碼：允許用 digitsOnly 去比對資料庫內 SN（移除非數字後）
            // 同時也支援：舊貨掃到 SN: 前綴但資料庫存的是去前綴後的值
            const digitsMinLen = parseInt(process.env.SN_DIGITS_MIN_LEN || '8', 10);
            let canTryDigitsMatch = (scanInfo.isDigitsOnly || scanInfo.hadSnPrefix) && scanInfo.digitsOnly.length >= digitsMinLen;

            // 避免數字型商品條碼誤判成 SN：若此掃描值本身就是訂單品項的 barcode，優先走條碼邏輯
            if (canTryDigitsMatch && scanInfo.isDigitsOnly && !scanInfo.hadSnPrefix) {
                const barcodeExists = await trackedQuery(
                    client,
                    'check_barcode_exists',
                    'SELECT 1 FROM order_items WHERE order_id = $1 AND barcode = $2 LIMIT 1',
                    [orderId, scanRaw]
                );
                if (barcodeExists.rowCount > 0) {
                    canTryDigitsMatch = false;
                }
            }
            if (canTryDigitsMatch) {
                                const digitsResult = await trackedQuery(
                                        client,
                                        'match_instance_digits_for_update',
                    `SELECT i.id, i.status
                     FROM order_item_instances i
                     JOIN order_items oi ON i.order_item_id = oi.id
                     WHERE oi.order_id = $1
                       AND regexp_replace(i.serial_number, '[^0-9]', '', 'g') = $2
                     FOR UPDATE`,
                    [orderId, scanInfo.digitsOnly]
                );

                if (digitsResult.rows.length === 1) {
                    instanceRow = digitsResult.rows[0];
                    matchedBy = 'digits';
                } else if (digitsResult.rows.length > 1) {
                    const e = new Error('此掃描值對應多筆序號（可能撞碼），請改掃完整序號條碼');
                    e.status = 409;
                    throw e;
                }
            }
        }

        if (instanceRow) {
            const instance = instanceRow;
            let newStatus = '';
            if (type === 'pick' && instance.status === 'pending') newStatus = 'picked'; 
            else if (type === 'pack' && instance.status === 'picked') newStatus = 'packed'; 
            else throw new Error(`SN 碼 ${scanRaw} 的狀態 (${instance.status}) 無法執行此操作`);
            await trackedQuery(client, 'update_instance_status', 'UPDATE order_item_instances SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newStatus, instance.id]);
            await logOperation({
                userId,
                orderId,
                operationType: type,
                details: {
                    serialNumber: scanInfo.normalized,
                    scanRaw,
                    matchedBy,
                    statusChange: `${instance.status} -> ${newStatus}`
                },
                io: events,
                db: client,
                userRole: req.user?.role,
                userName: req.user?.name,
                voucherNumber: order.voucher_number,
                customerName: order.customer_name
            });
        } else {
            // 非 SN 條碼：
            // - 若帶 orderItemId：精準更新指定那一行品項（避免同條碼多行時按鈕誤更新）
            // - 否則：掃碼情境下，自動挑選「仍可更新」的一行

            let itemResult;
            if (orderItemId) {
                itemResult = await trackedQuery(
                    client,
                    'pick_item_by_id_for_update',
                    `
                    SELECT
                        oi.id,
                        oi.quantity,
                        COALESCE(oi.picked_quantity, 0) as picked_quantity,
                        COALESCE(oi.packed_quantity, 0) as packed_quantity
                    FROM order_items oi
                    WHERE oi.order_id = $1
                      AND oi.id = $2
                      AND oi.barcode = $3
                      AND NOT EXISTS (
                          SELECT 1 FROM order_item_instances i WHERE i.order_item_id = oi.id
                      )
                    LIMIT 1
                    FOR UPDATE
                    `,
                    [orderId, orderItemId, scanRaw]
                );
            } else {
                // 同一張訂單內可能有多行相同條碼，必須挑選「仍可更新」的那一行
                // pick: picked_quantity + amount 需落在 [0, quantity]
                // pack: packed_quantity + amount 需落在 [0, picked_quantity]
                itemResult = await trackedQuery(
                    client,
                    'pick_item_by_barcode_for_update',
                    `
                    SELECT
                        oi.id,
                        oi.quantity,
                        COALESCE(oi.picked_quantity, 0) as picked_quantity,
                        COALESCE(oi.packed_quantity, 0) as packed_quantity
                    FROM order_items oi
                    WHERE oi.order_id = $1
                      AND oi.barcode = $2
                      AND NOT EXISTS (
                          SELECT 1 FROM order_item_instances i WHERE i.order_item_id = oi.id
                      )
                      AND (
                          (
                            $4 = 'pick'
                            AND (COALESCE(oi.picked_quantity, 0) + $3) BETWEEN 0 AND COALESCE(oi.quantity, 0)
                          )
                          OR (
                            $4 = 'pack'
                            AND (COALESCE(oi.packed_quantity, 0) + $3) BETWEEN 0 AND COALESCE(oi.picked_quantity, 0)
                          )
                      )
                    ORDER BY oi.id ASC
                    LIMIT 1
                    FOR UPDATE
                    `,
                    [orderId, scanRaw, amountNum, type]
                );
            }
            if (itemResult.rows.length === 0) {
                await logOperation({
                    userId,
                    orderId,
                    operationType: 'scan_error',
                    details: { scanValue: scanRaw, type, reason: '條碼不屬於此訂單或該品項需要掃描 SN 碼' },
                    io: events,
                    db: client,
                    userRole: req.user?.role,
                    userName: req.user?.name,
                    voucherNumber: order.voucher_number,
                    customerName: order.customer_name
                });
                throw new Error(`條碼 ${scanRaw} 不可用：可能不屬於此訂單、需要掃 SN，或該條碼所有品項都已無可更新的剩餘數量`);
            }
            const item = itemResult.rows[0];
            if (type === 'pick') { 
                const newPickedQty = item.picked_quantity + amountNum; 
                if (newPickedQty < 0 || newPickedQty > item.quantity) throw new Error('揀貨數量無效'); 
                await trackedQuery(client, 'update_item_picked_qty', 'UPDATE order_items SET picked_quantity = $1 WHERE id = $2', [newPickedQty, item.id]); 
            } else if (type === 'pack') { 
                const newPackedQty = item.packed_quantity + amountNum; 
                if (newPackedQty < 0 || newPackedQty > item.picked_quantity) throw new Error('裝箱數量不能超過已揀貨數量'); 
                await trackedQuery(client, 'update_item_packed_qty', 'UPDATE order_items SET packed_quantity = $1 WHERE id = $2', [newPackedQty, item.id]); 
            }
            await logOperation({
                userId,
                orderId,
                operationType: type,
                details: { barcode: scanRaw, amount: amountNum, orderItemId: item.id },
                io: events,
                db: client,
                userRole: req.user?.role,
                userName: req.user?.name,
                voucherNumber: order.voucher_number,
                customerName: order.customer_name
            });
        }
        markStage('matchAndMutationMs');

        // These item/instance rows are also the response snapshot. Reuse them
        // for completion instead of maintaining a second SQL completion rule.
        const updatedItemsResult = await trackedQuery(client, 'refresh_items', 'SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
        const updatedInstancesResult = await trackedQuery(client, 'refresh_instances',
            'SELECT i.* FROM order_item_instances i JOIN order_items oi ON i.order_item_id = oi.id WHERE oi.order_id = $1', [orderId]);
        const { allPicked, allPacked } = getOrderCompletion(updatedItemsResult.rows, updatedInstancesResult.rows);

        let statusChanged = false;
        let finalStatus = order.status;

        // 完成必須同時滿足揀貨完成 + 裝箱完成
        if (allPicked && allPacked && canAutoComplete(order.status)) {
            const hasOpen = await hasOpenExceptions(client, orderId);
            if (!hasOpen) {
                finalStatus = 'completed';
                statusChanged = true;
                await trackedQuery(
                    client,
                    'update_order_completed',
                    "UPDATE orders SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, packer_id = COALESCE(packer_id, $1) WHERE id = $2",
                    [userId, orderId]
                );
            }
        } else if (allPicked && (order.status === 'picking' || order.status === 'pending')) {
            finalStatus = 'picked';
            statusChanged = true;
            await trackedQuery(client, 'update_order_picked', "UPDATE orders SET status = 'picked', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [orderId]);
        }

        if (statusChanged) {
            events.emit('task_status_changed', { orderId: parseInt(orderId, 10), newStatus: finalStatus });
        }
        markStage('completionCheckMs');

        // Reuse the transaction's client; borrowing more clients here can exhaust the pool.
        // Prepare the response before COMMIT so a failed read cannot report a committed scan as failed.
        const updatedOrderResult = await trackedQuery(client, 'refresh_order', 'SELECT * FROM orders WHERE id = $1', [orderId]);
        markStage('refreshReadMs');
        commitAttempted = true;
        await trackedQuery(client, 'commit_tx', 'COMMIT');
        transactionOpen = false;
        markStage('commitMs');
        events.publish();
        scanOutcome = 'success';
        res.json({ order: updatedOrderResult.rows[0], items: updatedItemsResult.rows, instances: updatedInstancesResult.rows });
    } catch (err) {
        let notApplied = !transactionOpen && !commitAttempted;
        if (transactionOpen) {
            try {
                await client.query('ROLLBACK');
                notApplied = !commitAttempted;
            } catch (rollbackError) {
                releaseError = rollbackError;
                logger.warn('掃碼交易回復失敗:', rollbackError.message);
            }
        }
        if (!notApplied) {
            scanOutcome = 'unknown_commit';
            return res.status(503).json({ code: 'SCAN_RESULT_UNKNOWN', message: '掃描結果尚未確認，請重新載入訂單核對，請勿直接重刷。' });
        }
        if (err?.code === '55P03' || /lock timeout|statement timeout|canceling statement/i.test(err?.message || '')) {
            scanOutcome = 'lock_or_timeout';
            err.status = 409;
            err.message = '掃描作業暫時忙碌（鎖等待逾時），請重試';
        } else {
            scanOutcome = 'error';
            err.message = `更新品项状态失败: ${err.message}`;
        }
        err.scanNotApplied = true;
        next(err);
    } finally {
        const durationMs = Date.now() - scanRequestStartedAt;
        recordScanPerf(durationMs, {
            orderId,
            userId,
            type,
            outcome: scanOutcome,
            stageTimings,
            slowQueries: queryTimings
        });
        client?.release(releaseError);
    }
});

// POST /api/orders/batch/delete
router.post('/orders/batch/delete', authorizeAdmin, async (req, res) => {
    const { orderIds } = req.body;
    const io = req.app.get('io');

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ message: '請提供訂單 ID 列表' });
    }

    try {
        const result = await pool.query(
            'DELETE FROM orders WHERE id = ANY($1) RETURNING id, voucher_number',
            [orderIds]
        );

        result.rows.forEach(order => {
            io?.emit('task_deleted', { orderId: order.id });
        });

        res.json({
            message: `成功刪除 ${result.rowCount} 筆訂單`,
            deletedOrders: result.rows
        });
    } catch (error) {
        logger.error('[/api/orders/batch/delete] 失敗:', error);
        res.status(500).json({ message: '批次刪除失敗' });
    }
});

// POST /api/orders/:orderId/defect
// admin/superadmin：可操作所有訂單
// dispatcher：僅可操作自己拋單的訂單
router.post('/orders/:orderId/defect', authorizeRoles('admin', 'dispatcher'), async (req, res) => {
    const { orderId } = req.params;
    const { oldSn, newSn, reason } = req.body;
    const userId = req.user.id;
    const io = req.app.get('io');

    if (!oldSn || !newSn || !reason) {
        return res.status(400).json({ message: '請提供舊SN、新SN及更換原因' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        if (req.user?.role === 'dispatcher') {
            const own = await client.query(
                `SELECT 1
                 FROM orders o
                 WHERE o.id = $1
                   AND (
                     SELECT ol.user_id
                     FROM operation_logs ol
                     WHERE ol.order_id = o.id AND ol.action_type = 'import'
                     ORDER BY ol.created_at DESC
                     LIMIT 1
                   ) = $2`,
                [orderId, userId]
            );
            if (own.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(403).json({ message: '僅允許操作自己拋單的訂單' });
            }
        }

        // 1. Find the instance and verify it belongs to the order
        const instanceQuery = `
            SELECT i.id, i.order_item_id, oi.product_code, oi.product_name, oi.barcode
            FROM order_item_instances i
            JOIN order_items oi ON i.order_item_id = oi.id
            WHERE i.serial_number = $1 AND oi.order_id = $2
        `;
        const instanceResult = await client.query(instanceQuery, [oldSn, orderId]);

        if (instanceResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: '找不到該訂單中對應的舊SN' });
        }

        const instance = instanceResult.rows[0];

        // 2. Update the SN
        await client.query(
            'UPDATE order_item_instances SET serial_number = $1 WHERE id = $2',
            [newSn, instance.id]
        );

        // 3. Record the defect
        await client.query(
            `INSERT INTO product_defects 
            (order_id, user_id, original_sn, new_sn, product_barcode, product_name, reason)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [orderId, userId, oldSn, newSn, instance.barcode, instance.product_name, reason]
        );

        // 3.1 同步建立例外事件（SN更換）— 管理員操作視同已核可並結案，但仍保留審計紀錄
        try {
            const tableCheck = await client.query(
                `SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'order_exceptions'
                ) as exists`
            );

            if (tableCheck.rows[0]?.exists) {
                await client.query(
                    `INSERT INTO order_exceptions (
                        order_id, type, status,
                        reason_code, reason_text,
                        created_by,
                        ack_by, ack_at,
                        resolved_by, resolved_at,
                        snapshot
                    ) VALUES (
                        $1, 'sn_replace', 'resolved',
                        $2, $3,
                        $4,
                        $4, NOW(),
                        $4, NOW(),
                        $5::jsonb
                    )`,
                    [
                        orderId,
                        'DEFECT_EXCHANGE',
                        reason,
                        userId,
                        JSON.stringify({
                            oldSn,
                            newSn,
                            product: {
                                barcode: instance.barcode,
                                name: instance.product_name,
                                orderItemId: instance.order_item_id
                            }
                        })
                    ]
                );
            }
        } catch (e) {
            // 不影響既有 SN 更換主流程
            logger.warn('[/api/orders/:orderId/defect] 建立例外事件失敗（可忽略）:', e.message);
        }

        await client.query('COMMIT');

        // 4. Log operation
        await logOperation({
            userId,
            orderId,
            operationType: 'defect_exchange',
            details: { oldSn, newSn, reason, product: instance.product_name },
            io
        });

        res.json({ message: 'SN更換成功並已記錄新品不良' });

    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('[/api/orders/:orderId/defect] 失敗:', error);
        res.status(500).json({ message: '處理失敗: ' + error.message });
    } finally {
        client.release();
    }
});

// GET /api/admin/defects/stats
router.get('/admin/defects/stats', authorizeAdmin, async (req, res) => {
    try {
        const query = `
            SELECT 
                product_barcode,
                product_name,
                COUNT(*) as defect_count,
                json_agg(json_build_object(
                    'order_id', order_id,
                    'original_sn', original_sn,
                    'new_sn', new_sn,
                    'reason', reason,
                    'created_at', created_at,
                    'reporter', (SELECT name FROM users WHERE id = product_defects.user_id)
                )) as details
            FROM product_defects
            GROUP BY product_barcode, product_name
            ORDER BY defect_count DESC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (error) {
        logger.error('[/api/admin/defects/stats] 失敗:', error);
        res.status(500).json({ message: '獲取統計失敗' });
    }
});

module.exports = router;
