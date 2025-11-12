// =================================================================
// MOZTECH WMS 後端主程式 (index.js) - v6.3 路由結構最終修正版
//
// 关键修正:
// - 彻底重构路由注册逻辑，确保认证中介软体 (authenticateToken)
//   不会被错误地应用到公开的 `/api/auth/login` 路由上。
//   这是导致 401 错误的根本原因。
// =================================================================
 
// --- 核心套件引入 ---
const express = require('express');
// Express 5 已内建 async/await 错误处理，不再需要 express-async-errors
const http = require('http');
const { Server } = require("socket.io");
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Papa = require('papaparse');
const helmet = require('helmet');
const morgan = require('morgan');
const logger = require('./utils/logger'); // 引入環境感知的 logger

// --- 环境设定 ---
require('dotenv').config();

// --- 应用程式与伺服器初始化 ---
const app = express();
const port = process.env.PORT || 3001;
const server = http.createServer(app);

// =================================================================
// #region 全域中介软体 (Global Middlewares)
// =================================================================
app.use(helmet());
app.use(morgan('dev'));

// CORS allowlist - 根據環境動態設定
const allowlist = process.env.NODE_ENV === 'production' 
    ? [
        'https://moztech-shipment-verification-system.onrender.com',
        'https://moztech-wms-98684976641.us-west1.run.app'
      ]
    : [
        'https://moztech-shipment-verification-system.onrender.com',
        'https://moztech-wms-98684976641.us-west1.run.app',
        'http://localhost:3000',
        'http://localhost:3001'
      ];

const corsOptions = {
    origin: function (origin, callback) {
        // 若非瀏覽器（例如 server-to-server、curl）可能沒有 origin header，允許通過
        if (!origin) return callback(null, true);
        const allowed = allowlist.indexOf(origin) !== -1;
        if (!allowed) {
            logger.debug(`CORS: origin not allowed -> ${origin}`);
        }
        return callback(null, allowed);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
};

// 回傳 Vary: Origin 讓 proxy / CDN 能正確快取不同 Origin 的回應
app.use((req, res, next) => {
    res.header('Vary', 'Origin');
    next();
});

logger.info('Registering CORS middleware');
const _cors_mw = cors(corsOptions);
if (typeof _cors_mw !== 'function') {
    logger.error('ERROR: cors(corsOptions) did not return a function', _cors_mw);
}
app.use(_cors_mw);

app.use(express.json());
// #endregion

// =================================================================
// #region 资料库与 Socket.IO 初始化
// =================================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

logger.info('Initializing Socket.IO');
const io = new Server(server, {
    cors: {
        origin: corsOptions.origin,
        methods: corsOptions.methods,
        credentials: corsOptions.credentials
    },
    allowEIO3: true
});
// #endregion

// =================================================================
// #region 认证与授权中介软体 (Auth Middlewares)
// =================================================================
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    logger.debugSensitive('[authenticateToken] Authorization header:', { authHeader });
    const token = authHeader && authHeader.split(' ')[1];
    logger.debugSensitive('[authenticateToken] Extracted token:', { token: token ? `${token.substring(0, 20)}...` : 'null' });
    if (!token) return res.status(401).json({ message: '未提供認證權杖 (Token)' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            logger.error('JWT 驗證失敗:', err.name, err.message);
            logger.debug('[authenticateToken] JWT_SECRET exists:', !!process.env.JWT_SECRET);
            return res.status(403).json({ message: '無效或過期的權杖' });
        }
        logger.debugSensitive('[authenticateToken] 驗證成功 - 使用者:', user);
        req.user = user;
        next();
    });
};

const authorizeAdmin = (req, res, next) => {
    logger.debug(`[authorizeAdmin] 檢查權限 - user:`, req.user);
    if (!req.user) {
        logger.error('[authorizeAdmin] req.user 不存在');
        return res.status(401).json({ message: '未認證的請求' });
    }
    if (req.user.role !== 'admin') {
        logger.error(`[authorizeAdmin] 權限不足 - role: ${req.user.role}`);
        return res.status(403).json({ message: '權限不足，此操作需要管理員權限' });
    }
    logger.debug('[authorizeAdmin] 權限檢查通過');
    next();
};
// #endregion

// =================================================================
// #region 辅助函式 (Helper Functions)
// =================================================================
const logOperation = async (userId, orderId, operationType, details) => {
    try {
        const result = await pool.query(
            'INSERT INTO operation_logs (user_id, order_id, action_type, details) VALUES ($1, $2, $3, $4) RETURNING id, created_at',
            [userId, orderId, operationType, JSON.stringify(details)]
        );
        
        // 發送即時通知給管理員
        const logEntry = result.rows[0];
        const userInfo = await pool.query('SELECT name, role FROM users WHERE id = $1', [userId]);
        const orderInfo = await pool.query('SELECT voucher_number, customer_name FROM orders WHERE id = $1', [orderId]);
        
        io.emit('new_operation_log', {
            id: logEntry.id,
            user_id: userId,
            user_name: userInfo.rows[0]?.name,
            user_role: userInfo.rows[0]?.role,
            order_id: orderId,
            voucher_number: orderInfo.rows[0]?.voucher_number,
            customer_name: orderInfo.rows[0]?.customer_name,
            action_type: operationType,
            details: details,
            created_at: logEntry.created_at
        });
        
        logger.debug(`[logOperation] 記錄操作: ${operationType} - 訂單 ${orderId}, 使用者 ${userId}`);
    } catch (error) {
        logger.error('記錄操作日誌失敗:', error);
    }
};
const upload = multer({ storage: multer.memoryStorage() });
// #endregion

// =================================================================
// #region API 路由定义 (API Routes)
// =================================================================

// --- 公开路由 (不需要 Token) ---
const publicRouter = express.Router();
publicRouter.get('/', (req, res) => res.send('Moztech WMS API 正在運行！'));

// 獨立的認證路由 (必須在其他 /api 路由之前註冊)
const authRouter = express.Router();
authRouter.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: '請提供使用者名稱和密碼' });
    const result = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    const user = result.rows[0];
    if (!user) return res.status(400).json({ message: '無效的使用者名稱或密碼' });
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ message: '無效的使用者名稱或密碼' });
    const cleanedRole = user.role ? String(user.role).trim().toLowerCase() : null;
    const accessToken = jwt.sign(
        { id: user.id, username: user.username, name: user.name, role: cleanedRole },
        process.env.JWT_SECRET,
        { expiresIn: '8h' }
    );
    res.json({ accessToken, user: { id: user.id, username: user.username, name: user.name, role: cleanedRole } });
});

// --- 受保护的管理路由 (需要 Admin Token) ---
const adminRouter = express.Router();
adminRouter.post('/create-user', async (req, res) => {
    let { username, password, name, role } = req.body;
    if (!username || !password || !name || !role) return res.status(400).json({ message: '缺少必要欄位' });
    role = String(role).trim().toLowerCase();
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (username, password, name, role) VALUES ($1, $2, $3, $4)', [username, hashedPassword, name, role]);
    res.status(201).json({ message: `使用者 ${username} (${role}) 已成功建立` });
});
adminRouter.get('/users', async (req, res) => {
    const result = await pool.query('SELECT id, username, name, role, created_at FROM users ORDER BY id ASC');
    res.json(result.rows);
});
adminRouter.put('/users/:userId', async (req, res) => {
    const { userId } = req.params;
    let { name, role, password } = req.body;
    if (!name && !role && !password) return res.status(400).json({ message: '請提供至少一項要更新的資訊' });
    if (Number(userId) === req.user.id && role && String(role).trim().toLowerCase() !== 'admin') return res.status(400).json({ message: '無法修改自己的管理員權限' });
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
    if (result.rowCount === 0) return res.status(404).json({ message: '找不到該使用者' });
    res.json({ message: '使用者資訊已成功更新' });
});
adminRouter.delete('/users/:userId', async (req, res) => {
    const { userId } = req.params;
    if (Number(userId) === req.user.id) return res.status(400).json({ message: '無法刪除自己的帳號' });
    const result = await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    if (result.rowCount === 0) return res.status(404).json({ message: '找不到要刪除的使用者' });
    res.status(200).json({ message: '使用者已成功刪除' });
});

// --- 受保护的通用路由 (需要登入 Token) ---
const apiRouter = express.Router();
apiRouter.get('/tasks', async (req, res) => {
    const { id: userId, role } = req.user;
    logger.debug(`[/api/tasks] 使用者請求 - ID: ${userId}, 角色: ${role}`);
    if (!role) return res.status(403).json({ message: '使用者角色無效' });
    const query = `
        SELECT o.id, o.voucher_number, o.customer_name, o.status, p.name as picker_name,
               (CASE WHEN o.status = 'picking' THEN picker_u.name WHEN o.status = 'packing' THEN packer_u.name ELSE NULL END) as current_user,
               (CASE WHEN o.status IN ('pending', 'picking') THEN 'pick' WHEN o.status IN ('picked', 'packing') THEN 'pack' END) as task_type
        FROM orders o
        LEFT JOIN users p ON o.picker_id = p.id 
        LEFT JOIN users picker_u ON o.picker_id = picker_u.id 
        LEFT JOIN users packer_u ON o.packer_id = packer_u.id
        WHERE 
            ($2 = 'admin' AND o.status IN ('pending', 'picking', 'picked', 'packing')) OR
            ($2 = 'picker' AND (o.status = 'pending' OR (o.status = 'picking' AND o.picker_id = $1))) OR
            ($2 = 'packer' AND (o.status = 'picked' OR (o.status = 'packing' AND o.packer_id = $1)))
        ORDER BY o.created_at ASC;
    `;
    logger.debug(`[/api/tasks] 執行查詢，參數: userId=${userId}, role=${role}`);
    const result = await pool.query(query, [userId, role]);
    logger.info(`[/api/tasks] 查詢結果: 找到 ${result.rows.length} 筆任務`);
    if (result.rows.length > 0) {
        logger.debug(`[/api/tasks] 第一筆任務:`, JSON.stringify(result.rows[0]));
    }
    res.json(result.rows);
});

// 操作日誌查詢端點
apiRouter.get('/operation-logs', authorizeAdmin, async (req, res) => {
    const { orderId, userId, startDate, endDate, actionType, limit = 100 } = req.query;
    
    logger.info(`[/api/operation-logs] 查詢操作日誌 - orderId: ${orderId}, userId: ${userId}, startDate: ${startDate}, endDate: ${endDate}, actionType: ${actionType}`);
    
    try {
        let query = `
            SELECT 
                ol.id,
                ol.user_id,
                ol.order_id,
                ol.action_type,
                ol.details,
                ol.created_at,
                u.name as user_name,
                u.role as user_role,
                o.voucher_number,
                o.customer_name,
                o.status as order_status
            FROM operation_logs ol
            LEFT JOIN users u ON ol.user_id = u.id
            LEFT JOIN orders o ON ol.order_id = o.id
            WHERE 1=1
        `;
        
        const params = [];
        let paramCount = 1;
        
        // 按訂單 ID 或訂單號碼篩選
        if (orderId) {
            // 判斷是數字 ID 還是訂單號碼
            if (/^\d+$/.test(orderId)) {
                // 純數字,按 order_id 搜尋
                query += ` AND ol.order_id = $${paramCount}`;
                params.push(parseInt(orderId));
            } else {
                // 包含字母或符號,按 voucher_number 搜尋 (模糊搜尋)
                query += ` AND o.voucher_number ILIKE $${paramCount}`;
                params.push(`%${orderId}%`);
            }
            paramCount++;
        }
        
        // 按使用者 ID 篩選
        if (userId) {
            query += ` AND ol.user_id = $${paramCount}`;
            params.push(parseInt(userId));
            paramCount++;
        }
        
        // 按操作類型篩選
        if (actionType) {
            query += ` AND ol.action_type = $${paramCount}`;
            params.push(actionType);
            paramCount++;
        }
        
        // 按日期範圍篩選
        if (startDate) {
            query += ` AND ol.created_at >= $${paramCount}`;
            params.push(startDate);
            paramCount++;
        }
        
        if (endDate) {
            const inclusiveEndDate = endDate + ' 23:59:59';
            query += ` AND ol.created_at <= $${paramCount}`;
            params.push(inclusiveEndDate);
            paramCount++;
        }
        
        // 排序和限制
        query += ` ORDER BY ol.created_at DESC LIMIT $${paramCount}`;
        params.push(parseInt(limit));
        
        logger.debug(`[/api/operation-logs] 執行查詢:`, { query: query.substring(0, 200), params });
        
        const result = await pool.query(query, params);
        
        logger.info(`[/api/operation-logs] 找到 ${result.rows.length} 筆操作記錄`);
        
        res.json({
            total: result.rows.length,
            logs: result.rows
        });
    } catch (error) {
        logger.error('[/api/operation-logs] 查詢失敗:', error.message);
        logger.error('[/api/operation-logs] 錯誤堆疊:', error.stack);
        res.status(500).json({ 
            message: '查詢操作日誌失敗',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// 取得操作日誌統計資訊
apiRouter.get('/operation-logs/stats', authorizeAdmin, async (req, res) => {
    const { startDate, endDate } = req.query;
    
    try {
        let query = `
            SELECT 
                action_type,
                COUNT(*) as count,
                COUNT(DISTINCT user_id) as unique_users,
                COUNT(DISTINCT order_id) as unique_orders
            FROM operation_logs
            WHERE 1=1
        `;
        
        const params = [];
        let paramCount = 1;
        
        if (startDate) {
            query += ` AND created_at >= $${paramCount}`;
            params.push(startDate);
            paramCount++;
        }
        
        if (endDate) {
            const inclusiveEndDate = endDate + ' 23:59:59';
            query += ` AND created_at <= $${paramCount}`;
            params.push(inclusiveEndDate);
            paramCount++;
        }
        
        query += ` GROUP BY action_type ORDER BY count DESC`;
        
        const result = await pool.query(query, params);
        
        // 取得總操作數
        const totalQuery = `
            SELECT COUNT(*) as total
            FROM operation_logs
            WHERE created_at >= COALESCE($1::timestamp, '-infinity')
            AND created_at <= COALESCE($2::timestamp, 'infinity')
        `;
        const totalResult = await pool.query(totalQuery, [startDate, endDate ? endDate + ' 23:59:59' : null]);
        
        res.json({
            total: parseInt(totalResult.rows[0].total),
            byActionType: result.rows
        });
    } catch (error) {
        logger.error('[/api/operation-logs/stats] 查詢失敗:', error);
        res.status(500).json({ message: '查詢統計資料失敗' });
    }
});

apiRouter.get('/reports/export', authorizeAdmin, async (req, res) => {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ message: '必須提供開始與結束日期' });
    const inclusiveEndDate = endDate + ' 23:59:59';
    const orderResult = await pool.query(`SELECT id, voucher_number, status, completed_at, updated_at FROM orders WHERE (status = 'completed' AND completed_at BETWEEN $1 AND $2) OR (status = 'voided' AND updated_at BETWEEN $1 AND $2) ORDER BY updated_at DESC, completed_at DESC`, [startDate, inclusiveEndDate]);
    if (orderResult.rows.length === 0) return res.status(404).json({ message: '在指定日期範圍內找不到任何已完成或作廢的訂單' });
    const orders = orderResult.rows;
    const orderIds = orders.map(o => o.id);
    const itemsResult = await pool.query(`SELECT order_id, SUM(quantity) as total_quantity FROM order_items WHERE order_id = ANY($1::int[]) GROUP BY order_id`, [orderIds]);
    const itemCounts = itemsResult.rows.reduce((acc, row) => { acc[row.order_id] = row.total_quantity; return acc; }, {});
    const logsResult = await pool.query(`SELECT ol.order_id, ol.action_type, ol.created_at, u.name as user_name FROM operation_logs ol JOIN users u ON ol.user_id = u.id WHERE ol.order_id = ANY($1::int[]) AND ol.action_type IN ('pick', 'pack', 'void')`, [orderIds]);
    const logsByOrderId = logsResult.rows.reduce((acc, log) => { if (!acc[log.order_id]) acc[log.order_id] = []; acc[log.order_id].push(log); return acc; }, {});
    const reportData = orders.map(order => {
        const orderLogs = logsByOrderId[order.id] || [];
        const pickers = [...new Set(orderLogs.filter(l => l.action_type === 'pick').map(l => l.user_name))].join(', ');
        const packers = [...new Set(orderLogs.filter(l => l.action_type === 'pack').map(l => l.user_name))].join(', ');
        const voidLog = orderLogs.find(l => l.action_type === 'void');
        const formatTime = (date) => date ? new Date(date).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '';
        return { "訂單編號": order.voucher_number, "訂單狀態": order.status === 'completed' ? '已完成' : '已作廢', "出貨總件數": itemCounts[order.id] || 0, "揀貨人員": pickers || '無紀錄', "裝箱人員": packers || '無紀錄', "出貨完成時間": order.status === 'completed' ? formatTime(order.completed_at) : '', "作廢人員": voidLog ? voidLog.user_name : '', "作廢時間": voidLog ? formatTime(voidLog.created_at) : '' };
    });
    const csv = Papa.unparse(reportData);
    const fileName = `營運報告_${startDate}_至_${endDate}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.status(200).send('\uFEFF' + csv);
});
apiRouter.post('/orders/import', authorizeAdmin, upload.single('orderFile'), async (req, res, next) => {
    // ... (此处省略 import 路由的完整程式码以保持简洁，它与 v6.2 版本完全相同)
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
        res.status(201).json({ message: `訂單 ${voucherNumber} 匯入成功`, orderId: orderId });
    } catch (err) {
        await client.query('ROLLBACK');
        next(err);
    } finally {
        client.release();
    }
});
apiRouter.post('/orders/update_item', async (req, res, next) => {
    // ... (此处省略 update_item 路由的完整程式码，与 v6.2 版本完全相同)
    const { orderId, scanValue, type, amount = 1 } = req.body;
    const { id: userId, role } = req.user;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const orderResult = await client.query('SELECT * FROM orders WHERE id = $1', [orderId]);
        if (orderResult.rows.length === 0) throw new Error(`找不到 ID 為 ${orderId} 的訂單`);
        const order = orderResult.rows[0];
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
            await logOperation(userId, orderId, type, { serialNumber: scanValue, statusChange: `${instance.status} -> ${newStatus}` });
        } else {
            const itemResult = await client.query(`SELECT oi.id, oi.quantity, oi.picked_quantity, oi.packed_quantity FROM order_items oi LEFT JOIN order_item_instances i ON oi.id = i.order_item_id WHERE oi.order_id = $1 AND oi.barcode = $2 AND i.id IS NULL`, [orderId, scanValue]);
            if (itemResult.rows.length === 0) throw new Error(`條碼 ${scanValue} 不屬於此訂單，或該品項需要掃描 SN 碼`);
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
            await logOperation(userId, orderId, type, { barcode: scanValue, amount });
        }
        await client.query('COMMIT');
        const allItems = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [orderId]);
        const allInstances = await pool.query('SELECT i.* FROM order_item_instances i JOIN order_items oi ON i.order_item_id = oi.id WHERE oi.order_id = $1', [orderId]);
        let allPicked = true, allPacked = true;
        for (const item of allItems.rows) { 
            const itemInstances = allInstances.rows.filter(inst => inst.order_item_id === item.id); 
            if (itemInstances.length > 0) { 
                if (!itemInstances.every(i => ['picked', 'packed'].includes(i.status))) allPicked = false; 
                if (!itemInstances.every(i => i.status === 'packed')) allPacked = false; 
            } else { 
                if (item.picked_quantity < item.quantity) allPicked = false; 
                if (item.packed_quantity < item.quantity) allPacked = false; 
            } 
        }
        let statusChanged = false, finalStatus = order.status;
        if (allPacked && order.status !== 'completed') { 
            finalStatus = 'completed'; 
            statusChanged = true; 
            await pool.query(`UPDATE orders SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = $1`, [orderId]); 
        } else if (allPicked && order.status === 'picking') { 
            finalStatus = 'picked'; 
            statusChanged = true; 
            await pool.query(`UPDATE orders SET status = 'picked', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [orderId]); 
        }
        if (statusChanged) io.emit('task_status_changed', { orderId: parseInt(orderId, 10), newStatus: finalStatus });
        const updatedOrderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]); 
        const updatedItemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]); 
        const updatedInstancesResult = await pool.query('SELECT i.* FROM order_item_instances i JOIN order_items oi ON i.order_item_id = oi.id WHERE oi.order_id = $1', [orderId]);
        res.json({ order: updatedOrderResult.rows[0], items: updatedItemsResult.rows, instances: updatedInstancesResult.rows });
    } catch (err) {
        await client.query('ROLLBACK');
        err.message = `更新品项状态失败: ${err.message}`;
        next(err);
    } finally {
        client.release();
    }
});
apiRouter.post('/orders/:orderId/claim', async (req, res, next) => {
    const { orderId } = req.params;
    const { id: userId, role } = req.user;
    logger.debug(`[/orders/${orderId}/claim] 使用者嘗試認領任務 - userId: ${userId}, role: ${role}`);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const orderResult = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
        if (orderResult.rows.length === 0) {
            logger.warn(`[/orders/${orderId}/claim] 錯誤: 找不到訂單`);
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
            return res.status(400).json({ message: `無法認領該任務，訂單狀態為「${order.status}」，可能已被他人處理。` });
        }
        await client.query('COMMIT');
        await logOperation(userId, orderId, 'claim', { new_status: newStatus });
        const updatedOrder = (await pool.query('SELECT o.*, u.name as current_user FROM orders o LEFT JOIN users u ON (CASE WHEN $1 = \'pick\' THEN o.picker_id WHEN $1 = \'pack\' THEN o.packer_id END) = u.id WHERE o.id = $2', [task_type, orderId])).rows[0];
        io.emit('task_claimed', { ...updatedOrder, task_type });
        res.status(200).json({ message: '任務認領成功' });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error(`[/orders/${orderId}/claim] 發生錯誤:`, error);
        next(error);
    } finally {
        client.release();
    }
});
apiRouter.get('/orders/:orderId', async (req, res) => {
    const { orderId } = req.params;
    const orderResult = await pool.query('SELECT o.*, p.name as picker_name, pk.name as packer_name FROM orders o LEFT JOIN users p ON o.picker_id = p.id LEFT JOIN users pk ON o.packer_id = pk.id WHERE o.id = $1;', [orderId]);
    if (orderResult.rows.length === 0) return res.status(404).json({ message: '找不到訂單' });
    const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
    const instancesResult = await pool.query('SELECT i.* FROM order_item_instances i JOIN order_items oi ON i.order_item_id = oi.id WHERE oi.order_id = $1 ORDER BY i.id', [orderId]);
    res.json({ order: orderResult.rows[0], items: itemsResult.rows, instances: instancesResult.rows });
});
apiRouter.patch('/orders/:orderId/void', authorizeAdmin, async (req, res) => {
    const { orderId } = req.params;
    const { reason } = req.body;
    const result = await pool.query("UPDATE orders SET status = 'voided', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING voucher_number", [orderId]);
    if (result.rowCount === 0) return res.status(404).json({ message: '找不到要作廢的訂單' });
    await logOperation(req.user.id, orderId, 'void', { reason });
    io.emit('task_status_changed', { orderId: parseInt(orderId, 10), newStatus: 'voided' });
    res.json({ message: `訂單 ${result.rows[0].voucher_number} 已成功作廢` });
});
apiRouter.delete('/orders/:orderId', authorizeAdmin, async (req, res) => {
    const { orderId } = req.params;
    const result = await pool.query('DELETE FROM orders WHERE id = $1 RETURNING voucher_number', [orderId]);
    if (result.rowCount === 0) return res.status(404).json({ message: '找不到要刪除的訂單' });
    io.emit('task_deleted', { orderId: parseInt(orderId, 10) });
    res.status(200).json({ message: `訂單 ${result.rows[0].voucher_number} 已被永久刪除` });
});
// #endregion

// =================================================================
// #region 路由注册 (Router Registration)
// =================================================================
logger.info('Registering routers');
// 重要: 公開路由必須先註冊,避免被認證中介軟體攔截
app.use('/', publicRouter);  // 根路由
app.use('/api/auth', authRouter);  // 認證路由 (公開,不需要 token) - 必須在 /api 之前註冊!
app.use('/api/admin', authenticateToken, authorizeAdmin, adminRouter);  // 管理員路由 (需要認證+授權)
app.use('/api', authenticateToken, apiRouter); // 其他 API 路由 (需要認證)
// #endregion

// =================================================================
// #region 统一错误处理 (Centralized Error Handling)
// =================================================================
app.use((err, req, res, next) => {
    logger.error('統一錯誤處理器捕獲到錯誤:\n', err);
    if (err.code === '23505') return res.status(409).json({ message: '操作失敗：資料重複。' + (err.detail || '') });
    const statusCode = err.status || 500;
    res.status(statusCode).json({ 
        message: err.message || '伺服器發生未知錯誤',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});
// #endregion

// =================================================================
// #region Socket.IO & 伺服器启动
// =================================================================
io.on('connection', (socket) => {
  logger.info('一個使用者已連線:', socket.id);
  socket.on('disconnect', () => {
    logger.info('使用者已離線:', socket.id);
  });
});

server.listen(port, () => {
    logger.info(`伺服器正在 http://localhost:${port} 上運行`);
});
// #endregion