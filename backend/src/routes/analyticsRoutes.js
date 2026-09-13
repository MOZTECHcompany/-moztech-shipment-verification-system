// backend/src/routes/analyticsRoutes.js
// 操作日誌、報表與分析相關端點（需先通過 authenticateToken）

const express = require('express');
const { createReportExporter } = require('../services/reportExport');
const { boundedLimit, dateRange } = require('../utils/queryLimits');
const { pool, reportPool } = require('../config/database');
const logger = require('../utils/logger');
const { authorizeAdmin } = require('../middleware/auth');

const router = express.Router();
router.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    try {
        dateRange(req.query.startDate, req.query.endDate);
        if (req.query.limit !== undefined) boundedLimit(req.query.limit);
        next();
    } catch (error) { res.status(400).json({ message: error.message }); }
});

// GET /api/operation-logs
router.get('/operation-logs', authorizeAdmin, async (req, res) => {
    const { orderId, userId, startDate, endDate, actionType, limit = '100' } = req.query;

    logger.info(`[/api/operation-logs] 查詢操作日誌 - orderId: ${orderId}, userId: ${userId}, startDate: ${startDate}, endDate: ${endDate}, actionType: ${actionType}`);

    try {
        let query = `
            SELECT 
                ol.id,
                ol.user_id,
                ol.order_id,
                ol.action_type,
                ol.details,
                ol.created_at,
                u.name as user_name,
                u.role as user_role,
                o.voucher_number,
                o.customer_name,
                o.status as order_status
            FROM operation_logs ol
            LEFT JOIN users u ON ol.user_id = u.id
            LEFT JOIN orders o ON ol.order_id = o.id
            WHERE 1=1
        `;

        const params = [];
        let paramCount = 1;

        if (orderId) {
            if (/^\d+$/.test(orderId)) {
                query += ` AND ol.order_id = $${paramCount}`;
                params.push(parseInt(orderId, 10));
            } else {
                query += ` AND o.voucher_number ILIKE $${paramCount}`;
                params.push(`%${orderId}%`);
            }
            paramCount++;
        }

        if (userId) {
            query += ` AND ol.user_id = $${paramCount}`;
            params.push(parseInt(userId, 10));
            paramCount++;
        }

        if (actionType) {
            query += ` AND ol.action_type = $${paramCount}`;
            params.push(actionType);
            paramCount++;
        }

        if (startDate) {
            query += ` AND ol.created_at >= $${paramCount}`;
            params.push(startDate);
            paramCount++;
        }

        if (endDate) {
            const inclusiveEndDate = `${endDate} 23:59:59`;
            query += ` AND ol.created_at <= $${paramCount}`;
            params.push(inclusiveEndDate);
            paramCount++;
        }

        query += ` ORDER BY ol.created_at DESC LIMIT $${paramCount}`;
        params.push(boundedLimit(limit, 100, 1000));

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
    const { startDate, endDate } = req.query;

    try {
        let query = `
            SELECT 
                action_type,
                COUNT(*) as count,
                COUNT(DISTINCT user_id) as unique_users,
                COUNT(DISTINCT order_id) as unique_orders
            FROM operation_logs
            WHERE 1=1
        `;

        const params = [];
        let paramCount = 1;

        if (startDate) {
            query += ` AND created_at >= $${paramCount}`;
            params.push(startDate);
            paramCount++;
        }

        if (endDate) {
            const inclusiveEndDate = `${endDate} 23:59:59`;
            query += ` AND created_at <= $${paramCount}`;
            params.push(inclusiveEndDate);
            paramCount++;
        }

        query += ` GROUP BY action_type ORDER BY count DESC`;

        const result = await pool.query(query, params);

        const totalQuery = `
            SELECT COUNT(*) as total
            FROM operation_logs
            WHERE created_at >= COALESCE($1::timestamp, '-infinity')
            AND created_at <= COALESCE($2::timestamp, 'infinity')
        `;
        const totalResult = await pool.query(totalQuery, [startDate, endDate ? `${endDate} 23:59:59` : null]);

        res.json({
            total: parseInt(totalResult.rows[0].total, 10),
            byActionType: result.rows
        });
    } catch (error) {
        logger.error('[/api/operation-logs/stats] 查詢失敗:', error);
        res.status(500).json({ message: '查詢統計資料失敗' });
    }
});

// GET /api/reports/export
router.get('/reports/export', authorizeAdmin, createReportExporter(reportPool));

// GET /api/analytics
router.get('/analytics', authorizeAdmin, async (req, res) => {
    const { range = '7days' } = req.query;

    const daysMap = { '7days': 7, '30days': 30, '90days': 90 };
    const days = daysMap[range] || 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    try {
        const overviewQuery = await pool.query(`
            SELECT 
                COUNT(*) as total_orders,
                COUNT(*) FILTER (WHERE status = 'completed') as completed_orders,
                COUNT(*) FILTER (WHERE status = 'voided') as voided_orders,
                AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/60) FILTER (WHERE status = 'picking' OR status = 'packing' OR status = 'completed') as avg_processing_time
            FROM orders
            WHERE created_at >= $1
        `, [startDate]);

        const userPerformanceQuery = await pool.query(`
            SELECT 
                u.id as user_id,
                u.name as user_name,
                u.role,
                COUNT(DISTINCT ol.order_id) as completed_orders,
                AVG(EXTRACT(EPOCH FROM (o.updated_at - o.created_at))/60) as avg_time
            FROM users u
            LEFT JOIN operation_logs ol ON u.id = ol.user_id
            LEFT JOIN orders o ON ol.order_id = o.id
            WHERE ol.created_at >= $1 AND ol.action_type IN ('pick', 'pack', 'complete')
            GROUP BY u.id, u.name, u.role
            HAVING COUNT(DISTINCT ol.order_id) > 0
            ORDER BY completed_orders DESC
            LIMIT 20
        `, [startDate]);

        const topProductsQuery = await pool.query(`
            SELECT 
                oi.product_name,
                oi.barcode,
                oi.product_code,
                SUM(oi.quantity) as total_quantity,
                COUNT(DISTINCT oi.order_id) as order_count
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            WHERE o.created_at >= $1
            GROUP BY oi.product_name, oi.barcode, oi.product_code
            ORDER BY total_quantity DESC
            LIMIT 20
        `, [startDate]);

        const orderTrendsQuery = await pool.query(`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'completed') as completed,
                COUNT(*) FILTER (WHERE status = 'voided') as voided
            FROM orders
            WHERE created_at >= $1
            GROUP BY DATE(created_at)
            ORDER BY date DESC
        `, [startDate]);

        const overview = overviewQuery.rows[0];

        res.json({
            overview: {
                totalOrders: parseInt(overview.total_orders, 10),
                completedOrders: parseInt(overview.completed_orders, 10),
                voidedOrders: parseInt(overview.voided_orders, 10),
                avgPickingTime: parseFloat(overview.avg_processing_time) * 0.4 || 0,
                avgPackingTime: parseFloat(overview.avg_processing_time) * 0.3 || 0,
                errorRate: parseInt(overview.voided_orders, 10) / parseInt(overview.total_orders || '1', 10) || 0
            },
            userPerformance: userPerformanceQuery.rows,
            topProducts: topProductsQuery.rows,
            orderTrends: orderTrendsQuery.rows
        });

        logger.info(`[/api/analytics] 成功返回 ${range} 分析數據`);
    } catch (error) {
        logger.error('[/api/analytics] 查詢失敗:', error);
        res.status(500).json({ message: '獲取分析數據失敗' });
    }
});

// GET /api/scan-errors
router.get('/scan-errors', authorizeAdmin, async (req, res) => {
    const { startDate, endDate, limit = '50' } = req.query;

    try {
        let query = `
            SELECT 
                ol.id,
                ol.created_at,
                ol.action_type,
                ol.details,
                u.name as user_name,
                u.role as user_role,
                o.voucher_number,
                o.customer_name
            FROM operation_logs ol
            JOIN users u ON ol.user_id = u.id
            LEFT JOIN orders o ON ol.order_id = o.id
            WHERE ol.action_type = 'scan_error'
        `;

        const params = [];
        let paramCount = 1;

        if (startDate) {
            query += ` AND ol.created_at >= $${paramCount}`;
            params.push(startDate);
            paramCount++;
        }

        if (endDate) {
            query += ` AND ol.created_at <= $${paramCount}`;
            params.push(endDate);
            paramCount++;
        }

        query += ` ORDER BY ol.created_at DESC LIMIT $${paramCount}`;
        params.push(boundedLimit(limit, 100, 1000));

        const result = await pool.query(query, params);

        res.json({
            total: result.rows.length,
            errors: result.rows
        });
    } catch (error) {
        logger.error('[/api/scan-errors] 查詢失敗:', error);
        res.status(500).json({ message: '查詢刷錯記錄失敗' });
    }
});

module.exports = router;
