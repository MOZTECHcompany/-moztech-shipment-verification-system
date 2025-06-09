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
app.use(cors());
app.use(express.json());

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
//                         API 路由 (Endpoints)
// =================================================================

// --- 基本健康檢查路由 ---
app.get('/', (req, res) => {
    res.status(200).send('Moztech WMS API Server is running and ready!');
});

// --- 資料庫連線測試路由 ---
app.get('/api/db-test', async (req, res) => {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT NOW()');
        client.release();
        res.json({ message: '資料庫連線成功！', time: result.rows[0].now });
    } catch (error) {
        console.error('資料庫連線錯誤', error);
        res.status(500).json({ message: '資料庫連線失敗', error: error.message });
    }
});


// --- 訂單匯入 API (✨ 最新修正版本 ✨) ---
app.post('/api/orders/import', upload.single('orderFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: '沒有上傳檔案' });
    }

    const filePath = req.file.path;
    const client = await pool.connect();

    try {
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        const getCellValue = (cellAddress) => {
            const cell = worksheet[cellAddress];
            if (!cell || !cell.v) return '';
            const value = String(cell.v).trim();
            if (value.includes('：')) return value.split('：')[1].trim();
            if (value.includes(':')) return value.split(':')[1].trim();
            return value;
        };

        const voucherNumber = getCellValue('A2');
        const customerName = getCellValue('A3');
        const warehouse = getCellValue('A4');

        if (!voucherNumber) {
            client.release();
            fs.unlinkSync(filePath);
            return res.status(400).json({ message: 'Excel 檔案 A2 儲存格缺少憑證號碼！' });
        }
        
        console.log(`讀取到訂單資訊: 憑證號=${voucherNumber}, 客戶=${customerName}, 倉庫=${warehouse}`);

        const items = {};
        const range = xlsx.utils.decode_range(worksheet['!ref']);
        for (let rowNum = 6; rowNum <= range.e.r; rowNum++) {
            const productCodeCell = worksheet[xlsx.utils.encode_cell({c: 0, r: rowNum})];
            const productNameCell = worksheet[xlsx.utils.encode_cell({c: 1, r: rowNum})];
            const quantityCell = worksheet[xlsx.utils.encode_cell({c: 2, r: rowNum})];

            if (!productCodeCell || !productCodeCell.v) continue;

            // ✨✨✨ 關鍵的修復程式碼在這裡！✨✨✨
            const productCode = String(productCodeCell.v).replace(/\s/g, '');
            
            const productName = productNameCell ? String(productNameCell.v).trim() : '';
            const quantityString = quantityCell ? String(quantityCell.v) : '0';
            const quantity = parseInt(quantityString, 10) || 0;
            
            if (quantity > 0) {
                if (items[productCode]) {
                    items[productCode].quantity += quantity;
                } else {
                    items[productCode] = { product_name: productName, quantity: quantity };
                }
            }
        }
        console.log('合併後的品項列表:', items);

        await client.query('BEGIN');
        const orderInsertQuery = `INSERT INTO orders (voucher_number, customer_name, warehouse, order_status) VALUES ($1, $2, $3, 'pending') RETURNING id;`;
        const orderResult = await client.query(orderInsertQuery, [voucherNumber, customerName, warehouse]);
        const newOrderId = orderResult.rows[0].id;

        console.log(`已建立新訂單，ID: ${newOrderId}`);

        for (const productCode in items) {
            const item = items[productCode];
            const itemInsertQuery = `INSERT INTO order_items (order_id, product_code, product_name, quantity) VALUES ($1, $2, $3, $4);`;
            await client.query(itemInsertQuery, [newOrderId, productCode, item.product_name, item.quantity]);
        }

        await client.query('COMMIT');

        res.status(201).json({ 
            message: `訂單 ${voucherNumber} 匯入成功！`, 
            orderId: newOrderId, 
            itemCount: Object.keys(items).length 
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('檔案匯入失敗', error);
        
        const worksheet = error.worksheet || (xlsx.readFile(filePath).Sheets[xlsx.readFile(filePath).SheetNames[0]]);
        const voucherNumberForError = (worksheet && getCellValue('A2')) || '未知';

        if (error.code === '23505' && error.constraint === 'orders_voucher_number_key') {
            return res.status(409).json({ message: `錯誤：憑證號碼 ${voucherNumberForError} 已存在，請勿重複匯入！`});
        }
        
        res.status(500).json({ message: '伺服器內部錯誤', error: error.message });
    } finally {
        client.release();
        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
            } catch (unlinkErr) {
                console.error('刪除暫存檔案失敗:', unlinkErr);
            }
        }
    }
});


// --- 儀表板數據 API ---
app.get('/api/reports/summary', async (req, res) => {
    try {
        const [
            totalOrdersRes, pendingOrdersRes, completedOrdersRes, totalItemsRes
        ] = await Promise.all([
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
        res.status(500).json({ message: '伺服器內部錯誤', error: error.message });
    }
});

// --- 用戶認證 API ---
app.post('/api/auth/register', async (req, res) => { const { username, password } = req.body; if (!username || !password) { return res.status(400).json({ message: '使用者名稱和密碼不能為空' }); } try { const hashedPassword = await bcrypt.hash(password, 10); const newUser = await pool.query( "INSERT INTO users (username, password, role) VALUES ($1, $2, 'staff') RETURNING id, username, role", [username, hashedPassword] ); res.status(201).json({ message: `使用者 ${newUser.rows[0].username} 註冊成功`, user: newUser.rows[0], }); } catch (error) { console.error('註冊失敗', error); if (error.code === '23505') { return res.status(409).json({ message: '此使用者名稱已被註冊' }); } res.status(500).json({ message: '伺服器內部錯誤' }); } });
app.post('/api/auth/login', async (req, res) => { const { username, password } = req.body; if (!username || !password) { return res.status(400).json({ message: '使用者名稱和密碼不能為空' }); } try { const userResult = await pool.query("SELECT * FROM users WHERE username = $1", [username]); if (userResult.rows.length === 0) { return res.status(401).json({ message: '使用者名稱或密碼錯誤' }); } const user = userResult.rows[0]; const isMatch = await bcrypt.compare(password, user.password); if (!isMatch) { return res.status(401).json({ message: '使用者名稱或密碼錯誤' }); } const token = jwt.sign( { id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '1h' } ); res.json({ message: '登入成功', token: token, user: { id: user.id, username: user.username, role: user.role } }); } catch (error) { console.error('登入失敗', error); res.status(500).json({ message: '伺服器內部錯誤' }); } });


// =================================================================
//                         啟動伺服器
// =================================================================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`核心後端伺服器正在 http://localhost:${PORT} 上運行`);
});