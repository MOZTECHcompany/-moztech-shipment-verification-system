import test from 'node:test';
import assert from 'node:assert/strict';
import { isCartonScan, applyCartonResponse, sendCartonCommand, makeCartonCommand, cartonSessionKey } from '../src/utils/cartonScan.js';

const previous = 'a'.repeat(64), next = 'b'.repeat(64);
const snapshot = { order: { id: 7 }, items: [], instances: [], stateToken: previous };
test('carton QR and existing carton labels resolve separately from ordinary product and SN codes', () => {
    assert.equal(isCartonScan('CARTON:BOX-A'), true);
    assert.equal(isCartonScan('CTN-261012-ABC-001'), true);
    assert.equal(isCartonScan('SN01,SN02'), true);
    assert.equal(isCartonScan('04711299273087'), false);
    assert.equal(isCartonScan('SN01'), false);
});
test('bulk snapshot cannot update a different order or an out of date local snapshot', () => {
    const result = { ...snapshot, format: 'snapshot-v1', baseState: previous, stateToken: next };
    assert.deepEqual(applyCartonResponse(snapshot, result).stateToken, next);
    assert.throws(() => applyCartonResponse(snapshot, { ...result, order: { id: 8 } }));
    assert.throws(() => applyCartonResponse(snapshot, { ...result, baseState: 'c'.repeat(64) }));
    assert.throws(() => makeCartonCommand({ expectedState: previous, expectedCartonRevision: null }, {}));
});
test('an uncertain response retries with identical command; conflicts do not retry', async () => {
    const calls = [], command = { commandId: 'same', scanValue: 'CARTON:A' };
    const api = { post: async (url, body) => { calls.push({ url, body }); if (calls.length === 1) throw new Error('connection lost'); return { data: 'receipt' }; } };
    assert.equal((await sendCartonCommand(api, 7, command)).data, 'receipt');
    assert.equal(calls.length, 2); assert.strictEqual(calls[0].body, calls[1].body);
    let conflicts = 0;
    await assert.rejects(sendCartonCommand({ post: async () => { conflicts++; throw { response: { status: 409 } }; } }, 7, command));
    assert.equal(conflicts, 1);
});
test('account/token change during an uncertain response never retries under the replacement login', async () => {
    let session = 'old-session', sends = 0;
    const api = { getSessionIdentity: () => session, post: async () => { sends++; session = 'new-session'; throw new Error('connection lost'); } };
    await assert.rejects(sendCartonCommand(api, 7, { commandId: 'same' }), error => error.code === 'SESSION_CHANGED');
    assert.equal(sends, 1);
});
test('same-account capability changes invalidate pending carton reads and previews', () => {
    const api = { getSessionIdentity: () => 'same-token' };
    const user = { id: 2, role: 'picker', management_scope: 'all', can_pick: null, can_pack: null, work_types: ['pick','pack'] };
    const key = cartonSessionKey(api, user);
    assert.notEqual(cartonSessionKey(api, { ...user, can_pick: false }), key);
    assert.notEqual(cartonSessionKey(api, { ...user, can_pack: false }), key);
    assert.notEqual(cartonSessionKey(api, { ...user, work_types: ['pick'] }), key);
    assert.equal(cartonSessionKey(api, { ...user }), key);
});
