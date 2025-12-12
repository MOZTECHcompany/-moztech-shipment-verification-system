# Fix Database Migration Error (Index Already Exists)

## Problem
The deployment failed with the following error:
```
❌ 遷移執行失敗: relation "idx_product_defects_order_id" already exists
```
This happened because the migration script `backend/migrations/007_product_defects.sql` tried to create indexes that already existed in the database, and the script was not idempotent (it didn't check if the indexes existed before creating them).

## Solution
Modified `backend/migrations/007_product_defects.sql` to include `IF NOT EXISTS` in the `CREATE INDEX` statements.

## Changes
- Modified `backend/migrations/007_product_defects.sql`:
    - Changed `CREATE INDEX idx_product_defects_order_id ...` to `CREATE INDEX IF NOT EXISTS idx_product_defects_order_id ...`
    - Changed `CREATE INDEX idx_product_defects_product_barcode ...` to `CREATE INDEX IF NOT EXISTS idx_product_defects_product_barcode ...`
    - Changed `CREATE INDEX idx_product_defects_created_at ...` to `CREATE INDEX IF NOT EXISTS idx_product_defects_created_at ...`

## Verification
- This ensures that the migration can be run multiple times without failing due to existing indexes.
