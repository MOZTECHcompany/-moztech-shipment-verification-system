import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = await readFile(new URL('../src/api/socket.js', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'js', format: 'cjs' });
const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const { code: appCode } = await transform(appSource, { loader: 'jsx', format: 'cjs' });

function transport() {
    const calls = [], listeners = new Map();
    let options;
    const socket = {
        connected: false,
        on: (name, callback) => { listeners.set(name, callback); },
        off: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); },
        connect() { options.auth(auth => calls.push({ action: 'connect', auth })); socket.connected = true; },
        disconnect() { calls.push({ action: 'disconnect' }); socket.connected = false; },
    };
    const module = { exports: {} };
    vm.runInNewContext(code, { module, exports: module.exports, console, require: name => name === 'socket.io-client' ? { io: (_url, config) => { options = config; return socket; } } : { API_ORIGIN: 'https://api.example.invalid' } });
    return { ...module.exports, calls, listeners, options: () => options };
}

test('socket never auto connects and handshake does not contain user/role claims', () => {
    const transportState = transport();
    assert.equal(transportState.options().autoConnect, false);
    assert.deepEqual(transportState.calls, []);
    transportState.setSocketSession('token-A');
    assert.deepEqual(JSON.parse(JSON.stringify(transportState.calls.at(-1))), { action: 'connect', auth: { token: 'token-A' } });
});

test('account switch and refreshed token disconnect the old transport and authenticate with the new token', () => {
    const state = transport();
    state.setSocketSession('token-A');
    state.setSocketSession('token-B');
    assert.deepEqual(state.calls.map(value => value.action), ['disconnect', 'connect', 'disconnect', 'connect']);
    assert.equal(state.calls.at(-1).auth.token, 'token-B');
    state.socket.connected = false;
    state.socket.connect();
    assert.equal(state.calls.at(-1).auth.token, 'token-B');
});

test('logout clears auth and stops reconnects; a later login uses only its own token', () => {
    const state = transport();
    state.setSocketSession('token-A');
    state.setSocketSession(null);
    assert.equal(state.socket.connected, false);
    state.options().auth(auth => assert.deepEqual(Object.keys(auth), []));
    const count = state.calls.filter(call => call.action === 'connect').length;
    state.setSocketSession('');
    assert.equal(state.calls.filter(call => call.action === 'connect').length, count);
    state.setSocketSession('token-C');
    assert.equal(state.calls.at(-1).auth.token, 'token-C');
});

test('planned server drain reconnects with current credentials but logout cannot restart it', () => {
    const state = transport();
    state.setSocketSession('token-A');
    state.socket.connected = false;
    state.listeners.get('disconnect')('io server disconnect');
    assert.equal(state.calls.at(-1).auth.token, 'token-A');
    state.setSocketSession(null);
    const count = state.calls.filter(call => call.action === 'connect').length;
    state.listeners.get('disconnect')('io server disconnect');
    assert.equal(state.calls.filter(call => call.action === 'connect').length, count);
});

function app() {
    const state = transport();
    const auth = { user: { id: 7, role: 'admin' }, token: 'token-A' };
    const hooks = [], effects = [], notices = [], soundUsers = [];
    let cursor = 0, tree;
    const api = { defaults: { headers: { common: {} } } };
    const setters = { user: value => { auth.user = value; }, token: value => { auth.token = value; } };
    const react = {
        createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
        lazy: () => 'Lazy',
        useEffect(callback, deps) {
            const index = cursor++;
            if (!hooks[index] || !deps.every((value, i) => Object.is(value, hooks[index].deps[i]))) {
                const cleanup = hooks[index]?.cleanup;
                hooks[index] = { deps };
                effects.push(() => { cleanup?.(); hooks[index].cleanup = callback(); });
            }
        }
    };
    const imports = {
        react,
        './api/api': api,
        './api/socket': state,
        './utils/soundNotification': { setUser: id => soundUsers.push(id ?? null) },
        './hooks/useLocalStorage': { useLocalStorage: key => key === 'wms_token' ? [auth.token, setters.token] : [auth.user, setters.user] },
        sonner: { Toaster: 'Toaster', toast: { error: value => notices.push(value) } },
    };
    const generic = new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) });
    const module = { exports: {} };
    vm.runInNewContext(appCode, { module, exports: module.exports, require: name => imports[name] || generic, React: react });
    function render() { cursor = 0; tree = module.exports.default(); while (effects.length) effects.shift()(); return tree; }
    function find(node, key) {
        if (!node || typeof node !== 'object') return undefined;
        if (typeof node.props?.[key] === 'function') return node.props[key];
        for (const child of [...(node.props?.children || []).flat(Infinity), node.props?.element]) { const result = find(child, key); if (result) return result; }
    }
    render();
    return { state, auth, api, notices, soundUsers, render, callback: key => find(tree, key), unmount: () => hooks.forEach(hook => hook.cleanup?.()) };
}

test('real App callbacks update HTTP and Socket credentials on login/logout and clean up on unmount', () => {
    const view = app();
    assert.equal(view.soundUsers.at(-1), 7);
    assert.equal(view.api.defaults.headers.common.Authorization, 'Bearer token-A');
    view.callback('onLogout')();
    assert.equal(view.soundUsers.at(-1), null);
    assert.equal(view.state.socket.connected, false);
    view.render();
    assert.equal(view.api.defaults.headers.common.Authorization, undefined);
    view.callback('onLogin')({ accessToken: 'token-B', user: { id: 8, role: 'picker' } });
    view.render();
    assert.equal(view.state.calls.at(-1).auth.token, 'token-B');
    view.unmount();
    assert.equal(view.state.socket.connected, false);
});

test('revoked/expired sessions require login, while transient auth service failure preserves the user session', () => {
    const view = app();
    view.state.listeners.get('connect_error')({ data: { code: 'SOCKET_AUTH_UNAVAILABLE' } });
    assert.equal(view.auth.token, 'token-A');
    view.state.listeners.get('session_expired')();
    view.render();
    assert.equal(view.auth.user, null);
    assert.equal(view.auth.token, null);
    assert.equal(view.state.socket.connected, false);
    assert.match(view.notices[0], /重新登入/);
});

test('comment panels cannot reconnect an unauthenticated transport outside App lifecycle', async () => {
    for (const filename of ['TaskComments.jsx', 'TaskComments-modern.jsx', 'FloatingChatPanel.jsx']) {
        const content = await readFile(new URL(`../src/components/${filename}`, import.meta.url), 'utf8');
        assert.doesNotMatch(content, /socket\.connect\s*\(/);
    }
});
