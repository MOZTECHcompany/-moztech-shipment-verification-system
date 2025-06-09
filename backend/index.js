// =================================================================
//         Moztech WMS - 核心後端 API 伺服器 (全功能最終校對版)
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

// 3. 資料庫連線池與 JWT 設定
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE, ssl: { rejectUnauthorized: false } });
const JWT_SECRET = process.env.JWT_SECRET;

// 4. 權限驗證中介軟體
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
        res.json({ message: '登入成功', token: token, user: user });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: '伺服器內部錯誤' });
    }
});

app.post('/api/auth/register', verifyToken, verifyAdmin, async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password || !role) {
        return res.status(400).json({ message: '使用者名稱、密碼和角色不能為空' });
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await pool.query(
            "INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role",
            [username, hashedPassword, role]
        );
        res.status(201).json({ message: `使用者 ${newUser.rows[0].username} 註冊成功`, user: newUser.rows[0] });
    } catch (error) {
        console.error('Register error:', error);
        if (error.code === '23505') { return res.status(409).json({ message: '此使用者名稱已被註冊' }); }
        res.status(500).json({ message: '伺服器內部錯誤' });
    }
});


app.get('/api/reports/summary', verifyToken, async (req, res) => {
    try {
        const [ totalOrdersRes, pendingOrdersRes, completedOrdersRes, voidedOrdersRes ] = await Promise.all([
            pool.query("SELECT COUNT(*) FROM orders WHERE order_status NOT IN ('voided')"),
            pool.query("SELECT COUNT(*) FROM orders WHERE order_status = 'pending'"),
            pool.query("SELECT COUNT(*) FROM orders WHERE order_status = 'completed'"),
            pool.query("SELECT COUNT(*) FROM orders WHERE order_status = 'voided'")
        ]);
        res.json({
            totalOrders: parseInt(totalOrdersRes.rows[0].count, 10),
            pendingOrders: parseInt(pendingOrdersRes.rows[0].count, 10),
            completedOrders: parseInt(completedOrdersRes.rows[0].count, 10),
            voidedOrders: parseInt(voidedOrdersRes.rows[0].count, 10),
        });
    } catch (error) {
        console.error('獲取總覽數據失敗', error);
        res.status(500).json({ message: '獲取總覽數據失敗' });
    }
});

app.post('/api/orders/import', verifyToken, upload.single('orderFile'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: '沒有上傳檔案' });
    const filePath = req.file.path;
    let client;
    try {
        client = await pool.connect();
        const workbook = xlsx.readFile(filePath);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const getCellValue = (address) => { const cell = worksheet[address]; if (!cell || typeof cell.v === 'undefined') return ''; const val = String(cell.v).trim(); return val.includes(':') || val.includes('：') ? val.split(/[:：]/)[1].trim() : val; };
        const voucherNumber = getCellValue('A2');
        if (!voucherNumber) throw new Error('Excel 檔案 A2 儲存格缺少憑證號碼！');
        
        const customerName = getCellValue('A3');
        const warehouse = getCellValue('A4');
        const items = {};
        const range = xlsx.utils.decode_range(worksheet['!ref']);

        for (let r = 6; r <= range.e.r; ++r) {
            const codeCell = worksheet[xlsx.utils.encode_cell({c:0, r})];
            if (!codeCell || typeof codeCell.v === 'undefined') continue;
            
            const qtyCell = worksheet[xlsx.utils.encode_cell({c:2, r})];
            if (!qtyCell || typeof qtyCell.v === 'undefined') continue;

            const qty = parseInt(String(qtyCell.v), 10) || 0;
            if (qty > 0) {
                const code = String(codeCell.v).replace(/\s/g, '');
                if (items[code]) {
                    items[code].quantity += qty;
                } else {
                    const nameCell = worksheet[xlsx.utils.encode_cell({c:1, r})];
                    items[code] = { product_name: nameCell ? String(nameCell.v).trim() : '', quantity: qty };
                }
            }
        }

        await client.query('BEGIN');
        const orderRes = await client.query("INSERT INTO orders (voucher_number, customer_name, warehouse, order_status) VALUES ($1, $2, $3, 'pending') RETURNING id", [voucherNumber, customerName, warehouse]);
        const orderId = orderRes.rows[0].id;
        
        const itemInsertPromises = Object.entries(items).map(([code, item]) => 
            client.query("INSERT INTO order_items (order_id, product_code, product_name, quantity) VALUES ($1, $2, $3, $4)", [orderId, code, item.product_name, item.quantity])
        );
        await Promise.all(itemInsertPromises);
        
        await client.query('COMMIT');
        res.status(201).json({ message: `訂單 ${voucherNumber} 匯入成功！`, orderId: orderId, itemCount: Object.keys(items).length });
    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error('Order import failed:', err);
        const detailMatch = err.detail ? err.detail.match(/\(([^)]+)\)/) : null;
        const duplicatedKey = detailMatch ? detailMatch[1] : '';
        if (err.code === '23505') return res.status(409).json({ message: `憑證號碼 ${duplicatedKey} 已存在` });
        res.status(500).json({ message: '伺服器內部錯誤' });
    } finally {
        if (client) client.release();
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
});

app.patch('/api/orders/:id/void', verifyToken, verifyAdmin, async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    if (!reason || reason.trim() === '') return res.status(400).json({ message: '必須提供作廢原因' });
    try {
        const result = await pool.query("UPDATE orders SET order_status = 'voided', void_reason = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND order_status != 'voided' RETURNING *", [reason.trim(), id]);
        if (result.rows.length === 0) return res.status(404).json({ message: '找不到該訂單或訂單先前已被作廢' });
        console.log(`Order ID ${id} voided by ${req.user.username}. Reason: ${reason}`);
        res.json({ message: '訂單已成功作廢', order: result.rows[0] });
    } catch (error) {
        console.error(`Void order ${id} failed:`, error);
        res.status(500).json({ message: '伺服器內部錯誤' });
    }
});


// =================================================================
//                         啟動伺服器
// =================================================================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`核心後端伺服器正在 http://localhost:${PORT} 上運行`);
});