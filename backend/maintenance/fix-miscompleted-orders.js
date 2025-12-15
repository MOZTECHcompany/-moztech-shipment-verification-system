#!/usr/bin/env node

/*
  修正「未揀貨/未裝箱卻被標記為 completed」的歷史訂單。

  預設為 dry-run（只輸出會修正哪些訂單，不寫入 DB）。

  用法：
    node maintenance/fix-miscompleted-orders.js --limit=500
    node maintenance/fix-miscompleted-orders.js --apply --limit=500

  參數：
    --apply        實際寫入 DB（不加則 dry-run）
    --limit=NUM    最多處理幾筆（預設 500）
*/

require('dotenv').config();

const { pool, closePool } = require('../src/config/database');
const logger = require('../src/utils/logger');

function parseArgs(argv) {
  const args = { apply: false, limit: 500 };
  for (const raw of argv.slice(2)) {
    if (raw === '--apply') args.apply = true;
    else if (raw.startsWith('--limit=')) {
      const v = parseInt(raw.split('=')[1], 10);
      if (Number.isFinite(v) && v > 0) args.limit = v;
    }
  }
  return args;
}

function computeDesiredStatus({ items, instances }) {
  let allPicked = true;
  let allPacked = true;
  let hasPickingProgress = false;
  let hasPackingProgress = false;

  const instancesByItemId = new Map();
  for (const inst of instances) {
    const list = instancesByItemId.get(inst.order_item_id) || [];
    list.push(inst);
    instancesByItemId.set(inst.order_item_id, list);
  }

  for (const item of items) {
    const itemInstances = instancesByItemId.get(item.id) || [];

    if (itemInstances.length > 0) {
      const statuses = itemInstances.map(i => i.status);

      if (statuses.some(s => s === 'picked' || s === 'packed')) hasPickingProgress = true;
      if (statuses.some(s => s === 'packed')) hasPackingProgress = true;

      if (!statuses.every(s => s === 'picked' || s === 'packed')) allPicked = false;
      if (!statuses.every(s => s === 'packed')) allPacked = false;
    } else {
      const qty = Number(item.quantity ?? 0);
      const pickedQty = Number(item.picked_quantity ?? 0);
      const packedQty = Number(item.packed_quantity ?? 0);

      if (pickedQty > 0) hasPickingProgress = true;
      if (packedQty > 0) hasPackingProgress = true;

      if (pickedQty < qty) {
        allPicked = false;
        allPacked = false;
      } else {
        if (packedQty < qty) allPacked = false;
      }
    }
  }

  if (allPicked && allPacked) return 'completed';
  if (hasPackingProgress) return 'packing';
  if (allPicked) return 'picked';
  if (hasPickingProgress) return 'picking';
  return 'pending';
}

async function fetchCandidateOrderIds(limit) {
  // 找出 status=completed 但「至少一個品項未完全 packed / 未達 qty」的訂單
  // 兼容：有 SN 的品項（instances）與無 SN 的品項（quantity）。
  const sql = `
    SELECT o.id
    FROM orders o
    WHERE o.status = 'completed'
      AND EXISTS (
        SELECT 1
        FROM order_items oi
        LEFT JOIN order_item_instances i ON i.order_item_id = oi.id
        WHERE oi.order_id = o.id
        GROUP BY oi.id, oi.quantity, oi.picked_quantity, oi.packed_quantity
        HAVING
          (
            COUNT(i.id) = 0
            AND (
              COALESCE(oi.picked_quantity, 0) < COALESCE(oi.quantity, 0)
              OR COALESCE(oi.packed_quantity, 0) < COALESCE(oi.quantity, 0)
            )
          )
          OR (
            COUNT(i.id) > 0
            AND BOOL_AND(i.status = 'packed') IS NOT TRUE
          )
      )
    ORDER BY o.updated_at DESC
    LIMIT $1;
  `;

  const { rows } = await pool.query(sql, [limit]);
  return rows.map(r => r.id);
}

async function main() {
  const { apply, limit } = parseArgs(process.argv);
  if (!process.env.DATABASE_URL) {
    console.error('Missing DATABASE_URL env var.');
    process.exitCode = 1;
    return;
  }

  logger.info('[fix-miscompleted-orders] start', { apply, limit });

  const orderIds = await fetchCandidateOrderIds(limit);
  if (orderIds.length === 0) {
    logger.info('[fix-miscompleted-orders] no candidates found');
    return;
  }

  const summary = {
    scanned: orderIds.length,
    willFix: 0,
    byTargetStatus: { pending: 0, picking: 0, picked: 0, packing: 0 },
    fixedOrderIds: []
  };

  for (const orderId of orderIds) {
    const items = (await pool.query('SELECT id, quantity, picked_quantity, packed_quantity FROM order_items WHERE order_id = $1 ORDER BY id', [orderId])).rows;
    const instances = (await pool.query(
      'SELECT i.id, i.order_item_id, i.status FROM order_item_instances i JOIN order_items oi ON i.order_item_id = oi.id WHERE oi.order_id = $1',
      [orderId]
    )).rows;

    const desired = computeDesiredStatus({ items, instances });

    // 只修正「現在是 completed 但實際不是 completed」
    if (desired !== 'completed') {
      summary.willFix += 1;
      summary.byTargetStatus[desired] = (summary.byTargetStatus[desired] || 0) + 1;
      summary.fixedOrderIds.push(orderId);

      if (apply) {
        await pool.query(
          "UPDATE orders SET status = $1, completed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND status = 'completed'",
          [desired, orderId]
        );
      }
    }
  }

  logger.info('[fix-miscompleted-orders] done', summary);
  if (!apply) {
    logger.warn('[fix-miscompleted-orders] dry-run only. Add --apply to write changes.');
  }

  // 讓輸出在 CI/terminal 更好讀
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((err) => {
    logger.error('[fix-miscompleted-orders] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
