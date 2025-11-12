// backend/src/services/userService.js
// 用戶管理服務

const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const logger = require('../utils/logger');

class UserService {
    /**
     * 創建新用戶
     */
    async createUser({ username, password, name, role }) {
        try {
            // 檢查用戶名是否已存在
            const existing = await pool.query(
                'SELECT id FROM users WHERE username = $1',
                [username]
            );

            if (existing.rows.length > 0) {
                throw new Error('用戶名已存在');
            }

            // 加密密碼
            const hashedPassword = await bcrypt.hash(password, 10);

            // 插入新用戶
            const result = await pool.query(
                'INSERT INTO users (username, password, name, role) VALUES ($1, $2, $3, $4) RETURNING id, username, name, role, created_at',
                [username, hashedPassword, name, role]
            );

            logger.info(`新用戶已創建: ${username} (${role})`);
            return result.rows[0];
        } catch (error) {
            logger.error('創建用戶失敗:', error);
            throw error;
        }
    }

    /**
     * 獲取所有用戶
     */
    async getAllUsers() {
        try {
            const result = await pool.query(
                'SELECT id, username, name, role, created_at FROM users ORDER BY created_at DESC'
            );
            return result.rows;
        } catch (error) {
            logger.error('獲取用戶列表失敗:', error);
            throw error;
        }
    }

    /**
     * 根據 ID 獲取用戶
     */
    async getUserById(userId) {
        try {
            const result = await pool.query(
                'SELECT id, username, name, role, created_at FROM users WHERE id = $1',
                [userId]
            );

            if (result.rows.length === 0) {
                throw new Error('用戶不存在');
            }

            return result.rows[0];
        } catch (error) {
            logger.error(`獲取用戶失敗 (ID: ${userId}):`, error);
            throw error;
        }
    }

    /**
     * 更新用戶
     */
    async updateUser(userId, { name, role, password }) {
        try {
            const fields = [];
            const values = [];
            let paramIndex = 1;

            if (name !== undefined) {
                fields.push(`name = $${paramIndex++}`);
                values.push(name);
            }

            if (role !== undefined) {
                fields.push(`role = $${paramIndex++}`);
                values.push(role);
            }

            if (password) {
                const hashedPassword = await bcrypt.hash(password, 10);
                fields.push(`password = $${paramIndex++}`);
                values.push(hashedPassword);
            }

            if (fields.length === 0) {
                throw new Error('沒有提供要更新的欄位');
            }

            values.push(userId);
            const query = `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING id, username, name, role`;

            const result = await pool.query(query, values);

            if (result.rows.length === 0) {
                throw new Error('用戶不存在');
            }

            logger.info(`用戶已更新: ID ${userId}`);
            return result.rows[0];
        } catch (error) {
            logger.error(`更新用戶失敗 (ID: ${userId}):`, error);
            throw error;
        }
    }

    /**
     * 刪除用戶
     */
    async deleteUser(userId) {
        try {
            const result = await pool.query(
                'DELETE FROM users WHERE id = $1 RETURNING username',
                [userId]
            );

            if (result.rows.length === 0) {
                throw new Error('用戶不存在');
            }

            logger.info(`用戶已刪除: ${result.rows[0].username} (ID: ${userId})`);
            return result.rows[0];
        } catch (error) {
            logger.error(`刪除用戶失敗 (ID: ${userId}):`, error);
            throw error;
        }
    }
}

module.exports = new UserService();
