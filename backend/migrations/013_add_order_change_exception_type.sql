-- 013_add_order_change_exception_type.sql
-- Add new exception type: order_change (for order item change requests)

DO $$
BEGIN
    -- Drop and recreate the CHECK constraint to include the new type.
    -- This is idempotent: if the constraint doesn't exist, we just add it.
    IF EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'chk_order_exceptions_type'
          AND table_name = 'order_exceptions'
    ) THEN
        ALTER TABLE order_exceptions DROP CONSTRAINT chk_order_exceptions_type;
    END IF;

    ALTER TABLE order_exceptions
        ADD CONSTRAINT chk_order_exceptions_type CHECK (
            type IN (
                'stockout','damage','over_scan','under_scan','sn_replace','other',
                'order_change'
            )
        );
EXCEPTION
    WHEN duplicate_object THEN
        -- constraint already exists (race / repeated runs)
        NULL;
END $$;
