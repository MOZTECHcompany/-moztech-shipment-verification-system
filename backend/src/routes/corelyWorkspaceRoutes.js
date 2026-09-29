'use strict';
const express = require('express');
const jwt = require('jsonwebtoken');
const { createPublicKey } = require('node:crypto');
const { rateLimit } = require('express-rate-limit');
const { hash, validId } = require('../services/corelyNativeIntake');
const workspace = require('../services/corelyWorkspace');

const tokenPattern = /^Bearer ([A-Za-z0-9_.-]{1,8192})$/;
const requestIdPattern = /^[A-Za-z0-9_-]{1,64}$/;
const stations = new Set(['overview','dispatch','pick','pack','shipping']);
function setupKey(env) {
    if (env.ERP_WORKSPACE_READ_ENABLED !== 'true' && env.ERP_WORKSPACE_COMMANDS_ENABLED !== 'true') return null;
    const key = createPublicKey(env.ERP_WORKSPACE_PUBLIC_KEY || '');
    if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength || 0) < 2048 ||
        !env.ERP_WORKSPACE_ISSUER || !env.ERP_WORKSPACE_AUDIENCE) throw Error('CORELY_WORKSPACE_CONFIG_REQUIRED');
    return key;
}
function authenticated(env, key, mode, pathStation) {
    return (req, res, next) => {
        res.set('Cache-Control', 'private, no-store');
        if (env[mode === 'read' ? 'ERP_WORKSPACE_READ_ENABLED' : 'ERP_WORKSPACE_COMMANDS_ENABLED'] !== 'true')
            return res.status(503).json({ code: mode === 'read' ? 'WMS_READ_DISABLED' : 'WMS_COMMANDS_DISABLED' });
        try {
            const match = tokenPattern.exec(req.headers.authorization || '');
            if (!match) throw Error();
            const claims = jwt.verify(match[1], key, { algorithms:['RS256'], issuer:env.ERP_WORKSPACE_ISSUER,
                audience:env.ERP_WORKSPACE_AUDIENCE, maxAge:'60s' });
            const now = Math.floor(Date.now() / 1000);
            if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.iat > now ||
                claims.exp <= claims.iat || claims.exp - claims.iat > 60 ||
                claims.scope !== (mode === 'read' ? 'wms.workspace.read' : 'wms.workspace.command') ||
                !validId(claims.sub) || !validId(claims.entityId) || !stations.has(claims.station) ||
                (pathStation && claims.station !== pathStation)) throw Error();
            if (mode === 'command') {
                if (req.method === 'POST') {
                    if (claims.method !== 'POST' || claims.path !== req.path || claims.bodyHash !== hash(req.body || {}) || Object.keys(req.query).length) throw Error();
                } else if (req.method !== 'GET' || claims.method !== 'GET' || claims.path !== req.path ||
                    claims.bodyHash !== hash({}) || Object.keys(req.query).length) throw Error();
            }
            req.corelyScope = { actorId:claims.sub, entityId:claims.entityId, station:claims.station };
            next();
        } catch { res.status(401).json({ code:'WMS_SERVICE_AUTH_REQUIRED' }); }
    };
}
function respond(res, error) {
    const status = [400,403,404,409].includes(error.status) ? error.status : 503;
    res.status(status).json({ code: status === 503 ? (res.req.method === 'GET' ? 'WMS_SOURCE_UNAVAILABLE' : 'WMS_COMMAND_RESULT_UNKNOWN') : error.code || 'WMS_WORKSPACE_REJECTED' });
}
async function runNative(handler, req, user, body, guard) {
    let status = 200, reply, sent = false, failure;
    const result = { status(value) { status = value; return this; }, json(value) { reply = value; sent = true; return this; } };
    await handler({ app:req.app, requestId:req.requestId, user, body, workspaceGuard:guard }, result, error => { failure = error; });
    if (failure) throw failure;
    if (!sent) throw workspace.fail(503, 'WMS_NATIVE_RESULT_UNKNOWN');
    return { status, reply };
}
function parseBody(body, scope, kind) {
    const allowed = kind === 'scan' ? ['entityId','expectedRevision','requestId','scanValue','itemId'] : ['entityId','expectedRevision','requestId'];
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key)) ||
        body.entityId !== scope.entityId || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1 ||
        typeof body.requestId !== 'string' || !requestIdPattern.test(body.requestId) ||
        (kind === 'scan' && (typeof body.scanValue !== 'string' || !body.scanValue.trim() || body.scanValue.length > 256 ||
        /[\u0000-\u001f\u007f]/.test(body.scanValue) || (body.itemId !== undefined && !validId(body.itemId)))))
        throw workspace.fail(400, 'WMS_INPUT_INVALID');
    return body;
}
function createCorelyWorkspaceReadRouter({ pool, env = process.env }) {
    const router = express.Router(), key = setupKey(env);
    const read = authenticated(env, key, 'read');
    router.use(rateLimit({windowMs:60000,limit:3000,standardHeaders:'draft-7',legacyHeaders:false}));
    router.get('/orders', read, async (req,res) => {
        try { res.json(await workspace.list(pool, req.corelyScope, req.query)); }
        catch(error) { respond(res,error); }
    });
    router.get('/orders/:id', read, async (req,res) => {
        try { res.json(await workspace.detail(pool, req.corelyScope, req.params.id, false)); }
        catch(error) { respond(res,error); }
    });
    return router;
}
function createCorelyWorkspaceCommandRouter({ pool, env = process.env, scanHandler, claimHandler }) {
    const router = express.Router(), key = setupKey(env);
    // Injected handlers keep the signed adapter independently testable; the
    // production handlers are loaded only when this command router is mounted.
    scanHandler ||= require('./orderRoutes').scanOrder;
    claimHandler ||= require('../services/orderClaimService').createBarcodeClaimHandlers(pool).claim;
    const command = authenticated(env, key, 'command');
    router.use(rateLimit({windowMs:60000,limit:3000,standardHeaders:'draft-7',legacyHeaders:false}));
    router.get('/orders/:id', command, async (req,res) => {
        try { res.json(await workspace.detail(pool, req.corelyScope, req.params.id, true)); }
        catch(error) { respond(res,error); }
    });
    for (const station of ['pick','pack']) for (const kind of ['claim','scan']) {
        router.post(`/orders/:id/${station}/${kind}`, authenticated(env,key,'command',station), async(req,res) => {
            try {
                const body = parseBody(req.body, req.corelyScope, kind);
                const scope = req.corelyScope;
                const user = await workspace.actor(pool,scope);
                const source = await workspace.intake(pool,scope,req.params.id);
                const commandId = workspace.idempotencyKey(scope,body.requestId);
                // The native command tables are the durable dedupe receipts. A
                // request identifier cannot cross from claim into scan or back.
                const other = kind === 'claim' ? 'wms_scan_commands' : 'wms_claim_commands';
                if ((await pool.query(`SELECT 1 FROM ${other} WHERE user_id=$1 AND command_id=$2`,[user.id,commandId])).rows.length)
                    throw workspace.fail(409,'WMS_REQUEST_ID_REUSED');
                const receiptTable = kind === 'claim' ? 'wms_claim_commands' : 'wms_scan_commands';
                let stored = (await pool.query(`SELECT order_id,response FROM ${receiptTable}
                    WHERE user_id=$1 AND command_id=$2`,[user.id,commandId])).rows[0];
                if (stored && stored.order_id && stored.order_id !== source.order_id) throw workspace.fail(409,'WMS_REQUEST_ID_REUSED');
                if (!stored) {
                    const current = await workspace.snapshot(pool,scope,source,user,true);
                    if (current.revision !== body.expectedRevision) {
                        // A concurrent copy may have committed between our first
                        // receipt read and snapshot. Let the native handler check
                        // the durable request hash before returning that receipt.
                        stored = (await pool.query(`SELECT order_id,response FROM ${receiptTable}
                            WHERE user_id=$1 AND command_id=$2`,[user.id,commandId])).rows[0];
                        if (!stored || (stored.order_id && stored.order_id !== source.order_id))
                            throw workspace.fail(409,'WMS_REVISION_CHANGED');
                    }
                }
                const selectedItem = kind === 'scan' && body.itemId !== undefined ?
                    await workspace.nativeItemId(pool,source.order_id,body.itemId) : null;
                const guard = async(db, orderId) => {
                    await workspace.guardLocked(db,scope,req.params.id,orderId,body.expectedRevision);
                    if (selectedItem !== null && await workspace.nativeItemId(db,orderId,body.itemId) !== selectedItem)
                        throw workspace.fail(409,'WMS_SOURCE_LINE_CHANGED');
                };
                let nativeBody;
                if (kind === 'claim') nativeBody = { barcode:(await pool.query('SELECT work_barcode FROM orders WHERE id=$1',[source.order_id])).rows[0]?.work_barcode,
                    stage:station,commandId,expectedActorId:user.id,expectedRevision:body.expectedRevision };
                else nativeBody = { orderId:source.order_id,scanValue:body.scanValue,type:station,amount:1,
                    responseMode:'delta-v1',commandId,expectedRevision:body.expectedRevision,
                    expectedState:stored?.response?.baseState || await workspace.nativeState(pool,source.order_id),
                    ...(selectedItem === null ? {} : {orderItemId:selectedItem}) };
                const result = await runNative(kind === 'claim' ? claimHandler : scanHandler,req,user,nativeBody,guard);
                if (result.status < 200 || result.status >= 300) return res.status(result.status).json({ code:result.reply?.code || 'WMS_NATIVE_REJECTED' });
                res.json(await workspace.detail(pool,scope,req.params.id,true));
            } catch(error) { respond(res,error); }
        });
    }
    return router;
}
module.exports = { createCorelyWorkspaceReadRouter, createCorelyWorkspaceCommandRouter, authenticated, parseBody, runNative };
