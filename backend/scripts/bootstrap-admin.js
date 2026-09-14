// Offline, one-time Cloud Run job. Mount a Secret Manager JSON version at a file
// path passed through WMS_BOOTSTRAP_SECRET_FILE. Never expose an HTTP endpoint.
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { getDatabaseOptions } = require('../src/config/runtime');
const { bootstrapInitialAdmin } = require('../src/maintenance/bootstrapAdmin');

function readCredentialsFile(filename) {
    if (!filename || !path.isAbsolute(filename)) throw Object.assign(new Error('Absolute secret file path required'), { code: 'BOOTSTRAP_SECRET_FILE_REQUIRED' });
    const info = fs.statSync(filename);
    if (!info.isFile() || info.size > 8192) throw Object.assign(new Error('Invalid secret file'), { code: 'BOOTSTRAP_SECRET_FILE_INVALID' });
    try { return JSON.parse(fs.readFileSync(filename, 'utf8')); }
    catch { throw Object.assign(new Error('Invalid secret JSON'), { code: 'BOOTSTRAP_SECRET_INVALID' }); }
}
async function main(env = process.env) {
    const credentials = readCredentialsFile(env.WMS_BOOTSTRAP_SECRET_FILE);
    const pool = new Pool({ ...getDatabaseOptions(env), max: 1 });
    try {
        await bootstrapInitialAdmin({ pool, targetDatabase: env.WMS_TARGET_DATABASE, credentials });
        console.log('Initial administrator created. Remove the bootstrap secret binding before normal service operation.');
    } finally { if (credentials && typeof credentials === 'object') credentials.password = undefined; await pool.end(); }
}
if (require.main === module) main().catch(error => {
    console.error('Administrator initialization failed.', { code: error.code || 'BOOTSTRAP_FAILED' });
    process.exitCode = 1;
});
module.exports = { main, readCredentialsFile };
