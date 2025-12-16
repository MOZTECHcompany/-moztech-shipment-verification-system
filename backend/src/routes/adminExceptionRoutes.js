// backend/src/routes/adminExceptionRoutes.js
// 管理端：例外總覽（open/ack/resolved + 搜尋 + SLA 提醒）

const express = require('express');
const { pool } = require('../config/database');
const logger = require('../utils/logger');

const router = express.Router();

const VALID_STATUSES = new Set(['open', 'ack', 'resolved']);

function parsePositiveInt(value, fallback) {
  const n = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function parseMaybeInt(value) {
  const n = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return null;
  return n;
}

// GET /api/admin/exceptions?status=open&q=...&overdue=1&page=1&limit=50
router.get('/exceptions', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : 'open';
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const overdue = String(req.query.overdue || '').trim() === '1';

  if (status && !VALID_STATUSES.has(status)) {
    return res.status(400).json({ message: 'status 無效', requestId: req.requestId });
  }

  const page = Math.max(1, parsePositiveInt(req.query.page, 1));
  const limit = Math.min(200, Math.max(1, parsePositiveInt(req.query.limit, 50)));
  const offset = (page - 1) * limit;

  const slaMinutes = parsePositiveInt(process.env.EXCEPTION_SLA_MINUTES, 30);

  try {
    const params = [];
    let where = '1=1';

    if (status) {
      params.push(status);
      where += ` AND e.status = $${params.length}`;
    }

    const qAsInt = q ? parseMaybeInt(q) : null;
    if (q) {
      params.push(`%${q}%`);
      const likeIdx = params.length;

      if (qAsInt) {
        params.push(qAsInt);
        where += ` AND (o.voucher_number ILIKE $${likeIdx} OR e.order_id = $${params.length})`;
      } else {
        where += ` AND (o.voucher_number ILIKE $${likeIdx})`;
      }
    }

    // SLA: 只針對 open
    params.push(slaMinutes);
    const slaIdx = params.length;

    const overdueExpr = `(e.status = 'open' AND e.created_at < NOW() - ($${slaIdx}::text || ' minutes')::interval)`;
    if (overdue) {
      where += ` AND ${overdueExpr}`;
    }

    const result = await pool.query(
      `SELECT
        e.id,
        e.order_id,
        o.voucher_number,
        o.status AS order_status,
        o.customer_name,
        e.type,
        e.status,
        e.reason_code,
        e.reason_text,
        e.created_by,
        e.created_at,
        e.ack_by,
        e.ack_at,
        e.resolved_by,
        e.resolved_at,
        e.resolution_action,
        (SELECT COUNT(*)::int FROM order_exception_attachments a WHERE a.exception_id = e.id) AS attachment_count,
        ${overdueExpr} AS is_overdue,
        cu.name AS created_by_name,
        au.name AS ack_by_name,
        ru.name AS resolved_by_name
      FROM order_exceptions e
      JOIN orders o ON o.id = e.order_id
      LEFT JOIN users cu ON cu.id = e.created_by
      LEFT JOIN users au ON au.id = e.ack_by
      LEFT JOIN users ru ON ru.id = e.resolved_by
      WHERE ${where}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    return res.json({
      items: result.rows,
      meta: { page, limit, slaMinutes }
    });
  } catch (err) {
    logger.error('[/api/admin/exceptions] failed:', err);
    return res.status(500).json({ message: '取得例外總覽失敗', requestId: req.requestId });
  }
});

module.exports = router;
