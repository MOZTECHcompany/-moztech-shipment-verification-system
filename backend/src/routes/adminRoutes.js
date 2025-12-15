// backend/src/routes/adminRoutes.js
// 管理員維運端點：手動觸發資料保留清理

const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const logger = require('../utils/logger');
const userService = require('../services/userService');
const jwt = require('jsonwebtoken');

// POST /api/admin/bootstrap/superadmin
// 用途：初始化最高管理員（通常只需要執行一次）
// 安全：需提供 SUPERADMIN_BOOTSTRAP_SECRET（以 header 或 body），且資料庫目前不能已有 superadmin
router.post('/bootstrap/superadmin', async (req, res) => {
  try {
    const secret =
      req.headers['x-superadmin-bootstrap'] ||
      req.headers['x-superadmin-bootstrap-secret'] ||
      (req.body && (req.body.secret || req.body.bootstrapSecret));

    if (!process.env.SUPERADMIN_BOOTSTRAP_SECRET) {
      return res.status(400).json({ message: '伺服器未設定 SUPERADMIN_BOOTSTRAP_SECRET，無法執行初始化' });
    }

    if (!secret || String(secret) !== String(process.env.SUPERADMIN_BOOTSTRAP_SECRET)) {
      return res.status(403).json({ message: '初始化密鑰錯誤' });
    }

    const existing = await pool.query("SELECT id FROM users WHERE LOWER(role) = 'superadmin' LIMIT 1");
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: '系統已存在最高管理員，無法再次初始化' });
    }

    const actorId = req.user?.id;
    if (!actorId) {
      return res.status(401).json({ message: '需要認證' });
    }

    const updated = await pool.query(
      "UPDATE users SET role = 'superadmin' WHERE id = $1 RETURNING id, username, name, role",
      [actorId]
    );

    if (updated.rowCount === 0) {
      return res.status(404).json({ message: '找不到用戶' });
    }

    const user = updated.rows[0];

    // 回傳新的 accessToken，讓前端不用重新登入
    const accessToken = jwt.sign(
      { id: user.id, username: user.username, name: user.name, role: 'superadmin' },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    logger.warn(`Superadmin bootstrap completed by userId=${actorId}`);
    return res.json({
      message: '最高管理員初始化完成',
      accessToken,
      user
    });
  } catch (err) {
    logger.error('Bootstrap superadmin failed:', err);
    return res.status(500).json({ message: '初始化最高管理員失敗', error: err.message });
  }
});

// 與舊版 API 兼容：POST /api/admin/create-user
router.post('/create-user', async (req, res) => {
  try {
    let { username, password, name, role } = req.body || {};
    if (!username || !password || !name || !role) {
      return res.status(400).json({ message: '請提供完整的使用者資料' });
    }

    role = String(role).trim().toLowerCase();

    // 只有最高管理員可以新增/指定管理員（admin/superadmin）
    const actorRole = req.user?.role;
    if ((role === 'admin' || role === 'superadmin') && actorRole !== 'superadmin') {
      return res.status(403).json({ message: '只有最高管理員可以新增管理員' });
    }
    const user = await userService.createUser({ username, password, name, role });

    return res.status(201).json({
      message: `使用者 ${user.username} (${user.role}) 已成功建立`,
      user
    });
  } catch (error) {
    if (error.message === '用戶名已存在') {
      return res.status(409).json({ message: error.message });
    }
    logger.error('Legacy create-user endpoint failed:', error);
    return res.status(500).json({ message: '建立使用者失敗', error: error.message });
  }
});

// POST /api/admin/maintenance/retention/run
// 可接受可選參數覆寫保留期間：logsDays, mentionsDays, readsDays, idleMinutes
router.post('/maintenance/retention/run', async (req, res) => {
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
