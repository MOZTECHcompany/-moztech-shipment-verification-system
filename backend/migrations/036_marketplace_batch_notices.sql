-- Batch readiness is independent of order-change approval and warehouse release.
CREATE TABLE marketplace_batch_notices (
    id BIGSERIAL PRIMARY KEY,
    intake_id INTEGER NOT NULL REFERENCES marketplace_intakes(id) ON DELETE CASCADE,
    stage TEXT NOT NULL CHECK (stage IN ('prepared', 'ready_for_print')),
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_name TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (intake_id, stage)
);
CREATE TABLE marketplace_batch_notice_recipients (
    notice_id BIGINT NOT NULL REFERENCES marketplace_batch_notices(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seen_at TIMESTAMPTZ,
    PRIMARY KEY (notice_id, user_id)
);
CREATE INDEX marketplace_batch_notice_unseen
    ON marketplace_batch_notice_recipients(user_id, notice_id) WHERE seen_at IS NULL;
