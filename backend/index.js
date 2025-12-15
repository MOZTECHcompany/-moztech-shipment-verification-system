// =================================================================
// ⚠️ LEGACY BACKEND ENTRY (index.js)
// 此檔案已被模組化架構取代，正式啟動請使用 `src/server.js`。
// package.json 的預設 `start` / `dev` 均已指向新入口。
// 僅在需要回溯舊行為或緊急備援時使用 `npm run start:legacy`。
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
const rateLimit = require('express-rate-limit');
const logger = require('./utils/logger'); // 引入環境感知的 logger

// --- 环境设定 ---
require('dotenv').config();

// 安全性：JWT_SECRET 缺失時直接拒絕啟動（避免 token 可被偽造或驗證行為異常）
if (process.env.NODE_ENV !== 'test' && !process.env.JWT_SECRET) {
    logger.error('Missing required env: JWT_SECRET');
    throw new Error('Missing required env: JWT_SECRET');
}

// --- 应用程式与伺服器初始化 ---
const app = express();
const port = process.env.PORT || 3001;
const server = http.createServer(app);

// Render / reverse proxy 環境下，讓 req.ip 取到正確的 client IP
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

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
// 為每個請求產生 requestId，方便追蹤
app.use((req, res, next) => {
    try {
        const id = (require('crypto').randomUUID && require('crypto').randomUUID()) || Math.random().toString(36).slice(2);
        req.requestId = id;
        res.setHeader('X-Request-Id', id);
    } catch (e) {}
    next();
});
// =================================================================
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    logger.debugSensitive('[authenticateToken] Authorization header:', { authHeader });
    const token = authHeader && authHeader.split(' ')[1];
    logger.debugSensitive('[authenticateToken] Extracted token:', { token: token ? `${token.substring(0, 20)}...` : 'null' });
    if (!token) return res.status(401).json({ code: 'AUTH_MISSING_TOKEN', message: '未提供認證權杖 (Token)' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            logger.error('JWT 驗證失敗:', err.name, err.message);
            logger.debug('[authenticateToken] JWT_SECRET exists:', !!process.env.JWT_SECRET);
            return res.status(403).json({ code: 'AUTH_INVALID_TOKEN', message: '無效或過期的權杖' });
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
        return res.status(401).json({ code: 'AUTH_REQUIRED', message: '未認證的請求' });
    }
    if (req.user.role !== 'admin') {
        logger.error(`[authorizeAdmin] 權限不足 - role: ${req.user.role}`);
        return res.status(403).json({ code: 'FORBIDDEN', message: '權限不足，此操作需要管理員權限' });
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
const legacyLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
        const rawUsername = req.body && req.body.username ? String(req.body.username) : '';
        return `${req.ip}:${rawUsername.trim().toLowerCase()}`;
    },
    handler: (req, res) => {
        return res.status(429).json({ message: '嘗試次數過多，請稍後再試' });
    }
});

authRouter.post('/login', legacyLoginLimiter, async (req, res) => {
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

// --- 資料保留／清理觸發端點 ---
adminRouter.post('/maintenance/retention/run', async (req, res) => {
    const { logsDays, mentionsDays, readsDays, idleMinutes } = req.body || {};

    const LOGS_DAYS = Number.isFinite(+logsDays) ? Math.max(0, parseInt(logsDays, 10)) : parseInt(process.env.RETENTION_LOGS_DAYS || '180', 10);
    const MENTIONS_DAYS = Number.isFinite(+mentionsDays) ? Math.max(0, parseInt(mentionsDays, 10)) : parseInt(process.env.RETENTION_MENTIONS_DAYS || '30', 10);
    const READS_DAYS = Number.isFinite(+readsDays) ? Math.max(0, parseInt(readsDays, 10)) : parseInt(process.env.RETENTION_READS_DAYS || '90', 10);
    const IDLE_MINUTES = Number.isFinite(+idleMinutes) ? Math.max(0, parseInt(idleMinutes, 10)) : parseInt(process.env.RETENTION_IDLE_MINUTES || '10', 10);

    try {
        const sql = 'SELECT run_all_purge($1, $2, $3, $4) AS result';
        const { rows } = await pool.query(sql, [LOGS_DAYS, MENTIONS_DAYS, READS_DAYS, IDLE_MINUTES]);
        logger.info('Admin retention triggered (legacy index.js)', {
            by: (req.user && req.user.username) || 'unknown',
            result: rows[0]?.result
        });
        return res.json({
            success: true,
            params: { LOGS_DAYS, MENTIONS_DAYS, READS_DAYS, IDLE_MINUTES },
            result: rows[0]?.result
        });
    } catch (err) {
        logger.error('Admin retention failed (legacy index.js):', err);
        return res.status(500).json({ success: false, message: 'Retention failed', error: err.message });
    }
});

// --- 受保护的通用路由 (需要登入 Token) ---
const apiRouter = express.Router();
apiRouter.get('/tasks', async (req, res) => {
    try {
        const { id: userId, role } = req.user;
        logger.debug(`[/api/tasks] 使用者請求 - ID: ${userId}, 角色: ${role}`);
        if (!role) return res.status(403).json({ message: '使用者角色無效' });
        
        const query = `
            SELECT 
                o.id, o.voucher_number, o.customer_name, o.status, p.name as picker_name,
                (CASE WHEN o.status = 'picking' THEN picker_u.name WHEN o.status = 'packing' THEN packer_u.name ELSE NULL END) as current_user,
                (CASE WHEN o.status IN ('pending', 'picking') THEN 'pick' WHEN o.status IN ('picked', 'packing') THEN 'pack' END) as task_type,
                COALESCE(o.is_urgent, FALSE) as is_urgent,
                -- 評論統計
                COUNT(DISTINCT tc.id) as total_comments,
                COUNT(DISTINCT tc.id) FILTER (WHERE tc.priority = 'urgent') as urgent_comments,
                COUNT(DISTINCT CASE 
                    WHEN NOT EXISTS (
                        SELECT 1 FROM task_comment_reads tcr 
                        WHERE tcr.comment_id = tc.id AND tcr.user_id = $1
                    ) AND tc.user_id != $1
                    THEN tc.id 
                END) as unread_comments,
                -- 最新評論
                (SELECT json_build_object(
                    'content', tc2.content,
                    'user_name', u.name,
                    'priority', tc2.priority,
                    'created_at', tc2.created_at
                ) FROM task_comments tc2
                LEFT JOIN users u ON tc2.user_id = u.id
                WHERE tc2.order_id = o.id
                ORDER BY tc2.created_at DESC
                LIMIT 1) as latest_comment
            FROM orders o
            LEFT JOIN users p ON o.picker_id = p.id 
            LEFT JOIN users picker_u ON o.picker_id = picker_u.id 
            LEFT JOIN users packer_u ON o.packer_id = packer_u.id
            LEFT JOIN task_comments tc ON tc.order_id = o.id
            WHERE 
                ($2 = 'admin' AND o.status IN ('pending', 'picking', 'picked', 'packing')) OR
                ($2 = 'picker' AND (o.status = 'pending' OR (o.status = 'picking' AND o.picker_id = $1))) OR
                ($2 = 'packer' AND (o.status = 'picked' OR (o.status = 'packing' AND o.packer_id = $1)))
            GROUP BY o.id, o.voucher_number, o.customer_name, o.status, o.created_at, p.name, picker_u.name, packer_u.name
            ORDER BY 
                COUNT(DISTINCT tc.id) FILTER (WHERE tc.priority = 'urgent') DESC,
                COALESCE(o.is_urgent, FALSE) DESC, 
                o.created_at ASC;
        `;
        
        logger.debug(`[/api/tasks] 執行查詢，參數: userId=${userId}, role=${role}`);
        const result = await pool.query(query, [userId, role]);
        logger.info(`[/api/tasks] 查詢結果: 找到 ${result.rows.length} 筆任務`);
        if (result.rows.length > 0) {
            logger.debug(`[/api/tasks] 第一筆任務:`, JSON.stringify(result.rows[0]));
        }
        res.json(result.rows);
    } catch (error) {
        logger.error('[/api/tasks] 獲取任務失敗:', error);
        logger.error('[/api/tasks] 錯誤詳情:', {
            message: error.message,
            stack: error.stack,
            code: error.code
        });
        res.status(500).json({ 
            message: '獲取任務失敗', 
            error: error.message,
            hint: error.code === '42P01' ? '資料表不存在，請執行資料庫遷移' : undefined
        });
    }
});

// 提供基本使用者清單（非管理員也可存取）
apiRouter.get('/users/basic', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, name FROM users ORDER BY id ASC');
        res.json(result.rows);
    } catch (error) {
        logger.error('[/api/users/basic] 取得使用者清單失敗:', error);
        res.status(500).json({ message: '取得使用者清單失敗' });
    }
});

// 取得已完成任務（給前端 /tasks 已完成視圖使用）
// GET /api/tasks/completed?limit=200
apiRouter.get('/tasks/completed', async (req, res) => {
    try {
        const { id: userId, role } = req.user;
        if (!role) return res.status(403).json({ message: '使用者角色無效' });

        const parsedLimit = parseInt(req.query.limit || '50', 10);
        const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 50;

        let whereSql = '';
        if (role === 'admin') {
            // 管理員：可檢視所有「完成階段」訂單（已揀貨 / 裝箱中 / 已完成）
            whereSql = "o.status IN ('picked', 'packing', 'completed')";
        } else if (role === 'picker') {
            // 撿貨員：顯示自己處理過、且已撿貨後(含裝箱/完成)的訂單
            whereSql = "o.picker_id = $1 AND o.status IN ('picked', 'packing', 'completed')";
        } else if (role === 'packer') {
            // 裝箱員：顯示自己裝箱完成的訂單
            whereSql = "o.packer_id = $1 AND o.status = 'completed'";
        } else {
            return res.json([]);
        }

        const query = `
            SELECT 
                o.id,
                o.voucher_number,
                o.customer_name,
                o.status,
                p.name as picker_name,
                pk.name as packer_name,
                COALESCE(o.completed_at, o.updated_at) as completed_at,
                (CASE WHEN o.status = 'completed' THEN 'done' ELSE 'picked' END) as task_type,
                COALESCE(o.is_urgent, FALSE) as is_urgent,
                COUNT(DISTINCT tc.id) as total_comments,
                COUNT(DISTINCT tc.id) FILTER (WHERE tc.priority = 'urgent') as urgent_comments,
                COUNT(DISTINCT CASE 
                    WHEN NOT EXISTS (
                        SELECT 1 FROM task_comment_reads tcr 
                        WHERE tcr.comment_id = tc.id AND tcr.user_id = $1
                    ) AND tc.user_id != $1
                    THEN tc.id 
                END) as unread_comments,
                (SELECT json_build_object(
                    'content', tc2.content,
                    'user_name', u.name,
                    'priority', tc2.priority,
                    'created_at', tc2.created_at
                ) FROM task_comments tc2
                LEFT JOIN users u ON tc2.user_id = u.id
                WHERE tc2.order_id = o.id
                ORDER BY tc2.created_at DESC
                LIMIT 1) as latest_comment
            FROM orders o
            LEFT JOIN users p ON o.picker_id = p.id 
            LEFT JOIN users pk ON o.packer_id = pk.id
            LEFT JOIN task_comments tc ON tc.order_id = o.id
            WHERE ${whereSql}
            GROUP BY o.id, o.voucher_number, o.customer_name, o.status, o.completed_at, o.updated_at, p.name, pk.name
            ORDER BY COALESCE(o.completed_at, o.updated_at) DESC
            LIMIT $2;
        `;

        logger.debug(`[/api/tasks/completed] 執行查詢，參數: userId=${userId}, role=${role}, limit=${limit}`);
        const result = await pool.query(query, [userId, limit]);
        res.json(result.rows);
    } catch (error) {
        logger.error('[/api/tasks/completed] 獲取已完成任務失敗:', error);
        res.status(500).json({ message: '獲取已完成任務失敗' });
    }
});

// 批次操作端點
apiRouter.post('/orders/batch-claim', async (req, res) => {
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
            if (itemResult.rows.length === 0) {
                // 記錄刷錯條碼的操作
                await logOperation(userId, orderId, 'scan_error', { 
                    scanValue, 
                    type, 
                    reason: '條碼不屬於此訂單或該品項需要掃描 SN 碼' 
                });
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
                const qty = Number(item.quantity ?? 0);
                const pickedQty = Number(item.picked_quantity ?? 0);
                const packedQty = Number(item.packed_quantity ?? 0);

                if (pickedQty < qty) allPicked = false; 
                const requiredPackQty = Math.min(qty, pickedQty);
                if (packedQty < requiredPackQty) allPacked = false; 
            } 
        }
        let statusChanged = false, finalStatus = order.status;
        if (allPacked && order.status !== 'completed') { 
            finalStatus = 'completed'; 
            statusChanged = true; 
            await pool.query(`UPDATE orders SET status = 'completed', completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [orderId]); 
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
apiRouter.get('/orders/:orderId', async (req, res, next) => {
    const { orderId } = req.params;
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
        const instancesResult = await client.query('SELECT i.* FROM order_item_instances i JOIN order_items oi ON i.order_item_id = oi.id WHERE oi.order_id = $1 ORDER BY i.id', [orderId]);

        let allPicked = true, allPacked = true;
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
                "UPDATE orders SET status = 'completed', completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = $1",
                [orderId]
            );
        } else if (allPicked && order.status === 'picking') {
            newStatus = 'picked';
            statusChanged = true;
            await client.query("UPDATE orders SET status = 'picked', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [orderId]);
        }

        await client.query('COMMIT');
        if (statusChanged) io.emit('task_status_changed', { orderId: parseInt(orderId, 10), newStatus });

        const refreshedOrder = await pool.query('SELECT o.*, p.name as picker_name, pk.name as packer_name FROM orders o LEFT JOIN users p ON o.picker_id = p.id LEFT JOIN users pk ON o.packer_id = pk.id WHERE o.id = $1;', [orderId]);
        const refreshedItems = await pool.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
        const refreshedInstances = await pool.query('SELECT i.* FROM order_item_instances i JOIN order_items oi ON i.order_item_id = oi.id WHERE oi.order_id = $1 ORDER BY i.id', [orderId]);
        res.json({ order: refreshedOrder.rows[0], items: refreshedItems.rows, instances: refreshedInstances.rows });
    } catch (error) {
        await client.query('ROLLBACK');
        next(error);
    } finally {
        client.release();
    }
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
apiRouter.patch('/orders/:orderId/urgent', authorizeAdmin, async (req, res) => {
    const { orderId } = req.params;
    const { isUrgent } = req.body;
    
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
        
        const order = result.rows[0];
        await logOperation(req.user.id, orderId, 'set_urgent', { is_urgent: isUrgent });
        
        // 即時通知所有用戶更新任務列表
        io.emit('task_urgent_changed', { 
            orderId: parseInt(orderId, 10), 
            isUrgent: isUrgent,
            voucherNumber: order.voucher_number
        });
        
        logger.info(`[/api/orders/${orderId}/urgent] 訂單 ${order.voucher_number} 緊急狀態已更新為: ${isUrgent}`);
        res.json({ 
            message: `訂單 ${order.voucher_number} 已${isUrgent ? '標記為緊急' : '取消緊急標記'}`,
            order
        });
    } catch (error) {
        logger.error(`[/api/orders/${orderId}/urgent] 更新失敗:`, error);
        res.status(500).json({ message: '更新緊急狀態失敗' });
    }
});
apiRouter.delete('/orders/:orderId', authorizeAdmin, async (req, res) => {
    const { orderId } = req.params;
    const result = await pool.query('DELETE FROM orders WHERE id = $1 RETURNING voucher_number', [orderId]);
    if (result.rowCount === 0) return res.status(404).json({ message: '找不到要刪除的訂單' });
    io.emit('task_deleted', { orderId: parseInt(orderId, 10) });
    res.status(200).json({ message: `訂單 ${result.rows[0].voucher_number} 已被永久刪除` });
});

// 📊 數據分析 API
apiRouter.get('/analytics', authorizeAdmin, async (req, res) => {
    const { range = '7days' } = req.query;
    
    // 計算日期範圍
    const daysMap = { '7days': 7, '30days': 30, '90days': 90 };
    const days = daysMap[range] || 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    try {
        // 1. 總覽數據
        const overviewQuery = await pool.query(`
            SELECT 
                COUNT(*) as total_orders,
                COUNT(*) FILTER (WHERE status = 'completed') as completed_orders,
                COUNT(*) FILTER (WHERE status = 'voided') as voided_orders,
                AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/60) FILTER (WHERE status = 'picking' OR status = 'packing' OR status = 'completed') as avg_processing_time
            FROM orders
            WHERE created_at >= $1
        `, [startDate]);

        // 2. 員工績效排行
        const userPerformanceQuery = await pool.query(`
            SELECT 
                u.id as user_id,
                u.name as user_name,
                u.role,
                COUNT(DISTINCT ol.order_id) as completed_orders,
                AVG(EXTRACT(EPOCH FROM (o.updated_at - o.created_at))/60) as avg_time
            FROM users u
            LEFT JOIN operation_logs ol ON u.id = ol.user_id
            LEFT JOIN orders o ON ol.order_id = o.id
            WHERE ol.created_at >= $1 AND ol.action_type IN ('pick', 'pack', 'complete')
            GROUP BY u.id, u.name, u.role
            HAVING COUNT(DISTINCT ol.order_id) > 0
            ORDER BY completed_orders DESC
            LIMIT 20
        `, [startDate]);

        // 3. 熱門商品
        const topProductsQuery = await pool.query(`
            SELECT 
                oi.product_name,
                oi.barcode,
                oi.product_code,
                SUM(oi.quantity) as total_quantity,
                COUNT(DISTINCT oi.order_id) as order_count
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.id
            WHERE o.created_at >= $1
            GROUP BY oi.product_name, oi.barcode, oi.product_code
            ORDER BY total_quantity DESC
            LIMIT 20
        `, [startDate]);

        // 4. 訂單趨勢 (每日統計)
        const orderTrendsQuery = await pool.query(`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'completed') as completed,
                COUNT(*) FILTER (WHERE status = 'voided') as voided
            FROM orders
            WHERE created_at >= $1
            GROUP BY DATE(created_at)
            ORDER BY date DESC
        `, [startDate]);

        const overview = overviewQuery.rows[0];
        
        res.json({
            overview: {
                totalOrders: parseInt(overview.total_orders),
                completedOrders: parseInt(overview.completed_orders),
                voidedOrders: parseInt(overview.voided_orders),
                avgPickingTime: parseFloat(overview.avg_processing_time) * 0.4 || 0, // 估計揀貨佔 40%
                avgPackingTime: parseFloat(overview.avg_processing_time) * 0.3 || 0, // 估計裝箱佔 30%
                errorRate: parseInt(overview.voided_orders) / parseInt(overview.total_orders) || 0
            },
            userPerformance: userPerformanceQuery.rows,
            topProducts: topProductsQuery.rows,
            orderTrends: orderTrendsQuery.rows
        });
        
        logger.info(`[/api/analytics] 成功返回 ${range} 分析數據`);
    } catch (error) {
        logger.error('[/api/analytics] 查詢失敗:', error);
        res.status(500).json({ message: '獲取分析數據失敗' });
    }
});

// ⚡ 批次操作 API
apiRouter.post('/orders/batch/claim', async (req, res) => {
    const { orderIds } = req.body;
    const { id: userId, role } = req.user;
    
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
                    await logOperation(userId, orderId, 'claim', { previous_status: 'pending', new_status: 'picking' });
                    io.emit('task_status_changed', { orderId, newStatus: 'picking' });
                    results.success.push(orderId);
                } else if (order.status === 'picking' && (role === 'packer' || role === 'admin')) {
                    await pool.query(
                        "UPDATE orders SET status = 'packing', packer_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
                        [userId, orderId]
                    );
                    await logOperation(userId, orderId, 'claim', { previous_status: 'picking', new_status: 'packing' });
                    io.emit('task_status_changed', { orderId, newStatus: 'packing' });
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

// 📋 刷錯條碼記錄查詢 API
apiRouter.get('/scan-errors', authorizeAdmin, async (req, res) => {
    const { startDate, endDate, limit = 50 } = req.query;
    
    try {
        let query = `
            SELECT 
                ol.id,
                ol.created_at,
                ol.action_type,
                ol.details,
                u.name as user_name,
                u.role as user_role,
                o.voucher_number,
                o.customer_name
            FROM operation_logs ol
            JOIN users u ON ol.user_id = u.id
            LEFT JOIN orders o ON ol.order_id = o.id
            WHERE ol.action_type = 'scan_error'
        `;
        
        const params = [];
        let paramCount = 1;
        
        if (startDate) {
            query += ` AND ol.created_at >= $${paramCount}`;
            params.push(startDate);
            paramCount++;
        }
        
        if (endDate) {
            query += ` AND ol.created_at <= $${paramCount}`;
            params.push(endDate);
            paramCount++;
        }
        
        query += ` ORDER BY ol.created_at DESC LIMIT $${paramCount}`;
        params.push(parseInt(limit));
        
        const result = await pool.query(query, params);
        
        res.json({
            total: result.rows.length,
            errors: result.rows
        });
    } catch (error) {
        logger.error('[/api/scan-errors] 查詢失敗:', error);
        res.status(500).json({ message: '查詢刷錯記錄失敗' });
    }
});

// =================================================================
// #region 協作功能 API (Collaboration Features)
// =================================================================

// 獲取任務評論（支援分頁與 ETag）
apiRouter.get('/tasks/:orderId/comments', async (req, res) => {
    const { orderId } = req.params;
    const { after, limit } = req.query;
    const pageSize = Math.min(Math.max(parseInt(limit || '50', 10), 1), 200);
    const client = await pool.connect();
    try {
        // 先計算資源摘要，若 ETag 相同則回 304（包含使用者的未讀提及數，讓讀取狀態也影響 ETag）
        const agg = await client.query(
            `SELECT COUNT(*)::int AS total, MAX(updated_at) AS latest FROM task_comments WHERE order_id = $1`,
            [orderId]
        );
        const total = agg.rows[0]?.total || 0;
        const latest = agg.rows[0]?.latest || null;
        const unreadAgg = await client.query(
            `SELECT COUNT(*)::int AS unread
               FROM task_mentions tm
               JOIN task_comments c ON c.id = tm.comment_id
              WHERE c.order_id = $1 AND tm.mentioned_user_id = $2 AND tm.is_read = FALSE`,
            [orderId, req.user.id]
        );
        const unreadMentions = unreadAgg.rows[0]?.unread || 0;
        const etag = `W/"comments:${orderId}:u${req.user.id}:${total}:${latest ? new Date(latest).getTime() : 0}:unread:${unreadMentions}"`;
        res.setHeader('ETag', etag);

        const ifNoneMatch = req.headers['if-none-match'];
        if (ifNoneMatch && ifNoneMatch === etag && !after) {
            return res.status(304).end();
        }

        // 主要查詢：依 created_at 遞增，支援 after 游標（ISO 時間）
        // 構建參數順序：$1=orderId, $2(可選)=after, $X=userId, $Y=limit
        const params = [orderId];
        let where = 'c.order_id = $1';
        if (after) {
            const afterDate = new Date(after);
            if (!isNaN(afterDate.getTime())) {
                params.push(afterDate);
                where += ` AND c.created_at > $${params.length}`;
            }
        }
        const userParamIndex = params.length + 1;
        params.push(req.user.id);
        const limitParamIndex = params.length + 1;
        params.push(pageSize);

        const comments = await client.query(
            `SELECT 
                c.id,
                c.content,
                c.parent_id,
                c.priority,
                c.created_at,
                c.updated_at,
                u.id as user_id,
                u.username,
                u.name as user_name,
                (tm.id IS NOT NULL) AS mentioned_me,
                COALESCE(tm.is_read, FALSE) AS mention_is_read
            FROM task_comments c
            LEFT JOIN users u ON c.user_id = u.id
            LEFT JOIN task_mentions tm 
              ON tm.comment_id = c.id 
             AND tm.mentioned_user_id = $${userParamIndex}
            WHERE ${where}
            ORDER BY c.created_at ASC
            LIMIT $${limitParamIndex}
            `,
            params
        );

        // 直接回傳平坦列表，讓前端自行處理顯示邏輯（現代化聊天室風格）
        // 舊有的樹狀結構邏輯會導致回覆被隱藏在 replies 屬性中，而前端只渲染 items
        const flatComments = comments.rows;

        const nextCursor = comments.rows.length > 0
            ? comments.rows[comments.rows.length - 1].created_at
            : null;

        res.json({ items: flatComments, nextCursor, total, unreadMentions });
    } catch (error) {
        logger.error('[/api/tasks/:orderId/comments] 獲取評論失敗:', error);
        res.status(500).json({ code: 'COMMENTS_FETCH_FAILED', message: '獲取評論失敗', requestId: req.requestId });
    } finally {
        client.release();
    }
});

// 新增評論
// 簡易速率限制（每使用者每分鐘最多 20 次建立、5 次撤回/刪除）
const _rateMap = new Map();
function rateLimit(key, limit, windowMs = 60_000) {
    const now = Date.now();
    const rec = _rateMap.get(key) || { count: 0, windowStart: now };
    if (now - rec.windowStart > windowMs) { rec.count = 0; rec.windowStart = now; }
    rec.count++;
    _rateMap.set(key, rec);
    return rec.count <= limit;
}

apiRouter.post('/tasks/:orderId/comments', async (req, res) => {
    const { orderId } = req.params;
    const { content, parent_id, priority = 'normal' } = req.body;
    const { id: userId } = req.user;
    
    if (!content || !content.trim()) {
        return res.status(400).json({ code: 'VALIDATION_ERROR', message: '評論內容不能為空', requestId: req.requestId });
    }
    if (content.length > 2000) {
        return res.status(413).json({ code: 'CONTENT_TOO_LONG', message: '評論內容過長（最大 2000 字）', requestId: req.requestId });
    }
    if (!rateLimit(`comment:create:${userId}`, 20)) {
        return res.status(429).json({ code: 'RATE_LIMITED', message: '發送太頻繁，請稍後再試', requestId: req.requestId });
    }

    // 驗證優先級
    const validPriorities = ['normal', 'important', 'urgent'];
    if (!validPriorities.includes(priority)) {
        return res.status(400).json({ code: 'INVALID_PRIORITY', message: '無效的優先級', requestId: req.requestId });
    }
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 確認訂單存在
        const orderExist = await client.query('SELECT id FROM orders WHERE id = $1', [orderId]);
        if (orderExist.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ code: 'ORDER_NOT_FOUND', message: '找不到指定的訂單', requestId: req.requestId });
        }
        
        // 新增評論
        const result = await client.query(`
            INSERT INTO task_comments (order_id, user_id, content, parent_id, priority)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, created_at
        `, [orderId, userId, content, parent_id, priority]);
        
        const commentId = result.rows[0].id;
        
        // 檢測 @ 提及（支援常見字元並忽略大小寫比對）
        // 允許字元: 英數、底線、點、連字號
        const mentionRegex = /@([A-Za-z0-9._-]+)/g;
        const mentions = content.match(mentionRegex);
        
        if (mentions) {
            const usernames = [...new Set(mentions.map(m => m.slice(1)))];
            
            for (const username of usernames) {
                const userResult = await client.query(
                    'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
                    [username]
                );
                
                if (userResult.rows.length > 0) {
                    await client.query(`
                        INSERT INTO task_mentions (comment_id, mentioned_user_id)
                        VALUES ($1, $2)
                    `, [commentId, userResult.rows[0].id]);
                    
                    // 發送即時通知
                    io.emit('new_mention', {
                        userId: userResult.rows[0].id,
                        orderId,
                        commentId,
                        content: content.slice(0, 100),
                        priority
                    });
                }
            }
        }
        
        await client.query('COMMIT');
        
        // 廣播新評論
        io.emit('new_comment', {
            orderId,
            commentId,
            userId,
            content,
            priority
        });
        
        res.status(201).json({
            message: '評論已發送',
            id: commentId,
            created_at: result.rows[0].created_at
        });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('[/api/tasks/:orderId/comments] 新增評論失敗:', error);
        // 42703: undefined_column（多半是資料庫尚未加入 priority 欄位）
        if (error && (error.code === '42703' || /column\s+"?priority"?/i.test(error.message || ''))) {
            return res.status(500).json({
                message: '發送評論失敗：資料庫缺少 task_comments.priority 欄位，請先執行遷移。',
                code: 'SCHEMA_MISSING_COLUMN',
                hint: '請以管理員身份呼叫 /api/admin/migrate/add-priority 或使用前端 migrate.html 執行遷移',
                requestId: req.requestId
            });
        }
        res.status(500).json({ code: 'COMMENTS_CREATE_FAILED', message: '發送評論失敗', requestId: req.requestId });
    } finally {
        client.release();
    }
});

// 撤回評論（作者或管理員）- 將內容替換為已撤回占位。
apiRouter.patch('/tasks/:orderId/comments/:commentId/retract', async (req, res) => {
    const { orderId, commentId } = req.params;
    const requester = req.user;
    if (!rateLimit(`comment:retract:${requester.id}`, 5)) {
        return res.status(429).json({ code: 'RATE_LIMITED', message: '操作太頻繁，請稍後再試', requestId: req.requestId });
    }
    try {
        const info = await pool.query('SELECT user_id FROM task_comments WHERE id = $1 AND order_id = $2', [commentId, orderId]);
        if (info.rowCount === 0) return res.status(404).json({ code: 'COMMENT_NOT_FOUND', message: '找不到評論', requestId: req.requestId });
        const ownerId = info.rows[0].user_id;
        const isOwner = Number(ownerId) === Number(requester.id);
        const isAdmin = String(requester.role || '').toLowerCase() === 'admin';
        if (!isOwner && !isAdmin) return res.status(403).json({ code: 'FORBIDDEN', message: '無權撤回此評論', requestId: req.requestId });

        await pool.query('UPDATE task_comments SET content = $1, updated_at = NOW() WHERE id = $2', ['[已撤回]', commentId]);

        io.emit('comment_retracted', { orderId, commentId });
        res.json({ message: '評論已撤回' });
    } catch (error) {
        logger.error('[/api/tasks/:orderId/comments/:commentId/retract] 失敗:', error);
        res.status(500).json({ code: 'COMMENTS_RETRACT_FAILED', message: '撤回評論失敗', requestId: req.requestId });
    }
});

// 標記某條提及為已讀（當前使用者）
apiRouter.patch('/tasks/:orderId/mentions/:commentId/read', async (req, res) => {
    const { orderId, commentId } = req.params;
    const userId = req.user.id;
    try {
        // 確認評論屬於該訂單
        const chk = await pool.query('SELECT 1 FROM task_comments WHERE id = $1 AND order_id = $2', [commentId, orderId]);
        if (chk.rowCount === 0) return res.status(404).json({ code: 'COMMENT_NOT_FOUND', message: '找不到評論', requestId: req.requestId });
        const result = await pool.query(
            `UPDATE task_mentions SET is_read = TRUE 
              WHERE comment_id = $1 AND mentioned_user_id = $2`,
            [commentId, userId]
        );
        res.json({ message: '已標記為已讀', updated: result.rowCount });
    } catch (error) {
        logger.error('[/api/tasks/:orderId/mentions/:commentId/read] 標記已讀失敗:', error);
        res.status(500).json({ code: 'MENTION_MARK_READ_FAILED', message: '標記提及為已讀失敗', requestId: req.requestId });
    }
});

// 標記評論為已讀
apiRouter.post('/tasks/:orderId/comments/:commentId/read', async (req, res) => {
    const { orderId, commentId } = req.params;
    const userId = req.user.id;
    
    try {
        // 確認評論存在
        const chk = await pool.query('SELECT 1 FROM task_comments WHERE id = $1 AND order_id = $2', [commentId, orderId]);
        if (chk.rowCount === 0) {
            return res.status(404).json({ message: '找不到評論' });
        }
        
        // 插入或更新已讀記錄
        await pool.query(`
            INSERT INTO task_comment_reads (comment_id, user_id, read_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (comment_id, user_id) 
            DO UPDATE SET read_at = NOW()
        `, [commentId, userId]);
        
        res.json({ message: '已標記為已讀' });
    } catch (error) {
        logger.error('[/api/tasks/:orderId/comments/:commentId/read] 標記已讀失敗:', error);
        res.status(500).json({ message: '標記已讀失敗' });
    }
});

// 批次標記訂單所有評論為已讀
apiRouter.post('/tasks/:orderId/comments/mark-all-read', async (req, res) => {
    const { orderId } = req.params;
    const userId = req.user.id;
    
    try {
        // 獲取該訂單所有評論 ID
        const comments = await pool.query(
            'SELECT id FROM task_comments WHERE order_id = $1',
            [orderId]
        );
        
        if (comments.rows.length === 0) {
            return res.json({ message: '沒有評論需要標記', count: 0 });
        }
        
        // 批次插入已讀記錄
        const values = comments.rows.map((c, idx) => 
            `($${idx * 2 + 1}, $${idx * 2 + 2}, NOW())`
        ).join(',');
        
        const params = comments.rows.flatMap(c => [c.id, userId]);
        
        await pool.query(`
            INSERT INTO task_comment_reads (comment_id, user_id, read_at)
            VALUES ${values}
            ON CONFLICT (comment_id, user_id) 
            DO UPDATE SET read_at = NOW()
        `, params);
        
        res.json({ 
            message: `已標記 ${comments.rows.length} 則評論為已讀`,
            count: comments.rows.length 
        });
    } catch (error) {
        logger.error('[/api/tasks/:orderId/comments/mark-all-read] 批次標記已讀失敗:', error);
        res.status(500).json({ message: '批次標記已讀失敗' });
    }
});

// 獲取用戶的所有未讀評論統計
apiRouter.get('/comments/unread-summary', async (req, res) => {
    const userId = req.user.id;
    
    try {
        const result = await pool.query(`
            SELECT 
                o.id as order_id,
                o.voucher_number,
                o.customer_name,
                COUNT(DISTINCT tc.id) as unread_count,
                COUNT(DISTINCT tc.id) FILTER (WHERE tc.priority = 'urgent') as urgent_count,
                MAX(tc.created_at) as latest_comment_time
            FROM orders o
            INNER JOIN task_comments tc ON tc.order_id = o.id
            WHERE NOT EXISTS (
                SELECT 1 FROM task_comment_reads tcr 
                WHERE tcr.comment_id = tc.id AND tcr.user_id = $1
            )
            AND tc.user_id != $1
            AND o.status IN ('pending', 'picking', 'picked', 'packing')
            GROUP BY o.id, o.voucher_number, o.customer_name
            HAVING COUNT(DISTINCT tc.id) > 0
            ORDER BY 
                COUNT(DISTINCT tc.id) FILTER (WHERE tc.priority = 'urgent') DESC,
                MAX(tc.created_at) DESC
        `, [userId]);
        
        const totalUnread = result.rows.reduce((sum, row) => sum + parseInt(row.unread_count), 0);
        const totalUrgent = result.rows.reduce((sum, row) => sum + parseInt(row.urgent_count), 0);
        
        res.json({
            total_unread: totalUnread,
            total_urgent: totalUrgent,
            orders: result.rows
        });
    } catch (error) {
        logger.error('[/api/comments/unread-summary] 獲取未讀統計失敗:', error);
        res.status(500).json({ message: '獲取未讀統計失敗' });
    }
});

// 取得當前使用者在此訂單的提及列表（預設未讀）
apiRouter.get('/tasks/:orderId/mentions', async (req, res) => {
    const { orderId } = req.params;
    const { status = 'unread', limit = 20 } = req.query;
    const pageSize = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    try {
        const rows = await pool.query(
            `SELECT tm.comment_id, tm.is_read, tm.created_at,
                    c.content, c.created_at AS comment_created_at,
                    u.username
               FROM task_mentions tm
               JOIN task_comments c ON c.id = tm.comment_id
               JOIN users u ON c.user_id = u.id
              WHERE c.order_id = $1 AND tm.mentioned_user_id = $2
                ${status === 'unread' ? 'AND tm.is_read = FALSE' : ''}
              ORDER BY tm.created_at DESC
              LIMIT $3`,
            [orderId, req.user.id, pageSize]
        );
        res.json({ items: rows.rows, total: rows.rows.length });
    } catch (error) {
        logger.error('[/api/tasks/:orderId/mentions] 取得提及列表失敗:', error);
        res.status(500).json({ code: 'MENTIONS_LIST_FAILED', message: '取得提及列表失敗', requestId: req.requestId });
    }
});

// 置頂雲端化：使用者對評論的置頂狀態
async function ensurePinsTable(client) {
    await client.query(`CREATE TABLE IF NOT EXISTS task_comment_pins (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        comment_id INTEGER NOT NULL REFERENCES task_comments(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(order_id, user_id, comment_id)
    )`);
}

// 任務置頂（團隊共享）
async function ensureTaskPinsTable(client) {
    await client.query(`CREATE TABLE IF NOT EXISTS task_pins (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE UNIQUE,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
}

// 取得所有置頂任務（團隊共享）
apiRouter.get('/tasks/pins', async (req, res) => {
    const client = await pool.connect();
    try {
        await ensureTaskPinsTable(client);
        const rows = await client.query('SELECT order_id FROM task_pins');
        res.json({ pinned: rows.rows.map(r => r.order_id) });
    } catch (e) {
        logger.error('[/api/tasks/pins] 取得置頂任務失敗:', e);
        res.status(500).json({ message: '取得置頂任務失敗' });
    } finally { client.release(); }
});

// 設定/取消任務置頂（團隊共享）
apiRouter.put('/tasks/pins/:orderId', authorizeAdmin, async (req, res) => {
    const { orderId } = req.params;
    const { pinned } = req.body; // true/false
    const userId = req.user?.id || null;
    const client = await pool.connect();
    try {
        await ensureTaskPinsTable(client);
        if (pinned) {
            await client.query('INSERT INTO task_pins (order_id, created_by) VALUES ($1, $2) ON CONFLICT (order_id) DO NOTHING', [orderId, userId]);
        } else {
            await client.query('DELETE FROM task_pins WHERE order_id = $1', [orderId]);
        }
        try { io.emit('task_pin_changed', { orderId: Number(orderId), pinned: !!pinned }); } catch (e) {}
        res.json({ success: true });
    } catch (e) {
        logger.error('[/api/tasks/pins/:orderId] 更新任務置頂失敗:', e);
        res.status(500).json({ message: '更新置頂狀態失敗' });
    } finally { client.release(); }
});

// 取得置頂清單
apiRouter.get('/tasks/:orderId/pins', async (req, res) => {
    const { orderId } = req.params;
    const userId = req.user.id;
    const client = await pool.connect();
    try {
        await ensurePinsTable(client);
        const rows = await client.query(`
            SELECT c.*, u.name as user_name, u.username
            FROM task_comment_pins p
            JOIN task_comments c ON p.comment_id = c.id
            LEFT JOIN users u ON c.user_id = u.id
            WHERE p.order_id = $1 AND p.user_id = $2
            ORDER BY c.created_at ASC
        `, [orderId, userId]);
        res.json({ pinned: rows.rows });
    } catch (e) {
        logger.error('[/api/tasks/:orderId/pins] 取得置頂清單失敗:', e);
        res.status(500).json({ message: '取得置頂清單失敗' });
    } finally { client.release(); }
});

// 設定/取消置頂
apiRouter.put('/tasks/:orderId/pins/:commentId', async (req, res) => {
    const { orderId, commentId } = req.params;
    const { pinned } = req.body; // true/false
    const userId = req.user.id;
    const client = await pool.connect();
    try {
        await ensurePinsTable(client);
        if (pinned) {
            await client.query('INSERT INTO task_comment_pins (order_id, user_id, comment_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [orderId, userId, commentId]);
        } else {
            await client.query('DELETE FROM task_comment_pins WHERE order_id = $1 AND user_id = $2 AND comment_id = $3', [orderId, userId, commentId]);
        }
        res.json({ success: true });
    } catch (e) {
        logger.error('[/api/tasks/:orderId/pins/:commentId] 更新置頂失敗:', e);
        res.status(500).json({ message: '更新置頂狀態失敗' });
    } finally { client.release(); }
});

// 刪除評論（作者或管理員）。若為父評論，回覆會因外鍵設定而一併刪除。
apiRouter.delete('/tasks/:orderId/comments/:commentId', async (req, res) => {
    const { orderId, commentId } = req.params;
    const requester = req.user;
    if (!rateLimit(`comment:delete:${requester.id}`, 5)) {
        return res.status(429).json({ code: 'RATE_LIMITED', message: '操作太頻繁，請稍後再試', requestId: req.requestId });
    }
    try {
        const info = await pool.query('SELECT user_id FROM task_comments WHERE id = $1 AND order_id = $2', [commentId, orderId]);
        if (info.rowCount === 0) return res.status(404).json({ code: 'COMMENT_NOT_FOUND', message: '找不到評論', requestId: req.requestId });
        const ownerId = info.rows[0].user_id;
        const isOwner = Number(ownerId) === Number(requester.id);
        const isAdmin = String(requester.role || '').toLowerCase() === 'admin';
        if (!isOwner && !isAdmin) return res.status(403).json({ code: 'FORBIDDEN', message: '無權刪除此評論', requestId: req.requestId });

        await pool.query('DELETE FROM task_comments WHERE id = $1', [commentId]);

        io.emit('comment_deleted', { orderId, commentId });
        res.json({ message: '評論已刪除' });
    } catch (error) {
        logger.error('[/api/tasks/:orderId/comments/:commentId] 刪除失敗:', error);
        res.status(500).json({ code: 'COMMENTS_DELETE_FAILED', message: '刪除評論失敗', requestId: req.requestId });
    }
});

// 更新活動會話（即時協作指示器）
apiRouter.post('/tasks/:orderId/session', async (req, res) => {
    const { orderId } = req.params;
    const { session_type } = req.body; // 'viewing' 或 'editing'
    const { id: userId } = req.user;
    
    try {
        await pool.query(`
            INSERT INTO active_sessions (order_id, user_id, session_type, last_activity)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            ON CONFLICT (order_id, user_id, session_type)
            DO UPDATE SET last_activity = CURRENT_TIMESTAMP
        `, [orderId, userId, session_type || 'viewing']);
        
        // 廣播活動狀態
        const activeSessions = await pool.query(`
            SELECT 
                s.user_id,
                s.session_type,
                s.last_activity,
                u.username,
                u.name
            FROM active_sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.order_id = $1 
            AND s.last_activity > NOW() - INTERVAL '5 minutes'
        `, [orderId]);
        
        io.emit('active_sessions_update', {
            orderId,
            sessions: activeSessions.rows
        });
        
        res.json({ message: '會話已更新' });
    } catch (error) {
        logger.error('[/api/tasks/:orderId/session] 更新會話失敗:', error);
        res.status(500).json({ message: '更新會話失敗' });
    }
});

// 獲取活動會話
apiRouter.get('/tasks/:orderId/sessions', async (req, res) => {
    const { orderId } = req.params;
    
    try {
        const result = await pool.query(`
            SELECT 
                s.user_id,
                s.session_type,
                s.last_activity,
                u.username,
                u.name
            FROM active_sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.order_id = $1 
            AND s.last_activity > NOW() - INTERVAL '5 minutes'
            ORDER BY s.last_activity DESC
        `, [orderId]);
        
        res.json(result.rows);
    } catch (error) {
        logger.error('[/api/tasks/:orderId/sessions] 獲取會話失敗:', error);
        res.status(500).json({ message: '獲取會話失敗' });
    }
});

// 任務交接
apiRouter.post('/tasks/:orderId/transfer', async (req, res) => {
    const { orderId } = req.params;
    const { to_user_id, task_type, reason } = req.body;
    const { id: fromUserId } = req.user;
    
    if (!to_user_id || !task_type) {
        return res.status(400).json({ message: '缺少必要參數' });
    }
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 記錄交接
        await client.query(`
            INSERT INTO task_assignments (order_id, from_user_id, to_user_id, task_type, reason)
            VALUES ($1, $2, $3, $4, $5)
        `, [orderId, fromUserId, to_user_id, task_type, reason]);
        
        // 更新訂單的操作員
        if (task_type === 'pick') {
            await client.query(
                'UPDATE orders SET picker_id = $1 WHERE id = $2',
                [to_user_id, orderId]
            );
        } else if (task_type === 'pack') {
            await client.query(
                'UPDATE orders SET packer_id = $1 WHERE id = $2',
                [to_user_id, orderId]
            );
        }
        
        await client.query('COMMIT');
        
        // 記錄操作日誌
        await logOperation(fromUserId, orderId, 'transfer', {
            to_user_id,
            task_type,
            reason
        });
        
        // 廣播任務轉移
        io.emit('task_transferred', {
            orderId,
            from_user_id: fromUserId,
            to_user_id,
            task_type
        });
        
        res.json({ message: '任務已成功轉移' });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('[/api/tasks/:orderId/transfer] 任務轉移失敗:', error);
        res.status(500).json({ message: '任務轉移失敗' });
    } finally {
        client.release();
    }
});

// 資料庫遷移 API（臨時無權限檢查版本 - 測試用）
apiRouter.post('/migrate/add-priority-test', async (req, res) => {
    const client = await pool.connect();
    try {
        logger.info('[Migration TEST] 開始添加 priority 欄位...');
        
        // 檢查欄位是否存在
        const checkColumn = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'task_comments' AND column_name = 'priority'
        `);
        
        if (checkColumn.rows.length > 0) {
            logger.info('[Migration TEST] priority 欄位已存在');
            return res.json({ 
                success: true, 
                message: 'priority 欄位已存在，無需添加',
                alreadyExists: true
            });
        }
        
        await client.query('BEGIN');
        
        // 添加欄位
        await client.query(`
            ALTER TABLE task_comments 
            ADD COLUMN priority VARCHAR(20) DEFAULT 'normal'
        `);
        logger.info('[Migration TEST] priority 欄位添加成功');
        
        // 添加檢查約束（如果不存在）
        await client.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'check_priority'
                ) THEN
                    ALTER TABLE task_comments 
                    ADD CONSTRAINT check_priority 
                    CHECK (priority IN ('normal', 'important', 'urgent'));
                END IF;
            END $$;
        `);
        logger.info('[Migration TEST] 優先級約束添加成功');
        
        // 創建索引
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_task_comments_priority 
            ON task_comments(priority)
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_task_comments_order_priority 
            ON task_comments(order_id, priority)
        `);
        logger.info('[Migration TEST] 索引創建成功');
        
        await client.query('COMMIT');
        
        // 統計資訊
        const stats = await client.query('SELECT COUNT(*) as count FROM task_comments');
        
        logger.info(`[Migration TEST] 資料庫更新完成，評論總數: ${stats.rows[0].count}`);
        
        res.json({ 
            success: true, 
            message: '資料庫遷移成功（測試端點）',
            totalComments: stats.rows[0].count,
            alreadyExists: false
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('[Migration TEST] 執行失敗:', error);
        res.status(500).json({ 
            success: false, 
            message: '資料庫遷移失敗',
            error: error.message 
        });
    } finally {
        client.release();
    }
});

// 資料庫遷移 API（僅管理員）
apiRouter.post('/admin/migrate/add-priority', authorizeAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
        logger.info('[Migration] 開始添加 priority 欄位...');
        
        // 檢查欄位是否存在
        const checkColumn = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'task_comments' AND column_name = 'priority'
        `);
        
        if (checkColumn.rows.length > 0) {
            logger.info('[Migration] priority 欄位已存在');
            return res.json({ 
                success: true, 
                message: 'priority 欄位已存在，無需添加',
                alreadyExists: true
            });
        }
        
        await client.query('BEGIN');
        
        // 添加欄位
        await client.query(`
            ALTER TABLE task_comments 
            ADD COLUMN priority VARCHAR(20) DEFAULT 'normal'
        `);
        logger.info('[Migration] priority 欄位添加成功');
        
        // 添加檢查約束（如果不存在）
        await client.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'check_priority'
                ) THEN
                    ALTER TABLE task_comments 
                    ADD CONSTRAINT check_priority 
                    CHECK (priority IN ('normal', 'important', 'urgent'));
                END IF;
            END $$;
        `);
        logger.info('[Migration] 優先級約束添加成功');
        
        // 創建索引
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_task_comments_priority 
            ON task_comments(priority)
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_task_comments_order_priority 
            ON task_comments(order_id, priority)
        `);
        logger.info('[Migration] 索引創建成功');
        
        await client.query('COMMIT');
        
        // 統計資訊
        const stats = await client.query('SELECT COUNT(*) as count FROM task_comments');
        
        logger.info(`[Migration] 資料庫更新完成，評論總數: ${stats.rows[0].count}`);
        
        res.json({ 
            success: true, 
            message: '資料庫遷移成功',
            totalComments: stats.rows[0].count,
            alreadyExists: false
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('[Migration] 執行失敗:', error);
        res.status(500).json({ 
            success: false, 
            message: '資料庫遷移失敗',
            error: error.message 
        });
    } finally {
        client.release();
    }
});

// #endregion

apiRouter.post('/orders/batch/delete', authorizeAdmin, async (req, res) => {
    const { orderIds } = req.body;
    
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ message: '請提供訂單 ID 列表' });
    }
    
    try {
        const result = await pool.query(
            'DELETE FROM orders WHERE id = ANY($1) RETURNING id, voucher_number',
            [orderIds]
        );
        
        result.rows.forEach(order => {
            io.emit('task_deleted', { orderId: order.id });
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
// #endregion

// =================================================================
// #region 資料庫診斷端點 (Database Diagnostics)
// =================================================================
apiRouter.get('/debug/tables', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name;
        `);
        res.json({ 
            tables: result.rows.map(r => r.table_name),
            count: result.rows.length 
        });
    } catch (error) {
        logger.error('[/api/debug/tables] 錯誤:', error);
        res.status(500).json({ message: '檢查資料表失敗', error: error.message });
    }
});

apiRouter.get('/debug/check-comment-reads', async (req, res) => {
    try {
        const checkTable = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'task_comment_reads'
            );
        `);
        
        const tableExists = checkTable.rows[0].exists;
        
        if (tableExists) {
            const count = await pool.query('SELECT COUNT(*) FROM task_comment_reads');
            res.json({ 
                tableExists: true, 
                recordCount: parseInt(count.rows[0].count),
                status: 'OK'
            });
        } else {
            res.json({ 
                tableExists: false, 
                status: 'MISSING',
                message: '需要執行 005_comment_read_tracking.sql 遷移'
            });
        }
    } catch (error) {
        logger.error('[/api/debug/check-comment-reads] 錯誤:', error);
        res.status(500).json({ message: '檢查失敗', error: error.message });
    }
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
        code: err.code || 'INTERNAL_ERROR',
        message: err.message || '伺服器發生未知錯誤',
        requestId: req.requestId,
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