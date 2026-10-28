ALTER TABLE marketplace_intake_orders
 ADD COLUMN draft_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE marketplace_draft_commands (
 actor_id INTEGER NOT NULL REFERENCES users(id),
 command_id UUID NOT NULL,
 request_hash CHAR(64) NOT NULL,
 response JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(actor_id,command_id)
);

CREATE TABLE marketplace_draft_revisions (
 id BIGSERIAL PRIMARY KEY,
 intake_id INTEGER NOT NULL REFERENCES marketplace_intakes(id),
 revision INTEGER NOT NULL CHECK(revision>0),
 before_snapshot JSONB NOT NULL,
 before_sources JSONB NOT NULL,
 after_hash CHAR(64) NOT NULL,
 actor_id INTEGER NOT NULL REFERENCES users(id),
 command_id UUID NOT NULL,
 reason TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(intake_id,revision),
 UNIQUE(actor_id,command_id,intake_id)
);
