const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { PGlite } = require('@electric-sql/pglite');
const { createCartonItemRouter } = require('../src/routes/cartonItemRoutes');
const { parseOrderRows } = require('../src/services/orderImportParser');
const { matchesItem } = require('../src/services/cartonContents');

test('native carton item search preserves imported identity and manager permissions', async t => {
    const db = new PGlite();
    await db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,role TEXT,management_scope TEXT);
        CREATE TABLE order_items(product_code TEXT,product_name TEXT,barcode TEXT);
        INSERT INTO users VALUES(1,'admin','warehouse'),(2,'picker','all'),(3,'admin','orders'),(4,'superadmin','all');
        INSERT INTO order_items VALUES
          ('MODEL-a02','原始品名','004711000000010'),('MODEL-a02','原始品名','004711000000010'),
          ('MODEL-a02','原始品名','004711000000011'),('ITEM-noean','無國條','source-sku-A'),
          ('ITEM-internal','內碼商品','ITM-Original-a02'),('PERCENT%_','Literal','OTHER');`);
    const pool = { query: (q, values) => typeof q === 'object' ? db.query(q.text, q.values) : db.query(q, values) };
    const app = express();
    app.use((req, res, next) => { if (req.headers['x-test-actor']) req.user = { id: Number(req.headers['x-test-actor']), role: 'superadmin' }; next(); });
    app.use('/api/carton-items', createCartonItemRouter({ pool }));
    const search = (q, actor = 1) => request(app).get('/api/carton-items').query({ q }).set('x-test-actor', String(actor));
    try {
        await t.test('authentication and current administrator identity are required', async () => {
            assert.equal((await request(app).get('/api/carton-items?q=MODEL')).status, 401);
            for (const id of [2, 999]) assert.equal((await search('MODEL', id)).status, id === 999 ? 401 : 403);
            assert.equal((await search('MODEL', 4)).status, 200);
            assert.equal((await search('MODEL', 3)).status, 200, 'An order manager can manage and search cartons');
        });
        await t.test('deduplicates exact triples without merging different scan keys or losing zeros/case', async () => {
            const result = await search('model-A02');
            assert.equal(result.status, 200);
            assert.equal(result.headers['cache-control'], 'private, no-store');
            assert.deepEqual(result.body.items, [
                { itemCode: 'MODEL-a02', productName: '原始品名', importedBarcode: '004711000000010', barcodeIdentity: 'unconfirmed' },
                { itemCode: 'MODEL-a02', productName: '原始品名', importedBarcode: '004711000000011', barcodeIdentity: 'unconfirmed' }
            ]);
        });
        await t.test('source SKU and ITM label remain evidence, never an inferred EAN', async () => {
            for (const [q, code] of [['source-sku-A', 'ITEM-noean'], ['ITM-Original-a02', 'ITEM-internal']]) {
                const item = (await search(q)).body.items[0];
                assert.equal(item.itemCode, code); assert.equal(item.importedBarcode, q);
                assert.equal(item.barcodeIdentity, 'unconfirmed'); assert.equal(Object.hasOwn(item, 'ean'), false);
            }
        });
        await t.test('search metacharacters are literal and invalid queries are bounded', async () => {
            assert.equal((await search('%_')).body.items[0].itemCode, 'PERCENT%_');
            assert.equal((await search("' OR 1=1 --")).body.items.length, 0);
            assert.equal((await search('')).body.items.length, 0);
            assert.equal((await search('x'.repeat(129))).status, 400);
            assert.equal((await request(app).get('/api/carton-items?q=a&q=b').set('x-test-actor', '1')).status, 400);
        });
        await t.test('rechecks a demoted actor rather than trusting a stale caller role', async () => {
            await db.query("UPDATE users SET management_scope='orders' WHERE id=1");
            assert.equal((await search('MODEL')).status, 200);
            await db.query("UPDATE users SET role='picker' WHERE id=1");
            assert.equal((await search('MODEL')).status, 403);
            await db.query("UPDATE users SET role='admin',management_scope='warehouse' WHERE id=1");
        });
        await t.test('exact imported model is usable for both barcode and no-EAN carton matching', async () => {
            const parsed = parseOrderRows([['憑證號碼：SYNTHETIC-NATIVE'],
                ['品項編碼', '品項名稱', '數量', '品項型號'], ['004711000000010', '原始品名', 10, 'MODEL-a02']]).items[0];
            const choice = (await search('004711000000010')).body.items[0];
            const item = { product_code: parsed.productCode, barcode: parsed.barcode };
            assert.equal(matchesItem({ itemCode: choice.itemCode, ean: choice.importedBarcode }, item), true);
            assert.equal(matchesItem({ itemCode: choice.itemCode, ean: null }, item), true);
            assert.equal(matchesItem({ itemCode: choice.importedBarcode, ean: choice.importedBarcode }, item), false);
            assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM order_items')).rows[0].count, 6);
        });
        await t.test('limits a result to 30 choices', async () => {
            for (let i = 0; i < 40; i++) await db.query('INSERT INTO order_items VALUES($1,$2,$3)', [`BOUND-${i}`, 'Synthetic', `SCAN-${i}`]);
            assert.equal((await search('BOUND')).body.items.length, 30);
        });
    } finally { await db.close(); }
});
