const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { generateKeyPairSync, randomUUID, randomBytes } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const service = require('../src/services/corelyNativeIntake');
const { createCorelyDispatchRouter, createCorelyPrepickRouter } = require('../src/routes/corelyNativeIntakeRoutes');

async function setup() {
    let db, pool;
    if (process.env.CORELY_INTAKE_PG_TEST === '1') {
        // Fixed loopback fixture only. Never read DATABASE_URL or cloud settings.
        const { Client, Pool } = require('pg');
        const cfg = { host: '127.0.0.1', port: 55441, user: 'wms_replay', password: 'wms_replay_local_only' };
        const name = 'corely_intake_' + randomBytes(6).toString('hex');
        const control = new Client({ ...cfg, database: 'postgres' }); await control.connect();
        await control.query('CREATE DATABASE "' + name + '"');
        const pgPool = new Pool({ ...cfg, database: name, max: 5 });
        pool = { query: (...args) => pgPool.query(...args), connect: async () => { const client = await pgPool.connect(); return { query: (...args) => client.query(...args), release: () => client.release() }; } };
        db = { query: (...args) => pgPool.query(...args), exec: sql => pgPool.query(sql), close: async () => { await pgPool.end(); await control.query('DROP DATABASE "' + name + '"'); await control.end(); } };
    } else db = new PGlite();
    for (const name of ['000_initial_schema.sql', '028_order_item_source_identity.sql', '029_warehouse_batches_and_claim_receipts.sql', '030_marketplace_intakes.sql', '033_warehouse_release.sql', '036_corely_native_intakes.sql']) await db.exec(readFileSync(join(__dirname, '../migrations', name), 'utf8'));
    // PGlite is one connection: serialize checkout, preserving real SQL transactions.
    let tail = Promise.resolve();
    pool ||= { query: (...args) => db.query(...args), connect: async () => {
        const previous = tail; let release; tail = new Promise(r => { release = r; }); await previous;
        return { query: (...args) => db.query(...args), release };
    } };
    const users = {};
    for (const role of ['admin', 'dispatcher', 'picker', 'packer']) users[role] = (await db.query('INSERT INTO users(username,password,name,role) VALUES($1,\'unused\',$1,$1) RETURNING id,name,role', [role])).rows[0];
    await db.query("INSERT INTO corely_dispatch_grants(entity_id,erp_actor_id,brand,wms_user_id) VALUES('company','sales-person','MOZTECH',$1)", [users.dispatcher.id]);
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const env = { ERP_WORKSPACE_COMMANDS_ENABLED: 'true', ERP_WORKSPACE_ISSUER: 'corely-test', ERP_WORKSPACE_AUDIENCE: 'wms-test', ERP_WORKSPACE_PUBLIC_KEY: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
    const app = express();
    app.use('/api/integrations/erp/workflow/v1', createCorelyDispatchRouter({ pool, env }));
    app.use('/api/corely-intakes', express.json(), (req, _res, next) => { req.user = users[req.headers['test-role'] || 'admin']; next(); }, createCorelyPrepickRouter({ pool }));
    app.use((error, _req, res, _next) => res.status(500).json({ message: error.message }));
    const token = (id, body, overrides = {}) => jwt.sign({ entityId: 'company', station: 'dispatch', scope: 'wms.workspace.command', method: 'POST', path: '/orders/' + id + '/dispatch', bodyHash: service.hash(body), ...overrides }, keys.privateKey, { algorithm: 'RS256', issuer: env.ERP_WORKSPACE_ISSUER, audience: env.ERP_WORKSPACE_AUDIENCE, subject: 'sales-person', expiresIn: 45 });
    const send = (id, body, overrides) => request(app).post('/api/integrations/erp/workflow/v1/orders/' + id + '/dispatch').set('Authorization', 'Bearer ' + token(id, body, overrides)).send(body);
    return { db, pool, users, app, env, token, send };
}
const payload = (id = 'sale-1', proof = true) => ({ requestId: 'request-' + id, order: { orderNumber: 'SO-' + id, brand: 'MOZTECH', sourceHash: 'a'.repeat(64), items: [
    { id: 'line-1', productId: 'product-1', sku: '0001', name: '品項 A', barcode: '000123', quantity: 2, tracked: false, serials: [] },
    { id: 'line-2', productId: 'product-2', sku: '0002', name: '品項 B', barcode: '000124', quantity: 1, tracked: true, serials: ['SN-0001'] },
], ...(proof ? { reservationReference: { salesOrderId: id, warehouseId: 'warehouse-1', quantitiesByProduct: [{ productId: 'product-1', quantity: 2 }, { productId: 'product-2', quantity: 1 }] } } : {}) } });
const expectStatus = (response, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.body)); return response.body; };

test('signed native dispatch, persistent identity, safe retry and reservation-gated prepick', { timeout: 30000 }, async t => {
    const f = await setup(); t.after(() => f.db.close());
    const body = payload();
    await t.test('missing, altered, expired, wrong station and cross-company delegations cannot create work', async () => {
        expectStatus(await request(f.app).post('/api/integrations/erp/workflow/v1/orders/sale-1/dispatch').send(body), 401);
        for (const overrides of [{ station: 'pick' }, { bodyHash: 'b'.repeat(64) }, { path: '/orders/other/dispatch' }, { scope: 'wms.workspace.read' }, { method: 'GET' }, { iat: Math.floor(Date.now() / 1000) - 120 }]) expectStatus(await f.send('sale-1', body, overrides), 401);
        expectStatus(await f.send('sale-1', body, { entityId: 'other-company' }), 403);
        assert.equal((await f.db.query('SELECT count(*)::int n FROM orders')).rows[0].n, 0);
    });
    await t.test('rejects malformed product identity, SN and incomplete or mismatched reservation', async () => {
        for (const mutate of [b => b.order.items[0].quantity = 0, b => b.order.items[1].id = 'line-1', b => b.order.items[1].serials = [], b => delete b.order.items[0].productId, b => b.order.reservationReference.salesOrderId = 'other', b => b.order.reservationReference.quantitiesByProduct[0].quantity = 1, b => b.order.reservationReference.quantitiesByProduct.pop()]) {
            const bad = structuredClone(body); mutate(bad); expectStatus(await f.send('sale-1', bad), 400);
        }
        assert.equal((await f.db.query('SELECT count(*)::int n FROM orders')).rows[0].n, 0);
    });
    let accepted;
    await t.test('concurrent retry creates exactly one work order and no ECOUNT receipt', async () => {
        const responses = await Promise.all([f.send('sale-1', body), f.send('sale-1', body)]);
        accepted = expectStatus(responses[0]); const replay = expectStatus(responses[1]);
        assert.equal(accepted.contractVersion, 'wms.workspace-command.v1'); assert.equal(accepted.id, 'sale-1'); assert.equal(accepted.required, 3); assert.equal(accepted.reservationAccepted, true);
        assert.equal(accepted.workBarcode, replay.workBarcode); assert.equal(accepted.nativeIntakeId, replay.nativeIntakeId); assert.deepEqual(accepted.allowedActions, []);
        assert.match(accepted.workBarcode, /^WT[0-9A-F]{18}$/);
        assert.equal((await f.db.query('SELECT count(*)::int n FROM orders')).rows[0].n, 1);
        assert.equal((await f.db.query('SELECT count(*)::int n FROM marketplace_warehouse_flows')).rows[0].n, 0);
        const saved = (await f.db.query('SELECT * FROM order_items ORDER BY id')).rows;
        assert.deepEqual(saved.map(i => i.source_line_id), ['line-1', 'line-2']); assert.ok(saved.every(i => i.source_platform === 'Corely'));
        assert.equal((await f.db.query('SELECT warehouse_hold FROM orders')).rows[0].warehouse_hold, true);
    });
    await t.test('changed payload and request reused for a different order do not overwrite', async () => {
        const changed = structuredClone(body); changed.order.orderNumber = 'CHANGED'; expectStatus(await f.send('sale-1', changed), 409);
        expectStatus(await f.send('sale-1', { ...body, requestId: 'different-request' }), 409);
        const another = payload('sale-2'); another.requestId = body.requestId; expectStatus(await f.send('sale-2', another), 409);
        await f.db.query('UPDATE corely_dispatch_grants SET revoked_at=NOW()'); expectStatus(await f.send('sale-1', body), 403);
        await f.db.query('UPDATE corely_dispatch_grants SET revoked_at=NULL');
    });
    await t.test('lost COMMIT response retries the same saved order without duplicate work', async () => {
        const originalConnect = f.pool.connect; let failOnce = true;
        f.pool.connect = async () => { const client = await originalConnect(); const query = client.query; client.query = async (...args) => { const result = await query(...args); if (args[0] === 'COMMIT' && failOnce) { failOnce = false; throw Error('response dropped'); } return result; }; return client; };
        expectStatus(await f.send('lost-response', payload('lost-response')), 503);
        const retry = expectStatus(await f.send('lost-response', payload('lost-response'))); assert.equal(retry.reused, true);
        assert.equal((await f.db.query("SELECT count(*)::int n FROM corely_native_intakes WHERE erp_order_id='lost-response'")).rows[0].n, 1);
        f.pool.connect = originalConnect;
    });
    const mutate = (role, id, action, extra = {}, commandId = randomUUID()) => request(f.app).post(`/api/corely-intakes/${id}/${action}`).set('test-role', role).send({ commandId, expectedActorId: f.users[role].id, ...extra });
    await t.test('assigned worker alone verifies scanned products and releases reserved work', async () => {
        const id = accepted.nativeIntakeId;
        expectStatus(await request(f.app).get(`/api/corely-intakes/${id}`).set('test-role', 'picker'), 404);
        expectStatus(await mutate('picker', id, 'print'), 403);
        expectStatus(await mutate('admin', id, 'assign', { assigneeId: f.users.picker.id }), 409);
        expectStatus(await mutate('admin', id, 'print'));
        expectStatus(await mutate('admin', id, 'assign', { assigneeId: f.users.picker.id }));
        const detail = expectStatus(await request(f.app).get(`/api/corely-intakes/${id}`).set('test-role', 'picker'));
        expectStatus(await mutate('picker', id, 'complete'), 409);
        expectStatus(await mutate('packer', id, 'complete'), 404);
        for (const product of detail.products) {
            const commandId = randomUUID(), extra = { productKey: product.key, barcode: product.barcode, quantity: product.quantity };
            expectStatus(await mutate('picker', id, 'scan', { ...extra, barcode: 'WRONG' }), 400);
            expectStatus(await mutate('picker', id, 'scan', extra, commandId)); expectStatus(await mutate('picker', id, 'scan', extra, commandId));
        }
        const finishId = randomUUID(); expectStatus(await mutate('picker', id, 'complete', {}, finishId)); expectStatus(await mutate('picker', id, 'complete', {}, finishId));
        assert.equal((await f.db.query('SELECT warehouse_hold FROM orders WHERE id=$1', [accepted.wmsOrderId])).rows[0].warehouse_hold, false);
        const fresh = expectStatus(await f.send('sale-1', body)); assert.equal(fresh.state, 'pending'); assert.deepEqual(fresh.blockers, []); assert.equal(fresh.receiptLabel, 'Corely 庫存尚未核銷');
    });
    await t.test('a signed order without reservation evidence stays held after complete physical counts', async () => {
        const pending = expectStatus(await f.send('unreserved', payload('unreserved', false)));
        assert.equal(pending.reservationAccepted, false);
        const id = pending.nativeIntakeId;
        expectStatus(await mutate('admin', id, 'print')); expectStatus(await mutate('admin', id, 'assign', { assigneeId: f.users.picker.id }));
        for (const p of service.products(payload('unreserved', false).order.items)) expectStatus(await mutate('picker', id, 'scan', { productKey: p.key, barcode: p.barcode, quantity: p.quantity }));
        expectStatus(await mutate('picker', id, 'complete'), 409);
        assert.equal((await f.db.query('SELECT warehouse_hold FROM orders WHERE id=$1', [pending.wmsOrderId])).rows[0].warehouse_hold, true);
    });
    await t.test('native order remains linked; later legacy edits cannot be released against stale source quantities', async () => {
        await assert.rejects(f.db.query('DELETE FROM orders WHERE id=$1', [accepted.wmsOrderId]), /foreign key/);
        const edited = expectStatus(await f.send('edited', payload('edited'))), id = edited.nativeIntakeId;
        await f.db.query('UPDATE order_items SET quantity=4 WHERE order_id=$1 AND source_line_id=\'line-1\'', [edited.wmsOrderId]);
        expectStatus(await mutate('admin', id, 'print'), 409);
    });
});

test('native route stays off without explicit command configuration', async () => {
    const app = express(); app.use('/api/integrations/erp/workflow/v1', createCorelyDispatchRouter({ pool: {}, env: {} }));
    expectStatus(await request(app).post('/api/integrations/erp/workflow/v1/orders/sale-1/dispatch').send(payload()), 503);
});
