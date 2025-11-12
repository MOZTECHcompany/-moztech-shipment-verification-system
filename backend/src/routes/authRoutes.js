// backend/src/routes/authRoutes.js
// 認證相關路由

const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const logger = require('../utils/logger');

/**
 * POST /api/auth/login
 * 用戶登入
 */
router.post('/login', async (req, res, next) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: '請提供用戶名和密碼' });
        }

        const result = await authService.login(username, password);
        
        res.json(result);
    } catch (error) {
        if (error.message.includes('用戶名或密碼錯誤')) {
            return res.status(401).json({ message: error.message });
        }
        next(error);
    }
});

/**
 * POST /api/auth/refresh
 * 刷新 Token
 */
router.post('/refresh', async (req, res, next) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ message: '請提供 Token' });
        }

        const newToken = await authService.refreshToken(token);
        
        res.json({ token: newToken });
    } catch (error) {
        res.status(401).json({ message: error.message });
    }
});

module.exports = router;
