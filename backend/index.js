// 檔案路徑: backend/index.js
// =================================================================
//         Moztech WMS - 核心後端 API 伺服器 (v3.1 - 修正版)
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

// 1. 應用程式與中介軟體設定
const app = express();

const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS 
    ? process.env.CORS_ALLOWED_ORIGINS.split(',') 
    : ['http://localhost:5173', 'http://localhost:3000'];

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

// =================================================================
//         2. 資料庫連線與環境變數 (Render.com 適應版)
// =================================================================
const requiredDbEnv = ['DB_USER', 'DB_HOST', 'DB_DATABASE', 'DB_PASSWORD', 'DB_PORT'];
const requiredOtherEnv = ['JWT_SECRET'];

// 在 Render 環境中，NODE_ENV 通常會被設為 'production'
const isProduction = process.env.NODE_ENV === 'production';

// 檢查所有必要的環境變數
for (const envVar of [...requiredDbEnv, ...requiredOtherEnv]) {
    if (!process.env[envVar]) {
        console.error(`[FATAL ERROR] 必要的環境變數 ${envVar} 未設定。`);
        // 在生產環境中，如果缺少變數，則直接退出
        if (isProduction) process.exit(1);
    }
}

// 使用分散的環境變數來建立連線池
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT, 10), // Port 需要是數字
    // Render.com 的資料庫需要 SSL 連線
    ssl: isProduction ? { rejectUnauthorized: false } : false
});

const JWT_SECRET = process.env.JWT_SECRET;

// 3. 權限驗證中介軟體
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ message: '未提供權杖 (Token)' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({ message: '權杖已過期，請重新登入' });
            }
            return res.status(403).json({ message: '無效權杖' });
        }
        req.user = user;
        next();
    });
};

const verifyAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: '權限不足，需要管理員身份' });
    }
};

// =================================================================
//                         API 路由 (Endpoints)
// =================================================================

app.get('/', (req, res) => res.status(200).send('Moztech WMS API Server (v3.1) is running.'));

// --- 使用者與權限 (Auth & Users) ---
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const userResult = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
        if (userResult.rows.length === 0) return res.status(401).json({ message: '使用者名稱或密碼錯誤' });
        const user = userResult.rows[0];
        const isMatch = await bcrypt.compare(String(password), user.password_hash);
        if (!isMatch) return res.status(401).json({ message: '使用者名稱或密碼錯誤' });
        const token = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ message: '登入成功', token, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: '伺服器內部錯誤' });
    }
});

app.post('/api/auth/register', verifyToken, verifyAdmin, async (req, res) => {
    const { username, password, role, name } = req.body;
    if (!username || !password || !role || !name) return res.status(400).json({ message: '所有欄位皆為必填' });
    if (password.length < 6) return res.status(400).json({ message: '為安全起見，密碼長度至少需要6位' });
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await pool.query("INSERT INTO users (username, password_hash, role, name) VALUES ($1, $2, $3, $4) RETURNING id, username, role, name", [username, hashedPassword, role, name]);
        res.status(201).json({ message: `使用者 ${newUser.rows[0].name} 註冊成功`, user: newUser.rows[0] });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ message: '此使用者名稱已被註冊' });
        console.error('Register error:', error);
        res.status(500).json({ message: '伺服器內部錯誤' });
    }
});

app.get('/api/users', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const result = await pool.query("SELECT id, username, name, role, TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at FROM users ORDER BY id ASC");
        res.json(result.rows);
    } catch (error) {
        console.error('Fetch users error:', error);
        res.status(500).json({ message: '獲取使用者列表失敗' });
    }
});

// --- 報表與總覽 (Reports & Summary) ---
app.get('/api/reports/summary', verifyToken, async (req, res) => {
    try {
        const [totalOrdersRes, pendingOrdersRes, completedOrdersRes] = await Promise.all([
            pool.query("SELECT COUNT(*) FROM orders"),
            pool.query("SELECT COUNT(*) FROM orders WHERE order_status = 'pending'"),
            pool.query("SELECT COUNT(*) FROM orders WHERE order_status = 'completed'"),
        ]);
        const totalItemsRes = await pool.query("SELECT SUM(quantity) FROM order_items");
        res.json({
            totalOrders: parseInt(totalOrdersRes.rows[0].count, 10),
            pendingOrders: parseInt(pendingOrdersRes.rows[0].count, 10),
            completedOrders: parseInt(completedOrdersRes.rows[0].count, 10),
            totalItems: parseInt(totalItemsRes.rows[0].sum, 10) || 0,
        });
    } catch (error) {
        console.error('Summary fetch error:', error);
        res.status(500).json({ message: '獲取總覽數據失敗' });
    }
});

app.get('/api/reports/daily-export', verifyToken, verifyAdmin, async (req, res) => {
    const date = req.query.date ? new Date(req.query.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    try {
        const client = await pool.connect();
        const userActivityQuery = `
            SELECT u.name as user_name, COUNT(*) as total_actions,
                   SUM(CASE WHEN action_type LIKE '%_pick' THEN 1 ELSE 0 END) as pick_actions,
                   SUM(CASE WHEN action_type LIKE '%_pack' THEN 1 ELSE 0 END) as pack_actions,
                   SUM(CASE WHEN action_type = 'scan_pick' THEN 1 ELSE 0 END) as scan_pick_actions,
                   SUM(CASE WHEN action_type = 'manual_pick' THEN 1 ELSE 0 END) as manual_pick_actions
            FROM action_logs al JOIN users u ON al.user_id = u.id
            WHERE DATE(al.created_at) = $1 GROUP BY u.name ORDER BY total_actions DESC`;
        const userActivityRes = await client.query(userActivityQuery, [date]);

        const errorLogsQuery = `
            SELECT TO_CHAR(el.created_at, 'YYYY-MM-DD HH24:MI:SS') as timestamp, u.name as user_name, el.error_type, el.scanned_barcode, el.context
            FROM error_logs el JOIN users u ON el.user_id = u.id
            WHERE DATE(el.created_at) = $1 ORDER BY el.created_at DESC`;
        const errorLogsRes = await client.query(errorLogsQuery, [date]);
        client.release();

        const workbook = xlsx.utils.book_new();
        const userSheet = xlsx.utils.json_to_sheet(userActivityRes.rows.map(u => ({
            '使用者': u.user_name, '總操作次數': parseInt(u.total_actions), '總揀貨次數': parseInt(u.pick_actions),
            '總裝箱次數': parseInt(u.pack_actions), '掃描揀貨': parseInt(u.scan_pick_actions), '手動揀貨': parseInt(u.manual_pick_actions),
        })));
        XLSX.utils.book_append_sheet(workbook, userSheet, '使用者活動總覽');

        const errorSheet = xlsx.utils.json_to_sheet(errorLogsRes.rows.map(e => ({
            '時間': e.timestamp, '操作員': e.user_name, '錯誤類型': e.error_type,
            '掃描內容': e.scanned_barcode, '附註': JSON.stringify(e.context)
        })));
        XLSX.utils.book_append_sheet(workbook, errorSheet, '錯誤日誌');

        const buffer = xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' });
        res.setHeader('Content-Disposition', `attachment; filename="Daily_Report_${date}.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.status(200).send(buffer);
    } catch (error) {
        console.error('Daily report export error:', error);
        res.status(500).json({ message: '匯出日報表失敗' });
    }
});


// --- 訂單核心操作 (Order Operations) ---
app.post('/api/orders/import', verifyToken, upload.single('orderFile'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: '沒有上傳檔案' });
    const filePath = req.file.path;
    let client;
    try {
        client = await pool.connect();
        const workbook = xlsx.readFile(filePath);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const getCellValue = (address) => { const cell = worksheet[address]; return cell && cell.v ? String(cell.v).trim() : ''; };

        const voucherNumber = getCellValue('A2').split(/[:：]/).pop().trim();
        if (!voucherNumber) throw new Error('Excel 檔案 A2 儲存格缺少憑證號碼！');
        
        const customerName = getCellValue('A3').split(/[:：]/).pop().trim();
        const warehouse = getCellValue('A4').split(/[:：]/).pop().trim();
        const itemsMap = new Map();
        const jsonData = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
        const headerIndex = jsonData.findIndex(row => String(row[0]).includes('品項編碼'));
        if (headerIndex === -1) throw new Error("找不到 '品項編碼' 欄位");

        for (let i = headerIndex + 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            const code = String(row[0]).trim().replace(/\s/g, '');
            const qty = parseInt(String(row[2]), 10) || 0;
            if (code && qty > 0) {
                if (itemsMap.has(code)) {
                    const existingItem = itemsMap.get(code);
                    existingItem.quantity += qty;
                } else {
                    itemsMap.set(code, { 
                        product_name: String(row[1] || '').trim(), 
                        quantity: qty 
                    });
                }
            }
        }
        
        await client.query('BEGIN');
        await client.query("DELETE FROM orders WHERE voucher_number = $1", [voucherNumber]);
        const orderRes = await client.query(
            "INSERT INTO orders (voucher_number, customer_name, warehouse, order_status) VALUES ($1, $2, $3, 'pending') RETURNING id", 
            [voucherNumber, customerName, warehouse]
        );
        const orderId = orderRes.rows[0].id;
        
        const itemInsertPromises = Array.from(itemsMap.entries()).map(([code, item]) => 
            client.query(
                "INSERT INTO order_items (order_id, product_code, product_name, quantity) VALUES ($1, $2, $3, $4)",
                [orderId, code, item.product_name, item.quantity]
            )
        );
        await Promise.all(itemInsertPromises);
        
        await client.query('COMMIT');
        
        const finalItemsRes = await client.query("SELECT id, product_code as sku, product_code as barcode, product_name as itemName, quantity, picked_quantity as pickedQty, packed_quantity as packedQty FROM order_items WHERE order_id = $1 ORDER BY id", [orderId]);

        res.status(201).json({
            message: `訂單 ${voucherNumber} 已成功匯入/更新！`,
            orderHeader: { dbId: orderId, voucherNumber, customerName, warehouse },
            items: finalItemsRes.rows
        });

    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error('Order import failed:', err);
        res.status(500).json({ message: err.message || '伺服器內部錯誤，操作已還原' });
    } finally {
        if (client) client.release();
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
});

app.post('/api/orders/update-item', verifyToken, async (req, res) => {
    const { orderDbId, sku, type, change, source } = req.body;
    const userId = req.user.id;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        
        const itemRes = await client.query("SELECT * FROM order_items WHERE order_id = $1 AND product_code = $2 FOR UPDATE", [orderDbId, sku]);
        if (itemRes.rows.length === 0) throw new Error('找不到該品項');
        
        const item = itemRes.rows[0];
        let newPickedQty = item.picked_quantity;
        let newPackedQty = item.packed_quantity;
        let updateField = '';
        
        if (type === 'pick') {
            updateField = 'picked_quantity';
            newPickedQty += change;
            if (newPickedQty < 0 || newPickedQty > item.quantity) throw new Error('揀貨數量超出範圍');
        } else if (type === 'pack') {
            updateField = 'packed_quantity';
            newPackedQty += change;
            if (newPackedQty < 0 || newPackedQty > item.picked_quantity) throw new Error('裝箱數量不能超過已揀貨數量');
        } else {
            throw new Error('無效的操作類型');
        }

        const updatedItemRes = await client.query(`UPDATE order_items SET ${updateField} = $1 WHERE id = $2 RETURNING *`, [type === 'pick' ? newPickedQty : newPackedQty, item.id]);

        await client.query(
            "INSERT INTO action_logs (order_id, order_item_id, user_id, action_type, quantity_change) VALUES ($1, $2, $3, $4, $5)",
            [orderDbId, item.id, userId, `${source}_${type}`, change]
        );
        
        await client.query('COMMIT');
        res.status(200).json({ message: '更新成功', item: updatedItemRes.rows[0] });

    } catch (err) {
        if (client) await client.query('ROLLBACK');
        console.error('Update item error:', err);
        res.status(400).json({ message: err.message || '操作失敗，資料已還原' });
    } finally {
        if (client) client.release();
    }
});

// --- 日誌記錄 (Logging) ---
app.post('/api/logs/error', verifyToken, async (req, res) => {
    const { orderId, errorType, barcode, context } = req.body;
    const userId = req.user.id;
    try {
        await pool.query(
            "INSERT INTO error_logs (order_id, user_id, error_type, scanned_barcode, context) VALUES ($1, $2, $3, $4, $5)",
            [orderId, userId, errorType, barcode, JSON.stringify(context)]
        );
        res.status(201).json({ message: "錯誤已記錄" });
    } catch (error) {
        console.error('Error logging failed:', error);
        res.status(500).json({ message: "記錄錯誤時發生伺服器問題" });
    }
});

// =================================================================
//                         啟動伺服器
// =================================================================
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`核心後端伺服器 (v3.1) 正在 http://localhost:${PORT} 上運行`);
});