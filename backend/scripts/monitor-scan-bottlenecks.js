#!/usr/bin/env node
require('dotenv').config();
const { Pool } = require('pg');

const durationMinutes = Math.max(1, parseInt(process.argv[2] || '10', 10));
const intervalSeconds = Math.max(1, parseInt(process.argv[3] || '5', 10));

const DURATION_MS = durationMinutes * 60 * 1000;
const INTERVAL_MS = intervalSeconds * 1000;

function classifyQuery(q = '') {
  const s = q.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!s) return 'unknown';
  if (s.includes('from order_item_instances') && s.includes('for update')) {
    if (s.includes('regexp_replace')) return 'scan_match_digits_for_update';
    if (s.includes('serial_number')) return 'scan_match_exact_for_update';
    return 'order_item_instances_for_update';
  }
  if (s.includes('from order_items') && s.includes('for update')) return 'scan_pick_item_for_update';
  if (s.includes('update order_item_instances set status')) return 'scan_update_instance_status';
  if (s.includes('update order_items set picked_quantity')) return 'scan_update_picked_qty';
  if (s.includes('update order_items set packed_quantity')) return 'scan_update_packed_qty';
  if (s.includes('with instance_stats as')) return 'scan_completion_check';
  if (s.includes('from order_exceptions')) return 'open_exception_check';
  if (s.includes('from orders') && s.includes('for update')) return 'orders_for_update';
  if (s.includes('insert into operation_logs')) return 'operation_log_insert';
  if (s.includes('from orders')) return 'orders_lookup';
  if (s.includes('from order_items')) return 'order_items_lookup';
  return 'other';
}

function fixHint(cls) {
  if (cls === 'scan_match_digits_for_update') return '優先檢查 idx_order_item_instances_serial_digits 與 digits fallback 命中率';
  if (cls === 'scan_match_exact_for_update') return '檢查 SN 條碼清洗邏輯與 serial_number 索引命中';
  if (cls === 'scan_pick_item_for_update') return '檢查 idx_order_items_order_id_barcode 與同條碼多行更新策略';
  if (cls === 'scan_completion_check') return '檢查完成判斷聚合 SQL 與 order_item_instances/order_items 分佈';
  if (cls === 'open_exception_check') return '檢查 idx_order_exceptions_order_status(_type) 是否存在';
  if (cls === 'orders_for_update') return '檢查是否還有讀取流程使用 FOR UPDATE';
  if (cls === 'operation_log_insert') return '檢查 operation_logs 寫入是否被 I/O 或 transaction 影響';
  return '檢查 query plan 與是否存在長交易/鎖等待';
}

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const summary = {
    startedAt: new Date().toISOString(),
    endedAt: null,
    samples: 0,
    activeRows: 0,
    waitingRows: 0,
    byClass: {},
    slowEvents: []
  };

  const startedMs = Date.now();
  try {
    while (Date.now() - startedMs < DURATION_MS) {
      const c = await pool.connect();
      try {
        const active = await c.query(`
          SELECT pid, now() - query_start AS age, wait_event_type, wait_event, query
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND state = 'active'
            AND pid <> pg_backend_pid()
        `);

        summary.samples += 1;
        summary.activeRows += active.rowCount;

        for (const row of active.rows) {
          const ageMs = Number(row.age?.milliseconds || 0)
            + Number((row.age?.seconds || 0) * 1000)
            + Number((row.age?.minutes || 0) * 60000);
          const cls = classifyQuery(row.query || '');
          const waiting = !!row.wait_event_type;
          if (waiting) summary.waitingRows += 1;

          if (!summary.byClass[cls]) {
            summary.byClass[cls] = { count: 0, waitingCount: 0, maxAgeMs: 0, totalAgeMs: 0 };
          }
          const bucket = summary.byClass[cls];
          bucket.count += 1;
          if (waiting) bucket.waitingCount += 1;
          bucket.maxAgeMs = Math.max(bucket.maxAgeMs, ageMs);
          bucket.totalAgeMs += ageMs;

          if (ageMs >= 800 || waiting) {
            summary.slowEvents.push({
              cls,
              ageMs,
              wait: waiting ? `${row.wait_event_type}:${row.wait_event || ''}` : null,
              sql: String(row.query || '').replace(/\s+/g, ' ').slice(0, 240)
            });
          }
        }
      } finally {
        c.release();
      }
      await new Promise(r => setTimeout(r, INTERVAL_MS));
    }

    summary.endedAt = new Date().toISOString();

    const top = Object.entries(summary.byClass)
      .map(([cls, v]) => ({
        cls,
        count: v.count,
        waitingCount: v.waitingCount,
        maxAgeMs: v.maxAgeMs,
        avgAgeMs: v.count ? Math.round(v.totalAgeMs / v.count) : 0,
        hint: fixHint(cls)
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    const report = {
      windowMinutes: durationMinutes,
      intervalSeconds,
      startedAt: summary.startedAt,
      endedAt: summary.endedAt,
      samples: summary.samples,
      avgActivePerSample: summary.samples ? Number((summary.activeRows / summary.samples).toFixed(2)) : 0,
      avgWaitingPerSample: summary.samples ? Number((summary.waitingRows / summary.samples).toFixed(2)) : 0,
      top3: top,
      topSlowEvents: summary.slowEvents.sort((a, b) => b.ageMs - a.ageMs).slice(0, 10)
    };

    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error('monitor_failed', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
