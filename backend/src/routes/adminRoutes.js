// backend/src/routes/adminRoutes.js
const express = require('express');
const router = express.Router();

const { pool } = require('../config/database');
const { authenticateToken, authorizeAdmin } = require('../middleware/auth');

// 這個路由群組保護在 app.js 會再套 authenticateToken + authorizeAdmin

// POST /api/admin/maintenance/retention/run
// 目的：管理員手動觸發 DB 清理（可帶自訂保留參數）
router.post('/maintenance/retention/run', async (req, res) => {
  const {
    logsDays,
    mentionsDays,
    readsDays,
    idleMinutes
  } = req.body || {};

  const LOGS_DAYS = parseInt(logsDays ?? process.env.RETENTION_LOGS_DAYS ?? '180', 10);
  const MENTIONS_DAYS = parseInt(mentionsDays ?? process.env.RETENTION_MENTIONS_DAYS ?? '30', 10);
  const READS_DAYS = parseInt(readsDays ?? process.env.RETENTION_READS_DAYS ?? '90', 10);
  const IDLE_MINUTES = parseInt(idleMinutes ?? process.env.RETENTION_IDLE_MINUTES ?? '10', 10);

  const client = await pool.connect();
  try {
    const sql = 'SELECT run_all_purge($1, $2, $3, $4) AS result';
    const { rows } = await client.query(sql, [LOGS_DAYS, MENTIONS_DAYS, READS_DAYS, IDLE_MINUTES]);
    return res.json({ ok: true, params: { LOGS_DAYS, MENTIONS_DAYS, READS_DAYS, IDLE_MINUTES }, result: rows[0].result });
  } catch (err) {
    return res.status(500).json({ ok: false, message: 'Retention run failed', error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
// backend/src/routes/adminRoutes.js
// 管理員維運端點：手動觸發資料保留清理

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const logger = require('../utils/logger');

// POST /api/admin/maintenance/retention
// 可接受可選參數覆寫保留期間：logsDays, mentionsDays, readsDays, idleMinutes
router.post('/maintenance/retention', async (req, res) => {
  const { logsDays, mentionsDays, readsDays, idleMinutes } = req.body || {};

  const LOGS_DAYS = Number.isFinite(+logsDays) ? Math.max(0, parseInt(logsDays, 10)) : parseInt(process.env.RETENTION_LOGS_DAYS || '180', 10);
  const MENTIONS_DAYS = Number.isFinite(+mentionsDays) ? Math.max(0, parseInt(mentionsDays, 10)) : parseInt(process.env.RETENTION_MENTIONS_DAYS || '30', 10);
  const READS_DAYS = Number.isFinite(+readsDays) ? Math.max(0, parseInt(readsDays, 10)) : parseInt(process.env.RETENTION_READS_DAYS || '90', 10);
  const IDLE_MINUTES = Number.isFinite(+idleMinutes) ? Math.max(0, parseInt(idleMinutes, 10)) : parseInt(process.env.RETENTION_IDLE_MINUTES || '10', 10);

  try {
    const sql = 'SELECT run_all_purge($1, $2, $3, $4) AS result';
    const { rows } = await pool.query(sql, [LOGS_DAYS, MENTIONS_DAYS, READS_DAYS, IDLE_MINUTES]);
    logger.info('Admin retention triggered', { by: (req.user && req.user.username) || 'unknown', result: rows[0].result });
    return res.json({ success: true, params: { LOGS_DAYS, MENTIONS_DAYS, READS_DAYS, IDLE_MINUTES }, result: rows[0].result });
  } catch (err) {
    logger.error('Admin retention failed:', err);
    return res.status(500).json({ success: false, message: 'Retention failed', error: err.message });
  }
});

module.exports = router;
