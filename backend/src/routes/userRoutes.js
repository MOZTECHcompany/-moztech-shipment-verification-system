// backend/src/routes/userRoutes.js
// 用戶管理路由（需要管理員權限）

const express = require('express');
const router = express.Router();
const userService = require('../services/userService');
const { authorizeAdmin } = require('../middleware/auth');

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

        const user = await userService.createUser({ username, password, name, role });
        
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
        const user = await userService.updateUser(req.params.userId, { name, role, password });
        
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
        await userService.deleteUser(req.params.userId);
        res.json({ message: '用戶已刪除' });
    } catch (error) {
        if (error.message === '用戶不存在') {
            return res.status(404).json({ message: error.message });
        }
        next(error);
    }
});

module.exports = router;
