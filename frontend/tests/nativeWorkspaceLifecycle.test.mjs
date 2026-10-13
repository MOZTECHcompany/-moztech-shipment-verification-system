import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import * as contract from '../src/workspace/contract.mjs';

const source = await readFile(new URL('../src/workspace/index.jsx', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'jsx', format: 'cjs', define: { 'import.meta.env.VITE_SOURCE_COMMIT': '"development"' } });
const manifest = { version: 1, entry: '/assets/workspace-hash.js', styles: ['/assets/shadow-hash.css'], portalStyles: ['/assets/portal-hash.css'], sourceCommit: 'development' };
function fixture(failStyles = false) {
    const events = [], values = new Map(), nodes = [];
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    function node(tag) {
        const value = { tag, childNodes: [], appendChild(child) { child.parent = value; value.childNodes.push(child); if (child.tag === 'link' && failStyles !== 'pending') queueMicrotask(() => failStyles ? child.onerror?.() : child.onload?.()); return child; },
            remove() { if (value.parent) value.parent.childNodes.splice(value.parent.childNodes.indexOf(value), 1); },
            attachShadow() { return value.shadowRoot = node('shadow'); } };
        nodes.push(value); return value;
    }
    const document = { createElement: node, head: node('head'), body: node('body') }, container = node('container');
    const react = { createElement: (type, props, ...children) => ({ type, props, children }) };
    let tree, runtime;
    const api = { defaults: { headers: { common: {} } } };
    const imports = {
        react,
        'react-dom/client': { createRoot: () => ({ render(value) { tree = value; events.push('render'); }, unmount() { events.push('unmount'); } }) },
        '@tanstack/react-query': { QueryClientProvider: 'Provider' }, '../App': 'App',
        '../api/api': { __esModule: true, default: api, configureWorkspaceTransport() { events.push('transport'); return () => events.push('transport-disposed'); } },
        '../api/socket': { initializeSocketOrigin(origin) { events.push(['socket-origin', origin]); }, setSocketSession(token) { events.push(['socket-token', token]); } },
        '../api/queryClient': { queryClient: { clear() { events.push('cache-clear'); } } },
        '../utils/soundNotification': { setUser(id) { events.push(['sound', id]); } },
        './nativeRuntime': { installNativeRuntime(options) { runtime = options; events.push('runtime'); return () => events.push('runtime-disposed'); } },
        './contract.mjs': contract, '../index.css': {},
    };
    const module = { exports: {} };
    vm.runInNewContext(code, { module, exports: module.exports, document, sessionStorage: storage, URL, DOMException, console, setTimeout: () => 1, clearTimeout() {}, require: name => imports[name] });
    const options = { manifest, assetOrigin: 'https://wms.example', socketOrigin: 'https://wms.example', initialPath: '/tasks',
        session: { accessToken: 'token-A', user: { id: 7, role: 'picker', erpSubject: 'erp-user', entityId: 'company' } }, transport: async () => ({ status: 200, data: {} }) };
    return { ...module.exports, container, document, storage, options, events, tree: () => tree, runtime: () => runtime, loadStyles: () => nodes.filter(item => item.tag === 'link').forEach(link => link.onload?.()) };
}
test('mount installs shadow and owned scoped portal, configures session/transport/socket before render, and disposes all resources', async () => {
    const f = fixture(), handle = await f.mountWorkspace(f.container, f.options);
    assert.deepEqual(f.events.slice(0, 4), ['runtime', 'transport', ['socket-origin', 'https://wms.example'], 'render']);
    assert.equal(f.runtime().workspaceRoot, f.container.shadowRoot);
    assert.equal(f.runtime().portalTarget.parent.className, 'wms-native-portal');
    assert.equal(f.document.head.childNodes.length, 1); assert.equal(f.document.body.childNodes.length, 1);
    assert.equal(f.runtime().isSessionCurrent(), true);
    await assert.rejects(f.mountWorkspace(f.container, f.options), /Only one/);
    handle.dispose(); handle.dispose();
    assert.equal(f.runtime().isSessionCurrent(), false); assert.equal(f.storage.getItem('wms_token'), null);
    assert.equal(f.document.head.childNodes.length, 0); assert.equal(f.document.body.childNodes.length, 0); assert.equal(f.container.shadowRoot.childNodes.length, 0);
    assert.equal(f.events.filter(event => event === 'unmount').length, 1);
    assert.ok(f.events.includes('transport-disposed')); assert.ok(f.events.includes('runtime-disposed')); assert.ok(f.events.includes('cache-clear'));
    const second = await f.mountWorkspace(f.container, f.options); second.dispose();
});
test('memory navigation preserves replace/push, skips initial notification and suppresses browser-back restoration echoes', async () => {
    const f = fixture(), changes = [], commands = [];
    const handle = await f.mountWorkspace(f.container, { ...f.options, navigate: (...args) => changes.push(args) });
    const host = f.tree().children[0].props.host;
    host.onNavigate('/tasks', { replace: true }); assert.equal(changes.length, 0);
    host.registerNavigate((...args) => commands.push(args));
    host.onNavigate('/order/31', { replace: false });
    assert.deepEqual(changes, [['/order/31', { replace: false }]]);
    handle.navigate('/tasks?group=pick', { replace: true });
    assert.equal(commands[0][0], '/tasks?group=pick'); assert.equal(commands[0][1].replace, true);
    host.onNavigate('/tasks?group=pick', { replace: true }); assert.equal(changes.length, 1);
    assert.equal(f.runtime().getPath(), '/tasks?group=pick');
    handle.dispose(); handle.navigate('/order/32'); assert.equal(commands.length, 1);
});
test('expired auth disables the workspace session and reports once without navigating the ERP browser', async () => {
    const f = fixture(), auth = [];
    const handle = await f.mountWorkspace(f.container, { ...f.options, onAuthRequired: reason => auth.push(reason) });
    const host = f.tree().children[0].props.host;
    host.onAuthRequired({ code: 'SOCKET_AUTH_REQUIRED' }); host.onAuthRequired({ code: 'SOCKET_AUTH_REQUIRED' });
    assert.equal(auth.length, 1); assert.equal(f.runtime().isSessionCurrent(), false); assert.equal(f.storage.getItem('wms_token'), null);
    handle.dispose();
});
test('stylesheet failure leaves no native session, portal, or stale mount lease', async () => {
    const f = fixture(true);
    await assert.rejects(f.mountWorkspace(f.container, f.options), /stylesheet/);
    assert.equal(f.storage.getItem('wms_token'), null); assert.equal(f.document.body.childNodes.length, 0); assert.equal(f.document.head.childNodes.length, 0);
    assert.equal(f.container.shadowRoot.childNodes.length, 0); assert.equal(f.events.includes('render'), false);
    await assert.rejects(f.mountWorkspace(f.container, f.options), /stylesheet/);
});
test('actor change aborts pending bootstrap synchronously, permits next mount and cannot render or seed the old session late', async () => {
    const f = fixture('pending'), controller = new AbortController();
    const first = f.mountWorkspace(f.container, { ...f.options, signal: controller.signal });
    controller.abort();
    assert.equal(f.document.head.childNodes.length, 0); assert.equal(f.container.shadowRoot.childNodes.length, 0);
    assert.equal(f.storage.getItem('wms_token'), null);
    const second = f.mountWorkspace(f.container, { ...f.options, session: { ...f.options.session, user: { ...f.options.session.user, id: 8 }, accessToken: 'token-B' } });
    await assert.rejects(first, error => error.name === 'AbortError');
    f.loadStyles();
    const handle = await second;
    assert.equal(f.storage.getItem('wms_token'), JSON.stringify('token-B')); assert.equal(f.events.filter(event => event === 'render').length, 1);
    handle.dispose();
});
