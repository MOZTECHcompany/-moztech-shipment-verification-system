// backend/src/services/authService.js
// 認證服務 - 處理登入、用戶驗證等邏輯

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const logger = require('../utils/logger');

class AuthService {
    /**
     * 用戶登入
     * @param {string} username - 用戶名 (ERP: Email)
     * @param {string} password - 密碼
     * @returns {Object} - { token, user }
     */
    async login(username, password) {
        try {
            logger.debug(`登入嘗試: ${username}`);

            // ERP uses email. We assume username input is email.
            // Join roles to get role name.
            const result = await pool.query(`
                SELECT u.id, u.email as username, u.password_hash as password, u.name, r.name as role 
                FROM users u
                LEFT JOIN user_roles ur ON u.id = ur.user_id
                LEFT JOIN roles r ON ur.role_id = r.id
                WHERE LOWER(u.email) = LOWER($1)
            `, [username]);

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
                { expiresIn: '12h' } // 延長 Token 效期
            );

            logger.info(`登入成功: ${username} (${cleanedRole})`);

            return {
                token: accessToken,
                user: {
                    id: user.id,
                    username: user.username,
                    name: user.name,
                    role: cleanedRole
                }
            };
        } catch (error) {
            logger.error('登入過程發生錯誤:', error);
            throw error;
        }
    }

    /**
     * 刷新 Token (保持不變，只要 payload 結構一致)
     */
    async refreshToken(token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const result = await pool.query(
                'SELECT id, email as username, name FROM users WHERE id = $1',
                [decoded.id]
            );

            if (result.rows.length === 0) {
                throw new Error('用戶不存在');
            }

            const user = result.rows[0];
            // We need role again
             const roleResult = await pool.query(`
                SELECT r.name as role 
                FROM user_roles ur
                JOIN roles r ON ur.role_id = r.id
                WHERE ur.user_id = $1
            `, [user.id]);
            
            const role = roleResult.rows[0]?.role;
            const cleanedRole = role ? String(role).trim().toLowerCase() : null;

            const newToken = jwt.sign(
                {
                    id: user.id,
                    username: user.username,
                    name: user.name,
                    role: cleanedRole
                },
                process.env.JWT_SECRET,
                { expiresIn: '12h' }
            );

            return newToken;
        } catch (error) {
            logger.error('刷新 Token 失敗:', error);
            throw new Error('無效的 Token');
        }
    }
}

module.exports = new AuthService();
