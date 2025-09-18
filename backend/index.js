const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Papa = require('papaparse');

require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

// --- 中介軟體 (Middleware) ---
app.use(cors());
app.use(express.json());

// --- 資料庫連線設定 ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// --- JWT 認證中介軟體 ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.status(401).json({ message: '未提供認證令牌' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: '無效或過期的令牌' });
        req.user = user;
        next();
    });
};

// --- 管理員權限驗證中介軟體 ---
const authorizeAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: '權限不足，此操作需要管理員權限' });
    }
    next();
};

// --- Helper 函數: 記錄操作日誌 ---
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

// --- Multer 設定 (用於檔案上傳) ---
const upload = multer({ storage: multer.memoryStorage() });

// --- 資料庫初始化 ---
const initializeDatabase = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                name VARCHAR(100),
                role VARCHAR(20) NOT NULL CHECK (role IN ('picker', 'packer', 'admin')),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // 注意：這裡的 orders 表結構需要與您手動修改後的資料庫一致
        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                voucher_number VARCHAR(100) UNIQUE NOT NULL,
                customer_name VARCHAR(255),
                warehouse VARCHAR(100),
                status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP WITH TIME ZONE,
                picker_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                packer_id INTEGER REFERENCES users(id) ON DELETE SET NULL
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS order_items (
                id SERIAL PRIMARY KEY,
                order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
                product_code VARCHAR(100) NOT NULL,
                product_name VARCHAR(255),
                quantity INTEGER NOT NULL,
                picked_quantity INTEGER DEFAULT 0,
                packed_quantity INTEGER DEFAULT 0
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS operation_logs (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                order_id INTEGER,
                operation_type VARCHAR(50),
                details JSONB,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('資料庫表單檢查/建立完成');
    } catch (err) {
        console.error('初始化資料庫失敗:', err);
    }
};


// =============================================
// API 路由 (Routes)
// =============================================

// --- 健康檢查 ---
app.get('/', (req, res) => res.send('Moztech WMS API 正在運行！'));

// --- 使用者認證 API ---
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

// --- 管理員 API ---
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

// --- 任務流程 API ---
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
        const updatedOrderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
        const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
        res.json({ order: updatedOrderResult.rows[0], items: itemsResult.rows });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('認領任務失敗:', error);
        res.status(500).json({ message: '認領任務時發生伺服器錯誤' });
    } finally {
        client.release();
    }
});

// --- 訂單處理 API ---

app.post('/api/orders/import', authenticateToken, upload.single('orderFile'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: '沒有上傳檔案' });
    const client = await pool.connect();
    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
        const voucherNumber = data[1] && data[1][0] ? String(data[1][0]).split('：')[1]?.trim() : null;
        const customerName = data[2] && data[2][0] ? String(data[2][0]).split('：')[1]?.trim() : null;
        const warehouse = data[3] && data[3][0] ? String(data[3][0]).split('：')[1]?.trim() : null;
        let itemsStartRow = -1;
        for(let i = 0; i < data.length; i++) {
            if (data[i] && data[i].includes('品項編碼')) {
                itemsStartRow = i + 1;
                break;
            }
        }
        if (itemsStartRow === -1) return res.status(400).json({ message: 'Excel 檔案中找不到 "品項編碼" 標題行' });
        const itemsData = data.slice(itemsStartRow).filter(row => row[0] && row[2]);
        if (!voucherNumber) return res.status(400).json({ message: 'Excel 檔案缺少單據編號 (請檢查 A2 儲存格是否為 "憑證號碼：...")' });
        await client.query('BEGIN');
        const existingOrder = await client.query('SELECT id FROM orders WHERE voucher_number = $1', [voucherNumber]);
        if (existingOrder.rows.length > 0) { await client.query('ROLLBACK'); return res.status(409).json({ message: `訂單 ${voucherNumber} 已存在，請勿重複匯入` }); }
        const orderInsertResult = await client.query('INSERT INTO orders (voucher_number, customer_name, warehouse, status) VALUES ($1, $2, $3, $4) RETURNING id', [voucherNumber, customerName, warehouse, 'pending']);
        const orderId = orderInsertResult.rows[0].id;
        for (const row of itemsData) {
            const productCode = row[0];
            const productName = row[1];
            const quantity = parseInt(row[2], 10);
            if (productCode && productName && !isNaN(quantity) && quantity > 0) {
                await client.query('INSERT INTO order_items (order_id, product_code, product_name, quantity) VALUES ($1, $2, $3, $4)', [orderId, productCode, productName, quantity]);
            }
        }
        await client.query('COMMIT');
        await logOperation(req.user.id, orderId, 'import', { voucherNumber });
        res.status(201).json({ message: '訂單匯入成功', orderId: orderId, voucherNumber: voucherNumber });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('匯入訂單失敗:', err);
        res.status(500).json({ message: '處理 Excel 檔案時發生錯誤，請檢查格式或聯繫管理員' });
    } finally {
        client.release();
    }
});

app.get('/api/orders/:orderId', authenticateToken, async (req, res) => {
    try {
        const { orderId } = req.params;
        const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
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
        if (type === 'pick' && order.picker_id !== userId && order.status === 'picking') { await client.query('ROLLBACK'); return res.status(403).json({ message: '您不是此訂單的指定揀貨員' }); }
        if (type === 'pack' && order.packer_id !== userId && order.status === 'packing') { await client.query('ROLLBACK'); return res.status(403).json({ message: '您不是此訂單的指定裝箱員' }); }
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
        if (statusChanged) await logOperation(userId, orderId, 'status_change', { from: currentOrderStatus, to: finalStatus });
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

// --- 報告相關 API ---
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
        res.status(200).send('\uFEFF' + csv);
    } catch (error) {
        console.error('匯出報告時發生錯誤:', error);
        res.status(500).json({ message: '產生報告時發生內部伺服器錯誤' });
    }
});

// --- 啟動伺服器 ---
app.listen(port, async () => {
    await initializeDatabase();
    console.log(`伺服器正在 http://localhost:${port} 上運行`);
});