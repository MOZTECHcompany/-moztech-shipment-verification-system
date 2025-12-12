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
    console.log('🚀 開始執行 007 遷移...\n');
    
    try {
        const file = '007_product_defects.sql';
        const sqlPath = path.join(__dirname, file);
        const sql = fs.readFileSync(sqlPath, 'utf8');
        
        console.log(`📄 執行遷移檔案: ${file}`);
        
        await pool.query(sql);
        console.log(`✅ ${file} 執行成功\n`);
        
    } catch (err) {
        console.error('❌ 遷移執行失敗:', err.message);
        console.error('\n錯誤詳情:', err);
    } finally {
        await pool.end();
    }
}

runMigration();
