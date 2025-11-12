// backend/src/middleware/auth.js
// 認證和授權中間件

const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

/**
 * JWT 認證中間件
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    logger.debugSensitive('驗證 Token', { 
        hasAuth: !!authHeader, 
        token: token ? '***' : null,
        path: req.path 
    });

    if (!token) {
        logger.debug(`未提供 Token - ${req.method} ${req.path}`);
        return res.status(401).json({ message: '需要認證' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            logger.warn(`Token 驗證失敗: ${err.message}`);
            return res.status(403).json({ message: 'Token 無效或已過期' });
        }
        
        logger.debug(`用戶認證成功: ${user.username} (${user.role})`);
        req.user = user;
        next();
    });
}

/**
 * 管理員授權中間件
 */
function authorizeAdmin(req, res, next) {
    if (!req.user) {
        logger.warn('authorizeAdmin: 未找到用戶資訊');
        return res.status(401).json({ message: '需要認證' });
    }

    if (req.user.role !== 'admin') {
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

        if (!roles.includes(req.user.role)) {
            logger.warn(`授權失敗: ${req.user.username} (${req.user.role}) 需要角色: ${roles.join(', ')}`);
            return res.status(403).json({ message: '權限不足' });
        }

        next();
    };
}

module.exports = {
    authenticateToken,
    authorizeAdmin,
    authorizeRoles
};
