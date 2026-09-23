-- Corely owns reservation and the inventory ledger. These tables only track
-- warehouse work; no ECOUNT sales receipt or accounting document is fabricated.
CREATE TABLE corely_dispatch_grants (
    entity_id TEXT NOT NULL,
    erp_actor_id TEXT NOT NULL,
    brand TEXT NOT NULL,
    wms_user_id INTEGER NOT NULL REFERENCES users(id),
    revoked_at TIMESTAMPTZ,
    PRIMARY KEY (entity_id, erp_actor_id, brand)
);
CREATE TABLE corely_native_intakes (
    id SERIAL PRIMARY KEY,
    entity_id TEXT NOT NULL,
    erp_order_id TEXT NOT NULL,
    erp_actor_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    payload_hash CHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    reservation_accepted BOOLEAN NOT NULL DEFAULT FALSE,
    order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
    import_batch_id INTEGER NOT NULL UNIQUE REFERENCES warehouse_import_batches(id),
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    print_owner_id INTEGER REFERENCES users(id),
    printed_at TIMESTAMPTZ,
    prepick_owner_id INTEGER REFERENCES users(id),
    prepick_counts JSONB NOT NULL DEFAULT '{}',
    prepick_completed_at TIMESTAMPTZ,
    UNIQUE(entity_id, erp_order_id),
    UNIQUE(entity_id, erp_actor_id, request_id)
);
CREATE TABLE corely_intake_commands (
    actor_id INTEGER NOT NULL REFERENCES users(id),
    command_id UUID NOT NULL,
    request_hash CHAR(64) NOT NULL,
    response JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(actor_id, command_id)
);
CREATE TABLE corely_intake_events (
    id BIGSERIAL PRIMARY KEY,
    intake_id INTEGER NOT NULL REFERENCES corely_native_intakes(id),
    actor_id INTEGER NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Explicit grants are provisioned separately. No accounts or grants are seeded.
