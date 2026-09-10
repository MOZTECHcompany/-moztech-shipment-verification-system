-- ========================================================
-- 訂單例外查詢效能優化索引
-- 執行時間：2026-03-04
-- 目的：加速掃描/認領流程中對 open 例外與 order_change 的即時檢查
-- ========================================================

CREATE INDEX IF NOT EXISTS idx_order_exceptions_order_status
ON order_exceptions(order_id, status);

CREATE INDEX IF NOT EXISTS idx_order_exceptions_order_status_type
ON order_exceptions(order_id, status, type);

ANALYZE order_exceptions;
