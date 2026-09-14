-- Tables previously created lazily by the comments API are part of release setup.
CREATE TABLE IF NOT EXISTS task_comment_pins (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    comment_id INTEGER NOT NULL REFERENCES task_comments(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(order_id, user_id, comment_id)
);
CREATE TABLE IF NOT EXISTS task_pins (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE UNIQUE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Survives account deletion so a reused job/secret cannot reopen first-user setup.
CREATE TABLE IF NOT EXISTS wms_bootstrap_state (
    purpose TEXT PRIMARY KEY CHECK (purpose = 'initial-admin'),
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
