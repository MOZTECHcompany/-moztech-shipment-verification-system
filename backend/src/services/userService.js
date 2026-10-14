// backend/src/services/userService.js
// 用戶管理服務

const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const { staffUser } = require('../utils/warehouseWork');
const { warehouseTransaction } = require('./warehouseTransaction');
const logger = require('../utils/logger');

class UserService {
    /**
     * 創建新用戶
     */
    async createUser({ username, password, name, role, management_scope = 'all', can_pick = null, can_pack = null }) {
        try {
            // 檢查用戶名是否已存在
            const existing = await pool.query(
                'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
                [username]
            );

            if (existing.rows.length > 0) {
                throw new Error('用戶名已存在');
            }

            // 加密密碼
            const hashedPassword = await bcrypt.hash(password, 10);

            // 插入新用戶
            const result = await pool.query(
                'INSERT INTO users (username, password, name, role, management_scope, can_pick, can_pack) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, username, name, role, management_scope, can_pick, can_pack, created_at',
                [username, hashedPassword, name, role, role === 'admin' ? management_scope : 'all', can_pick, can_pack]
            );

            logger.info(`新用戶已創建: ${username} (${role})`);
            return { ...result.rows[0], ...staffUser(result.rows[0]) };
        } catch (error) {
            if (error.code === '23505' && ['idx_wms_users_login_identity', 'users_username_key'].includes(error.constraint)) throw new Error('用戶名已存在');
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
                'SELECT id, username, name, role, management_scope, can_pick, can_pack, created_at FROM users ORDER BY created_at DESC'
            );
            return result.rows.map(user => ({ ...user, ...staffUser(user) }));
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
                'SELECT id, username, name, role, management_scope, can_pick, can_pack, created_at FROM users WHERE id = $1',
                [userId]
            );

            if (result.rows.length === 0) {
                throw new Error('用戶不存在');
            }

            return { ...result.rows[0], ...staffUser(result.rows[0]) };
        } catch (error) {
            logger.error(`獲取用戶失敗 (ID: ${userId}):`, error);
            throw error;
        }
    }

    /**
     * 更新用戶
     */
    async updateUser(userId, { name, role, password, management_scope, can_pick, can_pack }) {
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

            if (management_scope !== undefined) {
                fields.push(`management_scope = $${paramIndex++}`); values.push(role && role !== 'admin' ? 'all' : management_scope);
            }

            for (const [key,value] of Object.entries({can_pick,can_pack})) {
                if (value !== undefined) { fields.push(`${key} = $${paramIndex++}`); values.push(value); }
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
            const query = `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING id, username, name, role, management_scope, can_pick, can_pack`;

            const result = await pool.query(query, values);

            if (result.rows.length === 0) {
                throw new Error('用戶不存在');
            }

            logger.info(`用戶已更新: ID ${userId}`);
            return { ...result.rows[0], ...staffUser(result.rows[0]) };
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
            const result = await warehouseTransaction(pool, null, async db => {
                const target = await db.query('SELECT id,username FROM users WHERE id=$1 FOR UPDATE', [userId]);
                if (!target.rows.length) throw new Error('用戶不存在');
                const history = await db.query(`SELECT (
                    EXISTS(SELECT 1 FROM orders WHERE picker_id=$1 OR packer_id=$1)
                    OR EXISTS(SELECT 1 FROM operation_logs WHERE user_id=$1)
                    OR EXISTS(SELECT 1 FROM task_assignments WHERE from_user_id=$1 OR to_user_id=$1 OR performed_by=$1)
                    OR EXISTS(SELECT 1 FROM wms_scan_commands WHERE user_id=$1)
                    OR EXISTS(SELECT 1 FROM product_defects WHERE user_id=$1)
                    OR EXISTS(SELECT 1 FROM wms_carton_history WHERE actor_id=$1)
                    OR EXISTS(SELECT 1 FROM wms_box_spec_history WHERE actor_id=$1)
                    OR EXISTS(SELECT 1 FROM wms_box_spec_batch_commands WHERE user_id=$1)
                ) AS has_history`, [userId]);
                if (history.rows[0]?.has_history) throw Object.assign(new Error('此帳號已有作業或交接紀錄，不能刪除，以保留責任追溯。'), {status:409});
                return db.query('DELETE FROM users WHERE id = $1 RETURNING username', [userId]);
            });

            logger.info(`用戶已刪除: ${result.rows[0].username} (ID: ${userId})`);
            return result.rows[0];
        } catch (error) {
            logger.error(`刪除用戶失敗 (ID: ${userId}):`, error);
            throw error;
        }
    }
}

module.exports = new UserService();
