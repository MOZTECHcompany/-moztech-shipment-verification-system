// 快速修補腳本 - 添加 priority 欄位
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'shipment_verification',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
});

async function addPriorityColumn() {
    const client = await pool.connect();
    try {
        console.log('🔧 開始添加 priority 欄位...');
        
        // 檢查欄位是否存在
        const checkColumn = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'task_comments' AND column_name = 'priority'
        `);
        
        if (checkColumn.rows.length > 0) {
            console.log('✅ priority 欄位已存在，無需添加');
            return;
        }
        
        // 添加欄位
        await client.query(`
            ALTER TABLE task_comments 
            ADD COLUMN priority VARCHAR(20) DEFAULT 'normal'
        `);
        
        console.log('✅ priority 欄位添加成功');
        
        // 添加檢查約束
        await client.query(`
            ALTER TABLE task_comments 
            ADD CONSTRAINT check_priority 
            CHECK (priority IN ('normal', 'important', 'urgent'))
        `);
        
        console.log('✅ 優先級約束添加成功');
        
        // 創建索引
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_task_comments_priority 
            ON task_comments(priority)
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_task_comments_order_priority 
            ON task_comments(order_id, priority)
        `);
        
        console.log('✅ 索引創建成功');
        
        // 統計資訊
        const stats = await client.query('SELECT COUNT(*) as count FROM task_comments');
        console.log(`📊 任務評論表總記錄數: ${stats.rows[0].count}`);
        
    } catch (error) {
        console.error('❌ 執行失敗:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

addPriorityColumn()
    .then(() => {
        console.log('🎉 資料庫更新完成');
        process.exit(0);
    })
    .catch(error => {
        console.error('💥 資料庫更新失敗:', error);
        process.exit(1);
    });
