const bcrypt = require('bcryptjs');
const { assertSchemaReady } = require('../config/schemaReadiness');
const { MIGRATION_LOCK_ID } = require('../config/migrationManifest');
const failure = code => Object.assign(new Error(code), { code });

function validateBootstrapCredentials(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('BOOTSTRAP_SECRET_INVALID');
    const { username, name, password } = value;
    if (typeof username !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.@+-]{2,127}$/.test(username)) throw failure('BOOTSTRAP_USERNAME_INVALID');
    if (typeof name !== 'string' || !name.trim() || name.length > 255) throw failure('BOOTSTRAP_NAME_INVALID');
    if (typeof password !== 'string' || password.length < 16 || Buffer.byteLength(password, 'utf8') > 72 || /[\u0000\r\n]/.test(password)) throw failure('BOOTSTRAP_PASSWORD_INVALID');
    return { username, name: name.trim(), password };
}

async function bootstrapInitialAdmin({ pool, targetDatabase, credentials }) {
    if (!targetDatabase || typeof targetDatabase !== 'string') throw failure('TARGET_DATABASE_REQUIRED');
    const account = validateBootstrapCredentials(credentials);
    const client = await pool.connect();
    let transactionOpen = false;
    try {
        const location = await client.query('SELECT current_database() AS database');
        if (location.rows[0]?.database !== targetDatabase) throw failure('TARGET_DATABASE_MISMATCH');
        const passwordHash = await bcrypt.hash(account.password, 12);
        await client.query('BEGIN'); transactionOpen = true;
        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query("SET LOCAL statement_timeout = '30s'");
        // Same lock as the migration job, followed by a users write lock. Two jobs
        // cannot both initialize, and a simultaneous user insert is not overlooked.
        await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_ID]);
        await assertSchemaReady(client);
        await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
        const used = await client.query("SELECT EXISTS (SELECT 1 FROM users) OR EXISTS (SELECT 1 FROM wms_bootstrap_state WHERE purpose = 'initial-admin') AS used");
        if (used.rows[0]?.used) throw failure('BOOTSTRAP_ALREADY_USED');
        const created = await client.query("INSERT INTO users (username, password, name, role) VALUES ($1, $2, $3, 'superadmin') RETURNING id", [account.username, passwordHash, account.name]);
        const userId = created.rows[0].id;
        await client.query("INSERT INTO wms_bootstrap_state (purpose, user_id) VALUES ('initial-admin', $1)", [userId]);
        await client.query("INSERT INTO operation_logs (user_id, action_type, details) VALUES ($1, 'bootstrap_admin', $2)", [userId, JSON.stringify({ method: 'offline-secret-job', purpose: 'initial-admin' })]);
        await client.query('COMMIT'); transactionOpen = false;
        return { userId, role: 'superadmin' };
    } finally {
        account.password = undefined;
        let cleanupError;
        try { if (transactionOpen) await client.query('ROLLBACK'); }
        catch (error) { cleanupError = error; throw error; }
        finally { client.release(cleanupError); }
    }
}
module.exports = { bootstrapInitialAdmin, validateBootstrapCredentials };
