-- One warehouse document remains one orders row. Marketplace references live
-- on each item, so identical SKUs from different orders never lose attribution.
ALTER TABLE order_items
    ADD COLUMN source_order_number TEXT,
    ADD COLUMN source_platform TEXT,
    ADD COLUMN source_store TEXT,
    ADD COLUMN source_line_id TEXT;

ALTER TABLE order_items ADD CONSTRAINT order_items_source_identity_valid CHECK (
    (source_order_number IS NULL OR (length(btrim(source_order_number)) BETWEEN 1 AND 255))
    AND (source_platform IS NULL OR (length(btrim(source_platform)) BETWEEN 1 AND 255))
    AND (source_store IS NULL OR (length(btrim(source_store)) BETWEEN 1 AND 255))
    AND (source_line_id IS NULL OR (length(btrim(source_line_id)) BETWEEN 1 AND 255))
    AND (source_order_number IS NOT NULL OR (source_platform IS NULL AND source_store IS NULL AND source_line_id IS NULL))
);
CREATE INDEX order_items_source_order_idx ON order_items (order_id, source_order_number)
    WHERE source_order_number IS NOT NULL;
