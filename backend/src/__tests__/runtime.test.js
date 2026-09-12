const { getAllowedOrigins, getDatabaseOptions } = require('../config/runtime');
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
