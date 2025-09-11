// =================================================================
//         Moztech WMS - 核心後端 API 伺服器 (最终完整功能版)
// =================================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const xlsx = require('xlsx');

const app = express();

const allowedOrigins = [
    'https://moztech-shipment-verification-system.onrender.com', // 线上前端地址
    'http://localhost:5173',
    'http://localhost:3000'
];

const corsOptions = {
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('此來源不被 CORS 策略所允許'));
        }
    },
    credentials: true
};
app.use(cors(corsOptions));
app.use(express.json());

const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) { fs.mkdirSync(uploadDir); }
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_DATABASE}`,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const initializeDatabase = async () => {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                name VARCHAR(255),
                role VARCHAR(50) NOT NULL DEFAULT 'picker', -- picker, packer, admin
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                voucher_number VARCHAR(255) UNIQUE NOT NULL,
                customer_name VARCHAR(255),
                warehouse VARCHAR(255),
                order_status VARCHAR(50) DEFAULT 'pending', -- pending, processing, completed, voided
                void_reason TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS order_items (
                id SERIAL PRIMARY KEY,
                order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
                product_code VARCHAR(255) NOT NULL,
                product_name VARCHAR(255),
                quantity INTEGER NOT NULL,
                picked_quantity INTEGER DEFAULT 0,
                packed_quantity INTEGER DEFAULT 0
            );
        `);
        console.log('Database tables are ready.');
    } catch (err) {
        console.error('Error initializing database:', err);
        process.exit(1);
    } finally {
        client.release();
    }
};

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error("FATAL ERROR: JWT_SECRET is not defined.");
    process.exit(1);
}

const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ message: '未提供權杖' });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: '無效權杖' });
        req.user = user;
        next();
    });
};

// --- API ROUTES ---

app.get('/', (req, res) => res.status(200).send('Moztech WMS API Server is running.'));

// Auth
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) return res.status(401).json({ message: '使用者名稱或密碼錯誤' });
        const user = result.rows[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: '使用者名稱或密碼錯誤' });
        const token = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ message: '登入成功', token, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: '伺服器內部錯誤' });
    }
});

// Orders
app.post('/api/orders/import', verifyToken, upload.single('orderFile'), async (req, res) => {
    // ... (This function remains the same as your previous full backend code)
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

app.get('/api/orders/:orderId', verifyToken, async (req, res) => {
    const { orderId } = req.params;
    try {
        const orderRes = await pool.query("SELECT * FROM orders WHERE id = $1", [orderId]);
        if (orderRes.rows.length === 0) return res.status(44).json({ message: '找不到訂單' });
        const itemsRes = await pool.query("SELECT * FROM order_items WHERE order_id = $1 ORDER BY id", [orderId]);
        res.json({ order: orderRes.rows[0], items: itemsRes.rows });
    } catch (error) {
        console.error('Get order details error:', error);
        res.status(500).json({ message: '獲取訂單詳情失敗' });
    }
});

app.post('/api/orders/update_item', verifyToken, async (req, res) => {
    const { orderId, sku, type, amount } = req.body;
    const userRole = req.user.role;

    if (!['pick', 'pack'].includes(type) || !sku || !amount || !orderId) {
        return res.status(400).json({ message: '無效的請求參數' });
    }

    if (type === 'pick' && !['picker', 'admin'].includes(userRole)) {
        return res.status(403).json({ message: '權限不足以執行揀貨操作' });
    }
    if (type === 'pack' && !['packer', 'admin'].includes(userRole)) {
        return res.status(403).json({ message: '權限不足以執行裝箱操作' });
    }
    
    const fieldToUpdate = type === 'pick' ? 'picked_quantity' : 'packed_quantity';
    
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const itemRes = await client.query('SELECT * FROM order_items WHERE order_id = $1 AND product_code = $2 FOR UPDATE', [orderId, sku]);
        if (itemRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: '找不到對應的品項' });
        }
        const item = itemRes.rows[0];
        const currentQty = item[fieldToUpdate];
        const newQty = currentQty + amount;

        // Validation checks
        if (newQty < 0) {
             await client.query('ROLLBACK');
             return res.status(400).json({ message: '數量不能為負數' });
        }
        if (type === 'pick' && newQty > item.quantity) {
             await client.query('ROLLBACK');
             return res.status(400).json({ message: '揀貨數量不能超過訂單總數' });
        }
        if (type === 'pack' && newQty > item.picked_quantity) {
             await client.query('ROLLBACK');
             return res.status(400).json({ message: '裝箱數量不能超過已揀貨數' });
        }

        const updateQuery = `UPDATE order_items SET ${fieldToUpdate} = $1 WHERE id = $2 RETURNING *;`;
        const result = await client.query(updateQuery, [newQty, item.id]);

        await client.query("UPDATE orders SET order_status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND order_status = 'pending'", [orderId]);
        
        // Check if all items are fully packed
        const completionCheck = await client.query("SELECT COUNT(*) FROM order_items WHERE order_id = $1 AND packed_quantity < quantity", [orderId]);
        if (completionCheck.rows[0].count === '0') {
            await client.query("UPDATE orders SET order_status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [orderId]);
        }

        await client.query('COMMIT');
        res.json({ message: '更新成功', item: result.rows[0] });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error(`Error updating ${type} quantity:`, error);
        res.status(500).json({ message: '伺服器內部錯誤' });
    } finally {
        if (client) client.release();
    }
});

app.patch('/api/orders/:orderId/void', verifyToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: '權限不足' });
    }
    const { orderId } = req.params;
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ message: '必須提供作廢原因' });

    try {
        const result = await pool.query(
            "UPDATE orders SET order_status = 'voided', void_reason = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *",
            [reason, orderId]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: '找不到訂單' });
        res.json({ message: '訂單已成功作廢' });
    } catch (error) {
        console.error('Error voiding order:', error);
        res.status(500).json({ message: '伺服器內部錯誤' });
    }
});

// Start Server
const PORT = process.env.PORT || 3001;
const startServer = async () => {
    await initializeDatabase();
    app.listen(PORT, () => {
        console.log(`核心後端伺服器正在 port ${PORT} 上運行`);
    });
};
startServer();