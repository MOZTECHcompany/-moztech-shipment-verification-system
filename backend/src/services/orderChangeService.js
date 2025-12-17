// backend/src/services/orderChangeService.js
// Apply order item change requests (add/remove/adjust) with rollback rules.

const logger = require('../utils/logger');

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function normalizeBarcode(value) {
    if (!isNonEmptyString(value)) return null;
    return String(value).trim().slice(0, 200);
}

function normalizeProductName(value) {
    if (!isNonEmptyString(value)) return null;
    return String(value).trim().slice(0, 200);
}

function normalizeNote(value) {
    if (!isNonEmptyString(value)) return null;
    return String(value).trim().slice(0, 2000);
}

function parseSnList(value) {
    if (!value) return [];
    const arr = Array.isArray(value) ? value : [];
    const cleaned = arr
        .map((x) => (x == null ? '' : String(x).trim()))
        .filter((x) => x.length > 0)
        .map((x) => x.replace(/^SN\s*[:：]/i, '').trim())
        .slice(0, 500);

    // De-dup while preserving order
    const seen = new Set();
    const unique = [];
    for (const sn of cleaned) {
        const key = sn.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(sn);
    }
    return unique;
}

function normalizeQuantityChange(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const i = Math.trunc(n);
    if (i === 0) return null;
    return i;
}

function validateOrderChangeProposal(proposal) {
    const note = normalizeNote(proposal?.note);
    if (!note) {
        return { ok: false, message: '異動原因必填（note）' };
    }

    if (!Array.isArray(proposal?.items) || proposal.items.length === 0) {
        return { ok: false, message: '請提供異動品項（items）' };
    }

    const items = [];

    for (const raw of proposal.items.slice(0, 200)) {
        const barcode = normalizeBarcode(raw?.barcode);
        const productName = normalizeProductName(raw?.productName);
        const quantityChange = normalizeQuantityChange(raw?.quantityChange);
        const noSn = !!raw?.noSn;
        const snList = parseSnList(raw?.snList);
        const removedSnList = parseSnList(raw?.removedSnList);

        if (!barcode) return { ok: false, message: '品項 barcode 必填' };
        if (!productName) return { ok: false, message: `品項 ${barcode} productName 必填` };
        if (quantityChange == null) return { ok: false, message: `品項 ${barcode} quantityChange 無效` };

        // If adding SN-tracked items, snList is required and count must match.
        if (!noSn && quantityChange > 0) {
            if (snList.length !== quantityChange) {
                return { ok: false, message: `品項 ${barcode} 為有 SN，新增數量 ${quantityChange} 必須提供同數量 SN（目前 ${snList.length}）` };
            }
        }

        // If removing SN-tracked items, removedSnList is optional for backward compatibility.
        // If provided, it must match the removal count.
        if (!noSn && quantityChange < 0 && removedSnList.length > 0) {
            const removeCount = Math.abs(quantityChange);
            if (removedSnList.length !== removeCount) {
                return { ok: false, message: `品項 ${barcode} 為有 SN，減少數量 ${removeCount} 必須提供同數量待移除 SN（目前 ${removedSnList.length}）` };
            }
        }

        items.push({ barcode, productName, quantityChange, noSn, snList, removedSnList });
    }

    return { ok: true, value: { note, items } };
}

async function hasAnyOpenOrderChange(client, orderId) {
    try {
        const r = await client.query(
            `SELECT EXISTS(
                SELECT 1 FROM order_exceptions
                WHERE order_id = $1 AND status = 'open' AND type = 'order_change'
            ) AS has_open`,
            [orderId]
        );
        return !!r.rows[0]?.has_open;
    } catch (err) {
        // If migrations aren't applied yet, don't block.
        if (err && (err.code === '42P01' || /order_exceptions/i.test(err.message || ''))) {
            return false;
        }
        throw err;
    }
}

async function fetchOrderItemsByBarcodeForUpdate(client, orderId, barcode) {
    return client.query(
        `SELECT *
         FROM order_items
         WHERE order_id = $1 AND barcode = $2
         ORDER BY id ASC
         FOR UPDATE`,
        [orderId, barcode]
    );
}

async function fetchInstancesForOrderItemIdsForUpdate(client, orderItemIds) {
    if (!orderItemIds.length) return { rows: [] };
    return client.query(
        `SELECT *
         FROM order_item_instances
         WHERE order_item_id = ANY($1::int[])
         ORDER BY id DESC
         FOR UPDATE`,
        [orderItemIds]
    );
}

function sumBy(rows, key) {
    return rows.reduce((acc, r) => acc + Number(r?.[key] ?? 0), 0);
}

function normalizeOrderStatusForRollback(status) {
    const s = status ? String(status).toLowerCase() : '';
    return s;
}

async function rollbackNonSnQuantities(client, orderItemRow, newQuantity) {
    const qty = Math.max(0, Number(newQuantity ?? 0));
    const picked = Math.max(0, Number(orderItemRow?.picked_quantity ?? 0));
    const packed = Math.max(0, Number(orderItemRow?.packed_quantity ?? 0));

    let nextPacked = packed;
    let nextPicked = picked;

    if (nextPacked > qty) nextPacked = qty;
    if (nextPicked > qty) nextPicked = qty;
    if (nextPacked > nextPicked) nextPacked = nextPicked;

    await client.query(
        `UPDATE order_items
         SET quantity = $1,
             picked_quantity = $2,
             packed_quantity = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [qty, nextPicked, nextPacked, orderItemRow.id]
    );

    return { previous: { quantity: Number(orderItemRow.quantity ?? 0), picked, packed }, next: { quantity: qty, picked: nextPicked, packed: nextPacked } };
}

async function ensureNoDuplicateSerialsInOrder(client, orderId, serialNumbers) {
    if (!serialNumbers.length) return;
    const r = await client.query(
        `SELECT i.serial_number
         FROM order_item_instances i
         JOIN order_items oi ON oi.id = i.order_item_id
         WHERE oi.order_id = $1 AND i.serial_number = ANY($2::text[])
         LIMIT 1`,
        [orderId, serialNumbers]
    );
    if (r.rowCount > 0) {
        const sn = r.rows[0]?.serial_number;
        const e = new Error(`SN 已存在於此訂單：${sn}`);
        e.status = 409;
        throw e;
    }
}

function pickInstancesToRemove(instances, removeCount) {
    // Highest priority: packed -> picked -> pending, newest first (already ordered)
    const byStatus = (status) => instances.filter((i) => String(i.status).toLowerCase() === status);
    const packed = byStatus('packed');
    const picked = byStatus('picked');
    const pending = byStatus('pending');

    const chosen = [];
    for (const group of [packed, picked, pending]) {
        for (const inst of group) {
            if (chosen.length >= removeCount) break;
            chosen.push(inst);
        }
        if (chosen.length >= removeCount) break;
    }
    return chosen;
}

async function applyOrderChangeProposal({ client, orderId, proposal, actorUserId }) {
    const validated = validateOrderChangeProposal(proposal);
    if (!validated.ok) {
        const e = new Error(validated.message);
        e.status = 400;
        throw e;
    }

    // Lock order row
    const orderResult = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (orderResult.rowCount === 0) {
        const e = new Error('找不到指定訂單');
        e.status = 404;
        throw e;
    }
    const order = orderResult.rows[0];
    const originalStatus = normalizeOrderStatusForRollback(order.status);

    const changesApplied = [];

    for (const change of validated.value.items) {
        const { barcode, productName, quantityChange, noSn, snList, removedSnList } = change;

        const itemRows = await fetchOrderItemsByBarcodeForUpdate(client, orderId, barcode);
        const existingItems = itemRows.rows || [];
        const existingTotalQty = sumBy(existingItems, 'quantity');
        const targetTotalQty = existingTotalQty + quantityChange;

        const existingOrderItemIds = existingItems.map((r) => r.id);
        const instancesResult = await fetchInstancesForOrderItemIdsForUpdate(client, existingOrderItemIds);
        const existingInstances = instancesResult.rows || [];
        const isExistingSn = existingInstances.length > 0;

        // Prevent switching modes on existing items
        if (existingItems.length > 0 && isExistingSn && noSn) {
            const e = new Error(`品項 ${barcode} 原為有 SN，不可改為無 SN`);
            e.status = 400;
            throw e;
        }
        if (existingItems.length > 0 && !isExistingSn && !noSn) {
            const e = new Error(`品項 ${barcode} 原為無 SN，不可改為有 SN`);
            e.status = 400;
            throw e;
        }

        // =====================
        // SN-tracked items
        // =====================
        if (!noSn) {
            // Ensure new SNs don't collide
            if (quantityChange > 0) {
                await ensureNoDuplicateSerialsInOrder(client, orderId, snList);
            }

            // Create row if missing
            if (existingItems.length === 0) {
                if (quantityChange <= 0) {
                    const e = new Error(`品項 ${barcode} 不存在，無法減量/刪除`);
                    e.status = 400;
                    throw e;
                }

                const insert = await client.query(
                    `INSERT INTO order_items (order_id, product_code, product_name, quantity, barcode)
                     VALUES ($1, $2, $3, $4, $5)
                     RETURNING id`,
                    [orderId, barcode, productName, quantityChange, barcode]
                );
                const newOrderItemId = insert.rows[0].id;

                for (const sn of snList) {
                    await client.query(
                        'INSERT INTO order_item_instances (order_item_id, serial_number, status) VALUES ($1, $2, $3)',
                        [newOrderItemId, sn, 'pending']
                    );
                }

                changesApplied.push({
                    barcode,
                    mode: 'sn',
                    action: 'add',
                    previousTotalQuantity: 0,
                    newTotalQuantity: quantityChange,
                    addedSerialNumbers: snList
                });

                continue;
            }

            // Existing SN: adjust by adding/removing instances and quantities.
            // Choose a primary row (smallest id) to hold any added instances/quantity.
            const primary = existingItems[0];

            if (targetTotalQty < 0) {
                const e = new Error(`品項 ${barcode} 異動後數量不可小於 0`);
                e.status = 400;
                throw e;
            }

            if (quantityChange > 0) {
                // Increase required quantity: add instances and bump quantity on primary row
                await client.query('UPDATE order_items SET quantity = quantity + $1, product_name = COALESCE($2, product_name), updated_at = CURRENT_TIMESTAMP WHERE id = $3', [quantityChange, productName, primary.id]);
                for (const sn of snList) {
                    await client.query(
                        'INSERT INTO order_item_instances (order_item_id, serial_number, status) VALUES ($1, $2, $3)',
                        [primary.id, sn, 'pending']
                    );
                }

                changesApplied.push({
                    barcode,
                    mode: 'sn',
                    action: 'increase',
                    previousTotalQuantity: existingTotalQty,
                    newTotalQuantity: targetTotalQty,
                    addedSerialNumbers: snList
                });
                continue;
            }

            if (quantityChange < 0) {
                const removeCount = Math.abs(quantityChange);

                // Allow decrease only from pending instances.
                // Guard: target quantity cannot go below picked+packed count.
                const pickedPackedCount = existingInstances.reduce((acc, i) => {
                    const st = String(i?.status || '').toLowerCase();
                    if (st === 'picked' || st === 'packed') return acc + 1;
                    return acc;
                }, 0);
                if (targetTotalQty < pickedPackedCount) {
                    const e = new Error(`品項 ${barcode} 目標數量不可小於已刷過的 SN（picked/packed=${pickedPackedCount}）`);
                    e.status = 409;
                    throw e;
                }

                const pendingInstances = existingInstances.filter((i) => String(i?.status || '').toLowerCase() === 'pending');
                let chosen = [];
                let removalSource = 'auto';

                if (Array.isArray(removedSnList) && removedSnList.length > 0) {
                    if (removedSnList.length !== removeCount) {
                        const e = new Error(`品項 ${barcode} 需移除 ${removeCount} 筆 SN，但提供 ${removedSnList.length} 筆`);
                        e.status = 400;
                        throw e;
                    }

                    const pendingBySn = new Map(pendingInstances.map((inst) => [String(inst.serial_number || '').toUpperCase(), inst]));
                    const missing = [];
                    for (const sn of removedSnList) {
                        const inst = pendingBySn.get(String(sn).toUpperCase());
                        if (!inst) missing.push(sn);
                        else chosen.push(inst);
                    }
                    if (missing.length > 0) {
                        const e = new Error(`品項 ${barcode} 有 SN 不存在或非 pending，無法移除：${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}`);
                        e.status = 409;
                        throw e;
                    }
                    removalSource = 'specified';
                } else {
                    chosen = pendingInstances.slice(0, removeCount);
                    removalSource = 'auto';
                }

                if (chosen.length !== removeCount) {
                    const e = new Error(`品項 ${barcode} 需移除 ${removeCount} 筆 SN，但 pending 僅剩 ${pendingInstances.length} 筆`);
                    e.status = 409;
                    throw e;
                }

                // Remove the instances (all pending)
                const removedSerials = chosen.map((i) => i.serial_number);
                await client.query('DELETE FROM order_item_instances WHERE id = ANY($1::int[])', [chosen.map((i) => i.id)]);

                // Reduce quantities across rows to match new total.
                // We reduce from the last rows first to avoid disturbing primary row if possible.
                let remainingToReduce = removeCount;
                const rowsDesc = [...existingItems].sort((a, b) => b.id - a.id);
                for (const row of rowsDesc) {
                    if (remainingToReduce <= 0) break;
                    const q = Number(row.quantity ?? 0);
                    const reduceHere = Math.min(q, remainingToReduce);
                    const newQ = q - reduceHere;
                    await client.query('UPDATE order_items SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newQ, row.id]);
                    remainingToReduce -= reduceHere;
                }

                // Delete empty rows
                await client.query(
                    `DELETE FROM order_items oi
                     WHERE oi.order_id = $1
                       AND oi.barcode = $2
                       AND COALESCE(oi.quantity, 0) <= 0
                       AND NOT EXISTS (
                           SELECT 1 FROM order_item_instances i
                           WHERE i.order_item_id = oi.id
                       )`,
                    [orderId, barcode]
                );

                changesApplied.push({
                    barcode,
                    mode: 'sn',
                    action: 'decrease',
                    previousTotalQuantity: existingTotalQty,
                    newTotalQuantity: existingTotalQty - removeCount,
                    removedSerialNumbers: removedSerials,
                    removalSource
                });
                continue;
            }

            // quantityChange == 0 handled earlier
            continue;
        }

        // =====================
        // Non-SN items
        // =====================
        if (existingItems.length === 0) {
            if (quantityChange <= 0) {
                const e = new Error(`品項 ${barcode} 不存在，無法減量/刪除`);
                e.status = 400;
                throw e;
            }

            await client.query(
                `INSERT INTO order_items (order_id, product_code, product_name, quantity, barcode, picked_quantity, packed_quantity)
                 VALUES ($1, $2, $3, $4, $5, 0, 0)`,
                [orderId, barcode, productName, quantityChange, barcode]
            );

            changesApplied.push({
                barcode,
                mode: 'barcode',
                action: 'add',
                previousTotalQuantity: 0,
                newTotalQuantity: quantityChange
            });
            continue;
        }

        if (targetTotalQty < 0) {
            const e = new Error(`品項 ${barcode} 異動後數量不可小於 0`);
            e.status = 400;
            throw e;
        }

        // Collapse to the first row.
        const first = existingItems[0];
        // Delete others after we lock them.
        const others = existingItems.slice(1);

        // Adjust quantities + rollback picked/packed if needed
        const rollbackInfo = await rollbackNonSnQuantities(client, first, targetTotalQty);

        // Update product name if provided
        await client.query(
            'UPDATE order_items SET product_name = COALESCE($1, product_name) WHERE id = $2',
            [productName, first.id]
        );

        if (others.length > 0) {
            await client.query('DELETE FROM order_items WHERE id = ANY($1::int[])', [others.map((r) => r.id)]);
        }

        if (targetTotalQty === 0) {
            // Delete the remaining row entirely
            await client.query('DELETE FROM order_items WHERE id = $1', [first.id]);
        }

        changesApplied.push({
            barcode,
            mode: 'barcode',
            action: quantityChange > 0 ? 'increase' : (quantityChange < 0 ? 'decrease' : 'noop'),
            previousTotalQuantity: existingTotalQty,
            newTotalQuantity: targetTotalQty,
            rollback: rollbackInfo
        });
    }

    // Force status back to picking as per spec (to pick only changed items; unchanged remain satisfied).
    // Keep assignment ids, but ensure status reflects the rollback.
    if (originalStatus && originalStatus !== 'pending') {
        await client.query("UPDATE orders SET status = 'picking', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [orderId]);
    } else {
        await client.query("UPDATE orders SET status = 'picking', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [orderId]);
    }

    return {
        orderId: parseInt(orderId, 10),
        actorUserId,
        previousStatus: originalStatus,
        newStatus: 'picking',
        changesApplied
    };
}

module.exports = {
    validateOrderChangeProposal,
    applyOrderChangeProposal,
    hasAnyOpenOrderChange
};
