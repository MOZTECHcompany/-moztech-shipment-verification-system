// backend/src/services/userService.js
// 用戶管理服務

const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const logger = require('../utils/logger');

class UserService {
    /**
     * 創建新用戶 (ERP Integration: Simplified, might fail on role)
     */
    async createUser({ username, password, name, role }) {
        // ERP uses email, not username. We assume username is email.
        // ERP uses password_hash.
        // Role requires separate insert.
        throw new Error('ERP Integration: Create User not fully supported yet via legacy API');
    }

    /**
     * 獲取所有用戶
     */
    async getAllUsers() {
        try {
            // Map ERP users to legacy format
            // We assume the first role found is the primary role
            const result = await pool.query(`
                SELECT u.id, u.email as username, u.name, r.name as role, u.created_at 
                FROM users u
                LEFT JOIN user_roles ur ON u.id = ur.user_id
                LEFT JOIN roles r ON ur.role_id = r.id
                ORDER BY u.created_at DESC
            `);
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
            const result = await pool.query(`
                SELECT u.id, u.email as username, u.name, r.name as role, u.created_at 
                FROM users u
                LEFT JOIN user_roles ur ON u.id = ur.user_id
                LEFT JOIN roles r ON ur.role_id = r.id
                WHERE u.id = $1
            `, [userId]);

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
        // ERP Integration: Update not fully supported
        throw new Error('ERP Integration: Update User not fully supported yet via legacy API');
    }
    
    async deleteUser(userId) {
         // ERP Integration: Delete not fully supported
        throw new Error('ERP Integration: Delete User not fully supported yet via legacy API');
    }
}

module.exports = new UserService();
