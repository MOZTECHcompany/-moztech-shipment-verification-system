-- 021..023 are reserved by the separate ERP worktree. This migration only
-- supports existing WMS query semantics; no business rows or roles change.
CREATE INDEX IF NOT EXISTS idx_wms_latest_import
    ON operation_logs (order_id, created_at DESC, id DESC) INCLUDE (user_id)
    WHERE action_type = 'import';
CREATE INDEX IF NOT EXISTS idx_wms_latest_comment
    ON task_comments (order_id, created_at DESC, id DESC);
