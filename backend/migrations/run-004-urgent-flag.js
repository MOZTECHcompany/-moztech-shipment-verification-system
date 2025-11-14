#!/usr/bin/env node

/**
 * 執行 004_add_urgent_flag.sql 遷移
 * 為訂單表添加緊急標記功能
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

async function runMigration() {
    const client = await pool.connect();
    
    try {
        console.log('🚀 開始執行 004_add_urgent_flag 遷移...\n');
        
        // 讀取 SQL 文件
        const sqlPath = path.join(__dirname, '004_add_urgent_flag.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        
        // 執行遷移
        await client.query(sql);
        
        console.log('✅ 遷移執行成功！\n');
        
        // 驗證結果
        const checkResult = await client.query(`
            SELECT column_name, data_type, column_default
            FROM information_schema.columns
            WHERE table_name = 'orders' AND column_name = 'is_urgent'
        `);
        
        if (checkResult.rows.length > 0) {
            console.log('📋 欄位資訊:');
            console.log(checkResult.rows[0]);
            console.log('');
        }
        
        // 統計
        const statsResult = await client.query(`
            SELECT 
                COUNT(*) as total_orders,
                COUNT(*) FILTER (WHERE is_urgent = TRUE) as urgent_orders
            FROM orders
        `);
        
        console.log('📊 統計資訊:');
        console.log(`總訂單數: ${statsResult.rows[0].total_orders}`);
        console.log(`緊急訂單數: ${statsResult.rows[0].urgent_orders}`);
        console.log('');
        
        console.log('🎉 遷移完成！管理員現在可以在任務看板標記緊急訂單了。');
        
    } catch (error) {
        console.error('❌ 遷移失敗:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// 執行遷移
runMigration().catch(err => {
    console.error('執行遷移時發生錯誤:', err);
    process.exit(1);
});
