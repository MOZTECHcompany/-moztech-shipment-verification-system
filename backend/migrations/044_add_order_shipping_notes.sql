-- Additive: existing orders keep an empty note list; quantities and audit rows
-- are unchanged. The migration runner owns the transaction and ledger entry.
SET LOCAL lock_timeout = '1500ms';
ALTER TABLE orders ADD COLUMN shipping_notes JSONB NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN orders.shipping_notes IS 'Imported WMS-NOTE instructions, [{sourceRow,text}]; never SKU or scan quantities';
