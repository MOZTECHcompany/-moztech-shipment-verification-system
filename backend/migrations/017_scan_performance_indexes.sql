-- ========================================================
-- 掃描效能優化索引
-- 執行時間：2026-03-04
-- 目的：降低大量歷史資料與大量 SN 下的掃描延遲
-- ========================================================

-- 1) 掃描條碼時，快速定位同訂單下的品項
CREATE INDEX IF NOT EXISTS idx_order_items_order_id_barcode
ON order_items(order_id, barcode);

-- 2) 完成度聚合與狀態判斷：加速依 order_item_id + status 的統計
CREATE INDEX IF NOT EXISTS idx_order_item_instances_order_item_id_status
ON order_item_instances(order_item_id, status);

-- 3) 數字型 SN fallback 比對：加速 regexp_replace(serial_number, ...)
CREATE INDEX IF NOT EXISTS idx_order_item_instances_serial_digits
ON order_item_instances ((regexp_replace(serial_number, '[^0-9]', '', 'g')));

-- 建議更新統計資訊，讓查詢規劃器盡快吃到新索引
ANALYZE order_items;
ANALYZE order_item_instances;
