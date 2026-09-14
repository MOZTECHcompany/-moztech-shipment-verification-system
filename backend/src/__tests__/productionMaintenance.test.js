jest.mock('../config/database', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../config/schemaReadiness', () => ({ assertSchemaReady: jest.fn() }));
jest.mock('../utils/logger', () => ({ debug: jest.fn(), debugSensitive: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('morgan', () => () => (_req, _res, next) => next());
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { assertSchemaReady } = require('../config/schemaReadiness');
const originalEnv = { node: process.env.NODE_ENV, cors: process.env.CORS_ORIGINS, secret: process.env.JWT_SECRET };
process.env.NODE_ENV = 'production';
process.env.CORS_ORIGINS = 'https://wms.example.invalid';
process.env.JWT_SECRET = 'synthetic-production-maintenance-test-only-secret';
const { app, io } = require('../app');
const token = jwt.sign({ id: 7, role: 'superadmin' }, process.env.JWT_SECRET, { expiresIn: '1h' });

beforeEach(() => {
    pool.query.mockImplementation(async query => {
        if (query?.text === 'SELECT id, username, name, role FROM users WHERE id = $1') {
            return { rows: [{ id: 7, username: 'synthetic-admin', role: 'superadmin' }] };
        }
        if (query === 'SELECT run_all_purge($1, $2, $3, $4) AS result') return { rows: [{ result: { operation_logs_deleted: 0 } }] };
        throw new Error('Unexpected non-identity query');
    });
});

afterAll(async () => {
    await new Promise(resolve => io.close(resolve));
    for (const [key, value] of [['NODE_ENV', originalEnv.node], ['CORS_ORIGINS', originalEnv.cors], ['JWT_SECRET', originalEnv.secret]]) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
});

test.each([
    ['post', '/api/migrate/add-priority-test'], ['post', '/api/admin/migrate/add-priority'],
    ['get', '/api/debug/tables'], ['get', '/api/debug/check-comment-reads'],
    ['post', '/api/admin/bootstrap/superadmin'], ['post', '/api/admin/maintenance/retention/run'],
    ['post', '/API/ADMIN/BOOTSTRAP/SUPERADMIN/'], ['post', '/api/Admin/Maintenance/Retention/Run/'],
    ['post', '/API/MIGRATE/ADD-PRIORITY-TEST/'], ['get', '/api/DEBUG/TABLES/'],
])('production disables %s %s even for superadmin and alternate route casing/slashes', async (method, path) => {
    await request(app)[method](path).set('Authorization', `Bearer ${token}`).send({}).expect(404);
    expect(pool.query.mock.calls.every(([query]) => query.text === 'SELECT id, username, name, role FROM users WHERE id = $1')).toBe(true);
    expect(pool.connect).not.toHaveBeenCalled();
});

test('production readiness uses the explicit schema contract and never infers readiness from a DB connection', async () => {
    assertSchemaReady.mockRejectedValueOnce(Object.assign(new Error('internal schema details'), { code: 'SCHEMA_NOT_READY' }));
    const missing = await request(app).get('/ready').expect(503);
    expect(missing.body).toEqual({ status: 'unavailable' });
    assertSchemaReady.mockResolvedValueOnce(true);
    await request(app).get('/ready').expect(200);
    expect(assertSchemaReady).toHaveBeenCalledWith(pool);
});

test.each(['development', 'test'])('%s retains the existing admin retention route', async environment => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = environment;
    try {
        const response = await request(app).post('/api/admin/maintenance/retention/run').set('Authorization', `Bearer ${token}`).send({}).expect(200);
        expect(response.body.success).toBe(true);
        expect(pool.query).toHaveBeenLastCalledWith('SELECT run_all_purge($1, $2, $3, $4) AS result', [180, 30, 90, 10]);
    } finally { process.env.NODE_ENV = previous; }
});
