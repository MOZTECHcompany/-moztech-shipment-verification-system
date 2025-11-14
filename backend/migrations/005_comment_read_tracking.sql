-- 005_comment_read_tracking.sql
-- 評論已讀追蹤功能

-- 創建評論已讀記錄表
CREATE TABLE IF NOT EXISTS task_comment_reads (
    id SERIAL PRIMARY KEY,
    comment_id INTEGER NOT NULL REFERENCES task_comments(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(comment_id, user_id)
);

-- 創建索引以提升查詢效能
CREATE INDEX IF NOT EXISTS idx_comment_reads_comment ON task_comment_reads(comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_reads_user ON task_comment_reads(user_id);
CREATE INDEX IF NOT EXISTS idx_comment_reads_user_time ON task_comment_reads(user_id, read_at DESC);

-- 註釋
COMMENT ON TABLE task_comment_reads IS '評論已讀記錄表 - 追蹤用戶是否已讀評論';
COMMENT ON COLUMN task_comment_reads.comment_id IS '評論 ID';
COMMENT ON COLUMN task_comment_reads.user_id IS '讀取評論的用戶 ID';
COMMENT ON COLUMN task_comment_reads.read_at IS '讀取時間';

-- 驗證
DO $$
BEGIN
    RAISE NOTICE '✅ task_comment_reads 表創建成功';
END $$;
