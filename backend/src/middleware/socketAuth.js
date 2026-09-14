const jwt = require('jsonwebtoken');

const STAFF_ROLES = new Set(['picker', 'packer', 'dispatcher', 'admin', 'superadmin']);

function authError(code = 'SOCKET_AUTH_REQUIRED') {
    const error = new Error(code === 'SOCKET_AUTH_REQUIRED' ? '登入已失效，請重新登入' : '即時連線驗證暫時無法完成');
    error.data = { code };
    return error;
}

async function currentStaffUser(pool, id) {
    const result = await pool.query({
        text: 'SELECT id, username, name, role FROM users WHERE id = $1',
        values: [id], query_timeout: 5000,
    });
    const row = result.rows[0];
    const role = String(row?.role || '').trim().toLowerCase();
    // There is no is_active column in the current schema. A current account and
    // a recognized staff role are required; never authorize from JWT role claims.
    if (!row || !STAFF_ROLES.has(role)) throw authError();
    return { id: row.id, username: row.username, name: row.name, role };
}

function createSocketAuthenticator({ pool, secret }) {
    return async (socket, next) => {
        let claims;
        try {
            const token = socket.handshake.auth?.token;
            if (!secret || typeof token !== 'string' || !token || token.length > 8192) throw authError();
            claims = jwt.verify(token, secret, { algorithms: ['HS256'] });
            const id = Number(claims.id ?? claims.userId);
            if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(claims.exp) || claims.exp * 1000 <= Date.now()) throw authError();
            claims = { id, expiresAt: claims.exp * 1000 };
        } catch { return next(authError()); }
        try {
            const user = await currentStaffUser(pool, claims.id);
            if (claims.expiresAt <= Date.now()) return next(authError());
            socket.data.user = user;
            socket.data.authExpiresAt = claims.expiresAt;
            return next();
        } catch (error) {
            return next(authError(error.data?.code || 'SOCKET_AUTH_UNAVAILABLE'));
        }
    };
}

function guardSocketSession(socket, { pool, recheckMs = 60000 }) {
    let expiryTimer, accountTimer;
    const closeSession = (code = 'SOCKET_AUTH_REQUIRED') => {
        if (!socket.connected) return;
        socket.emit('session_expired', { code });
        socket.disconnect(true);
    };
    const remaining = socket.data.authExpiresAt - Date.now();
    if (!socket.data.user || !Number.isFinite(remaining) || remaining <= 0) { closeSession(); return; }
    expiryTimer = setTimeout(closeSession, Math.min(remaining, 2147483647));
    expiryTimer.unref?.();
    const recheck = async () => {
        try {
            const user = await currentStaffUser(pool, socket.data.user.id);
            if (user.role !== socket.data.user.role) { closeSession(); return; }
            socket.data.user = user;
        } catch (error) { closeSession(error.data?.code || 'SOCKET_AUTH_UNAVAILABLE'); return; }
        if (socket.connected) { accountTimer = setTimeout(recheck, recheckMs); accountTimer.unref?.(); }
    };
    accountTimer = setTimeout(recheck, recheckMs);
    accountTimer.unref?.();
    socket.once('disconnect', () => { clearTimeout(expiryTimer); clearTimeout(accountTimer); });
}

module.exports = { createSocketAuthenticator, guardSocketSession };
