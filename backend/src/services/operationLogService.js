// backend/src/services/operationLogService.js
// 操作日誌相關服務

const { pool } = require('../config/database');
const logger = require('../utils/logger');

/**
 * 記錄操作並向 Socket.IO 訂閱者廣播
 * @param {Object} params
 * @param {number} params.userId - 操作者 ID
 * @param {number} params.orderId - 訂單 ID
 * @param {string} params.operationType - 操作類型
 * @param {Object} params.details - 其他詳情
 * @param {import('socket.io').Server|undefined|null} [params.io] - Socket.IO 伺服器實例
 */
async function logOperation({
    userId,
    orderId,
    operationType,
    details,
    io,
    db,
    userName,
    userRole,
    voucherNumber,
    customerName
}) {
    try {
        const executor = db && typeof db.query === 'function' ? db : pool;

        const result = await executor.query(
            'INSERT INTO operation_logs (user_id, order_id, action_type, details) VALUES ($1, $2, $3, $4) RETURNING id, created_at',
            [userId, orderId, operationType, JSON.stringify(details)]
        );

        if (io) {
            const logEntry = result.rows[0];
            let resolvedUserName = userName;
            let resolvedUserRole = userRole;
            let resolvedVoucherNumber = voucherNumber;
            let resolvedCustomerName = customerName;

            const shouldFetchUser = !resolvedUserName || !resolvedUserRole;
            const shouldFetchOrder = !resolvedVoucherNumber || !resolvedCustomerName;

            if (shouldFetchUser || shouldFetchOrder) {
                const [userInfo, orderInfo] = await Promise.all([
                    shouldFetchUser ? executor.query('SELECT name, role FROM users WHERE id = $1', [userId]) : null,
                    shouldFetchOrder ? executor.query('SELECT voucher_number, customer_name FROM orders WHERE id = $1', [orderId]) : null
                ]);

                if (shouldFetchUser) {
                    resolvedUserName = userInfo?.rows?.[0]?.name;
                    resolvedUserRole = userInfo?.rows?.[0]?.role;
                }

                if (shouldFetchOrder) {
                    resolvedVoucherNumber = orderInfo?.rows?.[0]?.voucher_number;
                    resolvedCustomerName = orderInfo?.rows?.[0]?.customer_name;
                }
            }

            io.emit('new_operation_log', {
                id: logEntry.id,
                user_id: userId,
                user_name: resolvedUserName,
                user_role: resolvedUserRole,
                order_id: orderId,
                voucher_number: resolvedVoucherNumber,
                customer_name: resolvedCustomerName,
                action_type: operationType,
                details,
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
