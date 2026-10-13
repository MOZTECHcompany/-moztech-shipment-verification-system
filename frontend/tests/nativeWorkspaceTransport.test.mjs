import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import axios from 'axios';

const source = await readFile(new URL('../src/api/api.js', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'js', format: 'cjs' });
function fixture() {
    const module = { exports: {} };
    const values = new Map([['wms_token', JSON.stringify('token-A')], ['wms_user', JSON.stringify({ id: 7, role: 'dispatcher' })]]);
    vm.runInNewContext(code, { module, exports: module.exports, AbortController, console, sessionStorage: { getItem: key => values.get(key) },
        require: name => name === 'axios' ? axios : name === './origin' ? { API_ORIGIN: '' } : name === 'sonner' ? { toast: { error() {} } } : { captureException() {} } });
    return module.exports;
}
test('native adapter preserves transformed mutation body, original credentials, response and no automatic retry', async () => {
    const { default: api, configureWorkspaceTransport } = fixture();
    const calls = [];
    const restore = configureWorkspaceTransport(async config => { calls.push(config); return { status: 201, data: { commandId: 'original', ok: true }, headers: { 'x-request-id': 'req' } }; });
    const response = await api.post('/api/orders/update_item', { commandId: 'original', expectedState: 'state', amount: 1 });
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].data), { commandId: 'original', expectedState: 'state', amount: 1 });
    assert.equal(calls[0].headers.Authorization, 'Bearer token-A');
    assert.equal(response.status, 201); assert.equal(response.data.commandId, 'original');
    restore();
});
test('native mutation failure is reported once with upstream status and message', async () => {
    const { default: api, configureWorkspaceTransport } = fixture(); let calls = 0;
    const restore = configureWorkspaceTransport(async () => { calls++; return { status: 409, data: { code: 'SCAN_NOT_APPLIED', message: 'State changed' } }; });
    await assert.rejects(api.post('/api/orders/update_item', { commandId: 'original' }), error => error.response.status === 409 && error.message === 'State changed');
    assert.equal(calls, 1); restore();
});
test('session change prevents dispatch and suppresses stale response; disposal aborts in-flight requests and restores adapter', async () => {
    const { default: api, configureWorkspaceTransport } = fixture(); const original = api.defaults.adapter;
    let current = false, resolveRequest, signal, calls = 0;
    const restore = configureWorkspaceTransport(config => { calls++; signal = config.signal; return new Promise(resolve => { resolveRequest = resolve; }); }, { isCurrentSession: () => current });
    await assert.rejects(api.get('/api/tasks'), axios.isCancel); assert.equal(calls, 0);
    current = true;
    const request = api.get('/api/tasks'); await new Promise(resolve => setImmediate(resolve));
    restore(); assert.equal(signal.aborted, true); assert.equal(api.defaults.adapter, original);
    resolveRequest({ status: 200, data: { tasks: ['stale'] } });
    await assert.rejects(request, axios.isCancel);
});
test('adapter rejects absolute or outside-WMS paths before calling the host', async () => {
    const { default: api, configureWorkspaceTransport } = fixture(); let calls = 0;
    const restore = configureWorkspaceTransport(async () => { calls++; return { status: 200, data: {} }; });
    for (const path of ['https://elsewhere.test/api/tasks', '/health', '//elsewhere.test/api/tasks']) await assert.rejects(api.get(path), /WMS API path/);
    assert.equal(calls, 0); restore();
});
