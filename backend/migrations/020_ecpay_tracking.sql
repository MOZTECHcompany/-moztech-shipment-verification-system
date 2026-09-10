-- Logistics facts only. No order, stock, invoice, payment or sales-return mutation.
CREATE TABLE wms_logistics_shipments (
 id UUID PRIMARY KEY,
 account_id TEXT NOT NULL,
 environment TEXT NOT NULL CHECK (environment IN ('stage','production')),
 merchant_id TEXT NOT NULL,
 logistics_id TEXT NOT NULL,
 order_id INTEGER REFERENCES orders(id) ON DELETE RESTRICT,
 merchant_trade_no TEXT NOT NULL,
 shipment_no TEXT NOT NULL DEFAULT '',
 service TEXT NOT NULL CHECK(service IN ('UNIMART','FAMI','HILIFE')),
 status_code TEXT NOT NULL,
 status TEXT NOT NULL,
 checked_at TIMESTAMPTZ NOT NULL,
 sync_requested BOOLEAN NOT NULL DEFAULT false,
 last_error_code TEXT,
 created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(account_id, environment, logistics_id)
);
CREATE INDEX wms_logistics_shipments_page ON wms_logistics_shipments(created_at DESC,id);
CREATE INDEX wms_logistics_shipments_order ON wms_logistics_shipments(order_id);
CREATE INDEX wms_logistics_shipments_poll ON wms_logistics_shipments(sync_requested,checked_at);
CREATE TABLE wms_logistics_events (
 id BIGSERIAL PRIMARY KEY,
 account_id TEXT NOT NULL,
 environment TEXT NOT NULL,
 merchant_id TEXT NOT NULL,
 logistics_id TEXT NOT NULL,
 shipment_id UUID REFERENCES wms_logistics_shipments(id) ON DELETE RESTRICT,
 source TEXT NOT NULL CHECK(source IN ('query','callback')),
 status_code TEXT NOT NULL,
 provider_time TEXT,
 received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 dedupe_key TEXT NOT NULL UNIQUE,
 evidence JSONB NOT NULL
);
CREATE INDEX wms_logistics_events_shipment ON wms_logistics_events(shipment_id,id DESC);
CREATE TABLE wms_logistics_expected_returns (
 id UUID PRIMARY KEY,
 shipment_id UUID NOT NULL UNIQUE REFERENCES wms_logistics_shipments(id) ON DELETE RESTRICT,
 reason TEXT NOT NULL CHECK(reason='uncollected'),
 status TEXT NOT NULL DEFAULT 'expected' CHECK(status IN ('expected','needs_review')),
 first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
