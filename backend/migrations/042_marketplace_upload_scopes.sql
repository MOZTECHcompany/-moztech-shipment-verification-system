ALTER TABLE marketplace_intake_orders
 ADD COLUMN draft_version INTEGER NOT NULL DEFAULT 0 CHECK (draft_version >= 0);

CREATE TABLE marketplace_intake_scope_orders (
 intake_id INTEGER NOT NULL REFERENCES marketplace_intakes(id) ON DELETE CASCADE,
 intake_order_id INTEGER NOT NULL REFERENCES marketplace_intake_orders(id),
 source_version INTEGER NOT NULL CHECK (source_version >= 0),
 PRIMARY KEY (intake_id, intake_order_id)
);

CREATE INDEX idx_marketplace_scope_orders_source
 ON marketplace_intake_scope_orders(intake_order_id, intake_id);
