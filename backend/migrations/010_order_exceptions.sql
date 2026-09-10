-- 010_order_exceptions.sql
-- 訂單例外事件：缺貨/破損/多掃/少掃/SN更換等（open/ack/resolved）

CREATE TABLE IF NOT EXISTS order_exceptions (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,

    -- 關聯到品項/序號（可選）
    order_item_id INTEGER NULL REFERENCES order_items(id) ON DELETE SET NULL,
    instance_id INTEGER NULL REFERENCES order_item_instances(id) ON DELETE SET NULL,

    -- 例外類型
    type VARCHAR(30) NOT NULL,

    -- 流程狀態：open -> ack -> resolved
    status VARCHAR(20) NOT NULL DEFAULT 'open',

    -- 原因（可選用 code 做報表分類）
    reason_code VARCHAR(50) NULL,
    reason_text TEXT NULL,

    -- 建立/核可/結案
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    ack_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
    ack_at TIMESTAMP NULL,
    ack_note TEXT NULL,

    resolved_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP NULL,
    resolution_note TEXT NULL,

    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- 額外快照（掃描值、當下狀態、前端資訊等）
    snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT chk_order_exceptions_type CHECK (
        type IN ('stockout','damage','over_scan','under_scan','sn_replace','other')
    ),
    CONSTRAINT chk_order_exceptions_status CHECK (
        status IN ('open','ack','resolved')
    )
);

CREATE INDEX IF NOT EXISTS idx_order_exceptions_order_id ON order_exceptions(order_id);
CREATE INDEX IF NOT EXISTS idx_order_exceptions_status ON order_exceptions(status);
CREATE INDEX IF NOT EXISTS idx_order_exceptions_type ON order_exceptions(type);
CREATE INDEX IF NOT EXISTS idx_order_exceptions_created_at ON order_exceptions(created_at);
CREATE INDEX IF NOT EXISTS idx_order_exceptions_order_status ON order_exceptions(order_id, status);

-- updated_at 自動更新
CREATE OR REPLACE FUNCTION update_order_exceptions_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_order_exceptions_timestamp ON order_exceptions;
CREATE TRIGGER trigger_update_order_exceptions_timestamp
    BEFORE UPDATE ON order_exceptions
    FOR EACH ROW
    EXECUTE FUNCTION update_order_exceptions_timestamp();
