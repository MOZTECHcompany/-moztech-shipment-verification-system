// backend/src/server.js
// 伺服器啟動文件

const { app, server, io } = require('./app');
const { pool, testConnection, closePool } = require('./config/database');
const { assertSchemaReady } = require('./config/schemaReadiness');
const { getAttachmentStorage } = require('./services/attachmentStorage');
const logger = require('./utils/logger');
const PORT = process.env.PORT || 3001;

// 啟動伺服器
async function startServer() {
    try {
        // Schema changes are run explicitly with npm run migrate before release.
        // 測試資料庫連接
        const dbConnected = await testConnection();
        if (!dbConnected) {
            logger.error('資料庫連接失敗，伺服器無法啟動');
            process.exit(1);
        }

        await assertSchemaReady(pool);
        getAttachmentStorage();

        // 啟動 HTTP 伺服器
        server.listen(PORT, process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1', () => {
            logger.info(`🚀 伺服器已啟動於 port ${PORT}`);
            logger.info(`📦 環境: ${process.env.NODE_ENV || 'development'}`);
            logger.info(`🔗 資料庫: ${process.env.DATABASE_URL ? '已連接' : '未配置'}`);
        });

    } catch (error) {
        logger.error('伺服器啟動失敗:', error);
        process.exit(1);
    }
}

// Stop accepting requests, drain HTTP and Socket.IO before closing the pool.
let shuttingDown = false;
async function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    app.locals.draining = true;
    logger.info(`Received ${signal}; draining connections`);
    const deadline = setTimeout(() => process.exit(1), 8000);
    deadline.unref();
    try {
        await new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
            io.disconnectSockets(true);
            server.closeIdleConnections?.();
        });
        await new Promise(resolve => io.close(resolve));
        await closePool();
        clearTimeout(deadline);
        process.exit(0);
    } catch (error) {
        logger.error('Shutdown failed', error);
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
