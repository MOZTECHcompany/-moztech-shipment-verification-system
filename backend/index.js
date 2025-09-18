const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Papa = require('papaparse'); // 新增：用於生成 CSV

require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

// --- 中介軟體 (Middleware) ---
app.use(cors());
app.use(express.json());

// --- 資料庫連線設定 ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// --- JWT 認證中介軟體 ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// --- 管理員權限驗證中介軟體 ---
const authorizeAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: '權限不足，此操作需要管理員權限' });
    }
    next();
};

// --- Helper 函數: 記錄操作日誌 ---
const logOperation = async (userId, orderId, operationType, details) => {
    try {
        await pool.query(
            'INSERT INTO operation_logs (user_id, order_id, operation_type, details) VALUES ($1, $2, $3, $4)',
            [userId, orderId, operationType, JSON.stringify(details)]
        );
    } catch (error) {
        console.error('記錄操作日誌失敗:', error);
    }
};

// --- Multer 設定 (用於檔案上傳) ---
const upload = multer({ storage: multer.memoryStorage() });

// --- 資料庫初始化 ---
const initializeDatabase = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                name VARCHAR(100),
                role VARCHAR(20) NOT NULL CHECK (role IN ('picker', 'packer', 'admin')),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                voucher_number VARCHAR(100) UNIQUE NOT NULL,
                customer_name VARCHAR(255),
                warehouse VARCHAR(100),
                status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP WITH TIME ZONE
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS order_items (
                id SERIAL PRIMARY KEY,
                order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
                product_code VARCHAR(100) NOT NULL,
                product_name VARCHAR(255),
                quantity INTEGER NOT NULL,
                picked_quantity INTEGER DEFAULT 0,
                packed_quantity INTEGER DEFAULT 0
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS operation_logs (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                order_id INTEGER,
                operation_type VARCHAR(50),
                details JSONB,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('資料庫表單檢查/建立完成');
    } catch (err) {
        console.error('初始化資料庫失敗:', err);
    }
};


// =============================================
// API 路由 (Routes)
// =============================================

// --- 健康檢查 ---
app.get('/', (req, res) => {
    res.send('Moztech WMS API is running!');
});

// --- 使用者認證 API ---
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: '請提供使用者名稱和密碼' });
    }
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];
        if (!user) return res.status(400).json({ message: '無效的使用者名稱或密碼' });

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) return res.status(400).json({ message: '無效的使用者名稱或密碼' });

        const accessToken = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role }, process.env.JWT_SECRET, { expiresIn: '8h' });
        res.json({ accessToken, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
    } catch (err) {
        console.error('登入失敗:', err);
        res.status(500).json({ message: '伺服器內部錯誤' });
    }
});

// --- 管理員 API ---
app.post('/api/admin/create-user', authenticateToken, authorizeAdmin, async (req, res) => {
    const { username, password, name, role } = req.body;
    if (!username || !password || !name || !role) {
        return res.status(400).json({ message: '缺少必要欄位' });
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users (username, password, name, role) VALUES ($1, $2, $3, $4)',
            [username, hashedPassword, name, role]
        );
        res.status(201).json({ message: `使用者 ${username} (${role}) 已成功建立` });
    } catch (err) {
        if (err.code === '23505') { // Unique violation
            return res.status(409).json({ message: '使用者名稱已存在' });
        }
        console.error('建立使用者失敗:', err);
        res.status(500).json({ message: '伺服器內部錯誤' });
    }
});

// --- 訂單處理 API ---
app.post('/api/orders/import', authenticateToken, upload.single('orderFile'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: '沒有上傳檔案' });

    const client = await pool.connect();
    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

        // 從 Excel 解析訂單資訊 (假設格式固定)
        const voucherNumber = data[1][1];
        const customerName = data[2][1];
        const warehouse = data[3][1];
        const itemsData = data.slice(6).filter(row => row[0]); // 從第7行開始是品項資料

        if (!voucherNumber) return res.status(400).json({ message: 'Excel 檔案缺少單據編號' });

        await client.query('BEGIN');

        // 檢查訂單是否已存在
        const existingOrder = await client.query('SELECT id FROM orders WHERE voucher_number = $1', [voucherNumber]);
        if (existingOrder.rows.length > 0) {
             await client.query('ROLLBACK');
             return res.status(409).json({ message: `訂單 ${voucherNumber} 已存在，請勿重複匯入` });
        }

        const orderInsertResult = await client.query(
            'INSERT INTO orders (voucher_number, customer_name, warehouse) VALUES ($1, $2, $3) RETURNING id',
            [voucherNumber, customerName, warehouse]
        );
        const orderId = orderInsertResult.rows[0].id;

        for (const row of itemsData) {
            await client.query(
                'INSERT INTO order_items (order_id, product_code, product_name, quantity) VALUES ($1, $2, $3, $4)',
                [orderId, row[1], row[2], parseInt(row[3], 10)]
            );
        }

        await client.query('COMMIT');
        
        await logOperation(req.user.id, orderId, 'import', { voucherNumber });

        res.status(201).json({ message: '訂單匯入成功', orderId: orderId, voucherNumber: voucherNumber });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('匯入訂單失敗:', err);
        res.status(500).json({ message: '處理 Excel 檔案時發生錯誤' });
    } finally {
        client.release();
    }
});

app.get('/api/orders/:orderId', authenticateToken, async (req, res) => {
    try {
        const { orderId } = req.params;
        const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
        const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);

        if (orderResult.rows.length === 0) {
            return res.status(404).json({ message: '找不到訂單' });
        }
        res.json({ order: orderResult.rows[0], items: itemsResult.rows });
    } catch (err) {
        console.error('獲取訂單詳情失敗:', err);
        res.status(500).json({ message: '伺服器內部錯誤' });
    }
});

app.post('/api/orders/update_item', authenticateToken, async (req, res) => {
    const { orderId, sku, type, amount } = req.body;
    const { role } = req.user;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const itemResult = await client.query(
            'SELECT * FROM order_items WHERE order_id = $1 AND product_code = $2 FOR UPDATE',
            [orderId, sku]
        );
        if (itemResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: '在訂單中找不到此產品' });
        }
        
        const item = itemResult.rows[0];
        let newPickedQty = item.picked_quantity;
        let newPackedQty = item.packed_quantity;
        let updateQuery = '';

        if (type === 'pick') {
            if (!['picker', 'admin'].includes(role)) {
                 await client.query('ROLLBACK');
                 return res.status(403).json({ message: '權限不足，無法執行揀貨' });
            }
            newPickedQty += amount;
            if (newPickedQty < 0 || newPickedQty > item.quantity) {
                 await client.query('ROLLBACK');
                 return res.status(400).json({ message: '揀貨數量無效' });
            }
            updateQuery = 'UPDATE order_items SET picked_quantity = $1 WHERE id = $2';
            await client.query(updateQuery, [newPickedQty, item.id]);

        } else if (type === 'pack') {
            if (!['packer', 'admin'].includes(role)) {
                await client.query('ROLLBACK');
                return res.status(403).json({ message: '權限不足，無法執行裝箱' });
            }
            newPackedQty += amount;
            if (newPackedQty < 0 || newPackedQty > item.picked_quantity) {
                 await client.query('ROLLBACK');
                 return res.status(400).json({ message: '裝箱數量不能超過已揀貨數量' });
            }
            updateQuery = 'UPDATE order_items SET packed_quantity = $1 WHERE id = $2';
            await client.query(updateQuery, [newPackedQty, item.id]);
        } else {
             await client.query('ROLLBACK');
             return res.status(400).json({ message: '無效的操作類型' });
        }

        await client.query('UPDATE orders SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [orderId]);
        
        // 檢查訂單是否全部完成
        const allItemsResult = await client.query('SELECT quantity, packed_quantity FROM order_items WHERE order_id = $1', [orderId]);
        const isCompleted = allItemsResult.rows.every(i => i.packed_quantity >= i.quantity);
        
        if (isCompleted) {
            await client.query(
                `UPDATE orders SET status = 'completed', completed_at = CURRENT_TIMESTAMP 
                 WHERE id = $1 AND status != 'completed'`, 
                [orderId]
            );
        }

        await client.query('COMMIT');

        await logOperation(req.user.id, orderId, type, { sku, amount });

        // 返回更新後的整個訂單數據
        const updatedOrderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
        const updatedItemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
        res.json({ order: updatedOrderResult.rows[0], items: updatedItemsResult.rows });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('更新品項數量失敗:', err);
        res.status(500).json({ message: '伺服器內部錯誤' });
    } finally {
        client.release();
    }
});


app.patch('/api/orders/:orderId/void', authenticateToken, authorizeAdmin, async (req, res) => {
    const { orderId } = req.params;
    const { reason } = req.body;
    try {
        const result = await pool.query(
            "UPDATE orders SET status = 'voided', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING voucher_number",
            [orderId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ message: '找不到要作廢的訂單' });
        }
        
        await logOperation(req.user.id, orderId, 'void', { reason });

        res.json({ message: `訂單 ${result.rows[0].voucher_number} 已成功作廢` });
    } catch (error) {
        console.error('作廢訂單失敗:', error);
        res.status(500).json({ message: '伺服器內部錯誤' });
    }
});

// --- 報告相關 API ---
app.get('/api/reports/summary', authenticateToken, authorizeAdmin, async (req, res) => {
    // 這裡可以放報告總覽的邏輯
    res.json({ message: "Summary report endpoint" });
});

app.get('/api/reports/daily-orders', authenticateToken, authorizeAdmin, async (req, res) => {
    // 這裡可以放每日訂單趨勢的邏輯
    res.json({ message: "Daily orders report endpoint" });
});


// =============================================
//  【新增】管理員報告匯出 API
// =============================================
app.get('/api/reports/export', authenticateToken, authorizeAdmin, async (req, res) => {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
        return res.status(400).json({ message: '必須提供開始與結束日期' });
    }

    try {
        // 為了讓查詢包含結束日期的整天，我們在結束日期後加上時間
        const inclusiveEndDate = endDate + ' 23:59:59';

        // 1. 查詢在指定日期範圍內已完成或已作廢的訂單
        const orderResult = await pool.query(
            `SELECT id, voucher_number, status, completed_at, updated_at
             FROM orders
             WHERE (status = 'completed' AND completed_at BETWEEN $1 AND $2)
                OR (status = 'voided' AND updated_at BETWEEN $1 AND $2)
             ORDER BY updated_at DESC, completed_at DESC`,
            [startDate, inclusiveEndDate]
        );
        
        const orders = orderResult.rows;
        if (orders.length === 0) {
             // 注意：這裡返回 JSON 錯誤，以便前端能正確解析
            return res.status(404).json({ message: '在指定日期範圍內找不到任何已完成或作廢的訂單' });
        }
        
        const orderIds = orders.map(o => o.id);

        // 2. 一次性查詢所有相關訂單的品項總數
        const itemsResult = await pool.query(
            `SELECT order_id, SUM(quantity) as total_quantity
             FROM order_items
             WHERE order_id = ANY($1::int[])
             GROUP BY order_id`,
            [orderIds]
        );
        const itemCounts = itemsResult.rows.reduce((acc, row) => {
            acc[row.order_id] = row.total_quantity;
            return acc;
        }, {});


        // 3. 一次性查詢所有相關的操作日誌，並關聯使用者名稱
        const logsResult = await pool.query(
            `SELECT ol.order_id, ol.operation_type, ol.created_at, u.name as user_name
             FROM operation_logs ol
             JOIN users u ON ol.user_id = u.id
             WHERE ol.order_id = ANY($1::int[])`,
            [orderIds]
        );
        
        // 4. 將日誌按 order_id 分組，方便處理
        const logsByOrderId = logsResult.rows.reduce((acc, log) => {
            if (!acc[log.order_id]) {
                acc[log.order_id] = [];
            }
            acc[log.order_id].push(log);
            return acc;
        }, {});
        
        // 5. 組合最終報告數據
        const reportData = orders.map(order => {
            const orderLogs = logsByOrderId[order.id] || [];
            
            // 使用 Set 確保人員不重複
            const pickers = [...new Set(orderLogs.filter(l => l.operation_type === 'pick').map(l => l.user_name))].join(', ');
            const packers = [...new Set(orderLogs.filter(l => l.operation_type === 'pack').map(l => l.user_name))].join(', ');
            
            const voidLog = orderLogs.find(l => l.operation_type === 'void');

            // 使用 toLocaleString 格式化時間為台灣時區的本地時間格式
            const formatTime = (date) => date ? new Date(date).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '';

            return {
                "訂單編號": order.voucher_number,
                "訂單狀態": order.status === 'completed' ? '已完成' : '已作廢',
                "出貨總件數": itemCounts[order.id] || 0,
                "揀貨人員": pickers || '無紀錄',
                "裝箱人員": packers || '無紀錄',
                "出貨完成時間": order.status === 'completed' ? formatTime(order.completed_at) : '',
                "作廢人員": voidLog ? voidLog.user_name : '',
                "作廢時間": voidLog ? formatTime(voidLog.created_at) : '',
            };
        });
        
        // 6. 使用 papaparse 將 JSON 轉換為 CSV 字串
        const csv = Papa.unparse(reportData);

        // 7. 設定 response headers，觸發瀏覽器下載
        const fileName = `營運報告_${startDate}_至_${endDate}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        
        // 加上 BOM (Byte Order Mark) 確保 Excel 能正確識別 UTF-8 編碼，避免中文亂碼
        res.status(200).send('\uFEFF' + csv);

    } catch (error) {
        console.error('匯出報告時發生錯誤:', error);
        res.status(500).json({ message: '產生報告時發生內部伺服器錯誤' });
    }
});


// --- 啟動伺服器 ---
app.listen(port, async () => {
    await initializeDatabase();
    console.log(`伺服器正在 http://localhost:${port} 上運行`);
});