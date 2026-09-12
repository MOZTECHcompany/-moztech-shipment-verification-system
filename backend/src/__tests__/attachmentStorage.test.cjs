const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createAttachmentStorage, createAttachmentKey, cleanOriginalName, validateStorageKey } = require('../services/attachmentStorage');

function fakeGcs() {
    const objects = new Map(), calls = [];
    let generation = 0;
    const api = { objects, calls, loseSaveResponse: false, bucket(name) {
        calls.push(['bucket', name]);
        return { file(key, version) {
            const file = {
                async save(buffer, options) {
                    calls.push(['save', key, options]);
                    if (objects.has(key)) throw Object.assign(new Error('exists'), { code: 412 });
                    const metadata = { ...options.metadata, size: String(buffer.length), generation: String(++generation) };
                    objects.set(key, { buffer, metadata }); file.metadata = metadata;
                    if (api.loseSaveResponse) throw Object.assign(new Error('synthetic response lost'), { code: 'ECONNRESET' });
                },
                async getMetadata() {
                    calls.push(['metadata', key]);
                    if (!objects.has(key)) throw Object.assign(new Error('missing'), { code: 404 });
                    return [objects.get(key).metadata];
                },
                createReadStream(options) {
                    calls.push(['stream', key, version, options]);
                    return Readable.from([objects.get(key).buffer]);
                },
                async delete(options) {
                    calls.push(['delete', key, options]);
                    if (objects.get(key)?.metadata.generation !== options.ifGenerationMatch) throw Object.assign(new Error('changed'), { code: 412 });
                    objects.delete(key);
                }
            };
            return file;
        } };
    } };
    return api;
}

const read = async stream => { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return Buffer.concat(chunks); };
const key = 'uploads/exception_attachments/3-1757000000000-70c9b697-4007-401d-893e-015eeaa2bfb1.png';

test('local storage preserves legacy relative paths, streams content and cleans only its own upload', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wms-attachments-'));
    try {
        const storage = createAttachmentStorage({ env: {}, localRoot: root });
        const receipt = await storage.put(key, Buffer.from('synthetic PNG'), 'image/png');
        const opened = await storage.open(key);
        assert.equal(opened.size, 13); assert.equal((await read(opened.stream)).toString(), 'synthetic PNG');
        await assert.rejects(storage.put(key, Buffer.from('overwrite'), 'image/png'), { code: 'EEXIST' });
        await storage.remove(receipt); await storage.remove(receipt);
        await assert.rejects(storage.open(key), { code: 'ENOENT' });
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('safe keys never resolve URLs, traversal, backslashes, other namespaces or symlink files', async () => {
    for (const invalid of ['../../secret', '/etc/passwd', 'uploads/exception_attachments/../../secret', 'uploads/exception_attachments/a/b.png', 'uploads\\exception_attachments\\file.png', 'gs://bucket/file.png', 'uploads/unknown/file.png', 'uploads/team_post_attachments/%2e%2e']) {
        assert.throws(() => validateStorageKey(invalid), { code: 'INVALID_STORAGE_KEY' });
    }
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wms-attachments-'));
    try {
        const storage = createAttachmentStorage({ env: {}, localRoot: root });
        await fs.mkdir(path.dirname(path.join(root, key)), { recursive: true });
        await fs.writeFile(path.join(root, 'secret'), 'not an attachment');
        await fs.symlink(path.join(root, 'secret'), path.join(root, key));
        await assert.rejects(storage.open(key));
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('object extensions come from allowed MIME and original filenames cannot add paths/header controls', () => {
    assert.match(createAttachmentKey('team_post_attachments', 9, 'application/pdf'), /^uploads\/team_post_attachments\/9-\d+-[0-9a-f-]+\.pdf$/);
    assert.throws(() => createAttachmentKey('team_post_attachments', '../9', 'application/pdf'));
    assert.throws(() => createAttachmentKey('team_post_attachments', 9, 'text/html'));
    assert.equal(cleanOriginalName('folder\\file\r\n.png'), 'file.png');
    assert.equal(validateStorageKey('uploads/team_attachments/9-old-file.jpg'), 'uploads/team_attachments/9-old-file.jpg');
});

test('GCS adapter uses private metadata, create-only generation preconditions and generation-bound streams', async () => {
    const client = fakeGcs();
    const storage = createAttachmentStorage({ env: { STORAGE_BACKEND: 'gcs', GCS_BUCKET: 'synthetic-private-bucket' }, storageClient: client });
    const receipt = await storage.put(key, Buffer.from('synthetic PNG'), 'image/png');
    const save = client.calls.find(call => call[0] === 'save')[2];
    assert.deepEqual(save.preconditionOpts, { ifGenerationMatch: 0 });
    assert.equal(save.resumable, false); assert.equal(save.validation, 'crc32c');
    assert.equal(save.metadata.cacheControl, 'private, no-store');
    assert.equal(save.metadata.contentType, 'image/png');
    assert.equal('public' in save, false); assert.equal('predefinedAcl' in save, false);
    const opened = await storage.open(key);
    assert.equal((await read(opened.stream)).toString(), 'synthetic PNG');
    assert.deepEqual(client.calls.find(call => call[0] === 'stream')[2], { generation: receipt.generation });
    await storage.remove(receipt);
    assert.equal(client.objects.size, 0);
    assert.equal(client.calls.find(call => call[0] === 'delete')[2].ifGenerationMatch, receipt.generation);
    await assert.rejects(storage.open(key), { code: 404 });
});

test('lost upload response can clean its own object but cannot delete a pre-existing/replaced object', async () => {
    const client = fakeGcs();
    const storage = createAttachmentStorage({ env: { STORAGE_BACKEND: 'gcs', GCS_BUCKET: 'synthetic-private-bucket' }, storageClient: client });
    client.loseSaveResponse = true;
    let failed;
    try { await storage.put(key, Buffer.from('synthetic'), 'image/png'); } catch (error) { failed = error; }
    assert.equal(client.objects.size, 1);
    await storage.remove(failed.attachmentReceipt); assert.equal(client.objects.size, 0);
    client.loseSaveResponse = false;
    const original = await storage.put(key, Buffer.from('original'), 'image/png');
    let collision;
    try { await storage.put(key, Buffer.from('collision'), 'image/png'); } catch (error) { collision = error; }
    await assert.rejects(storage.remove(collision.attachmentReceipt), { code: 'STORAGE_OWNERSHIP_CHANGED' });
    assert.equal(client.objects.get(key).buffer.toString(), 'original');
    client.objects.get(key).metadata.generation = '999';
    await assert.rejects(storage.remove(original), { code: 'STORAGE_OWNERSHIP_CHANGED' });
});

test('configuration fails closed for unknown backends or missing/URL bucket names', () => {
    assert.throws(() => createAttachmentStorage({ env: { STORAGE_BACKEND: 's3' } }), { code: 'STORAGE_CONFIG_INVALID' });
    for (const GCS_BUCKET of [undefined, '', 'gs://bucket', 'bucket/path']) {
        assert.throws(() => createAttachmentStorage({ env: { STORAGE_BACKEND: 'gcs', GCS_BUCKET } }), { code: 'STORAGE_CONFIG_INVALID' });
    }
});

module.exports = { fakeGcs };
