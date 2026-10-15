const express = require('express');
const { createBoxSpecService } = require('../services/boxSpecService');
const { createCartonService } = require('../services/cartonService');
function createBoxSpecRouter({ pool }) {
    const router = express.Router(), service = createBoxSpecService({ pool }), cartons = createCartonService({ pool });
    const handle = (work, status = 200) => async (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        if (!req.user?.id) return res.status(401).json({ code: 'AUTH_REQUIRED', message: '需要認證' });
        try { res.status(status).json(await work(req)); }
        catch (error) { const code = Number.isInteger(error.status) ? error.status : 500;
            res.status(code).json({ code: error.code || 'BOX_SPEC_OPERATION_FAILED', message: code === 500 ? '箱規作業失敗，請重新查詢' : error.message,
                ...(error.scanNotApplied === undefined ? {} : { scanNotApplied: error.scanNotApplied }) }); }
    };
    router.get('/', handle(req => service.list(req.query, req.user)));
    router.post('/', handle(req => service.create(req.body, req.user), 201));
    router.get('/next-number', handle(req => service.nextNumber(req.query, req.user)));
    router.get('/:specId/batches', handle(req => cartons.specBatches(req.params.specId, req.query, req.user)));
    router.get('/:specId/batches/:creatorId/:creationId', handle(req => cartons.specBatchCartons(req.params.specId, req.params.creatorId, req.params.creationId, req.user)));
    router.get('/:specId', handle(req => service.get(req.params.specId, req.user)));
    router.patch('/:specId', handle(req => service.edit(req.params.specId, req.body, req.user)));
    router.post('/:specId/activate', handle(req => service.activate(req.params.specId, req.body, req.user)));
    router.post('/:specId/cartons', handle(req => cartons.createFromSpec(req.params.specId, req.body, req.user), 201));
    return router;
}
module.exports = { createBoxSpecRouter };
