const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');
const request = require('supertest');
const { Readable } = require('node:stream');
const realStorage = require('../services/attachmentStorage');

function fixture(kind, options = {}) {
    const team = kind === 'team';
    const records = [], objects = new Map(), calls = [], releases = [];
    let inserted = 0, transaction = [];
    const storage = {
        async put(key, buffer, contentType) {
            calls.push(['put', key, contentType]); objects.set(key, buffer);
            return { key, generation: '1', uploadId: 'fixture' };
        },
        async remove(receipt) { calls.push(['remove', receipt.key]); objects.delete(receipt.key); },
        async open(key) {
            calls.push(['open', key]);
            if (!objects.has(key)) throw Object.assign(new Error('missing'), { code: 404 });
            const stream = options.streamError ? new Readable({ read() { this.destroy(Object.assign(new Error('synthetic stream failure'), { code: 500 })); } }) : Readable.from([objects.get(key)]);
            return { stream, size: objects.get(key).length };
        }
    };
    const query = async (sql, params = []) => {
        calls.push(['query', sql.replace(/\s+/g, ' ').trim(), params]);
        if (sql === 'BEGIN') { transaction = []; return {}; }
        if (sql === 'ROLLBACK') {
            if (options.rollbackError) throw new Error('synthetic rollback unavailable');
            transaction = []; return {};
        }
        if (sql === 'COMMIT') {
            records.push(...transaction); transaction = [];
            if (options.commitError) throw new Error('synthetic commit response lost');
            return {};
        }
        if (sql.includes('SELECT 1 FROM')) return { rows: options.missingParent ? [] : [{ exists: 1 }], rowCount: options.missingParent ? 0 : 1 };
        if (sql.includes('INSERT INTO')) {
            inserted++;
            if (inserted === options.insertErrorAt) throw new Error('synthetic DB metadata failure');
            const offset = team ? 1 : 2;
            const row = { id: inserted, ...(team ? { post_id: 3 } : { order_id: 2, exception_id: 3 }), storage_key: params[offset], original_name: params[offset+1], mime_type: params[offset+2], size_bytes: params[offset+3], uploaded_by: params[offset+4] };
            transaction.push(row);
            const { storage_key, ...publicRow } = row;
            return { rows: [publicRow], rowCount: 1 };
        }
        if (sql.includes('SELECT storage_key')) {
            const row = records.find(row => row.id === Number(params[0]) && (team ? row.post_id === Number(params[1]) : row.exception_id === Number(params[1]) && row.order_id === Number(params[2])));
            return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
        }
        if (sql.includes('FROM order_exception_attachments') || sql.includes('FROM team_post_attachments')) return { rows: records.map(({ storage_key, ...row }) => row), rowCount: records.length };
        throw new Error(`Unexpected fixture query: ${sql}`);
    };
    const pool = { query, connect: async () => {
        if (options.connectError) throw new Error('synthetic pool unavailable');
        return { query, release: error => releases.push(error) };
    } };
    const filename = path.resolve(__dirname, `../routes/${team ? 'teamBoardRoutes' : 'exceptionRoutes'}.js`);
    const loaded = new Module(filename, module); loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    const originalRequire = loaded.require.bind(loaded);
    loaded.require = name => {
        if (name === '../config/database') return { pool };
        if (name === '../services/attachmentStorage') return { ...realStorage, getAttachmentStorage: () => storage };
        if (name === '../utils/logger') return { warn() {}, error() {}, info() {} };
        if (name === '../middleware/auth') return { authorizeAdmin: (req,res,next) => next(), authorizeRoles: () => (req,res,next) => next() };
        if (name === '../services/operationLogService') return { logOperation: async () => {} };
        if (name === '../services/orderChangeService') return {};
        return originalRequire(name);
    };
    loaded._compile(fs.readFileSync(filename, 'utf8'), filename);
    const app = express(); app.use(express.json());
    app.use((req, res, next) => {
        if (req.headers.authorization !== 'Bearer synthetic-only') return res.sendStatus(401);
        req.user = { id: 7, role: 'picker' }; next();
    });
    app.set('io', { emit: () => { if (options.emitError) throw new Error('synthetic socket failure'); } });
    app.use('/api', loaded.exports);
    app.use((err, req, res, next) => res.status(400).json({ message: err.message }));
    const base = team ? '/api/team/posts/3/attachments' : '/api/orders/2/exceptions/3/attachments';
    const upload = (count = 1, type = 'image/png') => {
        let req = request(app).post(base).set('Authorization', 'Bearer synthetic-only');
        for (let i = 0; i < count; i++) req = req.attach('files', Buffer.from(`synthetic-${i}`), { filename: 'picture.png', contentType: type });
        return req;
    };
    return { app, base, upload, records, objects, calls, releases };
}

for (const kind of ['exception','team']) {
    test(`${kind}: upload metadata contract + API-only private streamed download + parent scope`, async () => {
        const h = fixture(kind);
        const uploaded = await h.upload(); assert.equal(uploaded.status, 201);
        assert.equal(uploaded.body.items[0].mime_type, 'image/png');
        assert.equal('storage_key' in uploaded.body.items[0], false);
        assert.match(h.records[0].storage_key, new RegExp(`^uploads/${kind === 'team' ? 'team_post' : 'exception'}_attachments/3-`));
        const response = await request(h.app).get(`${h.base}/1/download?inline=1`).set('Authorization','Bearer synthetic-only');
        assert.equal(response.status, 200); assert.equal(response.body.toString(), 'synthetic-0');
        assert.equal(response.headers['cache-control'], 'private, no-store');
        assert.match(response.headers['content-disposition'], /^inline;/);
        assert.equal(response.headers.location, undefined);
        assert.equal((await request(h.app).get(`${h.base}/1/download`)).status, 401);
        const wrongParent = h.base.replace('/3/', '/999/');
        const count = h.calls.filter(call => call[0] === 'open').length;
        assert.equal((await request(h.app).get(`${wrongParent}/1/download`).set('Authorization','Bearer synthetic-only')).status, 404);
        assert.equal(h.calls.filter(call => call[0] === 'open').length, count);
        h.objects.clear();
        assert.equal((await request(h.app).get(`${h.base}/1/download`).set('Authorization','Bearer synthetic-only')).status, 404);
    });
    test(`${kind}: second metadata insert failure cleans every new object after confirmed rollback`, async () => {
        const h = fixture(kind, { insertErrorAt: 2 });
        assert.equal((await h.upload(2)).status, 500);
        assert.equal(h.records.length, 0); assert.equal(h.objects.size, 0);
        assert.equal(h.calls.filter(call => call[0] === 'remove').length, 2);
        assert.equal(h.releases.length, 1);
    });
    test(`${kind}: uncertain COMMIT keeps potentially referenced objects and reports unknown`, async () => {
        const h = fixture(kind, { commitError: true });
        const res = await h.upload(); assert.equal(res.status, 503);
        assert.equal(res.body.code, 'ATTACHMENT_RESULT_UNKNOWN');
        assert.equal(h.records.length, 1); assert.equal(h.objects.size, 1);
        assert.equal(h.calls.filter(call => call[0] === 'remove').length, 0);
        assert.ok(h.releases[0] instanceof Error);
    });
    test(`${kind}: failed rollback preserves objects; missing parent/failed pool create no objects`, async () => {
        const rollback = fixture(kind, { insertErrorAt: 1, rollbackError: true });
        assert.equal((await rollback.upload()).body.code, 'ATTACHMENT_RESULT_UNKNOWN');
        assert.equal(rollback.objects.size, 1);
        for (const options of [{ missingParent: true }, { connectError: true }]) {
            const h = fixture(kind, options); const res = await h.upload();
            assert.equal(res.status, options.missingParent ? 404 : 500); assert.equal(h.objects.size, 0);
        }
    });
    test(`${kind}: disallowed MIME / too many files cannot persist attachments`, async () => {
        const h = fixture(kind);
        assert.equal((await h.upload(1, 'text/html')).status, 400);
        assert.equal((await h.upload(6)).status, 400);
        assert.equal(h.objects.size, 0);
    });
    test(`${kind}: stream errors return an error response, not a dangling loading connection`, async () => {
        const h = fixture(kind, { streamError: true }); await h.upload();
        const res = await request(h.app).get(`${h.base}/1/download`).set('Authorization','Bearer synthetic-only');
        assert.equal(res.status, 502); assert.match(res.headers['content-type'], /application\/json/);
    });
}

test('team: a post-commit Socket failure does not misreport an accepted attachment', async () => {
    const h = fixture('team', { emitError: true });
    assert.equal((await h.upload()).status, 201); assert.equal(h.objects.size, 1); assert.equal(h.records.length, 1);
});
