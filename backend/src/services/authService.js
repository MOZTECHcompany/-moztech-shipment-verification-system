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

            // 查詢用戶
            const result = await pool.query(
                'SELECT * FROM users WHERE username = $1',
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

            // 生成 JWT
            const token = jwt.sign(
                { 
                    userId: user.id, 
                    username: user.username, 
                    role: user.role 
                },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );

            logger.info(`用戶登入成功: ${username} (${user.role})`);

            // 返回用戶資訊（不包含密碼）
            const { password: _, ...userWithoutPassword } = user;

            return {
                token,
                user: userWithoutPassword
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
            
            // 生成新 token
            const newToken = jwt.sign(
                { 
                    userId: decoded.userId, 
                    username: decoded.username, 
                    role: decoded.role 
                },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );

            logger.info(`Token 已刷新: ${decoded.username}`);
            return newToken;
        } catch (error) {
            logger.error('刷新 Token 失敗:', error);
            throw error;
        }
    }
}

module.exports = new AuthService();
