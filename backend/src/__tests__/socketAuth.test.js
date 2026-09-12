const http = require('node:http');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');
const jwt = require('jsonwebtoken');
const { createSocketAuthenticator, guardSocketSession } = require('../middleware/socketAuth');

const secret = 'synthetic-socket-test-secret-not-used-outside-tests';
const account = { id: 7, username: 'fixture', name: 'Fixture staff', role: 'picker' };
const pool = { query: jest.fn() };
const clients = [];
let server, io, url, latestSocket;
let activeUser;
const signed = (claims = {}, options = {}) => jwt.sign({ id: 7, role: 'superadmin', ...claims }, secret, { expiresIn: '8h', ...options });
const event = (socket, name) => new Promise(resolve => socket.once(name, resolve));
function client(auth) {
    const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false, autoConnect: false, auth });
    clients.push(socket);
    return socket;
}

beforeAll(async () => {
    server = http.createServer();
    io = new Server(server, { transports: ['websocket'] });
    io.use(createSocketAuthenticator({ pool, secret }));
    io.on('connection', socket => { latestSocket = socket; guardSocketSession(socket, { pool, recheckMs: 30 }); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
    activeUser = { ...account };
    latestSocket = null;
    pool.query.mockReset().mockImplementation(async () => ({ rows: activeUser ? [{ ...activeUser }] : [] }));
});
afterEach(async () => {
    clients.splice(0).forEach(socket => socket.disconnect());
    io.disconnectSockets(true);
    await new Promise(resolve => setImmediate(resolve));
});
afterAll(async () => { await new Promise(resolve => io.close(resolve)); });

test.each([
    ['missing', {}],
    ['client-supplied user id/role only', { id: 7, role: 'superadmin' }],
    ['wrong signature', { token: jwt.sign({ id: 7 }, 'wrong-secret', { expiresIn: '8h' }) }],
    ['expired', { token: signed({}, { expiresIn: -1 }) }],
    ['missing expiration', { token: jwt.sign({ id: 7 }, secret) }],
    ['invalid user id', { token: signed({ id: 'not-an-id' }) }],
    ['unsupported algorithm', { token: signed({}, { algorithm: 'HS384' }) }],
])('rejects %s before any database read or business event subscription', async (_label, auth) => {
    const socket = client(auth);
    const received = [];
    socket.on('new_operation_log', payload => received.push(payload));
    const rejected = event(socket, 'connect_error');
    socket.connect();
    expect((await rejected).data.code).toBe('SOCKET_AUTH_REQUIRED');
    io.emit('new_operation_log', { customer_name: 'Synthetic restricted event' });
    await new Promise(resolve => setImmediate(resolve));
    expect(received).toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
    expect(io.of('/').sockets.size).toBe(0);
});

test('verified token uses current DB identity/role and only then receives existing company events', async () => {
    const socket = client({ token: signed(), id: 999, role: 'superadmin' });
    const connected = event(socket, 'connect'); socket.connect(); await connected;
    expect(latestSocket.data.user).toEqual(account);
    expect(pool.query).toHaveBeenCalledWith({ text: 'SELECT id, username, name, role FROM users WHERE id = $1', values: [7], query_timeout: 5000 });
    const received = event(socket, 'new_task');
    io.emit('new_task', { id: 42 });
    expect(await received).toEqual({ id: 42 });
});

test.each([null, { ...account, role: 'disabled' }])('rejects deleted or unrecognized-role account %j', async user => {
    activeUser = user;
    const socket = client({ token: signed() });
    const rejected = event(socket, 'connect_error'); socket.connect();
    expect((await rejected).data.code).toBe('SOCKET_AUTH_REQUIRED');
    expect(io.of('/').sockets.size).toBe(0);
});

test('database failure denies the handshake without exposing query details', async () => {
    pool.query.mockRejectedValue(new Error('sensitive-query-details'));
    const socket = client({ token: signed() });
    const rejected = event(socket, 'connect_error'); socket.connect();
    const error = await rejected;
    expect(error.data.code).toBe('SOCKET_AUTH_UNAVAILABLE');
    expect(error.message).not.toContain('sensitive-query');
    expect(io.of('/').sockets.size).toBe(0);
});

test.each(['deleted', 'role changed', 'database failure'])('%s ends an already connected session on its next account check', async change => {
    const socket = client({ token: signed() });
    const connected = event(socket, 'connect'); socket.connect(); await connected;
    const expiry = event(socket, 'session_expired');
    const disconnected = event(socket, 'disconnect');
    if (change === 'deleted') activeUser = null;
    else if (change === 'role changed') activeUser.role = 'admin';
    else pool.query.mockRejectedValue(new Error('DB unavailable'));
    expect((await expiry).code).toBe(change === 'database failure' ? 'SOCKET_AUTH_UNAVAILABLE' : 'SOCKET_AUTH_REQUIRED');
    await disconnected;
    expect(io.of('/').sockets.size).toBe(0);
});

test('token expiry disconnects a previously authenticated client without another client action', async () => {
    const socket = client({ token: signed({}, { expiresIn: 2 }) });
    const connected = event(socket, 'connect'); socket.connect(); await connected;
    const expiry = event(socket, 'session_expired');
    const disconnected = event(socket, 'disconnect');
    expect((await expiry).code).toBe('SOCKET_AUTH_REQUIRED');
    await disconnected;
    expect(socket.connected).toBe(false);
}, 5000);

test('missing server secret fails closed', async () => {
    const next = jest.fn();
    await createSocketAuthenticator({ pool, secret: '' })({ handshake: { auth: { token: signed() } }, data: {} }, next);
    expect(next.mock.calls[0][0].data.code).toBe('SOCKET_AUTH_REQUIRED');
    expect(pool.query).not.toHaveBeenCalled();
});
