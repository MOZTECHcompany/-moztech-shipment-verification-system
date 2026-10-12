-- WMS custody/verification only. No ERP stock or accounting mutations.
ALTER TABLE order_items ADD COLUMN carton_serial_binding BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE order_items ADD COLUMN serial_identity_mode TEXT NOT NULL DEFAULT 'legacy' CHECK (serial_identity_mode IN ('legacy','exact'));
CREATE TABLE wms_cartons (
    carton_id TEXT PRIMARY KEY CHECK (length(carton_id) BETWEEN 1 AND 128),
    source_system TEXT,
    source_reference TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sealed','void')),
    content_revision INTEGER NOT NULL DEFAULT 1 CHECK (content_revision > 0),
    state_revision INTEGER NOT NULL DEFAULT 1 CHECK (state_revision > 0),
    sealed_at TIMESTAMPTZ,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE wms_carton_lines (
    id SERIAL PRIMARY KEY,
    carton_id TEXT NOT NULL REFERENCES wms_cartons(carton_id) ON DELETE RESTRICT,
    position INTEGER NOT NULL,
    item_code TEXT NOT NULL CHECK (length(item_code) BETWEEN 1 AND 255),
    product_name TEXT,
    international_barcode TEXT,
    internal_scan_code TEXT,
    code_type TEXT NOT NULL CHECK (code_type IN ('international','internal','legacy')),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    remaining_quantity INTEGER NOT NULL CHECK (remaining_quantity BETWEEN 0 AND quantity),
    actual_sns JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
        jsonb_typeof(actual_sns)='array' AND (jsonb_array_length(actual_sns)=0 OR jsonb_array_length(actual_sns)=quantity)
    ),
    UNIQUE (carton_id,position)
);
-- One exact SN belongs to one known carton. Reboxing/returns require an explicit
-- future custody event; neither scanning nor signed sales automatically moves it.
CREATE TABLE wms_carton_serials (
    serial_number TEXT PRIMARY KEY,
    line_id INTEGER NOT NULL REFERENCES wms_carton_lines(id) ON DELETE CASCADE,
    available BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX idx_wms_carton_serials_line ON wms_carton_serials(line_id);
CREATE TABLE wms_carton_allocations (
    id UUID PRIMARY KEY,
    carton_id TEXT NOT NULL REFERENCES wms_cartons(carton_id) ON DELETE RESTRICT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    content_revision INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('picked','packed','released')),
    lines JSONB NOT NULL CHECK (jsonb_typeof(lines)='array' AND jsonb_array_length(lines)>0),
    picked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    picked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    packed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    packed_at TIMESTAMPTZ,
    released_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    released_at TIMESTAMPTZ,
    release_reason TEXT
);
-- Independent of request UUID: a fresh request cannot pick the same allocation
-- twice. Splits across orders are allowed; a second split for this order needs
-- an explicit release first, rather than guessing that a rescan is intentional.
CREATE UNIQUE INDEX idx_wms_carton_active_allocation ON wms_carton_allocations(carton_id,order_id)
    WHERE status IN ('picked','packed');
CREATE INDEX idx_wms_carton_allocations_order ON wms_carton_allocations(order_id);
CREATE TABLE wms_carton_history (
    id BIGSERIAL PRIMARY KEY,
    carton_id TEXT NOT NULL REFERENCES wms_cartons(carton_id) ON DELETE RESTRICT,
    event_type TEXT NOT NULL,
    content_revision INTEGER NOT NULL,
    state_revision INTEGER NOT NULL,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    details JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_wms_carton_history_carton ON wms_carton_history(carton_id,id DESC);
