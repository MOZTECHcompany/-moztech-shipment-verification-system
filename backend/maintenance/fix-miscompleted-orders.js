#!/usr/bin/env node

/*
  修正「狀態被推進到完成階段，但實際未揀貨/未裝箱」的歷史訂單。

  會檢查 orders.status IN ('picked','packing','completed') 的訂單，依 order_items / order_item_instances
  回推到正確狀態（pending/picking/picked/packing/completed）。

  為了安全：只會把狀態往回修正（不會把未完成的單修到 completed）。

  預設為 dry-run（只輸出會修正哪些訂單，不寫入 DB）。

  用法：
    node maintenance/fix-miscompleted-orders.js --limit=500
    node maintenance/fix-miscompleted-orders.js --apply --limit=500

  參數：
    --apply        實際寫入 DB（不加則 dry-run）
    --limit=NUM    最多掃描幾筆（預設 500）
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

function statusRank(status) {
  switch (status) {
    case 'pending':
      return 0;
    case 'picking':
      return 1;
    case 'picked':
      return 2;
    case 'packing':
      return 3;
    case 'completed':
      return 4;
    default:
      return -1;
  }
}

async function fetchCandidateOrders(limit) {
  // 聚焦在「完成階段」的狀態，避免掃描過多無關資料
  const sql = `
    SELECT id, status
    FROM orders
    WHERE status IN ('picked', 'packing', 'completed')
    ORDER BY updated_at DESC
    LIMIT $1;
  `;
  const { rows } = await pool.query(sql, [limit]);
  return rows;
}

async function main() {
  const { apply, limit } = parseArgs(process.argv);
  if (!process.env.DATABASE_URL) {
    console.error('Missing DATABASE_URL env var.');
    process.exitCode = 1;
    return;
  }

  logger.info('[fix-miscompleted-orders] start', { apply, limit });

  const candidates = await fetchCandidateOrders(limit);
  if (candidates.length === 0) {
    logger.info('[fix-miscompleted-orders] no candidates found');
    return;
  }

  const summary = {
    scanned: candidates.length,
    willFix: 0,
    byTargetStatus: { pending: 0, picking: 0, picked: 0, packing: 0 },
    byFromTo: {},
    fixedOrderIds: []
  };

  for (const row of candidates) {
    const orderId = row.id;
    const currentStatus = row.status;

    const items = (await pool.query('SELECT id, quantity, picked_quantity, packed_quantity FROM order_items WHERE order_id = $1 ORDER BY id', [orderId])).rows;
    const instances = (await pool.query(
      'SELECT i.id, i.order_item_id, i.status FROM order_item_instances i JOIN order_items oi ON i.order_item_id = oi.id WHERE oi.order_id = $1',
      [orderId]
    )).rows;

    const desired = computeDesiredStatus({ items, instances });

    const currentRank = statusRank(currentStatus);
    const desiredRank = statusRank(desired);

    // 只做「往回修正」，避免誤把未完成訂單推進到 completed
    if (currentRank >= 0 && desiredRank >= 0 && desiredRank < currentRank) {
      summary.willFix += 1;
      summary.byTargetStatus[desired] = (summary.byTargetStatus[desired] || 0) + 1;
      summary.fixedOrderIds.push(orderId);

      const key = `${currentStatus} -> ${desired}`;
      summary.byFromTo[key] = (summary.byFromTo[key] || 0) + 1;

      if (apply) {
        await pool.query(
          'UPDATE orders SET status = $1, completed_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
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
