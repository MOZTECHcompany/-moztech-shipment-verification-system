// backend/src/routes/orderRoutes.js
// 訂單操作相關端點（需先通過 authenticateToken）

const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const { pool } = require('../config/database');
const logger = require('../utils/logger');
const { authorizeAdmin } = require('../middleware/auth');
const { logOperation } = require('../services/operationLogService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/orders/batch-claim
router.post('/orders/batch-claim', async (req, res) => {
    try {
        const { orderIds } = req.body;
        const userId = req.user.id;

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return res.status(400).json({ message: '請提供訂單ID列表' });
        }

        const result = await pool.query(
            `UPDATE orders 
             SET picker_id = $1, status = 'picking', updated_at = NOW()
             WHERE id = ANY($2) AND status = 'pending'
             RETURNING id, voucher_number`,
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
                    'SELECT id, status FROM orders WHERE id = $1',
                    [orderId]
                );

                if (result.rows.length === 0) {
                    results.failed.push({ orderId, reason: '訂單不存在' });
                    continue;
                }

                const order = result.rows[0];

                if (order.status === 'pending' && (role === 'picker' || role === 'admin')) {
                    await pool.query(
                        "UPDATE orders SET status = 'picking', picker_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
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
                        "UPDATE orders SET status = 'packing', packer_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
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
        const orderResult = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
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
            await client.query('UPDATE orders SET status = $1, picker_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [newStatus, userId, orderId]);
            logger.info(`[/orders/${orderId}/claim] 成功認領揀貨任務`);
        } else if ((role === 'packer' || role === 'admin') && order.status === 'picked') {
            newStatus = 'packing'; task_type = 'pack';
            await client.query('UPDATE orders SET status = $1, packer_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [newStatus, userId, orderId]);
            logger.info(`[/orders/${orderId}/claim] 成功認領裝箱任務`);
        } else {
            logger.warn(`[/orders/${orderId}/claim] 認領失敗 - 角色: ${role}, 訂單狀態: ${order.status}`);
            await client.query('ROLLBACK');
            return res.status(400).json({ message: `無法認領該任務，訂單狀態為「${order.status}」，可能已被他人處理。` });
        }
        await client.query('COMMIT');
        await logOperation({ userId, orderId, operationType: 'claim', details: { new_status: newStatus }, io });
        const updatedOrder = (await pool.query('SELECT o.*, u.name as current_user FROM orders o LEFT JOIN users u ON (CASE WHEN $1 = \'pick\' THEN o.picker_id WHEN $1 = \'pack\' THEN o.packer_id END) = u.id WHERE o.id = $2', [task_type, orderId])).rows[0];
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
router.get('/orders/:orderId', async (req, res, next) => {
    const { orderId } = req.params;
    const io = req.app.get('io');
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const orderResult = await client.query(
            'SELECT o.*, p.name as picker_name, pk.name as packer_name FROM orders o LEFT JOIN users p ON o.picker_id = p.id LEFT JOIN users pk ON o.packer_id = pk.id WHERE o.id = $1 FOR UPDATE;',
            [orderId]
        );
        if (orderResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: '找不到訂單' });
        }
        const order = orderResult.rows[0];

        const itemsResult = await client.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
        const instancesResult = await client.query(
            'SELECT i.* FROM order_item_instances i JOIN order_items oi ON i.order_item_id = oi.id WHERE oi.order_id = $1 ORDER BY i.id',
            [orderId]
        );

        // 自動修正卡住的狀態（例：畫面顯示都已完成但還停在裝箱中）
        let allPicked = true;
        let allPacked = true;

        for (const item of itemsResult.rows) {
            const itemInstances = instancesResult.rows.filter(inst => inst.order_item_id === item.id);
            if (itemInstances.length > 0) {
                if (!itemInstances.every(i => ['picked', 'packed'].includes(i.status))) allPicked = false;
                if (!itemInstances.every(i => i.status === 'packed')) allPacked = false;
            } else {
                const qty = Number(item.quantity ?? 0);
                const pickedQty = Number(item.picked_quantity ?? 0);
                const packedQty = Number(item.packed_quantity ?? 0);

                if (pickedQty < qty) allPicked = false;
                const requiredPackQty = Math.min(qty, pickedQty);
                if (packedQty < requiredPackQty) allPacked = false;
            }
        }

        let statusChanged = false;
        let newStatus = order.status;

        if (allPacked && order.status !== 'completed') {
            newStatus = 'completed';
            statusChanged = true;
            await client.query(
                "UPDATE orders SET status = 'completed', completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP, packer_id = COALESCE(packer_id, $1) WHERE id = $2",
                [req.user?.id || null, orderId]
            );
        } else if (allPicked && (order.status === 'picking' || order.status === 'pending')) {
            newStatus = 'picked';
            statusChanged = true;
            await client.query("UPDATE orders SET status = 'picked', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [orderId]);
        }

        await client.query('COMMIT');

        if (statusChanged) {
            io?.emit('task_status_changed', { orderId: parseInt(orderId, 10), newStatus });
        }

        const refreshedOrder = await pool.query(
            'SELECT o.*, p.name as picker_name, pk.name as packer_name FROM orders o LEFT JOIN users p ON o.picker_id = p.id LEFT JOIN users pk ON o.packer_id = pk.id WHERE o.id = $1;',
            [orderId]
        );
        const refreshedItems = await pool.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
        const refreshedInstances = await pool.query(
            'SELECT i.* FROM order_item_instances i JOIN order_items oi ON i.order_item_id = oi.id WHERE oi.order_id = $1 ORDER BY i.id',
            [orderId]
        );

        res.json({ order: refreshedOrder.rows[0], items: refreshedItems.rows, instances: refreshedInstances.rows });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
});

// PATCH /api/orders/:orderId/void
router.patch('/orders/:orderId/void', authorizeAdmin, async (req, res) => {
    const { orderId } = req.params;
    const { reason } = req.body;
    const io = req.app.get('io');
    const result = await pool.query("UPDATE orders SET status = 'voided', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING voucher_number", [orderId]);
    if (result.rowCount === 0) return res.status(404).json({ message: '找不到要作廢的訂單' });
    await logOperation({ userId: req.user.id, orderId, operationType: 'void', details: { reason }, io });
    io?.emit('task_status_changed', { orderId: parseInt(orderId, 10), newStatus: 'voided' });
    res.json({ message: `訂單 ${result.rows[0].voucher_number} 已成功作廢` });
});

// PATCH /api/orders/:orderId/urgent
router.patch('/orders/:orderId/urgent', authorizeAdmin, async (req, res) => {
    const { orderId } = req.params;
    const { isUrgent } = req.body;
    const io = req.app.get('io');

    if (typeof isUrgent !== 'boolean') {
        return res.status(400).json({ message: 'isUrgent 必須是布林值' });
    }

    try {
        const result = await pool.query(
            'UPDATE orders SET is_urgent = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, voucher_number, is_urgent',
            [isUrgent, orderId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ message: '找不到該訂單' });
        }

        await logOperation({
            userId: req.user.id,
            orderId,
            operationType: 'set_urgent',
            details: { is_urgent: isUrgent },
            io
        });

        io?.emit('task_urgent_changed', {
            orderId: parseInt(orderId, 10),
            isUrgent,
            voucherNumber: result.rows[0].voucher_number
        });

        logger.info(`[/api/orders/${orderId}/urgent] 訂單 ${result.rows[0].voucher_number} 緊急狀態已更新為: ${isUrgent}`);
        res.json({
            message: `訂單 ${result.rows[0].voucher_number} 已${isUrgent ? '標記為緊急' : '取消緊急標記'}`,
            order: result.rows[0]
        });
    } catch (error) {
        logger.error(`[/api/orders/${orderId}/urgent] 更新失敗:`, error);
        res.status(500).json({ message: '更新緊急狀態失敗' });
    }
});

// DELETE /api/orders/:orderId
router.delete('/orders/:orderId', authorizeAdmin, async (req, res) => {
    const { orderId } = req.params;
    const io = req.app.get('io');
    const result = await pool.query('DELETE FROM orders WHERE id = $1 RETURNING voucher_number', [orderId]);
    if (result.rowCount === 0) return res.status(404).json({ message: '找不到要刪除的訂單' });
    io?.emit('task_deleted', { orderId: parseInt(orderId, 10) });
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
        const customerCellRaw = data[2]?.[0] ? String(data[2][0]) : '';
        let customerName = null;
        const customerParts = customerCellRaw.split(/[:：]/);
        if (customerParts.length > 1) customerName = customerParts[1].trim();
        const existingOrder = await client.query('SELECT id FROM orders WHERE voucher_number = $1', [voucherNumber]);
        if (existingOrder.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ message: `訂單 ${voucherNumber} 已存在` });
        }
        const orderResult = await client.query('INSERT INTO orders (voucher_number, customer_name, status) VALUES ($1, $2, $3) RETURNING id', [voucherNumber, customerName, 'pending']);
        const orderId = orderResult.rows[0].id;
        let itemsStartRow = -1, headerRow = [];
        for (let i = 0; i < data.length; i++) {
            // 擴充標頭識別：支援 "品項編碼"、"國際條碼"、"條碼"
            if (data[i]?.some(cell => {
                const h = String(cell);
                return h.includes('品項編碼') || h.includes('國際條碼') || h.includes('條碼');
            })) {
                itemsStartRow = i + 1;
                headerRow = data[i];
                break;
            }
        }
        if (itemsStartRow === -1) { await client.query('ROLLBACK'); return res.status(400).json({ message: "Excel 檔案格式錯誤：找不到品項標頭 (需包含 '品項編碼' 或 '國際條碼')" }); }
        
        // 寬鬆匹配欄位名稱
        const barcodeIndex = headerRow.findIndex(h => {
            const header = String(h);
            return header.includes('品項編碼') || header.includes('國際條碼') || header.includes('條碼');
        });
        const nameAndSkuIndex = headerRow.findIndex(h => String(h).includes('品項名稱'));
        const quantityIndex = headerRow.findIndex(h => String(h).includes('數量'));
        // 新增：支援獨立的 "品項型號" 欄位
        const modelIndex = headerRow.findIndex(h => {
            const header = String(h);
            return header.includes('品項型號') || header.includes('型號') || header.includes('Product Code');
        });
        // 擴充 SN 欄位識別：支援 "摘要"、"SN列表"、"SN"、"序號"
        const summaryIndex = headerRow.findIndex(h => {
            const header = String(h).toUpperCase();
            return header.includes('摘要') || header.includes('SN') || header.includes('序號');
        });

        if (barcodeIndex === -1 || nameAndSkuIndex === -1 || quantityIndex === -1) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: "Excel 檔案格式錯誤：缺少 '品項編碼/國際條碼'、'品項名稱' 或 '數量' 欄位" });
        }
        for (let i = itemsStartRow; i < data.length; i++) {
            const row = data[i];
            if (!row?.[barcodeIndex] || !row?.[nameAndSkuIndex] || !row?.[quantityIndex]) continue;
            
            // 關鍵修正：加入 .trim() 去除條碼前後空白，避免掃描失敗
            const barcode = String(row[barcodeIndex]).trim();
            const fullNameAndSku = String(row[nameAndSkuIndex]).trim();
            const quantity = parseInt(row[quantityIndex], 10);
            const summaryRaw = summaryIndex > -1 && row[summaryIndex] ? String(row[summaryIndex]) : '';
            
            // 優先從 "品項型號" 欄位獲取，若無則嘗試從 "品項名稱" 解析 [CODE]
            let productCode = null;
            let productName = fullNameAndSku;

            if (modelIndex > -1 && row[modelIndex]) {
                productCode = String(row[modelIndex]).trim();
            } else {
                const skuMatch = fullNameAndSku.match(/\[(.*?)\]/);
                if (skuMatch) {
                    productCode = skuMatch[1];
                    productName = fullNameAndSku.substring(0, skuMatch.index).trim();
                }
            }

            // 如果還是沒有 productCode，但有 barcode 和 name，則使用 barcode 或 name 當作 code (避免漏單)
            if (!productCode) {
                productCode = barcode; // Fallback
            }

            if (barcode && productCode && productName && !isNaN(quantity) && quantity > 0) {
                const itemInsertResult = await client.query('INSERT INTO order_items (order_id, product_code, product_name, quantity, barcode) VALUES ($1, $2, $3, $4, $5) RETURNING id', [orderId, productCode, productName, quantity, barcode]);
                const orderItemId = itemInsertResult.rows[0].id;
                
                if (summaryRaw) {
                    const serialNumbers = [];
                    // 1. 嘗試以常見分隔符分割 (/, space, newline, comma, etc)
                    // 支援格式如: "Code/SN", "SN1, SN2", "SN1 SN2"
                    const potentialSNs = summaryRaw.split(/[\/\s,，、\n\r]+/);
                    
                    for (const part of potentialSNs) {
                        const cleanPart = part.trim();
                        // 假設 SN 為 12 碼英數字 (根據用戶範例 T03K52027400)
                        if (cleanPart.length === 12 && /^[A-Za-z0-9]+$/.test(cleanPart)) {
                            serialNumbers.push(cleanPart);
                        }
                    }

                    // 2. Fallback: 如果找不到分隔符，且字串長度是 12 的倍數，嘗試切分 (舊格式相容: 連續SN無分隔符)
                    if (serialNumbers.length === 0) {
                         const cleanSummary = summaryRaw.replace(/[ㆍ\s\/]/g, '');
                         if (cleanSummary.length > 0 && cleanSummary.length % 12 === 0) {
                             for (let j = 0; j < cleanSummary.length; j += 12) {
                                 serialNumbers.push(cleanSummary.substring(j, j + 12));
                             }
                         }
                    }
                    
                    // 去除重複並寫入
                    const uniqueSNs = [...new Set(serialNumbers)];
                    for (const sn of uniqueSNs) {
                        await client.query('INSERT INTO order_item_instances (order_item_id, serial_number) VALUES ($1, $2)', [orderItemId, sn]);
                    }
                }
            }
        }
        await client.query('COMMIT');
        await logOperation({ userId: req.user.id, orderId, operationType: 'import', details: { voucherNumber }, io });
        io?.emit('new_task', { id: orderId, voucher_number: voucherNumber, customer_name: customerName, status: 'pending', task_type: 'pick' });
        res.status(201).json({ message: `訂單 ${voucherNumber} 匯入成功`, orderId });
    } catch (err) {
        await client.query('ROLLBACK');
        next(err);
    } finally {
        client.release();
    }
});

// POST /api/orders/update_item
router.post('/orders/update_item', async (req, res, next) => {
    const { orderId, scanValue, type, amount = 1 } = req.body;
    const { id: userId, role } = req.user;
    const io = req.app.get('io');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const orderResult = await client.query('SELECT * FROM orders WHERE id = $1', [orderId]);
        if (orderResult.rows.length === 0) throw new Error(`找不到 ID 為 ${orderId} 的訂單`);
        const order = orderResult.rows[0];

        // Auto-transition from picked to packing if type is pack
        if (type === 'pack' && order.status === 'picked') {
             await client.query("UPDATE orders SET status = 'packing', packer_id = COALESCE(packer_id, $1), updated_at = CURRENT_TIMESTAMP WHERE id = $2", [userId, orderId]);
             order.status = 'packing';
             if (!order.packer_id) order.packer_id = userId;
             io?.emit('task_status_changed', { orderId: parseInt(orderId, 10), newStatus: 'packing' });
        }

        if ((type === 'pick' && order.picker_id !== userId && role !== 'admin') || (type === 'pack' && order.packer_id !== userId && role !== 'admin')) {
            throw new Error('您不是此任務的指定操作員');
        }
        const instanceResult = await client.query(`SELECT i.id, i.status FROM order_item_instances i JOIN order_items oi ON i.order_item_id = oi.id WHERE oi.order_id = $1 AND i.serial_number = $2 FOR UPDATE`, [orderId, scanValue]);
        if (instanceResult.rows.length > 0) {
            const instance = instanceResult.rows[0]; let newStatus = '';
            if (type === 'pick' && instance.status === 'pending') newStatus = 'picked'; 
            else if (type === 'pack' && instance.status === 'picked') newStatus = 'packed'; 
            else throw new Error(`SN 碼 ${scanValue} 的狀態 (${instance.status}) 無法執行此操作`);
            await client.query('UPDATE order_item_instances SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newStatus, instance.id]);
            await logOperation({ userId, orderId, operationType: type, details: { serialNumber: scanValue, statusChange: `${instance.status} -> ${newStatus}` }, io });
        } else {
            const itemResult = await client.query(`SELECT oi.id, oi.quantity, oi.picked_quantity, oi.packed_quantity FROM order_items oi LEFT JOIN order_item_instances i ON oi.id = i.order_item_id WHERE oi.order_id = $1 AND oi.barcode = $2 AND i.id IS NULL`, [orderId, scanValue]);
            if (itemResult.rows.length === 0) {
                await logOperation({ userId, orderId, operationType: 'scan_error', details: { scanValue, type, reason: '條碼不屬於此訂單或該品項需要掃描 SN 碼' }, io });
                throw new Error(`條碼 ${scanValue} 不屬於此訂單，或該品項需要掃描 SN 碼`);
            }
            const item = itemResult.rows[0];
            if (type === 'pick') { 
                const newPickedQty = item.picked_quantity + amount; 
                if (newPickedQty < 0 || newPickedQty > item.quantity) throw new Error('揀貨數量無效'); 
                await client.query('UPDATE order_items SET picked_quantity = $1 WHERE id = $2', [newPickedQty, item.id]); 
            } else if (type === 'pack') { 
                const newPackedQty = item.packed_quantity + amount; 
                if (newPackedQty < 0 || newPackedQty > item.picked_quantity) throw new Error('裝箱數量不能超過已揀貨數量'); 
                await client.query('UPDATE order_items SET packed_quantity = $1 WHERE id = $2', [newPackedQty, item.id]); 
            }
            await logOperation({ userId, orderId, operationType: type, details: { barcode: scanValue, amount }, io });
        }
        // 在同一個 transaction 內判斷是否已 100% 完成，並原子性更新訂單狀態
        const allItems = await client.query('SELECT * FROM order_items WHERE order_id = $1', [orderId]);
        const allInstances = await client.query(
            'SELECT i.* FROM order_item_instances i JOIN order_items oi ON i.order_item_id = oi.id WHERE oi.order_id = $1',
            [orderId]
        );

        let allPicked = true;
        let allPacked = true;
        for (const item of allItems.rows) {
            const itemInstances = allInstances.rows.filter(inst => inst.order_item_id === item.id);
            if (itemInstances.length > 0) {
                if (!itemInstances.every(i => ['picked', 'packed'].includes(i.status))) allPicked = false;
                if (!itemInstances.every(i => i.status === 'packed')) allPacked = false;
            } else {
                    const qty = Number(item.quantity ?? 0);
                    const pickedQty = Number(item.picked_quantity ?? 0);
                    const packedQty = Number(item.packed_quantity ?? 0);

                    if (pickedQty < qty) allPicked = false;
                    // 裝箱以「已揀貨數」為基準（避免部分揀貨/異常資料導致永遠無法完成）
                    const requiredPackQty = Math.min(qty, pickedQty);
                    if (packedQty < requiredPackQty) allPacked = false;
            }
        }

        let statusChanged = false;
        let finalStatus = order.status;

        if (allPacked && order.status !== 'completed') {
            finalStatus = 'completed';
            statusChanged = true;
            await client.query(
                "UPDATE orders SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, packer_id = COALESCE(packer_id, $1) WHERE id = $2",
                [userId, orderId]
            );
        } else if (allPicked && (order.status === 'picking' || order.status === 'pending')) {
            finalStatus = 'picked';
            statusChanged = true;
            await client.query("UPDATE orders SET status = 'picked', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [orderId]);
        }

        await client.query('COMMIT');

        if (statusChanged) {
            io?.emit('task_status_changed', { orderId: parseInt(orderId, 10), newStatus: finalStatus });
        }

        const updatedOrderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
        const updatedItemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
        const updatedInstancesResult = await pool.query(
            'SELECT i.* FROM order_item_instances i JOIN order_items oi ON i.order_item_id = oi.id WHERE oi.order_id = $1',
            [orderId]
        );
        res.json({ order: updatedOrderResult.rows[0], items: updatedItemsResult.rows, instances: updatedInstancesResult.rows });
    } catch (err) {
        await client.query('ROLLBACK');
        err.message = `更新品项状态失败: ${err.message}`;
        next(err);
    } finally {
        client.release();
    }
});

// POST /api/orders/batch/delete
router.post('/orders/batch/delete', authorizeAdmin, async (req, res) => {
    const { orderIds } = req.body;
    const io = req.app.get('io');

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ message: '請提供訂單 ID 列表' });
    }

    try {
        const result = await pool.query(
            'DELETE FROM orders WHERE id = ANY($1) RETURNING id, voucher_number',
            [orderIds]
        );

        result.rows.forEach(order => {
            io?.emit('task_deleted', { orderId: order.id });
        });

        res.json({
            message: `成功刪除 ${result.rowCount} 筆訂單`,
            deletedOrders: result.rows
        });
    } catch (error) {
        logger.error('[/api/orders/batch/delete] 失敗:', error);
        res.status(500).json({ message: '批次刪除失敗' });
    }
});

// POST /api/orders/:orderId/defect
router.post('/orders/:orderId/defect', authorizeAdmin, async (req, res) => {
    const { orderId } = req.params;
    const { oldSn, newSn, reason } = req.body;
    const userId = req.user.id;
    const io = req.app.get('io');

    if (!oldSn || !newSn || !reason) {
        return res.status(400).json({ message: '請提供舊SN、新SN及更換原因' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Find the instance and verify it belongs to the order
        const instanceQuery = `
            SELECT i.id, i.order_item_id, oi.product_code, oi.product_name, oi.barcode
            FROM order_item_instances i
            JOIN order_items oi ON i.order_item_id = oi.id
            WHERE i.serial_number = $1 AND oi.order_id = $2
        `;
        const instanceResult = await client.query(instanceQuery, [oldSn, orderId]);

        if (instanceResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: '找不到該訂單中對應的舊SN' });
        }

        const instance = instanceResult.rows[0];

        // 2. Update the SN
        await client.query(
            'UPDATE order_item_instances SET serial_number = $1 WHERE id = $2',
            [newSn, instance.id]
        );

        // 3. Record the defect
        await client.query(
            `INSERT INTO product_defects 
            (order_id, user_id, original_sn, new_sn, product_barcode, product_name, reason)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [orderId, userId, oldSn, newSn, instance.barcode, instance.product_name, reason]
        );

        await client.query('COMMIT');

        // 4. Log operation
        await logOperation({
            userId,
            orderId,
            operationType: 'defect_exchange',
            details: { oldSn, newSn, reason, product: instance.product_name },
            io
        });

        res.json({ message: 'SN更換成功並已記錄新品不良' });

    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('[/api/orders/:orderId/defect] 失敗:', error);
        res.status(500).json({ message: '處理失敗: ' + error.message });
    } finally {
        client.release();
    }
});

// GET /api/admin/defects/stats
router.get('/admin/defects/stats', authorizeAdmin, async (req, res) => {
    try {
        const query = `
            SELECT 
                product_barcode,
                product_name,
                COUNT(*) as defect_count,
                json_agg(json_build_object(
                    'order_id', order_id,
                    'original_sn', original_sn,
                    'new_sn', new_sn,
                    'reason', reason,
                    'created_at', created_at,
                    'reporter', (SELECT name FROM users WHERE id = product_defects.user_id)
                )) as details
            FROM product_defects
            GROUP BY product_barcode, product_name
            ORDER BY defect_count DESC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (error) {
        logger.error('[/api/admin/defects/stats] 失敗:', error);
        res.status(500).json({ message: '獲取統計失敗' });
    }
});

module.exports = router;
