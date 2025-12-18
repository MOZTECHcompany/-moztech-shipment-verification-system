-- 016_add_order_items_updated_at.sql
-- 修復 order_items 缺少 updated_at 欄位（避免 undefined_column / 42703）

ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 若舊資料 updated_at 可能為 NULL，補成 CURRENT_TIMESTAMP
UPDATE order_items
SET updated_at = CURRENT_TIMESTAMP
WHERE updated_at IS NULL;

-- updated_at 自動更新
CREATE OR REPLACE FUNCTION update_order_items_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_order_items_timestamp ON order_items;
CREATE TRIGGER trigger_update_order_items_timestamp
    BEFORE UPDATE ON order_items
    FOR EACH ROW
    EXECUTE FUNCTION update_order_items_timestamp();
