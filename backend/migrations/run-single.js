// backend/migrations/run-single.js
// 只執行指定的 SQL 遷移檔（避免重複跑已套用的 migration）

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error('用法: npm run migrate:single -- <SQL 檔名>');
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, fileArg);
  if (!fs.existsSync(sqlPath)) {
    console.error(`找不到檔案: ${sqlPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log(`🚀 執行單一遷移檔案: ${fileArg}\n`);
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log(`✅ ${fileArg} 執行成功`);
  } catch (err) {
    console.error(`❌ ${fileArg} 執行失敗:`, err.message);
    console.error('\n錯誤詳情:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('💥 未預期錯誤:', err);
  process.exit(1);
});
