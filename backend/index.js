// =================================================================
//                 Moztech WMS - 核心後端 API 伺服器 (最終安全版)
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

// 2. 應用程式與中介軟體設定
const app = express();
const allowedOrigins = [
    'https://moztech-shipment-verification-system.onrender.com',
    'http://localhost:5173',
    'http://localhost:3000'
];
const corsOptions = {
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.indexOf(origin) !== -1) { callback(null, true); } 
        else { callback(new Error('此來源不被 CORS 策略所允許')); }
    },
    credentials: true
};
app.use(cors(corsOptions));
app.use(express.json());

const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) { fs.mkdirSync(uploadDir); }
const storage = multer.diskStorage({ destination: (req, file, cb) => cb(null, uploadDir), filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname) });
const upload = multer({ storage: storage });

const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE, ssl: { rejectUnauthorized: false } });
const JWT_SECRET = process.env.JWT_SECRET;

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
    if (req.user && req.user.role === 'admin') { next(); } 
    else { res.status(403).json({ message: '權限不足，只有管理員能執行此操作' }); }
};


// =================================================================
//                         API 路由 (Endpoints)
// =================================================================

// (我們把那個臨時的 /api/auth/generate... 路由從這裡刪掉了)

app.get('/', (req, res) => { res.status(200).send('Moztech WMS API Server is running and ready!'); });

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: '使用者名稱和密碼不能為空' });
    const plainTextPassword = String(password);
    try {
        const userResult = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
        if (userResult.rows.length === 0) { return res.status(401).json({ message: '使用者名稱或密碼錯誤' }); }
        const user = userResult.rows[0];
        if (!user.password) {
            console.error("錯誤：從資料庫中未取得到 password 欄位！");
            return res.status(500).json({ message: '伺服器內部錯誤：用戶資料結構異常' });
        }
        const isMatch = await bcrypt.compare(plainTextPassword, user.password);
        if (!isMatch) { return res.status(401).json({ message: '使用者名稱或密碼錯誤' }); }
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ message: '登入成功', token: token, user: { id: user.id, username: user.username, role: user.role } });
    } catch (error) {
        console.error('登入 API 發生嚴重錯誤', error);
        res.status(500).json({ message: '伺服器內部錯誤' });
    }
});

// 其他路由...
// ...


// =================================================================
//                         啟動伺服器
// =================================================================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`核心後端伺服器正在 http://localhost:${PORT} 上運行`);
});