-- Barcode remains the existing WMS scan key. Its semantic identity is explicit
-- only for new source-detail imports; legacy rows are never guessed/backfilled.
ALTER TABLE order_items
 ADD COLUMN international_barcode TEXT,
 ADD COLUMN internal_scan_code TEXT,
 ADD COLUMN code_type TEXT NOT NULL DEFAULT 'legacy',
 ADD COLUMN source_sku TEXT;
ALTER TABLE order_items ADD CONSTRAINT order_items_scan_identity_valid CHECK (
 code_type IN ('legacy','international','internal')
 AND (international_barcode IS NULL OR length(btrim(international_barcode)) BETWEEN 1 AND 255)
 AND (internal_scan_code IS NULL OR internal_scan_code ~ '^ITM-[A-Za-z0-9._-]{1,96}$')
 AND (source_sku IS NULL OR length(btrim(source_sku)) BETWEEN 1 AND 255)
 AND (code_type<>'internal' OR (international_barcode IS NULL AND internal_scan_code IS NOT NULL AND barcode=internal_scan_code))
 AND (code_type<>'international' OR (international_barcode IS NOT NULL AND barcode=international_barcode))
);
-- Bind an internal label once to one explicit ERP item, across source variants.
CREATE TABLE marketplace_internal_scan_codes (
 internal_scan_code TEXT PRIMARY KEY CHECK (internal_scan_code ~ '^ITM-[A-Za-z0-9._-]{1,96}$'),
 product_code TEXT NOT NULL CHECK (length(btrim(product_code)) BETWEEN 1 AND 100),
 created_by INTEGER NOT NULL REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
