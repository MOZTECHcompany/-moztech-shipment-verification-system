// =================================================================
//                 Moztech WMS - 核心後端 API 伺服器
// =================================================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs'); // <-- 注意，我們仍然用 bcryptjs
const jwt = require('jsonwebtoken');
//... (其他 require 不變)

//... (所有中間的程式碼都不變)

// ✨✨✨ 終極修正版的登入 API ✨✨✨
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: '使用者名稱或密碼不能為空' });
    }

    // 將傳入的密碼轉為字串，確保類型正確
    const plainTextPassword = String(password);

    try {
        const userResult = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
        
        if (userResult.rows.length === 0) {
            console.log(`登入嘗試失敗: 找不到使用者 ${username}`);
            return res.status(401).json({ message: '使用者名稱或密碼錯誤' });
        }
        
        const user = userResult.rows[0];
        
        // ✨ 比對前確保兩個參數都是有效字串 ✨
        if (typeof plainTextPassword !== 'string' || typeof user.password !== 'string') {
            console.error('Bcrypt 比對錯誤: 密碼或 Hash 不是字串');
            return res.status(500).json({ message: '伺服器內部驗證錯誤' });
        }
        
        const isMatch = await bcrypt.compare(plainTextPassword, user.password);
        
        console.log(`使用者 '${username}' 的密碼比對結果 (isMatch): ${isMatch}`);

        if (!isMatch) {
            return res.status(401).json({ message: '使用者名稱或密碼錯誤' });
        }

        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ message: '登入成功', token: token, user: { id: user.id, username: user.username, role: user.role } });

    } catch (error) {
        console.error('登入 API 發生嚴重錯誤', error);
        res.status(500).json({ message: '伺服器內部錯誤' });
    }
});


// ... (所有其他路由和伺服器啟動程式碼都保持不變)
// ...
// ... (我給你完整的檔案，避免混淆)

const app = express();
const allowedOrigins = [ 'https://moztech-shipment-verification-system.onrender.com', 'http://localhost:5173', 'http://localhost:3000' ];
const corsOptions = { origin: function (origin, callback) { if (!origin || allowedOrigins.indexOf(origin) !== -1) { callback(null, true); } else { callback(new Error('此來源不被 CORS 策略所允許')); } }, credentials: true };
app.use(cors(corsOptions));
app.use(express.json());
// (剩下的所有程式碼都和上次一樣)
// ...