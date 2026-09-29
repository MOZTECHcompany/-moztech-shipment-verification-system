CREATE TABLE IF NOT EXISTS marketplace_intakes (
 id SERIAL PRIMARY KEY,
 batch_number VARCHAR(20) NOT NULL UNIQUE,
 source_platform VARCHAR(30) NOT NULL,
 source_store VARCHAR(100) NOT NULL,
 fingerprint CHAR(64) NOT NULL UNIQUE,
 created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 snapshot JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS marketplace_intake_orders (
 id SERIAL PRIMARY KEY,
 intake_id INTEGER NOT NULL REFERENCES marketplace_intakes(id),
 source_platform VARCHAR(30) NOT NULL,
 source_store VARCHAR(100) NOT NULL,
 source_order_number VARCHAR(100) NOT NULL,
 expected_items JSONB NOT NULL,
 nonstock_items JSONB NOT NULL DEFAULT '[]',
 financial JSONB NOT NULL,
 UNIQUE(source_platform, source_store, source_order_number)
);
CREATE TABLE IF NOT EXISTS marketplace_work_order_links (
 intake_order_id INTEGER PRIMARY KEY REFERENCES marketplace_intake_orders(id),
 order_id INTEGER UNIQUE REFERENCES orders(id) ON DELETE SET NULL,
 linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketplace_intake_orders_intake ON marketplace_intake_orders(intake_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_intakes_created ON marketplace_intakes(created_at DESC,id DESC);
