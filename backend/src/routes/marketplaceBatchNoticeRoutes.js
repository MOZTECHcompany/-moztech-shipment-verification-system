const express = require('express');
const { listMarketplaceBatchNotices, markMarketplaceBatchNoticeSeen } = require('../services/marketplaceBatchNotifications');

function createMarketplaceBatchNoticeRouter({ pool }) {
    const router = express.Router();
    const handle = fn => async (req, res, next) => {
        try { res.set('Cache-Control', 'private, no-store'); await fn(req, res); }
        catch (error) {
            if (error.status) return res.status(error.status).json({ message: error.message, code: error.code });
            next(error);
        }
    };
    router.get('/', handle(async (req, res) => res.json(await listMarketplaceBatchNotices(pool, req.user))));
    router.post('/:noticeId/seen', handle(async (req, res) => res.json(await markMarketplaceBatchNoticeSeen(pool, req.user, req.params.noticeId))));
    return router;
}

module.exports = { createMarketplaceBatchNoticeRouter };
