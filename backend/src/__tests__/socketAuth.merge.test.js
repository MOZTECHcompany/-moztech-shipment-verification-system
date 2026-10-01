jest.mock('../services/erpSession', () => ({ isManaged: jest.fn(), resolveUser: jest.fn() }));
const jwt = require('jsonwebtoken');
const erp = require('../services/erpSession');
const { createSocketAuthenticator, guardSocketSession } = require('../middleware/socketAuth');
const secret = 'isolated-socket-merge-unit-test';
const originalPortalOnly = process.env.ERP_PORTAL_ONLY;
let pool;
const user = () => ({ id: 7, username: 'warehouse', name: '倉儲主管', role: 'admin', management_scope: 'warehouse' });
const handshake = claims => ({ handshake: { auth: { token: jwt.sign({ id: 7, ...claims }, secret, { expiresIn: '8h' }) } }, data: {} });

beforeEach(() => {
    delete process.env.ERP_PORTAL_ONLY;
    erp.isManaged.mockResolvedValue(false);
    erp.resolveUser.mockResolvedValue(user());
    pool = { query: jest.fn().mockResolvedValue({ rows: [user()] }) };
});
afterEach(() => {
    jest.useRealTimers();
    if (originalPortalOnly === undefined) delete process.env.ERP_PORTAL_ONLY;
    else process.env.ERP_PORTAL_ONLY = originalPortalOnly;
});

test('the merge uses DB scope and still refuses a local token for a managed ERP identity', async () => {
    const socket = handshake({ role: 'superadmin', management_scope: 'all' }), next = jest.fn();
    await createSocketAuthenticator({ pool, secret })(socket, next);
    expect(next).toHaveBeenCalledWith();
    expect(socket.data.user).toEqual(user());
    erp.isManaged.mockResolvedValue(true);
    const reject = jest.fn();
    await createSocketAuthenticator({ pool, secret })(handshake({}), reject);
    expect(reject.mock.calls[0][0].data.code).toBe('SOCKET_AUTH_REQUIRED');
});

test('ERP-only mode accepts only the live ERP-session resolver and preserves its scope', async () => {
    process.env.ERP_PORTAL_ONLY = 'true';
    const socket = handshake({ erpSession: 'session-from-validated-portal', erpSubject: 'staff' }), next = jest.fn();
    await createSocketAuthenticator({ pool, secret })(socket, next);
    expect(next).toHaveBeenCalledWith();
    expect(socket.data.user.management_scope).toBe('warehouse');
    expect(socket.data.erpClaims.erpSubject).toBe('staff');
    expect(pool.query).not.toHaveBeenCalled();
});

test.each([false, true])('a management-scope change closes the %s ERP session on its periodic check', async managed => {
    jest.useFakeTimers();
    const current = user();
    const socket = { connected: true, data: { user: current, authExpiresAt: Date.now() + 60000,
        erpClaims: managed ? { erpSession: 'live-session' } : null }, emit: jest.fn(), once: jest.fn(),
        disconnect: jest.fn(function () { this.connected = false; }) };
    guardSocketSession(socket, { pool, recheckMs: 30 });
    if (managed) erp.resolveUser.mockResolvedValue({ ...current, management_scope: 'orders' });
    else pool.query.mockResolvedValue({ rows: [{ ...current, management_scope: 'orders' }] });
    await jest.advanceTimersByTimeAsync(30);
    expect(socket.emit).toHaveBeenCalledWith('session_expired', { code: 'SOCKET_AUTH_REQUIRED' });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
});
