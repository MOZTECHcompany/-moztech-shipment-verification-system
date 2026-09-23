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
    strict = Boolean(db),
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

        // Audit details are fetched only through the authorized HTTP query.
        if (io) io.emit('operation_logs_changed', {});

        logger.debug(`[logOperation] 記錄操作: ${operationType} - 訂單 ${orderId}, 使用者 ${userId}`);
    } catch (error) {
        logger.error('記錄操作日誌失敗:', error);
        // Transaction owners must roll back when their audit INSERT fails. Swallowing
        // the error can make PostgreSQL COMMIT resolve as ROLLBACK and look successful.
        if (strict) throw error;
    }
}

module.exports = {
    logOperation
};
