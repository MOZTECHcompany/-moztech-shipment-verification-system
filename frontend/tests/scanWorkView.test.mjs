import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { createScanSubmission } from '../src/utils/scanSubmission.js';
import * as orderWorkProgress from '../src/utils/orderWorkProgress.js';
import * as scanDelta from '../src/utils/scanDelta.js';

const source = await readFile(new URL('../src/components/OrderWorkView.jsx', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'jsx', format: 'cjs' });

// Execute the real component event handlers with controlled hooks and transport.
// Child components and DOM rendering are omitted; no application server is started.
function workView({ role = 'picker', deferRead = false, initialData } = {}) {
    const order = { id: 1, status: role === 'picker' ? 'picking' : 'packing', picker_id: 1, packer_id: 1 };
    const fixture = initialData || { order, items: [{ id: 11, quantity: 100, picked_quantity: 0, packed_quantity: 0, barcode: 'ITEM' }], instances: [] };
    const states = [fixture, false, ''];
    const refs = [];
    const effects = [];
    let stateCursor = 0;
    let refCursor = 0;
    const sounds = [];
    const warnings = [];
    const posts = [];
    const reads = [];
    const listeners = new Map();
    const offCalls = [];
    const react = {
        createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
        useState(initial) {
            const i = stateCursor++;
            if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
            return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }];
        },
        useRef(initial) { const i = refCursor++; return refs[i] ||= { current: initial }; },
        useEffect: callback => { effects.push(callback); },
        useCallback: callback => callback,
        useMemo: callback => callback()
    };
    const noop = () => {};
    const api = {
        post(url, body, options) {
            if (url.endsWith('/session')) return Promise.resolve({});
            let resolve, reject;
            const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
            posts.push({ url, body, options, resolve, reject });
            return promise;
        },
        get: url => {
            if (!deferRead || url !== '/api/orders/1/work-snapshot') return Promise.resolve({ data: fixture });
            let resolve;
            const pending = new Promise(done => { resolve = done; });
            reads.push({ resolve });
            return pending;
        }
    };
    const socket = {
        on: (name, callback) => listeners.set(name, callback),
        off: (name, callback) => { offCalls.push([name, callback]); }
    };
    const imports = {
        react,
        'react-router-dom': { useParams: () => ({ orderId: '1' }), useNavigate: () => noop },
        sonner: { toast: { warning: (...args) => warnings.push(args), error: noop, success: noop, info: noop } },
        '@/api/api': api,
        '@/api/socket': { socket },
        '@/utils/scanSubmission': { createScanSubmission },
        '@/utils/orderWorkProgress': orderWorkProgress,
        '@/utils/scanDelta': scanDelta,
        '@/utils/soundNotification': { play: sound => sounds.push(sound) },
        '@/utils/voiceNotification': { speakScanSuccess: noop, speakScanError: noop, speakOperationError: noop },
        '@/utils/desktopNotification': { notifyScanError: noop },
        'sweetalert2-react-content': () => ({ fire: () => Promise.resolve({}) })
    };
    const generic = new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) });
    const module = { exports: {} };
    vm.runInNewContext(code, {
        module, exports: module.exports, require: name => imports[name] || generic,
        setTimeout: noop, setInterval: () => 1, clearInterval: noop,
        navigator: {}, console, window: { location: { reload: noop } }
    });
    function render() {
        stateCursor = 0; refCursor = 0; effects.length = 0;
        const shell = module.exports.OrderWorkView({ user: { id: 1, role } });
        return typeof shell.type === 'function' ? shell.type(shell.props) : shell;
    }
    function find(tree, predicate) {
        if (!tree || typeof tree !== 'object') return;
        if (predicate(tree)) return tree;
        for (const child of (tree.props?.children || []).flat(Infinity)) {
            const found = find(child, predicate);
            if (found) return found;
        }
    }
    const input = () => find(render(), node => node.type === 'input' && node.props.onKeyDown);
    const type = text => input().props.onChange({ target: { value: text } });
    const enter = () => input().props.onKeyDown({ key: 'Enter', preventDefault: noop });
    const camera = () => find(render(), node => node.type === 'CameraScanner');
    return { find, fixture, posts, reads, sounds, warnings, type, enter, input, render, camera, effects, listeners, offCalls, currentData: () => states[0] };
}

const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('busy scanner Enter clears its buffer and keeps an explicit retry outside the input', async () => {
    const view = workView();
    view.type('FIRST'); view.enter();
    view.type('SECOND'); view.enter();
    await settle();
    assert.equal(view.posts.length, 1);
    assert.equal(view.posts[0].body.scanValue, 'FIRST');
    assert.equal(view.input().props.value, '');
    assert.equal(view.warnings.length, 1);
    assert.deepEqual(view.sounds, ['error']);
    view.posts[0].resolve({ data: view.fixture });
    await settle();
    assert.equal(view.input().props.value, '');
    assert.deepEqual(view.sounds, ['error', 'pickSuccess']);
    const retry = view.find(view.render(), node => node.type === 'button' && node.props.children.includes('重新送出這筆條碼'));
    retry.props.onClick();
    await settle();
    assert.equal(view.posts.length, 2);
    assert.equal(view.posts[1].body.scanValue, 'SECOND');
    view.posts[1].resolve({ data: view.fixture });
    await settle();
});

test('camera sends its decoded value directly and packing sound waits for server acceptance', async () => {
    const view = workView({ role: 'packer' });
    view.type('OLD-KEYBOARD');
    // CameraScanner is conditionally shown by the real dashboard callback.
    const tree = view.render();
    const find = node => {
        if (node?.props?.onOpenCamera) return node;
        for (const child of (node?.props?.children || []).flat(Infinity)) { const hit = find(child); if (hit) return hit; }
    };
    find(tree).props.onOpenCamera();
    const camera = view.camera();
    assert.equal(camera.props.onScan('NEW-CAMERA'), true);
    await settle();
    assert.equal(view.posts[0].body.scanValue, 'NEW-CAMERA');
    assert.equal(view.input().props.value, 'OLD-KEYBOARD');
    assert.deepEqual(view.sounds, []);
    view.posts[0].resolve({ data: view.fixture });
    await settle();
    assert.deepEqual(view.sounds, ['packSuccess']);
});

test('unknown network result retains evidence outside the input and prevents further typing or replay', async () => {
    const view = workView();
    view.type('UNCERTAIN'); view.enter();
    await settle();
    assert.equal(view.posts[0].options.timeout, 15000);
    view.posts[0].reject(new Error('timeout'));
    await settle();
    assert.equal(view.input().props.value, '');
    assert.equal(view.input().props.readOnly, true);
    view.type('NEXT');
    assert.equal(view.input().props.value, '');
    assert.deepEqual(view.sounds, ['error']);
    view.enter();
    await settle();
    assert.equal(view.posts.length, 1);
});

test('socket cleanup removes only the exact handlers installed by this view', () => {
    const view = workView();
    view.render();
    const collaborationEffect = view.effects.find(callback => callback.toString().includes('active_sessions_update'));
    const cleanup = collaborationEffect();
    cleanup();
    assert.equal(view.offCalls.length, 5);
    for (const [name, callback] of view.offCalls) assert.equal(callback, view.listeners.get(name));
});


test('an older order GET cannot overwrite the accepted scan snapshot', async () => {
    const view = workView({ deferRead: true });
    view.render();
    const loadEffect = view.effects.find(callback => callback.toString().includes('fetchOrderDetails(orderId)') && !callback.toString().includes('active_sessions_update'));
    loadEffect();
    assert.equal(view.reads.length, 1);
    view.type('ITEM'); view.enter();
    await settle();
    const accepted = structuredClone(view.fixture);
    accepted.items[0].picked_quantity = 1;
    view.posts[0].resolve({ data: accepted });
    await settle();
    view.reads[0].resolve({ data: view.fixture });
    await settle();
    assert.equal(view.currentData().items[0].picked_quantity, 1);
});


test('confirmed rollback clears the rejected input so scanner keystrokes can immediately retry', async () => {
    const view = workView();
    view.type('WRONG'); view.enter();
    await settle();
    view.posts[0].reject({ response: { status: 500, data: { code: 'SCAN_NOT_APPLIED', message: '條碼不屬於此訂單' } } });
    await settle();
    assert.equal(view.input().props.value, '');
    assert.deepEqual(view.sounds, ['error']);
    for (const char of 'CORRECT') view.type(view.input().props.value + char);
    view.enter();
    await settle();
    assert.equal(view.posts.length, 2);
    assert.equal(view.posts[1].body.scanValue, 'CORRECT');
    view.posts[1].resolve({ data: view.fixture });
    await settle();
    assert.deepEqual(view.sounds, ['error', 'pickSuccess']);
});

test('a failed response never restores its barcode into the next partially typed scan', async () => {
    const view = workView();
    view.type('WRONG'); view.enter();
    await settle();
    view.type('COR');
    view.posts[0].reject({ response: { status: 400, data: { message: '找不到條碼' } } });
    await settle();
    assert.equal(view.input().props.value, 'COR');
    for (const char of 'RECT') view.type(view.input().props.value + char);
    view.enter();
    await settle();
    assert.equal(view.posts[1].body.scanValue, 'CORRECT');
    view.posts[1].resolve({ data: view.fixture });
    await settle();
});

test('repeated wrong scans remain separate instead of appending to the previous rejected barcode', async () => {
    for (const role of ['picker', 'packer']) {
        const view = workView({ role });
        for (const value of ['WRONG-A', 'WRONG-B', 'WRONG-C']) {
            for (const char of value) view.type(view.input().props.value + char);
            view.enter();
            await settle();
            const request = view.posts.at(-1);
            assert.equal(request.body.scanValue, value);
            request.reject({ response: { status: 400, data: { message: '條碼錯誤' } } });
            await settle();
            assert.equal(view.input().props.value, '');
            assert.equal(view.input().props.readOnly, false);
        }
    }
});


test('focus mode keeps the scanner available and filters by picking progress; search can be cleared', () => {
    const view = workView({ initialData: {
        order: { id: 1, status: 'picking', picker_id: 1 }, instances: [],
        items: [
            { id: 11, product_name: '已揀商品', barcode: 'DONE', quantity: 1, picked_quantity: 1, packed_quantity: 0 },
            { id: 12, product_name: '待揀商品', barcode: 'TODO', quantity: 2, picked_quantity: 0, packed_quantity: 0 }
        ]
    } });
    const focusControl = view.find(view.render(), node => node.props?.toggleFocusMode);
    focusControl.props.toggleFocusMode();
    assert.ok(view.input(), 'focus mode must preserve the scan input');
    const cardRows = [];
    const collect = node => {
        if (node?.props?.progress) cardRows.push(node.props.progress.item.id);
        for (const child of (node?.props?.children || []).flat(Infinity)) collect(child);
    };
    collect(view.render());
    assert.deepEqual(cardRows, [12]);
    const search = () => view.find(view.render(), node => node.props?.id === 'order-item-search');
    search().props.onChange({ target: { value: 'missing' } });
    assert.ok(view.find(view.render(), node => node.props?.title === '找不到符合的品項'));
    const clear = view.find(view.render(), node => node.type === 'button' && node.props.children.includes('清除搜尋'));
    clear.props.onClick();
    assert.equal(search().props.value, '');
});

test('composing Enter does not send a scan and last accepted barcode remains available after success', async () => {
    const view = workView();
    view.type('ITEM');
    view.input().props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: true } });
    await settle();
    assert.equal(view.posts.length, 0);
    view.enter();
    await settle();
    view.posts[0].resolve({ data: view.fixture });
    await settle();
    const status = view.find(view.render(), node => node.props?.role === 'status' && node.props?.['aria-live'] === 'polite');
    const text = node => typeof node === 'string' ? node : (node?.props?.children || []).flat(Infinity).map(text).join('');
    assert.match(text(status), /最近揀貨已確認：ITEM/);
});

test('a scan response received after leaving the order does not play success or change the old order', async () => {
    const view = workView();
    view.type('ITEM'); view.enter();
    await settle();
    view.render();
    const lifetimeEffect = view.effects.find(callback => callback.toString().includes('mountedRef.current = true'));
    lifetimeEffect()();
    const accepted = structuredClone(view.fixture);
    accepted.items[0].picked_quantity = 1;
    view.posts[0].resolve({ data: accepted });
    await settle();
    assert.deepEqual(view.sounds, []);
    assert.equal(view.currentData().items[0].picked_quantity, 0);
});
