-- Additive only: existing identities, passwords, roles, work and audit rows stay intact.
ALTER TABLE users ADD COLUMN can_pick BOOLEAN, ADD COLUMN can_pack BOOLEAN;
ALTER TABLE orders ADD COLUMN pick_paused_at TIMESTAMPTZ, ADD COLUMN pack_paused_at TIMESTAMPTZ;
ALTER TABLE operation_logs ADD COLUMN actor_snapshot JSONB, ADD COLUMN work_type VARCHAR(10)
    CHECK (work_type IN ('pick','pack'));
ALTER TABLE task_assignments ADD COLUMN performed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN actor_snapshot JSONB, ADD COLUMN from_snapshot JSONB, ADD COLUMN to_snapshot JSONB,
    ADD COLUMN progress_snapshot JSONB;
CREATE TABLE warehouse_daily_modes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    choice_stage VARCHAR(10) CHECK (choice_stage IN ('pick','pack')),
    assigned_stage VARCHAR(10) CHECK (assigned_stage IN ('pick','pack')),
    assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assigned_by_snapshot JSONB,
    assigned_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id,work_date)
);
CREATE INDEX worker_handoffs_order ON task_assignments(order_id,created_at,id);
CREATE INDEX worker_operations_order_stage ON operation_logs(order_id,work_type,created_at,id)
    WHERE work_type IS NOT NULL;
