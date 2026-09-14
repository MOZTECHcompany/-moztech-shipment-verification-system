-- Additive, backwards-compatible receipt storage. No quantity/stock changes.
CREATE TABLE IF NOT EXISTS wms_scan_commands (
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    command_id uuid NOT NULL,
    order_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    request_hash text NOT NULL,
    response jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, command_id)
);
CREATE INDEX IF NOT EXISTS idx_wms_scan_commands_order ON wms_scan_commands(order_id);
CREATE INDEX IF NOT EXISTS idx_wms_scan_commands_created ON wms_scan_commands(created_at);
