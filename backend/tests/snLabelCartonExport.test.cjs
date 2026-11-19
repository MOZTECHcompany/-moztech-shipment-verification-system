const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const XLSX = require('xlsx');
const { createCartonFixture } = require('./cartonFixture.cjs');

const binary = (res, done) => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => done(null, Buffer.concat(chunks)));
};
const ok = response => {
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body;
};

test('carton XLSX exports the entire SN or non-SN batch, including appended cartons', async t => {
    const fixture = await createCartonFixture();
    fixture.attachLegacyRoutes();
    const server = await new Promise(resolve => {
        const value = fixture.app.listen(0, '127.0.0.1', () => resolve(value));
    });
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        await fixture.close();
    });
    const call = (method, path, body, actor = 1) => {
        const req = request(server)[method](path).set('x-fixture-user', String(actor));
        return body === undefined ? req : req.send(body);
    };
    const api = '/api/sn-labels';
    for (const hasSN of [true, false]) await t.test(hasSN ? '102 boxes with 10,101 SNs' : '10,001 boxes without SN', async () => {
        const sku = hasSN ? 'EXPORT-SN' : 'EXPORT-NO-SN';
        const barcode = hasSN ? '0471000000001' : 'ITM-EXPORT-NO-SN';
        const product = ok(await call('post', `${api}/products`, { sku, name: sku, barcode, modelNumber: sku }));
        const form = {
            sku, name: sku, productName: sku, productId: product.id, barcode, model: sku,
            style: '', color: '', styleCode: '', colorCode: 'W', modelCode: hasSN ? 'E19' : 'NSI',
            capacity: hasSN ? 100 : 1, orderDate: '2026-11-19', manufactureDate: '2026-11-19',
            cartonWidth: 100, cartonHeight: 125,
            label: { width: 60, height: 30, target: 'box', showQr: true, textX: 30, textY: 1,
                fontSize: 2, qrX: 1, qrY: 1, qrSize: 25 },
        };
        const activate = async quantity => {
            const draft = randomUUID(), data = { ...form, quantity };
            ok(await call('put', `${api}/drafts/${draft}`, { data, revision: 0 }));
            const preview = ok(await call('post', `${api}/preview`, { data }));
            return ok(await call('post', `${api}/drafts/${draft}/activate`, { revision: 1, previewToken: preview.token }));
        };
        const { batchId } = await activate(10000);
        assert.equal((await activate(hasSN ? 101 : 1)).batchId, batchId);
        const path = `${api}/batches/${batchId}`;
        const expected = (await fixture.db.query(`SELECT c.id,c.quantity,
            COALESCE((SELECT jsonb_agg(s.sn ORDER BY s.position) FROM sn_label_serials s WHERE s.carton_id=c.id),'[]'::jsonb) AS serials
            FROM sn_label_cartons c WHERE c.batch_id=$1 ORDER BY c.ordinal`, [batchId])).rows;
        assert.equal(expected.length, hasSN ? 102 : 10001);
        const before = ok(await call('get', path));
        const exportRequest = (from, to, actor = 1, kind = 'warehouse-cartons') => call('post', `${path}/export`, {
            kind, reason: 'initial', from, to,
        }, actor);
        const readWorkbook = async (from, to) => {
            const response = await exportRequest(from, to).buffer(true).parse(binary);
            assert.equal(response.status, 200, response.body.toString().slice(0, 300));
            assert.match(response.headers['content-type'], /spreadsheetml/);
            return XLSX.read(response.body, { type: 'buffer' });
        };
        const verifyWorkbook = (book, selected) => {
            assert.deepEqual(book.SheetNames, ['箱號明細', '倉儲明細']);
            for (const sheetName of book.SheetNames) {
                const rows = XLSX.utils.sheet_to_json(book.Sheets[sheetName], { defval: '' });
                assert.equal(rows.length, selected.length);
                assert.deepEqual(rows.map(row => row['箱號']), selected.map(box => box.id));
                assert.deepEqual(rows.map(row => row['數量']), selected.map(box => box.quantity));
                assert.deepEqual(rows.map(row => row.SN), selected.map(box => box.serials.join(',')));
                assert.ok(rows.every(row => row['品號'] === sku && row['來源識別'] === batchId));
                assert.ok(rows.every(row => row['國際條碼'] === (hasSN ? barcode : '') &&
                    row['內部掃描碼'] === (hasSN ? '' : barcode)));
            }
        };
        verifyWorkbook(await readWorkbook(1, expected.length), expected);
        const event = (await fixture.db.query("SELECT data FROM sn_label_events WHERE batch_id=$1 AND action='EXPORT'", [batchId])).rows;
        assert.equal(event.length, 1);
        assert.deepEqual(event[0].data.cartons, expected.map(box => box.id));
        assert.equal(event[0].data.serialCount, hasSN ? 10101 : 0);
        verifyWorkbook(await readWorkbook(expected.length - 1, expected.length), expected.slice(-2));
        for (const [from, to] of [[0, 1], [2, 1], [1.5, 2], [1, expected.length + 1], [1, Number.MAX_SAFE_INTEGER + 1]]) {
            assert.equal((await exportRequest(from, to)).status, 400);
        }
        assert.equal((await exportRequest(1, expected.length, 2)).status, 403);
        // Only carton workbooks are unrestricted; the existing unit-label limit still applies.
        assert.equal((await exportRequest(1, 10001, 1, 'warehouse')).status, 400);
        const after = ok(await call('get', path));
        assert.equal(after.data.quantity, before.data.quantity);
        assert.equal(after.cartons, before.cartons);
        assert.equal(after.receivingStatus, before.receivingStatus);
        assert.deepEqual(after.boxes, before.boxes);
        assert.equal(after.events.filter(item => item.action === 'EXPORT').length, 2);
        ok(await call('post', `${path}/reversion`, { batchRevision: after.batchRevision, reason: '合成批次匯出驗證完成' }));
        assert.equal((await exportRequest(1, expected.length)).status, 409);
    });
});
