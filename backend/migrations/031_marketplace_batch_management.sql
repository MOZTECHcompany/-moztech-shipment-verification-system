ALTER TABLE marketplace_intakes
 ADD COLUMN archived_at TIMESTAMPTZ,
 ADD COLUMN archived_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX idx_marketplace_intakes_active ON marketplace_intakes(id DESC) WHERE archived_at IS NULL;
-- Audit metadata survives deletion; it deliberately contains no order snapshot.
CREATE TABLE marketplace_intake_events (
 id BIGSERIAL PRIMARY KEY,
 intake_id INTEGER NOT NULL,
 batch_number VARCHAR(20) NOT NULL,
 action VARCHAR(12) NOT NULL CHECK (action IN ('archive','restore','delete')),
 actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
