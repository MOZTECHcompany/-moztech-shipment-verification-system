const express = require('express');
const { createCartonItemService } = require('../services/cartonItemService');

function createCartonItemRouter({ pool }) {
    const router = express.Router(), service = createCartonItemService({ pool });
    router.get('/', async (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        if (!req.user?.id) return res.status(401).json({ code: 'AUTH_REQUIRED', message: '需要認證' });
        try { res.json(await service.search(req.query, req.user)); }
        catch (error) {
            const status = Number.isInteger(error.status) ? error.status : 500;
            res.status(status).json({ code: error.code || 'CARTON_ITEM_SEARCH_FAILED',
                message: status === 500 ? '暫時無法查詢品項，請稍後再試或手動填寫' : error.message });
        }
    });
    return router;
}

module.exports = { createCartonItemRouter };
