// backend/src/routes/exceptionRoutes.js
// 訂單例外事件：open/ack/resolved（需先通過 authenticateToken）

const express = require('express');
const { pool } = require('../config/database');
const logger = require('../utils/logger');
const { authorizeAdmin, authorizeRoles } = require('../middleware/auth');
const { logOperation } = require('../services/operationLogService');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateOrderChangeProposal, applyOrderChangeProposal, hasAnyOpenOrderChange } = require('../services/orderChangeService');

const router = express.Router();

const VALID_TYPES = new Set(['stockout', 'damage', 'over_scan', 'under_scan', 'sn_replace', 'other', 'order_change']);
const VALID_STATUSES = new Set(['open', 'ack', 'resolved']);
const VALID_RESOLUTION_ACTIONS = new Set(['short_ship', 'restock', 'exchange', 'void', 'other']);

function normalizeRole(value) {
    return value ? String(value).trim().toLowerCase() : '';
}

function extractOrderChangeProposal({ reasonText, snapshotObj }) {
    const proposal = snapshotObj?.proposal && typeof snapshotObj.proposal === 'object' ? snapshotObj.proposal : null;
    const note = String((proposal?.note ?? reasonText) || '').trim();
    const items = Array.isArray(proposal?.items) ? proposal.items : [];
    return { note, items };
}

async function fetchOrderResponsibleUser(client, orderId) {
    const result = await client.query(
        `SELECT
            import_log.user_id AS user_id,
            u.role AS role,
            u.name AS name
         FROM orders o
         LEFT JOIN LATERAL (
            SELECT ol.user_id
            FROM operation_logs ol
            WHERE ol.order_id = o.id AND ol.action_type = 'import'
            ORDER BY ol.created_at DESC
            LIMIT 1
         ) import_log ON TRUE
         LEFT JOIN users u ON u.id = import_log.user_id
         WHERE o.id = $1`,
        [orderId]
    );

    if (result.rowCount === 0) return null;
    const row = result.rows[0];
    const userId = row.user_id ? parseInt(row.user_id, 10) : null;
    return {
        userId: userId || null,
        role: row.role || null,
        name: row.name || null
    };
}

async function createTaskCommentAndMentions({ client, orderId, authorUserId, content, priority, mentionUserIds, io }) {
    const safeContent = String(content || '').trim().slice(0, 2000);
    if (!safeContent) return null;

    const safePriority = (priority === 'urgent' || priority === 'important' || priority === 'normal') ? priority : 'normal';
    const mentioned = Array.isArray(mentionUserIds) ? mentionUserIds.filter(Boolean) : [];
    const dedupMentionIds = Array.from(new Set(mentioned.map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n) && n > 0))).slice(0, 20);

    const commentResult = await client.query(
        `INSERT INTO task_comments (order_id, user_id, content, parent_id, priority)
         VALUES ($1, $2, $3, NULL, $4)
         RETURNING id, created_at`,
        [orderId, authorUserId, safeContent, safePriority]
    );

    const commentId = commentResult.rows[0].id;

    for (const mentionedUserId of dedupMentionIds) {
        await client.query(
            `INSERT INTO task_mentions (comment_id, mentioned_user_id)
             VALUES ($1, $2)`,
            [commentId, mentionedUserId]
        );
        io?.emit('new_mention', {
            userId: mentionedUserId,
            orderId: parseInt(orderId, 10),
            commentId,
            content: safeContent.slice(0, 100),
            priority: safePriority
        });
    }

    io?.emit('new_comment', {
        orderId: parseInt(orderId, 10),
        commentId,
        userId: authorUserId,
        content: safeContent,
        priority: safePriority
    });

    return { commentId, createdAt: commentResult.rows[0].created_at };
}

async function fetchAdminUserIds(client, limit = 10) {
    const rows = await client.query(
        `SELECT id FROM users WHERE role IN ('admin','superadmin') ORDER BY id ASC LIMIT $1`,
        [Math.max(1, Math.min(50, parseInt(limit, 10) || 10))]
    );
    return (rows.rows || []).map((r) => r.id);
}

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

        let responsible = null;
        try {
            const metaClient = await pool.connect();
            try {
                responsible = await fetchOrderResponsibleUser(metaClient, orderId);
            } finally {
                metaClient.release();
            }
        } catch (e) {
            responsible = null;
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

        return res.json({
            items: result.rows,
            meta: {
                responsibleUserId: responsible?.userId ?? null,
                responsibleRole: responsible?.role ?? null,
                responsibleName: responsible?.name ?? null
            }
        });
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
    const { id: userId, role } = req.user;
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

        const orderExist = await client.query(
            `SELECT
                o.id,
                o.status,
                o.voucher_number,
                     import_log.user_id AS imported_by_user_id,
                     iu.role AS imported_by_role,
                     iu.name AS imported_by_name
             FROM orders o
             LEFT JOIN LATERAL (
                SELECT ol.user_id
                FROM operation_logs ol
                WHERE ol.order_id = o.id AND ol.action_type = 'import'
                ORDER BY ol.created_at DESC
                LIMIT 1
             ) import_log ON TRUE
                 LEFT JOIN users iu ON iu.id = import_log.user_id
             WHERE o.id = $1`,
            [orderId]
        );
        if (orderExist.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: '找不到指定訂單', requestId: req.requestId });
        }

        const importedByUserId = orderExist.rows[0]?.imported_by_user_id ? parseInt(orderExist.rows[0].imported_by_user_id, 10) : null;
        const importedByRole = normalizeRole(orderExist.rows[0]?.imported_by_role);
        const actorRole = normalizeRole(role);

        // order_change: dispatcher only for own imported orders
        if (String(type) === 'order_change' && actorRole === 'dispatcher') {
            if (!importedByUserId || importedByRole !== 'dispatcher' || String(importedByUserId) !== String(userId)) {
                await client.query('ROLLBACK');
                return res.status(403).json({ message: '僅允許該訂單拋單員申請訂單異動', requestId: req.requestId });
            }
        }

        // order_change: prevent multiple concurrent requests
        if (String(type) === 'order_change') {
            const hasOpen = await hasAnyOpenOrderChange(client, orderId);
            if (hasOpen) {
                await client.query('ROLLBACK');
                return res.status(409).json({ message: '此訂單已有待審核的異動申請，請先完成審核', requestId: req.requestId });
            }

            const proposal = extractOrderChangeProposal({ reasonText: normalizedReasonText, snapshotObj });
            const validated = validateOrderChangeProposal(proposal);
            if (!validated.ok) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: validated.message, requestId: req.requestId });
            }
            snapshotObj.proposal = {
                ...validated.value,
                proposedBy: userId,
                proposedAt: new Date().toISOString(),
                requestId: req.requestId
            };
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

        const exceptionId = inserted.rows[0].id;
        let orderChangeAutoApproved = false;

        // 管理員自拋單：可直接異動，不需審核，但仍留痕
        if (String(type) === 'order_change') {
            const isAdminLike = actorRole === 'admin' || actorRole === 'superadmin';
            const isSelfImported = importedByUserId && String(importedByUserId) === String(userId) && (importedByRole === 'admin' || importedByRole === 'superadmin');

            if (isAdminLike && isSelfImported) {
                const applyResult = await applyOrderChangeProposal({
                    client,
                    orderId,
                    proposal: snapshotObj.proposal,
                    actorUserId: userId
                });

                await client.query(
                    `UPDATE order_exceptions
                     SET status = 'ack', ack_by = $1, ack_at = NOW(), ack_note = COALESCE($2, ack_note),
                         snapshot = jsonb_set(COALESCE(snapshot, '{}'::jsonb), '{applyResult}', $3::jsonb, true)
                     WHERE id = $4 AND order_id = $5`,
                    [userId, '管理員自拋單：自動放行並套用異動', JSON.stringify(applyResult), exceptionId, orderId]
                );

                orderChangeAutoApproved = true;
            }
        }

        await client.query('COMMIT');

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

        // 若為 order_change 且自動放行，訂單狀態已被強制退回撿貨
        if (String(type) === 'order_change' && orderChangeAutoApproved) {
            io?.emit('task_status_changed', { orderId: parseInt(orderId, 10), newStatus: 'picking' });
        }

        // 通知責任人（拋單員 / 管理員建立者）：以 task comment + mention 方式推送到通知中心
        try {
            const voucherNumber = orderExist.rows[0]?.voucher_number;

            const isOrderChange = String(type) === 'order_change';
            const content = isOrderChange
                ? `【訂單異動待審核】${voucherNumber ? `訂單 ${voucherNumber}` : `order #${orderId}`}\n原因: ${normalizedReasonText}`
                : `【例外回報】${voucherNumber ? `訂單 ${voucherNumber}` : `order #${orderId}`} 類型: ${String(type)}\n原因: ${normalizedReasonText}`;

            // order_change 一律通知管理員審核；其他例外維持既有策略
            const mentionIds = isOrderChange
                ? await fetchAdminUserIds(client, 10)
                : ((importedByUserId && importedByRole === 'dispatcher')
                    ? [importedByUserId]
                    : await fetchAdminUserIds(client, 10));

            if (mentionIds.length > 0) {
                const notifyClient = await pool.connect();
                try {
                    await notifyClient.query('BEGIN');
                    await createTaskCommentAndMentions({
                        client: notifyClient,
                        orderId,
                        authorUserId: userId,
                        content,
                        priority: 'urgent',
                        mentionUserIds: mentionIds,
                        io
                    });
                    await notifyClient.query('COMMIT');
                } catch (e) {
                    await notifyClient.query('ROLLBACK');
                    logger.warn('exception_create: 建立通知 comment/mention 失敗（可忽略）:', e.message);
                } finally {
                    notifyClient.release();
                }
            }
        } catch (e) {
            logger.warn('exception_create: 通知責任人失敗（可忽略）:', e.message);
        }

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

// PATCH /api/orders/:orderId/exceptions/:exceptionId/propose
// 拋單員（dispatcher）填寫處理方式/異動值 -> 管理員審核後再核可（ack）放行
router.patch('/orders/:orderId/exceptions/:exceptionId/propose', authorizeRoles('admin', 'dispatcher'), async (req, res) => {
    const { orderId, exceptionId } = req.params;
    const userId = req.user.id;
    const role = req.user.role;
    const io = req.app.get('io');

    const { resolutionAction, note, newSn, correctBarcode } = req.body || {};

    const action = resolutionAction ? String(resolutionAction).trim() : '';
    if (!action || !VALID_RESOLUTION_ACTIONS.has(action)) {
        return res.status(400).json({
            message: '請提供有效的處理方式（resolutionAction）',
            allowed: Array.from(VALID_RESOLUTION_ACTIONS),
            requestId: req.requestId
        });
    }

    const proposalNote = note ? String(note).trim().slice(0, 2000) : null;
    const proposedNewSn = newSn ? String(newSn).trim().slice(0, 100) : null;
    const proposedBarcode = correctBarcode ? String(correctBarcode).trim().slice(0, 200) : null;

    if (!proposalNote && !proposedNewSn && !proposedBarcode) {
        return res.status(400).json({ message: '請至少提供處理備註或異動 SN/條碼', requestId: req.requestId });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // dispatcher：僅允許該訂單「拋單員」提交處理內容；若訂單由管理員建立，dispatcher 不可提案
        if (role === 'dispatcher') {
            const responsible = await fetchOrderResponsibleUser(client, orderId);
            const responsibleUserId = responsible?.userId ?? null;
            const responsibleRole = responsible?.role ? String(responsible.role).toLowerCase() : null;

            if (!responsibleUserId || responsibleRole !== 'dispatcher' || String(responsibleUserId) !== String(userId)) {
                await client.query('ROLLBACK');
                return res.status(403).json({ message: '僅允許該訂單拋單員提交處理內容', requestId: req.requestId });
            }
        }

        const exists = await client.query(
            'SELECT id, type, status FROM order_exceptions WHERE id = $1 AND order_id = $2',
            [exceptionId, orderId]
        );
        if (exists.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: '找不到例外事件', requestId: req.requestId });
        }

        if (exists.rows[0].status !== 'open') {
            await client.query('ROLLBACK');
            return res.status(409).json({ message: `目前狀態為 ${exists.rows[0].status}，不可再更新處理內容`, requestId: req.requestId });
        }

        const proposal = {
            resolutionAction: action,
            note: proposalNote,
            newSn: proposedNewSn,
            correctBarcode: proposedBarcode,
            proposedBy: userId,
            proposedAt: new Date().toISOString(),
            requestId: req.requestId
        };

        const updated = await client.query(
            `UPDATE order_exceptions
             SET snapshot = jsonb_set(COALESCE(snapshot, '{}'::jsonb), '{proposal}', $1::jsonb, true)
             WHERE id = $2 AND order_id = $3
             RETURNING id, order_id, type, status, snapshot`,
            [JSON.stringify(proposal), exceptionId, orderId]
        );

        // 通知管理員審核：建立 task comment + mention all admins
        try {
            const adminIds = await fetchAdminUserIds(client, 10);
            if (adminIds.length > 0) {
                const orderRow = await client.query('SELECT voucher_number FROM orders WHERE id = $1', [orderId]);
                const voucherNumber = orderRow.rows[0]?.voucher_number;
                await createTaskCommentAndMentions({
                    client,
                    orderId,
                    authorUserId: userId,
                    content: `【例外待審核】${voucherNumber ? `訂單 ${voucherNumber}` : `order #${orderId}`}\n處理方式: ${action}${proposalNote ? `\n備註: ${proposalNote}` : ''}${proposedNewSn ? `\n異動 SN: ${proposedNewSn}` : ''}${proposedBarcode ? `\n正確條碼: ${proposedBarcode}` : ''}`,
                    priority: 'urgent',
                    mentionUserIds: adminIds,
                    io
                });
            }
        } catch (e) {
            logger.warn('exception_propose: 通知管理員失敗（可忽略）:', e.message);
        }

        await client.query('COMMIT');

        await logOperation({
            userId,
            orderId,
            operationType: 'exception_propose',
            details: {
                exceptionId: parseInt(exceptionId, 10),
                proposal: { resolutionAction: action, note: proposalNote, newSn: proposedNewSn, correctBarcode: proposedBarcode },
                meta: { requestId: req.requestId }
            },
            io
        });

        io?.emit('order_exception_changed', {
            orderId: parseInt(orderId, 10),
            exceptionId: parseInt(exceptionId, 10),
            action: 'proposed'
        });

        return res.json({ message: '已送出處理內容，等待管理員審核', item: updated.rows[0] });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('[/api/orders/:orderId/exceptions/:exceptionId/propose] failed:', error);
        return res.status(500).json({ message: '送出處理內容失敗', requestId: req.requestId });
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

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const ex = await client.query(
            'SELECT * FROM order_exceptions WHERE id = $1 AND order_id = $2 FOR UPDATE',
            [exceptionId, orderId]
        );

        if (ex.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: '找不到例外事件', requestId: req.requestId });
        }

        const row = ex.rows[0];
        if (row.status !== 'open') {
            await client.query('ROLLBACK');
            return res.status(409).json({ message: `無法核可，目前狀態為 ${row.status}`, requestId: req.requestId });
        }

        let applyResult = null;
        if (String(row.type) === 'order_change') {
            let snapshotObj = row.snapshot;
            if (typeof snapshotObj === 'string') {
                try { snapshotObj = JSON.parse(snapshotObj); } catch { snapshotObj = {}; }
            }
            if (!snapshotObj || typeof snapshotObj !== 'object' || Array.isArray(snapshotObj)) {
                snapshotObj = {};
            }

            const proposal = snapshotObj?.proposal || null;
            if (!proposal) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: '此訂單異動缺少 proposal，無法核可套用', requestId: req.requestId });
            }
            applyResult = await applyOrderChangeProposal({
                client,
                orderId,
                proposal,
                actorUserId: userId
            });
        }

        const updated = await client.query(
            `UPDATE order_exceptions
             SET status = 'ack', ack_by = $1, ack_at = NOW(), ack_note = COALESCE($2, ack_note),
                 snapshot = CASE
                     WHEN $3::jsonb IS NULL THEN snapshot
                     ELSE jsonb_set(COALESCE(snapshot, '{}'::jsonb), '{applyResult}', $3::jsonb, true)
                 END
             WHERE id = $4 AND order_id = $5
             RETURNING id, type, status, ack_at`,
            [userId, ackNote, applyResult ? JSON.stringify(applyResult) : null, exceptionId, orderId]
        );

        await client.query('COMMIT');

        await logOperation({
            userId,
            orderId,
            operationType: String(row.type) === 'order_change' ? 'order_change_ack' : 'exception_ack',
            details: {
                exceptionId: parseInt(exceptionId, 10),
                status: 'ack',
                note: ackNote,
                ...(applyResult ? { applyResult } : {}),
                meta: { requestId: req.requestId }
            },
            io
        });

        io?.emit('order_exception_changed', {
            orderId: parseInt(orderId, 10),
            exceptionId: parseInt(exceptionId, 10),
            action: 'acked'
        });

        if (String(row.type) === 'order_change') {
            io?.emit('task_status_changed', { orderId: parseInt(orderId, 10), newStatus: 'picking' });
        }

        return res.json({ message: '例外已核可', item: updated.rows[0] });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('[/api/orders/:orderId/exceptions/:exceptionId/ack] 失敗:', error);
        const status = Number.isFinite(Number(error?.status)) ? Number(error.status) : 500;
        const safeStatus = status >= 400 && status < 600 ? status : 500;
        const message = safeStatus >= 500
            ? '核可失敗'
            : (error?.message || '核可失敗');
        return res.status(safeStatus).json({ message, requestId: req.requestId });
    } finally {
        client.release();
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
        const inline = String(req.query.inline || '').trim() === '1' || String(req.query.inline || '').toLowerCase() === 'true';
        res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(filename)}"`);

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
