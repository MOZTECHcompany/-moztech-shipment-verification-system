// Test-only loopback database. Alternate ports let independent test runs coexist
// without starting, stopping or sharing another task's PostgreSQL server.
module.exports = function localPgConfig() {
    const raw = process.env.WMS_PARITY_PG_PORT || '55441';
    const port = Number(raw);
    if (!/^\d{5}$/.test(raw) || port < 55000 || port > 55999) throw Error('Use a dedicated local test PostgreSQL port in 55000-55999');
    return { host: '127.0.0.1', port, user: 'wms_replay', password: 'wms_replay_local_only', database: 'postgres' };
};
