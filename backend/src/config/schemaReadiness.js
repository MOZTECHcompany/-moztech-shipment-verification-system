const { loadMigrationManifest } = require('./migrationManifest');
const expectedMigrations = loadMigrationManifest();
const requiredColumns = {
    users: ['id', 'username', 'password', 'name', 'role', 'created_at'],
    orders: ['id', 'voucher_number', 'customer_name', 'warehouse', 'void_reason', 'picker_id', 'packer_id', 'status', 'created_at', 'updated_at', 'is_urgent', 'completed_at'],
    order_items: ['id', 'order_id', 'product_code', 'product_name', 'barcode', 'quantity', 'picked_quantity', 'packed_quantity', 'updated_at'],
    order_item_instances: ['id', 'order_item_id', 'serial_number', 'status', 'created_at', 'updated_at'],
    operation_logs: ['id', 'user_id', 'order_id', 'item_id', 'action_type', 'operation_type', 'details', 'created_at'],
    task_comments: ['id', 'order_id', 'user_id', 'content', 'parent_id', 'priority', 'created_at', 'updated_at'],
    task_mentions: ['id', 'comment_id', 'mentioned_user_id', 'is_read', 'created_at'],
    task_assignments: ['id', 'order_id', 'from_user_id', 'to_user_id', 'task_type', 'reason', 'created_at'],
    active_sessions: ['id', 'order_id', 'user_id', 'session_type', 'last_activity'],
    task_comment_reads: ['id', 'comment_id', 'user_id', 'read_at'],
    task_comment_pins: ['id', 'order_id', 'user_id', 'comment_id', 'created_at'],
    task_pins: ['id', 'order_id', 'created_by', 'created_at'],
    product_defects: ['id', 'order_id', 'user_id', 'original_sn', 'new_sn', 'product_barcode', 'product_name', 'reason', 'created_at'],
    order_exceptions: ['id', 'order_id', 'order_item_id', 'instance_id', 'type', 'status', 'reason_code', 'reason_text', 'created_by', 'created_at', 'updated_at', 'ack_by', 'ack_at', 'ack_note', 'resolved_by', 'resolved_at', 'resolution_note', 'snapshot', 'resolution_action', 'rejected_by', 'rejected_at', 'rejected_note'],
    order_exception_attachments: ['id', 'exception_id', 'order_id', 'storage_key', 'original_name', 'mime_type', 'size_bytes', 'uploaded_by', 'uploaded_at'],
    team_channels: ['id', 'slug', 'name', 'created_at'],
    team_posts: ['id', 'channel_id', 'post_type', 'status', 'priority', 'title', 'content', 'due_at', 'created_by', 'created_at', 'updated_at'],
    team_post_assignees: ['post_id', 'user_id', 'assigned_at'],
    team_post_comments: ['id', 'post_id', 'user_id', 'content', 'created_at'],
    team_post_attachments: ['id', 'post_id', 'storage_key', 'original_name', 'mime_type', 'size_bytes', 'uploaded_by', 'uploaded_at'],
    wms_bootstrap_state: ['purpose', 'user_id', 'completed_at']
};
const notReady = reason => Object.assign(new Error('Database schema is not ready'), { code: 'SCHEMA_NOT_READY', reason });

// Read-only. Accepts either a pg Pool or a checked-out Client; never initializes.
async function assertSchemaReady(db, { manifest = expectedMigrations } = {}) {
    const ledger = await db.query("SELECT to_regclass(format('%I.wms_schema_migrations', current_schema())) AS relation");
    if (!ledger.rows[0]?.relation) throw notReady('MIGRATIONS_NOT_INITIALIZED');
    const history = await db.query('SELECT name, checksum FROM wms_schema_migrations');
    const applied = new Map(history.rows.map(row => [row.name, row.checksum]));
    if (!manifest.length || manifest.some(m => applied.get(m.name) !== m.checksum)) throw notReady('MIGRATIONS_INCOMPLETE_OR_CHANGED');
    const columns = await db.query('SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ANY($1::text[])', [Object.keys(requiredColumns)]);
    const found = new Set(columns.rows.map(row => `${row.table_name}.${row.column_name}`));
    if (Object.entries(requiredColumns).some(([table, names]) => names.some(name => !found.has(`${table}.${name}`)))) throw notReady('REQUIRED_COLUMNS_MISSING');
    const timestamps = columns.rows.filter(row => row.table_name === 'orders' && ['created_at', 'updated_at'].includes(row.column_name));
    if (timestamps.some(row => row.data_type !== 'timestamp with time zone')) throw notReady('ORDER_TIMEZONE_SCHEMA_MISMATCH');
    return true;
}
module.exports = { assertSchemaReady, requiredColumns };
