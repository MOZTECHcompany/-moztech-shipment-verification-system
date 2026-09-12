const priorJwtSecret = process.env.JWT_SECRET;
beforeAll(() => { process.env.JWT_SECRET = 'local-jest-auth-fixture-only'; });
afterAll(() => { if (priorJwtSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = priorJwtSecret; });
jest.mock('../config/database', () => ({ pool: { query: jest.fn() } }));
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { authenticateToken, authorizeAdmin } = require('../middleware/auth');
const app = express();
app.get('/admin', authenticateToken, authorizeAdmin, (req, res) => res.json(req.user));
const token = (payload = { id: 7, role: 'superadmin' }, opts = {}) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h', ...opts });

test.each(['picker', 'packer', 'dispatcher'])('old elevated token cannot bypass current %s role', async role => {
    pool.query.mockResolvedValue({ rows: [{ id: 7, username: 'operator', name: 'Operator', role }] });
    expect((await request(app).get('/admin').auth(token(), { type: 'bearer' })).status).toBe(403);
});
test('deleted account cannot use a previously valid token', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    expect((await request(app).get('/admin').auth(token(), { type: 'bearer' })).status).toBe(403);
});
test('legacy userId claim works with current admin role and name', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 7, username: 'operator', name: 'Current name', role: ' Admin ' }] });
    const res = await request(app).get('/admin').auth(token({ userId: 7, role: 'picker' }), { type: 'bearer' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 7, username: 'operator', name: 'Current name', role: 'admin' });
    expect(pool.query.mock.calls[0][0].values).toEqual([7]);
});
test('database outage fails closed without treating the user as logged out', async () => {
    pool.query.mockRejectedValue(new Error('database unavailable'));
    const res = await request(app).get('/admin').auth(token(), { type: 'bearer' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('AUTH_UNAVAILABLE');
});
test('missing or expired credentials never query staff data', async () => {
    expect((await request(app).get('/admin')).status).toBe(401);
    expect((await request(app).get('/admin').auth(token({}, { expiresIn: '-1s' }), { type: 'bearer' })).status).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
});
