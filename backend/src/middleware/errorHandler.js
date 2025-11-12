// backend/src/middleware/errorHandler.js
// 全局錯誤處理中間件

const logger = require('../utils/logger');

/**
 * 404 Not Found 處理器
 */
function notFoundHandler(req, res, next) {
    logger.warn(`404 Not Found: ${req.method} ${req.originalUrl}`);
    res.status(404).json({
        message: '找不到請求的資源',
        path: req.originalUrl
    });
}

/**
 * 全局錯誤處理器
 */
function globalErrorHandler(err, req, res, next) {
    // 記錄錯誤
    logger.error('全局錯誤處理器捕獲錯誤:', {
        message: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
        user: req.user?.username || 'anonymous'
    });

    // 處理特定類型的錯誤
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            message: '資料驗證失敗',
            errors: err.errors
        });
    }

    if (err.name === 'UnauthorizedError') {
        return res.status(401).json({
            message: '認證失敗'
        });
    }

    if (err.code === '23505') { // PostgreSQL unique violation
        return res.status(409).json({
            message: '資料重複',
            detail: err.detail
        });
    }

    if (err.code === '23503') { // PostgreSQL foreign key violation
        return res.status(400).json({
            message: '參照完整性錯誤',
            detail: err.detail
        });
    }

    // 預設錯誤回應
    const statusCode = err.statusCode || err.status || 500;
    const message = process.env.NODE_ENV === 'production' 
        ? '伺服器發生錯誤'
        : err.message;

    res.status(statusCode).json({
        message,
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    });
}

/**
 * Async 錯誤包裝器（Express 5 已內建，此為備用）
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

module.exports = {
    notFoundHandler,
    globalErrorHandler,
    asyncHandler
};
