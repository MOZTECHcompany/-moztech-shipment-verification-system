-- Keep the established five-role contract; administrators can have a bounded
-- management scope. Existing accounts retain their permissions until assigned.
ALTER TABLE users ADD COLUMN management_scope VARCHAR(20) NOT NULL DEFAULT 'all'
    CHECK (management_scope IN ('all','orders','warehouse'));
