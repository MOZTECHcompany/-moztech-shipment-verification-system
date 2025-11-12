// backend/src/server.js
// 伺服器啟動文件

const { app, server } = require('./app');
const { testConnection, closePool } = require('./config/database');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 3001;

// 啟動伺服器
async function startServer() {
    try {
        // 測試資料庫連接
        const dbConnected = await testConnection();
        if (!dbConnected) {
            logger.error('資料庫連接失敗，伺服器無法啟動');
            process.exit(1);
        }

        // 啟動 HTTP 伺服器
        server.listen(PORT, () => {
            logger.info(`🚀 伺服器已啟動於 port ${PORT}`);
            logger.info(`📦 環境: ${process.env.NODE_ENV || 'development'}`);
            logger.info(`🔗 資料庫: ${process.env.DATABASE_URL ? '已連接' : '未配置'}`);
        });

    } catch (error) {
        logger.error('伺服器啟動失敗:', error);
        process.exit(1);
    }
}

// 優雅關閉
async function gracefulShutdown(signal) {
    logger.info(`收到 ${signal} 信號，開始優雅關閉...`);
    
    try {
        // 關閉 HTTP 伺服器
        server.close(() => {
            logger.info('HTTP 伺服器已關閉');
        });

        // 關閉資料庫連接池
        await closePool();

        logger.info('優雅關閉完成');
        process.exit(0);
    } catch (error) {
        logger.error('優雅關閉時發生錯誤:', error);
        process.exit(1);
    }
}

// 處理未捕獲的異常
process.on('uncaughtException', (error) => {
    logger.error('未捕獲的異常:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('未處理的 Promise 拒絕:', reason);
    process.exit(1);
});

// 處理終止信號
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 啟動
startServer();
