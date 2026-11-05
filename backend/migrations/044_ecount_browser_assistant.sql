-- Durable local work only. No external connection, sales or inventory mutation.
CREATE TABLE wms_ecount_browser_jobs (
 id UUID PRIMARY KEY,
 order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
 company_code TEXT NOT NULL,
 voucher_number TEXT NOT NULL,
 reference_revision INTEGER NOT NULL,
 manifest_fingerprint TEXT NOT NULL CHECK (manifest_fingerprint ~ '^[a-f0-9]{64}$'),
 manifest JSONB NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','claimed','prepared','previewed','verified','test_verified','superseded_verified','uncertain','blocked','failed','superseded')),
 claimed_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,
 worker_id UUID,
 lease_token_hash TEXT,
 lease_expires_at TIMESTAMPTZ,
 before_snapshot JSONB,
 plan JSONB,
 plan_fingerprint TEXT,
 after_snapshot JSONB,
 last_error TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 verified_at TIMESTAMPTZ,
 UNIQUE(order_id,company_code,voucher_number,reference_revision,manifest_fingerprint)
);
CREATE INDEX idx_wms_ecount_browser_queue ON wms_ecount_browser_jobs(status,created_at,id);
CREATE INDEX idx_wms_ecount_browser_document ON wms_ecount_browser_jobs(company_code,voucher_number,status);
CREATE TABLE wms_ecount_browser_commands (
 actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 command_id UUID NOT NULL,
 request_hash TEXT NOT NULL,
 response JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(actor_id,command_id)
);
CREATE TABLE wms_ecount_browser_events (
 id BIGSERIAL PRIMARY KEY,
 job_id UUID NOT NULL REFERENCES wms_ecount_browser_jobs(id) ON DELETE RESTRICT,
 actor_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
 actor_snapshot JSONB,
 event_type TEXT NOT NULL,
 details JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
