-- Read-only batch history is paged by the exact creation receipt identity.
CREATE INDEX idx_wms_box_spec_batch_history
    ON wms_box_spec_batch_commands(spec_id,created_at DESC,user_id DESC,command_id DESC);
