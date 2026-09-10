const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const MIGRATION_LOCK_ID = 742936401;
function loadMigrationManifest(directory = path.join(__dirname, '../../migrations')) {
    return fs.readdirSync(directory).filter(name => /^\d{3}_[A-Za-z0-9_]+\.sql$/.test(name)).sort().map(name => {
        const sql = fs.readFileSync(path.join(directory, name), 'utf8');
        return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    });
}
module.exports = { loadMigrationManifest, MIGRATION_LOCK_ID };
