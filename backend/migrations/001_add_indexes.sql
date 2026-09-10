-- ========================================================
-- 資料庫效能優化 - 新增索引
-- 執行時間：2025-11-12
-- 目的：加速訂單查詢，特別是 /api/tasks 端點
-- ========================================================

-- 為 orders 表新增索引
-- 這些索引將大幅提升查詢效能，特別是在資料量增加時

-- 1. status 欄位索引（最常用的查詢條件）
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- 2. picker_id 欄位索引（用於查詢揀貨人員的任務）
CREATE INDEX IF NOT EXISTS idx_orders_picker_id ON orders(picker_id);

-- 3. packer_id 欄位索引（用於查詢裝箱人員的任務）
CREATE INDEX IF NOT EXISTS idx_orders_packer_id ON orders(packer_id);

-- 4. created_at 欄位索引（用於排序）
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);

-- 5. 複合索引：status + created_at（針對最常見的查詢模式優化）
-- 這個索引對於 "WHERE status = 'pending' ORDER BY created_at" 這類查詢特別有效
CREATE INDEX IF NOT EXISTS idx_orders_status_created_at ON orders(status, created_at);

-- 6. 複合索引：status + picker_id（針對揀貨人員查詢優化）
CREATE INDEX IF NOT EXISTS idx_orders_status_picker_id ON orders(status, picker_id) WHERE picker_id IS NOT NULL;

-- 7. 複合索引：status + packer_id（針對裝箱人員查詢優化）
CREATE INDEX IF NOT EXISTS idx_orders_status_packer_id ON orders(status, packer_id) WHERE packer_id IS NOT NULL;

-- 額外優化：為其他常用表格新增索引

-- order_items 表
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_barcode ON order_items(barcode);

-- order_item_instances 表
CREATE INDEX IF NOT EXISTS idx_order_item_instances_order_item_id ON order_item_instances(order_item_id);
CREATE INDEX IF NOT EXISTS idx_order_item_instances_serial_number ON order_item_instances(serial_number);
CREATE INDEX IF NOT EXISTS idx_order_item_instances_status ON order_item_instances(status);

-- operation_logs 表
CREATE INDEX IF NOT EXISTS idx_operation_logs_order_id ON operation_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_operation_logs_user_id ON operation_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_operation_logs_created_at ON operation_logs(created_at);

-- 顯示建立成功的訊息
DO $$
BEGIN
    RAISE NOTICE '索引建立完成！';
    RAISE NOTICE '建議執行 ANALYZE 命令以更新資料庫統計資訊：';
    RAISE NOTICE '  ANALYZE orders;';
    RAISE NOTICE '  ANALYZE order_items;';
    RAISE NOTICE '  ANALYZE order_item_instances;';
    RAISE NOTICE '  ANALYZE operation_logs;';
END $$;

-- 更新資料庫統計資訊（可選，但強烈建議）
ANALYZE orders;
ANALYZE order_items;
ANALYZE order_item_instances;
ANALYZE operation_logs;
