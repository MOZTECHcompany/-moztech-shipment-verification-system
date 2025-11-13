-- 003_add_comment_priority.sql
-- 為任務評論添加優先級欄位

-- 添加 priority 欄位（如果不存在）
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'task_comments' AND column_name = 'priority'
    ) THEN
        ALTER TABLE task_comments 
        ADD COLUMN priority VARCHAR(20) DEFAULT 'normal' 
        CHECK (priority IN ('normal', 'important', 'urgent'));
        
        -- 為現有評論設置預設優先級
        UPDATE task_comments SET priority = 'normal' WHERE priority IS NULL;
    END IF;
END $$;

-- 創建索引以加速按優先級查詢
CREATE INDEX IF NOT EXISTS idx_task_comments_priority ON task_comments(priority);
CREATE INDEX IF NOT EXISTS idx_task_comments_order_priority ON task_comments(order_id, priority);

-- 更新時間戳記觸發器（如果不存在）
CREATE OR REPLACE FUNCTION update_task_comment_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_task_comment_timestamp ON task_comments;
CREATE TRIGGER trigger_update_task_comment_timestamp
    BEFORE UPDATE ON task_comments
    FOR EACH ROW
    EXECUTE FUNCTION update_task_comment_timestamp();

-- 驗證資料
DO $$
DECLARE
    row_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO row_count FROM task_comments;
    RAISE NOTICE '任務評論表總記錄數: %', row_count;
    
    SELECT COUNT(*) INTO row_count FROM task_comments WHERE priority = 'urgent';
    RAISE NOTICE '緊急評論數: %', row_count;
    
    SELECT COUNT(*) INTO row_count FROM task_comments WHERE priority = 'important';
    RAISE NOTICE '重要評論數: %', row_count;
    
    SELECT COUNT(*) INTO row_count FROM task_comments WHERE priority = 'normal';
    RAISE NOTICE '一般評論數: %', row_count;
END $$;
