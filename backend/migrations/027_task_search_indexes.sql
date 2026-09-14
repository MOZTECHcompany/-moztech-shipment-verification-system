-- Run explicitly in the release migration job, never during application startup.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE INDEX IF NOT EXISTS idx_wms_voucher_normalized_trgm ON orders USING gin ((lower(normalize(COALESCE(voucher_number,''),NFKC))) public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_wms_customer_normalized_trgm ON orders USING gin ((lower(normalize(COALESCE(customer_name,''),NFKC))) public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_wms_voucher_compact_trgm ON orders USING gin ((regexp_replace(lower(normalize(COALESCE(voucher_number,''),NFKC)), '[^[:alnum:]]','','g')) public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_wms_customer_compact_trgm ON orders USING gin ((regexp_replace(lower(normalize(COALESCE(customer_name,''),NFKC)), '[^[:alnum:]]','','g')) public.gin_trgm_ops);
