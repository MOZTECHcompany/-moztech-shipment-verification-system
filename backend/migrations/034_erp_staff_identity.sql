CREATE TABLE erp_staff_identities (
    erp_user_id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    wms_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Existing warehouse IDs and order history are preserved. No name/email matching.
