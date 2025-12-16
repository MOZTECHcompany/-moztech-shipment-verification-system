// backend/src/routes/exceptionRoutes.js
// 訂單例外事件：open/ack/resolved（需先通過 authenticateToken）

const express = require('express');
const { pool } = require('../config/database');
const logger = require('../utils/logger');
const { authorizeAdmin } = require('../middleware/auth');
const { logOperation } = require('../services/operationLogService');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();

const VALID_TYPES = new Set(['stockout', 'damage', 'over_scan', 'under_scan', 'sn_replace', 'other']);
const VALID_STATUSES = new Set(['open', 'ack', 'resolved']);
const VALID_RESOLUTION_ACTIONS = new Set(['short_ship', 'restock', 'exchange', 'void', 'other']);

const attachmentUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        files: 5,
        fileSize: 10 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        const mimetype = String(file?.mimetype || '').toLowerCase();
        const allowed = new Set([
            'image/jpeg',
            'image/png',
            'image/webp',
            'application/pdf'
        ]);

        if (!mimetype || !allowed.has(mimetype)) {
            return cb(new Error('不支援的附件格式（僅支援 jpg/png/webp/pdf）'));
        }
        return cb(null, true);
    }
});

function ensureAttachmentDir() {
    const dir = path.join(__dirname, '..', '..', 'uploads', 'exception_attachments');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function safeFilename(originalName, fallbackExt = '') {
    const name = String(originalName || '').trim();
    const ext = name.includes('.') ? ('.' + name.split('.').pop()).toLowerCase() : fallbackExt;
    const normalizedExt = ext && ext.length <= 10 ? ext : fallbackExt;
    return normalizedExt;
}

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
    const { note, resolutionAction } = req.body || {};
    const userId = req.user.id;
    const io = req.app.get('io');

    const resolutionNote = note ? String(note).trim().slice(0, 2000) : null;
    const action = resolutionAction ? String(resolutionAction).trim() : '';

    if (!action || !VALID_RESOLUTION_ACTIONS.has(action)) {
        return res.status(400).json({
            message: '結案必須提供有效的處置類型（resolutionAction）',
            allowed: Array.from(VALID_RESOLUTION_ACTIONS),
            requestId: req.requestId
        });
    }

    try {
        const result = await pool.query(
            `UPDATE order_exceptions
             SET status = 'resolved',
                 resolved_by = $1,
                 resolved_at = NOW(),
                 resolution_action = $2,
                 resolution_note = COALESCE($3, resolution_note)
             WHERE id = $4 AND order_id = $5 AND status = 'ack'
             RETURNING id, type, status, resolved_at`,
            [userId, action, resolutionNote, exceptionId, orderId]
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
                resolutionAction: action,
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

// GET /api/orders/:orderId/exceptions/:exceptionId/attachments
router.get('/orders/:orderId/exceptions/:exceptionId/attachments', async (req, res) => {
    const { orderId, exceptionId } = req.params;

    try {
        const exists = await pool.query(
            'SELECT 1 FROM order_exceptions WHERE id = $1 AND order_id = $2',
            [exceptionId, orderId]
        );
        if (exists.rowCount === 0) {
            return res.status(404).json({ message: '找不到例外事件', requestId: req.requestId });
        }

        const rows = await pool.query(
            `SELECT id, exception_id, order_id, original_name, mime_type, size_bytes, uploaded_by, uploaded_at
             FROM order_exception_attachments
             WHERE exception_id = $1 AND order_id = $2
             ORDER BY uploaded_at DESC, id DESC`,
            [exceptionId, orderId]
        );

        return res.json({ items: rows.rows });
    } catch (error) {
        logger.error('[/api/orders/:orderId/exceptions/:exceptionId/attachments] failed:', error);
        return res.status(500).json({ message: '取得附件失敗', requestId: req.requestId });
    }
});

// GET /api/orders/:orderId/exceptions/:exceptionId/attachments/:attachmentId/download
router.get('/orders/:orderId/exceptions/:exceptionId/attachments/:attachmentId/download', async (req, res) => {
    const { orderId, exceptionId, attachmentId } = req.params;

    try {
        const result = await pool.query(
            `SELECT storage_key, original_name, mime_type
             FROM order_exception_attachments
             WHERE id = $1 AND exception_id = $2 AND order_id = $3`,
            [attachmentId, exceptionId, orderId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ message: '找不到附件', requestId: req.requestId });
        }

        const row = result.rows[0];
        const filePath = path.join(__dirname, '..', '..', row.storage_key);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ message: '附件檔案不存在', requestId: req.requestId });
        }

        res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
        const filename = row.original_name ? String(row.original_name).replace(/\r|\n/g, '') : `attachment-${attachmentId}`;
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

        const stream = fs.createReadStream(filePath);
        stream.on('error', (e) => {
            logger.error('attachment stream error:', e);
            if (!res.headersSent) {
                res.status(500).json({ message: '讀取附件失敗', requestId: req.requestId });
            }
        });
        return stream.pipe(res);
    } catch (error) {
        logger.error('[/api/orders/:orderId/exceptions/:exceptionId/attachments/:attachmentId/download] failed:', error);
        return res.status(500).json({ message: '下載附件失敗', requestId: req.requestId });
    }
});

// POST /api/orders/:orderId/exceptions/:exceptionId/attachments
// form-data: files[]
router.post('/orders/:orderId/exceptions/:exceptionId/attachments', attachmentUpload.array('files', 5), async (req, res) => {
    const { orderId, exceptionId } = req.params;
    const userId = req.user?.id;
    const files = Array.isArray(req.files) ? req.files : [];

    if (!files.length) {
        return res.status(400).json({ message: '請上傳附件檔案（files）', requestId: req.requestId });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const exists = await client.query(
            'SELECT 1 FROM order_exceptions WHERE id = $1 AND order_id = $2',
            [exceptionId, orderId]
        );
        if (exists.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: '找不到例外事件', requestId: req.requestId });
        }

        const baseDir = ensureAttachmentDir();
        const saved = [];

        for (const f of files) {
            const mimetype = String(f.mimetype || '').toLowerCase();
            const fallbackExt = mimetype === 'image/jpeg' ? '.jpg'
                : mimetype === 'image/png' ? '.png'
                : mimetype === 'image/webp' ? '.webp'
                : mimetype === 'application/pdf' ? '.pdf'
                : '';

            const ext = safeFilename(f.originalname, fallbackExt);
            const key = `${exceptionId}-${Date.now()}-${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')}${ext}`;
            const abs = path.join(baseDir, key);

            fs.writeFileSync(abs, f.buffer);

            // storage_key 存相對 backend/ 路徑，避免環境差異
            const storageKey = path.join('uploads', 'exception_attachments', key);

            const inserted = await client.query(
                `INSERT INTO order_exception_attachments (
                    exception_id, order_id, storage_key, original_name, mime_type, size_bytes, uploaded_by
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING id, exception_id, order_id, original_name, mime_type, size_bytes, uploaded_by, uploaded_at`,
                [
                    exceptionId,
                    orderId,
                    storageKey,
                    f.originalname ? String(f.originalname).slice(0, 255) : null,
                    mimetype || null,
                    Number.isFinite(f.size) ? f.size : null,
                    userId || null
                ]
            );

            saved.push(inserted.rows[0]);
        }

        await client.query('COMMIT');

        return res.status(201).json({ message: '附件已上傳', items: saved });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('[/api/orders/:orderId/exceptions/:exceptionId/attachments] failed:', error);
        return res.status(500).json({ message: '上傳附件失敗', requestId: req.requestId });
    } finally {
        client.release();
    }
});

module.exports = router;
