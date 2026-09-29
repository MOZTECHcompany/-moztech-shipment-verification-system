ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('superadmin','admin','dispatcher','picker','packer','viewer'));
ALTER TABLE operation_logs ADD COLUMN actor_name TEXT;
ALTER TABLE operation_logs ADD COLUMN actor_role TEXT;
ALTER TABLE operation_logs ADD COLUMN actor_erp_user_id TEXT;
ALTER TABLE operation_logs ADD COLUMN entity_id TEXT;
CREATE FUNCTION snapshot_operation_actor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT u.name, u.role, e.erp_user_id, e.entity_id
  INTO NEW.actor_name, NEW.actor_role, NEW.actor_erp_user_id, NEW.entity_id
  FROM users u LEFT JOIN erp_staff_identities e ON e.wms_user_id=u.id WHERE u.id=NEW.user_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER operation_actor_snapshot BEFORE INSERT ON operation_logs FOR EACH ROW EXECUTE FUNCTION snapshot_operation_actor();
