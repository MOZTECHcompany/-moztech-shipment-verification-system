const request = require('supertest');
jest.mock('../config/database', () => ({ pool: { query: jest.fn(), connect: jest.fn(), end: jest.fn() } }));
const oldOrigins = process.env.CORS_ORIGINS;
process.env.CORS_ORIGINS = 'https://wms-candidate.example.test';
const { app, io } = require('../app');
afterAll(() => {
    io.close();
    if (oldOrigins === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = oldOrigins;
});
test('allowed frontend can preflight conditional comment reads and inspect validators', async () => {
    const preflight = await request(app).options('/api/tasks/1/comments')
        .set('Origin', 'https://wms-candidate.example.test')
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'authorization,if-none-match,cache-control');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('https://wms-candidate.example.test');
    const allowed = preflight.headers['access-control-allow-headers'].toLowerCase();
    expect(allowed).toContain('if-none-match');
    expect(allowed).toContain('cache-control');
    const health = await request(app).get('/health').set('Origin', 'https://wms-candidate.example.test');
    expect(health.headers['access-control-expose-headers']).toContain('ETag');
    expect(health.headers['access-control-expose-headers']).toContain('X-Request-Id');
});
test('unlisted origin does not receive cross-origin permission', async () => {
    const response = await request(app).get('/health').set('Origin', 'https://unlisted.example.test');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
});
