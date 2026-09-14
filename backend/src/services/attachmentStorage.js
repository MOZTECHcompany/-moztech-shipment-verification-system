const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CONTENT_TYPES = Object.freeze({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' });
const PREFIXES = new Set(['exception_attachments', 'team_post_attachments', 'team_attachments']);

function storageError(code, message) { return Object.assign(new Error(message), { code }); }

function validateStorageKey(key) {
    if (typeof key !== 'string' || !/^uploads\/[a-z_]+\/[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(key)) {
        throw storageError('INVALID_STORAGE_KEY', 'Invalid attachment storage key');
    }
    const [, prefix, name] = key.split('/');
    if (!PREFIXES.has(prefix) || name === '.' || name === '..') throw storageError('INVALID_STORAGE_KEY', 'Invalid attachment storage key');
    return key;
}

function createAttachmentKey(prefix, parentId, contentType) {
    if (!['exception_attachments', 'team_post_attachments'].includes(prefix) || !/^[1-9]\d*$/.test(String(parentId)) || !CONTENT_TYPES[contentType]) {
        throw storageError('INVALID_ATTACHMENT', 'Invalid attachment metadata');
    }
    return validateStorageKey(`uploads/${prefix}/${parentId}-${Date.now()}-${crypto.randomUUID()}${CONTENT_TYPES[contentType]}`);
}

function cleanOriginalName(name) {
    if (!name) return null;
    return String(name).toWellFormed().replace(/[\x00-\x1f\x7f]/g, '').split(/[\\/]/).pop().slice(0, 255) || null;
}

function isMissing(error) { return error?.code === 404 || error?.code === '404' || error?.code === 'ENOENT'; }

function createAttachmentStorage({ env = process.env, localRoot = path.resolve(__dirname, '../..'), storageClient } = {}) {
    const backend = env.STORAGE_BACKEND || 'local';
    if (!['local', 'gcs'].includes(backend)) throw storageError('STORAGE_CONFIG_INVALID', 'STORAGE_BACKEND must be local or gcs');
    if (backend === 'gcs') {
        const bucketName = env.GCS_BUCKET;
        if (typeof bucketName !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucketName) || bucketName.includes('..')) {
            throw storageError('STORAGE_CONFIG_INVALID', 'GCS_BUCKET must be a bucket name, without a URL or path');
        }
        // Uses ADC (the Cloud Run service account); no key file or public ACL in application code.
        const client = storageClient || new (require('@google-cloud/storage').Storage)();
        const bucket = client.bucket(bucketName);
        return {
            backend,
            async put(key, buffer, contentType) {
                validateStorageKey(key);
                if (!Buffer.isBuffer(buffer) || !CONTENT_TYPES[contentType]) throw storageError('INVALID_ATTACHMENT', 'Invalid attachment body/type');
                const receipt = { backend, key, uploadId: crypto.randomUUID() };
                const file = bucket.file(key);
                try {
                    await file.save(buffer, {
                        resumable: false,
                        validation: 'crc32c',
                        preconditionOpts: { ifGenerationMatch: 0 },
                        metadata: { contentType, cacheControl: 'private, no-store', metadata: { attachmentUploadId: receipt.uploadId } }
                    });
                    receipt.generation = file.metadata?.generation;
                    return receipt;
                } catch (error) {
                    // The remote write may have succeeded before a network error. Cleanup can
                    // inspect our ownership token; it must never delete a pre-existing object.
                    error.attachmentReceipt = receipt;
                    throw error;
                }
            },
            async open(key) {
                validateStorageKey(key);
                const file = bucket.file(key);
                const [metadata] = await file.getMetadata();
                // Bind the stream to the same generation whose size was inspected.
                const version = metadata.generation ? bucket.file(key, { generation: metadata.generation }) : file;
                return { stream: version.createReadStream({ validation: 'crc32c' }), size: Number(metadata.size) };
            },
            async remove(receipt) {
                validateStorageKey(receipt.key);
                const file = bucket.file(receipt.key);
                try {
                    const [metadata] = await file.getMetadata();
                    if (!receipt.uploadId || metadata.metadata?.attachmentUploadId !== receipt.uploadId) {
                        throw storageError('STORAGE_OWNERSHIP_CHANGED', 'Refusing to remove an object not created by this upload');
                    }
                    if (receipt.generation && String(receipt.generation) !== String(metadata.generation)) {
                        throw storageError('STORAGE_OWNERSHIP_CHANGED', 'Refusing to remove a different object generation');
                    }
                    if (!metadata.generation) throw storageError('STORAGE_GENERATION_MISSING', 'Cannot safely remove object without generation');
                    await file.delete({ ifGenerationMatch: metadata.generation });
                } catch (error) { if (!isMissing(error)) throw error; }
            }
        };
    }

    const root = path.resolve(localRoot);
    async function localPath(key, createParent = false) {
        validateStorageKey(key);
        const filename = path.resolve(root, key);
        const parent = path.dirname(filename);
        if (createParent) await fs.promises.mkdir(parent, { recursive: true });
        const [realRoot, realParent] = await Promise.all([fs.promises.realpath(root), fs.promises.realpath(parent)]);
        if (!realParent.startsWith(realRoot + path.sep)) throw storageError('INVALID_STORAGE_KEY', 'Attachment directory escapes storage root');
        return path.join(realParent, path.basename(filename));
    }
    return {
        backend,
        async put(key, buffer, contentType) {
            if (!Buffer.isBuffer(buffer) || !CONTENT_TYPES[contentType]) throw storageError('INVALID_ATTACHMENT', 'Invalid attachment body/type');
            const filename = await localPath(key, true);
            const handle = await fs.promises.open(filename, 'wx', 0o600);
            const stat = await handle.stat();
            try {
                await handle.writeFile(buffer);
                return { backend, key, ino: stat.ino, dev: stat.dev };
            } catch (error) {
                await fs.promises.unlink(filename).catch(() => {});
                throw error;
            } finally { await handle.close(); }
        },
        async open(key) {
            const filename = await localPath(key);
            const handle = await fs.promises.open(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
            try {
                const stat = await handle.stat();
                if (!stat.isFile()) throw storageError('INVALID_STORAGE_KEY', 'Attachment is not a regular file');
                return { stream: handle.createReadStream(), size: stat.size };
            } catch (error) { await handle.close(); throw error; }
        },
        async remove(receipt) {
            try {
                const filename = await localPath(receipt.key);
                const stat = await fs.promises.lstat(filename);
                if (!stat.isFile() || stat.ino !== receipt.ino || stat.dev !== receipt.dev) throw storageError('STORAGE_OWNERSHIP_CHANGED', 'Refusing to remove a replaced local attachment');
                await fs.promises.unlink(filename);
            } catch (error) { if (!isMissing(error)) throw error; }
        }
    };
}

let defaultStorage;
function getAttachmentStorage() { return defaultStorage ||= createAttachmentStorage(); }

async function cleanupAttachments(storage, receipts, logger) {
    const outcomes = await Promise.allSettled(receipts.map(receipt => storage.remove(receipt)));
    outcomes.forEach((outcome, index) => {
        if (outcome.status === 'rejected') logger.warn('附件補償清理未完成，需對帳', { key: receipts[index].key, code: outcome.reason?.code });
    });
}

async function sendAttachment({ storage, row, res, attachmentId, requestId, inline = false, logger }) {
    const { stream, size } = await storage.open(row.storage_key);
    const contentType = CONTENT_TYPES[row.mime_type] ? row.mime_type : 'application/octet-stream';
    const filename = cleanOriginalName(row.original_name) || `attachment-${attachmentId}`;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `${inline && CONTENT_TYPES[row.mime_type] ? 'inline' : 'attachment'}; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (Number.isSafeInteger(size) && size >= 0) res.setHeader('Content-Length', size);
    const onClose = () => stream.destroy();
    res.once('close', onClose);
    stream.once('end', () => res.removeListener('close', onClose));
    stream.once('error', error => {
        res.removeListener('close', onClose);
        logger.error('附件串流中斷', { code: error.code, requestId });
        if (res.headersSent) return res.destroy(error);
        res.removeHeader('Content-Length');
        res.removeHeader('Content-Disposition');
        res.removeHeader('Content-Type');
        res.status(isMissing(error) ? 404 : 502).json({ message: isMissing(error) ? '附件檔案不存在' : '讀取附件失敗', requestId });
    });
    return stream.pipe(res);
}

module.exports = { createAttachmentStorage, getAttachmentStorage, createAttachmentKey, cleanOriginalName, validateStorageKey, isMissing, cleanupAttachments, sendAttachment };
