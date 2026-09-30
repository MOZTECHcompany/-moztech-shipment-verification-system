-- Durable, explicitly acknowledged alerts, independent of chat read receipts.
CREATE TABLE order_change_notices (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE order_change_notice_recipients (
    notice_id INTEGER NOT NULL REFERENCES order_change_notices(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    acknowledged_at TIMESTAMPTZ,
    PRIMARY KEY (notice_id, user_id)
);
CREATE INDEX order_change_notice_unacknowledged ON order_change_notice_recipients(user_id, notice_id)
    WHERE acknowledged_at IS NULL;
CREATE INDEX order_change_notices_order ON order_change_notices(order_id, id);

-- Carry only still-pending order changes into the alert inbox at rollout.
INSERT INTO order_change_notices(order_id,actor_id,payload,created_at)
SELECT e.order_id,e.created_by,jsonb_build_object(
    'orderId',e.order_id,'voucherNumber',o.voucher_number,'exceptionId',e.id,
    'phase','requested','deletion',COALESCE(e.snapshot->'proposal'->>'action'='delete_order',FALSE),
    'category','order','actorId',e.created_by,'reason',e.reason_text,
    'title',CASE WHEN e.snapshot->'proposal'->>'action'='delete_order' THEN '刪除訂單待審核' ELSE '訂單異動待審核' END,
    'message','揀貨、裝箱暫停，等待主管審核。'),e.created_at AT TIME ZONE 'UTC'
FROM order_exceptions e JOIN orders o ON o.id=e.order_id WHERE e.type='order_change' AND e.status='open';
INSERT INTO order_change_notice_recipients(notice_id,user_id)
SELECT n.id,u.id FROM order_change_notices n JOIN orders o ON o.id=n.order_id JOIN users u ON
    (u.role='superadmin' OR (u.role='admin' AND u.management_scope IN ('all','warehouse'))
      OR u.id=o.picker_id OR u.id=o.packer_id
      OR u.id=(SELECT user_id FROM operation_logs WHERE order_id=o.id AND action_type='import' ORDER BY created_at DESC,id DESC LIMIT 1))
WHERE u.id IS DISTINCT FROM n.actor_id;
