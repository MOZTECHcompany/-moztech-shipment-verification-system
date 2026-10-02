-- Confirmed exceptions keep platform variants and physical barcodes distinct.
-- These are reference reviews, not product records or inventory movements.
CREATE TABLE marketplace_product_mapping_reviews (
 id BIGSERIAL PRIMARY KEY,
 store_profile_id INTEGER NOT NULL REFERENCES marketplace_store_profiles(id),
 fingerprint CHAR(64) NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
 evidence JSONB NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
 confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
 confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 revoked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
 revoked_at TIMESTAMPTZ,
 CHECK (evidence->>'storeProfileId' = store_profile_id::text)
);
CREATE UNIQUE INDEX marketplace_product_mapping_reviews_active_identity
 ON marketplace_product_mapping_reviews(store_profile_id, fingerprint)
 WHERE revoked_at IS NULL;

