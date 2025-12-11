// backend/src/routes/analyticsRoutes.js
// 操作日誌、報表與分析相關端點（需先通過 authenticateToken）

const express = require('express');
const Papa = require('papaparse');
const { pool } = require('../config/database');
const logger = require('../utils/logger');
const { authorizeAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/operation-logs
router.get('/operation-logs', authorizeAdmin, async (req, res) => {
    const { orderId, userId, startDate, endDate, actionType, limit = 100 } = req.query;

    logger.info(`[/api/operation-logs] 查詢操作日誌 - orderId: ${orderId}, userId: ${userId}, startDate: ${startDate}, endDate: ${endDate}, actionType: ${actionType}`);

    try {
        // Map to ERP audit_logs
        let query = `
            SELECT 
                al.id,
                al.user_id,
                al.resource_id as order_id,
                al.action as action_type,
                al.details,
                al.created_at,
                u.name as user_name,
                'unknown' as user_role,
                o.external_order_id as voucher_number,
                'Unknown' as customer_name,
                o.status as order_status
            FROM audit_logs al
            LEFT JOIN users u ON al.user_id = u.id
            LEFT JOIN sales_orders o ON al.resource_id = o.id
            WHERE al.resource = 'SalesOrder'
        `;

        const params = [];
        let paramCount = 1;

        if (orderId) {
            // Check if orderId is UUID or voucher number
            // If it's UUID (36 chars), assume ID. Else assume voucher number.
            if (orderId.length === 36) {
                query += ` AND al.resource_id = $${paramCount}`;
                params.push(orderId);
            } else {
                query += ` AND o.external_order_id ILIKE $${paramCount}`;
                params.push(`%${orderId}%`);
            }
            paramCount++;
        }

        if (userId) {
            query += ` AND al.user_id = $${paramCount}`;
            params.push(userId);
            paramCount++;
        }

        if (actionType) {
            query += ` AND al.action = $${paramCount}`;
            params.push(actionType);
            paramCount++;
        }

        if (startDate) {
            query += ` AND al.created_at >= $${paramCount}`;
            params.push(startDate);
            paramCount++;
        }

        if (endDate) {
            const inclusiveEndDate = `${endDate} 23:59:59`;
            query += ` AND al.created_at <= $${paramCount}`;
            params.push(inclusiveEndDate);
            paramCount++;
        }

        query += ` ORDER BY al.created_at DESC LIMIT $${paramCount}`;
        params.push(parseInt(limit, 10));

        logger.debug(`[/api/operation-logs] 執行查詢:`, { query: query.substring(0, 200), params });

        const result = await pool.query(query, params);
        logger.info(`[/api/operation-logs] 找到 ${result.rows.length} 筆操作記錄`);

        res.json({
            total: result.rows.length,
            logs: result.rows
        });
    } catch (error) {
        logger.error('[/api/operation-logs] 查詢失敗:', error.message);
        logger.error('[/api/operation-logs] 錯誤堆疊:', error.stack);
        res.status(500).json({ 
            message: '查詢操作日誌失敗',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// GET /api/operation-logs/stats
router.get('/operation-logs/stats', authorizeAdmin, async (req, res) => {
    // Simplified stats for now
    res.json({ message: "Stats not implemented yet for ERP integration" });
});

module.exports = router;
