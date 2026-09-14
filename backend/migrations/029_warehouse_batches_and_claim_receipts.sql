CREATE TABLE warehouse_import_batches (
    id SERIAL PRIMARY KEY,
    voucher_number VARCHAR(255) NOT NULL UNIQUE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE orders
    ADD COLUMN import_batch_id INTEGER REFERENCES warehouse_import_batches(id),
    ADD COLUMN source_order_number TEXT,
    ADD COLUMN source_platform TEXT,
    ADD COLUMN source_store TEXT,
    ADD COLUMN work_barcode VARCHAR(20) UNIQUE;

ALTER TABLE orders ADD CONSTRAINT orders_source_work_identity_valid CHECK (
    (import_batch_id IS NULL AND source_order_number IS NULL AND source_platform IS NULL AND source_store IS NULL)
    OR (import_batch_id IS NOT NULL AND length(btrim(source_order_number)) BETWEEN 1 AND 255
        AND source_order_number IS NOT NULL
        AND (source_platform IS NULL OR length(btrim(source_platform)) BETWEEN 1 AND 255)
        AND (source_store IS NULL OR length(btrim(source_store)) BETWEEN 1 AND 255))
);
ALTER TABLE orders ADD CONSTRAINT orders_work_barcode_valid CHECK (work_barcode IS NULL OR work_barcode ~ '^WT[0-9A-F]{18}$');
CREATE UNIQUE INDEX orders_batch_source_unique ON orders
    (import_batch_id, COALESCE(source_platform, ''), COALESCE(source_store, ''), source_order_number)
    WHERE import_batch_id IS NOT NULL;

CREATE TABLE wms_claim_commands (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    command_id UUID NOT NULL,
    request_hash CHAR(64) NOT NULL,
    order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    stage VARCHAR(4) NOT NULL CHECK (stage IN ('pick', 'pack')),
    response JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, command_id)
);
