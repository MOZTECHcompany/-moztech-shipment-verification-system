// backend/src/routes/authRoutes.js
// 認證相關路由

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authService = require('../services/authService');
const logger = require('../utils/logger');

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
        const rawUsername = req.body && req.body.username ? String(req.body.username) : '';
        return `${req.ip}:${rawUsername.trim().toLowerCase()}`;
    },
    handler: (req, res) => {
        return res.status(429).json({ message: '嘗試次數過多，請稍後再試' });
    }
});

const refreshLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
        return res.status(429).json({ message: '嘗試次數過多，請稍後再試' });
    }
});

/**
 * POST /api/auth/login
 * 用戶登入
 */
router.post('/login', loginLimiter, async (req, res, next) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ message: '請提供用戶名和密碼' });
        }

        const result = await authService.login(username, password);

        res.json(result);
    } catch (error) {
        if (error.message.includes('用戶名或密碼錯誤')) {
            return res.status(400).json({ message: error.message });
        }
        next(error);
    }
});

/**
 * POST /api/auth/refresh
 * 刷新 Token
 */
router.post('/refresh', refreshLimiter, async (req, res, next) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ message: '請提供 Token' });
        }

        const newToken = await authService.refreshToken(token);

        res.json({ accessToken: newToken });
    } catch (error) {
        res.status(401).json({ message: error.message });
    }
});

module.exports = router;
