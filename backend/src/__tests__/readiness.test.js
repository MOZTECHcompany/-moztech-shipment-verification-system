jest.mock('../config/database', () => ({ pool: { query: jest.fn() } }));
jest.mock('../config/schemaReadiness', () => ({ assertSchemaReady: jest.fn() }));
const request = require('supertest');
const { app, server, io } = require('../app');
const { pool } = require('../config/database');
const { assertSchemaReady } = require('../config/schemaReadiness');
beforeAll(() => new Promise(resolve => server.listen(0, '127.0.0.1', resolve)));
beforeEach(() => { jest.clearAllMocks(); app.locals.draining = false; });
afterAll(() => new Promise(resolve => io.close(resolve)));

test('liveness does not query database or schema', async () => {
    await request(server).get('/health').expect(200);
    expect(pool.query).not.toHaveBeenCalled();
    expect(assertSchemaReady).not.toHaveBeenCalled();
});
test('readiness is 200 only after the schema assertion succeeds', async () => {
    assertSchemaReady.mockResolvedValueOnce(true);
    await request(server).get('/ready').expect(200);
    expect(assertSchemaReady).toHaveBeenCalledWith(pool);
});
test.each(['SCHEMA_NOT_READY', 'ECONNREFUSED'])('missing schema or offline database returns generic 503 (%s)', async code => {
    assertSchemaReady.mockRejectedValueOnce(Object.assign(new Error('private database detail'), { code }));
    const response = await request(server).get('/ready').expect(503);
    expect(response.text).not.toContain('private database detail');
    expect(response.text).not.toContain(code);
});
test('draining returns 503 without a fresh schema check', async () => {
    app.locals.draining = true;
    await request(server).get('/ready').expect(503);
    expect(assertSchemaReady).not.toHaveBeenCalled();
});
