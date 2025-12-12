// backend/src/routes/taskRoutes.js
// 任務與使用者相關通用端點（需先通過 authenticateToken）

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const logger = require('../utils/logger');

// GET /api/tasks
// 依使用者角色返回任務列表，與傳統 index.js 實作保持一致
router.get('/tasks', async (req, res) => {
    try {
        const { id: userId, role } = req.user;
        logger.debug(`[/api/tasks] 使用者請求 - ID: ${userId}, 角色: ${role}`);
        if (!role) return res.status(403).json({ message: '使用者角色無效' });

        const query = `
            SELECT 
                o.id, o.voucher_number, o.customer_name, o.status, p.name as picker_name,
                (CASE WHEN o.status = 'picking' THEN picker_u.name WHEN o.status = 'packing' THEN packer_u.name ELSE NULL END) as current_user,
                (CASE WHEN o.status IN ('pending', 'picking') THEN 'pick' WHEN o.status IN ('picked', 'packing') THEN 'pack' END) as task_type,
                COALESCE(o.is_urgent, FALSE) as is_urgent,
                COUNT(DISTINCT tc.id) as total_comments,
                COUNT(DISTINCT tc.id) FILTER (WHERE tc.priority = 'urgent') as urgent_comments,
                COUNT(DISTINCT CASE 
                    WHEN NOT EXISTS (
                        SELECT 1 FROM task_comment_reads tcr 
                        WHERE tcr.comment_id = tc.id AND tcr.user_id = $1
                    ) AND tc.user_id != $1
                    THEN tc.id 
                END) as unread_comments,
                (SELECT json_build_object(
                    'content', tc2.content,
                    'user_name', u.name,
                    'priority', tc2.priority,
                    'created_at', tc2.created_at
                ) FROM task_comments tc2
                LEFT JOIN users u ON tc2.user_id = u.id
                WHERE tc2.order_id = o.id
                ORDER BY tc2.created_at DESC
                LIMIT 1) as latest_comment
            FROM orders o
            LEFT JOIN users p ON o.picker_id = p.id 
            LEFT JOIN users picker_u ON o.picker_id = picker_u.id 
            LEFT JOIN users packer_u ON o.packer_id = packer_u.id
            LEFT JOIN task_comments tc ON tc.order_id = o.id
            WHERE 
                ($2 = 'admin' AND o.status IN ('pending', 'picking', 'picked', 'packing')) OR
                ($2 = 'picker' AND (o.status = 'pending' OR (o.status = 'picking' AND o.picker_id = $1))) OR
                ($2 = 'packer' AND (o.status = 'picked' OR (o.status = 'packing' AND o.packer_id = $1)))
            GROUP BY o.id, o.voucher_number, o.customer_name, o.status, o.created_at, p.name, picker_u.name, packer_u.name
            ORDER BY 
                COUNT(DISTINCT tc.id) FILTER (WHERE tc.priority = 'urgent') DESC,
                COALESCE(o.is_urgent, FALSE) DESC, 
                o.created_at ASC;
        `;

        logger.debug(`[/api/tasks] 執行查詢，參數: userId=${userId}, role=${role}`);
        const result = await pool.query(query, [userId, role]);
        logger.info(`[/api/tasks] 查詢結果: 找到 ${result.rows.length} 筆任務`);
        if (result.rows.length > 0) {
            logger.debug(`[/api/tasks] 第一筆任務:`, JSON.stringify(result.rows[0]));
        }
        res.json(result.rows);
    } catch (error) {
        logger.error('[/api/tasks] 獲取任務失敗:', error);
        logger.error('[/api/tasks] 錯誤詳情:', {
            message: error.message,
            stack: error.stack,
            code: error.code
        });
        res.status(500).json({ 
            message: '獲取任務失敗', 
            error: error.message,
            hint: error.code === '42P01' ? '資料表不存在，請執行資料庫遷移' : undefined
        });
    }
});

// GET /api/users/basic
// 提供任務介面所需的基本使用者清單
router.get('/users/basic', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, name FROM users ORDER BY id ASC');
        res.json(result.rows);
    } catch (error) {
        logger.error('[/api/users/basic] 取得使用者清單失敗:', error);
        res.status(500).json({ message: '取得使用者清單失敗' });
    }
});

// GET /api/tasks/completed
// 獲取已完成的任務列表
router.get('/tasks/completed', async (req, res) => {
    try {
        const { id: userId, role } = req.user;
        const limit = parseInt(req.query.limit) || 50;
        
        let query = `
            SELECT 
                o.id, o.voucher_number, o.customer_name, o.status, p.name as picker_name,
                pk.name as packer_name,
                o.updated_at as completed_at,
                (CASE WHEN o.status = 'completed' THEN 'done' ELSE 'picked' END) as task_type
            FROM orders o
            LEFT JOIN users p ON o.picker_id = p.id 
            LEFT JOIN users pk ON o.packer_id = pk.id
            WHERE 
        `;
        
        const params = [userId, limit];
        
        if (role === 'admin') {
            query += `o.status = 'completed'`;
            // Admin doesn't need userId param for filtering, but we keep it in params array for index consistency if needed, 
            // actually let's adjust params.
            // For admin, we just want completed orders.
            // Let's rewrite the params logic.
        } else if (role === 'picker') {
            // Picker sees orders they picked that are now picked, packing or completed
            query += `o.picker_id = $1 AND o.status IN ('picked', 'packing', 'completed')`;
        } else if (role === 'packer') {
            // Packer sees orders they packed that are now completed
            query += `o.packer_id = $1 AND o.status = 'completed'`;
        } else {
            return res.json([]);
        }
        
        query += ` ORDER BY o.updated_at DESC LIMIT $2`;
        
        // Adjust params based on role
        const queryParams = role === 'admin' ? [limit] : [userId, limit];
        // Fix query placeholder for admin
        if (role === 'admin') {
             query = `
                SELECT 
                    o.id, o.voucher_number, o.customer_name, o.status, p.name as picker_name,
                    pk.name as packer_name,
                    o.updated_at as completed_at,
                    'done' as task_type
                FROM orders o
                LEFT JOIN users p ON o.picker_id = p.id 
                LEFT JOIN users pk ON o.packer_id = pk.id
                WHERE o.status = 'completed'
                ORDER BY o.updated_at DESC LIMIT $1
            `;
        }

        const result = await pool.query(query, queryParams);
        res.json(result.rows);
    } catch (error) {
        logger.error('[/api/tasks/completed] 獲取已完成任務失敗:', error);
        res.status(500).json({ message: '獲取已完成任務失敗' });
    }
});

module.exports = router;
