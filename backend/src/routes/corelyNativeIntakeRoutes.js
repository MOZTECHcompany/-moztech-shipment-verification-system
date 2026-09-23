'use strict';
const express = require('express');
const jwt = require('jsonwebtoken');
const { createPublicKey } = require('node:crypto');
const { rateLimit } = require('express-rate-limit');
const service = require('../services/corelyNativeIntake');
function createCorelyDispatchRouter({ pool, env = process.env }) {
    const router = express.Router();
    const enabled = env.ERP_WORKSPACE_COMMANDS_ENABLED === 'true';
    let key;
    if (enabled) {
        key = createPublicKey(env.ERP_WORKSPACE_PUBLIC_KEY || '');
        if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails?.modulusLength < 2048 || !env.ERP_WORKSPACE_ISSUER || !env.ERP_WORKSPACE_AUDIENCE) throw Error('CORELY_DISPATCH_CONFIG_REQUIRED');
    }
    router.use((_req, res, next) => {
        res.set('Cache-Control', 'private, no-store');
        if (!enabled) return res.status(503).json({ code: 'WMS_COMMANDS_DISABLED' });
        next();
    });
    router.use(rateLimit({ windowMs: 60000, limit: 3000, standardHeaders: 'draft-7', legacyHeaders: false }));
    router.use(express.json({ limit: '1mb' }));
    router.use((req, res, next) => {
        try {
            const match = /^Bearer ([A-Za-z0-9_.-]{1,8192})$/.exec(req.headers.authorization || '');
            if (!match) throw Error();
            const p = jwt.verify(match[1], key, { algorithms: ['RS256'], issuer: env.ERP_WORKSPACE_ISSUER, audience: env.ERP_WORKSPACE_AUDIENCE, maxAge: '60s' });
            const now = Math.floor(Date.now() / 1000);
            if (!Number.isInteger(p.iat) || !Number.isInteger(p.exp) || p.iat > now || p.exp <= p.iat || p.exp - p.iat > 60 || p.scope !== 'wms.workspace.command' || !service.validId(p.sub) || !service.validId(p.entityId) || p.station !== 'dispatch' || p.method !== req.method || p.path !== req.path || p.bodyHash !== service.hash(req.body || {}) || Object.keys(req.query).length) throw Error();
            req.corelyScope = { actorId: p.sub, entityId: p.entityId, station: p.station };
            next();
        } catch { res.status(401).json({ code: 'WMS_SERVICE_AUTH_REQUIRED' }); }
    });
    router.use(rateLimit({ windowMs: 60000, limit: 300, keyGenerator: req => JSON.stringify(req.corelyScope), standardHeaders: 'draft-7', legacyHeaders: false }));
    router.post('/orders/:id/dispatch', async (req, res) => {
        try { res.json(await service.dispatch(pool, req.corelyScope, req.params.id, req.body)); }
        catch (error) {
            const status = [400, 403, 404, 409].includes(error.status) ? error.status : 503;
            res.status(status).json({ code: status === 503 ? 'WMS_COMMAND_RESULT_UNKNOWN' : 'CORELY_DISPATCH_REJECTED', message: status === 503 ? '拋單結果待確認，請重試原請求' : error.message });
        }
    });
    router.use((_req, res) => res.status(405).json({ code: 'WMS_COMMAND_NOT_SUPPORTED' }));
    return router;
}
function createCorelyPrepickRouter({ pool }) {
    const router = express.Router();
    const handover = require('../services/corelyHandover');
    const handle = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) { if (error.status) return res.status(error.status).json({ message: error.message }); next(error); } };
    router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
    router.get('/', handle(async (req, res) => {
        const rows = (await pool.query(`SELECT i.id,i.payload->>'orderNumber' AS order_number,i.payload->>'brand' AS brand,i.reservation_accepted,i.printed_at,i.prepick_completed_at,u.name AS prepick_owner_name
            FROM corely_native_intakes i LEFT JOIN users u ON u.id=i.prepick_owner_id
            WHERE ($1::boolean OR i.prepick_owner_id=$2) AND ($3::text IS NULL OR i.entity_id=$3) ORDER BY i.id DESC LIMIT 100`, [service.manager(req.user), req.user.id, req.user.entityId || null])).rows;
        res.json({ batches: rows });
    }));
    router.get('/:id/shipments', handle(async (req, res) => res.json(await handover.listShipments(pool, req.params.id, req.user))));
    router.post('/:id/shipments', handle(async (req, res) => res.json(await handover.handover(pool, req.params.id, req.body, req.user))));
    router.post('/:id/shipments/:shipmentId/retry', handle(async (req, res) => res.json(await handover.requestRetry(pool, req.params.id, req.params.shipmentId, req.user))));
    router.get('/staff', handle(async (req, res) => {
        if (!service.manager(req.user)) return res.status(403).json({ message: '無指派權限' });
        res.json({ staff: (await pool.query("SELECT id,name,role FROM users WHERE role IN ('picker','packer','admin','superadmin') ORDER BY name,id")).rows });
    }));
    router.get('/:id', handle(async (req, res) => res.json(await service.readIntake(pool, req.params.id, req.user))));
    router.post('/:id/:action', handle(async (req, res) => {
        const result = await service.mutatePrepick(pool, req.params.id, req.params.action, req.body || {}, req.user);
        if (req.params.action === 'complete' && !result.reused) req.app.get('io')?.emit('new_task', { id: result.orderId, status: 'pending', task_type: 'pick' });
        res.json(result);
    }));
    return router;
}
module.exports = { createCorelyDispatchRouter, createCorelyPrepickRouter };
