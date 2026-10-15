-- Local reference/evidence only. No ECOUNT sales, stock, order or carton writes.
CREATE TABLE wms_ecount_order_references (
    order_id INTEGER PRIMARY KEY REFERENCES orders(id) ON DELETE RESTRICT,
    company_code TEXT NOT NULL CHECK(length(company_code) BETWEEN 1 AND 64),
    voucher_number TEXT NOT NULL CHECK(length(voucher_number) BETWEEN 1 AND 100),
    revision INTEGER NOT NULL CHECK(revision > 0),
    manifest_fingerprint CHAR(64) NOT NULL CHECK(manifest_fingerprint ~ '^[a-f0-9]{64}$'),
    confirmed_fingerprint CHAR(64) CHECK(confirmed_fingerprint ~ '^[a-f0-9]{64}$'),
    confirmation_kind TEXT CHECK(confirmation_kind='manual-line-check'),
    confirmation_evidence JSONB,
    confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    confirmed_actor_snapshot JSONB,
    confirmed_at TIMESTAMPTZ,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_actor_snapshot JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((confirmation_kind IS NULL AND confirmed_fingerprint IS NULL AND confirmed_at IS NULL AND confirmation_evidence IS NULL)
        OR (confirmation_kind IS NOT NULL AND confirmation_kind='manual-line-check' AND confirmed_fingerprint IS NOT NULL AND confirmed_at IS NOT NULL
            AND confirmation_evidence IS NOT NULL AND confirmed_actor_snapshot IS NOT NULL))
);
-- This manual check covers one complete saved sales document, not partial batches.
CREATE UNIQUE INDEX idx_wms_ecount_confirmed_document ON wms_ecount_order_references(company_code,voucher_number)
    WHERE confirmation_kind IS NOT NULL;
CREATE TABLE wms_ecount_reference_history (
    id BIGSERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    revision INTEGER NOT NULL,
    event_type TEXT NOT NULL CHECK(event_type IN ('reference_saved','manually_checked')),
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_snapshot JSONB NOT NULL,
    reason TEXT,
    before_state JSONB,
    after_state JSONB NOT NULL,
    evidence JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(order_id,revision)
);
CREATE INDEX idx_wms_ecount_reference_history_order ON wms_ecount_reference_history(order_id,id DESC);
CREATE TABLE wms_ecount_reference_commands (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    command_id UUID NOT NULL,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    request_hash CHAR(64) NOT NULL,
    reference_revision INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(user_id,command_id)
);
