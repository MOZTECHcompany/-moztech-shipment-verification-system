-- 009_add_completed_at.sql
-- 為 orders 表補齊 completed_at 欄位（避免完成裝箱時 500）

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'orders'
          AND column_name = 'completed_at'
    ) THEN
        ALTER TABLE orders
        ADD COLUMN completed_at TIMESTAMPTZ;

        RAISE NOTICE '成功添加 completed_at 欄位到 orders 表';
    ELSE
        RAISE NOTICE 'completed_at 欄位已存在，跳過';
    END IF;
END $$;

-- 若有 completed_at，建立索引可加速分析/報表查詢（idempotent）
CREATE INDEX IF NOT EXISTS idx_orders_completed_at ON orders(completed_at);

COMMENT ON COLUMN orders.completed_at IS '訂單完成時間（裝箱完成後轉 completed 時寫入）';
