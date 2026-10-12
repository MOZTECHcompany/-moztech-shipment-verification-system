const express = require('express');
const { createCartonService } = require('../services/cartonService');

function handler(action, status = 200) {
    return async (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        if (!req.user?.id) return res.status(401).json({ code: 'AUTH_REQUIRED', message: '需要認證' });
        try { res.status(status).json(await action(req)); }
        catch (error) {
            const statusCode = Number.isInteger(error.status) ? error.status : 500;
            res.status(statusCode).json({ code: error.code || 'CARTON_OPERATION_FAILED',
                message: statusCode === 500 ? '箱號作業失敗，請重新載入核對' : error.message,
                ...(error.scanNotApplied === undefined ? {} : { scanNotApplied: error.scanNotApplied }) });
        }
    };
}
function createCartonRouter({ pool }) {
    const router = express.Router(), service = createCartonService({ pool });
    router.get('/', handler(req => service.list(req.query, req.user)));
    router.post('/', handler(req => service.create(req.body, req.user), 201));
    router.post('/import', handler(req => service.importManifest(req.body, req.user)));
    router.get('/lookup', handler(req => service.lookup(req.query.scanValue, req.user)));
    router.post('/allocations/:allocationId/release', handler(req => service.release(req.params.allocationId, req.body, req.user, req.app.get('io'))));
    router.get('/:cartonId', handler(req => service.get(req.params.cartonId, req.user)));
    router.patch('/:cartonId', handler(req => service.edit(req.params.cartonId, req.body, req.user)));
    router.post('/:cartonId/seal', handler(req => service.seal(req.params.cartonId, req.body, req.user)));
    return router;
}
function createOrderCartonRouter({ pool }) {
    const router = express.Router(), service = createCartonService({ pool });
    router.post('/:orderId/carton-preview', handler(req => service.preview(Number(req.params.orderId), req.body, req.user)));
    router.post('/:orderId/carton-scan', handler(req => service.scan(Number(req.params.orderId), req.body, req.user, req.app.get('io'))));
    router.get('/:orderId/carton-shipments', handler(req => service.shipments(Number(req.params.orderId), req.user)));
    return router;
}
module.exports = { createCartonRouter, createOrderCartonRouter };
