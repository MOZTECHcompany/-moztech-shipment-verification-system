import test from 'node:test';
import assert from 'node:assert/strict';
import { createClaimScanController, claimStageForRole } from '../src/utils/claimScan.js';

function fixture({ storage = new Map(), acquire = () => true, isCurrentActor = () => true } = {}) {
    const posts = [], reads = [], successes = [], states = [];
    let uuidCount = 0, releases = 0;
    const deferred = (bucket, args) => new Promise((resolve, reject) => bucket.push({ ...args, resolve, reject }));
    const api = { post: (url, body) => deferred(posts, { url, body }), get: url => deferred(reads, { url }) };
    const controller = createClaimScanController({ api, userId: 7, acquire, isCurrentActor,
        storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
        newCommandId: () => `00000000-0000-4000-8000-${String(++uuidCount).padStart(12, '0')}`,
        release: () => { releases++; }, onState: state => states.push(state), onSuccess: result => successes.push(result) });
    const success = (request, overrides = {}) => request.resolve({ data: { commandId: request.body?.commandId || JSON.parse(storage.values().next().value).commandId, orderId: 12, stage: 'pick', outcome: 'claimed', owner: { id: 7, name: 'Test' }, ...overrides } });
    return { controller, posts, reads, storage, states, successes, success, releases: () => releases, uuidCount: () => uuidCount };
}
const rejectKnown = request => request.reject({ response: { status: 409, data: { code: 'CLAIM_NOT_APPLIED', message: '由其他人認領' } } });
const miss = request => request.reject({ response: { status: 404, data: { code: 'CLAIM_RECEIPT_NOT_FOUND' } } });

test('roles require explicit admin stage and never infer packing for administrators', () => {
    assert.equal(claimStageForRole('picker', 'pack'), 'pick');
    assert.equal(claimStageForRole('packer', 'pick'), 'pack');
    assert.equal(claimStageForRole('admin'), '');
    assert.equal(claimStageForRole('superadmin', 'pack'), 'pack');
    assert.equal(claimStageForRole('dispatcher', 'pick'), '');
});
test('exact scanned value claims only once while in flight and binds no client-supplied owner', async () => {
    const f = fixture();
    const pending = f.controller.submit(' WT000000000000000001 ', 'pick');
    assert.equal(await f.controller.submit('WT000000000000000002', 'pack'), false);
    assert.equal(f.posts.length, 1);
    assert.equal(f.posts[0].url, '/api/orders/claim-by-barcode');
    assert.deepEqual(Object.keys(f.posts[0].body).sort(), ['barcode', 'commandId', 'expectedActorId', 'stage']);
    assert.equal(f.posts[0].body.barcode, 'WT000000000000000001');
    assert.equal(f.controller.isLocked(), true);
    f.success(f.posts[0]); await pending;
    assert.equal(f.controller.isLocked(), false); assert.equal(f.storage.size, 0); assert.equal(f.successes.length, 1);
});
test('missing stage and manual claim exclusion never send a request', async () => {
    const f = fixture({ acquire: () => false });
    await f.controller.submit('WT01', ''); await f.controller.submit('WT01', 'pick');
    assert.equal(f.posts.length, 0); assert.equal(f.storage.size, 0);
});
test('known not-applied failure releases the claim gate but malformed success remains unknown', async () => {
    const f = fixture(); let pending = f.controller.submit('WT01', 'pick'); rejectKnown(f.posts[0]); await pending;
    assert.equal(f.controller.isLocked(), false); assert.equal(f.controller.getState().phase, 'error');
    pending = f.controller.submit('WT01', 'pick'); f.success(f.posts[1], { owner: { id: 99 } }); await pending;
    assert.equal(f.controller.getState().phase, 'unknown'); assert.equal(f.controller.isLocked(), true);
    assert.equal(f.successes.length, 0); assert.equal(f.releases(), 1);
});
test('unknown result survives reload; receipt recovery is read-only and does not replay the mutation', async () => {
    const f = fixture(); const pending = f.controller.submit('WT01', 'pick'); f.posts[0].reject(new Error('timeout')); await pending;
    assert.equal(await f.controller.submit('WT02', 'pick'), false);
    const restored = fixture({ storage: f.storage });
    assert.equal(restored.controller.getState().phase, 'unknown');
    const recovery = restored.controller.recover();
    assert.equal(restored.posts.length, 0); assert.equal(restored.reads[0].url, `/api/orders/claim-commands/${f.posts[0].body.commandId}?expectedActorId=7`);
    restored.success(restored.reads[0]); await recovery;
    assert.equal(restored.successes.length, 1); assert.equal(restored.storage.size, 0);
});
test('receipt 404 stays locked and only explicit retry reuses byte-identical UUID/barcode/stage', async () => {
    const f = fixture(); const pending = f.controller.submit('WT01', 'pick'); f.posts[0].reject(new Error('timeout')); await pending;
    await f.controller.retrySame(); assert.equal(f.posts.length, 1);
    const recovery = f.controller.recover(); miss(f.reads[0]); await recovery;
    assert.equal(f.controller.isLocked(), true); assert.equal(f.controller.getState().canRetry, true);
    const retry = f.controller.retrySame(); assert.equal(f.posts.length, 2); assert.deepEqual(f.posts[1].body, f.posts[0].body);
    f.success(f.posts[1], { outcome: 'continued' }); await retry;
    assert.equal(f.uuidCount(), 1); assert.equal(f.successes.length, 1);
});
test('receipt recovery transport failures never unlock or offer a new claim', async () => {
    const f = fixture(); const pending = f.controller.submit('WT01', 'pack'); f.posts[0].reject(new Error('timeout')); await pending;
    const recovery = f.controller.recover(); f.reads[0].reject(new Error('offline')); await recovery;
    assert.equal(f.controller.getState().canRetry, false); assert.equal(f.controller.isLocked(), true);
    assert.equal(await f.controller.submit('WT02', 'pick'), false);
});


test('a changed session cannot submit or recover under another actor and preserves pending original command', async () => {
    let current = true;
    const f = fixture({ isCurrentActor: () => current });
    const pending = f.controller.submit('WT01', 'pick');
    assert.equal(f.posts[0].body.expectedActorId, 7);
    f.posts[0].reject(new Error('timeout')); await pending;
    current = false;
    await f.controller.recover(); await f.controller.retrySame();
    assert.equal(f.reads.length, 0); assert.equal(f.posts.length, 1);
    assert.equal(f.controller.isLocked(), true); assert.equal(JSON.parse(f.storage.values().next().value).expectedActorId, 7);
    const clean = fixture({ isCurrentActor: () => false });
    await clean.controller.submit('WT02', 'pick'); assert.equal(clean.posts.length, 0);
});

test('server session-change guard during same-command retry cannot erase an uncertain original claim', async () => {
    const f = fixture(); const pending = f.controller.submit('WT01', 'pick'); f.posts[0].reject(new Error('timeout')); await pending;
    const recovery = f.controller.recover(); miss(f.reads[0]); await recovery;
    const retry = f.controller.retrySame();
    f.posts[1].reject({ response: { status: 409, data: { code: 'CLAIM_NOT_APPLIED', reason: 'SESSION_CHANGED', message: '帳號已變更' } } }); await retry;
    assert.equal(f.controller.getState().phase, 'unknown'); assert.equal(f.controller.isLocked(), true); assert.equal(f.storage.size, 1);
});


test('busy same-command retry after receipt 404 retains the gate until the original commit can be recovered', async () => {
    const f = fixture();
    const pending = f.controller.submit('WT01', 'pick');
    f.posts[0].reject(new Error('client timeout while server still holds the command lock')); await pending;
    const missing = f.controller.recover(); miss(f.reads[0]); await missing;
    const retry = f.controller.retrySame();
    f.posts[1].reject({ response: { status: 409, data: { code: 'CLAIM_NOT_APPLIED', reason: 'BUSY', message: '鎖尚未釋放' } } }); await retry;
    assert.equal(f.controller.isLocked(), true); assert.equal(f.controller.getState().phase, 'unknown');
    assert.equal(await f.controller.submit('WT02', 'pick'), false); assert.equal(f.posts.length, 2);
    const recovery = f.controller.recover(); f.success(f.reads[1]); await recovery;
    assert.equal(f.controller.isLocked(), false); assert.equal(f.successes.length, 1); assert.equal(f.uuidCount(), 1);
});

test('any unconfirmed retry failure preserves the original identity until a receipt confirms its outcome', async () => {
    for (const reason of ['FAILED', 'NOT_FOUND', 'INVALID_STAGE', 'COMMAND_REUSED']) {
        const f = fixture(); const pending = f.controller.submit('WT01', 'pick'); f.posts[0].reject(new Error('timeout')); await pending;
        const recovery = f.controller.recover(); miss(f.reads[0]); await recovery;
        const retry = f.controller.retrySame();
        f.posts[1].reject({ response: { status: 409, data: { code: 'CLAIM_NOT_APPLIED', reason } } }); await retry;
        assert.equal(f.controller.isLocked(), true, reason); assert.equal(f.storage.size, 1, reason);
    }
});

const rejectedReceipt = (command, overrides = {}) => ({ ...command, outcome: 'rejected', definitive: true, code: 'CLAIM_NOT_APPLIED', reason: 'OWNED_BY_OTHER', message: '原認領已確認拒絕', httpStatus: 409, ...overrides });
test('a canonical rejected GET receipt clears only its matching unknown command and allows the next work order', async () => {
    const f = fixture(); const pending = f.controller.submit('WT01', 'pick'); f.posts[0].reject(new Error('timeout')); await pending;
    const recovery = f.controller.recover(); f.reads[0].resolve({ data: rejectedReceipt(f.posts[0].body) }); await recovery;
    assert.equal(f.controller.isLocked(), false); assert.equal(f.storage.size, 0);
    assert.equal(f.controller.getState().phase, 'error'); assert.equal(f.successes.length, 0);
    const next = f.controller.submit('WT02', 'pick');
    assert.equal(f.posts.length, 2); assert.notEqual(f.posts[1].body.commandId, f.posts[0].body.commandId);
    f.success(f.posts[1]); await next;
});
test('a persisted rejection on same-command retry is definitive while a mismatched negative receipt cannot release the gate', async () => {
    for (const overrides of [{}, { stage: 'pack' }, { expectedActorId: 99 }, { commandId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }]) {
        const f = fixture(); const pending = f.controller.submit('WT01', 'pick'); f.posts[0].reject(new Error('timeout')); await pending;
        const lookup = f.controller.recover(); miss(f.reads[0]); await lookup;
        const retry = f.controller.retrySame();
        f.posts[1].reject({ response: { status: 409, data: rejectedReceipt(f.posts[0].body, overrides) } }); await retry;
        assert.equal(f.controller.isLocked(), Object.keys(overrides).length > 0);
        assert.equal(f.successes.length, 0);
    }
});
