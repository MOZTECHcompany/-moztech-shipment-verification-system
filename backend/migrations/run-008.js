#!/usr/bin/env node

/**
 * 執行 008_fix_product_defects_cascade.sql 遷移
 * 為 product_defects 表添加 ON DELETE CASCADE
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

async function runMigration() {
    const client = await pool.connect();
    
    try {
        console.log('🚀 開始執行 008_fix_product_defects_cascade 遷移...\n');
        
        // 讀取 SQL 文件
        const sqlPath = path.join(__dirname, '008_fix_product_defects_cascade.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        
        // 執行遷移
        await client.query(sql);
        
        console.log('✅ 遷移執行成功！');
        console.log('product_defects 表現在支援 ON DELETE CASCADE');
        
    } catch (err) {
        console.error('❌ 遷移失敗:', err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runMigration();
