import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { filterTasks, canBatchPick, matchesTaskSearch, isActiveTaskForRole } from '../src/utils/taskFilters.js';
import { TASK_PAGE_SIZE, taskQueryScope, taskPageUrl, readTaskPage } from '../src/utils/taskPage.js';

const source = await readFile(new URL('../src/components/TaskDashboard.jsx', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'jsx', format: 'cjs' });
const noop = () => {};
const fixtures = [
    { id: 1, voucher_number: '2026/09/09-001', customer_name: '台北 客戶', status: 'pending', task_type: 'pick', is_urgent: true },
    { id: 2, voucher_number: '2026/09/09-002', customer_name: '南區公司', status: 'picked', task_type: 'pack', is_urgent: false },
    { id: 3, voucher_number: '2026/09/09-003', customer_name: '台北 客戶', status: 'picking', task_type: 'pick', current_user: 'Another operator' }
];

// Exercise the component's real callbacks with controlled hooks and deferred API
// responses. This isolates UI state transitions without a database or browser.
function dashboard({ role = 'admin', initialView = 'active', pinned = [] } = {}) {
    const hooks = [];
    const timers = new Map();
    let timerId = 0;
    const pendingEffects = [];
    let cursor = 0, dirty = false, tree, mounted = true;
    let updatesAfterUnmount = 0;
    const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
    const react = {
        createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
        useState(initial) {
            const index = cursor++;
            if (!(index in hooks)) hooks[index] = { value: typeof initial === 'function' ? initial() : initial };
            return [hooks[index].value, value => {
                if (!mounted) updatesAfterUnmount += 1;
                const next = typeof value === 'function' ? value(hooks[index].value) : value;
                if (!Object.is(next, hooks[index].value)) { hooks[index].value = next; dirty = true; }
            }];
        },
        useRef(initial) { const index = cursor++; return hooks[index] ||= { current: initial }; },
        useMemo(callback, deps) {
            const index = cursor++;
            if (!hooks[index] || !sameDeps(hooks[index].deps, deps)) hooks[index] = { value: callback(), deps };
            return hooks[index].value;
        },
        useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
        useEffect(callback, deps) {
            const index = cursor++;
            if (!hooks[index] || !sameDeps(hooks[index].deps, deps)) {
                const previousCleanup = hooks[index]?.cleanup;
                hooks[index] = { deps };
                pendingEffects.push(() => { previousCleanup?.(); hooks[index].cleanup = callback(); });
            }
        }
    };
    const reads = [], posts = [], navigation = [], sounds = [], failures = [], successes = [];
    const listeners = new Map();
    const storage = new Map();
    const deferred = (bucket, fields) => {
        let resolve, reject;
        const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
        bucket.push({ ...fields, resolve: value => resolve(Array.isArray(value?.data) ? { ...value, data: { items: value.data, hasMore: false, nextCursor: null } } : value), reject });
        return promise;
    };
    const notifications = new Proxy({ isEnabled: () => false, play: value => sounds.push(value) }, { get: (target, key) => key === '__esModule' ? false : target[key] || noop });
    const imports = {
        react,
        'react-router-dom': { useNavigate: () => value => navigation.push(value), useLocation: () => ({ state: { view: initialView } }), Link: 'Link' },
        '@/api/api.js': {
            get: (url, options) => url === '/api/tasks/pins' ? Promise.resolve({ data: { pinned } }) : deferred(reads, { url, options }),
            post: (url, body, options) => deferred(posts, { url, body, options })
        },
        '@/api/socket.js': { socket: { on: (name, callback) => listeners.set(name, callback), off: noop } },
        '@/utils/taskFilters': { filterTasks, canBatchPick, isActiveTaskForRole },
        '@/utils/taskPage': { TASK_PAGE_SIZE, taskQueryScope, taskPageUrl, readTaskPage },
        '@/utils/soundNotification.js': notifications,
        '@/utils/voiceNotification.js': notifications,
        '@/utils/desktopNotification.js': notifications,
        sonner: { toast: { success: (...args) => successes.push(args), info: noop, warning: noop, error: (...args) => failures.push(args) } },
        'sweetalert2-react-content': () => ({ fire: async () => ({}) }),
        './TaskListFilters': 'TaskListFilters'
    };
    const generic = new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) });
    const module = { exports: {} };
    vm.runInNewContext(code, {
        module, exports: module.exports, require: name => imports[name] || generic,
        setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id), console, URLSearchParams,
        localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
    });
    const user = { id: 7, name: 'Test operator', role };
    function render() {
        if (!mounted) return tree;
        for (let i = 0; i < 12; i++) {
            cursor = 0; dirty = false;
            tree = module.exports.TaskDashboard({ user });
            while (pendingEffects.length) pendingEffects.shift()();
            if (!dirty) return tree;
        }
        throw new Error('Rendering did not settle');
    }
    const find = (node, predicate) => {
        if (!node || typeof node !== 'object') return undefined;
        if (predicate(node)) return node;
        const values = [...(node.props?.children || []).flat(Infinity), node.props?.actions];
        for (const child of values) { const result = find(child, predicate); if (result) return result; }
    };
    const text = node => {
        if (node == null || node === false || node === true) return '';
        if (typeof node !== 'object') return String(node);
        return [...(node.props?.children || []).flat(Infinity), node.props?.actions].map(text).join(' ');
    };
    const filters = () => find(render(), node => node.type === 'TaskListFilters');
    const button = name => find(render(), node => ['button', 'Button'].includes(node.type) && text(node).trim() === name);
    const card = id => find(render(), node => node.type?.name === 'ModernTaskCard' && node.props.task.id === id);
    const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); render(); };
    const unmount = () => {
        mounted = false;
        for (const hook of hooks) hook?.cleanup?.();
    };
    const advanceSearch = () => { for (const [id, timer] of [...timers]) { if (timer.delay <= 300) { timers.delete(id); timer.fn(); } } render(); };
    render();
    return { advanceSearch, reads, posts, navigation, sounds, failures, successes, listeners, storage, render, filters, button, card, find, text, settle, unmount, updatesAfterUnmount: () => updatesAfterUnmount };
}

async function loaded(options) {
    const view = dashboard(options);
    view.reads[0].resolve({ data: fixtures });
    await view.settle();
    return view;
}

test('order search accepts scanner separators, fullwidth digits and customer plus order terms', () => {
    assert.equal(matchesTaskSearch(fixtures[0], '２０２６０９０９００１'), true);
    assert.equal(matchesTaskSearch(fixtures[0], '台北 09-001'), true);
    assert.deepEqual(filterTasks(fixtures, { status: 'pending', urgentOnly: true }).map(task => task.id), [1]);
    assert.deepEqual(filterTasks(fixtures, { search: 'missing-order' }), []);
});

test('server search no matches is recoverable and status filtering requests the whole scope', async () => {
    const view = await loaded();
    view.filters().props.onSearch('missing-order');
    view.render();
    assert.equal(view.reads.length, 1, 'debounce must not request per keystroke');
    view.advanceSearch();
    assert.match(view.reads[1].url, /q=missing-order/);
    view.reads[1].resolve({ data: [] });
    await view.settle();
    assert.match(view.text(view.render()), /沒有符合條件的任務/);
    assert.doesNotMatch(view.text(view.render()), /所有任務都已完成/);
    assert.equal(view.filters().props.matched, 0);
    view.button('清除篩選').props.onClick();
    view.render(); view.advanceSearch();
    view.reads[2].resolve({ data: fixtures });
    await view.settle();
    assert.equal(view.filters().props.matched, 3);
    view.filters().props.onStatus('picked');
    view.render();
    assert.match(view.reads[3].url, /status=picked/);
    view.reads[3].resolve({ data: [fixtures[1]] });
    await view.settle();
    assert.equal(view.filters().props.matched, 1);
    assert.equal(view.card(2).props.task.id, 2);
});

test('initial load failure remains visible and retry restores tasks without a page reload', async () => {
    const view = dashboard();
    assert.equal(view.reads[0].options.timeout, 15000);
    view.reads[0].reject(new Error('offline'));
    await view.settle();
    assert.match(view.text(view.render()), /任務載入失敗/);
    assert.doesNotMatch(view.text(view.render()), /所有任務都已完成|目前沒有可處理的任務/);
    view.button('重試載入').props.onClick();
    assert.equal(view.reads.length, 2);
    view.reads[1].resolve({ data: fixtures });
    await view.settle();
    assert.equal(view.filters().props.matched, 3);
    assert.doesNotMatch(view.text(view.render()), /任務載入失敗/);
});

test('background refresh keeps the visible list and makes a failure retryable', async () => {
    const view = await loaded();
    view.filters().props.onRefresh();
    assert.equal(view.card(1).props.task.id, 1);
    view.reads[1].reject(new Error('offline'));
    await view.settle();
    assert.equal(view.filters().props.matched, 3);
    assert.match(view.text(view.render()), /保留上次成功取得的清單/);
});

test('an older active response cannot overwrite a completed-date view', async () => {
    const view = dashboard();
    view.button('已完成').props.onClick();
    view.render();
    assert.match(view.reads[1].url, /tasks\/completed/);
    const completed = [{ id: 20, status: 'completed', voucher_number: 'DONE', customer_name: 'Test', task_type: 'done' }];
    view.reads[1].resolve({ data: completed });
    await view.settle();
    view.reads[0].resolve({ data: fixtures });
    await view.settle();
    assert.equal(view.filters().props.total, 1);
    assert.equal(view.card(20).props.viewMode, 'completed');
});

test('changing completed dates ignores the older response and new active socket tasks', async () => {
    const view = dashboard({ initialView: 'completed' });
    view.find(view.render(), node => node.props?.id === 'completed-date').props.onChange({ target: { value: '2026-08-30' } });
    view.render();
    view.reads[1].resolve({ data: [{ id: 30, status: 'completed', task_type: 'done', voucher_number: 'OLDER-DAY' }] });
    await view.settle();
    view.reads[0].resolve({ data: [{ id: 31, status: 'completed', task_type: 'done', voucher_number: 'TODAY' }] });
    await view.settle();
    view.listeners.get('new_task')(fixtures[0]);
    assert.equal(view.filters().props.total, 1);
    assert.equal(view.card(30).props.task.voucher_number, 'OLDER-DAY');
});

test('claim prevents double submit and enters work only after server success', async () => {
    const view = await loaded();
    const claim = view.card(1).props.onClaim;
    const first = claim(1, false);
    claim(1, false);
    assert.equal(view.posts.length, 1);
    assert.deepEqual(view.navigation, []);
    assert.equal(view.card(1).props.isClaiming, true);
    view.posts[0].resolve({ data: { message: 'ok' } });
    await first;
    await view.settle();
    assert.deepEqual(view.navigation, ['/order/1']);
    assert.deepEqual(view.sounds, ['taskClaimed']);
});

test('rejected claim stays on list, refreshes assignment and does not replay the POST', async () => {
    const view = await loaded();
    const claim = view.card(1).props.onClaim(1, false);
    view.posts[0].reject({ response: { data: { message: '任務已由他人認領' } } });
    await view.settle();
    assert.equal(view.reads.length, 2);
    view.reads[1].resolve({ data: fixtures });
    await claim;
    await view.settle();
    assert.deepEqual(view.navigation, []);
    assert.equal(view.posts.length, 1);
    assert.equal(view.card(1).props.isClaiming, false);
});

test('batch selection is limited to pickable tasks and filtered-away selections are cleared', async () => {
    assert.equal(canBatchPick(fixtures[0]), true);
    assert.equal(canBatchPick(fixtures[1]), false);
    assert.equal(canBatchPick(fixtures[2]), false);
    const view = await loaded();
    view.button('批次揀貨').props.onClick();
    view.card(1).props.toggleTaskSelection(1);
    assert.ok(view.button('認領 1 個揀貨任務'));
    view.filters().props.onSearch('南區');
    view.render();
    assert.equal(view.button('認領 1 個揀貨任務'), undefined);
});

test('picker and packer only get applicable status filters and list sections', async () => {
    const picker = await loaded({ role: 'picker' });
    assert.deepEqual(Array.from(picker.filters().props.statusOptions, option => option.value), ['pending', 'picking']);
    assert.equal(picker.card(2), undefined);
    const packer = await loaded({ role: 'packer' });
    assert.deepEqual(Array.from(packer.filters().props.statusOptions, option => option.value), ['picked', 'packing']);
    assert.equal(packer.card(1), undefined);
});

test('loading another view does not purge shared pinned-task cache', async () => {
    const view = await loaded({ pinned: [1, 2, 50] });
    view.button('已完成').props.onClick();
    view.render();
    view.reads[1].resolve({ data: [] });
    await view.settle();
    assert.deepEqual(JSON.parse(view.storage.get('pinned_tasks_team_cache')), [1, 2, 50]);
});


test('a picker loses another operator’s claimed task and never re-adds it from later events', async () => {
    const view = await loaded({ role: 'picker' });
    const claimedByOther = { ...fixtures[0], status: 'picking', picker_id: 99, current_user: 'Other' };
    view.listeners.get('task_claimed')(claimedByOther);
    assert.equal(view.card(1), undefined);
    view.listeners.get('task_claimed')(claimedByOther);
    assert.equal(view.card(1), undefined);
});


test('a pending claim locks other cards without labelling them as pending', async () => {
    const view = await loaded();
    const claim = view.card(1).props.onClaim;
    const first = claim(1, false);
    await claim(2, false);
    await claim(3, true);
    assert.equal(view.posts.length, 1);
    assert.deepEqual(view.navigation, []);
    assert.equal(view.card(1).props.isClaiming, true);
    const second = view.card(2);
    assert.equal(second.props.claimDisabled, true);
    assert.equal(second.props.isClaiming, false);
    const secondTree = second.type(second.props);
    const primary = view.find(secondTree, node => node.type === 'Button' && node.props.variant === 'primary');
    assert.equal(primary.props.disabled, true);
    assert.match(view.text(primary), /開始裝箱/);
    assert.doesNotMatch(view.text(primary), /認領中/);
    view.posts[0].resolve({ data: { message: 'ok' } });
    await first;
    assert.deepEqual(view.navigation, ['/order/1']);
    assert.equal(view.posts.length, 1);
});

test('accepted claim after leaving the dashboard causes no navigation, success feedback or state update', async () => {
    const view = await loaded();
    const claim = view.card(1).props.onClaim(1, false);
    view.unmount();
    view.posts[0].resolve({ data: { message: 'claim persisted' } });
    await claim;
    assert.deepEqual(view.navigation, []);
    assert.deepEqual(view.sounds, []);
    assert.deepEqual(view.successes, []);
    assert.equal(view.posts.length, 1);
    assert.equal(view.reads.length, 1);
    assert.equal(view.updatesAfterUnmount(), 0);
});

test('rejected claim after leaving does not fetch or interrupt the next screen', async () => {
    const view = await loaded();
    const claim = view.card(1).props.onClaim(1, false);
    view.unmount();
    view.posts[0].reject(new Error('network uncertain'));
    await claim;
    assert.deepEqual(view.navigation, []);
    assert.deepEqual(view.sounds, []);
    assert.deepEqual(view.failures, []);
    assert.equal(view.reads.length, 1);
    assert.equal(view.posts.length, 1);
    assert.equal(view.updatesAfterUnmount(), 0);
});

test('switching away and back invalidates the original claim navigation intent', async () => {
    const view = await loaded();
    const claim = view.card(1).props.onClaim(1, false);
    view.button('已完成').props.onClick();
    view.render();
    view.button('進行中').props.onClick();
    view.render();
    view.posts[0].resolve({ data: { message: 'claim persisted' } });
    await claim;
    assert.deepEqual(view.navigation, []);
    assert.deepEqual(view.sounds, []);
    assert.deepEqual(view.successes, []);
    assert.equal(view.posts.length, 1);
});


test('viewing another order immediately cancels pending claim navigation intent', async () => {
    const view = await loaded();
    const claim = view.card(1).props.onClaim(1, false);
    view.card(2).props.onViewOrder(2);
    view.posts[0].resolve({ data: { message: 'claim persisted' } });
    await claim;
    assert.deepEqual(view.navigation, ['/order/2']);
    assert.deepEqual(view.sounds, []);
    assert.deepEqual(view.successes, []);
    assert.equal(view.posts.length, 1);
});

test('leaving while an unsuccessful claim refreshes the list does not update unmounted state', async () => {
    const view = await loaded();
    const claim = view.card(1).props.onClaim(1, false);
    view.posts[0].reject({ response: { data: { message: '已被認領' } } });
    await view.settle();
    assert.equal(view.reads.length, 2);
    view.unmount();
    view.reads[1].resolve({ data: fixtures });
    await claim;
    assert.equal(view.updatesAfterUnmount(), 0);
    assert.deepEqual(view.navigation, []);
    assert.equal(view.posts.length, 1);
});

const pageEnvelope = (items, nextCursor = null) => ({ data: { items, hasMore: Boolean(nextCursor), nextCursor } });

test('next and previous pages replace the bounded list and retain the page-size label separately from global counts', async () => {
    const view = dashboard();
    assert.match(view.reads[0].url, /pagination=cursor/);
    assert.match(view.reads[0].url, /limit=50/);
    view.reads[0].resolve(pageEnvelope(fixtures, 'page-two'));
    await view.settle();
    assert.match(view.text(view.render()), /統計涵蓋目前權限/);
    view.button('下一頁').props.onClick(); view.render();
    assert.match(view.reads[1].url, /cursor=page-two/);
    view.reads[1].resolve(pageEnvelope([{ ...fixtures[0], id: 50, voucher_number: 'PAGE-TWO' }]));
    await view.settle();
    assert.equal(view.card(1), undefined);
    assert.equal(view.card(50).props.task.id, 50);
    assert.equal(view.filters().props.pageIndex, 1);
    assert.equal(view.button('下一頁').props.disabled, true);
    view.button('上一頁').props.onClick(); view.render();
    assert.doesNotMatch(view.reads[2].url, /cursor=/);
    view.reads[2].resolve(pageEnvelope(fixtures, 'page-two'));
    await view.settle();
    assert.equal(view.card(1).props.task.id, 1);
    assert.equal(view.filters().props.pageIndex, 0);
});

test('changing query during a slow next page ignores that page and restarts without its cursor', async () => {
    const view = dashboard();
    view.reads[0].resolve(pageEnvelope(fixtures, 'next'));
    await view.settle();
    view.button('下一頁').props.onClick(); view.render();
    view.filters().props.onSearch('early'); view.render();
    view.filters().props.onSearch('final'); view.render();
    view.reads[1].resolve(pageEnvelope([{ ...fixtures[0], id: 90 }]));
    await view.settle();
    assert.equal(view.card(90), undefined);
    view.advanceSearch();
    assert.equal(view.reads.length, 3);
    assert.match(view.reads[2].url, /q=final/);
    assert.doesNotMatch(view.reads[2].url, /cursor=/);
    view.reads[2].resolve(pageEnvelope([{ ...fixtures[0], id: 91 }]));
    await view.settle();
    assert.equal(view.card(91).props.task.id, 91);
    assert.equal(view.filters().props.pageIndex, 0);
});

test('failed next page can be retried using its original cursor or returned to first page', async () => {
    const view = dashboard();
    view.reads[0].resolve(pageEnvelope(fixtures, 'next'));
    await view.settle();
    view.button('下一頁').props.onClick(); view.render();
    view.reads[1].reject(new Error('offline'));
    await view.settle();
    assert.match(view.text(view.render()), /任務載入失敗/);
    view.button('重試載入').props.onClick();
    assert.equal(view.reads[2].url, view.reads[1].url);
    view.reads[2].resolve(pageEnvelope([{ ...fixtures[0], id: 99 }]));
    await view.settle();
    assert.equal(view.card(99).props.task.id, 99);
    view.filters().props.onRefresh(); view.render();
    assert.doesNotMatch(view.reads[3].url, /cursor=/);
});

test('live new tasks do not grow a page and changed ordering requires a fresh first page', async () => {
    const view = dashboard({ pinned: [1, 500] });
    view.reads[0].resolve(pageEnvelope(fixtures, 'next'));
    await view.settle();
    view.listeners.get('new_task')({ ...fixtures[0], id: 60, voucher_number: 'NEW' });
    view.render();
    assert.equal(view.card(60), undefined);
    assert.equal(view.filters().props.total, 3);
    assert.match(view.text(view.render()), /任務有更新/);
    assert.equal(view.button('下一頁').props.disabled, true);
    view.button('更新任務清單').props.onClick();
    view.reads[1].resolve(pageEnvelope(fixtures, 'fresh-next'));
    await view.settle();
    assert.equal(view.button('下一頁').props.disabled, false);
    assert.deepEqual(JSON.parse(view.storage.get('pinned_tasks_team_cache')), [1, 500]);
});

test('a malformed legacy array response in the new page contract is recoverable, never a fake empty list', async () => {
    assert.throws(() => readTaskPage([]), /分頁格式/);
    const view = dashboard();
    view.reads[0].resolve({ data: { items: [] } });
    await view.settle();
    assert.match(view.text(view.render()), /任務載入失敗/);
    assert.ok(view.button('重試載入'));
});


test('an event arriving during refresh keeps the stale-order warning after its response', async () => {
    const view = await loaded();
    view.filters().props.onRefresh();
    view.listeners.get('task_urgent_changed')({ orderId: 1, isUrgent: false });
    view.reads[1].resolve(pageEnvelope(fixtures, 'old-snapshot-next'));
    await view.settle();
    assert.match(view.text(view.render()), /任務有更新/);
    assert.equal(view.button('下一頁').props.disabled, true);
});

test('returning to a previous search starts its first page instead of resurrecting a stale cursor', async () => {
    const view = dashboard();
    view.reads[0].resolve(pageEnvelope(fixtures, 'old-next'));
    await view.settle();
    view.button('下一頁').props.onClick(); view.render();
    view.reads[1].resolve(pageEnvelope(fixtures)); await view.settle();
    view.filters().props.onSearch('other'); view.render(); view.advanceSearch();
    view.reads[2].resolve(pageEnvelope([])); await view.settle();
    view.button('清除篩選').props.onClick(); view.render(); view.advanceSearch();
    assert.doesNotMatch(view.reads[3].url, /cursor=/);
    assert.equal(view.filters().props.pageIndex, 0);
});

for (const hasComments of [false, true]) {
    test(`${hasComments ? 'comment preview' : 'empty comment entry'} uses a native keyboard button and opens only the selected order chat`, async () => {
        const view = dashboard();
        const task = { ...fixtures[0], total_comments: hasComments ? 3 : 0, urgent_comments: hasComments ? 1 : 0,
            latest_comment: hasComments ? { user_name: 'Warehouse operator', content: '請核對配件' } : null };
        view.reads[0].resolve(pageEnvelope([task])); await view.settle();
        const card = view.card(1);
        const renderedCard = card.type(card.props);
        const entry = view.find(renderedCard, node => node.type === 'button' &&
            node.props['aria-label'] === (hasComments ? `查看訂單 ${task.voucher_number} 的留言` : `開始討論訂單 ${task.voucher_number}`));
        assert.ok(entry, 'native button supplies Enter/Space activation without custom key handlers');
        assert.equal(entry.props.type, 'button');
        let stopped = false;
        entry.props.onClick({ stopPropagation: () => { stopped = true; } });
        assert.equal(stopped, true);
        const panel = view.find(view.render(), node => node.props?.orderId === 1 && node.props?.voucherNumber === task.voucher_number);
        assert.ok(panel);
        assert.equal(view.posts.length, 0);
        assert.deepEqual(view.navigation, []);
        if (hasComments) {
            assert.match(view.text(entry), /Warehouse operator/);
            assert.match(view.text(entry), /請核對配件/);
            assert.match(view.text(entry), /3.*則對話紀錄/);
            assert.match(view.text(entry), /緊急/);
        }
    });
}

const summaryFixture = { total: 504, pick: 502, pack: 2, inProgress: 3, mine: 1, picked: 2, done: 0 };
const summaryPage = (items, nextCursor = null) => ({ data: { ...pageEnvelope(items, nextCursor).data, countScope: 'filtered', summary: summaryFixture } });
const statButton = (view, name) => view.find(view.render(), node => node.type === 'button' && node.props['aria-label'] === `查看${name}`);

test('cards show server totals, select a group, reset pagination and retain search filters', async () => {
    const view = dashboard();
    view.reads[0].resolve(summaryPage(fixtures, 'page-two'));
    await view.settle();
    const count = view.find(statButton(view, '揀貨任務'), node => node.type?.name === 'NumberTicker');
    assert.equal(count.props.value, 502);
    view.button('下一頁').props.onClick(); view.render();
    view.reads[1].resolve(summaryPage(fixtures)); await view.settle();
    statButton(view, '裝箱任務').props.onClick(); view.render();
    assert.match(view.reads[2].url, /group=pack/);
    assert.doesNotMatch(view.reads[2].url, /cursor=/);
    view.reads[2].resolve(summaryPage([fixtures[1]])); await view.settle();
    assert.equal(statButton(view, '裝箱任務').props['aria-pressed'], true);
    assert.equal(view.card(1), undefined);
    assert.equal(view.card(2).props.task.id, 2);
    view.card(2).props.onViewOrder(2);
    assert.deepEqual(view.navigation, ['/order/2']);
    view.filters().props.onSearch('台北'); view.render(); view.advanceSearch();
    statButton(view, '作業中').props.onClick(); view.render();
    assert.match(view.reads.at(-1).url, /group=inProgress/);
    assert.equal(new URLSearchParams(view.reads.at(-1).url.split('?')[1]).get('q'), '台北');
    view.filters().props.onReset(); view.render(); view.advanceSearch();
    assert.doesNotMatch(view.reads.at(-1).url, /group=|q=|cursor=/);
});

test('late previous-group responses are ignored and zero cards remain navigable', async () => {
    const view = dashboard();
    statButton(view, '裝箱任務').props.onClick(); view.render();
    view.reads[1].resolve(summaryPage([])); await view.settle();
    view.reads[0].resolve(summaryPage(fixtures)); await view.settle();
    assert.equal(view.card(1), undefined);
    assert.equal(statButton(view, '裝箱任務').props['aria-pressed'], true);
    assert.match(view.text(view.render()), /沒有符合條件/);
    statButton(view, '總任務').props.onClick(); view.render();
    assert.doesNotMatch(view.reads.at(-1).url, /group=/);
});

test('status events remove tasks that no longer belong to the selected group and mark summary stale', async () => {
    const view = dashboard();
    statButton(view, '作業中').props.onClick(); view.render();
    view.reads[1].resolve(summaryPage([fixtures[2]])); await view.settle();
    assert.ok(view.card(3));
    view.listeners.get('task_status_changed')({ orderId: 3, newStatus: 'picked' }); view.render();
    assert.equal(view.card(3), undefined);
    assert.match(view.text(view.render()), /統計與清單可能已變動/);
});
