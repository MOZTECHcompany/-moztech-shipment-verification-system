import * as managementScope from '../src/utils/managementScope.js';
import * as orderChangePresentation from '../src/utils/orderChangePresentation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { createScanSubmission } from '../src/utils/scanSubmission.js';
import * as orderWorkProgress from '../src/utils/orderWorkProgress.js';
import * as sourceOrders from '../src/utils/sourceOrders.js';
import * as scanDelta from '../src/utils/scanDelta.js';

const source = await readFile(new URL('../src/components/OrderWorkView.jsx', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'jsx', format: 'cjs' });

// Execute the real component event handlers with controlled hooks and transport.
// Child components and DOM rendering are omitted; no application server is started.
function workView({ role = 'picker', deferRead = false, initialData, managementScope: userManagementScope, exceptions = [] } = {}) {
    const order = { id: 1, status: role === 'picker' ? 'picking' : 'packing', picker_id: 1, packer_id: 1 };
    const fixture = initialData || { order, items: [{ id: 11, quantity: 100, picked_quantity: 0, packed_quantity: 0, barcode: 'ITEM' }], instances: [] };
    const states = [fixture, false, ''];
    const refs = [];
    const effects = [];
    let stateCursor = 0;
    let refCursor = 0;
    const sounds = [];
    const spoken = [];
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
            if (url.endsWith('/exceptions')) return Promise.resolve({ data: { items: exceptions } });
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
        '@/utils/managementScope': managementScope,
        '@/utils/orderChangePresentation': orderChangePresentation,
        react,
        'react-router-dom': { useParams: () => ({ orderId: '1' }), useNavigate: () => noop },
        sonner: { toast: { warning: (...args) => warnings.push(args), error: noop, success: noop, info: noop } },
        '@/api/api': api,
        '@/api/socket': { socket },
        '@/utils/scanSubmission': { createScanSubmission },
        '@/utils/orderWorkProgress': orderWorkProgress,
        '@/utils/sourceOrders': sourceOrders,
        '@/utils/scanDelta': scanDelta,
        '@/utils/soundNotification': { play: sound => sounds.push(sound) },
        '@/utils/voiceNotification': { speakScanSuccess: (...args) => spoken.push(['progress', ...args]), speakScanError: (...args) => spoken.push(['error', ...args]), speakOperationError: noop, speakTaskComplete: type => spoken.push(['complete', type]) },
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
        const shell = module.exports.OrderWorkView({ user: { id: 1, role, management_scope: userManagementScope } });
        return typeof shell.type === 'function' ? shell.type(shell.props) : shell;
    }
    function find(tree, predicate) {
        if (!tree || typeof tree !== 'object') return;
        if (predicate(tree)) return tree;
        for (const child of [...(tree.props?.children || []).flat(Infinity), tree.props?.footer]) {
            const found = find(child, predicate);
            if (found) return found;
        }
    }
    const input = () => find(render(), node => node.props?.id === 'order-scan-input');
    const type = text => input().props.onChange({ target: { value: text } });
    const enter = () => input().props.onKeyDown({ key: 'Enter', preventDefault: noop });
    const camera = () => find(render(), node => node.type === 'CameraScanner');
    return { boundary: user => module.exports.OrderWorkView({ user }), find, fixture, posts, reads, sounds, spoken, warnings, type, enter, input, render, camera, effects, listeners, offCalls, currentData: () => states[0] };
}

const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

for (const [role, type, status] of [['picker', 'pick', 'picked'], ['packer', 'pack', 'completed']]) {
    test(`${role} final accepted scan announces completion before return and ignores late duplicate socket`, async () => {
        const view = workView({ role });
        view.render();
        view.effects.find(callback => callback.toString().includes('active_sessions_update'))();
        view.type('ITEM'); view.enter();
        await settle();
        view.listeners.get('task_status_changed')({ orderId: 1, newStatus: status });
        assert.equal(view.spoken.length, 0);
        const accepted = structuredClone(view.fixture);
        accepted.order.status = status;
        accepted.items[0][type === 'pick' ? 'picked_quantity' : 'packed_quantity'] = 100;
        view.posts[0].resolve({ data: accepted });
        await settle();
        assert.deepEqual(view.spoken, [['complete', type]]);
        view.listeners.get('task_status_changed')({ orderId: 1, newStatus: status });
        assert.deepEqual(view.spoken, [['complete', type]]);
    });
    test(`${role} unfinished workflow reports server quantities, not a false completion`, async () => {
        const view = workView({ role });
        view.type('ITEM'); view.enter(); await settle();
        const accepted = structuredClone(view.fixture);
        accepted.items[0][type === 'pick' ? 'picked_quantity' : 'packed_quantity'] = 3;
        if (type === 'pack') accepted.items[0].picked_quantity = 100;
        view.posts[0].resolve({ data: accepted }); await settle();
        assert.equal(JSON.stringify(view.spoken), JSON.stringify([['progress', 3, 97, { type }]]));
    });
}

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

const sourceFixture = () => ({
    order: { id: 1, status: 'picking', picker_id: 1 }, instances: [],
    items: [
        { id: 11, product_name: 'A 商品', barcode: 'SAME', quantity: 2, picked_quantity: 0, source_order_number: '000123', source_platform: '蝦皮', source_store: 'A' },
        { id: 12, product_name: 'B 商品', barcode: 'SAME', quantity: 3, picked_quantity: 0, source_order_number: 'OTHER', source_platform: '1Shop', source_store: 'B' },
    ],
});
const visibleItemIds = view => {
    const ids = [];
    const collect = node => {
        if (node?.props?.progress) ids.push(node.props.progress.item.id);
        for (const child of (node?.props?.children || []).flat(Infinity)) collect(child);
    };
    collect(view.render());
    return ids;
};
const locateSource = (view, number) => {
    const input = () => view.find(view.render(), node => node.props?.id === 'source-order-input');
    input().props.onChange({ target: { value: number } });
    input().props.onKeyDown({ key: 'Enter', preventDefault() {}, currentTarget: { value: number } });
};

test('marketplace barcode lookup is read only, scopes SKU scanning and retains whole-batch counts', async () => {
    const view = workView({ initialData: sourceFixture() });
    locateSource(view, '000123');
    assert.equal(view.posts.length, 0);
    assert.deepEqual(visibleItemIds(view), [11]);
    const header = view.find(view.render(), node => node.props?.stats);
    assert.equal(header.props.stats.totalQuantity, 5);
    assert.equal(header.props.items.length, 2);
    view.type('SAME'); view.enter();
    await settle();
    assert.equal(view.posts.length, 1);
    assert.equal(view.posts[0].body.orderId, 1);
    assert.equal(view.posts[0].body.orderItemId, 11);
    view.posts[0].resolve({ data: view.fixture });
    await settle();
    const clear = view.find(view.render(), node => node.type === 'button' && node.props.children.includes('顯示整張理貨單'));
    clear.props.onClick();
    assert.deepEqual(visibleItemIds(view), [11, 12]);
});

test('duplicate order numbers require a platform/store choice and cannot trigger a product mutation', async () => {
    const fixture = sourceFixture();
    fixture.items[1].source_order_number = '000123';
    const view = workView({ initialData: fixture });
    locateSource(view, '000123');
    assert.deepEqual(visibleItemIds(view), []);
    view.type('SAME'); view.enter();
    await settle();
    assert.equal(view.posts.length, 0);
    assert.equal(view.input().props.value, '');
    const option = view.find(view.render(), node => node.type === 'button' && node.props.children.includes('1Shop · B · 000123'));
    assert.ok(option);
    option.props.onClick();
    assert.deepEqual(visibleItemIds(view), [12]);
    view.type('SAME'); view.enter();
    await settle();
    assert.equal(view.posts[0].body.orderItemId, 12);
    view.posts[0].resolve({ data: fixture });
    await settle();
});

test('missing source and an SN from another source are rejected without losing scanner recovery', async () => {
    const fixture = sourceFixture();
    fixture.instances = [{ id: 9, order_item_id: 12, serial_number: 'OTHER-SN', status: 'pending' }];
    const view = workView({ initialData: fixture });
    locateSource(view, 'missing');
    view.type('SAME'); view.enter();
    await settle();
    assert.equal(view.posts.length, 0);
    locateSource(view, '000123');
    view.type('OTHER-SN'); view.enter();
    await settle();
    assert.equal(view.posts.length, 0);
    assert.equal(view.input().props.value, '');
    view.type('SAME'); view.enter();
    await settle();
    assert.equal(view.posts[0].body.orderItemId, 11);
    view.posts[0].resolve({ data: fixture });
    await settle();
});

test('mapped batch order changes retain each SKU row and send the selected item identity for approval', async () => {
    const fixture = sourceFixture();
    const view = workView({ role: 'admin', initialData: fixture });
    const button = label => view.find(view.render(), node => node.props?.children?.includes(label) && node.props.onClick);
    button('申請異動').props.onClick();
    const reason = view.find(view.render(), node => node.props?.placeholder === '請描述異動原因（必填）');
    reason.props.onChange({ target: { value: '調整來源 A 的數量' } });
    const edit = button('編輯');
    assert.ok(edit);
    edit.props.onClick();
    const quantity = view.find(view.render(), node => node.type === 'input' && node.props.type === 'number');
    assert.equal(quantity.props.value, 2, 'same barcode across sources must not merge into quantity 5');
    quantity.props.onChange({ target: { value: '3' } });
    button('下一步核對').props.onClick();
    button('確認送出').props.onClick();
    await settle();
    assert.equal(view.posts.length, 1);
    assert.equal(view.posts[0].url, '/api/orders/1/exceptions');
    const proposal = view.posts[0].body.snapshot.proposal.items;
    assert.equal(proposal.length, 1);
    assert.equal(proposal[0].orderItemId, 11);
    assert.equal(proposal[0].quantityChange, 1);
    assert.equal(proposal[0].sourceOrderNumber, undefined, 'existing ownership must not be overwritten');
    view.posts[0].resolve({ data: {} });
    await settle();
});

test('an explicitly pending retry cannot move a product into another marketplace order after switching', async () => {
    const view = workView({ initialData: sourceFixture() });
    locateSource(view, '000123');
    view.type('SAME'); view.enter();
    view.type('SAME'); view.enter();
    await settle();
    assert.equal(view.posts.length, 1);
    locateSource(view, 'OTHER');
    view.posts[0].resolve({ data: view.fixture });
    await settle();
    const retry = view.find(view.render(), node => node.type === 'button' && node.props.children.includes('重新送出這筆條碼'));
    assert.equal(retry, undefined);
    assert.equal(view.posts.length, 1);
    assert.deepEqual(visibleItemIds(view), [12]);
});

test('administrators cannot scan or adjust another operator stage and picked does not auto-claim packing', async () => {
    for (const role of ['admin', 'superadmin', 'packer']) {
        for (const order of [{ id: 1, status: 'packing', packer_id: 2 }, { id: 1, status: 'picked', packer_id: null }]) {
            const view = workView({ role, initialData: { order, items: [{ id: 11, quantity: 5, picked_quantity: 5, packed_quantity: 0, barcode: 'ITEM' }], instances: [] } });
            assert.equal(view.input().props.disabled, true);
            view.type('ITEM'); view.enter(); await settle();
            assert.equal(view.posts.length, 0);
            const card = view.find(view.render(), node => typeof node.type === 'function' && node.type.name === 'QuantityItemCard');
            assert.ok(card);
            assert.equal(card.props.onUpdate('ITEM', 'pack', 1, 11), false);
            assert.equal(view.posts.length, 0);
        }
    }
});

test('administrators who own an active stage retain exact product scan capability', async () => {
    const view = workView({ role: 'admin' });
    assert.equal(view.input().props.disabled, false);
    view.type('ITEM'); view.enter(); await settle();
    assert.equal(view.posts.length, 1); assert.equal(view.posts[0].body.type, 'pack');
    view.posts[0].resolve({ data: view.fixture }); await settle();
});


test('receipt navigation must fetch a current snapshot; completed or transferred ownership never enables scans', async () => {
    for (const order of [{ id: 1, status: 'picking', picker_id: 2 }, { id: 1, status: 'completed', picker_id: 1, packer_id: 1 }]) {
        const view = workView({ deferRead: true, initialData: { order: null, items: [], instances: [] } });
        view.render();
        assert.equal(view.input().props.disabled, true);
        view.effects.find(callback => callback.toString().includes('fetchOrderDetails(orderId)') && !callback.toString().includes('active_sessions_update'))();
        assert.equal(view.reads.length, 1);
        view.reads[0].resolve({ data: { order, items: [{ id: 11, quantity: 1, barcode: 'ITEM' }], instances: [] } });
        await settle();
        assert.equal(view.input().props.disabled, true);
        view.type('ITEM'); view.enter(); await settle();
        assert.equal(view.posts.length, 0);
    }
});

test('account or role changes remount the order view instead of reusing its snapshot and scan queue', () => {
    const view = workView();
    const first = view.boundary({ id: 1, role: 'picker' }).props.key;
    assert.notEqual(view.boundary({ id: 2, role: 'picker' }).props.key, first);
    assert.notEqual(view.boundary({ id: 1, role: 'admin' }).props.key, first);
});


test('order-only administrators cannot scan or adjust even if an old snapshot names them as stage owner', async () => {
    const view = workView({ role: 'admin', managementScope: 'orders' });
    assert.equal(view.input().props.disabled, true);
    view.type('ITEM'); view.enter(); await settle();
    assert.equal(view.posts.length, 0);
    const card = view.find(view.render(), node => typeof node.type === 'function' && node.type.name === 'QuantityItemCard');
    assert.equal(card.props.onUpdate('ITEM', 'pack', 1, 11), false);
    assert.equal(view.posts.length, 0);
});


test('pending source-line changes show their own quantity while approved history keeps the applied result', async () => {
    const pending = { id: 8, type: 'order_change', status: 'open', snapshot: { baselineItems: [{ barcode: 'SAME', quantity: 5 }], proposal: { items: [{ orderItemId: 11, barcode: 'SAME', productName: 'Changed source A', quantityChange: 1, noSn: true }] } } };
    const applied = { id: 9, type: 'order_change', status: 'ack', snapshot: { proposal: pending.snapshot.proposal, applyResult: { changesApplied: [{ barcode: 'SAME', orderItemId: 11, previousTotalQuantity: 2, newTotalQuantity: 3 }] } } };
    const fixture = sourceFixture(); fixture.items[0].quantity = 2;
    const view = workView({ role: 'admin', initialData: fixture, exceptions: [pending, applied] });
    view.render(); view.effects.find(callback => callback.toString().includes('fetchOrderExceptions(orderId)') && !callback.toString().includes('active_sessions_update'))();
    await settle();
    const text = node => Array.isArray(node) ? node.map(text).join(' ') : node == null || typeof node === 'boolean' ? '' : typeof node === 'object' ? text(node.props?.children || []) : String(node);
    const content = text(view.render());
    assert.match(content, /蝦皮 · A · 000123/);
    assert.equal((content.match(/2→3/g) || []).length, 2);
    assert.doesNotMatch(content, /5→6/);
    fixture.items[0].quantity = 99;
    assert.match(text(view.render()), /2→3/);
});
