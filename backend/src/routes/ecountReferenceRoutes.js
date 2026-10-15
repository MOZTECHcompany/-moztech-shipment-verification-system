const express = require('express');
const { createEcountReferenceService } = require('../services/ecountReferenceService');
function createEcountReferenceRouter({ pool }) {
    const router = express.Router(), service = createEcountReferenceService({ pool });
    const handle = work => async (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        if (!req.user?.id) return res.status(401).json({ code: 'AUTH_REQUIRED', message: '需要認證' });
        if (!/^[1-9]\d{0,9}$/.test(req.params.orderId)) return res.status(400).json({ code: 'ECOUNT_REFERENCE_INVALID_INPUT', message: '訂單編號無效' });
        try { res.json(await work(req)); } catch (error) {
            const status = Number.isInteger(error.status) ? error.status : 500;
            res.status(status).json({ code: error.code || 'ECOUNT_REFERENCE_FAILED', message: status === 500 ? '銷貨對照作業失敗，請重新載入核對' : error.message });
        }
    };
    router.get('/:orderId/ecount-reference', handle(req => service.get(Number(req.params.orderId), req.user)));
    router.post('/:orderId/ecount-reference', handle(req => service.save(Number(req.params.orderId), req.body, req.user)));
    return router;
}
module.exports = { createEcountReferenceRouter };
