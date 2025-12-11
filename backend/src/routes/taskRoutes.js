// backend/src/routes/taskRoutes.js
// 任務與使用者相關通用端點（需先通過 authenticateToken）

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const logger = require('../utils/logger');

// GET /api/tasks
// 依使用者角色返回任務列表
router.get('/tasks', async (req, res) => {
    try {
        const { id: userId, role } = req.user;
        logger.debug(`[/api/tasks] 使用者請求 - ID: ${userId}, 角色: ${role}`);
        if (!role) return res.status(403).json({ message: '使用者角色無效' });

        // Note: task_comments logic removed for ERP integration as table doesn't exist yet.
        // Also mapped columns to match ERP schema (sales_orders)
        const query = `
            SELECT 
                o.id, 
                o.external_order_id as voucher_number, 
                'Unknown Customer' as customer_name, 
                o.status, 
                p.name as picker_name,
                (CASE WHEN o.status = 'picking' THEN picker_u.name WHEN o.status = 'packing' THEN packer_u.name ELSE NULL END) as current_user,
                (CASE WHEN o.status IN ('pending', 'picking') THEN 'pick' WHEN o.status IN ('picked', 'packing') THEN 'pack' END) as task_type,
                FALSE as is_urgent, 
                0 as total_comments,
                0 as urgent_comments,
                0 as unread_comments,
                NULL as latest_comment
            FROM sales_orders o
            LEFT JOIN users p ON o.picker_id = p.id 
            LEFT JOIN users picker_u ON o.picker_id = picker_u.id 
            LEFT JOIN users packer_u ON o.packer_id = packer_u.id
            WHERE 
                ($2 = 'admin' AND o.status IN ('pending', 'picking', 'picked', 'packing')) OR
                ($2 = 'picker' AND (o.status = 'pending' OR (o.status = 'picking' AND o.picker_id = $1))) OR
                ($2 = 'packer' AND (o.status = 'picked' OR (o.status = 'packing' AND o.packer_id = $1)))
            ORDER BY 
                o.created_at ASC;
        `;

        logger.debug(`[/api/tasks] 執行查詢，參數: userId=${userId}, role=${role}`);
        const result = await pool.query(query, [userId, role]);
        logger.info(`[/api/tasks] 查詢結果: 找到 ${result.rows.length} 筆任務`);
        res.json(result.rows);
    } catch (error) {
        logger.error('[/api/tasks] 獲取任務失敗:', error);
        res.status(500).json({ 
            message: '獲取任務失敗', 
            error: error.message
        });
    }
});

// GET /api/users/basic
// 提供任務介面所需的基本使用者清單
router.get('/users/basic', async (req, res) => {
    try {
        // ERP users table has email, name. Map email to username for legacy frontend.
        const result = await pool.query('SELECT id, email as username, name FROM users ORDER BY id ASC');
        res.json(result.rows);
    } catch (error) {
        logger.error('[/api/users/basic] 取得使用者清單失敗:', error);
        res.status(500).json({ message: '取得使用者清單失敗' });
    }
});

module.exports = router;
