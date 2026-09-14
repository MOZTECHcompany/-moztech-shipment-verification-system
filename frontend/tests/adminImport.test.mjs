import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = await readFile(new URL('../src/components/admin/AdminDashboard.jsx', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'jsx', format: 'cjs', define: { 'import.meta.env.DEV': 'true' } });
const file = (name = 'fixture.xlsx', size = 1024) => ({ name, size });
const noop = () => {};

// Exercise real component callbacks and asynchronous state transitions with
// deferred HTTP responses. No server, production data or browser is involved.
function dashboard({ role = 'admin', storage = new Map() } = {}) {
    const hooks = [], effects = [], posts = [], reads = [], successes = [], failures = [];
    const listeners = new Map();
    let cursor = 0, tree, dirty = false, mounted = true, lateUpdates = 0;
    const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
    const react = {
        createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
        useState(initial) {
            const index = cursor++;
            if (!(index in hooks)) hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
            return [hooks[index].value, value => {
                if (!mounted) lateUpdates++;
                const next = typeof value === 'function' ? value(hooks[index].value) : value;
                if (!Object.is(next, hooks[index].value)) { hooks[index].value = next; dirty = true; }
            }];
        },
        useRef(initial) { const index = cursor++; return hooks[index] ||= { current: initial }; },
        useEffect(callback, deps) {
            const index = cursor++;
            if (!hooks[index] || !sameDeps(hooks[index].deps, deps)) {
                const previousCleanup = hooks[index]?.cleanup;
                hooks[index] = { deps };
                effects.push(() => { previousCleanup?.(); hooks[index].cleanup = callback(); });
            }
        }
    };
    const deferred = (bucket, data) => new Promise((resolve, reject) => bucket.push({ ...data, resolve, reject }));
    const imports = {
        react,
        'react-router-dom': { Link: 'Link' },
        'react-datepicker': 'DatePicker',
        'date-fns': { format: date => date.toISOString().slice(0, 10) },
        '@/api/api.js': {
            post: (url, body, options) => deferred(posts, { url, body, options }),
            get: (url, options) => deferred(reads, { url, options })
        },
        sonner: { toast: { success: text => successes.push(text), error: text => failures.push(text) } },
    };
    const generic = new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) });
    const module = { exports: {} };
    const downloads = [], revoked = [];
    vm.runInNewContext(code, {
        module, exports: module.exports, require: name => imports[name] || generic,
        FormData: class { constructor() { this.parts = []; } append(...args) { this.parts.push(args); } },
        Blob: class { constructor(parts) { this.parts = parts; } },
        sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
        window: {
            addEventListener: (name, callback) => listeners.set(name, callback),
            removeEventListener: name => listeners.delete(name),
            URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL: url => revoked.push(url) }
        },
        document: { body: { appendChild: noop }, createElement: () => { const link = { remove: noop, click: () => downloads.push(link.download) }; return link; } },
        console
    });
    const user = { id: 7, role };
    function render() {
        if (!mounted) return tree;
        for (let count = 0; count < 10; count++) {
            cursor = 0; dirty = false;
            tree = module.exports.AdminDashboard({ user });
            while (effects.length) effects.shift()();
            if (!dirty) return tree;
        }
        throw new Error('Rendering did not settle');
    }
    function find(node, predicate) {
        if (!node || typeof node !== 'object') return undefined;
        if (predicate(node)) return node;
        for (const child of [...(node.props?.children || []).flat(Infinity), node.props?.actions]) {
            const found = find(child, predicate); if (found) return found;
        }
    }
    const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : [...(node.props?.children || []).flat(Infinity), node.props?.actions].map(text).join(' ');
    const control = id => find(render(), node => node.props?.['data-testid'] === id);
    const button = label => find(render(), node => ['Button', 'button'].includes(node.type) && text(node).trim() === label);
    const select = (...files) => control('import-file').props.onChange({ target: { files, value: 'selected' } });
    const drop = (...files) => control('import-dropzone').props.onDrop({ preventDefault: noop, stopPropagation: noop, dataTransfer: { files } });
    const settle = async () => { for (let count = 0; count < 8; count++) await Promise.resolve(); render(); };
    const unmount = () => { mounted = false; for (const hook of hooks) hook?.cleanup?.(); };
    render();
    return { render, text, find, control, button, select, drop, settle, posts, reads, successes, failures, storage, listeners, downloads, revoked, unmount, lateUpdates: () => lateUpdates };
}

test('double selection and drag/drop while importing send only one request and no invented progress', async () => {
    const view = dashboard();
    const promise = view.select(file());
    view.select(file());
    view.drop(file());
    assert.equal(view.posts.length, 1);
    assert.equal(view.posts[0].url, '/api/orders/import');
    assert.equal(view.posts[0].body.parts[0][0], 'orderFile');
    assert.equal(view.posts[0].options.timeout, 60000);
    assert.equal(view.control('import-file').props.disabled, true);
    assert.match(view.text(view.control('import-result')), /正在驗證檔案並建立訂單/);
    assert.doesNotMatch(view.text(view.render()), /%|Agent.*已接/);
    assert.ok(view.listeners.has('beforeunload'));
    view.posts[0].resolve({ status: 201, data: { voucherNumber: 'TEST-42', orderId: 42, itemCount: 2, totalQuantity: 3, serialCount: 2 } });
    await promise;
    await view.settle();
    assert.match(view.text(view.control('import-result')), /TEST-42\s+已成功匯入/);
    assert.ok(view.find(view.render(), node => node.props?.to === '/order/42'));
    assert.equal(view.control('import-file').props.disabled, false);
    assert.equal(view.storage.size, 0);
    assert.equal(view.listeners.has('beforeunload'), false);
});

test('rejects multi-file, empty, unsupported and oversized input before HTTP', async () => {
    const view = dashboard();
    for (const files of [[file(), file('second.csv')], [file('x.xlsx', 0)], [file('x.pdf')], [file('x.csv', 10 * 1024 * 1024 + 1)]]) {
        await view.drop(...files);
        assert.equal(view.posts.length, 0);
        assert.match(view.text(view.control('import-result')), /未建立訂單/);
    }
});

test('known parser failure remains visible and permits corrected file selection', async () => {
    const view = dashboard();
    view.select(file());
    view.posts[0].reject({ response: { status: 400, data: { code: 'IMPORT_NOT_APPLIED', message: '第 5 列：需求數量與 SN 數量不符' } } });
    await view.settle();
    assert.match(view.text(view.control('import-result')), /第 5 列/);
    assert.equal(view.control('import-file').props.disabled, false);
    assert.equal(view.storage.size, 0);
    view.select(file('corrected.csv'));
    assert.equal(view.posts.length, 2);
});

test('existing voucher opens the existing order without an automatic retry', async () => {
    const view = dashboard();
    view.select(file());
    view.posts[0].reject({ response: { status: 409, data: { code: 'IMPORT_ALREADY_EXISTS', orderId: 19, voucherNumber: 'EXISTING-19' } } });
    await view.settle();
    assert.match(view.text(view.control('import-result')), /已存在，未重複建立/);
    assert.ok(view.find(view.render(), node => node.props?.to === '/order/19'));
    assert.equal(view.posts.length, 1);
    assert.equal(view.storage.size, 0);
});

for (const [label, failure] of [
    ['timeout', new Error('timeout')],
    ['unknown commit', { response: { status: 503, data: { code: 'IMPORT_RESULT_UNKNOWN', voucherNumber: 'UNKNOWN-1' } } }],
    ['unclassified server failure', { response: { status: 500, data: { message: 'server error' } } }],
]) test(`${label} blocks resubmission until the user checks the existing result`, async () => {
    const view = dashboard();
    view.select(file());
    view.posts[0].reject(failure);
    await view.settle();
    assert.match(view.text(view.control('import-result')), /尚未確認匯入結果/);
    assert.match(view.text(view.control('import-result')), /請勿直接重送/);
    assert.equal(view.control('import-file').props.disabled, true);
    view.select(file());
    view.drop(file());
    assert.equal(view.posts.length, 1);
    assert.equal(view.storage.size, 1);
    view.control('import-reset-unknown').props.onClick();
    assert.equal(view.posts.length, 1);
    assert.equal(view.storage.size, 0);
    assert.equal(view.control('import-file').props.disabled, false);
    view.select(file('checked.xlsx'));
    assert.equal(view.posts.length, 2);
});

test('an incomplete success response is treated as uncertain rather than showing undefined voucher', async () => {
    const view = dashboard();
    view.select(file());
    view.posts[0].resolve({ status: 201, data: { orderId: 42 } });
    await view.settle();
    assert.match(view.text(view.control('import-result')), /尚未確認匯入結果/);
    assert.equal(view.successes.length, 0);
});

test('leaving a pending import retains recovery metadata and late results never update unmounted UI', async () => {
    const view = dashboard();
    view.select(file('pending.xlsx'));
    view.unmount();
    const reopened = dashboard({ storage: view.storage });
    assert.match(reopened.text(reopened.control('import-result')), /pending.xlsx/);
    assert.equal(reopened.control('import-file').props.disabled, true);
    assert.equal(reopened.posts.length, 0);
    view.posts[0].reject(new Error('network lost'));
    await view.settle();
    assert.equal(view.lateUpdates(), 0);
});

test('operations retain reports and exception tools while account settings move out of the dashboard', () => {
    const view = dashboard();
    for (const to of ['/tasks', '/admin/analytics', '/admin/defects', '/admin/scan-errors', '/admin/exceptions']) {
        assert.ok(view.find(view.render(), node => node.props?.to === to), to);
    }
    for (const to of ['/admin/users', '/admin/operation-logs']) assert.equal(view.find(view.render(), node => node.props?.to === to), undefined);
    assert.ok(view.button('下載報告'));
    assert.ok(view.button('執行資料清理'));
    assert.doesNotMatch(view.text(view.render()), /--|今日訂單|完成率/);
    const dispatcher = dashboard({ role: 'dispatcher' });
    assert.ok(dispatcher.control('import-file'));
    assert.equal(dispatcher.find(dispatcher.render(), node => node.props?.to === '/admin/users'), undefined);
    assert.equal(dispatcher.button('執行資料清理'), undefined);
});

test('CSV export keeps date parameters and download behavior while preventing repeated requests', async () => {
    const view = dashboard();
    view.find(view.render(), node => node.type === 'DatePicker').props.onChange([new Date('2026-09-01'), new Date('2026-09-09')]);
    const handler = view.button('下載報告').props.onClick;
    const promise = handler();
    handler();
    assert.equal(view.reads.length, 1);
    assert.equal(view.reads[0].options.params.startDate, '2026-09-01');
    assert.equal(view.reads[0].options.params.endDate, '2026-09-09');
    view.reads[0].resolve({ data: 'fixture,csv' });
    await promise;
    await view.settle();
    assert.deepEqual(view.downloads, ['營運報告_2026-09-01_至_2026-09-09.csv']);
    assert.deepEqual(view.revoked, ['blob:fixture']);
    assert.equal(view.button('下載報告').props.disabled, false);
});

test('retention keeps the existing endpoint and only sends one in-flight request', async () => {
    const view = dashboard();
    const handler = view.button('執行資料清理').props.onClick;
    const promise = handler();
    handler();
    assert.equal(view.posts.length, 1);
    assert.equal(view.posts[0].url, '/api/admin/maintenance/retention/run');
    view.posts[0].resolve({ data: {} });
    await promise;
    await view.settle();
    assert.equal(view.button('執行資料清理').props.disabled, false);
});
