const { loadMigrationManifest, MIGRATION_LOCK_ID } = require('../config/migrationManifest');
const failure = code => Object.assign(new Error(code), { code });

function transactionalSql(sql) {
    // Legacy 011/012 files contain outer BEGIN/COMMIT. The runner owns their
    // transaction so each schema change and ledger entry commit atomically.
    const starts = sql.match(/^\s*BEGIN;\s*$/gm) || [];
    const ends = sql.match(/^\s*COMMIT;\s*$/gm) || [];
    if (starts.length !== ends.length || starts.length > 1 || /^\s*ROLLBACK\b/gmi.test(sql) || /\bCONCURRENTLY\b/i.test(sql)) throw failure('UNSUPPORTED_MIGRATION_TRANSACTION');
    return sql.replace(/^\s*(?:BEGIN|COMMIT);\s*$/gm, '');
}

async function runMigrations({ pool, targetDatabase, manifest = loadMigrationManifest(), log = () => {} }) {
    if (!targetDatabase || typeof targetDatabase !== 'string') throw failure('TARGET_DATABASE_REQUIRED');
    if (!manifest.length) throw failure('MIGRATION_MANIFEST_EMPTY');
    const client = await pool.connect();
    let locked = false, transactionOpen = false;
    const applied = [], skipped = [];
    try {
        const location = await client.query('SELECT current_database() AS database, current_schema() AS schema');
        if (location.rows[0]?.database !== targetDatabase) throw failure('TARGET_DATABASE_MISMATCH');
        const lock = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [MIGRATION_LOCK_ID]);
        if (!lock.rows[0]?.acquired) throw failure('MIGRATION_ALREADY_RUNNING');
        locked = true;
        const ledger = await client.query("SELECT to_regclass(format('%I.wms_schema_migrations', current_schema())) AS relation");
        if (!ledger.rows[0]?.relation) {
            const existing = await client.query("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE') AS present");
            if (existing.rows[0]?.present) throw failure('UNTRACKED_SCHEMA_REQUIRES_AUDIT');
            await client.query(`CREATE TABLE wms_schema_migrations (name TEXT PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        }
        const history = await client.query('SELECT name, checksum FROM wms_schema_migrations');
        const known = new Map(manifest.map(m => [m.name, m]));
        for (const row of history.rows) {
            if (!known.has(row.name)) throw failure('DATABASE_MIGRATIONS_NEWER_THAN_IMAGE');
            if (known.get(row.name).checksum !== row.checksum) throw failure('MIGRATION_CHECKSUM_MISMATCH');
        }
        const completed = new Set(history.rows.map(row => row.name));
        for (const migration of manifest) {
            if (completed.has(migration.name)) { skipped.push(migration.name); continue; }
            try {
                const sql = transactionalSql(migration.sql);
                await client.query('BEGIN'); transactionOpen = true;
                await client.query("SET LOCAL lock_timeout = '10s'");
                await client.query("SET LOCAL statement_timeout = '5min'");
                await client.query(sql);
                await client.query('INSERT INTO wms_schema_migrations (name, checksum) VALUES ($1, $2)', [migration.name, migration.checksum]);
                await client.query('COMMIT'); transactionOpen = false;
                applied.push(migration.name); log(`Applied ${migration.name}`);
            } catch (error) { error.migration = migration.name; throw error; }
        }
        return { applied, skipped };
    } finally {
        let cleanupError;
        try {
            if (transactionOpen) await client.query('ROLLBACK');
            if (locked) await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
        } catch (error) { cleanupError = error; throw error; }
        finally { client.release(cleanupError); }
    }
}
module.exports = { runMigrations, transactionalSql };
