// =================================================================
//         Moztech WMS - 核心後端 API 伺服器 (v2 - 資料庫驅動版)
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
// ✨ 注意：這裡的 URL 應該換成你部署的前端 URL
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

// 2. 資料庫連線池與 JWT 設定
const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL, // Render.com 通常使用 DATABASE_URL
    ssl: { rejectUnauthorized: false } 
});
const JWT_SECRET = process.env.JWT_SECRET;

// 3. 權限驗證中介軟體
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ message: '未提供權杖' });
    jwt.verify(token, JWT_SECRET, (err, user) => { if (err) return res.status(403).json({ message: '無效權杖' }); req.user = user; next(); });
};
const verifyAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') { next(); } else { res.status(403).json({ message: '權限不足，需要管理員身份' }); }
};

// =================================================================
//                         API 路由 (Endpoints)
// =================================================================

// 根目錄健康檢查
app.get('/', (req, res) => res.status(200).send('Moztech WMS API Server (v2) is running.'));

// =================== 使用者與權限 (Auth & Users) ===================

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const userResult = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
        if (userResult.rows.length === 0) return res.status(401).json({ message: '使用者名稱或密碼錯誤' });
        const user = userResult.rows[0];
        const isMatch = await bcrypt.compare(String(password), user.password_hash);
        if (!isMatch) return res.status(401).json({ message: '使用者名稱或密碼錯誤' });
        const token = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ message: '登入成功', token: token, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
    } catch (error) { console.error('Login error:', error); res.status(500).json({ message: '伺服器內部錯誤' }); }
});

app.post('/api/auth/register', verifyToken, verifyAdmin, async (req, res) => {
    const { username, password, role, name } = req.body;
    if (!username || !password || !role || !name) return res.status(400).json({ message: '使用者名稱、密碼、姓名和角色不能為空' });
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await pool.query( "INSERT INTO users (username, password_hash, role, name) VALUES ($1, $2, $3, $4) RETURNING id, username, role, name", [username, hashedPassword, role, name] );
        res.status(201).json({ message: `使用者 ${newUser.rows[0].name} 註冊成功`, user: newUser.rows[0] });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ message: '此使用者名稱已被註冊' });
        console.error('Register error:', error);
        res.status(500).json({ message: '伺服器內部錯誤' });
    }
});

// =================== 報表與總覽 (Reports & Summary) ===================

app.get('/api/reports/summary', verifyToken, async (req, res) => {
    try {
        const [ totalOrdersRes, pendingOrdersRes, completedOrdersRes ] = await Promise.all([
            pool.query("SELECT COUNT(*) FROM orders"),
            pool.query("SELECT COUNT(*) FROM orders WHERE order_status = 'pending'"),
            pool.query("SELECT COUNT(*) FROM orders WHERE order_status = 'completed'")
        ]);
        const totalItemsRes = await pool.query("SELECT SUM(quantity) FROM order_items");
        res.json({
            totalOrders: parseInt(totalOrdersRes.rows[0].count, 10),
            pendingOrders: parseInt(pendingOrdersRes.rows[0].count, 10),
            completedOrders: parseInt(completedOrdersRes.rows[0].count, 10),
            totalItems: parseInt(totalItemsRes.rows[0].sum, 10) || 0,
        });
    } catch (error) { console.error('Summary fetch error:', error); res.status(500).json({ message: '獲取總覽數據失敗' }); }
});

// =================== 訂單核心操作 (Order Operations) ===================

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
        await client.query("DELETE FROM orders WHERE voucher_number = $1", [voucherNumber]); // 允許覆蓋
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
        
        // ✨【重大修改】匯入成功後，直接回傳詳細資料給前端
        const finalItemsRes = await client.query("SELECT id, product_code as sku, product_code as barcode, product_name as itemName, quantity, picked_quantity as pickedQty, packed_quantity as packedQty FROM order_items WHERE order_id = $1 ORDER BY id", [orderId]);

        res.status(201).json({
            message: `訂單 ${voucherNumber} 已成功匯入/更新！`,
            orderHeader: {
                dbId: orderId,
                voucherNumber: voucherNumber,
                customerName: customerName,
                warehouse: warehouse,
            },
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


// ✨【新 API】更新單一品項數量，並記錄操作
app.post('/api/orders/update-item', verifyToken, async (req, res) => {
    const { orderDbId, sku, type, change, source } = req.body; // type: 'pick' or 'pack'; change: 1 or -1; source: 'scan' or 'manual'
    const userId = req.user.id;
    
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        
        // 鎖定該品項以防止多人同時操作的競爭條件
        const itemRes = await client.query("SELECT * FROM order_items WHERE order_id = $1 AND product_code = $2 FOR UPDATE", [orderDbId, sku]);
        if (itemRes.rows.length === 0) throw new Error('找不到該品項');
        
        const item = itemRes.rows[0];
        let newPickedQty = item.picked_quantity;
        let newPackedQty = item.packed_quantity;
        let updateField = '';
        
        // 驗證並計算新數量
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

        // 更新品項數量
        const updatedItemRes = await client.query(`UPDATE order_items SET ${updateField} = $1 WHERE id = $2 RETURNING *`, [type === 'pick' ? newPickedQty : newPackedQty, item.id]);

        // 記錄操作日誌
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

app.patch('/api/orders/:id/void', verifyToken, verifyAdmin, async (req, res) => {
    // (此功能不變)
});


// =================== 日誌記錄 (Logging) ===================

// ✨【新 API】記錄前端操作錯誤
app.post('/api/logs/error', verifyToken, async (req, res) => {
    const { orderId, errorType, barcode, context } = req.body;
    const userId = req.user.id;
    try {
        await pool.query(
            "INSERT INTO error_logs (order_id, user_id, error_type, scanned_barcode, context) VALUES ($1, $2, $3, $4, $5)",
            [orderId, userId, errorType, barcode, context]
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
    console.log(`核心後端伺服器 (v2) 正在 http://localhost:${PORT} 上運行`);
});