-- Reusable conversion settings only; no product or order data.
CREATE TABLE marketplace_store_profiles (
 id SERIAL PRIMARY KEY,
 platform VARCHAR(30) NOT NULL CHECK (platform IN ('Shopify','SHOPLINE','1Shop')),
 store VARCHAR(100) NOT NULL,
 settings JSONB NOT NULL,
 updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(platform,store)
);
