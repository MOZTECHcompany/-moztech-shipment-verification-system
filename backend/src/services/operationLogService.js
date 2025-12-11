// backend/src/services/operationLogService.js
// 操作日誌相關服務

const { pool } = require('../config/database');
const logger = require('../utils/logger');

/**
 * 記錄操作並向 Socket.IO 訂閱者廣播
 * @param {Object} params
 * @param {string} params.userId - 操作者 ID (UUID)
 * @param {string} params.orderId - 訂單 ID (UUID)
 * @param {string} params.operationType - 操作類型
 * @param {Object} params.details - 其他詳情
 * @param {import('socket.io').Server|undefined|null} [params.io] - Socket.IO 伺服器實例
 */
async function logOperation({ userId, orderId, operationType, details, io }) {
    try {
        // Map to ERP audit_logs
        const result = await pool.query(
            `INSERT INTO audit_logs (
                id, user_id, resource, resource_id, action, details, created_at
            ) VALUES (gen_random_uuid(), $1, 'SalesOrder', $2, $3, $4, NOW()) 
            RETURNING id, created_at`,
            [userId, orderId, operationType, JSON.stringify(details)]
        );

        if (io) {
            const logEntry = result.rows[0];
            const userInfo = await pool.query('SELECT name FROM users WHERE id = $1', [userId]);
            const orderInfo = await pool.query('SELECT external_order_id as voucher_number FROM sales_orders WHERE id = $1', [orderId]);

            io.emit('new_operation_log', {
                id: logEntry.id,
                user_id: userId,
                user_name: userInfo.rows[0]?.name,
                user_role: 'unknown', // ERP users don't have role directly on user table
                order_id: orderId,
                voucher_number: orderInfo.rows[0]?.voucher_number,
                customer_name: 'Unknown',
                action_type: operationType,
                details,
                details_json: details, // Frontend might expect this
                created_at: logEntry.created_at
            });
        }

        logger.debug(`[logOperation] 記錄操作: ${operationType} - 訂單 ${orderId}, 使用者 ${userId}`);
    } catch (error) {
        logger.error('記錄操作日誌失敗:', error);
    }
}

module.exports = {
    logOperation
};
