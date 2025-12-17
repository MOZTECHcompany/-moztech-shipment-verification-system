// backend/src/routes/teamBoardRoutes.js
// 團隊公告 / 交辦事項（單一公告板，預留 channel）

const express = require('express');
const { pool } = require('../config/database');
const logger = require('../utils/logger');
const { authorizeRoles } = require('../middleware/auth');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();

const VALID_TYPES = new Set(['announcement', 'task']);
const VALID_STATUSES = new Set(['open', 'in_progress', 'done', 'closed']);
const VALID_PRIORITIES = new Set(['urgent', 'important', 'normal']);

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
    const dir = path.join(__dirname, '..', '..', 'uploads', 'team_post_attachments');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function safeExt(originalName, fallbackExt = '') {
    const name = String(originalName || '').trim();
    const ext = name.includes('.') ? ('.' + name.split('.').pop()).toLowerCase() : fallbackExt;
    const normalizedExt = ext && ext.length <= 10 ? ext : fallbackExt;
    return normalizedExt;
}

async function getGeneralChannelId(client) {
    const res = await client.query(`SELECT id FROM team_channels WHERE slug = 'general' LIMIT 1`);
    if (res.rowCount > 0) return res.rows[0].id;

    const inserted = await client.query(
        `INSERT INTO team_channels (slug, name) VALUES ('general', '公告板') RETURNING id`
    );
    return inserted.rows[0].id;
}

function parseIdList(value, limit = 50) {
    const arr = Array.isArray(value) ? value : [];
    const nums = arr
        .map((x) => parseInt(x, 10))
        .filter((n) => Number.isFinite(n) && n > 0);
    return Array.from(new Set(nums)).slice(0, limit);
}

async function canManagePost(client, postId, user) {
    if (!user) return false;
    const role = String(user.role || '').toLowerCase();
    if (role === 'admin' || role === 'superadmin') return true;

    const res = await client.query(
        `SELECT
            p.created_by,
            EXISTS(
                SELECT 1 FROM team_post_assignees a
                WHERE a.post_id = p.id AND a.user_id = $2
            ) AS is_assignee
         FROM team_posts p
         WHERE p.id = $1`,
        [postId, user.id]
    );
    if (res.rowCount === 0) return false;
    const row = res.rows[0];
    if (String(row.created_by) === String(user.id)) return true;
    return !!row.is_assignee;
}

// GET /api/team/channels
router.get('/team/channels', async (req, res) => {
    try {
        const rows = await pool.query(`SELECT id, slug, name FROM team_channels ORDER BY id ASC`);
        return res.json({ items: rows.rows });
    } catch (err) {
        logger.error('[/api/team/channels] failed:', err);
        return res.status(500).json({ message: '取得頻道失敗', requestId: req.requestId });
    }
});

// GET /api/team/posts?status=&type=&q=&channelId=&limit=&page=
router.get('/team/posts', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const type = typeof req.query.type === 'string' ? req.query.type.trim() : '';

    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const offset = (page - 1) * limit;

    const client = await pool.connect();
    try {
        const channelId = req.query.channelId ? parseInt(String(req.query.channelId), 10) : await getGeneralChannelId(client);

        const params = [channelId];
        let where = 'p.channel_id = $1';

        if (status) {
            if (!VALID_STATUSES.has(status)) return res.status(400).json({ message: 'status 無效', requestId: req.requestId });
            params.push(status);
            where += ` AND p.status = $${params.length}`;
        }

        if (type) {
            if (!VALID_TYPES.has(type)) return res.status(400).json({ message: 'type 無效', requestId: req.requestId });
            params.push(type);
            where += ` AND p.post_type = $${params.length}`;
        }

        if (q) {
            params.push(`%${q}%`);
            where += ` AND (p.title ILIKE $${params.length} OR p.content ILIKE $${params.length})`;
        }

        const list = await client.query(
            `SELECT
                p.id,
                p.channel_id,
                p.post_type,
                p.status,
                p.priority,
                p.title,
                p.content,
                p.due_at,
                p.created_by,
                p.created_at,
                p.updated_at,
                u.name AS created_by_name,
                (
                    SELECT COALESCE(json_agg(json_build_object('id', uu.id, 'name', uu.name) ORDER BY uu.id ASC), '[]'::json)
                    FROM team_post_assignees a
                    JOIN users uu ON uu.id = a.user_id
                    WHERE a.post_id = p.id
                ) AS assignees,
                (SELECT COUNT(*)::int FROM team_post_comments c WHERE c.post_id = p.id) AS comment_count,
                (SELECT COUNT(*)::int FROM team_post_attachments t WHERE t.post_id = p.id) AS attachment_count
             FROM team_posts p
             JOIN users u ON u.id = p.created_by
             WHERE ${where}
             ORDER BY p.created_at DESC, p.id DESC
             LIMIT ${limit} OFFSET ${offset}`,
            params
        );

        return res.json({ items: list.rows, meta: { page, limit } });
    } catch (err) {
        logger.error('[/api/team/posts] failed:', err);
        return res.status(500).json({ message: '取得團隊公告板失敗', requestId: req.requestId });
    } finally {
        client.release();
    }
});

// POST /api/team/posts
// body: { postType, title, content, priority?, dueAt?, assigneeUserIds?, channelId? }
router.post('/team/posts', authorizeRoles('admin', 'dispatcher'), async (req, res) => {
    const { postType, title, content, priority, dueAt, assigneeUserIds, channelId } = req.body || {};
    const userId = req.user.id;
    const io = req.app.get('io');

    const type = String(postType || '').trim();
    if (!VALID_TYPES.has(type)) return res.status(400).json({ message: 'postType 無效', requestId: req.requestId });

    const safeTitle = String(title || '').trim().slice(0, 200);
    if (!safeTitle) return res.status(400).json({ message: '請提供標題（title）', requestId: req.requestId });

    const safeContent = String(content || '').trim().slice(0, 5000);
    if (!safeContent) return res.status(400).json({ message: '請提供內容（content）', requestId: req.requestId });

    const safePriority = VALID_PRIORITIES.has(String(priority || '').trim()) ? String(priority).trim() : 'normal';

    const due = dueAt ? new Date(dueAt) : null;
    const safeDueAt = (due && !Number.isNaN(due.getTime())) ? due.toISOString() : null;

    const assignees = type === 'task' ? parseIdList(assigneeUserIds, 50) : [];

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const chId = channelId ? parseInt(String(channelId), 10) : await getGeneralChannelId(client);

        const inserted = await client.query(
            `INSERT INTO team_posts (
                channel_id, post_type, status, priority, title, content, due_at, created_by
             ) VALUES ($1, $2, 'open', $3, $4, $5, $6, $7)
             RETURNING id, created_at`,
            [chId, type, safePriority, safeTitle, safeContent, safeDueAt, userId]
        );

        const postId = inserted.rows[0].id;

        for (const assigneeId of assignees) {
            await client.query(
                `INSERT INTO team_post_assignees (post_id, user_id) VALUES ($1, $2)
                 ON CONFLICT DO NOTHING`,
                [postId, assigneeId]
            );
        }

        await client.query('COMMIT');

        io?.emit('team_post_changed', { action: 'created', postId: parseInt(postId, 10) });

        return res.status(201).json({ message: '已建立', id: postId, created_at: inserted.rows[0].created_at });
    } catch (err) {
        await client.query('ROLLBACK');
        logger.error('[/api/team/posts] create failed:', err);
        return res.status(500).json({ message: '建立失敗', requestId: req.requestId });
    } finally {
        client.release();
    }
});

// GET /api/team/posts/:postId
router.get('/team/posts/:postId', async (req, res) => {
    const { postId } = req.params;
    const id = parseInt(String(postId), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'postId 無效', requestId: req.requestId });

    const client = await pool.connect();
    try {
        const post = await client.query(
            `SELECT
                p.id,
                p.channel_id,
                p.post_type,
                p.status,
                p.priority,
                p.title,
                p.content,
                p.due_at,
                p.created_by,
                p.created_at,
                p.updated_at,
                u.name AS created_by_name
             FROM team_posts p
             JOIN users u ON u.id = p.created_by
             WHERE p.id = $1`,
            [id]
        );
        if (post.rowCount === 0) return res.status(404).json({ message: '找不到資料', requestId: req.requestId });

        const assignees = await client.query(
            `SELECT uu.id, uu.name
             FROM team_post_assignees a
             JOIN users uu ON uu.id = a.user_id
             WHERE a.post_id = $1
             ORDER BY uu.id ASC`,
            [id]
        );

        const attachments = await client.query(
            `SELECT id, post_id, original_name, mime_type, size_bytes, uploaded_by, uploaded_at
             FROM team_post_attachments
             WHERE post_id = $1
             ORDER BY uploaded_at DESC, id DESC`,
            [id]
        );

        const comments = await client.query(
            `SELECT c.id, c.post_id, c.user_id, u.name AS user_name, c.content, c.created_at
             FROM team_post_comments c
             JOIN users u ON u.id = c.user_id
             WHERE c.post_id = $1
             ORDER BY c.created_at ASC, c.id ASC`,
            [id]
        );

        return res.json({
            item: {
                ...post.rows[0],
                assignees: assignees.rows,
                attachments: attachments.rows,
                comments: comments.rows
            }
        });
    } catch (err) {
        logger.error('[/api/team/posts/:postId] failed:', err);
        return res.status(500).json({ message: '取得詳情失敗', requestId: req.requestId });
    } finally {
        client.release();
    }
});

// PATCH /api/team/posts/:postId/status
// body: { status }
router.patch('/team/posts/:postId/status', async (req, res) => {
    const { postId } = req.params;
    const id = parseInt(String(postId), 10);
    const { status } = req.body || {};
    const safeStatus = String(status || '').trim();

    if (!Number.isFinite(id)) return res.status(400).json({ message: 'postId 無效', requestId: req.requestId });
    if (!VALID_STATUSES.has(safeStatus)) return res.status(400).json({ message: 'status 無效', requestId: req.requestId });

    const client = await pool.connect();
    const io = req.app.get('io');
    try {
        const allowed = await canManagePost(client, id, req.user);
        if (!allowed) return res.status(403).json({ message: '權限不足', requestId: req.requestId });

        const updated = await client.query(
            `UPDATE team_posts SET status = $1 WHERE id = $2 RETURNING id, status, updated_at`,
            [safeStatus, id]
        );
        if (updated.rowCount === 0) return res.status(404).json({ message: '找不到資料', requestId: req.requestId });

        io?.emit('team_post_changed', { action: 'status', postId: id });
        return res.json({ message: '已更新', item: updated.rows[0] });
    } catch (err) {
        logger.error('[/api/team/posts/:postId/status] failed:', err);
        return res.status(500).json({ message: '更新狀態失敗', requestId: req.requestId });
    } finally {
        client.release();
    }
});

// POST /api/team/posts/:postId/comments
// body: { content }
router.post('/team/posts/:postId/comments', async (req, res) => {
    const { postId } = req.params;
    const id = parseInt(String(postId), 10);
    const userId = req.user.id;
    const content = String(req.body?.content || '').trim().slice(0, 2000);

    if (!Number.isFinite(id)) return res.status(400).json({ message: 'postId 無效', requestId: req.requestId });
    if (!content) return res.status(400).json({ message: '請提供留言內容（content）', requestId: req.requestId });

    const io = req.app.get('io');

    try {
        const exists = await pool.query('SELECT 1 FROM team_posts WHERE id = $1', [id]);
        if (exists.rowCount === 0) return res.status(404).json({ message: '找不到資料', requestId: req.requestId });

        const inserted = await pool.query(
            `INSERT INTO team_post_comments (post_id, user_id, content)
             VALUES ($1, $2, $3)
             RETURNING id, created_at`,
            [id, userId, content]
        );

        io?.emit('team_post_changed', { action: 'comment', postId: id });
        return res.status(201).json({ message: '已留言', id: inserted.rows[0].id, created_at: inserted.rows[0].created_at });
    } catch (err) {
        logger.error('[/api/team/posts/:postId/comments] failed:', err);
        return res.status(500).json({ message: '留言失敗', requestId: req.requestId });
    }
});

// GET /api/team/posts/:postId/attachments
router.get('/team/posts/:postId/attachments', async (req, res) => {
    const { postId } = req.params;
    const id = parseInt(String(postId), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'postId 無效', requestId: req.requestId });

    try {
        const rows = await pool.query(
            `SELECT id, post_id, original_name, mime_type, size_bytes, uploaded_by, uploaded_at
             FROM team_post_attachments
             WHERE post_id = $1
             ORDER BY uploaded_at DESC, id DESC`,
            [id]
        );
        return res.json({ items: rows.rows });
    } catch (err) {
        logger.error('[/api/team/posts/:postId/attachments] failed:', err);
        return res.status(500).json({ message: '取得附件失敗', requestId: req.requestId });
    }
});

// GET /api/team/posts/:postId/attachments/:attachmentId/download
router.get('/team/posts/:postId/attachments/:attachmentId/download', async (req, res) => {
    const { postId, attachmentId } = req.params;
    const pid = parseInt(String(postId), 10);
    const aid = parseInt(String(attachmentId), 10);

    if (!Number.isFinite(pid) || !Number.isFinite(aid)) {
        return res.status(400).json({ message: '參數無效', requestId: req.requestId });
    }

    try {
        const result = await pool.query(
            `SELECT storage_key, original_name, mime_type
             FROM team_post_attachments
             WHERE id = $1 AND post_id = $2`,
            [aid, pid]
        );
        if (result.rowCount === 0) return res.status(404).json({ message: '找不到附件', requestId: req.requestId });

        const row = result.rows[0];
        const filePath = path.join(__dirname, '..', '..', row.storage_key);
        if (!fs.existsSync(filePath)) return res.status(404).json({ message: '附件檔案不存在', requestId: req.requestId });

        res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
        const filename = row.original_name ? String(row.original_name).replace(/\r|\n/g, '') : `attachment-${aid}`;
        const inline = String(req.query.inline || '').trim() === '1' || String(req.query.inline || '').toLowerCase() === 'true';
        res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(filename)}"`);

        const stream = fs.createReadStream(filePath);
        stream.on('error', (e) => {
            logger.error('team attachment stream error:', e);
            if (!res.headersSent) res.status(500).json({ message: '讀取附件失敗', requestId: req.requestId });
        });
        return stream.pipe(res);
    } catch (err) {
        logger.error('[/api/team/posts/:postId/attachments/:attachmentId/download] failed:', err);
        return res.status(500).json({ message: '下載附件失敗', requestId: req.requestId });
    }
});

// POST /api/team/posts/:postId/attachments
// form-data: files[]
router.post('/team/posts/:postId/attachments', attachmentUpload.array('files', 5), async (req, res) => {
    const { postId } = req.params;
    const id = parseInt(String(postId), 10);
    const userId = req.user?.id;
    const files = Array.isArray(req.files) ? req.files : [];

    if (!Number.isFinite(id)) return res.status(400).json({ message: 'postId 無效', requestId: req.requestId });
    if (!files.length) return res.status(400).json({ message: '請上傳附件檔案（files）', requestId: req.requestId });

    const io = req.app.get('io');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const exists = await client.query('SELECT 1 FROM team_posts WHERE id = $1', [id]);
        if (exists.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: '找不到資料', requestId: req.requestId });
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

            const ext = safeExt(f.originalname, fallbackExt);
            const key = `${id}-${Date.now()}-${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')}${ext}`;
            const abs = path.join(baseDir, key);
            fs.writeFileSync(abs, f.buffer);

            const storageKey = path.join('uploads', 'team_post_attachments', key);

            const inserted = await client.query(
                `INSERT INTO team_post_attachments (
                    post_id, storage_key, original_name, mime_type, size_bytes, uploaded_by
                 ) VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING id, post_id, original_name, mime_type, size_bytes, uploaded_by, uploaded_at`,
                [
                    id,
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

        io?.emit('team_post_changed', { action: 'attachment', postId: id });

        return res.status(201).json({ message: '附件已上傳', items: saved });
    } catch (err) {
        await client.query('ROLLBACK');
        logger.error('[/api/team/posts/:postId/attachments] upload failed:', err);
        return res.status(500).json({ message: '上傳附件失敗', requestId: req.requestId });
    } finally {
        client.release();
    }
});

module.exports = router;
