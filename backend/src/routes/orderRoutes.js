// backend/src/routes/orderRoutes.js
// 訂單操作相關端點（需先通過 authenticateToken）

const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const rateLimit = require('express-rate-limit');
const { pool } = require('../config/database');
const logger = require('../utils/logger');
const { authorizeAdmin, authorizeRoles } = require('../middleware/auth');
const { logOperation } = require('../services/operationLogService');

const router = express.Router();

async function hasOpenExceptions(db, orderId) {
    try {
        const result = await db.query(
            `SELECT EXISTS(
                SELECT 1
                FROM order_exceptions
                WHERE order_id = $1 AND status = 'open'
            ) AS has_open`,
            [orderId]
        );
        return !!result.rows[0]?.has_open;
    } catch (err) {
        // 若尚未套用 migration，避免擋住既有流程
        if (err && (err.code === '42P01' || /order_exceptions/i.test(err.message || ''))) {
            return false;
        }
        throw err;
    }
}

const allowedImportMimeTypes = new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/csv',
    'text/plain'
]);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1 },
    fileFilter: (req, file, cb) => {
        const filename = file?.originalname ? String(file.originalname) : '';
        const ext = filename.toLowerCase().split('.').pop();
        const allowedExt = ext === 'xlsx' || ext === 'xls' || ext === 'csv';
        const allowedMime = file?.mimetype ? allowedImportMimeTypes.has(String(file.mimetype).toLowerCase()) : false;

        if (allowedExt || allowedMime) {
            return cb(null, true);
        }

        const err = new Error('不支援的檔案格式，請上傳 .xlsx / .xls / .csv');
        // 交給 globalErrorHandler 統一處理
        return cb(err);
    }
});

const importLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => {
        // 匯入是已登入操作，優先按 userId 限流，避免同 IP 共享影響
        const userId = req.user?.id ? String(req.user.id) : '';
        return userId ? `user:${userId}` : `ip:${req.ip}`;
    },
    handler: (req, res) => {
        return res.status(429).json({ message: '匯入嘗試次數過多，請稍後再試' });
    }
});

// POST /api/orders/batch-claim
router.post('/orders/batch-claim', async (req, res) => {
    try {
        const { orderIds } = req.body;
        const userId = req.user.id;
        const role = req.user.role;
        const isAdminLike = role === 'admin' || role === 'superadmin';

        if (!(role === 'picker' || isAdminLike)) {
            return res.status(403).json({ message: '權限不足' });
        }

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
    const isAdminLike = role === 'admin' || role === 'superadmin';
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

                if (order.status === 'pending' && (role === 'picker' || isAdminLike)) {
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
                } else if (order.status === 'picking' && (role === 'packer' || isAdminLike)) {
                    // 若存在未核可例外，禁止進入裝箱流程
                    const hasOpen = await hasOpenExceptions(pool, orderId);
                    if (hasOpen) {
                        results.failed.push({ orderId, reason: '此訂單存在未核可例外，請先主管核可後再裝箱' });
                        continue;
                    }
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
    const isAdminLike = role === 'admin' || role === 'superadmin';
    const io = req.app.get('io');
    logger.debug(`[/orders/${orderId}/claim] 使用者嘗試認領任務 - userId: ${userId}, role: ${role}`);

    if (role === 'dispatcher') {
        return res.status(403).json({ message: '拋單員不可認領任務' });
    }

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
        if ((role === 'picker' || isAdminLike) && order.status === 'pending') {
            newStatus = 'picking'; task_type = 'pick';
            await client.query('UPDATE orders SET status = $1, picker_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [newStatus, userId, orderId]);
            logger.info(`[/orders/${orderId}/claim] 成功認領揀貨任務`);
        } else if ((role === 'packer' || isAdminLike) && order.status === 'picked') {
            const hasOpen = await hasOpenExceptions(client, orderId);
            if (hasOpen) {
                await client.query('ROLLBACK');
                return res.status(409).json({ message: '此訂單存在未核可例外，請先主管核可（ack）後再認領裝箱任務。' });
            }
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
            'SELECT o.*, p.name as picker_name, pk.name as packer_name FROM orders o LEFT JOIN users p ON o.picker_id = p.id LEFT JOIN users pk ON o.packer_id = pk.id WHERE o.id = $1 FOR UPDATE OF o;',
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

                // 若揀貨未達需求，不能被視為「裝箱完成」
                if (pickedQty < qty) {
                    allPicked = false;
                    allPacked = false;
                } else {
                    if (packedQty < qty) allPacked = false;
                }
            }
        }

        let statusChanged = false;
        let newStatus = order.status;

        // 完成必須同時滿足揀貨完成 + 裝箱完成
        if (allPicked && allPacked && order.status !== 'completed') {
            const hasOpen = await hasOpenExceptions(client, orderId);
            if (hasOpen) {
                // 有未核可例外時，不允許自動完成
                newStatus = order.status;
                statusChanged = false;
            } else {
            newStatus = 'completed';
            statusChanged = true;
            await client.query(
                "UPDATE orders SET status = 'completed', completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = $1",
                [orderId]
            );
            }
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
// admin/superadmin：可操作所有訂單
// dispatcher：僅可操作自己拋單(imported_by_user_id)的訂單
router.patch('/orders/:orderId/urgent', authorizeRoles('admin', 'dispatcher'), async (req, res) => {
    const { orderId } = req.params;
    const { isUrgent } = req.body;
    const io = req.app.get('io');

    if (typeof isUrgent !== 'boolean') {
        return res.status(400).json({ message: 'isUrgent 必須是布林值' });
    }

    try {
        if (req.user?.role === 'dispatcher') {
            const own = await pool.query(
                'SELECT 1 FROM orders WHERE id = $1 AND imported_by_user_id = $2',
                [orderId, req.user.id]
            );
            if (own.rowCount === 0) {
                return res.status(403).json({ message: '僅允許操作自己拋單的訂單' });
            }
        }

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
// admin/superadmin：可刪除所有訂單
// dispatcher：僅可刪除自己拋單的訂單
router.delete('/orders/:orderId', authorizeRoles('admin', 'dispatcher'), async (req, res) => {
    const { orderId } = req.params;
    const io = req.app.get('io');
    const result = req.user?.role === 'dispatcher'
        ? await pool.query('DELETE FROM orders WHERE id = $1 AND imported_by_user_id = $2 RETURNING voucher_number', [orderId, req.user.id])
        : await pool.query('DELETE FROM orders WHERE id = $1 RETURNING voucher_number', [orderId]);
    if (result.rowCount === 0) return res.status(404).json({ message: '找不到要刪除的訂單' });
    io?.emit('task_deleted', { orderId: parseInt(orderId, 10) });
    res.status(200).json({ message: `訂單 ${result.rows[0].voucher_number} 已被永久刪除` });
});

// POST /api/orders/import
router.post('/orders/import', authorizeRoles('admin', 'dispatcher'), importLimiter, upload.single('orderFile'), async (req, res, next) => {
    const io = req.app.get('io');
    if (!req.file) return res.status(400).json({ message: '沒有上傳檔案' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '' });

        function extractLabeledValue(table, keywords) {
            const maxRows = Math.min(Array.isArray(table) ? table.length : 0, 50);
            for (let r = 0; r < maxRows; r++) {
                const row = Array.isArray(table[r]) ? table[r] : [];
                const maxCols = Math.min(row.length, 50);
                for (let c = 0; c < maxCols; c++) {
                    const cell = row[c];
                    if (cell === null || cell === undefined) continue;
                    const cellText = String(cell).trim();
                    if (!cellText) continue;

                    const hit = keywords.some((k) => cellText.includes(k));
                    if (!hit) continue;

                    // 常見格式："憑證號碼：2025/12/17-3" 或 "訂單編號: xxx"
                    const parts = cellText.split(/[:：]/);
                    if (parts.length > 1) {
                        const v = parts.slice(1).join(':').trim();
                        if (v) return v;
                    }

                    // 另一種：標籤在 A 欄、值在 B 欄
                    const next = row[c + 1];
                    if (next !== null && next !== undefined) {
                        const v2 = String(next).trim();
                        if (v2) return v2;
                    }
                }
            }
            return null;
        }

        // 先用掃描的方式找欄位（避免模板行列變動導致抓錯）
        let voucherNumber = extractLabeledValue(data, ['憑證號碼', '憑證號', '訂單編號', '訂單號碼', '訂單號', '單號', 'Voucher']);
        let customerName = extractLabeledValue(data, ['客戶名稱', '客戶', '收貨人', 'Customer']);

        // 相容舊模板：若掃不到，再回退到舊的固定儲存格位置
        if (!voucherNumber) {
            const voucherCellRaw = data[1]?.[0] ? String(data[1][0]) : '';
            const voucherParts = voucherCellRaw.split(/[:：]/);
            if (voucherParts.length > 1) voucherNumber = voucherParts.slice(1).join(':').trim();
        }
        if (!customerName) {
            const customerCellRaw = data[2]?.[0] ? String(data[2][0]) : '';
            const customerParts = customerCellRaw.split(/[:：]/);
            if (customerParts.length > 1) customerName = customerParts.slice(1).join(':').trim();
        }

        voucherNumber = voucherNumber ? String(voucherNumber).trim() : '';
        customerName = customerName ? String(customerName).trim() : null;

        if (!voucherNumber) return res.status(400).json({ message: "Excel 格式錯誤：找不到訂單號碼（憑證號碼）。請確認檔案內有『憑證號碼：xxxx』或『訂單編號：xxxx』。" });

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
                    // 1. 嘗試以常見分隔符分割 (/, space, newline, comma, bullet, etc)
                    // 支援格式如: "SN:B19B...ㆍSN:B19B..."、"Code・Code"、"SN1, SN2", "SN1 SN2"
                    const potentialSNs = summaryRaw.split(/[\/\s,，、\n\rㆍ·・•]+/);
                    
                    for (const part of potentialSNs) {
                        const cleanPart = part.trim();
                        if (!cleanPart) continue;

                        // 允許舊格式前綴：SN: / SN：
                        const normalized = cleanPart.replace(/^SN\s*[:：]/i, '').trim();

                        // 假設 SN 為 12 碼英數字 (根據用戶範例 T03K52027400、B19B52004735)
                        if (normalized.length === 12 && /^[A-Za-z0-9]+$/.test(normalized)) {
                            serialNumbers.push(normalized);
                        }
                    }

                    // 2. Fallback: 如果找不到分隔符，且字串長度是 12 的倍數，嘗試切分 (舊格式相容: 連續SN無分隔符)
                    if (serialNumbers.length === 0) {
                        // 先移除可能存在的 SN: 前綴，避免把 "SN:" 也一起硬切造成 SN 亂掉
                        const noPrefix = summaryRaw.replace(/SN\s*[:：]/gi, '');
                        const cleanSummary = noPrefix.replace(/[\/\s,，、\n\rㆍ·・•]/g, '');
                        if (cleanSummary.length > 0 && cleanSummary.length % 12 === 0 && /^[A-Za-z0-9]+$/.test(cleanSummary)) {
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
    const { orderId, scanValue, type, amount = 1, orderItemId } = req.body;
    const { id: userId, role } = req.user;
    const isAdminLike = role === 'admin' || role === 'superadmin';
    const io = req.app.get('io');

    if (!(isAdminLike || role === 'picker' || role === 'packer')) {
        return res.status(403).json({ message: '權限不足' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const amountNum = Number(amount ?? 1);
        if (!Number.isFinite(amountNum) || amountNum === 0) {
            throw new Error('數量 amount 無效');
        }
        const orderResult = await client.query('SELECT * FROM orders WHERE id = $1', [orderId]);
        if (orderResult.rows.length === 0) throw new Error(`找不到 ID 為 ${orderId} 的訂單`);
        const order = orderResult.rows[0];

        // 例外流程控管：有 open（未核可）例外時，禁止 pack 相關操作與自動完成
        if (type === 'pack') {
            const hasOpen = await hasOpenExceptions(client, orderId);
            if (hasOpen) {
                await client.query('ROLLBACK');
                return res.status(409).json({ message: '此訂單存在未核可例外，請先主管核可（ack）後再進行裝箱作業。' });
            }
        }

        // Auto-transition from picked to packing if type is pack
        if (type === 'pack' && order.status === 'picked') {
             await client.query("UPDATE orders SET status = 'packing', packer_id = COALESCE(packer_id, $1), updated_at = CURRENT_TIMESTAMP WHERE id = $2", [userId, orderId]);
             order.status = 'packing';
             if (!order.packer_id) order.packer_id = userId;
             io?.emit('task_status_changed', { orderId: parseInt(orderId, 10), newStatus: 'packing' });
        }

        if ((type === 'pick' && order.picker_id !== userId && !isAdminLike) || (type === 'pack' && order.packer_id !== userId && !isAdminLike)) {
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
            // 非 SN 條碼：
            // - 若帶 orderItemId：精準更新指定那一行品項（避免同條碼多行時按鈕誤更新）
            // - 否則：掃碼情境下，自動挑選「仍可更新」的一行

            let itemResult;
            if (orderItemId) {
                itemResult = await client.query(
                    `
                    SELECT
                        oi.id,
                        oi.quantity,
                        COALESCE(oi.picked_quantity, 0) as picked_quantity,
                        COALESCE(oi.packed_quantity, 0) as packed_quantity
                    FROM order_items oi
                    WHERE oi.order_id = $1
                      AND oi.id = $2
                      AND oi.barcode = $3
                      AND NOT EXISTS (
                          SELECT 1 FROM order_item_instances i WHERE i.order_item_id = oi.id
                      )
                    LIMIT 1
                    FOR UPDATE
                    `,
                    [orderId, orderItemId, scanValue]
                );
            } else {
                // 同一張訂單內可能有多行相同條碼，必須挑選「仍可更新」的那一行
                // pick: picked_quantity + amount 需落在 [0, quantity]
                // pack: packed_quantity + amount 需落在 [0, picked_quantity]
                itemResult = await client.query(
                    `
                    SELECT
                        oi.id,
                        oi.quantity,
                        COALESCE(oi.picked_quantity, 0) as picked_quantity,
                        COALESCE(oi.packed_quantity, 0) as packed_quantity
                    FROM order_items oi
                    WHERE oi.order_id = $1
                      AND oi.barcode = $2
                      AND NOT EXISTS (
                          SELECT 1 FROM order_item_instances i WHERE i.order_item_id = oi.id
                      )
                      AND (
                          (
                            $4 = 'pick'
                            AND (COALESCE(oi.picked_quantity, 0) + $3) BETWEEN 0 AND COALESCE(oi.quantity, 0)
                          )
                          OR (
                            $4 = 'pack'
                            AND (COALESCE(oi.packed_quantity, 0) + $3) BETWEEN 0 AND COALESCE(oi.picked_quantity, 0)
                          )
                      )
                    ORDER BY oi.id ASC
                    LIMIT 1
                    FOR UPDATE
                    `,
                    [orderId, scanValue, amountNum, type]
                );
            }
            if (itemResult.rows.length === 0) {
                await logOperation({ userId, orderId, operationType: 'scan_error', details: { scanValue, type, reason: '條碼不屬於此訂單或該品項需要掃描 SN 碼' }, io });
                throw new Error(`條碼 ${scanValue} 不可用：可能不屬於此訂單、需要掃 SN，或該條碼所有品項都已無可更新的剩餘數量`);
            }
            const item = itemResult.rows[0];
            if (type === 'pick') { 
                const newPickedQty = item.picked_quantity + amountNum; 
                if (newPickedQty < 0 || newPickedQty > item.quantity) throw new Error('揀貨數量無效'); 
                await client.query('UPDATE order_items SET picked_quantity = $1 WHERE id = $2', [newPickedQty, item.id]); 
            } else if (type === 'pack') { 
                const newPackedQty = item.packed_quantity + amountNum; 
                if (newPackedQty < 0 || newPackedQty > item.picked_quantity) throw new Error('裝箱數量不能超過已揀貨數量'); 
                await client.query('UPDATE order_items SET packed_quantity = $1 WHERE id = $2', [newPackedQty, item.id]); 
            }
            await logOperation({ userId, orderId, operationType: type, details: { barcode: scanValue, amount: amountNum, orderItemId: item.id }, io });
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

                    // 若揀貨未達需求，不能被視為「裝箱完成」
                    if (pickedQty < qty) {
                        allPicked = false;
                        allPacked = false;
                    } else {
                        if (packedQty < qty) allPacked = false;
                    }
            }
        }

        let statusChanged = false;
        let finalStatus = order.status;

        // 完成必須同時滿足揀貨完成 + 裝箱完成
        if (allPicked && allPacked && order.status !== 'completed') {
            const hasOpen = await hasOpenExceptions(client, orderId);
            if (!hasOpen) {
                finalStatus = 'completed';
                statusChanged = true;
                await client.query(
                    "UPDATE orders SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, packer_id = COALESCE(packer_id, $1) WHERE id = $2",
                    [userId, orderId]
                );
            }
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
// admin/superadmin：可操作所有訂單
// dispatcher：僅可操作自己拋單的訂單
router.post('/orders/:orderId/defect', authorizeRoles('admin', 'dispatcher'), async (req, res) => {
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

        if (req.user?.role === 'dispatcher') {
            const own = await client.query(
                'SELECT 1 FROM orders WHERE id = $1 AND imported_by_user_id = $2',
                [orderId, userId]
            );
            if (own.rowCount === 0) {
                await client.query('ROLLBACK');
                return res.status(403).json({ message: '僅允許操作自己拋單的訂單' });
            }
        }

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

        // 3.1 同步建立例外事件（SN更換）— 管理員操作視同已核可並結案，但仍保留審計紀錄
        try {
            const tableCheck = await client.query(
                `SELECT EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'order_exceptions'
                ) as exists`
            );

            if (tableCheck.rows[0]?.exists) {
                await client.query(
                    `INSERT INTO order_exceptions (
                        order_id, type, status,
                        reason_code, reason_text,
                        created_by,
                        ack_by, ack_at,
                        resolved_by, resolved_at,
                        snapshot
                    ) VALUES (
                        $1, 'sn_replace', 'resolved',
                        $2, $3,
                        $4,
                        $4, NOW(),
                        $4, NOW(),
                        $5::jsonb
                    )`,
                    [
                        orderId,
                        'DEFECT_EXCHANGE',
                        reason,
                        userId,
                        JSON.stringify({
                            oldSn,
                            newSn,
                            product: {
                                barcode: instance.barcode,
                                name: instance.product_name,
                                orderItemId: instance.order_item_id
                            }
                        })
                    ]
                );
            }
        } catch (e) {
            // 不影響既有 SN 更換主流程
            logger.warn('[/api/orders/:orderId/defect] 建立例外事件失敗（可忽略）:', e.message);
        }

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
