-- 011_exception_attachments_and_resolution_action.sql
-- 例外流程升級：結案必填處置類型 + 證據附件

BEGIN;

-- 1) 結案處置類型（由 API 控制必填與可用值）
ALTER TABLE order_exceptions
ADD COLUMN IF NOT EXISTS resolution_action TEXT;

-- 2) 附件表（照片/文件等）
CREATE TABLE IF NOT EXISTS order_exception_attachments (
    id BIGSERIAL PRIMARY KEY,
    exception_id BIGINT NOT NULL REFERENCES order_exceptions(id) ON DELETE CASCADE,
    order_id BIGINT NOT NULL,
    storage_key TEXT NOT NULL,
    original_name TEXT,
    mime_type TEXT,
    size_bytes INTEGER,
    uploaded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_exception_attachments_exception_id
    ON order_exception_attachments(exception_id);

CREATE INDEX IF NOT EXISTS idx_order_exception_attachments_order_id
    ON order_exception_attachments(order_id);

COMMIT;
