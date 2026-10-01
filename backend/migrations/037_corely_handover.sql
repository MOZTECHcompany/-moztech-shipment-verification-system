-- Physical handover is distinct from packing completion and ERP stock posting.
ALTER TABLE order_items ADD COLUMN handed_over_quantity INTEGER NOT NULL DEFAULT 0
    CONSTRAINT corely_handed_over_quantity_bounds CHECK (handed_over_quantity >= 0 AND handed_over_quantity <= packed_quantity AND handed_over_quantity <= picked_quantity);
CREATE TABLE corely_shipments (
    id UUID PRIMARY KEY,
    event_id UUID NOT NULL UNIQUE,
    intake_id INTEGER NOT NULL REFERENCES corely_native_intakes(id),
    order_id INTEGER NOT NULL REFERENCES orders(id),
    actor_id INTEGER NOT NULL REFERENCES users(id),
    command_id UUID NOT NULL,
    request_hash CHAR(64) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    event JSONB NOT NULL,
    UNIQUE(actor_id,command_id)
);
CREATE TABLE corely_shipment_lines (
    id UUID PRIMARY KEY,
    shipment_id UUID NOT NULL REFERENCES corely_shipments(id),
    order_item_id INTEGER NOT NULL REFERENCES order_items(id),
    sales_order_line_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    sku TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    UNIQUE(shipment_id,sales_order_line_id)
);
CREATE INDEX corely_shipment_lines_item_idx ON corely_shipment_lines(order_item_id);
CREATE TABLE corely_shipment_packages (
    shipment_line_id UUID NOT NULL REFERENCES corely_shipment_lines(id),
    package_id TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    PRIMARY KEY(shipment_line_id,package_id)
);
CREATE TABLE corely_handover_outbox (
    event_id UUID PRIMARY KEY REFERENCES corely_shipments(event_id),
    body_text TEXT NOT NULL,
    body_hash CHAR(64) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','retry','rejected','acknowledged')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_token UUID,
    locked_until TIMESTAMPTZ,
    last_error TEXT,
    acknowledged_at TIMESTAMPTZ,
    acknowledgement JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX corely_outbox_due_idx ON corely_handover_outbox(status,next_attempt_at);
CREATE FUNCTION corely_apply_handover_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_order INTEGER;
BEGIN
    SELECT order_id INTO target_order FROM corely_shipments WHERE id=NEW.shipment_id;
    UPDATE order_items SET handed_over_quantity=handed_over_quantity+NEW.quantity
    WHERE id=NEW.order_item_id AND order_id=target_order AND source_line_id=NEW.sales_order_line_id
      AND handed_over_quantity+NEW.quantity <= packed_quantity;
    IF NOT FOUND THEN RAISE EXCEPTION 'CORELY_HANDOVER_EXCEEDS_PACKED' USING ERRCODE='23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER corely_apply_handover_line BEFORE INSERT ON corely_shipment_lines FOR EACH ROW EXECUTE FUNCTION corely_apply_handover_line();
CREATE FUNCTION corely_guard_outbox_body() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF ROW(NEW.event_id,NEW.body_text,NEW.body_hash) IS DISTINCT FROM ROW(OLD.event_id,OLD.body_text,OLD.body_hash)
    THEN RAISE EXCEPTION 'CORELY_HANDOVER_BODY_IMMUTABLE' USING ERRCODE='23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER corely_outbox_body_guard BEFORE UPDATE ON corely_handover_outbox FOR EACH ROW EXECUTE FUNCTION corely_guard_outbox_body();

-- All old edit/undo paths must respect handed-over units, including SQL callers.
CREATE FUNCTION corely_guard_handed_over_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.handed_over_quantity > 0 THEN
        IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'CORELY_HANDED_OVER_ITEM_IMMUTABLE' USING ERRCODE='23514'; END IF;
        IF NEW.handed_over_quantity < OLD.handed_over_quantity
           OR ROW(NEW.order_id,NEW.quantity,NEW.product_code,NEW.barcode,NEW.source_order_number,NEW.source_platform,NEW.source_store,NEW.source_line_id)
              IS DISTINCT FROM ROW(OLD.order_id,OLD.quantity,OLD.product_code,OLD.barcode,OLD.source_order_number,OLD.source_platform,OLD.source_store,OLD.source_line_id)
        THEN RAISE EXCEPTION 'CORELY_HANDED_OVER_ITEM_IMMUTABLE' USING ERRCODE='23514'; END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER corely_handed_over_item_guard BEFORE UPDATE OR DELETE ON order_items FOR EACH ROW EXECUTE FUNCTION corely_guard_handed_over_item();
CREATE FUNCTION corely_guard_handed_over_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.status='voided' OR NEW.warehouse IS DISTINCT FROM OLD.warehouse OR NEW.source_order_number IS DISTINCT FROM OLD.source_order_number)
       AND EXISTS(SELECT 1 FROM corely_shipments WHERE order_id=OLD.id)
    THEN RAISE EXCEPTION 'CORELY_HANDED_OVER_ORDER_IMMUTABLE' USING ERRCODE='23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER corely_handed_over_order_guard BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION corely_guard_handed_over_order();
CREATE FUNCTION corely_immutable_handover() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'CORELY_HANDOVER_IS_IMMUTABLE' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER corely_shipment_immutable BEFORE UPDATE OR DELETE ON corely_shipments FOR EACH ROW EXECUTE FUNCTION corely_immutable_handover();
CREATE TRIGGER corely_shipment_line_immutable BEFORE UPDATE OR DELETE ON corely_shipment_lines FOR EACH ROW EXECUTE FUNCTION corely_immutable_handover();
CREATE TRIGGER corely_shipment_package_immutable BEFORE UPDATE OR DELETE ON corely_shipment_packages FOR EACH ROW EXECUTE FUNCTION corely_immutable_handover();
