// Synthetic loopback fixture for actual production UI/API. No ECOUNT account or network integration.
const { createEcountReferenceFixture } = require('./ecountReferenceFixture.cjs');
const bcrypt = require('bcryptjs');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
    if (process.env.WMS_ECOUNT_REFERENCE_LOCAL_DEV !== '1') throw Error('Synthetic local opt-in required');
    const local = require('./local-pg-config.cjs')();
    const f = await createEcountReferenceFixture();
    const target = await f.complete25WithReleased(), mixed = await f.completeMixed(), uncertain = await f.completeOrdinary();
    const pending = await f.seed(2);
    const database = (await f.db.query('SELECT current_database() AS name')).rows[0].name;
    await f.db.query('UPDATE users SET password=$1', [await bcrypt.hash('ecount-reference-fixture-only', 4)]);
    const apiPort = Number(process.env.WMS_ECOUNT_REFERENCE_API_PORT || 55459), webPort = Number(process.env.WMS_ECOUNT_REFERENCE_WEB_PORT || 55779);
    for (const port of [apiPort,webPort]) if (!Number.isSafeInteger(port) || port < 55000 || port > 55999) throw Error('Dedicated local fixture ports required');
    Object.assign(process.env, { NODE_ENV:'test', DATABASE_URL:'', PGHOST:local.host, PGPORT:String(local.port), PGUSER:local.user,
        PGPASSWORD:local.password, PGDATABASE:database, JWT_SECRET:'ecount-reference-local-fixture-not-production', DB_POOL_MAX:'4',
        DB_SSL_MODE:'disable', STORAGE_BACKEND:'local', CORS_ORIGINS:`http://127.0.0.1:${webPort}`, WMS_ECPAY_ACCOUNTS_JSON:'[]', WMS_ECPAY_CALLBACKS_ENABLED:'false' });
    const { app, server, io } = require('../src/app');
    // This synthetic-only helper exposes counts, never actual credentials/records.
    app.get('/__ecount_fixture_counts', async (req,res) => {
        const rows = (await f.db.query(`SELECT (SELECT count(*)::int FROM orders) orders,
            (SELECT count(*)::int FROM wms_ecount_order_references) references,
            (SELECT count(*)::int FROM wms_ecount_reference_history) history`)).rows[0];
        res.json(rows);
    });
    const fixtures = { apiBase:`http://127.0.0.1:${apiPort}`, webBase:`http://127.0.0.1:${webPort}`,
        target25:target.order.id, mixed:mixed.order.id, uncertain:uncertain.order.id, pending:pending.order.id,
        mixedSNs:[...mixed.sns,mixed.looseSN] };
    if (process.env.WMS_ECOUNT_REFERENCE_OUTPUT) {
        fs.mkdirSync(process.env.WMS_ECOUNT_REFERENCE_OUTPUT, {recursive:true});
        fs.writeFileSync(path.join(process.env.WMS_ECOUNT_REFERENCE_OUTPUT,'browser-fixtures.json'),JSON.stringify(fixtures,null,2));
    }
    await new Promise(resolve => server.listen(apiPort,'127.0.0.1',resolve));
    console.log(JSON.stringify({status:'synthetic-ecount-reference-ready',...fixtures}));
    let stopped=false;
    const stop=async()=>{if(stopped)return;stopped=true;await new Promise(resolve=>io.close(resolve));await require('../src/config/database').closePool();await f.close();process.exit(0)};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
})().catch(error=>{console.error(error);process.exitCode=1});
