// backend/src/config/database.js
// 資料庫配置和連接池管理

const { Pool } = require('pg');
const logger = require('../utils/logger');

// 資料庫連接池配置
const { getDatabaseOptions } = require('./runtime');
// DB_POOL_MAX is the TOTAL per-instance budget, including reporting. Reserve
// one slot for bounded exports without increasing the database role's budget.
const options = getDatabaseOptions(process.env);
const reportSlots = options.max > 1 ? 1 : 0;
const pool = new Pool({ ...options, max: options.max - reportSlots, statement_timeout: 8000 });
const reportPool = reportSlots ? new Pool({ ...options, max: 1, statement_timeout: 8000 }) : pool;
if (reportPool !== pool) reportPool.on('error', error => logger.error('Report database connection failed', { code: error.code }));

// 連接池事件監聽
pool.on('connect', (client) => {
    logger.debug('新的資料庫連接已建立');
});

pool.on('error', (err, client) => {
    logger.error('資料庫連接池發生錯誤:', err);
});

pool.on('remove', (client) => {
    logger.debug('資料庫連接已移除');
});

// 測試資料庫連接
const testConnection = async () => {
    try {
        const client = await pool.connect();
        let result;
        try { result = await client.query('SELECT NOW()'); } finally { client.release(); }
        logger.info('資料庫連接成功:', result.rows[0].now);
        return true;
    } catch (error) {
        logger.error('資料庫連接失敗:', error);
        return false;
    }
};

// 優雅關閉
const closePool = async () => {
    try {
        await Promise.all([pool.end(), ...(reportPool !== pool ? [reportPool.end()] : [])]);
        logger.info('資料庫連接池已關閉');
    } catch (error) {
        logger.error('關閉資料庫連接池時發生錯誤:', error);
    }
};

module.exports = {
    pool,
    reportPool,
    testConnection,
    closePool
};
