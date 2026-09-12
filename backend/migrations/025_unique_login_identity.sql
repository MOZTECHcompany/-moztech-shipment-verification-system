-- Login has always compared LOWER(username). Keep its uniqueness consistent with
-- that rule. Resolve any legacy case-colliding accounts before this migration.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wms_users_login_identity ON users (LOWER(username));
