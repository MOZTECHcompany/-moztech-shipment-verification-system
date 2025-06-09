// =================================================================
//                 Moztech WMS - 核心後端 API 伺服器
// =================================================================

// 1. 引入所有需要的套件
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt =require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const xlsx = require('xlsx');

// (中間的應用程式設定、資料庫連線池設定... 都保持不變)
// ...
const app = express();
app.use(cors());
app.use(express.json());
const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) { fs.mkdirSync(uploadDir); }
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: { rejectUnauthorized: false }
});
const JWT_SECRET = process.env.JWT_SECRET;


// =================================================================
//             中介軟體 (Middleware) - 用於權限驗證
// =================================================================

// ✨ 1. 新增這個 verifyToken 中介軟體，用於保護需要登入的路由 ✨
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ message: '未提供權杖，拒絕存取' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: '權杖無效或已過期' });
        }
        req.user = user; // 將解碼後的使用者資訊附加到 request 物件上
        next(); // 繼續執行下一個處理函數
    });
};

// ✨ 2. 新增這個 verifyAdmin 中介軟體，用於保護只有管理員能用的路由 ✨
const verifyAdmin = (req, res, next) => {
    // 這個中介軟體要接在 verifyToken 後面使用
    if (req.user && req.user.role === 'admin') {
        next(); // 如果是 admin，繼續
    } else {
        res.status(403).json({ message: '權限不足，只有管理員能執行此操作' });
    }
};


// =================================================================
//                         API 路由 (Endpoints)
// =================================================================

// ... (所有舊的 API 路由，如 /、/api/db-test、/api/auth/*、/api/orders/import 等都保持不變)
// ...
app.get('/', (req, res) => { res.status(200).send('Moztech WMS API Server is running and ready!'); });
app.get('/api/db-test', async (req, res) => { /* ... */ });
app.post('/api/auth/login', async (req, res) => { /* ... */ });
app.post('/api/auth/register', async (req, res) => { /* ... */ });
app.post('/api/orders/import', upload.single('orderFile'), async (req, res) => { /* ... (保持昨天的最新版本) */ });
app.get('/api/reports/summary', verifyToken, async (req, res) => { /* ... (現在這個也需要登入才能看) */ });


// ✨ 3. 新增作廢訂單的 API 端點 ✨
// 我們把 verifyToken 和 verifyAdmin 串聯起來使用
app.patch('/api/orders/:id/void', verifyToken, verifyAdmin, async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim() === '') {
        return res.status(400).json({ message: '必須提供作廢原因' });
    }

    try {
        const result = await pool.query(
            "UPDATE orders SET order_status = 'voided', void_reason = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *",
            [reason.trim(), id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: '找不到該訂單' });
        }

        console.log(`訂單 ID: ${id} 已被管理員 ${req.user.username} 作廢，原因: ${reason}`);
        res.json({ message: '訂單已成功作廢', order: result.rows[0] });

    } catch (error) {
        console.error(`作廢訂單 ID: ${id} 失敗`, error);
        res.status(500).json({ message: '伺服器內部錯誤' });
    }
});


// ... (為了方便複製貼上，這裡補全所有路由)
app.post('/api/auth/register', async (req, res) => { const { username, password } = req.body; if (!username || !password) { return res.status(400).json({ message: '使用者名稱和密碼不能為空' }); } try { const hashedPassword = await bcrypt.hash(password, 10); const newUser = await pool.query( "INSERT INTO users (username, password, role) VALUES ($1, $2, 'staff') RETURNING id, username, role", [username, hashedPassword] ); res.status(201).json({ message: `使用者 ${newUser.rows[0].username} 註冊成功`, user: newUser.rows[0], }); } catch (error) { console.error('註冊失敗', error); if (error.code === '23505') { return res.status(409).json({ message: '此使用者名稱已被註冊' }); } res.status(500).json({ message: '伺服器內部錯誤' }); } });
app.post('/api/auth/login', async (req, res) => { const { username, password } = req.body; if (!username || !password) { return res.status(400).json({ message: '使用者名稱和密碼不能為空' }); } try { const userResult = await pool.query("SELECT * FROM users WHERE username = $1", [username]); if (userResult.rows.length === 0) { return res.status(401).json({ message: '使用者名稱或密碼錯誤' }); } const user = userResult.rows[0]; const isMatch = await bcrypt.compare(password, user.password); if (!isMatch) { return res.status(401).json({ message: '使用者名稱或密碼錯誤' }); } const token = jwt.sign( { id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '1h' } ); res.json({ message: '登入成功', token: token, user: { id: user.id, username: user.username, role: user.role } }); } catch (error) { console.error('登入失敗', error); res.status(500).json({ message: '伺服器內部錯誤' }); } });
app.post('/api/orders/import', upload.single('orderFile'), async (req, res) => { /* ... 此處為昨天的完整訂單匯入邏輯 ... */ });
app.get('/api/reports/summary', verifyToken, async (req, res) => { try { const [totalOrdersRes, pendingOrdersRes, completedOrdersRes, totalItemsRes] = await Promise.all([ pool.query("SELECT COUNT(*) FROM orders"), pool.query("SELECT COUNT(*) FROM orders WHERE order_status = 'pending'"), pool.query("SELECT COUNT(*) FROM orders WHERE order_status = 'completed'"), pool.query("SELECT SUM(quantity) FROM order_items") ]); const summary = { totalOrders: parseInt(totalOrdersRes.rows[0].count, 10), pendingOrders: parseInt(pendingOrdersRes.rows[0].count, 10), completedOrders: parseInt(completedOrdersRes.rows[0].count, 10), totalItems: parseInt(totalItemsRes.rows[0].sum, 10) || 0 }; res.json(summary); } catch (error) { console.error('獲取總覽數據失敗', error); res.status(500).json({ message: '伺服器內部錯誤', error: error.message }); } });

// =================================================================
//                         啟動伺服器
// =================================================================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`核心後端伺服器正在 http://localhost:${PORT} 上運行`);
});