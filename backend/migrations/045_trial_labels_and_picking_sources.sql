ALTER TABLE order_items
    ADD COLUMN expected_carton_id text,
    ADD COLUMN international_barcode text,
    ADD COLUMN internal_scan_code text,
    ADD COLUMN code_type text NOT NULL DEFAULT 'legacy' CHECK (code_type IN ('international','internal','legacy')),
    ADD COLUMN source_platform text,
    ADD COLUMN source_sku text,
    ADD COLUMN source_store text,
    ADD COLUMN source_order_number text,
    ADD COLUMN source_line_id text;

CREATE TABLE wms_sn_products (
    id text PRIMARY KEY, sku text NOT NULL UNIQUE, name text NOT NULL, barcode text, internal_scan_code text,
    model_number text NOT NULL DEFAULT '', attributes jsonb NOT NULL DEFAULT '{}',
    CHECK (barcode IS NOT NULL OR internal_scan_code IS NOT NULL)
);
CREATE INDEX wms_sn_products_barcode ON wms_sn_products(barcode);

-- SN allocation owns these tables; it never posts inventory/accounting movements.
CREATE TABLE sn_label_drafts (
 id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, data JSONB NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1, batch_id TEXT,
 created_by TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sn_label_drafts_entity ON sn_label_drafts(entity_id, updated_at);
CREATE TABLE sn_label_counters (
 scope TEXT PRIMARY KEY, prefix TEXT NOT NULL UNIQUE, last_value INTEGER NOT NULL DEFAULT 0 CHECK(last_value BETWEEN 0 AND 999999)
);
CREATE TABLE sn_label_batches (
 id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, merge_key TEXT NOT NULL UNIQUE,
 data JSONB NOT NULL, quantity INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE sn_label_drafts ADD CONSTRAINT sn_label_draft_batch_fk FOREIGN KEY(batch_id) REFERENCES sn_label_batches(id);
CREATE INDEX sn_label_batches_entity ON sn_label_batches(entity_id, updated_at);
CREATE TABLE sn_label_carton_counters (scope TEXT PRIMARY KEY, last_value INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sn_label_cartons (
 id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES sn_label_batches(id),
 source_id TEXT NOT NULL REFERENCES sn_label_drafts(id), ordinal INTEGER NOT NULL, quantity INTEGER NOT NULL,
 UNIQUE(batch_id, ordinal)
);
CREATE TABLE sn_label_serials (
 sn TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES sn_label_batches(id),
 source_id TEXT NOT NULL REFERENCES sn_label_drafts(id), carton_id TEXT NOT NULL REFERENCES sn_label_cartons(id),
 sequence INTEGER NOT NULL, position INTEGER NOT NULL, UNIQUE(carton_id, position)
);
CREATE INDEX sn_label_serials_batch ON sn_label_serials(batch_id, sequence);
CREATE TABLE sn_label_events (
 id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, batch_id TEXT REFERENCES sn_label_batches(id),
 actor_id TEXT NOT NULL, action TEXT NOT NULL, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sn_label_events_batch ON sn_label_events(batch_id, created_at);

-- Keep activated carton/SN ownership and event references after retirement.
-- The same merge scope may acquire a new active batch, but identifiers never recycle.
ALTER TABLE sn_label_batches ADD COLUMN retired_at TIMESTAMPTZ;
ALTER TABLE sn_label_batches DROP CONSTRAINT sn_label_batches_merge_key_key;
CREATE UNIQUE INDEX sn_label_batches_active_merge_key
  ON sn_label_batches (merge_key) WHERE retired_at IS NULL;

CREATE TABLE sn_label_batch_reversions (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES sn_label_batches(id),
  requested_by TEXT NOT NULL,
  request_reason TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  batch_snapshot JSONB NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'approved', 'rejected', 'blocked')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  evidence JSONB,
  replacement_draft_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT sn_label_reversion_actor_guard CHECK (
    (state='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND evidence IS NULL)
    OR (
      state<>'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND evidence IS NOT NULL
      AND (
        reviewed_by<>requested_by
        OR (state='approved' AND COALESCE(evidence->>'method','')='direct-return-before-receipt')
        OR (state='rejected' AND COALESCE(evidence->>'method','')='superseded-by-direct-return')
        OR (state='blocked' AND COALESCE(evidence->>'method','')='manual-receipt-confirmed'
            AND COALESCE(evidence->>'blocker','')='BATCH_RECEIVED')
      )
    )
  ),
  CHECK (jsonb_typeof(replacement_draft_ids) = 'array'),
  CHECK ((state = 'approved') = (jsonb_array_length(replacement_draft_ids) > 0))
);
CREATE UNIQUE INDEX sn_label_batch_reversions_pending
  ON sn_label_batch_reversions(batch_id) WHERE state = 'pending';
CREATE INDEX sn_label_batch_reversions_history
  ON sn_label_batch_reversions(batch_id, requested_at DESC);

-- Old tagged API revisions still run against this database. They record the
-- EXPORT event before returning bytes, and append via a batch quantity update.
-- Refuse these old write paths while a review is pending or a batch is retired.
CREATE FUNCTION sn_label_output_review_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action = 'EXPORT' AND NEW.batch_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(726220926);
    IF EXISTS (SELECT 1 FROM sn_label_batches b WHERE b.id = NEW.batch_id AND b.retired_at IS NOT NULL)
       OR EXISTS (SELECT 1 FROM sn_label_batch_reversions r WHERE r.batch_id = NEW.batch_id AND r.state = 'pending') THEN
      RAISE EXCEPTION 'SN label batch output blocked by reversion review' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sn_label_output_review_guard
  BEFORE INSERT ON sn_label_events FOR EACH ROW EXECUTE FUNCTION sn_label_output_review_guard();

CREATE FUNCTION sn_label_append_review_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.retired_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM sn_label_batch_reversions r WHERE r.batch_id = OLD.id AND r.state = 'pending') THEN
    RAISE EXCEPTION 'SN label batch append blocked by reversion review' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sn_label_append_review_guard
  BEFORE UPDATE OF quantity ON sn_label_batches FOR EACH ROW EXECUTE FUNCTION sn_label_append_review_guard();

CREATE FUNCTION sn_label_has_receipt(label_entity text, label_batch text, label_product text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM sn_label_events e WHERE e.batch_id=label_batch AND e.entity_id=label_entity
      AND e.action='INBOUND_STATUS_RECORDED' AND e.data->>'status'='received'
  ) OR EXISTS (
    SELECT 1 FROM sn_label_batch_reversions r WHERE r.batch_id=label_batch AND (
      r.evidence->>'blocker' IN ('BATCH_RECEIVED','ECOUNT_RECEIVED','ERP_SERIAL_IN_USE','WMS_USED','PHYSICAL_USED')
      OR CASE WHEN jsonb_typeof(r.evidence->'receipt'->'receivedQuantity')='number'
        THEN (r.evidence->'receipt'->>'receivedQuantity')::numeric>0 ELSE false END
    )
  ) OR EXISTS (
    SELECT 1 FROM sn_label_cartons c JOIN wms_carton_allocations a ON a.carton_id=c.id
      WHERE c.batch_id=label_batch
  );
$$;

-- Older tagged services can still try to approve legacy reviews against this database.
CREATE FUNCTION sn_label_retire_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF sn_label_has_receipt(OLD.entity_id,OLD.id,OLD.data->>'productId') THEN
    RAISE EXCEPTION 'SN label received batch cannot be retired' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sn_label_retire_receipt_guard
  BEFORE UPDATE OF retired_at ON sn_label_batches FOR EACH ROW
  WHEN (OLD.retired_at IS NULL AND NEW.retired_at IS NOT NULL)
  EXECUTE FUNCTION sn_label_retire_receipt_guard();

CREATE FUNCTION sn_label_inbound_status_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  batch_entity text;
  batch_retired_at timestamptz;
BEGIN
  IF NEW.action <> 'INBOUND_STATUS_RECORDED' THEN RETURN NEW; END IF;
  IF NEW.batch_id IS NULL OR COALESCE(NEW.data->>'status','') NOT IN ('not-received','received') THEN
    RAISE EXCEPTION 'SN label inbound status is invalid' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(726220926);
  SELECT entity_id,retired_at INTO batch_entity,batch_retired_at
    FROM sn_label_batches WHERE id=NEW.batch_id FOR UPDATE;
  IF NOT FOUND OR batch_entity<>NEW.entity_id THEN
    RAISE EXCEPTION 'SN label inbound status batch or company does not match' USING ERRCODE='23514';
  END IF;
  IF batch_retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'SN label retired batch cannot receive stock' USING ERRCODE='23514';
  END IF;
  IF NEW.data->>'status'='not-received' AND sn_label_has_receipt(
    NEW.entity_id,NEW.batch_id,(SELECT data->>'productId' FROM sn_label_batches WHERE id=NEW.batch_id)
  ) THEN
    RAISE EXCEPTION 'SN label batch is already received' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sn_label_inbound_status_guard
  BEFORE INSERT ON sn_label_events FOR EACH ROW EXECUTE FUNCTION sn_label_inbound_status_guard();



-- Custody of a trial carton and retirement of its labels share the allocation lock.
CREATE FUNCTION wms_trial_carton_pick_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch_key text;
BEGIN
  SELECT batch_id INTO batch_key FROM sn_label_cartons WHERE id=NEW.carton_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(726220926);
  IF EXISTS (SELECT 1 FROM sn_label_batches WHERE id=batch_key AND retired_at IS NOT NULL FOR UPDATE) THEN
    RAISE EXCEPTION '此箱的 SN 批次已退回修改，請核對新的外箱標籤' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wms_trial_carton_pick_guard BEFORE INSERT ON wms_carton_allocations
  FOR EACH ROW WHEN (NEW.carton_id LIKE 'CTN-TRY-%') EXECUTE FUNCTION wms_trial_carton_pick_guard();

-- A direct scan of a generated unit also counts as custody, including loose units.
CREATE FUNCTION wms_trial_serial_custody_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b record;
BEGIN
  SELECT batch_id INTO b FROM sn_label_serials WHERE sn=NEW.serial_number;
  IF NOT FOUND THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(726220926);
  IF EXISTS(SELECT 1 FROM sn_label_batches WHERE id=b.batch_id AND retired_at IS NOT NULL FOR UPDATE) THEN
    RAISE EXCEPTION '此 SN 的批次已退回修改，請核對新標籤' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM sn_label_events WHERE batch_id=b.batch_id AND action='INBOUND_STATUS_RECORDED' AND data->>'status'='received') THEN
    INSERT INTO sn_label_events(id,entity_id,batch_id,actor_id,action,data)
      VALUES(gen_random_uuid()::text,'wms-trial',b.batch_id,'wms:scan','INBOUND_STATUS_RECORDED',
             jsonb_build_object('status','received','source','wms-unit','serialNumber',NEW.serial_number));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wms_trial_serial_custody_guard BEFORE UPDATE OF status ON order_item_instances
  FOR EACH ROW WHEN (NEW.serial_number LIKE 'TRY-%' AND NEW.status IN ('picked','packed') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION wms_trial_serial_custody_guard();
