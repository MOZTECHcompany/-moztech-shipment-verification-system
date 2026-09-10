-- 012_team_board.sql
-- 團隊公告 / 交辦事項（單一公告板，預留 channel）+ 指派 + 附件 + 留言

BEGIN;

-- 1) 頻道（目前僅一個 general，預留未來擴充）
CREATE TABLE IF NOT EXISTS team_channels (
    id SERIAL PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

INSERT INTO team_channels (slug, name)
SELECT 'general', '公告板'
WHERE NOT EXISTS (SELECT 1 FROM team_channels WHERE slug = 'general');

-- 2) 主題（announcement / task）
CREATE TABLE IF NOT EXISTS team_posts (
    id BIGSERIAL PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES team_channels(id) ON DELETE RESTRICT,

    post_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    priority TEXT NOT NULL DEFAULT 'normal',

    title TEXT NOT NULL,
    content TEXT NOT NULL,

    due_at TIMESTAMP WITH TIME ZONE NULL,

    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_team_posts_type CHECK (post_type IN ('announcement','task')),
    CONSTRAINT chk_team_posts_status CHECK (status IN ('open','in_progress','done','closed')),
    CONSTRAINT chk_team_posts_priority CHECK (priority IN ('urgent','important','normal'))
);

CREATE INDEX IF NOT EXISTS idx_team_posts_channel_id ON team_posts(channel_id);
CREATE INDEX IF NOT EXISTS idx_team_posts_status ON team_posts(status);
CREATE INDEX IF NOT EXISTS idx_team_posts_type ON team_posts(post_type);
CREATE INDEX IF NOT EXISTS idx_team_posts_created_at ON team_posts(created_at);

-- updated_at 自動更新
CREATE OR REPLACE FUNCTION update_team_posts_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_team_posts_timestamp ON team_posts;
CREATE TRIGGER trigger_update_team_posts_timestamp
    BEFORE UPDATE ON team_posts
    FOR EACH ROW
    EXECUTE FUNCTION update_team_posts_timestamp();

-- 3) 指派（多指派）
CREATE TABLE IF NOT EXISTS team_post_assignees (
    post_id BIGINT NOT NULL REFERENCES team_posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_post_assignees_user_id ON team_post_assignees(user_id);

-- 4) 留言
CREATE TABLE IF NOT EXISTS team_post_comments (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES team_posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_post_comments_post_id ON team_post_comments(post_id);

-- 5) 附件（主題層級，照片/文件）
CREATE TABLE IF NOT EXISTS team_post_attachments (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES team_posts(id) ON DELETE CASCADE,
    storage_key TEXT NOT NULL,
    original_name TEXT,
    mime_type TEXT,
    size_bytes INTEGER,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_post_attachments_post_id ON team_post_attachments(post_id);

COMMIT;
