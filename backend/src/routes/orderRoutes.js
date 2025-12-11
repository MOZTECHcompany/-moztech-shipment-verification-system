// backend/src/routes/orderRoutes.js
// 訂單操作相關端點（需先通過 authenticateToken）

const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const { pool } = require('../config/database');
const logger = require('../utils/logger');
const { authorizeAdmin } = require('../middleware/auth');
const { logOperation } = require('../services/operationLogService');
const { DEFAULT_ENTITY_ID, DEFAULT_CHANNEL_ID } = require('../config/erpAdapter');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Helper: Get or Create Product by SKU
async function getOrCreateProduct(client, sku, name) {
    // Try to find product by SKU and Entity
    const res = await client.query(
        'SELECT id FROM products WHERE sku = $1 AND entity_id = $2',
        [sku, DEFAULT_ENTITY_ID]
    );
    if (res.rows.length > 0) {
        return res.rows[0].id;
    }

    // If not found, create it (Simplified for integration)
    const insertRes = await client.query(
        `INSERT INTO products (id, entity_id, sku, name, has_serial_numbers)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)
         RETURNING id`,
        [DEFAULT_ENTITY_ID, sku, name, false]
    );
    return insertRes.rows[0].id;
}

// POST /api/orders/batch-claim
router.post('/orders/batch-claim', async (req, res) => {
    try {
        const { orderIds } = req.body;
        const userId = req.user.id;

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return res.status(400).json({ message: '請提供訂單ID列表' });
        }

        const result = await pool.query(
            `UPDATE sales_orders 
             SET picker_id = $1, status = 'picking', updated_at = NOW()
             WHERE id = ANY($2) AND status = 'pending'
             RETURNING id, external_order_id as voucher_number`,
            [userId, orderIds]
        );

        res.json({ 
            message: `成功認領 ${result.rows.length} 個訂單`,
            orders: result.rows
        });
    } catch (error) {
        logger.error('[/api/orders/batch-claim] 批次認領失敗:', error);
        res.status(500).json({ message: '批次認領失敗' });
    }
});

// POST /api/orders/batch/claim
router.post('/orders/batch/claim', async (req, res) => {
    const { orderIds } = req.body;
    const { id: userId, role } = req.user;
    const io = req.app.get('io');

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ message: '請提供訂單 ID 列表' });
    }

    try {
        const results = { success: [], failed: [] };

        for (const orderId of orderIds) {
            try {
                const result = await pool.query(
                    'SELECT id, status FROM sales_orders WHERE id = $1',
                    [orderId]
                );

                if (result.rows.length === 0) {
                    results.failed.push({ orderId, reason: '訂單不存在' });
                    continue;
                }

                const order = result.rows[0];

                if (order.status === 'pending' && (role === 'picker' || role === 'admin')) {
                    await pool.query(
                        "UPDATE sales_orders SET status = 'picking', picker_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
                        [userId, orderId]
                    );
                    await logOperation({
                        userId,
                        orderId,
                        operationType: 'claim',
                        details: { previous_status: 'pending', new_status: 'picking' },
                        io
                    });
                    io?.emit('task_status_changed', { orderId, newStatus: 'picking' });
                    results.success.push(orderId);
                } else if (order.status === 'picking' && (role === 'packer' || role === 'admin')) {
                    await pool.query(
                        "UPDATE sales_orders SET status = 'packing', packer_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
                        [userId, orderId]
                    );
                    await logOperation({
                        userId,
                        orderId,
                        operationType: 'claim',
                        details: { previous_status: 'picking', new_status: 'packing' },
                        io
                    });
                    io?.emit('task_status_changed', { orderId, newStatus: 'packing' });
                    results.success.push(orderId);
                } else {
                    results.failed.push({ orderId, reason: '訂單狀態不符或權限不足' });
                }
            } catch (error) {
                results.failed.push({ orderId, reason: error.message });
            }
        }

        res.json({
            message: `批次認領完成: 成功 ${results.success.length} 筆, 失敗 ${results.failed.length} 筆`,
            results
        });
    } catch (error) {
        logger.error('[/api/orders/batch/claim] 失敗:', error);
        res.status(500).json({ message: '批次認領失敗' });
    }
});

// POST /api/orders/:orderId/claim
router.post('/orders/:orderId/claim', async (req, res, next) => {
    const { orderId } = req.params;
    const { id: userId, role } = req.user;
    const io = req.app.get('io');
    logger.debug(`[/orders/${orderId}/claim] 使用者嘗試認領任務 - userId: ${userId}, role: ${role}`);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const orderResult = await client.query('SELECT * FROM sales_orders WHERE id = $1 FOR UPDATE', [orderId]);
        if (orderResult.rows.length === 0) {
            logger.warn(`[/orders/${orderId}/claim] 錯誤: 找不到訂單`);
            await client.query('ROLLBACK');
            return res.status(404).json({ message: '找不到該訂單' });
        }
        const order = orderResult.rows[0];
        logger.debug(`[/orders/${orderId}/claim] 訂單狀態: ${order.status}, picker_id: ${order.picker_id}, packer_id: ${order.packer_id}`);
        let newStatus = '', task_type = '';
        if ((role === 'picker' || role === 'admin') && order.status === 'pending') {
            newStatus = 'picking'; task_type = 'pick';
            await client.query('UPDATE sales_orders SET status = $1, picker_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [newStatus, userId, orderId]);
            logger.info(`[/orders/${orderId}/claim] 成功認領揀貨任務`);
        } else if ((role === 'packer' || role === 'admin') && (order.status === 'picked' || order.status === 'picking')) {
            newStatus = 'packing'; task_type = 'pack';
            await client.query('UPDATE sales_orders SET status = $1, packer_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [newStatus, userId, orderId]);
            logger.info(`[/orders/${orderId}/claim] 成功認領裝箱任務`);
        } else {
            logger.warn(`[/orders/${orderId}/claim] 認領失敗 - 角色: ${role}, 訂單狀態: ${order.status}`);
            await client.query('ROLLBACK');
            return res.status(400).json({ message: `無法認領該任務，訂單狀態為「${order.status}」，可能已被他人處理。` });
        }
        await client.query('COMMIT');
        await logOperation({ userId, orderId, operationType: 'claim', details: { new_status: newStatus }, io });
        
        const updatedOrder = (await pool.query(
            `SELECT o.*, u.name as current_user 
             FROM sales_orders o 
             LEFT JOIN users u ON (CASE WHEN $1 = 'pick' THEN o.picker_id WHEN $1 = 'pack' THEN o.packer_id END) = u.id 
             WHERE o.id = $2`, 
            [task_type, orderId]
        )).rows[0];
        
        if (updatedOrder) {
            updatedOrder.voucher_number = updatedOrder.external_order_id;
        }

        io?.emit('task_claimed', { ...updatedOrder, task_type });
        res.status(200).json({ message: '任務認領成功' });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error(`[/orders/${orderId}/claim] 發生錯誤:`, error);
        next(error);
    } finally {
        client.release();
    }
});

// GET /api/orders/:orderId
router.get('/orders/:orderId', async (req, res) => {
    const { orderId } = req.params;
    const orderResult = await pool.query(
        `SELECT o.*, p.name as picker_name, pk.name as packer_name 
         FROM sales_orders o 
         LEFT JOIN users p ON o.picker_id = p.id 
         LEFT JOIN users pk ON o.packer_id = pk.id 
         WHERE o.id = $1`, 
        [orderId]
    );
    if (orderResult.rows.length === 0) return res.status(404).json({ message: '找不到訂單' });
    
    const order = orderResult.rows[0];
    order.voucher_number = order.external_order_id;

    const itemsResult = await pool.query(
        `SELECT soi.*, p.sku as product_code, p.name as product_name, p.barcode 
         FROM sales_order_items soi 
         JOIN products p ON soi.product_id = p.id 
         WHERE soi.sales_order_id = $1 
         ORDER BY soi.id`, 
        [orderId]
    );
    
    const instancesResult = await pool.query(
        `SELECT id, serial_number 
         FROM inventory_serial_numbers 
         WHERE outbound_ref_id = $1 
         ORDER BY id`, 
        [orderId]
    );
    
    res.json({ order, items: itemsResult.rows, instances: instancesResult.rows });
});

// PATCH /api/orders/:orderId/void
router.patch('/orders/:orderId/void', authorizeAdmin, async (req, res) => {
    const { orderId } = req.params;
    const { reason } = req.body;
    const io = req.app.get('io');
    const result = await pool.query(
        "UPDATE sales_orders SET status = 'voided', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING external_order_id as voucher_number", 
        [orderId]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: '找不到要作廢的訂單' });
    await logOperation({ userId: req.user.id, orderId, operationType: 'void', details: { reason }, io });
    io?.emit('task_status_changed', { orderId: orderId, newStatus: 'voided' });
    res.json({ message: `訂單 ${result.rows[0].voucher_number} 已成功作廢` });
});

// PATCH /api/orders/:orderId/urgent
router.patch('/orders/:orderId/urgent', authorizeAdmin, async (req, res) => {
    // ERP 暫不支援緊急標記，僅回傳成功以維持前端相容性
    res.json({ message: 'ERP 暫不支援緊急標記' });
});

// DELETE /api/orders/:orderId
router.delete('/orders/:orderId', authorizeAdmin, async (req, res) => {
    const { orderId } = req.params;
    const io = req.app.get('io');
    const result = await pool.query('DELETE FROM sales_orders WHERE id = $1 RETURNING external_order_id as voucher_number', [orderId]);
    if (result.rowCount === 0) return res.status(404).json({ message: '找不到要刪除的訂單' });
    io?.emit('task_deleted', { orderId: orderId });
    res.status(200).json({ message: `訂單 ${result.rows[0].voucher_number} 已被永久刪除` });
});

// POST /api/orders/import
router.post('/orders/import', authorizeAdmin, upload.single('orderFile'), async (req, res, next) => {
    const io = req.app.get('io');
    if (!req.file) return res.status(400).json({ message: '沒有上傳檔案' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
        
        const voucherCellRaw = data[1]?.[0] ? String(data[1][0]) : '';
        let voucherNumber = null;
        const voucherParts = voucherCellRaw.split(/[:：]/);
        if (voucherParts.length > 1) voucherNumber = voucherParts[1].trim();
        if (!voucherNumber) return res.status(400).json({ message: "Excel 格式錯誤：找不到憑證號碼。" });
        
        const existingOrder = await client.query('SELECT id FROM sales_orders WHERE external_order_id = $1', [voucherNumber]);
        if (existingOrder.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ message: `訂單 ${voucherNumber} 已存在` });
        }
        
        const orderResult = await client.query(
            `INSERT INTO sales_orders (
                id, entity_id, channel_id, external_order_id, status, 
                order_date, total_gross_original, total_gross_base
            ) VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), 0, 0) RETURNING id`, 
            [DEFAULT_ENTITY_ID, DEFAULT_CHANNEL_ID, voucherNumber, 'pending']
        );
        const orderId = orderResult.rows[0].id;
        
        let itemsStartRow = -1, headerRow = [];
        for (let i = 0; i < data.length; i++) {
            if (data[i]?.some(cell => String(cell).includes('品項編碼'))) {
                itemsStartRow = i + 1;
                headerRow = data[i];
                break;
            }
        }
        if (itemsStartRow === -1) { await client.query('ROLLBACK'); return res.status(400).json({ message: "Excel 档案格式错误：找不到品项标头" }); }
        
        const barcodeIndex = headerRow.findIndex(h => String(h).includes('品項編碼'));
        const nameAndSkuIndex = headerRow.findIndex(h => String(h).includes('品項名稱'));
        const quantityIndex = headerRow.findIndex(h => String(h).includes('數量'));
        const summaryIndex = headerRow.findIndex(h => String(h).includes('摘要'));
        
        if (barcodeIndex === -1 || nameAndSkuIndex === -1 || quantityIndex === -1) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: "Excel 档案格式错误：缺少 '品項編碼'、'品項名稱' 或 '數量' 栏位" });
        }
        
        for (let i = itemsStartRow; i < data.length; i++) {
            const row = data[i];
            if (!row?.[barcodeIndex] || !row?.[nameAndSkuIndex] || !row?.[quantityIndex]) continue;
            
            const barcode = String(row[barcodeIndex]);
            const fullNameAndSku = String(row[nameAndSkuIndex]);
            const quantity = parseInt(row[quantityIndex], 10);
            const summary = summaryIndex > -1 && row[summaryIndex] ? String(row[summaryIndex]).replace(/[ㆍ\s]/g, '') : '';
            
            const skuMatch = fullNameAndSku.match(/\[(.*?)\]/);
            const productCode = skuMatch ? skuMatch[1] : barcode;
            const productName = skuMatch ? fullNameAndSku.substring(0, skuMatch.index).trim() : fullNameAndSku.trim();
            
            if (productCode && !isNaN(quantity) && quantity > 0) {
                const productId = await getOrCreateProduct(client, productCode, productName);
                
                await client.query(
                    `INSERT INTO sales_order_items (
                        id, sales_order_id, product_id, qty, 
                        unit_price_original, unit_price_base
                    ) VALUES (gen_random_uuid(), $1, $2, $3, 0, 0)`, 
                    [orderId, productId, quantity]
                );
                
                if (summary) {
                    const snLength = 12;
                    const serialNumbers = [];
                    for (let j = 0; j < summary.length; j += snLength) {
                        const sn = summary.substring(j, j + snLength);
                        if (sn.length === snLength) serialNumbers.push(sn);
                    }
                    
                    for (const sn of serialNumbers) {
                        const snCheck = await client.query(
                            'SELECT id FROM inventory_serial_numbers WHERE serial_number = $1 AND entity_id = $2 AND product_id = $3',
                            [sn, DEFAULT_ENTITY_ID, productId]
                        );
                        
                        if (snCheck.rows.length > 0) {
                            await client.query(
                                `UPDATE inventory_serial_numbers 
                                 SET outbound_ref_type = 'SALES_ORDER', outbound_ref_id = $1, status = 'RESERVED'
                                 WHERE id = $2`,
                                [orderId, snCheck.rows[0].id]
                            );
                        } else {
                            await client.query(
                                `INSERT INTO inventory_serial_numbers (
                                    id, entity_id, product_id, serial_number, status, 
                                    outbound_ref_type, outbound_ref_id
                                ) VALUES (gen_random_uuid(), $1, $2, $3, 'RESERVED', 'SALES_ORDER', $4)`,
                                [DEFAULT_ENTITY_ID, productId, sn, orderId]
                            );
                        }
                    }
                }
            }
        }
        await client.query('COMMIT');
        res.json({ message: '匯入成功', orderId });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('匯入失敗:', error);
        res.status(500).json({ message: '匯入失敗: ' + error.message });
    } finally {
        client.release();
    }
});

module.exports = router;
