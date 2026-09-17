-- Additive workflow; historical picking-return batches remain unchanged.
ALTER TABLE marketplace_intake_orders ADD COLUMN work_barcode VARCHAR(20) UNIQUE;
ALTER TABLE orders ADD COLUMN warehouse_hold BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE marketplace_warehouse_flows (
 intake_id INTEGER PRIMARY KEY REFERENCES marketplace_intakes(id),
 enabled_by INTEGER REFERENCES users(id), enabled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 erp_receipt JSONB, erp_confirmed_by INTEGER REFERENCES users(id), erp_confirmed_at TIMESTAMPTZ,
 import_batch_id INTEGER UNIQUE REFERENCES warehouse_import_batches(id),
 print_owner_id INTEGER REFERENCES users(id), printed_at TIMESTAMPTZ,
 prepick_owner_id INTEGER REFERENCES users(id), prepick_completed_at TIMESTAMPTZ,
 prepick_counts JSONB NOT NULL DEFAULT '{}'
);
CREATE TABLE marketplace_warehouse_events (
 id BIGSERIAL PRIMARY KEY, intake_id INTEGER NOT NULL REFERENCES marketplace_intakes(id),
 actor_id INTEGER REFERENCES users(id), action TEXT NOT NULL, details JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE marketplace_warehouse_commands (
 actor_id INTEGER NOT NULL REFERENCES users(id), command_id UUID NOT NULL,
 request_hash CHAR(64) NOT NULL, response JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(actor_id,command_id)
);
