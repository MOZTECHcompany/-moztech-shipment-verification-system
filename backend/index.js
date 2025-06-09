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

app.get('/', (req, res) => { res.status(200).send('Moztech WMS API Server is running and ready!'); });

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: '使用者名稱和密碼不能為空' });
    try {
        const userResult = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
        if (userResult.rows.length === 0) { return res.status(401).json({ message: '使用者名稱或密碼錯誤' }); }
        const user = userResult.rows[0];
        const isMatch = await bcrypt.compare(String(password), user.password);
        if (!isMatch) { return res.status(401).json({ message: '使用者名稱或密碼錯誤' }); }
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ message: '登入成功', token: token, user: { id: user.id, username: user.username, role: user.role } });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: '伺服器內部錯誤' });
    }
});

app.post('/api/orders/import', verifyToken, upload.single('orderFile'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: '沒有上傳檔案' });
    const filePath = req.file.path;
    const client = await pool.connect();
    try {
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const getCellValue = (cellAddress) => { const cell = worksheet[cellAddress]; if (!cell || !cell.v) return ''; const value = String(cell.v).trim(); if (value.includes('：')) return value.split('：')[1].trim(); if (value.includes(':')) return value.split(':')[1].trim(); return value; };
        const voucherNumber = getCellValue('A2');
        if (!voucherNumber) { throw new Error('Excel 檔案 A2 儲存格缺少憑證號碼！'); }
        const customerName = getCellValue('A3');
        const warehouse = getCellValue('A4');
        const items = {};
        const range = xlsx.utils.decode_range(worksheet['!ref']);
        for (let rowNum = 6; rowNum <= range.e.r; rowNum++) {
            const productCodeCell = worksheet[xlsx.utils.encode_cell({c: 0, r: rowNum})];
            if (!productCodeCell || !productCodeCell.v) continue;
            const quantityCell = worksheet[xlsx.utils.encode_cell({c: 2, r: rowNum})];
            const quantity = parseInt(String(quantityCell.v), 10) || 0;
            if (quantity > 0) {
                const productCode = String(productCodeCell.v).replace(/\s/g, '');
                if (items[productCode]) {
                    items[productCode].quantity += quantity;
                } else {
                    const productNameCell = worksheet[xlsx.utils.encode_cell({c: 1, r: rowNum})];
                    items[productCode] = { product_name: productNameCell ? String(productNameCell.v).trim() : '', quantity: quantity };
                }
            }
        }
        await client.query('BEGIN');
        const orderResult = await client.query(`INSERT INTO orders (voucher_number, customer_name, warehouse) VALUES ($1, $2, $3) RETURNING id`, [voucherNumber, customerName, warehouse]);
        const newOrderId = orderResult.rows[0].id;
        const itemQueries = Object.entries(items).map(([code, item]) => 
            client.query(`INSERT INTO order_items (order_id, product_code, product_name, quantity) VALUES ($1, $2, $3, $4)`, [newOrderId, code, item.product_name, item.quantity])
        );
        await Promise.all(itemQueries);
        await client.query('COMMIT');
        res.status(201).json({ message: `訂單 ${voucherNumber} 匯入成功！`, orderId: newOrderId, itemCount: Object.keys(items).length });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Order import error:', error);
        if (error.code === '23505') return res.status(409).json({ message: `錯誤：憑證號碼已存在！` });
        res.status(500).json({ message: '伺服器內部錯誤', error: error.message });
    } finally {
        client.release();
        fs.unlinkSync(filePath);
    }
});

// ... 其他未來可能會加入的 API ...

// =================================================================
//                         啟動伺服器
// =================================================================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`核心後端伺服器正在 http://localhost:${PORT} 上運行`);
});