-- 014_exception_reject.sql
-- 新增例外「駁回」狀態與留痕欄位（rejected）

ALTER TABLE order_exceptions
    ADD COLUMN IF NOT EXISTS rejected_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE order_exceptions
    ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP NULL;

ALTER TABLE order_exceptions
    ADD COLUMN IF NOT EXISTS rejected_note TEXT NULL;

-- 更新狀態約束：open/ack/resolved/rejected
ALTER TABLE order_exceptions DROP CONSTRAINT IF EXISTS chk_order_exceptions_status;
ALTER TABLE order_exceptions
    ADD CONSTRAINT chk_order_exceptions_status CHECK (
        status IN ('open','ack','resolved','rejected')
    );

CREATE INDEX IF NOT EXISTS idx_order_exceptions_rejected_at ON order_exceptions(rejected_at);
