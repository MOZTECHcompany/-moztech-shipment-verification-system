-- 002_collaboration_features.sql
-- 即時協作功能資料表

-- 任務評論表
CREATE TABLE IF NOT EXISTS task_comments (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    parent_id INTEGER REFERENCES task_comments(id) ON DELETE CASCADE, -- 支援回覆評論
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('normal', 'important', 'urgent')), -- 優先級
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 任務提及表（@功能）
CREATE TABLE IF NOT EXISTS task_mentions (
    id SERIAL PRIMARY KEY,
    comment_id INTEGER NOT NULL REFERENCES task_comments(id) ON DELETE CASCADE,
    mentioned_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 任務交接記錄表
CREATE TABLE IF NOT EXISTS task_assignments (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    from_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_type VARCHAR(20) NOT NULL CHECK (task_type IN ('pick', 'pack')),
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 即時協作狀態表（誰正在處理）
CREATE TABLE IF NOT EXISTS active_sessions (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_type VARCHAR(20) NOT NULL CHECK (session_type IN ('viewing', 'editing')),
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(order_id, user_id, session_type)
);

-- 建立索引以提升查詢效能
CREATE INDEX IF NOT EXISTS idx_task_comments_order ON task_comments(order_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_user ON task_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_task_mentions_user ON task_mentions(mentioned_user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_task_assignments_order ON task_assignments(order_id);
CREATE INDEX IF NOT EXISTS idx_active_sessions_order ON active_sessions(order_id);
CREATE INDEX IF NOT EXISTS idx_active_sessions_activity ON active_sessions(last_activity);

-- 建立更新時間的觸發器
CREATE OR REPLACE FUNCTION update_task_comments_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER task_comments_update_timestamp
    BEFORE UPDATE ON task_comments
    FOR EACH ROW
    EXECUTE FUNCTION update_task_comments_timestamp();

-- 自動清理過期的活動會話（超過5分鐘無活動）
CREATE OR REPLACE FUNCTION cleanup_inactive_sessions()
RETURNS void AS $$
BEGIN
    DELETE FROM active_sessions 
    WHERE last_activity < NOW() - INTERVAL '5 minutes';
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE task_comments IS '任務評論表 - 支援協作討論';
COMMENT ON TABLE task_mentions IS '任務提及表 - @功能通知';
COMMENT ON TABLE task_assignments IS '任務交接記錄 - 追蹤任務轉移';
COMMENT ON TABLE active_sessions IS '即時協作狀態 - 顯示誰正在處理';
