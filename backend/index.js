// =================================================================
// MOZTECH WMS 后端主程式 (index.js) - v5.8 跨环境稳定版
// =================================================================
 
// --- 核心套件引入 ---
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

// --- 环境设定 ---
require('dotenv').config();

// --- 应用程式与伺服器初始化 ---
const app = express();
const port = process.env.PORT || 3001;
const server = http.createServer(app);

// --- 全局中介软体设定 ---
// 🔥🔥🔥【CORS 最终解决方案】: 动态允许多个来源 (线上正式环境 + 本地开发环境) 🔥🔥🔥
const allowedOrigins = [
    'https://moztech-shipment-verification-system.onrender.com', // 您的线上前端 URL
    'http://localhost:3000',                                     // 您本地开发时前端的 URL
    'http://localhost:3001'                                      // (备用) 有时本地开发也需要
];
const corsOptions = {
    origin: function (origin, callback) {
        // 允许 Postman 等没有 origin 的请求 (用于 API 测试)
        if (!origin) return callback(null, true);
        
        // 如果请求的来源在我们的允许列表中，就允许它
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            // 否则，拒绝它
            console.error(`CORS Error: Request from origin ${origin} is not allowed.`);
            callback(new Error('Not allowed by CORS'));
        }
    }
};
app.use(cors(corsOptions));
app.use(express.json());


// --- 资料库连线池设定 ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// --- Socket.IO 即时通讯伺服器设定 ---
// Socket.IO 的 CORS 设定也应该与 HTTP 的设定保持一致
const io = new Server(server, {
    cors: corsOptions, // 直接复用上面定义的 corsOptions
    allowEIO3: true
});

// =================================================================
// #region 中介软体 (Middlewares)
// =================================================================
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.status(401).json({ message: '未提供认证权杖 (Token)' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            console.error('JWT 验证失败:', err.message);
            return res.status(403).json({ message: '无效或过期的权杖' });
        }
        req.user = user;
        next();
    });
};

const authorizeAdmin = (req, res, next) => {
    if (!req.user.role || req.user.role.trim().toLowerCase() !== 'admin') {
        return res.status(403).json({ message: '权限不足，此操作需要管理员权限' });
    }
    next();
};
// #endregion

// =================================================================
// #region 辅助函式 (Helper Functions)
// =================================================================
const logOperation = async (userId, orderId, operationType, details) => {
    try {
        await pool.query('INSERT INTO operation_logs (user_id, order_id, action_type, details) VALUES ($1, $2, $3, $4)', [userId, orderId, operationType, JSON.stringify(details)]);
    } catch (error) {
        console.error('记录操作日志失败:', error);
    }
};

const upload = multer({ storage: multer.memoryStorage() });
// #endregion

// =================================================================
// #region API 路由定义 (API Routes Definition)
// =================================================================

// --- 根路由 ---
app.get('/', (req, res) => res.send('Moztech WMS API 正在运行！'));

// --- 认证路由 ---
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: '请提供使用者名称和密码' });
    try {
        // 🔥【登入关键修正】: 使用 LOWER() 让使用者名称比对不区分大小写
        const result = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
        const user = result.rows[0];
        if (!user) return res.status(400).json({ message: '无效的使用者名称或密码' });
        
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).json({ message: '无效的使用者名称或密码' });

        // 🔥【权限关键修正】: 在生成 Token 前，对角色(role)进行清洗
        const cleanedRole = user.role ? String(user.role).trim().toLowerCase() : null;

        const accessToken = jwt.sign(
            { id: user.id, username: user.username, name: user.name, role: cleanedRole },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            accessToken,
            user: { id: user.id, username: user.username, name: user.name, role: cleanedRole }
        });

    } catch (err) {
        console.error('登入失败:', err);
        res.status(500).json({ message: '伺服器内部错误' });
    }
});

// --- 使用者管理路由 (Admin Router) ---
const adminRouter = express.Router();

adminRouter.post('/create-user', async (req, res) => {
    let { username, password, name, role } = req.body;
    if (!username || !password || !name || !role) return res.status(400).json({ message: '缺少必要栏位' });
    
    role = String(role).trim().toLowerCase();

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (username, password, name, role) VALUES ($1, $2, $3, $4)', [username, hashedPassword, name, role]);
        res.status(201).json({ message: `使用者 ${username} (${role}) 已成功建立` });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ message: '使用者名称已存在' });
        console.error('建立使用者失败:', err);
        res.status(500).json({ message: '伺服器内部错误' });
    }
});
adminRouter.get('/users', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, name, role, created_at FROM users ORDER BY id ASC');
        res.json(result.rows);
    } catch (error) {
        console.error('获取使用者列表失败:', error);
        res.status(500).json({ message: '伺服器内部错误' });
    }
});
adminRouter.put('/users/:userId', async (req, res) => {
    const { userId } = req.params;
    let { name, role, password } = req.body;
    if (!name && !role && !password) return res.status(400).json({ message: '请提供至少一项要更新的资讯' });
    if (Number(userId) === req.user.id && role && String(role).trim().toLowerCase() !== 'admin') return res.status(400).json({ message: '无法修改自己的管理员权限' });
    try {
        let query = 'UPDATE users SET ';
        const values = []; let valueCount = 1;
        if (name) { query += `name = $${valueCount++}, `; values.push(name); }
        if (role) {
            role = String(role).trim().toLowerCase();
            query += `role = $${valueCount++}, `; values.push(role);
        }
        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            query += `password = $${valueCount++}, `; values.push(hashedPassword);
        }
        query = query.slice(0, -2) + ` WHERE id = $${valueCount}`;
        values.push(userId);
        const result = await pool.query(query, values);
        if (result.rowCount === 0) return res.status(404).json({ message: '找不到该使用者' });
        res.json({ message: '使用者资讯已成功更新' });
    } catch (error) {
        console.error(`更新使用者 ${userId} 失败:`, error);
        res.status(500).json({ message: '伺服器内部错误' });
    }
});
adminRouter.delete('/users/:userId', async (req, res) => {
    const { userId } = req.params;
    if (Number(userId) === req.user.id) return res.status(400).json({ message: '无法删除自己的帐号' });
    try {
        const result = await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        if (result.rowCount === 0) return res.status(404).json({ message: '找不到要删除的使用者' });
        res.status(200).json({ message: '使用者已成功删除' });
    } catch (error) {
        console.error(`删除使用者 ${userId} 失败:`, error);
        res.status(500).json({ message: '伺服器内部错误' });
    }
});

// --- 订单工作流路由 (Order Router) ---
const orderRouter = express.Router();
orderRouter.post('/import', authorizeAdmin, upload.single('orderFile'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: '没有上传档案' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
        const voucherCell = data[1]?.[0] ? String(data[1][0]) : '';
        const voucherMatch = voucherCell.match(/凭证号码\s*[:：]\s*(.*)/);
        const voucherNumber = voucherMatch ? voucherMatch[1].trim() : null;
        const customerCell = data[2]?.[0] ? String(data[2][0]) : '';
        const customerMatch = customerCell.match(/收件-客户\/供应商\s*[:：]\s*(.*)/);
        const customerName = customerMatch ? customerMatch[1].trim() : null;
        if (!voucherNumber) return res.status(400).json({ message: "Excel 档案格式错误：找不到凭证号码" });
        const existingOrder = await client.query('SELECT id FROM orders WHERE voucher_number = $1', [voucherNumber]);
        if (existingOrder.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ message: `订单 ${voucherNumber} 已存在` });
        }
        const orderInsertResult = await client.query('INSERT INTO orders (voucher_number, customer_name, status) VALUES ($1, $2, $3) RETURNING id', [voucherNumber, customerName, 'pending']);
        const orderId = orderInsertResult.rows[0].id;
        let itemsStartRow = -1, headerRow = [];
        for (let i = 0; i < data.length; i++) {
            if (data[i]?.some(cell => String(cell).includes('品项编码'))) { itemsStartRow = i + 1; headerRow = data[i]; break; }
        }
        if (itemsStartRow === -1) return res.status(400).json({ message: "Excel 档案格式错误：找不到品项标头" });
        const barcodeIndex = headerRow.findIndex(h => String(h).includes('品项编码')), nameAndSkuIndex = headerRow.findIndex(h => String(h).includes('品项名称')), quantityIndex = headerRow.findIndex(h => String(h).includes('数量')), summaryIndex = headerRow.findIndex(h => String(h).includes('摘要'));
        if (barcodeIndex === -1 || nameAndSkuIndex === -1 || quantityIndex === -1) return res.status(400).json({ message: "Excel 档案格式错误：缺少必要栏位" });
        for (let i = itemsStartRow; i < data.length; i++) {
            const row = data[i];
            if (!row?.[barcodeIndex] || !row?.[nameAndSkuIndex] || !row?.[quantityIndex]) continue;
            const barcode = String(row[barcodeIndex]), fullNameAndSku = String(row[nameAndSkuIndex]), quantity = parseInt(row[quantityIndex], 10), summary = summaryIndex > -1 && row[summaryIndex] ? String(row[summaryIndex]).replace(/[ㆍ\s]/g, '') : '';
            const skuMatch = fullNameAndSku.match(/\[(.*?)\]/), productCode = skuMatch ? skuMatch[1] : null, productName = skuMatch ? fullNameAndSku.substring(0, skuMatch.index).trim() : fullNameAndSku.trim();
            if (barcode && productCode && productName && !isNaN(quantity) && quantity > 0) {
                const itemInsertResult = await client.query('INSERT INTO order_items (order_id, product_code, product_name, quantity, barcode) VALUES ($1, $2, $3, $4, $5) RETURNING id', [orderId, productCode, productName, quantity, barcode]);
                const orderItemId = itemInsertResult.rows[0].id;
                if (summary) {
                    const snLength = 12, serialNumbers = [];
                    for (let j = 0; j < summary.length; j += snLength) {
                        const sn = summary.substring(j, j + snLength);
                        if (sn.length === snLength) serialNumbers.push(sn);
                    }
                    for (const sn of serialNumbers) await client.query('INSERT INTO order_item_instances (order_item_id, serial_number) VALUES ($1, $2)', [orderItemId, sn]);
                }
            }
        }
        await client.query('COMMIT');
        await logOperation(req.user.id, orderId, 'import', { voucherNumber });
        io.emit('new_task', { id: orderId, voucher_number: voucherNumber, customer_name: customerName, status: 'pending', task_type: 'pick' });
        res.status(201).json({ message: `订单 ${voucherNumber} 导入成功`, orderId: orderId });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('导入订单时发生严重错误:', err);
        res.status(500).json({ message: err.message || '处理 Excel 档案时发生伺服器内部错误' });
    } finally {
        client.release();
    }
});
orderRouter.post('/update_item', async (req, res) => {
    const { orderId, scanValue, type, amount = 1 } = req.body;
    const { id: userId, role } = req.user;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const order = (await client.query('SELECT * FROM orders WHERE id = $1', [orderId])).rows[0];
        if ((type === 'pick' && order.picker_id !== userId && role.trim() !== 'admin') || (type === 'pack' && order.packer_id !== userId && role.trim() !== 'admin')) throw new Error('您不是此任务的指定操作员');
        let instanceResult = await client.query(`SELECT i.id, i.status FROM order_item_instances i JOIN order_items oi ON i.order_item_id = oi.id WHERE oi.order_id = $1 AND i.serial_number = $2 FOR UPDATE`, [orderId, scanValue]);
        if (instanceResult.rows.length > 0) {
            const instance = instanceResult.rows[0]; let newStatus = '';
            if (type === 'pick' && instance.status === 'pending') newStatus = 'picked'; else if (type === 'pack' && instance.status === 'picked') newStatus = 'packed'; else throw new Error(`SN 码 ${scanValue} 状态 (${instance.status}) 无法执行此操作`);
            await client.query('UPDATE order_item_instances SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newStatus, instance.id]);
            await logOperation(userId, orderId, type, { serialNumber: scanValue, statusChange: `${instance.status} -> ${newStatus}` });
        } else {
            const itemIdResult = await client.query(`SELECT oi.id FROM order_items oi LEFT JOIN order_item_instances i ON oi.id = i.order_item_id WHERE oi.order_id = $1 AND oi.barcode = $2 AND i.id IS NULL`, [orderId, scanValue]);
            if (itemIdResult.rows.length === 0) throw new Error(`条码 ${scanValue} 不属于此订单，或该品项需要扫描 SN 码`);
            const itemId = itemIdResult.rows[0].id, itemResult = await client.query('SELECT * FROM order_items WHERE id = $1 FOR UPDATE', [itemId]), item = itemResult.rows[0];
            if (type === 'pick') { const newPickedQty = item.picked_quantity + amount; if (newPickedQty < 0 || newPickedQty > item.quantity) throw new Error('拣货数量无效'); await client.query('UPDATE order_items SET picked_quantity = $1 WHERE id = $2', [newPickedQty, item.id]); }
            else if (type === 'pack') { const newPackedQty = item.packed_quantity + amount; if (newPackedQty < 0 || newPackedQty > item.picked_quantity) throw new Error('装箱数量不能超过已拣货数量'); await client.query('UPDATE order_items SET packed_quantity = $1 WHERE id = $2', [newPackedQty, item.id]); }
            await logOperation(userId, orderId, type, { barcode: scanValue, amount });
        }
        await client.query('COMMIT');
        const allItems = (await pool.query('SELECT * FROM order_items WHERE order_id = $1', [orderId])).rows, allInstances = (await pool.query('SELECT i.* FROM order_item_instances i JOIN order_items oi ON i.order_item_id = oi.id WHERE oi.order_id = $1', [orderId])).rows;
        let allPicked = true, allPacked = true;
        for (const item of allItems) { const itemInstances = allInstances.filter(inst => inst.order_item_id === item.id); if (itemInstances.length > 0) { if (!itemInstances.every(i => i.status === 'picked' || i.status === 'packed')) allPicked = false; if (!itemInstances.every(i => i.status === 'packed')) allPacked = false; } else { if (item.picked_quantity < item.quantity) allPicked = false; if (item.packed_quantity < item.quantity) allPacked = false; } }
        let statusChanged = false, finalStatus = order.status;
        if (allPacked && order.status !== 'completed') { finalStatus = 'completed'; statusChanged = true; await pool.query(`UPDATE orders SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = $1`, [orderId]); }
        else if (allPicked && order.status === 'picking') { finalStatus = 'picked'; statusChanged = true; await pool.query(`UPDATE orders SET status = 'picked', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [orderId]); }
        if (statusChanged) io.emit('task_status_changed', { orderId: parseInt(orderId, 10), newStatus: finalStatus });
        const updatedOrderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]); const updatedItemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]); const updatedInstancesResult = await pool.query('SELECT i.* FROM order_item_instances i JOIN order_items oi ON i.order_item_id = oi.id WHERE oi.order_id = $1', [orderId]);
        res.json({ order: updatedOrderResult.rows[0], items: updatedItemsResult.rows, instances: updatedInstancesResult.rows });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('更新品项状态失败:', err.message);
        res.status(400).json({ message: err.message || '伺服器内部错误' });
    } finally {
        client.release();
    }
});
orderRouter.post('/:orderId/claim', async (req, res) => {
    const { orderId } = req.params;
    const { id: userId, role } = req.user;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const orderResult = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
        const order = orderResult.rows[0];
        if (!order) { await client.query('ROLLBACK'); return res.status(404).json({ message: '找不到该订单' }); }
        let newStatus = '', task_type = '';
        if ((role.trim() === 'picker' || role.trim() === 'admin') && order.status === 'pending') {
            newStatus = 'picking'; task_type = 'pick';
            await client.query('UPDATE orders SET status = $1, picker_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [newStatus, userId, orderId]);
        } else if ((role.trim() === 'packer' || role.trim() === 'admin') && order.status === 'picked') {
            newStatus = 'packing'; task_type = 'pack';
            await client.query('UPDATE orders SET status = $1, packer_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [newStatus, userId, orderId]);
        } else { await client.query('ROLLBACK'); return res.status(400).json({ message: `无法认领该任务，订单状态为「${order.status}」，可能已被他人处理。` }); }
        await client.query('COMMIT');
        await logOperation(userId, orderId, 'claim', { new_status: newStatus });
        const updatedOrder = (await pool.query('SELECT o.*, u.name as current_user FROM orders o LEFT JOIN users u ON (CASE WHEN $1 = \'pick\' THEN o.picker_id WHEN $1 = \'pack\' THEN o.packer_id END) = u.id WHERE o.id = $2', [task_type, orderId])).rows[0];
        io.emit('task_claimed', { ...updatedOrder, task_type });
        res.status(200).json({ message: '任务认领成功' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('认领任务失败:', error);
        res.status(500).json({ message: '认领任务时发生伺服器错误' });
    } finally {
        client.release();
    }
});
orderRouter.get('/:orderId', async (req, res) => {
    const { orderId } = req.params;
    try {
        const orderResult = await pool.query('SELECT o.*, p.name as picker_name, pk.name as packer_name FROM orders o LEFT JOIN users p ON o.picker_id = p.id LEFT JOIN users pk ON o.packer_id = pk.id WHERE o.id = $1;', [orderId]);
        if (orderResult.rows.length === 0) return res.status(404).json({ message: '找不到订单' });
        const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
        const instancesResult = await pool.query('SELECT i.* FROM order_item_instances i JOIN order_items oi ON i.order_item_id = oi.id WHERE oi.order_id = $1 ORDER BY i.id', [orderId]);
        res.json({ order: orderResult.rows[0], items: itemsResult.rows, instances: instancesResult.rows });
    } catch (err) {
        console.error('获取订单详情失败:', err);
        res.status(500).json({ message: '伺服器内部错误' });
    }
});
orderRouter.patch('/:orderId/void', authorizeAdmin, async (req, res) => {
    const { orderId } = req.params;
    const { reason } = req.body;
    try {
        const result = await pool.query("UPDATE orders SET status = 'voided', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING voucher_number", [orderId]);
        if (result.rowCount === 0) return res.status(404).json({ message: '找不到要作废的订单' });
        await logOperation(req.user.id, orderId, 'void', { reason });
        io.emit('task_status_changed', { orderId: parseInt(orderId, 10), newStatus: 'voided' });
        res.json({ message: `订单 ${result.rows[0].voucher_number} 已成功作废` });
    } catch (error) {
        console.error('作废订单失败:', error);
        res.status(500).json({ message: '伺服器内部错误' });
    }
});
orderRouter.delete('/:orderId', authorizeAdmin, async (req, res) => {
    const { orderId } = req.params;
    try {
        const result = await pool.query('DELETE FROM orders WHERE id = $1 RETURNING voucher_number', [orderId]);
        if (result.rowCount === 0) return res.status(404).json({ message: '找不到要删除的订单' });
        io.emit('task_deleted', { orderId: parseInt(orderId, 10) });
        res.status(200).json({ message: `订单 ${result.rows[0].voucher_number} 已被永久删除` });
    } catch (error) {
        console.error(`删除订单 ${orderId} 失败:`, error);
        res.status(500).json({ message: '删除订单时发生伺服器内部错误' });
    }
});

// --- 任务 & 报告路由 (独立路由) ---
app.get('/api/tasks', authenticateToken, async (req, res) => {
    const role = req.user.role; // Token 中的 role 已经被清洗过了
    const userId = req.user.id;
    if (!role) {
        console.error(`[ERROR] User ID: ${userId} has an invalid or null role.`);
        return res.status(403).json({ message: '使用者角色无效' });
    }
    try {
        const query = `
            SELECT o.id, o.voucher_number, o.customer_name, o.status, p.name as picker_name,
                   (CASE WHEN o.status = 'picking' THEN picker_u.name WHEN o.status = 'packing' THEN packer_u.name ELSE NULL END) as current_user,
                   (CASE WHEN o.status IN ('pending', 'picking') THEN 'pick' WHEN o.status IN ('picked', 'packing') THEN 'pack' END) as task_type
            FROM orders o
            LEFT JOIN users p ON o.picker_id = p.id
            LEFT JOIN users picker_u ON o.picker_id = picker_u.id
            LEFT JOIN users packer_u ON o.packer_id = packer_u.id
            WHERE 
                ( (o.status = 'pending' OR (o.status = 'picking' AND o.picker_id = $1)) AND $2 IN ('admin', 'picker') ) OR
                ( (o.status = 'picked' OR (o.status = 'packing' AND o.packer_id = $1)) AND $2 IN ('admin', 'packer') )
            ORDER BY o.created_at ASC;
        `;
        const result = await pool.query(query, [userId, role]);
        res.json(result.rows);
    } catch (error) {
        console.error(`[ERROR] Failed to fetch tasks for user ID: ${userId}, role: "${role}". Error:`, error);
        res.status(500).json({ message: '获取任务列表时发生错误' });
    }
});
app.get('/api/reports/export', authenticateToken, authorizeAdmin, async (req, res) => {
    const { startDate, endDate } = req.body;
    if (!startDate || !endDate) return res.status(400).json({ message: '必须提供开始与结束日期' });
    try {
        const inclusiveEndDate = endDate + ' 23:59:59';
        const orderResult = await pool.query(`SELECT id, voucher_number, status, completed_at, updated_at FROM orders WHERE (status = 'completed' AND completed_at BETWEEN $1 AND $2) OR (status = 'voided' AND updated_at BETWEEN $1 AND $2) ORDER BY updated_at DESC, completed_at DESC`, [startDate, inclusiveEndDate]);
        const orders = orderResult.rows;
        if (orders.length === 0) return res.status(404).json({ message: '在指定日期范围内找不到任何已完成或作废的订单' });
        const orderIds = orders.map(o => o.id);
        const itemsResult = await pool.query(`SELECT order_id, SUM(quantity) as total_quantity FROM order_items WHERE order_id = ANY($1::int[]) GROUP BY order_id`, [orderIds]);
        const itemCounts = itemsResult.rows.reduce((acc, row) => { acc[row.order_id] = row.total_quantity; return acc; }, {});
        const logsResult = await pool.query(`SELECT ol.order_id, ol.action_type, ol.created_at, u.name as user_name FROM operation_logs ol JOIN users u ON ol.user_id = u.id WHERE ol.order_id = ANY($1::int[]) AND ol.action_type IN ('pick', 'pack', 'void')`, [orderIds]);
        const logsByOrderId = logsResult.rows.reduce((acc, log) => { if (!acc[log.order_id]) { acc[log.order_id] = []; } acc[log.order_id].push(log); return acc; }, {});
        const reportData = orders.map(order => {
            const orderLogs = logsByOrderId[order.id] || [];
            const pickers = [...new Set(orderLogs.filter(l => l.action_type === 'pick').map(l => l.user_name))].join(', ');
            const packers = [...new Set(orderLogs.filter(l => l.action_type === 'pack').map(l => l.user_name))].join(', ');
            const voidLog = orderLogs.find(l => l.action_type === 'void');
            const formatTime = (date) => date ? new Date(date).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '';
            return { "订单编号": order.voucher_number, "订单状态": order.status === 'completed' ? '已完成' : '已作废', "出货总件数": itemCounts[order.id] || 0, "拣货人员": pickers || '无纪录', "装箱人员": packers || '无纪录', "出货完成时间": order.status === 'completed' ? formatTime(order.completed_at) : '', "作废人员": voidLog ? voidLog.user_name : '', "作废时间": voidLog ? formatTime(voidLog.created_at) : '' };
        });
        const csv = Papa.unparse(reportData);
        const fileName = `营运报告_${startDate}_至_${endDate}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        res.status(200).send('\uFEFF' + csv);
    } catch (error) {
        console.error('汇出报告时发生错误:', error);
        res.status(500).json({ message: '产生报告时发生内部伺服器错误' });
    }
});
// #endregion

// =================================================================
// #region 路由注册 (Router Registration)
// =================================================================
app.use('/api/admin', authenticateToken, authorizeAdmin, adminRouter);
app.use('/api/orders', authenticateToken, orderRouter);
// #endregion

// =================================================================
// #region Socket.IO & 伺服器启动
// =================================================================
io.on('connection', (socket) => {
  console.log('一个使用者已连线:', socket.id);
  socket.on('disconnect', () => {
    console.log('使用者已离线:', socket.id);
  });
});

server.listen(port, () => {
    console.log(`伺服器正在 http://localhost:${port} 上运行`);
});
// #endregion