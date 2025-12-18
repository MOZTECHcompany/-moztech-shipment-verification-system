-- 015_fix_order_exceptions_columns.sql
-- 修復既有 order_exceptions 表欄位缺失（避免 undefined_column / 42703）
-- 目標：讓新版 API 在舊 schema 上也能正常寫入

-- 可能缺失的欄位：order_item_id / instance_id / snapshot / reason_code / reason_text / created_by / status / type / timestamps
-- 這裡一律使用 IF NOT EXISTS，讓重複執行是安全的。

ALTER TABLE order_exceptions
    ADD COLUMN IF NOT EXISTS order_item_id INTEGER NULL REFERENCES order_items(id) ON DELETE SET NULL;

ALTER TABLE order_exceptions
    ADD COLUMN IF NOT EXISTS instance_id INTEGER NULL REFERENCES order_item_instances(id) ON DELETE SET NULL;

ALTER TABLE order_exceptions
    ADD COLUMN IF NOT EXISTS reason_code VARCHAR(50) NULL;

ALTER TABLE order_exceptions
    ADD COLUMN IF NOT EXISTS reason_text TEXT NULL;

ALTER TABLE order_exceptions
    ADD COLUMN IF NOT EXISTS created_by INTEGER NULL REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE order_exceptions
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE order_exceptions
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE order_exceptions
    ADD COLUMN IF NOT EXISTS type VARCHAR(30) NOT NULL DEFAULT 'other';

ALTER TABLE order_exceptions
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'open';

ALTER TABLE order_exceptions
    ADD COLUMN IF NOT EXISTS snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 若舊資料存在 snapshot 為 NULL，補成空物件（避免 jsonb_set / COALESCE 行為不一致）
UPDATE order_exceptions
SET snapshot = '{}'::jsonb
WHERE snapshot IS NULL;
