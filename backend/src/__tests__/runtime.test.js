const { getAllowedOrigins, getDatabaseOptions, getSocketAllowedOrigins } = require('../config/runtime');

test('native socket origin extends only enabled trusted ERP SSO and leaves HTTP CORS unchanged', () => {
    const env = { NODE_ENV: 'production', CORS_ORIGINS: 'https://wms.example', ERP_PORTAL_ORIGIN: 'https://erp.example' };
    expect(getSocketAllowedOrigins(env)).toEqual(['https://wms.example']);
    expect(getSocketAllowedOrigins({ ...env, ERP_PORTAL_SSO_ENABLED: 'true' })).toEqual(['https://wms.example', 'https://erp.example']);
    expect(getAllowedOrigins({ ...env, ERP_PORTAL_SSO_ENABLED: 'true' })).toEqual(['https://wms.example']);
    for (const origin of ['https://erp.example/path', 'https://erp.example/', 'https://user:password@erp.example', 'http://erp.example']) {
        expect(() => getSocketAllowedOrigins({ ...env, ERP_PORTAL_SSO_ENABLED: 'true', ERP_PORTAL_ORIGIN: origin })).toThrow();
    }
});
test('local database guard rejects missing and remote destinations', () => {
    expect(() => getDatabaseOptions({})).toThrow();
    expect(() => getDatabaseOptions({ DATABASE_URL: 'postgresql://user:pass@remote.example/wms' })).toThrow();
    expect(() => getDatabaseOptions({ DATABASE_URL: 'postgresql://user:pass@localhost/wms?host=remote.example' })).toThrow();
    expect(getDatabaseOptions({ PGHOST: '127.0.0.1' }).ssl).toBe(false);
});
test('Cloud SQL Unix socket and verified TCP TLS are explicit', () => {
    expect(getDatabaseOptions({ NODE_ENV: 'production', PGHOST: '/cloudsql/project:region:instance' }).ssl).toBe(false);
    expect(getDatabaseOptions({ NODE_ENV: 'production', PGHOST: 'db.example' }).ssl).toEqual({ rejectUnauthorized: true });
    expect(() => getDatabaseOptions({ NODE_ENV: 'production', PGHOST: 'db.example', DB_SSL_MODE: 'insecure' })).toThrow();
});
test('CORS requires exact origins in production and defaults to local development', () => {
    expect(() => getAllowedOrigins({ NODE_ENV: 'production' })).toThrow();
    expect(() => getAllowedOrigins({ CORS_ORIGINS: '*' })).toThrow();
    expect(getAllowedOrigins({})).toContain('http://localhost:5173');
    expect(getAllowedOrigins({ NODE_ENV: 'production', CORS_ORIGINS: 'https://candidate.example' })).toEqual(['https://candidate.example']);
});
