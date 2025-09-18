// =================================================================
// MOZTECH WMS 後端主程式 (index.js)
// =================================================================

// 引入必要套件
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Papa = require('papaparse');

// 載入環境變數
require('dotenv').config();

// --- 應用程式與伺服器初始化 ---
const app = express();
const port = process.env.PORT || 3001;
const server = http.createServer(app);

// --- 中介軟體設定 ---
app.use(cors()); // 啟用 CORS
app.use(express.json()); // 解析 JSON request body

// --- 資料庫連線池設定 ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // 適用於 Render, Heroku 等雲端平台的連線設定
  }
});

// --- Socket.IO 即時通訊伺服器設定 ---
const io = new Server(server, {
    cors: {
        origin: "*", // 允許所有來源連線
        methods: ["GET", "POST"]
    },
    path: "/socket.io/"
});

// =================================================================
// 中介軟體 (Middlewares)
// =================================================================

/**
 * 驗證 JWT 權杖 (Token)
 * 確保請求來自已登入的使用者
 */
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.status(401).json({ message: '未提供認證權杖' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: '無效或過期的權杖' });
        req.user = user;
        next();
    });
};

/**
 * 驗證管理員權限
 * 確保只有 admin 角色的使用者可以存取特定 API
 */
const authorizeAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: '權限不足，此操作需要管理員權限' });
    }
    next();
};

// =================================================================
// 輔助函式 (Helper Functions)
// =================================================================

/**
 * 記錄操作日誌到資料庫
 * @param {number} userId - 執行操作的使用者 ID
 * @param {number} orderId - 相關的訂單 ID
 * @param {string} operationType - 操作類型 (e.g., 'import', 'claim', 'pick')
 * @param {object} details - 操作的詳細資訊 (JSON)
 */
const logOperation = async (userId, orderId, operationType, details) => {
    try {
        await pool.query(
            'INSERT INTO operation_logs (user_id, order_id, operation_type, details) VALUES ($1, $2, $3, $4)', 
            [userId, orderId, operationType, JSON.stringify(details)]
        );
    } catch (error) {
        console.error('記錄操作日誌失敗:', error);
    }
};

// 設定 Multer 將上傳的檔案暫存在記憶體中
const upload = multer({ storage: multer.memoryStorage() });


// =================================================================
// API 路由 (API Routes)
// =================================================================

app.get('/', (req, res) => res.send('Moztech WMS API 正在運行！'));

// --- 認證相關 API ---
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: '請提供使用者名稱和密碼' });
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];
        if (!user) return res.status(400).json({ message: '無效的使用者名稱或密碼' });
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).json({ message: '無效的使用者名稱或密碼' });
        const accessToken = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role }, process.env.JWT_SECRET, { expiresIn: '8h' });
        res.json({ accessToken, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
    } catch (err) {
        console.error('登入失敗:', err);
        res.status(500).json({ message: '伺服器內部錯誤' });
    }
});

// --- 使用者管理 API (僅限管理員) ---
app.post('/api/admin/create-user', authenticateToken, authorizeAdmin, async (req, res) => {
    const { username, password, name, role } = req.body;
    if (!username || !password || !name || !role) return res.status(400).json({ message: '缺少必要欄位' });
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (username, password, name, role) VALUES ($1, $2, $3, $4)', [username, hashedPassword, name, role]);
        res.status(201).json({ message: `使用者 ${username} (${role}) 已成功建立` });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ message: '使用者名稱已存在' });
        console.error('建立使用者失敗:', err);
        res.status(500).json({ message: '伺服器內部錯誤' });
    }
});

app.get('/api/admin/users', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, name, role, created_at FROM users ORDER BY id ASC');
        res.json(result.rows);
    } catch (error) {
        console.error('獲取使用者列表失敗:', error);
        res.status(500).json({ message: '伺服器內部錯誤' });
    }
});

app.put('/api/admin/users/:userId', authenticateToken, authorizeAdmin, async (req, res) => {
    const { userId } = req.params;
    const { name, role, password } = req.body;
    if (!name && !role && !password) return res.status(400).json({ message: '請提供至少一項要更新的資訊' });
    if (Number(userId) === req.user.id && role && role !== 'admin') return res.status(400).json({ message: '無法修改自己的管理員權限' });
    try {
        let query = 'UPDATE users SET ';
        const values = [];
        let valueCount = 1;
        if (name) { query += `name = $${valueCount++}, `; values.push(name); }
        if (role) { query += `role = $${valueCount++}, `; values.push(role); }
        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            query += `password = $${valueCount++}, `;
            values.push(hashedPassword);
        }
        query = query.slice(0, -2);
        query += ` WHERE id = $${valueCount}`;
        values.push(userId);
        const result = await pool.query(query, values);
        if (result.rowCount === 0) return res.status(404).json({ message: '找不到該使用者' });
        res.json({ message: '使用者資訊已成功更新' });
    } catch (error) {
        console.error(`更新使用者 ${userId} 失敗:`, error);
        res.status(500).json({ message: '伺服器內部錯誤' });
    }
});

app.delete('/api/admin/users/:userId', authenticateToken, authorizeAdmin, async (req, res) => {
    const { userId } = req.params;
    if (Number(userId) === req.user.id) return res.status(400).json({ message: '無法刪除自己的帳號' });
    try {
        const result = await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        if (result.rowCount === 0) return res.status(404).json({ message: '找不到要刪除的使用者' });
        res.status(200).json({ message: '使用者已成功刪除' });
    } catch (error) {
        console.error(`刪除使用者 ${userId} 失敗:`, error);
        res.status(500).json({ message: '伺服器內部錯誤' });
    }
});


// --- 核心工作流 API ---

/**
 * 【智慧化升級】匯入訂單 API (最終強化版)
 */
app.post('/api/orders/import', authenticateToken, upload.single('orderFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: '沒有上傳檔案' });
    }

    const client = await pool.connect();
    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

        // --- 1. 使用正規表示式，強健地解析訂單基本資訊 ---
        const voucherCell = data[1] && data[1][0] ? String(data[1][0]) : '';
        const voucherMatch = voucherCell.match(/憑證號碼\s*[:：]\s*(.*)/);
        const voucherNumber = voucherMatch ? voucherMatch[1].trim() : null;
        
        const customerCell = data[2] && data[2][0] ? String(data[2][0]) : '';
        const customerMatch = customerCell.match(/收件-客戶\/供應商\s*[:：]\s*(.*)/);
        const customerName = customerMatch ? customerMatch[1].trim() : null;

        if (!voucherNumber) {
            return res.status(400).json({ message: "Excel 檔案格式錯誤：找不到憑證號碼 (請檢查 A2 儲存格是否為 '憑證號碼 : ...' 或 '憑證號碼：...')" });
        }

        // --- 2. 智慧尋找品項資料的起始位置與關鍵欄位索引 ---
        let itemsStartRow = -1;
        let headerRow = [];
        for (let i = 0; i < data.length; i++) {
            if (data[i] && Array.isArray(data[i]) && data[i].some(cell => typeof cell === 'string' && cell.includes('品項名稱'))) {
                itemsStartRow = i + 1;
                headerRow = data[i];
                break;
            }
        }

        if (itemsStartRow === -1) {
            return res.status(400).json({ message: "Excel 檔案格式錯誤：找不到包含 '品項名稱' 的標頭行" });
        }

        const nameAndSkuIndex = headerRow.findIndex(h => String(h).includes('品項名稱'));
        const quantityIndex = headerRow.findIndex(h => String(h).includes('數量'));

        if (nameAndSkuIndex === -1 || quantityIndex === -1) {
            return res.status(400).json({ message: "Excel 檔案格式錯誤：在標頭行中找不到 '品項名稱' 或 '數量' 欄位" });
        }

        // --- 3. 開始資料庫交易，確保資料一致性 ---
        await client.query('BEGIN');

        const existingOrder = await client.query('SELECT id FROM orders WHERE voucher_number = $1', [voucherNumber]);
        if (existingOrder.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ message: `訂單 ${voucherNumber} 已存在，請勿重複匯入` });
        }

        const orderInsertResult = await client.query('INSERT INTO orders (voucher_number, customer_name, status) VALUES ($1, $2, $3) RETURNING id', [voucherNumber, customerName, 'pending']);
        const orderId = orderInsertResult.rows[0].id;

        let itemsAddedCount = 0;
        // --- 4. 遍歷品項資料並插入資料庫 ---
        for (let i = itemsStartRow; i < data.length; i++) {
            const row = data[i];
            
            if (!row || !row[nameAndSkuIndex] || !row[quantityIndex]) continue;

            const fullNameAndSku = String(row[nameAndSkuIndex]);
            const quantity = parseInt(row[quantityIndex], 10);

            const skuMatch = fullNameAndSku.match(/\[(.*?)\]/);
            const productCode = skuMatch ? skuMatch[1] : null;

            const productName = skuMatch ? fullNameAndSku.substring(0, skuMatch.index).trim() : fullNameAndSku.trim();

            if (productCode && productName && !isNaN(quantity) && quantity > 0) {
                await client.query(
                    'INSERT INTO order_items (order_id, product_code, product_name, quantity) VALUES ($1, $2, $3, $4)',
                    [orderId, productCode, productName, quantity]
                );
                itemsAddedCount++;
            }
        }

        if (itemsAddedCount === 0) {
             await client.query('ROLLBACK');
             return res.status(400).json({ message: 'Excel 檔案中未找到任何有效的品項資料，請檢查品項格式是否正確' });
        }
        
        // --- 5. 提交交易並通知前端 ---
        await client.query('COMMIT');

        await logOperation(req.user.id, orderId, 'import', { voucherNumber });
        const newTask = { id: orderId, voucher_number: voucherNumber, customer_name: customerName, status: 'pending', task_type: 'pick' };
        io.emit('new_task', newTask);

        res.status(201).json({ message: `訂單 ${voucherNumber} 匯入成功，共新增 ${itemsAddedCount} 個品項`, orderId: orderId });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('匯入訂單時發生嚴重錯誤:', err);
        res.status(500).json({ message: '處理 Excel 檔案時發生伺服器內部錯誤，請檢查檔案格式或聯絡管理員' });
    } finally {
        client.release(); // 無論成功或失敗，都釋放資料庫連線
    }
});


app.get('/api/tasks', authenticateToken, async (req, res) => {
    const { role, id: userId } = req.user;
    try {
        let tasks = [];
        if (role === 'picker' || role === 'admin') {
            const pickerTasksResult = await pool.query(`SELECT o.id, o.voucher_number, o.customer_name, o.status, u.name as current_user FROM orders o LEFT JOIN users u ON o.picker_id = u.id WHERE o.status = 'pending' OR (o.status = 'picking' AND o.picker_id = $1) ORDER BY o.created_at ASC`, [userId]);
            tasks.push(...pickerTasksResult.rows.map(t => ({ ...t, task_type: 'pick' })));
        }
        if (role === 'packer' || role === 'admin') {
            const packerTasksResult = await pool.query(`SELECT o.id, o.voucher_number, o.customer_name, o.status, p.name as picker_name, u.name as current_user FROM orders o LEFT JOIN users p ON o.picker_id = p.id LEFT JOIN users u ON o.packer_id = u.id WHERE o.status = 'picked' OR (o.status = 'packing' AND o.packer_id = $1) ORDER BY o.updated_at ASC`, [userId]);
            tasks.push(...packerTasksResult.rows.map(t => ({ ...t, task_type: 'pack' })));
        }
        res.json(tasks);
    } catch (error) {
        console.error(`獲取角色 ${role} 的任務列表失敗:`, error);
        res.status(500).json({ message: '獲取任務列表時發生錯誤' });
    }
});

app.post('/api/orders/:orderId/claim', authenticateToken, async (req, res) => {
    const { orderId } = req.params;
    const { id: userId, role, name: userName } = req.user;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const orderResult = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
        const order = orderResult.rows[0];
        if (!order) { await client.query('ROLLBACK'); return res.status(404).json({ message: '找不到該訂單' }); }
        let newStatus = '';
        if ((role === 'picker' || role === 'admin') && order.status === 'pending') {
            newStatus = 'picking';
            await client.query('UPDATE orders SET status = $1, picker_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [newStatus, userId, orderId]);
        } else if ((role === 'packer' || role === 'admin') && order.status === 'picked') {
            newStatus = 'packing';
            await client.query('UPDATE orders SET status = $1, packer_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [newStatus, userId, orderId]);
        } else { await client.query('ROLLBACK'); return res.status(400).json({ message: `無法認領該任務，訂單狀態為「${order.status}」，可能已被他人處理。` }); }
        await client.query('COMMIT');
        await logOperation(userId, orderId, 'claim', { claimed_by: userName, new_status: newStatus });
        const updatedOrderResult = await pool.query('SELECT o.*, u.name as picker_name FROM orders o LEFT JOIN users u ON o.picker_id = u.id WHERE o.id = $1', [orderId]);
        const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
        
        io.emit('task_claimed', { ...updatedOrderResult.rows[0] });

        res.json({ order: updatedOrderResult.rows[0], items: itemsResult.rows });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('認領任務失敗:', error);
        res.status(500).json({ message: '認領任務時發生伺服器錯誤' });
    } finally {
        client.release();
    }
});


app.get('/api/orders/:orderId', authenticateToken, async (req, res) => {
    try {
        const { orderId } = req.params;
        const orderResult = await pool.query('SELECT o.*, p.name as picker_name, pk.name as packer_name FROM orders o LEFT JOIN users p ON o.picker_id = p.id LEFT JOIN users pk ON o.packer_id = pk.id WHERE o.id = $1;', [orderId]);
        const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
        if (orderResult.rows.length === 0) return res.status(404).json({ message: '找不到訂單' });
        res.json({ order: orderResult.rows[0], items: itemsResult.rows });
    } catch (err) {
        console.error('獲取訂單詳情失敗:', err);
        res.status(500).json({ message: '伺服器內部錯誤' });
    }
});

app.post('/api/orders/update_item', authenticateToken, async (req, res) => {
    const { orderId, sku, type, amount } = req.body;
    const { id: userId, name: userName } = req.user;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const itemResult = await client.query('SELECT * FROM order_items WHERE order_id = $1 AND product_code = $2 FOR UPDATE', [orderId, sku]);
        if (itemResult.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ message: '在訂單中找不到此產品' }); }
        const item = itemResult.rows[0];
        const order = (await client.query('SELECT * FROM orders WHERE id = $1', [orderId])).rows[0];
        if (type === 'pick' && order.status === 'picking' && order.picker_id !== userId ) { await client.query('ROLLBACK'); return res.status(403).json({ message: '您不是此訂單的指定揀貨員' }); }
        if (type === 'pack' && order.status === 'packing' && order.packer_id !== userId) { await client.query('ROLLBACK'); return res.status(403).json({ message: '您不是此訂單的指定裝箱員' }); }
        let newPickedQty = item.picked_quantity;
        let newPackedQty = item.packed_quantity;
        if (type === 'pick') {
            newPickedQty += amount;
            if (newPickedQty < 0 || newPickedQty > item.quantity) { await client.query('ROLLBACK'); return res.status(400).json({ message: '揀貨數量無效' }); }
            await client.query('UPDATE order_items SET picked_quantity = $1 WHERE id = $2', [newPickedQty, item.id]);
        } else if (type === 'pack') {
            newPackedQty += amount;
            if (newPackedQty < 0 || newPackedQty > item.picked_quantity) { await client.query('ROLLBACK'); return res.status(400).json({ message: '裝箱數量不能超過已揀貨數量' }); }
            await client.query('UPDATE order_items SET packed_quantity = $1 WHERE id = $2', [newPackedQty, item.id]);
        }
        await client.query('UPDATE orders SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [orderId]);
        const allItems = (await client.query('SELECT quantity, picked_quantity, packed_quantity FROM order_items WHERE order_id = $1', [orderId])).rows;
        const currentOrderStatus = order.status;
        const allPicked = allItems.every(i => i.picked_quantity >= i.quantity);
        const allPacked = allItems.every(i => i.packed_quantity >= i.quantity);
        let statusChanged = false;
        let finalStatus = currentOrderStatus;
        if (allPacked && currentOrderStatus !== 'completed') {
            finalStatus = 'completed';
            await client.query(`UPDATE orders SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = $1`, [orderId]);
            statusChanged = true;
        } else if (allPicked && currentOrderStatus === 'picking') {
            finalStatus = 'picked';
            await client.query(`UPDATE orders SET status = 'picked', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [orderId]);
            statusChanged = true;
        }
        await client.query('COMMIT');
        await logOperation(userId, orderId, type, { sku, amount, by: userName });
        if (statusChanged) {
            await logOperation(userId, orderId, 'status_change', { from: currentOrderStatus, to: finalStatus });
            const taskResult = await pool.query('SELECT o.id, o.voucher_number, o.customer_name, o.status, p.name as picker_name, u.name as current_user FROM orders o LEFT JOIN users p ON o.picker_id = p.id LEFT JOIN users u ON o.packer_id = u.id WHERE o.id = $1', [orderId]);
            io.emit('task_status_changed', { ...taskResult.rows[0] });
        }
        const updatedOrderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
        const updatedItemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
        res.json({ order: updatedOrderResult.rows[0], items: updatedItemsResult.rows });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('更新品項數量失敗:', err);
        res.status(500).json({ message: '伺服器內部錯誤' });
    } finally {
        client.release();
    }
});

app.patch('/api/orders/:orderId/void', authenticateToken, authorizeAdmin, async (req, res) => {
    const { orderId } = req.params;
    const { reason } = req.body;
    try {
        const result = await pool.query("UPDATE orders SET status = 'voided', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING voucher_number", [orderId]);
        if (result.rowCount === 0) return res.status(404).json({ message: '找不到要作廢的訂單' });
        await logOperation(req.user.id, orderId, 'void', { reason });
        res.json({ message: `訂單 ${result.rows[0].voucher_number} 已成功作廢` });
    } catch (error) {
        console.error('作廢訂單失敗:', error);
        res.status(500).json({ message: '伺服器內部錯誤' });
    }
});

// ✅ 新增：永久刪除訂單 API (僅限管理員)
app.delete('/api/orders/:orderId', authenticateToken, authorizeAdmin, async (req, res) => {
    const { orderId } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query('DELETE FROM orders WHERE id = $1 RETURNING voucher_number', [orderId]);
        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: '找不到要刪除的訂單' });
        }
        await client.query('COMMIT');
        io.emit('task_deleted', { orderId: parseInt(orderId, 10) });
        res.status(200).json({ message: `訂單 ${result.rows[0].voucher_number} 已被永久刪除` });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`刪除訂單 ${orderId} 失敗:`, error);
        res.status(500).json({ message: '刪除訂單時發生伺服器內部錯誤' });
    } finally {
        client.release();
    }
});

// --- 報告相關 API (僅限管理員) ---
app.get('/api/reports/export', authenticateToken, authorizeAdmin, async (req, res) => {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ message: '必須提供開始與結束日期' });
    try {
        const inclusiveEndDate = endDate + ' 23:59:59';
        const orderResult = await pool.query(`SELECT id, voucher_number, status, completed_at, updated_at FROM orders WHERE (status = 'completed' AND completed_at BETWEEN $1 AND $2) OR (status = 'voided' AND updated_at BETWEEN $1 AND $2) ORDER BY updated_at DESC, completed_at DESC`, [startDate, inclusiveEndDate]);
        const orders = orderResult.rows;
        if (orders.length === 0) return res.status(404).json({ message: '在指定日期範圍內找不到任何已完成或作廢的訂單' });
        const orderIds = orders.map(o => o.id);
        const itemsResult = await pool.query(`SELECT order_id, SUM(quantity) as total_quantity FROM order_items WHERE order_id = ANY($1::int[]) GROUP BY order_id`, [orderIds]);
        const itemCounts = itemsResult.rows.reduce((acc, row) => { acc[row.order_id] = row.total_quantity; return acc; }, {});
        const logsResult = await pool.query(`SELECT ol.order_id, ol.operation_type, ol.created_at, u.name as user_name FROM operation_logs ol JOIN users u ON ol.user_id = u.id WHERE ol.order_id = ANY($1::int[])`, [orderIds]);
        const logsByOrderId = logsResult.rows.reduce((acc, log) => { if (!acc[log.order_id]) { acc[log.order_id] = []; } acc[log.order_id].push(log); return acc; }, {});
        const reportData = orders.map(order => {
            const orderLogs = logsByOrderId[order.id] || [];
            const pickers = [...new Set(orderLogs.filter(l => l.operation_type === 'pick').map(l => l.user_name))].join(', ');
            const packers = [...new Set(orderLogs.filter(l => l.operation_type === 'pack').map(l => l.user_name))].join(', ');
            const voidLog = orderLogs.find(l => l.operation_type === 'void');
            const formatTime = (date) => date ? new Date(date).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '';
            return { "訂單編號": order.voucher_number, "訂單狀態": order.status === 'completed' ? '已完成' : '已作廢', "出貨總件數": itemCounts[order.id] || 0, "揀貨人員": pickers || '無紀錄', "裝箱人員": packers || '無紀錄', "出貨完成時間": order.status === 'completed' ? formatTime(order.completed_at) : '', "作廢人員": voidLog ? voidLog.user_name : '', "作廢時間": voidLog ? formatTime(voidLog.created_at) : '' };
        });
        const csv = Papa.unparse(reportData);
        const fileName = `營運報告_${startDate}_至_${endDate}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        res.status(200).send('\uFEFF' + csv); // \uFEFF 是 BOM，確保 Excel 正確讀取 UTF-8
    } catch (error) {
        console.error('匯出報告時發生錯誤:', error);
        res.status(500).json({ message: '產生報告時發生內部伺服器錯誤' });
    }
});


// =================================================================
// Socket.IO 事件監聽
// =================================================================
io.on('connection', (socket) => {
  console.log('一個使用者已連線:', socket.id);
  socket.on('disconnect', () => {
    console.log('使用者已離線:', socket.id);
  });
});

// =================================================================
// 啟動伺服器
// =================================================================
server.listen(port, () => {
    console.log(`伺服器正在 http://localhost:${port} 上運行`);
});