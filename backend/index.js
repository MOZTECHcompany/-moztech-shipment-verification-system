// =================================================================
//                 Moztech WMS - 核心後端 API 伺服器
// =================================================================

// 1. 引入所有需要的套件
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const xlsx = require('xlsx');

// 2. 應用程式與 Multer 設定
const app = express();

// ✨✨✨ 1. 修正後的 CORS 設定 ✨✨✨
// 建立一個允許來源的白名單
const allowedOrigins = [
    'https://moztech-shipment-verification-system.onrender.com', // 你的前端生產環境網址
    'http://localhost:5173',  // 本地開發時的 Vite 預設網址
    'http://localhost:3000'   // 其他可能的本地開發網址
];

const corsOptions = {
    origin: function (origin, callback) {
        // 允許來自白名單的請求，以及沒有 origin 的請求 (例如 Postman)
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('此來源不被 CORS 策略所允許'));
        }
    },
    credentials: true
};

app.use(cors(corsOptions)); // 使用我們精確的 CORS 設定
app.use(express.json());   // 解析 JSON request body

// 設定檔案上傳的暫存資料夾
const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

// 3. 資料庫連線池設定
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: {
      rejectUnauthorized: false
    }
});
const JWT_SECRET = process.env.JWT_SECRET;

// =================================================================
//             中介軟體 (Middleware) - 用於權限驗證
// =================================================================
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ message: '未提供權杖，拒絕存取' });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: '權杖無效或已過期' });
        req.user = user;
        next();
    });
};

const verifyAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: '權限不足，只有管理員能執行此操作' });
    }
};

// =================================================================
//                         API 路由 (Endpoints)
// =================================================================

app.get('/', (req, res) => { res.status(200).send('Moztech WMS API Server is running and ready!'); });

app.post('/api/auth/login', async (req, res) => { const { username, password } = req.body; if (!username || !password) { return res.status(400).json({ message: '使用者名稱和密碼不能為空' }); } try { const userResult = await pool.query("SELECT * FROM users WHERE username = $1", [username]); if (userResult.rows.length === 0) { return res.status(401).json({ message: '使用者名稱或密碼錯誤' }); } const user = userResult.rows[0]; const isMatch = await bcrypt.compare(password, user.password); if (!isMatch) { return res.status(401).json({ message: '使用者名稱或密碼錯誤' }); } const token = jwt.sign( { id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '1h' } ); res.json({ message: '登入成功', token: token, user: { id: user.id, username: user.username, role: user.role } }); } catch (error) { console.error('登入失敗', error); res.status(500).json({ message: '伺服器內部錯誤' }); } });

// ... 其他 API ...
app.get('/api/reports/summary', verifyToken, async (req, res) => { try { const [totalOrdersRes, pendingOrdersRes, completedOrdersRes, totalItemsRes] = await Promise.all([ pool.query("SELECT COUNT(*) FROM orders"), pool.query("SELECT COUNT(*) FROM orders WHERE order_status = 'pending'"), pool.query("SELECT COUNT(*) FROM orders WHERE order_status = 'completed'"), pool.query("SELECT SUM(quantity) FROM order_items") ]); const summary = { totalOrders: parseInt(totalOrdersRes.rows[0].count, 10), pendingOrders: parseInt(pendingOrdersRes.rows[0].count, 10), completedOrders: parseInt(completedOrdersRes.rows[0].count, 10), totalItems: parseInt(totalItemsRes.rows[0].sum, 10) || 0 }; res.json(summary); } catch (error) { console.error('獲取總覽數據失敗', error); res.status(500).json({ message: '伺服器內部錯誤', error: error.message }); } });
app.post('/api/orders/import', verifyToken, upload.single('orderFile'), async (req, res) => { /* 訂單匯入邏輯 */ }); // ✨ 保護起來
app.patch('/api/orders/:id/void', verifyToken, verifyAdmin, async (req, res) => { /* 作廢訂單邏輯 */ });

// =================================================================
//                         啟動伺服器
// =================================================================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`核心後端伺服器正在 http://localhost:${PORT} 上運行`);
});