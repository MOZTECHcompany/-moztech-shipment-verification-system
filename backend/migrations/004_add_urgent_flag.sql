-- 004_add_urgent_flag.sql
-- 為訂單表添加緊急標記功能，讓管理員可以將訂單標記為緊急

-- 添加 is_urgent 欄位
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'orders' AND column_name = 'is_urgent'
    ) THEN
        ALTER TABLE orders 
        ADD COLUMN is_urgent BOOLEAN DEFAULT FALSE;
        
        -- 為現有訂單設置預設值
        UPDATE orders SET is_urgent = FALSE WHERE is_urgent IS NULL;
        
        RAISE NOTICE '成功添加 is_urgent 欄位到 orders 表';
    ELSE
        RAISE NOTICE 'is_urgent 欄位已存在，跳過';
    END IF;
END $$;

-- 創建索引以加速按緊急程度查詢
CREATE INDEX IF NOT EXISTS idx_orders_urgent ON orders(is_urgent, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status_urgent ON orders(status, is_urgent, created_at);

-- 添加註釋
COMMENT ON COLUMN orders.is_urgent IS '是否為緊急訂單（管理員可設置）';

-- 驗證資料
DO $$
DECLARE
    total_count INTEGER;
    urgent_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_count FROM orders;
    SELECT COUNT(*) INTO urgent_count FROM orders WHERE is_urgent = TRUE;
    
    RAISE NOTICE '訂單表總記錄數: %', total_count;
    RAISE NOTICE '緊急訂單數: %', urgent_count;
END $$;
