// =================================================================
//         Moztech WMS - 核心後端 API 伺服器 (功能完整最終版)
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
const allowedOrigins = [ 'https://moztech-shipment-verification-system.onrender.com', 'http://localhost:5173', 'http://localhost:3000' ];
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
const storage = multer.diskStorage({ destination: (req, file, cb) => cb(null, uploadDir), filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)) return res.status(401).json({ message: '未提供權杖' });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: '無效權杖' });
        req.user = user;
        next();
    });
};

app.get('/', (req, res) => res.status(200).send('Moztech WMS API Server is running.'));

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const userResult = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
        if (userResult.rows.length === 0) return res.status(401).json({ message: '使用者名稱或密碼錯誤' });
        const user = userResult.rows[0];
        const isMatch = await bcrypt.compare(String(password), user.password);
        if (!isMatch) return res.status(401).json({ message: '使用者名稱或密碼錯誤' });
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ message: '登入成功', token, user });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: '伺服器內部錯誤' });
    }
});

// ✨✨✨ 確保這個儀表板 API 存在且啟用 ✨✨✨
app.get('/api/reports/summary', verifyToken, async (req, res) => {
    try {
        const [ totalOrdersRes, pendingOrdersRes, completedOrdersRes, totalItemsRes ] = await Promise.all([
            pool.query("SELECT COUNT(*) FROM orders"),
            pool.query("SELECT COUNT(*) FROM orders WHERE order_status = 'pending'"),
            pool.query("SELECT COUNT(*) FROM orders WHERE order_status = 'completed'"),
            pool.query("SELECT SUM(quantity) FROM order_items")
        ]);
        const summary = {
            totalOrders: parseInt(totalOrdersRes.rows[0].count, 10),
            pendingOrders: parseInt(pendingOrdersRes.rows[0].count, 10),
            completedOrders: parseInt(completedOrdersRes.rows[0].count, 10),
            totalItems: parseInt(totalItemsRes.rows[0].sum, 10) || 0,
        };
        res.json(summary);
    } catch (error) {
        console.error('獲取總覽數據失敗', error);
        res.status(500).json({ message: '伺服器內部錯誤' });
    }
});

// ✨✨✨ 確保訂單匯入 API 存在且啟用 ✨✨✨
app.post('/api/orders/import', verifyToken, upload.single('orderFile'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: '沒有上傳檔案' });
    const filePath = req.file.path;
    let client;
    try {
        client = await pool.connect();
        const workbook = xlsx.readFile(filePath);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const getCellValue = (address) => { const cell = worksheet[address]; if (!cell || !cell.v) return ''; const val = String(cell.v).trim(); return val.includes(':') ? val.split(/:|：/)[1].trim() : val; };
        const voucherNumber = getCellValue('A2');
        if (!voucherNumber) throw new Error('憑證號碼為空');
        const items = {};
        const range = xlsx.utils.decode_range(worksheet['!ref']);
        for (let r = 6; r <= range.e.r; ++r) {
            const codeCell = worksheet[xlsx.utils.encode_cell({c:0, r})];
            const qtyCell = worksheet[xlsx.utils.encode_cell({c:2, r})];
            if (!codeCell || !codeCell.v || !qtyCell || !qtyCell.v) continue;
            const code = String(codeCell.v).replace(/\s/g, '');
            const qty = parseInt(String(qtyCell.v), 10) || 0;
            if (qty > 0) {
                if (items[code]) {
                    items[code].quantity += qty;
                } else {
                    const nameCell = worksheet[xlsx.utils.encode_cell({c:1, r})];
                    items[code] = { product_name: nameCell ? String(nameCell.v).trim() : '', quantity: qty };
                }
            }
        }
        await client.query('BEGIN');
        const orderRes = await client.query("INSERT INTO orders (voucher_number, customer_name, warehouse) VALUES ($1, $2, $3) RETURNING id", [voucherNumber, getCellValue('A3'), getCellValue('A4')]);
        const orderId = orderRes.rows[0].id;
        await Promise.all(Object.entries(items).map(([code, item]) => client.query("INSERT INTO order_items (order_id, product_code, product_name, quantity) VALUES ($1, $2, $3, $4)", [orderId, code, item.product_name, item.quantity])));
        await client.query('COMMIT');
        res.status(201).json({ message: `訂單 ${voucherNumber} 匯入成功！`, orderId, itemCount: Object.keys(items).length });
    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error('Order import failed:', err);
        if (err.code === '23505') return res.status(409).json({ message: '憑證號碼已存在' });
        res.status(500).json({ message: '伺服器內部錯誤' });
    } finally {
        if (client) client.release();
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`核心後端伺服器正在 http://localhost:${PORT} 上運行`);
});