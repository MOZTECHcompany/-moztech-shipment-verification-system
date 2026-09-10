// backend/src/routes/maintenanceRoutes.js
// 資料庫遷移與診斷端點

const express = require('express');
const { pool } = require('../config/database');
const logger = require('../utils/logger');
const { authorizeAdmin } = require('../middleware/auth');

const router = express.Router();

router.post('/migrate/add-priority-test', async (req, res) => {
    const client = await pool.connect();
    try {
        logger.info('[Migration TEST] 開始添加 priority 欄位...');

        const checkColumn = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'task_comments' AND column_name = 'priority'
        `);

        if (checkColumn.rows.length > 0) {
            logger.info('[Migration TEST] priority 欄位已存在');
            return res.json({ 
                success: true, 
                message: 'priority 欄位已存在，無需添加',
                alreadyExists: true
            });
        }

        await client.query('BEGIN');

        await client.query(`
            ALTER TABLE task_comments 
            ADD COLUMN priority VARCHAR(20) DEFAULT 'normal'
        `);
        logger.info('[Migration TEST] priority 欄位添加成功');

        await client.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'check_priority'
                ) THEN
                    ALTER TABLE task_comments 
                    ADD CONSTRAINT check_priority 
                    CHECK (priority IN ('normal', 'important', 'urgent'));
                END IF;
            END $$;
        `);
        logger.info('[Migration TEST] 優先級約束添加成功');

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_task_comments_priority 
            ON task_comments(priority)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_task_comments_order_priority 
            ON task_comments(order_id, priority)
        `);
        logger.info('[Migration TEST] 索引創建成功');

        await client.query('COMMIT');

        const stats = await client.query('SELECT COUNT(*) as count FROM task_comments');

        logger.info(`[Migration TEST] 資料庫更新完成，評論總數: ${stats.rows[0].count}`);

        res.json({ 
            success: true, 
            message: '資料庫遷移成功（測試端點）',
            totalComments: stats.rows[0].count,
            alreadyExists: false
        });

    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('[Migration TEST] 執行失敗:', error);
        res.status(500).json({ 
            success: false, 
            message: '資料庫遷移失敗',
            error: error.message 
        });
    } finally {
        client.release();
    }
});

router.post('/admin/migrate/add-priority', authorizeAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        logger.info('[Migration] 開始添加 priority 欄位...');

        const checkColumn = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'task_comments' AND column_name = 'priority'
        `);

        if (checkColumn.rows.length > 0) {
            logger.info('[Migration] priority 欄位已存在');
            return res.json({ 
                success: true, 
                message: 'priority 欄位已存在，無需添加',
                alreadyExists: true
            });
        }

        await client.query('BEGIN');

        await client.query(`
            ALTER TABLE task_comments 
            ADD COLUMN priority VARCHAR(20) DEFAULT 'normal'
        `);
        logger.info('[Migration] priority 欄位添加成功');

        await client.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'check_priority'
                ) THEN
                    ALTER TABLE task_comments 
                    ADD CONSTRAINT check_priority 
                    CHECK (priority IN ('normal', 'important', 'urgent'));
                END IF;
            END $$;
        `);
        logger.info('[Migration] 優先級約束添加成功');

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_task_comments_priority 
            ON task_comments(priority)
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_task_comments_order_priority 
            ON task_comments(order_id, priority)
        `);
        logger.info('[Migration] 索引創建成功');

        await client.query('COMMIT');

        const stats = await client.query('SELECT COUNT(*) as count FROM task_comments');

        logger.info(`[Migration] 資料庫更新完成，評論總數: ${stats.rows[0].count}`);

        res.json({ 
            success: true, 
            message: '資料庫遷移成功',
            totalComments: stats.rows[0].count,
            alreadyExists: false
        });

    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('[Migration] 執行失敗:', error);
        res.status(500).json({ 
            success: false, 
            message: '資料庫遷移失敗',
            error: error.message 
        });
    } finally {
        client.release();
    }
});

router.get('/debug/tables', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name;
        `);
        res.json({ 
            tables: result.rows.map(r => r.table_name),
            count: result.rows.length 
        });
    } catch (error) {
        logger.error('[/api/debug/tables] 錯誤:', error);
        res.status(500).json({ message: '檢查資料表失敗', error: error.message });
    }
});

router.get('/debug/check-comment-reads', async (req, res) => {
    try {
        const checkTable = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'task_comment_reads'
            );
        `);

        const tableExists = checkTable.rows[0].exists;

        if (tableExists) {
            const count = await pool.query('SELECT COUNT(*) FROM task_comment_reads');
            res.json({ 
                tableExists: true, 
                recordCount: parseInt(count.rows[0].count, 10),
                status: 'OK'
            });
        } else {
            res.json({ 
                tableExists: false, 
                status: 'MISSING',
                message: '需要執行 005_comment_read_tracking.sql 遷移'
            });
        }
    } catch (error) {
        logger.error('[/api/debug/check-comment-reads] 錯誤:', error);
        res.status(500).json({ message: '檢查失敗', error: error.message });
    }
});

module.exports = router;
