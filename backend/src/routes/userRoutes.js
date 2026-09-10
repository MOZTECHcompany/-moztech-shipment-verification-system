// backend/src/routes/userRoutes.js
// 用戶管理路由（需要管理員權限）

const express = require('express');
const router = express.Router();
const userService = require('../services/userService');
const { authorizeAdmin } = require('../middleware/auth');
const { pool } = require('../config/database');

// 所有用戶路由都需要管理員權限
router.use(authorizeAdmin);

/**
 * POST /api/users
 * 創建新用戶
 */
router.post('/', async (req, res, next) => {
    try {
        const { username, password, name, role } = req.body;

        if (!username || !password || !name || !role) {
            return res.status(400).json({ message: '請提供完整的用戶資訊' });
        }

        const normalizedRole = role ? String(role).trim().toLowerCase() : null;
        const actorRole = req.user?.role;

        // 只有最高管理員可以新增/指定管理員（admin/superadmin）
        if ((normalizedRole === 'admin' || normalizedRole === 'superadmin') && actorRole !== 'superadmin') {
            return res.status(403).json({ message: '只有最高管理員可以新增管理員' });
        }

        const user = await userService.createUser({ username, password, name, role: normalizedRole });
        
        res.status(201).json({ 
            message: '用戶創建成功',
            user 
        });
    } catch (error) {
        if (error.message === '用戶名已存在') {
            return res.status(409).json({ message: error.message });
        }
        next(error);
    }
});

/**
 * GET /api/users
 * 獲取所有用戶
 */
router.get('/', async (req, res, next) => {
    try {
        const users = await userService.getAllUsers();
        res.json(users);
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/users/:userId
 * 獲取特定用戶
 */
router.get('/:userId', async (req, res, next) => {
    try {
        const user = await userService.getUserById(req.params.userId);
        res.json(user);
    } catch (error) {
        if (error.message === '用戶不存在') {
            return res.status(404).json({ message: error.message });
        }
        next(error);
    }
});

/**
 * PUT /api/users/:userId
 * 更新用戶
 */
router.put('/:userId', async (req, res, next) => {
    try {
        const { name, role, password } = req.body;
        const actorRole = req.user?.role;
        const targetUserId = req.params.userId;

        // 查詢目標用戶角色，用於保護 superadmin 帳號
        const targetResult = await pool.query('SELECT id, role FROM users WHERE id = $1', [targetUserId]);
        if (targetResult.rows.length === 0) {
            return res.status(404).json({ message: '用戶不存在' });
        }

        const targetRole = targetResult.rows[0].role ? String(targetResult.rows[0].role).trim().toLowerCase() : null;

        // 管理員不得編輯最高管理員
        if (targetRole === 'superadmin' && actorRole !== 'superadmin') {
            return res.status(403).json({ message: '無法編輯最高管理員帳號' });
        }

        const normalizedRole = role !== undefined ? String(role).trim().toLowerCase() : undefined;

        // 只有最高管理員可以把別人升/降為 admin/superadmin
        if ((normalizedRole === 'admin' || normalizedRole === 'superadmin') && actorRole !== 'superadmin') {
            return res.status(403).json({ message: '只有最高管理員可以設定管理員角色' });
        }

        const user = await userService.updateUser(targetUserId, { name, role: normalizedRole, password });
        
        res.json({ 
            message: '用戶更新成功',
            user 
        });
    } catch (error) {
        if (error.message === '用戶不存在') {
            return res.status(404).json({ message: error.message });
        }
        next(error);
    }
});

/**
 * DELETE /api/users/:userId
 * 刪除用戶
 */
router.delete('/:userId', async (req, res, next) => {
    try {
        const actorRole = req.user?.role;
        const targetUserId = req.params.userId;

        const targetResult = await pool.query('SELECT id, role FROM users WHERE id = $1', [targetUserId]);
        if (targetResult.rows.length === 0) {
            return res.status(404).json({ message: '用戶不存在' });
        }

        const targetRole = targetResult.rows[0].role ? String(targetResult.rows[0].role).trim().toLowerCase() : null;
        if (targetRole === 'superadmin' && actorRole !== 'superadmin') {
            return res.status(403).json({ message: '無法刪除最高管理員帳號' });
        }

        await userService.deleteUser(targetUserId);
        res.json({ message: '用戶已刪除' });
    } catch (error) {
        if (error.message === '用戶不存在') {
            return res.status(404).json({ message: error.message });
        }
        next(error);
    }
});

module.exports = router;
