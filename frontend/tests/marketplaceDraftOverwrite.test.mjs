import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { transform } from 'esbuild';

const source = await readFile(new URL('../src/components/admin/MarketplaceDraftOverwrite.jsx', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'jsx', format: 'cjs' });
const snapshot = (quantity = 4, totalMinor = 307800) => ({ quantity, totalMinor, items: [{ sku: '4711299273674', name: '掛繩充電線', quantity, unitMinor: 76950, lineSubtotalMinor: totalMinor }] });
const fixture = () => ({ previewFingerprint: 'preview-one', confirmationRequired: true, affectedBatches: [{ id: 52, batchNumber: 'WMS-TEST-52', revision: 1, canOverwrite: true, blockedReasons: [], uploadedOrders: [{ orderNumber: '#155116', changed: false, before: snapshot(1, 10000), after: snapshot(1, 10000), changes: [] }], omittedOrders: [{ orderNumber: '#155293', before: snapshot() }] }] });
const applied = () => ({ applied: true, commandId: 'server-command', batches: [{ id: 52, batchNumber: 'WMS-TEST-52', draftRevision: 2, activeOrderCount: 1, excludedOrderNumbers: ['#155293'] }], replayed: false });
const fail = status => Object.assign(Error('synthetic failure'), { response: { status, data: { message: '合成失敗' } } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function view({ previews = [fixture()], confirms = [applied()], previewWait, confirmWait, native = true } = {}) {
  const hooks = [], effects = [], requests = [], downloads = [], complete = [], busyChanges = [], clicked = [];
  let cursor = 0, dirty = false, tree, mounted = true, allowed = true, lateUpdates = 0, previewIndex = 0, confirmIndex = 0, closed = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, ...(children.length ? { children } : {}) } }),
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = { value: typeof initial === 'function' ? initial() : initial }; return [hooks[i].value, value => { if (!mounted) lateUpdates++; const next = typeof value === 'function' ? value(hooks[i].value) : value; if (!Object.is(next, hooks[i].value)) { hooks[i].value = next; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; return hooks[i] ||= { current: initial }; },
    useEffect(callback, deps) { const i = cursor++; if (!hooks[i] || !same(hooks[i].deps, deps)) { const cleanup = hooks[i]?.cleanup; hooks[i] = { deps }; effects.push(() => { cleanup?.(); hooks[i].cleanup = callback(); }); } },
  };
  const api = { post: async (url, body) => {
    requests.push({ url, body });
    if (url.endsWith('/preview')) { if (previewWait) await previewWait(); const value = previews[Math.min(previewIndex++, previews.length - 1)]; if (value instanceof Error) throw value; return { data: value }; }
    if (url.endsWith('/confirm')) { if (confirmWait) await confirmWait(); const value = confirms[Math.min(confirmIndex++, confirms.length - 1)]; if (value instanceof Error) throw value; return { data: value }; }
    if (url.endsWith('/download-link')) return { data: { url: '/api/marketplace-files/synthetic' } };
    throw Error(`Unexpected endpoint ${url}`);
  } };
  const imports = {
    react, '../../ui': { Button: 'Button' }, '@/api/api.js': api, '../../api/origin': { API_ORIGIN: 'https://wms.invalid' },
    '../../workspace/nativeRuntime.js': { getNativeRuntime: () => native ? {} : null },
    '../../workspace/downloads.js': { downloadNativeMarketplaceFile: async (args, options) => { if (!options.isCurrent()) return false; downloads.push(args); return true; } },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => { if (!(name in imports)) throw Error(`Unexpected import ${name}`); return imports[name]; }, crypto: webcrypto, document: { body: { appendChild() {} }, createElement: () => ({ click() { clicked.push(this.href); }, remove() {} }) } });
  const props = { rows: [['order', 'sku'], ['#155116', 'SKU']], settings: { store: 'Synthetic' }, profileId: '9', isCurrent: () => allowed, onClose: () => closed++, onComplete: result => { complete.push(result); }, onBusyChange: value => busyChanges.push(value) };
  const expand = node => {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: (node.props?.children || []).map(expand) } };
  };
  const render = () => {
    if (!mounted) return tree;
    for (let i = 0; i < 12; i++) { cursor = 0; dirty = false; tree = expand(module.exports.default(props)); while (effects.length) effects.shift()(); if (!dirty) return tree; }
    throw Error('Render did not settle');
  };
  const all = predicate => { const result = []; const walk = node => { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; if (predicate(node)) result.push(node); walk(node.props?.children || []); }; walk(render()); return result; };
  const text = node => Array.isArray(node) ? node.map(text).join(' ') : node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : text(node.props?.children || []);
  const button = label => all(node => node.type === 'Button' && text(node).trim() === label)[0];
  const checkbox = () => all(node => node.type === 'input' && node.props.type === 'checkbox')[0];
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); render(); };
  const click = async label => { const control = button(label); assert.ok(control, `Button ${label}`); assert.notEqual(control.props.disabled, true, `${label} should be enabled`); await control.props.onClick(); await settle(); };
  render(); await settle();
  return { render, text, all, button, checkbox, click, settle, requests, downloads, clicked, complete, busyChanges, props, closeCount: () => closed, invalidate: () => { allowed = false; }, unmount: () => { mounted = false; hooks.forEach(hook => hook?.cleanup?.()); }, lateUpdates: () => lateUpdates };
}

const confirms = state => state.requests.filter(request => request.url.endsWith('/confirm'));
const previews = state => state.requests.filter(request => request.url.endsWith('/preview'));
const accept = async state => { state.checkbox().props.onChange({ target: { checked: true } }); await state.settle(); };

test('omitted whole orders require an explicit answer and unimported confirmation before producing a file', async () => {
  const state = await view();
  assert.match(state.text(state.render()), /1\s+筆相同、\s*0\s+筆內容有異動、\s*1\s+筆未在新版/);
  assert.match(state.text(state.render()), /整筆訂單未在新版中/);
  assert.match(state.text(state.render()), /並非只移除其中一項商品/);
  assert.equal(state.checkbox().props.checked, false);
  assert.equal(state.button('依新版暫不出貨').props['aria-pressed'], false);
  assert.equal(state.button('保留原訂單').props['aria-pressed'], false);
  await accept(state);
  assert.equal(state.button('確認覆蓋並產檔').props.disabled, true);
  await state.click('依新版暫不出貨'); await state.click('確認覆蓋並產檔');
  assert.equal(confirms(state).length, 1);
  const body = confirms(state)[0].body;
  assert.equal(body.confirmed, true); assert.equal(body.notImportedConfirmed, true); assert.equal(body.previewFingerprint, 'preview-one');
  assert.equal(body.decisions['#155293'], 'exclude'); assert.match(body.commandId, /^[\da-f-]{36}$/);
  assert.equal(state.complete.length, 1);
  assert.match(state.text(state.render()), /最新版已準備完成/);
  await state.click('下載最新版銷貨檔');
  assert.equal(state.downloads.length, 1); assert.equal(state.downloads[0].id, 52);
  assert.equal(confirms(state).length, 1, 'Downloading does not repeat the overwrite');
});

test('changed order details show both versions and keep is a deliberate alternative', async () => {
  const data = fixture(); const order = data.affectedBatches[0].uploadedOrders[0];
  order.changed = true; order.after = snapshot(2, 20000);
  order.before.shipping = { recipient: '示意甲', address: '原示意地址' }; order.after.shipping = { recipient: '示意乙', address: '新示意地址' };
  order.live = { totalMinor: 30000, receivedMinor: 20000, outstandingMinor: 10000, quantity: 3 };
  const state = await view({ previews: [data] });
  const content = state.text(state.render());
  assert.match(content, /是否使用新版修正這些訂單/); assert.match(content, /原訂單/); assert.match(content, /新版訂單/); assert.match(content, /掛繩充電線/);
  assert.match(content, /商城目前成交 NT\$\s+300\s*／已收款 NT\$ 200\s*／未收款 NT\$ 100/);
  assert.match(content, /新版出貨銷貨 NT\$\s+200/); assert.match(content, /不會修改商城收款/);
  assert.match(content, /原示意地址/); assert.match(content, /新示意地址/);
  await state.click('保留原訂單'); await accept(state); await state.click('確認覆蓋並產檔');
  assert.equal(confirms(state)[0].body.decisions['#155293'], 'keep');
});

test('identical content can be provided again without inventing an omitted-order decision', async () => {
  const data = fixture(); data.affectedBatches[0].omittedOrders = [];
  const state = await view({ previews: [data] });
  assert.equal(state.button('依新版暫不出貨'), undefined);
  await accept(state); await state.click('確認覆蓋並產檔');
  assert.equal(Object.keys(confirms(state)[0].body.decisions).length, 0);
  assert.equal(confirms(state).length, 1);
  assert.equal(state.requests.some(request => request.url === '/api/marketplace-intakes'), false);
});

test('multiple original batches retain separate download controls and return instructions', async () => {
  const data = fixture(); data.affectedBatches.push({ id: 53, batchNumber: 'WMS-TEST-53', revision: 1, canOverwrite: true, blockedReasons: [], uploadedOrders: [{ orderNumber: '#SECOND', changed: true, before: snapshot(), after: snapshot(2, 10000) }], omittedOrders: [] });
  const result = applied(); result.batches.push({ id: 53, batchNumber: 'WMS-TEST-53', draftRevision: 2, activeOrderCount: 1, excludedOrderNumbers: [] });
  const state = await view({ previews: [data], confirms: [result] });
  await state.click('依新版暫不出貨'); await accept(state); await state.click('確認覆蓋並產檔');
  assert.equal(state.all(node => node.type === 'Button' && state.text(node).trim() === '下載最新版銷貨檔').length, 2);
  assert.match(state.text(state.render()), /請分批下載、匯入及回匯理貨單/);
});

test('uncertain server response freezes answers and retries the exact command once acknowledged', async () => {
  const state = await view({ confirms: [fail(503), applied()] });
  await state.click('依新版暫不出貨'); await accept(state); await state.click('確認覆蓋並產檔');
  assert.equal(state.button('取消').props.disabled, true);
  assert.equal(state.button('保留原訂單').props.disabled, true);
  assert.equal(state.checkbox(), undefined);
  assert.equal(state.complete.length, 0);
  await state.click('核對同一筆操作結果');
  assert.equal(confirms(state).length, 2);
  assert.equal(confirms(state)[0].body, confirms(state)[1].body, 'The original body and UUID are retained');
  assert.equal(state.complete.length, 1);
});

test('a stale comparison refreshes and clears all previous answers and final acknowledgment', async () => {
  const fresh = fixture(); fresh.previewFingerprint = 'preview-two';
  const state = await view({ previews: [fixture(), fresh], confirms: [fail(409), applied()] });
  await state.click('依新版暫不出貨'); await accept(state); await state.click('確認覆蓋並產檔');
  assert.equal(previews(state).length, 2);
  assert.equal(state.checkbox().props.checked, false);
  assert.equal(state.button('依新版暫不出貨').props['aria-pressed'], false);
  assert.equal(state.button('確認覆蓋並產檔').props.disabled, true);
  await state.click('保留原訂單'); await accept(state); await state.click('確認覆蓋並產檔');
  assert.equal(confirms(state)[1].body.previewFingerprint, 'preview-two');
  assert.notEqual(confirms(state)[0].body.commandId, confirms(state)[1].body.commandId);
});

test('one confirmed command is in flight and results cannot escape a changed session', async () => {
  const wait = deferred(); const state = await view({ confirmWait: () => wait.promise });
  await state.click('依新版暫不出貨'); await accept(state);
  const handler = state.button('確認覆蓋並產檔').props.onClick;
  const pending = handler(); await state.settle(); await handler();
  assert.equal(confirms(state).length, 1);
  state.invalidate(); wait.resolve(); await pending; await state.settle();
  assert.equal(state.complete.length, 0); assert.equal(state.downloads.length, 0);
});

test('late preview responses after unmount produce no state updates', async () => {
  const wait = deferred(); const state = await view({ previewWait: () => wait.promise });
  state.unmount(); wait.resolve(); await state.settle();
  assert.equal(state.lateUpdates(), 0); assert.equal(state.complete.length, 0); assert.equal(confirms(state).length, 0);
});

test('blocked batches cannot be overridden by the acknowledgment checkbox', async () => {
  const data = fixture(); data.affectedBatches[0].canOverwrite = false; data.affectedBatches[0].blockedReasons = ['原批次已開始倉庫作業'];
  const state = await view({ previews: [data] });
  assert.equal(state.checkbox().props.disabled, true); assert.equal(state.button('確認覆蓋並產檔').props.disabled, true);
  assert.match(state.text(state.render()), /原批次已開始倉庫作業/); assert.equal(confirms(state).length, 0);
});

test('a fresh unsafe omitted order can be excluded but cannot be kept through a retained handler', async () => {
  const data = fixture(); data.affectedBatches[0].omittedOrders[0].canKeep = false; data.affectedBatches[0].omittedOrders[0].keepBlockedReason = '商城訂單已出貨';
  const state = await view({ previews: [data] });
  assert.equal(state.button('保留原訂單').props.disabled, true);
  await state.button('保留原訂單').props.onClick(); await accept(state);
  assert.equal(state.button('確認覆蓋並產檔').props.disabled, true);
  assert.match(state.text(state.render()), /商城訂單已出貨/);
  await state.click('依新版暫不出貨'); await state.click('確認覆蓋並產檔');
  assert.equal(confirms(state)[0].body.decisions['#155293'], 'exclude');
});

test('standalone downloads use the saved batch link without generating a second sales batch', async () => {
  const state = await view({ native: false });
  await state.click('依新版暫不出貨'); await accept(state); await state.click('確認覆蓋並產檔'); await state.click('下載最新版銷貨檔');
  assert.equal(state.clicked[0], 'https://wms.invalid/api/marketplace-files/synthetic');
  assert.equal(state.requests.filter(request => request.url.endsWith('/52/download-link')).length, 1);
  assert.equal(confirms(state).length, 1);
});
