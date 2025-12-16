// backend/src/routes/exceptionRoutes.js
// 訂單例外事件：open/ack/resolved（需先通過 authenticateToken）

const express = require('express');
const { pool } = require('../config/database');
const logger = require('../utils/logger');
const { authorizeAdmin } = require('../middleware/auth');
const { logOperation } = require('../services/operationLogService');

const router = express.Router();

const VALID_TYPES = new Set(['stockout', 'damage', 'over_scan', 'under_scan', 'sn_replace', 'other']);
const VALID_STATUSES = new Set(['open', 'ack', 'resolved']);

function normalizeReasonCode(value) {
    if (!value) return null;
    const v = String(value).trim();
    return v ? v.slice(0, 50) : null;
}

function normalizeReasonText(value) {
    if (!value) return null;
    const v = String(value).trim();
    return v ? v.slice(0, 2000) : null;
}

// GET /api/orders/:orderId/exceptions
router.get('/orders/:orderId/exceptions', async (req, res) => {
    const { orderId } = req.params;
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';

    if (status && !VALID_STATUSES.has(status)) {
        return res.status(400).json({ message: 'status 無效' });
    }

    try {
        const params = [orderId];
        let where = 'e.order_id = $1';
        if (status) {
            params.push(status);
            where += ` AND e.status = $${params.length}`;
        }

        const result = await pool.query(
            `SELECT
                e.*, 
                cu.name as created_by_name,
                au.name as ack_by_name,
                ru.name as resolved_by_name
            FROM order_exceptions e
            LEFT JOIN users cu ON cu.id = e.created_by
            LEFT JOIN users au ON au.id = e.ack_by
            LEFT JOIN users ru ON ru.id = e.resolved_by
            WHERE ${where}
            ORDER BY e.created_at DESC, e.id DESC`,
            params
        );

        return res.json({ items: result.rows });
    } catch (error) {
        logger.error('[/api/orders/:orderId/exceptions] 失敗:', error);
        return res.status(500).json({ message: '取得例外清單失敗', requestId: req.requestId });
    }
});

// POST /api/orders/:orderId/exceptions
// body: { type, reasonCode?, reasonText?, orderItemId?, instanceId?, snapshot? }
router.post('/orders/:orderId/exceptions', async (req, res) => {
    const { orderId } = req.params;
    const { type, reasonCode, reasonText, orderItemId, instanceId, snapshot } = req.body || {};
    const { id: userId } = req.user;
    const io = req.app.get('io');

    if (!type || !VALID_TYPES.has(String(type))) {
        return res.status(400).json({ message: 'type 無效' });
    }

    const normalizedReasonCode = normalizeReasonCode(reasonCode);
    const normalizedReasonText = normalizeReasonText(reasonText);

    if (!normalizedReasonText) {
        return res.status(400).json({ message: '請提供原因（reasonText）' });
    }

    const snapshotObj = (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) ? snapshot : {};
    snapshotObj.requestId = req.requestId;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const orderExist = await client.query('SELECT id, status FROM orders WHERE id = $1', [orderId]);
        if (orderExist.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: '找不到指定訂單', requestId: req.requestId });
        }

        // 可選：驗證 orderItemId/instanceId 是否屬於此訂單（避免亂塞）
        if (orderItemId) {
            const chkItem = await client.query('SELECT 1 FROM order_items WHERE id = $1 AND order_id = $2', [orderItemId, orderId]);
            if (chkItem.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: 'orderItemId 不屬於此訂單', requestId: req.requestId });
            }
        }

        if (instanceId) {
            const chkInst = await client.query(
                `SELECT 1
                 FROM order_item_instances i
                 JOIN order_items oi ON oi.id = i.order_item_id
                 WHERE i.id = $1 AND oi.order_id = $2`,
                [instanceId, orderId]
            );
            if (chkInst.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: 'instanceId 不屬於此訂單', requestId: req.requestId });
            }
        }

        const inserted = await client.query(
            `INSERT INTO order_exceptions (
                order_id, order_item_id, instance_id, type, status,
                reason_code, reason_text,
                created_by, snapshot
            ) VALUES (
                $1, $2, $3, $4, 'open',
                $5, $6,
                $7, $8::jsonb
            )
            RETURNING id, created_at`,
            [
                orderId,
                orderItemId || null,
                instanceId || null,
                String(type),
                normalizedReasonCode,
                normalizedReasonText,
                userId,
                JSON.stringify(snapshotObj)
            ]
        );

        await client.query('COMMIT');

        const exceptionId = inserted.rows[0].id;

        await logOperation({
            userId,
            orderId,
            operationType: 'exception_create',
            details: {
                exceptionId,
                type: String(type),
                status: 'open',
                reason: { code: normalizedReasonCode, text: normalizedReasonText },
                target: { orderItemId: orderItemId || null, instanceId: instanceId || null },
                meta: { requestId: req.requestId }
            },
            io
        });

        io?.emit('order_exception_changed', {
            orderId: parseInt(orderId, 10),
            exceptionId,
            action: 'created'
        });

        return res.status(201).json({
            message: '例外已建立',
            id: exceptionId,
            created_at: inserted.rows[0].created_at
        });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('[/api/orders/:orderId/exceptions] 建立失敗:', error);
        return res.status(500).json({ message: '建立例外失敗', requestId: req.requestId });
    } finally {
        client.release();
    }
});

// PATCH /api/orders/:orderId/exceptions/:exceptionId/ack
// 主管核可（管理員）
router.patch('/orders/:orderId/exceptions/:exceptionId/ack', authorizeAdmin, async (req, res) => {
    const { orderId, exceptionId } = req.params;
    const { note } = req.body || {};
    const userId = req.user.id;
    const io = req.app.get('io');

    const ackNote = note ? String(note).trim().slice(0, 2000) : null;

    try {
        const result = await pool.query(
            `UPDATE order_exceptions
             SET status = 'ack', ack_by = $1, ack_at = NOW(), ack_note = COALESCE($2, ack_note)
             WHERE id = $3 AND order_id = $4 AND status = 'open'
             RETURNING id, type, status, ack_at`,
            [userId, ackNote, exceptionId, orderId]
        );

        if (result.rowCount === 0) {
            // 可能是不存在、或已不是 open
            const exists = await pool.query('SELECT status FROM order_exceptions WHERE id = $1 AND order_id = $2', [exceptionId, orderId]);
            if (exists.rowCount === 0) {
                return res.status(404).json({ message: '找不到例外事件', requestId: req.requestId });
            }
            return res.status(409).json({ message: `無法核可，目前狀態為 ${exists.rows[0].status}`, requestId: req.requestId });
        }

        await logOperation({
            userId,
            orderId,
            operationType: 'exception_ack',
            details: {
                exceptionId: parseInt(exceptionId, 10),
                status: 'ack',
                note: ackNote,
                meta: { requestId: req.requestId }
            },
            io
        });

        io?.emit('order_exception_changed', {
            orderId: parseInt(orderId, 10),
            exceptionId: parseInt(exceptionId, 10),
            action: 'acked'
        });

        return res.json({ message: '例外已核可', item: result.rows[0] });
    } catch (error) {
        logger.error('[/api/orders/:orderId/exceptions/:exceptionId/ack] 失敗:', error);
        return res.status(500).json({ message: '核可失敗', requestId: req.requestId });
    }
});

// PATCH /api/orders/:orderId/exceptions/:exceptionId/resolve
// 結案（需要先 ack）
router.patch('/orders/:orderId/exceptions/:exceptionId/resolve', authorizeAdmin, async (req, res) => {
    const { orderId, exceptionId } = req.params;
    const { note } = req.body || {};
    const userId = req.user.id;
    const io = req.app.get('io');

    const resolutionNote = note ? String(note).trim().slice(0, 2000) : null;

    try {
        const result = await pool.query(
            `UPDATE order_exceptions
             SET status = 'resolved', resolved_by = $1, resolved_at = NOW(), resolution_note = COALESCE($2, resolution_note)
             WHERE id = $3 AND order_id = $4 AND status = 'ack'
             RETURNING id, type, status, resolved_at`,
            [userId, resolutionNote, exceptionId, orderId]
        );

        if (result.rowCount === 0) {
            const exists = await pool.query('SELECT status FROM order_exceptions WHERE id = $1 AND order_id = $2', [exceptionId, orderId]);
            if (exists.rowCount === 0) {
                return res.status(404).json({ message: '找不到例外事件', requestId: req.requestId });
            }
            return res.status(409).json({ message: `無法結案，目前狀態為 ${exists.rows[0].status}（需先核可 ack）`, requestId: req.requestId });
        }

        await logOperation({
            userId,
            orderId,
            operationType: 'exception_resolve',
            details: {
                exceptionId: parseInt(exceptionId, 10),
                status: 'resolved',
                note: resolutionNote,
                meta: { requestId: req.requestId }
            },
            io
        });

        io?.emit('order_exception_changed', {
            orderId: parseInt(orderId, 10),
            exceptionId: parseInt(exceptionId, 10),
            action: 'resolved'
        });

        return res.json({ message: '例外已結案', item: result.rows[0] });
    } catch (error) {
        logger.error('[/api/orders/:orderId/exceptions/:exceptionId/resolve] 失敗:', error);
        return res.status(500).json({ message: '結案失敗', requestId: req.requestId });
    }
});

module.exports = router;
