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

for(const action of ['staff','bind']) router.post('/erp/'+action, loginLimiter, async(req,res)=>{
    try {
        const erp=require('../services/erpSession');erp.authenticateService(req.headers['x-erp-service-key']);
        const pool=require('../config/database').pool;
        res.set('Cache-Control','no-store').json(await erp[action](pool,req.body));
    } catch(error) {res.status(error.status || 503).json({message:error.status ? error.message:'無法連結儲運帳號'});}
});
// The browser handoff uses postMessage with exact origin/source checks, never URL tokens.
router.get('/erp/config', (_req,res) => {
    try { res.set('Cache-Control','no-store').json({ origin: require('../services/erpSession').config().origin }); }
    catch { res.status(503).json({ message: '儲運統一登入尚未啟用' }); }
});
router.post('/erp/exchange', loginLimiter, async (req,res) => {
    try {
        const result = await require('../services/erpSession').exchange(require('../config/database').pool, req.body.ticket, req.body.nonce);
        res.set('Cache-Control','no-store').json(result);
    } catch(error) { res.status(error.status || 503).json({message: error.status ? error.message : '無法開啟工作台，請重試'}); }
});
router.post('/erp/logout', require('../middleware/auth').authenticateToken, async (req,res) => {
    try {
        if (req.erpSession) await require('../services/erpSession').callErp('revoke', {session:req.erpSession});
        res.json({ok:true});
    } catch(error) { res.status(error.status || 503).json({message:'無法完成登出，請重試'}); }
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
        if (error.status === 401) {
            return res.status(401).json({ message: error.message });
        }
        next(error);
    }
});

module.exports = router;
