// Offline release job. Environment/Secret Manager injection only; never auto-load .env.
const { Pool } = require('pg');
const { getDatabaseOptions } = require('../src/config/runtime');
const { runMigrations } = require('../src/maintenance/migrationRunner');

async function main(env = process.env) {
    const pool = new Pool({ ...getDatabaseOptions(env), max: 1 });
    try {
        const result = await runMigrations({ pool, targetDatabase: env.WMS_TARGET_DATABASE, log: message => console.log(message) });
        console.log(`Migration complete: ${result.applied.length} applied, ${result.skipped.length} already applied.`);
        return result;
    } finally { await pool.end(); }
}
if (require.main === module) main().catch(error => {
    // Do not print connection options, SQL parameter values or secrets.
    console.error('Migration failed; release must stop.', { code: error.code || 'MIGRATION_FAILED', migration: error.migration || null });
    process.exitCode = 1;
});
module.exports = { main };
