// backend/src/config/database.js
// 資料庫配置和連接池管理

const { Pool } = require('pg');
const logger = require('../utils/logger');

// 資料庫連接池配置
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20, // 最大連接數
    idleTimeoutMillis: 30000, // 空閒連接超時
    connectionTimeoutMillis: 10000, // 連接超時 (從 2000ms 增加到 10000ms)
});

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
        const result = await client.query('SELECT NOW()');
        client.release();
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
        await pool.end();
        logger.info('資料庫連接池已關閉');
    } catch (error) {
        logger.error('關閉資料庫連接池時發生錯誤:', error);
    }
};

module.exports = {
    pool,
    testConnection,
    closePool
};
