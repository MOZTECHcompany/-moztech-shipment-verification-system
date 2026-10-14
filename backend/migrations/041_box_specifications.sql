-- Reusable packing rules are separate from unique physical cartons. Existing
-- cartons, quantities, SNs, allocations and identities are never rewritten.
CREATE TABLE wms_box_specs (
    spec_id TEXT PRIMARY KEY CHECK (length(spec_id) BETWEEN 1 AND 128),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active')),
    content_revision INTEGER NOT NULL DEFAULT 1 CHECK (content_revision > 0),
    lines JSONB NOT NULL CHECK (jsonb_typeof(lines)='array' AND jsonb_array_length(lines) BETWEEN 1 AND 100),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE wms_box_spec_history (
    id BIGSERIAL PRIMARY KEY,
    spec_id TEXT NOT NULL REFERENCES wms_box_specs(spec_id) ON DELETE RESTRICT,
    event_type TEXT NOT NULL,
    content_revision INTEGER NOT NULL,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    details JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_wms_box_spec_history_spec ON wms_box_spec_history(spec_id,id DESC);
CREATE TABLE wms_box_spec_batch_commands (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    command_id UUID NOT NULL,
    spec_id TEXT NOT NULL REFERENCES wms_box_specs(spec_id) ON DELETE RESTRICT,
    request_hash TEXT NOT NULL,
    content_revision INTEGER NOT NULL,
    carton_ids JSONB NOT NULL CHECK (jsonb_typeof(carton_ids)='array' AND jsonb_array_length(carton_ids) BETWEEN 1 AND 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id,command_id)
);
