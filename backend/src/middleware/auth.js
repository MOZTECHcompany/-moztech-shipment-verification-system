// backend/src/middleware/auth.js
// 認證和授權中間件

const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const verifiedStaff = Symbol('verifiedStaff');

/**
 * JWT 認證中間件
 */
async function authenticateToken(req, res, next) {
    if (req[verifiedStaff]) return next();
    const header = req.headers.authorization;
    const token = typeof header === 'string' && /^Bearer /i.test(header) ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: '需要認證' });
    let claims;
    try {
        claims = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        const id = Number(claims.id ?? claims.userId);
        if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(claims.exp)) throw new Error('Invalid identity');
        claims = { id, exp: claims.exp };
    } catch {
        return res.status(403).json({ message: 'Token 無效或已過期' });
    }
    try {
        // A token proves identity, not today's role. Check before taking a
        // transaction connection; deleted/demoted accounts lose HTTP access too.
        const { pool } = require('../config/database');
        const { rows } = await pool.query({
            text: 'SELECT id, username, name, role FROM users WHERE id = $1',
            values: [claims.id], query_timeout: 5000,
        });
        const user = rows[0];
        const role = String(user?.role || '').trim().toLowerCase();
        if (!user || !['picker', 'packer', 'dispatcher', 'admin', 'superadmin'].includes(role) || claims.exp * 1000 <= Date.now()) {
            return res.status(403).json({ message: '帳號或登入已失效，請重新登入' });
        }
        req.user = { id: user.id, username: user.username, name: user.name, role };
        req[verifiedStaff] = true;
        return next();
    } catch {
        return res.status(503).json({ code: 'AUTH_UNAVAILABLE', message: '暫時無法確認帳號權限，請稍後再試' });
    }
}

/**
 * 管理員授權中間件
 */
function authorizeAdmin(req, res, next) {
    if (!req.user) {
        logger.warn('authorizeAdmin: 未找到用戶資訊');
        return res.status(401).json({ message: '需要認證' });
    }

    if (!(req.user.role === 'admin' || req.user.role === 'superadmin')) {
        logger.warn(`授權失敗: ${req.user.username} (${req.user.role}) 嘗試存取管理員功能`);
        return res.status(403).json({ message: '需要管理員權限' });
    }

    logger.debug(`管理員授權成功: ${req.user.username}`);
    next();
}

/**
 * 角色授權中間件工廠函數
 * @param {Array<string>} roles - 允許的角色列表
 */
function authorizeRoles(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ message: '需要認證' });
        }

        // 最高管理員：允許存取所有 role-based 端點（但 superadmin-only 的限制會在各路由內另行檢查）
        if (req.user.role === 'superadmin') {
            return next();
        }

        if (!roles.includes(req.user.role)) {
            logger.warn(`授權失敗: ${req.user.username} (${req.user.role}) 需要角色: ${roles.join(', ')}`);
            return res.status(403).json({ message: '權限不足' });
        }

        next();
    };
}

/**
 * 最高管理員授權中間件
 */
function authorizeSuperAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ message: '需要認證' });
    }

    if (req.user.role !== 'superadmin') {
        logger.warn(`授權失敗: ${req.user.username} (${req.user.role}) 需要最高管理員權限`);
        return res.status(403).json({ message: '需要最高管理員權限' });
    }

    next();
}

module.exports = {
    authenticateToken,
    authorizeAdmin,
    authorizeRoles,
    authorizeSuperAdmin
};
