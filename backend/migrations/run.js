// backend/migrations/run.js
// 自動執行資料庫遷移腳本

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function runMigration() {
    console.log('🚀 開始執行資料庫遷移...\n');
    
    try {
        // 讀取所有 SQL 檔案
        const migrationFiles = fs.readdirSync(__dirname)
            .filter(file => file.endsWith('.sql'))
            .sort();
        
        for (const file of migrationFiles) {
            const sqlPath = path.join(__dirname, file);
            const sql = fs.readFileSync(sqlPath, 'utf8');
            
            console.log(`📄 執行遷移檔案: ${file}`);
            
            // 執行 SQL
            await pool.query(sql);
            console.log(`✅ ${file} 執行成功\n`);
        }
        
        console.log('✅ 遷移執行成功！');
        console.log('\n索引已建立完成。資料庫查詢效能應該會有顯著提升。\n');
        
        // 顯示已建立的索引
        const indexQuery = `
            SELECT 
                schemaname,
                tablename,
                indexname
            FROM pg_indexes
            WHERE schemaname = 'public'
            AND indexname LIKE 'idx_%'
            ORDER BY tablename, indexname;
        `;
        
        const result = await pool.query(indexQuery);
        
        console.log('📋 已建立的索引列表：');
        console.log('─'.repeat(60));
        
        let currentTable = '';
        result.rows.forEach(row => {
            if (row.tablename !== currentTable) {
                currentTable = row.tablename;
                console.log(`\n表格: ${row.tablename}`);
            }
            console.log(`  └─ ${row.indexname}`);
        });
        
        console.log('\n' + '─'.repeat(60));
        console.log(`共建立 ${result.rows.length} 個索引`);
        
    } catch (error) {
        console.error('❌ 遷移執行失敗:', error.message);
        console.error('\n錯誤詳情:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// 執行遷移
runMigration().catch(err => {
    console.error('💥 發生未預期的錯誤:', err);
    process.exit(1);
});
