// backend/src/services/authService.js
// 認證服務 - 處理登入、用戶驗證等邏輯

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const logger = require('../utils/logger');

class AuthService {
    /**
     * 用戶登入
     * @param {string} username - 用戶名
     * @param {string} password - 密碼
     * @returns {Object} - { token, user }
     */
    async login(username, password) {
        try {
            logger.debug(`登入嘗試: ${username}`);

            // 查詢用戶（忽略大小寫）
            const result = await pool.query(
                'SELECT id, username, password, name, role FROM users WHERE LOWER(username) = LOWER($1)',
                [username]
            );

            if (result.rows.length === 0) {
                logger.warn(`登入失敗: 用戶不存在 - ${username}`);
                throw new Error('用戶名或密碼錯誤');
            }

            const user = result.rows[0];

            // 驗證密碼
            const isValidPassword = await bcrypt.compare(password, user.password);
            if (!isValidPassword) {
                logger.warn(`登入失敗: 密碼錯誤 - ${username}`);
                throw new Error('用戶名或密碼錯誤');
            }

            const cleanedRole = user.role ? String(user.role).trim().toLowerCase() : null;

            // 生成 JWT（與 v6 index.js 相容）
            const accessToken = jwt.sign(
                {
                    id: user.id,
                    username: user.username,
                    name: user.name,
                    role: cleanedRole
                },
                process.env.JWT_SECRET,
                { expiresIn: '8h' }
            );

            logger.info(`用戶登入成功: ${username} (${cleanedRole || 'unknown'})`);

            return {
                accessToken,
                user: {
                    id: user.id,
                    username: user.username,
                    name: user.name,
                    role: cleanedRole
                }
            };
        } catch (error) {
            logger.error('登入服務錯誤:', error);
            throw error;
        }
    }

    /**
     * 驗證 Token
     * @param {string} token - JWT token
     * @returns {Object} - 解碼後的用戶資訊
     */
    async verifyToken(token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            return decoded;
        } catch (error) {
            logger.warn('Token 驗證失敗:', error.message);
            throw new Error('Token 無效或已過期');
        }
    }

    /**
     * 刷新 Token
     * @param {string} oldToken - 舊的 JWT token
     * @returns {string} - 新的 token
     */
    async refreshToken(oldToken) {
        try {
            const decoded = await this.verifyToken(oldToken);

            const userId = decoded.id ?? decoded.userId;
            if (!userId) {
                throw new Error('Token 無效或已過期');
            }

            let username = decoded.username;
            let name = decoded.name;
            let role = decoded.role ? String(decoded.role).trim().toLowerCase() : null;

            if (!username || !name || !role) {
                const userResult = await pool.query(
                    'SELECT username, name, role FROM users WHERE id = $1',
                    [userId]
                );

                if (userResult.rowCount === 0) {
                    throw new Error('找不到用戶');
                }

                const dbUser = userResult.rows[0];
                username = username || dbUser.username;
                name = name || dbUser.name;
                role = role || (dbUser.role ? String(dbUser.role).trim().toLowerCase() : null);
            }

            const payload = { id: userId, username, name, role };

            const newToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });

            logger.info(`Token 已刷新: ${username}`);
            return newToken;
        } catch (error) {
            logger.error('刷新 Token 失敗:', error);
            throw error;
        }
    }
}

module.exports = new AuthService();
