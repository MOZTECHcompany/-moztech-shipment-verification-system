// Offline maintenance only. No dotenv, startup hook, or implicit deletion.
const { getDatabaseOptions } = require('../config/runtime');

function retentionPolicy(env) {
  const keys = ['RETENTION_LOGS_DAYS', 'RETENTION_MENTIONS_DAYS', 'RETENTION_READS_DAYS', 'RETENTION_IDLE_MINUTES'];
  const defaults = [180, 30, 90, 10];
  if (!env.WMS_TARGET_DATABASE?.trim()) throw new Error('WMS_TARGET_DATABASE_REQUIRED');
  if (env.WMS_RETENTION_APPLY !== undefined && !['true', 'false'].includes(env.WMS_RETENTION_APPLY)) throw new Error('INVALID_APPLY_FLAG');
  return keys.map((key, index) => {
    const value = String(env[key] ?? defaults[index]);
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 525600) throw new Error('INVALID_RETENTION_POLICY');
    return Number(value);
  });
}

async function runRetention({ client, env }) {
  const policy = retentionPolicy(env);
  const apply = env.WMS_RETENTION_APPLY === 'true';
  await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '3s'");
    const identity = await client.query('SELECT current_database() AS database');
    if (identity.rows[0].database !== env.WMS_TARGET_DATABASE) throw new Error('TARGET_DATABASE_MISMATCH');
    let result;
    if (apply) {
      result = (await client.query('SELECT run_all_purge($1, $2, $3, $4) AS result', policy)).rows[0].result;
    } else {
      result = (await client.query(`SELECT
        (SELECT count(*)::int FROM operation_logs WHERE created_at < NOW() - $1 * INTERVAL '1 day') AS operation_logs,
        (SELECT count(*)::int FROM task_mentions WHERE is_read = TRUE AND created_at < NOW() - $2 * INTERVAL '1 day') AS task_mentions,
        (SELECT count(*)::int FROM task_comment_reads WHERE read_at < NOW() - $3 * INTERVAL '1 day') AS comment_reads,
        (SELECT count(*)::int FROM active_sessions WHERE last_activity < NOW() - $4 * INTERVAL '1 minute') AS inactive_sessions`, policy)).rows[0];
    }
    await client.query('COMMIT');
    return { mode: apply ? 'applied' : 'preview', database: env.WMS_TARGET_DATABASE, policy, result };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function main(env = process.env) {
  retentionPolicy(env); // Validate before opening any connection.
  const { Client } = require('pg');
  const client = new Client({ host: env.PGHOST, port: env.PGPORT, database: env.PGDATABASE,
    user: env.PGUSER, password: env.PGPASSWORD, ...getDatabaseOptions(env) });
  try {
    await client.connect();
    const result = await runRetention({ client, env });
    console.log(JSON.stringify(result));
    return result;
  } finally { await client.end(); }
}
if (require.main === module) main().catch(error => {
  console.error('Retention stopped.', { code: error.code || error.message });
  process.exitCode = 1;
});
module.exports = { main, retentionPolicy, runRetention };
