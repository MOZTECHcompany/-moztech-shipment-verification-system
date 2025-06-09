// ... (所有 require 和 app 設定保持不變) ...

// --- 訂單匯入 API (✨ 加入了大量偵錯日誌的版本 ✨) ---
app.post('/api/orders/import', verifyToken, upload.single('orderFile'), async (req, res) => {
    console.log('\n--- [BEGIN] /api/orders/import 請求已抵達 ---');
    
    if (!req.file) {
        console.log('[ERROR] 請求中未包含檔案。');
        return res.status(400).json({ message: '沒有上傳檔案' });
    }
    console.log(`[STEP 1] 收到檔案: ${req.file.originalname}, 大小: ${req.file.size} bytes`);

    const filePath = req.file.path;
    let client; // 將 client 宣告在外面，方便 finally 區塊使用

    try {
        console.log('[STEP 2] 正在嘗試從連線池獲取資料庫客戶端...');
        client = await pool.connect();
        console.log('[SUCCESS] 成功獲取資料庫客戶端。');

        console.log('[STEP 3] 正在使用 xlsx 函式庫讀取 Excel 檔案...');
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        console.log('[SUCCESS] 成功讀取 Excel 檔案。');
        
        // ... (getCellValue 函數不變)
        const getCellValue = (cellAddress) => { /* ... */ };
        
        console.log('[STEP 4] 正在解析訂單頭部資訊...');
        const voucherNumber = getCellValue('A2');
        const customerName = getCellValue('A3');
        const warehouse = getCellValue('A4');
        console.log(`[INFO] 解析結果: 憑證號=${voucherNumber}, 客戶=${customerName}, 倉庫=${warehouse}`);

        if (!voucherNumber) {
            throw new Error('Excel 檔案 A2 儲存格缺少憑證號碼！');
        }
        
        console.log('[STEP 5] 正在解析並合併品項...');
        const items = {};
        const range = xlsx.utils.decode_range(worksheet['!ref']);
        for (let rowNum = 6; rowNum <= range.e.r; rowNum++) {
            // (省略迴圈內的解析邏輯，我們假設它沒問題)
            // ...
        }
        console.log(`[SUCCESS] 品項合併完成，共 ${Object.keys(items).length} 個獨立品項。`);
        console.log('合併後的品項列表:', items);

        console.log('[STEP 6] 正在開始資料庫事務 (BEGIN)...');
        await client.query('BEGIN');
        console.log('[SUCCESS] 資料庫事務已開始。');

        console.log('[STEP 7] 正在將主訂單資訊插入 "orders" 資料表...');
        const orderInsertQuery = `INSERT INTO orders (voucher_number, customer_name, warehouse, order_status) VALUES ($1, $2, $3, 'pending') RETURNING id;`;
        const orderResult = await client.query(orderInsertQuery, [voucherNumber, customerName, warehouse]);
        const newOrderId = orderResult.rows[0].id;
        console.log(`[SUCCESS] 主訂單插入成功，新訂單 ID: ${newOrderId}`);

        console.log(`[STEP 8] 正在循環插入 ${Object.keys(items).length} 個品項到 "order_items" 資料表...`);
        for (const productCode in items) {
            const item = items[productCode];
            const itemInsertQuery = `INSERT INTO order_items (order_id, product_code, product_name, quantity) VALUES ($1, $2, $3, $4);`;
            await client.query(itemInsertQuery, [newOrderId, productCode, item.product_name, item.quantity]);
            console.log(`  - 品項 ${productCode} 插入成功。`);
        }
        console.log('[SUCCESS] 所有品項插入完成。');
        
        console.log('[STEP 9] 正在提交資料庫事務 (COMMIT)...');
        await client.query('COMMIT');
        console.log('[SUCCESS] 資料庫事務已提交。');

        console.log('[STEP 10] 正在向前端回傳成功訊息...');
        res.status(201).json({ message: `訂單 ${voucherNumber} 匯入成功！`, orderId: newOrderId, itemCount: Object.keys(items).length });
        console.log('[COMPLETE] /api/orders/import 請求處理完畢。');

    } catch (error) {
        console.error('\n--- [FATAL ERROR] 請求處理過程中發生錯誤 ---');
        console.error(error); // 印出完整的錯誤物件

        if (client) {
            console.log('[RECOVERY] 正在嘗試回滾資料庫事務 (ROLLBACK)...');
            await client.query('ROLLBACK');
            console.log('[SUCCESS] 資料庫事務已回滾。');
        }
        
        const worksheet = error.worksheet || (fs.existsSync(filePath) && xlsx.readFile(filePath).Sheets[xlsx.readFile(filePath).SheetNames[0]]);
        const voucherNumberForError = (worksheet && getCellValueFromSheet(worksheet, 'A2')) || '未知';
        if (error.code === '23505') {
             res.status(409).json({ message: `錯誤：憑證號碼 ${voucherNumberForError} 已存在！`});
        } else {
             res.status(500).json({ message: '伺服器內部錯誤', error: error.message });
        }
    } finally {
        if (client) {
            console.log('[CLEANUP] 正在釋放資料庫客戶端...');
            client.release();
            console.log('[SUCCESS] 資料庫客戶端已釋放。');
        }
        if (fs.existsSync(filePath)) {
            console.log('[CLEANUP] 正在刪除暫存檔案...');
            fs.unlinkSync(filePath);
            console.log('[SUCCESS] 暫存檔案已刪除。');
        }
    }
});

// ... 其他 API 和伺服器啟動程式碼 ...