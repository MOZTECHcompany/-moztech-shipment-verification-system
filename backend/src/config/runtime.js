function getAllowedOrigins(env) {
    const defaults = env.NODE_ENV === 'production' ? [] : [
        'http://localhost:5173', 'http://127.0.0.1:5173',
        'http://localhost:3000', 'http://localhost:3001'
    ];
    const origins = env.CORS_ORIGINS === undefined ? defaults : env.CORS_ORIGINS.split(',').map(x => x.trim()).filter(Boolean);
    if (env.NODE_ENV === 'production' && !origins.length) throw new Error('CORS_ORIGINS is required in production');
    return origins.map(origin => {
        const url = new URL(origin);
        if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin || url.username || url.password) {
            throw new Error('CORS_ORIGINS must contain exact HTTP(S) origins');
        }
        return origin;
    });
}

function getDatabaseOptions(env) {
    const host = env.DATABASE_URL ? new URL(env.DATABASE_URL).hostname : env.PGHOST;
    if (!host) throw new Error('DATABASE_URL or PGHOST is required');
    if (env.NODE_ENV !== 'production' && !['localhost', '127.0.0.1', '[::1]'].includes(host)) {
        throw new Error('Non-production database must use a loopback host');
    }
    const mode = env.DB_SSL_MODE || (host.startsWith('/cloudsql/') ? 'disable' : env.NODE_ENV === 'production' ? 'verify-full' : 'disable');
    if (!['disable', 'verify-full'].includes(mode)) throw new Error('DB_SSL_MODE must be disable or verify-full');
    if (env.DATABASE_URL && [...new URL(env.DATABASE_URL).searchParams.keys()].some(k => k.startsWith('ssl') || k === 'host')) {
        throw new Error('Configure database TLS via DB_SSL_MODE, not URL ssl/host parameters');
    }
    const max = Number(env.DB_POOL_MAX || 10);
    if (!Number.isInteger(max) || max < 1 || max > 100) throw new Error('DB_POOL_MAX must be 1..100');
    return {
        connectionString: env.DATABASE_URL,
        ssl: mode === 'disable' ? false : { rejectUnauthorized: true },
        max,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
    };
}
module.exports = { getAllowedOrigins, getDatabaseOptions };
