// Opt-in, loopback-only PostgreSQL integration. Creates/drops only random schemas.
// WMS_BOOTSTRAP_PG_TEST=1 node --test src/__tests__/databaseBootstrap.pg.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { runMigrations } = require('../maintenance/migrationRunner');
const { bootstrapInitialAdmin } = require('../maintenance/bootstrapAdmin');
const { assertSchemaReady } = require('../config/schemaReadiness');
const { loadMigrationManifest, MIGRATION_LOCK_ID } = require('../config/migrationManifest');
const manifest = loadMigrationManifest();
const config = { host: '127.0.0.1', port: 55441, database: 'wms_scan_replay', user: 'wms_replay', password: 'wms_replay_local_only', ssl: false, max: 4, connectionTimeoutMillis: 3000 };
const account = () => ({ username: `setup_${randomBytes(6).toString('hex')}`, name: 'Synthetic administrator', password: randomBytes(24).toString('base64url') });
const expectCode = code => error => { assert.equal(error.code, code); return true; };

async function fixture(t) {
    const schema = `wms_bootstrap_${randomBytes(8).toString('hex')}`;
    const admin = new Pool(config);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const pool = new Pool({ ...config, options: `-c search_path=${schema},pg_catalog` });
    t.after(async () => { await pool.end(); try { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); } finally { await admin.end(); } });
    return { pool, schema, targetDatabase: config.database };
}
function cli(file, schema, extraEnv = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, '../..', file)], {
            env: { ...process.env, DATABASE_URL: '', NODE_ENV: 'test', PGHOST: config.host, PGPORT: String(config.port), PGDATABASE: config.database, PGUSER: config.user, PGPASSWORD: config.password, PGOPTIONS: `-c search_path=${schema},pg_catalog`, DB_SSL_MODE: 'disable', WMS_TARGET_DATABASE: config.database, ...extraEnv },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
        child.on('error', reject); child.on('close', code => resolve({ code, output }));
    });
}

test('isolated PostgreSQL schema initialization and one-time bootstrap', { skip: process.env.WMS_BOOTSTRAP_PG_TEST !== '1', timeout: 120000 }, async t => {
    await t.test('empty schema becomes ready only after every migration, without operational seed data; rerun is a no-op', async t => {
        const context = await fixture(t);
        await assert.rejects(assertSchemaReady(context.pool), expectCode('SCHEMA_NOT_READY'));
        const result = await runMigrations(context);
        assert.equal(result.applied.length, manifest.length); assert.equal(result.skipped.length, 0);
        assert.equal(await assertSchemaReady(context.pool), true);
        for (const table of ['users', 'orders', 'order_items', 'order_item_instances', 'operation_logs', 'team_posts', 'wms_bootstrap_state']) {
            assert.equal((await context.pool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count, 0, table);
        }
        assert.deepEqual((await context.pool.query('SELECT slug, name FROM team_channels')).rows, [{ slug: 'general', name: '公告板' }]);
        const rerun = await runMigrations(context);
        assert.equal(rerun.applied.length, 0); assert.equal(rerun.skipped.length, manifest.length);
        await context.pool.query('ALTER TABLE orders RENAME COLUMN warehouse TO missing_warehouse');
        await assert.rejects(assertSchemaReady(context.pool), error => error.code === 'SCHEMA_NOT_READY' && error.reason === 'REQUIRED_COLUMNS_MISSING');
    });
    await t.test('a failing migration rolls back its whole file and ledger; checksum drift is refused', async t => {
        const context = await fixture(t);
        await runMigrations(context);
        const sql = 'BEGIN;\nCREATE TABLE rollback_probe(id integer);\nINSERT INTO nonexistent_bootstrap_table VALUES (1);\nCOMMIT;';
        const failed = { name: '020_test_failure.sql', sql, checksum: createHash('sha256').update(sql).digest('hex') };
        await assert.rejects(runMigrations({ ...context, manifest: [...manifest, failed] }), error => error.code === '42P01' && error.migration === failed.name);
        assert.equal((await context.pool.query("SELECT to_regclass(format('%I.rollback_probe', current_schema())) AS relation")).rows[0].relation, null);
        assert.equal((await context.pool.query('SELECT count(*)::int AS count FROM wms_schema_migrations')).rows[0].count, manifest.length);
        await assert.rejects(assertSchemaReady(context.pool, { manifest: [...manifest, failed] }), expectCode('SCHEMA_NOT_READY'));
        await assert.rejects(runMigrations({ ...context, manifest: manifest.map((m, i) => i ? m : { ...m, checksum: '0'.repeat(64) }) }), expectCode('MIGRATION_CHECKSUM_MISMATCH'));
        assert.equal(await assertSchemaReady(context.pool), true);
    });
    await t.test('existing untracked schema and wrong target DB cannot be adopted or changed', async t => {
        const context = await fixture(t);
        await assert.rejects(runMigrations({ ...context, targetDatabase: 'wrong_database' }), expectCode('TARGET_DATABASE_MISMATCH'));
        await context.pool.query('CREATE TABLE existing_business_record(id integer)');
        await context.pool.query('INSERT INTO existing_business_record VALUES (73)');
        await assert.rejects(runMigrations(context), expectCode('UNTRACKED_SCHEMA_REQUIRES_AUDIT'));
        assert.deepEqual((await context.pool.query('SELECT * FROM existing_business_record')).rows, [{ id: 73 }]);
        assert.equal((await context.pool.query("SELECT to_regclass(format('%I.wms_schema_migrations', current_schema())) AS relation")).rows[0].relation, null);
    });
    await t.test('a second migration job fails before initialization while advisory lock is held', async t => {
        const context = await fixture(t), owner = await context.pool.connect();
        try {
            await owner.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
            await assert.rejects(runMigrations(context), expectCode('MIGRATION_ALREADY_RUNNING'));
        } finally { await owner.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]); owner.release(); }
        assert.equal((await runMigrations(context)).applied.length, manifest.length);
    });
    await t.test('concurrent bootstrap creates exactly one hashed superadmin; marker blocks reuse after users are deleted', async t => {
        const context = await fixture(t); await runMigrations(context);
        const first = account(), second = account();
        const results = await Promise.allSettled([first, second].map(credentials => bootstrapInitialAdmin({ ...context, credentials })));
        assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
        assert.equal(results.find(x => x.status === 'rejected').reason.code, 'BOOTSTRAP_ALREADY_USED');
        const users = (await context.pool.query('SELECT * FROM users')).rows;
        assert.equal(users.length, 1); assert.equal(users[0].role, 'superadmin');
        const source = [first, second].find(x => x.username === users[0].username);
        assert.notEqual(users[0].password, source.password); assert.equal(await bcrypt.compare(source.password, users[0].password), true);
        const logs = (await context.pool.query('SELECT action_type, details FROM operation_logs')).rows;
        assert.equal(logs.length, 1); assert.equal(logs[0].action_type, 'bootstrap_admin');
        assert.equal(JSON.stringify(logs).includes(source.password), false); assert.equal(JSON.stringify(logs).includes(users[0].password), false);
        await context.pool.query('DELETE FROM users');
        await assert.rejects(bootstrapInitialAdmin({ ...context, credentials: account() }), expectCode('BOOTSTRAP_ALREADY_USED'));
        assert.equal((await context.pool.query('SELECT count(*)::int AS count FROM users')).rows[0].count, 0);
        assert.equal((await context.pool.query('SELECT user_id FROM wms_bootstrap_state')).rows[0].user_id, null);
    });
    await t.test('any existing user blocks initial bootstrap, even without a superadmin or setup marker', async t => {
        const context = await fixture(t); await runMigrations(context);
        await context.pool.query("INSERT INTO users(username, password, name, role) VALUES ('synthetic_picker', 'synthetic-unusable-hash', 'Fixture', 'picker')");
        await assert.rejects(bootstrapInitialAdmin({ ...context, credentials: account() }), expectCode('BOOTSTRAP_ALREADY_USED'));
        assert.equal((await context.pool.query('SELECT count(*)::int AS count FROM wms_bootstrap_state')).rows[0].count, 0);
    });
    await t.test('offline CLIs initialize, bootstrap from mounted JSON and exit nonzero on reuse without logging credentials', async t => {
        const context = await fixture(t);
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wms-bootstrap-secret-test-'));
        t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
        const secretPath = path.join(directory, 'account.json'), credentials = account();
        fs.writeFileSync(secretPath, JSON.stringify(credentials), { mode: 0o600 });
        const migrated = await cli('migrations/run.js', context.schema);
        assert.equal(migrated.code, 0, migrated.output); assert.equal(await assertSchemaReady(context.pool), true);
        const created = await cli('scripts/bootstrap-admin.js', context.schema, { WMS_BOOTSTRAP_SECRET_FILE: secretPath });
        assert.equal(created.code, 0, created.output);
        const repeated = await cli('scripts/bootstrap-admin.js', context.schema, { WMS_BOOTSTRAP_SECRET_FILE: secretPath });
        assert.equal(repeated.code, 1); assert.match(repeated.output, /BOOTSTRAP_ALREADY_USED/);
        for (const result of [migrated, created, repeated]) {
            assert.equal(result.output.includes(credentials.password), false); assert.equal(result.output.includes(credentials.username), false); assert.equal(result.output.includes(config.password), false);
        }
        fs.writeFileSync(secretPath, 'null');
        const invalid = await cli('scripts/bootstrap-admin.js', context.schema, { WMS_BOOTSTRAP_SECRET_FILE: secretPath });
        assert.equal(invalid.code, 1); assert.match(invalid.output, /BOOTSTRAP_SECRET_INVALID/);
        const wrongTarget = await cli('migrations/run.js', context.schema, { WMS_TARGET_DATABASE: 'wrong_database' });
        assert.equal(wrongTarget.code, 1); assert.match(wrongTarget.output, /TARGET_DATABASE_MISMATCH/);
    });
});
