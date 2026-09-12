jest.mock('../config/database', () => ({ pool: { query: jest.fn() } }));
jest.mock('../utils/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const authService = require('../services/authService');
const router = require('../routes/authRoutes');
const refresh = router.stack.find(layer => layer.route?.path === '/refresh').route.stack.at(-1).handle;
const secret = 'synthetic-refresh-test-only';
const oldClaims = { id: 7, username: 'old-name', name: 'Old name', role: 'superadmin' };
const currentUser = { id: 7, username: 'current-name', name: 'Current name', role: 'picker' };

let previousSecret;
beforeEach(() => {
    previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = secret;
});
afterEach(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
});

function response() { return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() }; }

test('complete old superadmin claims refresh only with the current account and downgraded role', async () => {
    const oldToken = jwt.sign(oldClaims, secret, { expiresIn: '1h' });
    pool.query.mockResolvedValueOnce({ rows: [currentUser], rowCount: 1 });
    const token = await authService.refreshToken(oldToken);
    const decoded = jwt.verify(token, secret);
    expect(pool.query).toHaveBeenCalledWith('SELECT id, username, name, role FROM users WHERE id = $1', [7]);
    expect(decoded).toMatchObject(currentUser);
    expect(decoded.exp - decoded.iat).toBe(8 * 60 * 60);
    expect(decoded).not.toHaveProperty('userId');
});

test('legacy userId tokens are supported and the current role is normalized', async () => {
    const oldToken = jwt.sign({ userId: 7, role: 'admin' }, secret, { expiresIn: '1h' });
    pool.query.mockResolvedValueOnce({ rows: [{ ...currentUser, role: ' PACKER ' }], rowCount: 1 });
    const decoded = jwt.verify(await authService.refreshToken(oldToken), secret);
    expect(decoded).toMatchObject({ id: 7, username: 'current-name', name: 'Current name', role: 'packer' });
    expect(pool.query).toHaveBeenCalledTimes(1);
});

test('a cleared database role never falls back to the old privileged role', async () => {
    const oldToken = jwt.sign(oldClaims, secret, { expiresIn: '1h' });
    pool.query.mockResolvedValueOnce({ rows: [{ ...currentUser, role: null, name: null }], rowCount: 1 });
    const decoded = jwt.verify(await authService.refreshToken(oldToken), secret);
    expect(decoded.role).toBeNull();
    expect(decoded.name).toBeNull();
});

test('deleted users cannot refresh even when every identity claim exists in the old token', async () => {
    const oldToken = jwt.sign(oldClaims, secret, { expiresIn: '1h' });
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const sign = jest.spyOn(jwt, 'sign');
    const res = response();
    const next = jest.fn();
    await refresh({ body: { token: oldToken } }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: '找不到用戶' });
    expect(sign).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
});

test.each(['invalid signature', 'expired', 'missing identity'])('%s cannot issue a token or query an account', async kind => {
    const token = kind === 'invalid signature'
        ? jwt.sign(oldClaims, 'another-synthetic-secret')
        : kind === 'expired'
            ? jwt.sign(oldClaims, secret, { expiresIn: -1 })
            : jwt.sign({ role: 'admin' }, secret, { expiresIn: '1h' });
    const sign = jest.spyOn(jwt, 'sign');
    const res = response();
    await refresh({ body: { token } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(sign).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
});

test('database failure cannot issue a token and passes to the existing error handler', async () => {
    const oldToken = jwt.sign(oldClaims, secret, { expiresIn: '1h' });
    const databaseError = new Error('synthetic database unavailable');
    pool.query.mockRejectedValueOnce(databaseError);
    const sign = jest.spyOn(jwt, 'sign');
    const res = response();
    const next = jest.fn();
    await refresh({ body: { token: oldToken } }, res, next);
    expect(sign).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(databaseError);
});

test('refresh response remains exactly accessToken and missing input remains 400', async () => {
    const oldToken = jwt.sign(oldClaims, secret, { expiresIn: '1h' });
    pool.query.mockResolvedValueOnce({ rows: [currentUser], rowCount: 1 });
    const res = response();
    const next = jest.fn();
    await refresh({ body: { token: oldToken } }, res, next);
    const body = res.json.mock.calls[0][0];
    expect(Object.keys(body)).toEqual(['accessToken']);
    expect(jwt.verify(body.accessToken, secret).role).toBe('picker');
    expect(next).not.toHaveBeenCalled();
    const empty = response();
    await refresh({ body: {} }, empty, next);
    expect(empty.status).toHaveBeenCalledWith(400);
    expect(pool.query).toHaveBeenCalledTimes(1);
});
