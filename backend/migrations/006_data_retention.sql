-- 006_data_retention.sql
-- 資料保留與清理政策：避免資料庫持續膨脹

-- 1) 清理 operation_logs：保留 N 天內的記錄（預設 180 天）
CREATE OR REPLACE FUNCTION purge_operation_logs(retain_days INTEGER DEFAULT 180)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM operation_logs
     WHERE created_at < NOW() - (retain_days || ' days')::INTERVAL;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION purge_operation_logs IS '刪除超過指定天數的操作日誌，預設 180 天';

-- 2) 清理 task_mentions：對於已讀的提及，保留 N 天（預設 30 天）
CREATE OR REPLACE FUNCTION purge_task_mentions(retain_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM task_mentions
     WHERE is_read = TRUE
       AND created_at < NOW() - (retain_days || ' days')::INTERVAL;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION purge_task_mentions IS '刪除已讀且超過指定天數的提及通知，預設 30 天';

-- 3) 清理 task_comment_reads：保留 N 天（預設 90 天）
CREATE OR REPLACE FUNCTION purge_task_comment_reads(retain_days INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM task_comment_reads
     WHERE read_at < NOW() - (retain_days || ' days')::INTERVAL;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION purge_task_comment_reads IS '刪除過舊的評論已讀紀錄，預設 90 天';

-- 4) 清理 active_sessions：保留最近 N 分鐘（預設 10 分鐘）
CREATE OR REPLACE FUNCTION purge_inactive_sessions(max_idle_minutes INTEGER DEFAULT 10)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM active_sessions
     WHERE last_activity < NOW() - (max_idle_minutes || ' minutes')::INTERVAL;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION purge_inactive_sessions IS '刪除長期未活動的即時協作會話，預設 10 分鐘';

-- 便利總管道：一次執行所有清理，回傳 JSON 統計
CREATE OR REPLACE FUNCTION run_all_purge(
    logs_days INTEGER DEFAULT 180,
    mentions_days INTEGER DEFAULT 30,
    reads_days INTEGER DEFAULT 90,
    idle_minutes INTEGER DEFAULT 10
) RETURNS JSON AS $$
DECLARE
    a INT; b INT; c INT; d INT;
BEGIN
    a := purge_operation_logs(logs_days);
    b := purge_task_mentions(mentions_days);
    c := purge_task_comment_reads(reads_days);
    d := purge_inactive_sessions(idle_minutes);
    RETURN json_build_object(
        'operation_logs_deleted', a,
        'task_mentions_deleted', b,
        'comment_reads_deleted', c,
        'inactive_sessions_deleted', d
    );
END;$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION run_all_purge IS '一次執行所有清理任務，並以 JSON 回傳刪除統計';

-- 建議索引（若尚未建立），以加速清理查詢
CREATE INDEX IF NOT EXISTS idx_task_mentions_created_at ON task_mentions(created_at);
CREATE INDEX IF NOT EXISTS idx_task_comment_reads_read_at ON task_comment_reads(read_at);

DO $$ BEGIN RAISE NOTICE '✅ 資料保留清理函式建立完成'; END $$;
