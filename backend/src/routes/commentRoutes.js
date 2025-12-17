// backend/src/routes/commentRoutes.js
// 任務評論、提及、協作與活躍會話端點（需先通過 authenticateToken）

const express = require('express');
const { pool } = require('../config/database');
const logger = require('../utils/logger');
const { authorizeAdmin, authorizeRoles } = require('../middleware/auth');
const { logOperation } = require('../services/operationLogService');

const router = express.Router();

const rateMap = new Map();
function rateLimit(key, limit, windowMs = 60_000) {
    const now = Date.now();
    const record = rateMap.get(key) || { count: 0, windowStart: now };
    if (now - record.windowStart > windowMs) {
        record.count = 0;
        record.windowStart = now;
    }
    record.count++;
    rateMap.set(key, record);
    return record.count <= limit;
}

router.get('/tasks/:orderId/comments', async (req, res) => {
    const { orderId } = req.params;
    const { after, limit } = req.query;
    const pageSize = Math.min(Math.max(parseInt(limit || '50', 10), 1), 200);
    const client = await pool.connect();
    try {
        const agg = await client.query(
            `SELECT COUNT(*)::int AS total, MAX(updated_at) AS latest FROM task_comments WHERE order_id = $1`,
            [orderId]
        );
        const total = agg.rows[0]?.total || 0;
        const latest = agg.rows[0]?.latest || null;
        const unreadAgg = await client.query(
            `SELECT COUNT(*)::int AS unread
               FROM task_mentions tm
               JOIN task_comments c ON c.id = tm.comment_id
              WHERE c.order_id = $1 AND tm.mentioned_user_id = $2 AND tm.is_read = FALSE`,
            [orderId, req.user.id]
        );
        const unreadMentions = unreadAgg.rows[0]?.unread || 0;
        const etag = `W/"comments:${orderId}:u${req.user.id}:${total}:${latest ? new Date(latest).getTime() : 0}:unread:${unreadMentions}"`;
        res.setHeader('ETag', etag);

        const ifNoneMatch = req.headers['if-none-match'];
        if (ifNoneMatch && ifNoneMatch === etag && !after) {
            return res.status(304).end();
        }

        const params = [orderId];
        let where = 'c.order_id = $1';
        if (after) {
            const afterDate = new Date(after);
            if (!Number.isNaN(afterDate.getTime())) {
                params.push(afterDate);
                where += ` AND c.created_at > $${params.length}`;
            }
        }
        const userParamIndex = params.length + 1;
        params.push(req.user.id);
        const limitParamIndex = params.length + 1;
        params.push(pageSize);

        const comments = await client.query(
            `SELECT 
                c.id,
                c.content,
                c.parent_id,
                c.priority,
                c.created_at,
                c.updated_at,
                u.id as user_id,
                u.username,
                u.name as user_name,
                (tm.id IS NOT NULL) AS mentioned_me,
                COALESCE(tm.is_read, FALSE) AS mention_is_read
            FROM task_comments c
            LEFT JOIN users u ON c.user_id = u.id
            LEFT JOIN task_mentions tm 
              ON tm.comment_id = c.id 
             AND tm.mentioned_user_id = $${userParamIndex}
            WHERE ${where}
            ORDER BY c.created_at ASC
            LIMIT $${limitParamIndex}
            `,
            params
        );

        const nextCursor = comments.rows.length > 0
            ? comments.rows[comments.rows.length - 1].created_at
            : null;

        res.json({ items: comments.rows, nextCursor, total, unreadMentions });
    } catch (error) {
        logger.error('[/api/tasks/:orderId/comments] 獲取評論失敗:', error);
        res.status(500).json({ code: 'COMMENTS_FETCH_FAILED', message: '獲取評論失敗', requestId: req.requestId });
    } finally {
        client.release();
    }
});

router.post('/tasks/:orderId/comments', async (req, res) => {
    const { orderId } = req.params;
    const { content, parent_id, priority = 'normal' } = req.body;
    const { id: userId } = req.user;
    const io = req.app.get('io');

    if (!content || !content.trim()) {
        return res.status(400).json({ code: 'VALIDATION_ERROR', message: '評論內容不能為空', requestId: req.requestId });
    }
    if (content.length > 2000) {
        return res.status(413).json({ code: 'CONTENT_TOO_LONG', message: '評論內容過長（最大 2000 字）', requestId: req.requestId });
    }
    if (!rateLimit(`comment:create:${userId}`, 20)) {
        return res.status(429).json({ code: 'RATE_LIMITED', message: '發送太頻繁，請稍後再試', requestId: req.requestId });
    }

    const validPriorities = ['normal', 'important', 'urgent'];
    if (!validPriorities.includes(priority)) {
        return res.status(400).json({ code: 'INVALID_PRIORITY', message: '無效的優先級', requestId: req.requestId });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const orderExist = await client.query('SELECT id FROM orders WHERE id = $1', [orderId]);
        if (orderExist.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ code: 'ORDER_NOT_FOUND', message: '找不到指定的訂單', requestId: req.requestId });
        }

        const result = await client.query(`
            INSERT INTO task_comments (order_id, user_id, content, parent_id, priority)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, created_at
        `, [orderId, userId, content, parent_id, priority]);

        const commentId = result.rows[0].id;

        const mentionRegex = /@([A-Za-z0-9._-]+)/g;
        const mentions = content.match(mentionRegex);

        if (mentions) {
            const usernames = [...new Set(mentions.map(m => m.slice(1)))]
                .filter(Boolean)
                .slice(0, 20);

            for (const username of usernames) {
                const userResult = await client.query(
                    'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
                    [username]
                );

                if (userResult.rows.length > 0) {
                    await client.query(`
                        INSERT INTO task_mentions (comment_id, mentioned_user_id)
                        VALUES ($1, $2)
                    `, [commentId, userResult.rows[0].id]);

                    io?.emit('new_mention', {
                        userId: userResult.rows[0].id,
                        orderId,
                        commentId,
                        content: content.slice(0, 100),
                        priority
                    });
                }
            }
        }

        await client.query('COMMIT');

        io?.emit('new_comment', {
            orderId,
            commentId,
            userId,
            content,
            priority
        });

        res.status(201).json({
            message: '評論已發送',
            id: commentId,
            created_at: result.rows[0].created_at
        });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('[/api/tasks/:orderId/comments] 新增評論失敗:', error);
        if (error && (error.code === '42703' || /column\s+"?priority"?/i.test(error.message || ''))) {
            return res.status(500).json({
                message: '發送評論失敗：資料庫缺少 task_comments.priority 欄位，請先執行遷移。',
                code: 'SCHEMA_MISSING_COLUMN',
                hint: '請以管理員身份呼叫 /api/admin/migrate/add-priority 或使用前端 migrate.html 執行遷移',
                requestId: req.requestId
            });
        }
        res.status(500).json({ code: 'COMMENTS_CREATE_FAILED', message: '發送評論失敗', requestId: req.requestId });
    } finally {
        client.release();
    }
});

router.patch('/tasks/:orderId/comments/:commentId/retract', async (req, res) => {
    const { orderId, commentId } = req.params;
    const requester = req.user;
    const io = req.app.get('io');
    if (!rateLimit(`comment:retract:${requester.id}`, 5)) {
        return res.status(429).json({ code: 'RATE_LIMITED', message: '操作太頻繁，請稍後再試', requestId: req.requestId });
    }
    try {
        const info = await pool.query('SELECT user_id FROM task_comments WHERE id = $1 AND order_id = $2', [commentId, orderId]);
        if (info.rowCount === 0) return res.status(404).json({ code: 'COMMENT_NOT_FOUND', message: '找不到評論', requestId: req.requestId });
        const ownerId = info.rows[0].user_id;
        const isOwner = Number(ownerId) === Number(requester.id);
        const isAdmin = String(requester.role || '').toLowerCase() === 'admin';
        if (!isOwner && !isAdmin) return res.status(403).json({ code: 'FORBIDDEN', message: '無權撤回此評論', requestId: req.requestId });

        await pool.query('UPDATE task_comments SET content = $1, updated_at = NOW() WHERE id = $2', ['[已撤回]', commentId]);

        io?.emit('comment_retracted', { orderId, commentId });
        res.json({ message: '評論已撤回' });
    } catch (error) {
        logger.error('[/api/tasks/:orderId/comments/:commentId/retract] 失敗:', error);
        res.status(500).json({ code: 'COMMENTS_RETRACT_FAILED', message: '撤回評論失敗', requestId: req.requestId });
    }
});

router.patch('/tasks/:orderId/mentions/:commentId/read', async (req, res) => {
    const { orderId, commentId } = req.params;
    const userId = req.user.id;
    try {
        const chk = await pool.query('SELECT 1 FROM task_comments WHERE id = $1 AND order_id = $2', [commentId, orderId]);
        if (chk.rowCount === 0) return res.status(404).json({ code: 'COMMENT_NOT_FOUND', message: '找不到評論', requestId: req.requestId });
        const result = await pool.query(
            `UPDATE task_mentions SET is_read = TRUE 
              WHERE comment_id = $1 AND mentioned_user_id = $2`,
            [commentId, userId]
        );
        res.json({ message: '已標記為已讀', updated: result.rowCount });
    } catch (error) {
        logger.error('[/api/tasks/:orderId/mentions/:commentId/read] 標記已讀失敗:', error);
        res.status(500).json({ code: 'MENTION_MARK_READ_FAILED', message: '標記提及為已讀失敗', requestId: req.requestId });
    }
});

router.post('/tasks/:orderId/comments/:commentId/read', async (req, res) => {
    const { orderId, commentId } = req.params;
    const userId = req.user.id;

    try {
        const chk = await pool.query('SELECT 1 FROM task_comments WHERE id = $1 AND order_id = $2', [commentId, orderId]);
        if (chk.rowCount === 0) {
            return res.status(404).json({ message: '找不到評論' });
        }

        await pool.query(`
            INSERT INTO task_comment_reads (comment_id, user_id, read_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (comment_id, user_id) 
            DO UPDATE SET read_at = NOW()
        `, [commentId, userId]);

        res.json({ message: '已標記為已讀' });
    } catch (error) {
        logger.error('[/api/tasks/:orderId/comments/:commentId/read] 標記已讀失敗:', error);
        res.status(500).json({ message: '標記已讀失敗' });
    }
});

router.post('/tasks/:orderId/comments/mark-all-read', async (req, res) => {
    const { orderId } = req.params;
    const userId = req.user.id;

    try {
        const comments = await pool.query(
            'SELECT id FROM task_comments WHERE order_id = $1',
            [orderId]
        );

        if (comments.rows.length === 0) {
            return res.json({ message: '沒有評論需要標記', count: 0 });
        }

        const values = comments.rows.map((c, idx) => 
            `($${idx * 2 + 1}, $${idx * 2 + 2}, NOW())`
        ).join(',');

        const params = comments.rows.flatMap(c => [c.id, userId]);

        await pool.query(`
            INSERT INTO task_comment_reads (comment_id, user_id, read_at)
            VALUES ${values}
            ON CONFLICT (comment_id, user_id) 
            DO UPDATE SET read_at = NOW()
        `, params);

        res.json({ 
            message: `已標記 ${comments.rows.length} 則評論為已讀`,
            count: comments.rows.length 
        });
    } catch (error) {
        logger.error('[/api/tasks/:orderId/comments/mark-all-read] 批次標記已讀失敗:', error);
        res.status(500).json({ message: '批次標記已讀失敗' });
    }
});

router.get('/comments/unread-summary', async (req, res) => {
    const userId = req.user.id;

    try {
        const result = await pool.query(`
            SELECT 
                o.id as order_id,
                o.voucher_number,
                o.customer_name,
                COUNT(DISTINCT tc.id) as unread_count,
                COUNT(DISTINCT tc.id) FILTER (WHERE tc.priority = 'urgent') as urgent_count,
                MAX(tc.created_at) as latest_comment_time
            FROM orders o
            INNER JOIN task_comments tc ON tc.order_id = o.id
            WHERE NOT EXISTS (
                SELECT 1 FROM task_comment_reads tcr 
                WHERE tcr.comment_id = tc.id AND tcr.user_id = $1
            )
            AND tc.user_id != $1
            AND o.status IN ('pending', 'picking', 'picked', 'packing')
            GROUP BY o.id, o.voucher_number, o.customer_name
            HAVING COUNT(DISTINCT tc.id) > 0
            ORDER BY 
                COUNT(DISTINCT tc.id) FILTER (WHERE tc.priority = 'urgent') DESC,
                MAX(tc.created_at) DESC
        `, [userId]);

        const totalUnread = result.rows.reduce((sum, row) => sum + parseInt(row.unread_count, 10), 0);
        const totalUrgent = result.rows.reduce((sum, row) => sum + parseInt(row.urgent_count, 10), 0);

        res.json({
            total_unread: totalUnread,
            total_urgent: totalUrgent,
            orders: result.rows
        });
    } catch (error) {
        logger.error('[/api/comments/unread-summary] 獲取未讀統計失敗:', error);
        res.status(500).json({ message: '獲取未讀統計失敗' });
    }
});

router.get('/tasks/:orderId/mentions', async (req, res) => {
    const { orderId } = req.params;
    const { status = 'unread', limit = 20 } = req.query;
    const pageSize = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    try {
        const rows = await pool.query(
            `SELECT tm.comment_id, tm.is_read, tm.created_at,
                    c.content, c.created_at AS comment_created_at,
                    u.username
               FROM task_mentions tm
               JOIN task_comments c ON c.id = tm.comment_id
               JOIN users u ON c.user_id = u.id
              WHERE c.order_id = $1 AND tm.mentioned_user_id = $2
                ${status === 'unread' ? 'AND tm.is_read = FALSE' : ''}
              ORDER BY tm.created_at DESC
              LIMIT $3`,
            [orderId, req.user.id, pageSize]
        );
        res.json({ items: rows.rows, total: rows.rows.length });
    } catch (error) {
        logger.error('[/api/tasks/:orderId/mentions] 取得提及列表失敗:', error);
        res.status(500).json({ code: 'MENTIONS_LIST_FAILED', message: '取得提及列表失敗', requestId: req.requestId });
    }
});

async function ensurePinsTable(client) {
    await client.query(`CREATE TABLE IF NOT EXISTS task_comment_pins (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        comment_id INTEGER NOT NULL REFERENCES task_comments(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(order_id, user_id, comment_id)
    )`);
}

async function ensureTaskPinsTable(client) {
    await client.query(`CREATE TABLE IF NOT EXISTS task_pins (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE UNIQUE,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
}

router.get('/tasks/pins', async (req, res) => {
    const client = await pool.connect();
    try {
        await ensureTaskPinsTable(client);
        const rows = await client.query('SELECT order_id FROM task_pins');
        res.json({ pinned: rows.rows.map(r => r.order_id) });
    } catch (e) {
        logger.error('[/api/tasks/pins] 取得置頂任務失敗:', e);
        res.status(500).json({ message: '取得置頂任務失敗' });
    } finally { client.release(); }
});

// 設定/取消任務置頂（團隊共享）
// admin/superadmin：可操作所有訂單
// dispatcher：僅可操作自己拋單(imported_by_user_id)的訂單
router.put('/tasks/pins/:orderId', authorizeRoles('admin', 'dispatcher'), async (req, res) => {
    const { orderId } = req.params;
    const { pinned } = req.body;
    const userId = req.user?.id || null;
    const io = req.app.get('io');
    const client = await pool.connect();
    try {
        await ensureTaskPinsTable(client);

        if (req.user?.role === 'dispatcher') {
            const own = await client.query(
                'SELECT 1 FROM orders WHERE id = $1 AND imported_by_user_id = $2',
                [orderId, userId]
            );
            if (own.rowCount === 0) {
                return res.status(403).json({ message: '僅允許操作自己拋單的訂單' });
            }
        }

        if (pinned) {
            await client.query('INSERT INTO task_pins (order_id, created_by) VALUES ($1, $2) ON CONFLICT (order_id) DO NOTHING', [orderId, userId]);
        } else {
            await client.query('DELETE FROM task_pins WHERE order_id = $1', [orderId]);
        }
        io?.emit('task_pin_changed', { orderId: Number(orderId), pinned: !!pinned });
        res.json({ success: true });
    } catch (e) {
        logger.error('[/api/tasks/pins/:orderId] 更新任務置頂失敗:', e);
        res.status(500).json({ message: '更新置頂狀態失敗' });
    } finally { client.release(); }
});

router.get('/tasks/:orderId/pins', async (req, res) => {
    const { orderId } = req.params;
    const userId = req.user.id;
    const client = await pool.connect();
    try {
        await ensurePinsTable(client);
        const rows = await client.query(`
            SELECT c.*, u.name as user_name, u.username
            FROM task_comment_pins p
            JOIN task_comments c ON p.comment_id = c.id
            LEFT JOIN users u ON c.user_id = u.id
            WHERE p.order_id = $1 AND p.user_id = $2
            ORDER BY c.created_at ASC
        `, [orderId, userId]);
        res.json({ pinned: rows.rows });
    } catch (e) {
        logger.error('[/api/tasks/:orderId/pins] 取得置頂清單失敗:', e);
        res.status(500).json({ message: '取得置頂清單失敗' });
    } finally { client.release(); }
});

router.put('/tasks/:orderId/pins/:commentId', async (req, res) => {
    const { orderId, commentId } = req.params;
    const { pinned } = req.body;
    const userId = req.user.id;
    const client = await pool.connect();
    try {
        await ensurePinsTable(client);
        if (pinned) {
            await client.query('INSERT INTO task_comment_pins (order_id, user_id, comment_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [orderId, userId, commentId]);
        } else {
            await client.query('DELETE FROM task_comment_pins WHERE order_id = $1 AND user_id = $2 AND comment_id = $3', [orderId, userId, commentId]);
        }
        res.json({ success: true });
    } catch (e) {
        logger.error('[/api/tasks/:orderId/pins/:commentId] 更新置頂失敗:', e);
        res.status(500).json({ message: '更新置頂狀態失敗' });
    } finally { client.release(); }
});

router.delete('/tasks/:orderId/comments/:commentId', async (req, res) => {
    const { orderId, commentId } = req.params;
    const requester = req.user;
    const io = req.app.get('io');
    if (!rateLimit(`comment:delete:${requester.id}`, 5)) {
        return res.status(429).json({ code: 'RATE_LIMITED', message: '操作太頻繁，請稍後再試', requestId: req.requestId });
    }
    try {
        const info = await pool.query('SELECT user_id FROM task_comments WHERE id = $1 AND order_id = $2', [commentId, orderId]);
        if (info.rowCount === 0) return res.status(404).json({ code: 'COMMENT_NOT_FOUND', message: '找不到評論', requestId: req.requestId });
        const ownerId = info.rows[0].user_id;
        const isOwner = Number(ownerId) === Number(requester.id);
        const isAdmin = String(requester.role || '').toLowerCase() === 'admin';
        if (!isOwner && !isAdmin) return res.status(403).json({ code: 'FORBIDDEN', message: '無權刪除此評論', requestId: req.requestId });

        await pool.query('DELETE FROM task_comments WHERE id = $1', [commentId]);

        io?.emit('comment_deleted', { orderId, commentId });
        res.json({ message: '評論已刪除' });
    } catch (error) {
        logger.error('[/api/tasks/:orderId/comments/:commentId] 刪除失敗:', error);
        res.status(500).json({ code: 'COMMENTS_DELETE_FAILED', message: '刪除評論失敗', requestId: req.requestId });
    }
});

router.post('/tasks/:orderId/session', async (req, res) => {
    const { orderId } = req.params;
    const { session_type } = req.body;
    const { id: userId } = req.user;
    const io = req.app.get('io');

    try {
        await pool.query(`
            INSERT INTO active_sessions (order_id, user_id, session_type, last_activity)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            ON CONFLICT (order_id, user_id, session_type)
            DO UPDATE SET last_activity = CURRENT_TIMESTAMP
        `, [orderId, userId, session_type || 'viewing']);

        const activeSessions = await pool.query(`
            SELECT 
                s.user_id,
                s.session_type,
                s.last_activity,
                u.username,
                u.name
            FROM active_sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.order_id = $1 
            AND s.last_activity > NOW() - INTERVAL '5 minutes'
        `, [orderId]);

        io?.emit('active_sessions_update', {
            orderId,
            sessions: activeSessions.rows
        });

        res.json({ message: '會話已更新' });
    } catch (error) {
        logger.error('[/api/tasks/:orderId/session] 更新會話失敗:', error);
        res.status(500).json({ message: '更新會話失敗' });
    }
});

router.get('/tasks/:orderId/sessions', async (req, res) => {
    const { orderId } = req.params;

    try {
        const result = await pool.query(`
            SELECT 
                s.user_id,
                s.session_type,
                s.last_activity,
                u.username,
                u.name
            FROM active_sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.order_id = $1 
            AND s.last_activity > NOW() - INTERVAL '5 minutes'
            ORDER BY s.last_activity DESC
        `, [orderId]);

        res.json(result.rows);
    } catch (error) {
        logger.error('[/api/tasks/:orderId/sessions] 獲取會話失敗:', error);
        res.status(500).json({ message: '獲取會話失敗' });
    }
});

router.post('/tasks/:orderId/transfer', async (req, res) => {
    const { orderId } = req.params;
    const { to_user_id, task_type, reason } = req.body;
    const { id: fromUserId } = req.user;
    const io = req.app.get('io');

    if (!to_user_id || !task_type) {
        return res.status(400).json({ message: '缺少必要參數' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(`
            INSERT INTO task_assignments (order_id, from_user_id, to_user_id, task_type, reason)
            VALUES ($1, $2, $3, $4, $5)
        `, [orderId, fromUserId, to_user_id, task_type, reason]);

        if (task_type === 'pick') {
            await client.query(
                'UPDATE orders SET picker_id = $1 WHERE id = $2',
                [to_user_id, orderId]
            );
        } else if (task_type === 'pack') {
            await client.query(
                'UPDATE orders SET packer_id = $1 WHERE id = $2',
                [to_user_id, orderId]
            );
        }

        await client.query('COMMIT');

        await logOperation({
            userId: fromUserId,
            orderId,
            operationType: 'transfer',
            details: { to_user_id, task_type, reason },
            io
        });

        io?.emit('task_transferred', {
            orderId,
            from_user_id: fromUserId,
            to_user_id,
            task_type
        });

        res.json({ message: '任務已成功轉移' });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('[/api/tasks/:orderId/transfer] 任務轉移失敗:', error);
        res.status(500).json({ message: '任務轉移失敗' });
    } finally {
        client.release();
    }
});

module.exports = router;
