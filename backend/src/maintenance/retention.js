// backend/src/maintenance/retention.js
// 執行資料保留清理任務（可排程於每日執行）

require('dotenv').config();
const { pool } = require('../config/database');

const LOGS_DAYS = parseInt(process.env.RETENTION_LOGS_DAYS || '180', 10);
const MENTIONS_DAYS = parseInt(process.env.RETENTION_MENTIONS_DAYS || '30', 10);
const READS_DAYS = parseInt(process.env.RETENTION_READS_DAYS || '90', 10);
const IDLE_MINUTES = parseInt(process.env.RETENTION_IDLE_MINUTES || '10', 10);

async function run() {
  const client = await pool.connect();
  try {
    const sql = `SELECT run_all_purge($1, $2, $3, $4) AS result`;
    const { rows } = await client.query(sql, [LOGS_DAYS, MENTIONS_DAYS, READS_DAYS, IDLE_MINUTES]);
    console.log('🧹 Retention summary:', rows[0].result);

    // 可選擇對主要表做一次輕量 ANALYZE（避免統計資訊過舊）
    await client.query('ANALYZE operation_logs');
    await client.query('ANALYZE task_comments');
    await client.query('ANALYZE task_mentions');
    await client.query('ANALYZE task_comment_reads');
  } catch (err) {
    console.error('Retention failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
