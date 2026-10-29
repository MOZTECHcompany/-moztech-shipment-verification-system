import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { transform } from 'esbuild';

const source = await readFile(new URL('../src/components/admin/MarketplaceDraftOverwrite.jsx', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'jsx', format: 'cjs' });
const snapshot = (quantity = 4, totalMinor = 307800) => ({ quantity, totalMinor, items: [{ sku: '4711299273674', name: '掛繩充電線', quantity, unitMinor: 76950, lineSubtotalMinor: totalMinor }] });
const fixture = () => ({ scopeMode: 'uploaded-file-v2', previewFingerprint: 'preview-one', summary: { totalOrderCount: 2, newOrderCount: 1, changedOrderCount: 0, unchangedOrderCount: 1, quantity: 3, totalMinor: 30000 }, newOrders: [{ orderNumber: '#NEW', after: snapshot(2, 20000), live: { totalMinor: 20000, receivedMinor: 20000, outstandingMinor: 0, quantity: 2 } }], canConfirm: true, blockedReasons: [], confirmationRequired: true, affectedBatches: [{ id: 52, batchNumber: 'WMS-TEST-52', revision: 1, retainedOrderCount: 1, uploadedOrders: [{ orderNumber: '#155116', changed: false, before: snapshot(1, 10000), after: snapshot(1, 10000), changes: [] }], omittedOrders: [{ orderNumber: '#155293', before: snapshot(), preserved: true }] }] });
const applied = () => { const exportBatch = { id: 90, batchNumber: 'WMS-FULL-90', activeOrderCount: 2, orderCount: 2, quantity: 3, totalMinor: 30000 }; return { applied: true, scopeMode: 'uploaded-file-v2', commandId: 'server-command', exportBatch, batches: [exportBatch], replayed: false }; };
const fail = status => Object.assign(Error('synthetic failure'), { response: { status, data: { message: '合成失敗' } } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function view({ previews = [fixture()], confirms = [applied()], previewWait, confirmWait, downloadResults = [true], native = true } = {}) {
  const hooks = [], effects = [], requests = [], downloads = [], complete = [], busyChanges = [], clicked = [];
  let cursor = 0, dirty = false, tree, mounted = true, allowed = true, lateUpdates = 0, previewIndex = 0, confirmIndex = 0, downloadIndex = 0, closed = 0;
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
    if (url.endsWith('/download-link')) { const value = downloadResults[Math.min(downloadIndex++, downloadResults.length - 1)]; if (value instanceof Error) throw value; return { data: { url: '/api/marketplace-files/synthetic' } }; }
    throw Error(`Unexpected endpoint ${url}`);
  } };
  const imports = {
    react, '../../ui': { Button: 'Button' }, '@/api/api.js': api, '../../api/origin': { API_ORIGIN: 'https://wms.invalid' },
    '../../workspace/nativeRuntime.js': { getNativeRuntime: () => native ? {} : null },
    '../../workspace/downloads.js': { downloadNativeMarketplaceFile: async (args, options) => { if (!options.isCurrent()) return false; downloads.push(args); const value = downloadResults[Math.min(downloadIndex++, downloadResults.length - 1)]; if (value instanceof Error) throw value; return value; } },
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

const confirmLabel = '確認覆蓋並下載整份銷貨檔';

test('mixed file is confirmed once and automatically downloads one complete export batch', async () => {
  const state = await view();
  const text = state.text(state.render());
  assert.match(text, /本次整份檔案\s+2\s+筆：新單\s+1\s+筆、異動\s+0\s+筆、相同\s+1\s+筆/);
  assert.match(text, /3\s+件商品・本次銷貨 NT\$\s+300/);
  assert.match(text, /1\s+筆已保存訂單未在本次檔案中，會保留原狀，也不會列入本次銷貨檔/);
  assert.doesNotMatch(text, /整筆訂單未在新版中|是否依新版暫停|修訂|schema|revision/i);
  assert.equal(state.button('依新版暫不出貨'), undefined); assert.equal(state.button('保留原訂單'), undefined);
  assert.equal(state.all(node => node.type === 'input' && node.props.type === 'checkbox').length, 1);
  assert.equal(state.button(confirmLabel).props.disabled, true);
  await accept(state); await state.click(confirmLabel);
  assert.equal(confirms(state).length, 1);
  const body = confirms(state)[0].body;
  assert.equal(body.scopeMode, 'uploaded-file-v2'); assert.equal(previews(state)[0].body.scopeMode, 'uploaded-file-v2');
  assert.equal(body.confirmed, true); assert.equal(body.notImportedConfirmed, true); assert.equal(body.previewFingerprint, 'preview-one');
  assert.equal(body.decisions, undefined); assert.match(body.commandId, /^[\da-f-]{36}$/);
  assert.equal(state.complete.length, 1); assert.equal(state.downloads.length, 1); assert.equal(state.downloads[0].id, 90);
  assert.match(state.text(state.render()), /整份銷貨檔已準備完成/);
  await state.click('重新下載整份銷貨檔');
  assert.equal(state.downloads.length, 2); assert.equal(confirms(state).length, 1, 'Downloading never repeats the overwrite');
});

test('changed item quantity, price and shipping retain before/after and distinct live money', async () => {
  const data = fixture(); const order = data.affectedBatches[0].uploadedOrders[0];
  order.changed = true; order.after = snapshot(2, 20000); data.summary.changedOrderCount = 1; data.summary.unchangedOrderCount = 0;
  order.before.shipping = { recipient: '示意甲', address: '原示意地址' }; order.after.shipping = { recipient: '示意乙', address: '新示意地址' };
  order.live = { totalMinor: 30000, receivedMinor: 20000, outstandingMinor: 10000, quantity: 3 };
  const state = await view({ previews: [data] }); const content = state.text(state.render());
  assert.match(content, /內容有異動，將使用新版修正/); assert.match(content, /原訂單/); assert.match(content, /新版訂單/); assert.match(content, /掛繩充電線/);
  assert.match(content, /單價 NT\$/); assert.match(content, /小計 NT\$/);
  assert.match(content, /商城目前成交 NT\$\s+300\s*／已收款 NT\$ 200\s*／未收款 NT\$ 100/);
  assert.match(content, /本次出貨銷貨 NT\$\s+200/); assert.match(content, /不會修改商城收款/);
  assert.match(content, /原示意地址/); assert.match(content, /新示意地址/);
  await accept(state); await state.click(confirmLabel); assert.equal(confirms(state)[0].body.decisions, undefined);
});

test('identical-only files can be reproduced without requiring a change or omitted-order answer', async () => {
  const data = fixture(); data.newOrders = []; data.summary = { totalOrderCount: 1, newOrderCount: 0, changedOrderCount: 0, unchangedOrderCount: 1, quantity: 1, totalMinor: 10000 };
  const state = await view({ previews: [data] });
  assert.match(state.text(state.render()), /內容相同，仍列入整份銷貨檔/);
  await accept(state); await state.click(confirmLabel);
  assert.equal(confirms(state).length, 1); assert.equal(state.downloads[0].id, 90);
  assert.equal(state.requests.some(request => request.url === '/api/marketplace-intakes'), false);
});

test('assistant supports all-new complete files too', async () => {
  const data = fixture(); data.affectedBatches = []; data.summary = { totalOrderCount: 1, newOrderCount: 1, changedOrderCount: 0, unchangedOrderCount: 0, quantity: 2, totalMinor: 20000 };
  const state = await view({ previews: [data] });
  await accept(state); await state.click(confirmLabel); assert.equal(confirms(state).length, 1);
});

test('multiple original batches still produce and download just exportBatch', async () => {
  const data = fixture(); data.affectedBatches.push({ id: 53, batchNumber: 'WMS-TEST-53', revision: 1, retainedOrderCount: 0, uploadedOrders: [{ orderNumber: '#SECOND', changed: true, before: snapshot(), after: snapshot(2, 10000) }], omittedOrders: [] });
  data.summary.totalOrderCount = 3; data.summary.changedOrderCount = 1;
  const result = applied(); result.batches.push({ id: 53, batchNumber: 'SHOULD-NOT-DOWNLOAD', activeOrderCount: 1 });
  const state = await view({ previews: [data], confirms: [result] });
  await accept(state); await state.click(confirmLabel);
  assert.equal(state.downloads.length, 1); assert.equal(state.downloads[0].id, 90);
  assert.equal(state.all(node => node.type === 'Button' && state.text(node).trim() === '重新下載整份銷貨檔').length, 1);
  assert.doesNotMatch(state.text(state.render()), /請分批下載|SHOULD-NOT-DOWNLOAD/);
});

test('uncertain response freezes confirmation and retries the exact same command UUID', async () => {
  const state = await view({ confirms: [fail(503), applied()] });
  const cancel = state.button('取消').props.onClick;
  await accept(state); await state.click(confirmLabel);
  assert.equal(state.button('取消').props.disabled, true); assert.equal(state.checkbox(), undefined);
  await cancel(); assert.equal(state.closeCount(), 0);
  assert.equal(state.complete.length, 0); assert.equal(state.downloads.length, 0);
  await state.click('核對同一筆操作結果');
  assert.equal(confirms(state).length, 2); assert.equal(confirms(state)[0].body, confirms(state)[1].body);
  assert.equal(state.complete.length, 1); assert.equal(state.downloads.length, 1);
});

test('an acknowledged command cannot be repeated through its retained confirmation handler', async () => {
  const state = await view(); await accept(state);
  const handler = state.button(confirmLabel).props.onClick;
  await handler(); await state.settle(); await handler(); await state.settle();
  assert.equal(confirms(state).length, 1); assert.equal(state.downloads.length, 1); assert.equal(state.complete.length, 1);
});

test('stale comparison rechecks the whole file and requires a fresh acknowledgment and UUID', async () => {
  const fresh = fixture(); fresh.previewFingerprint = 'preview-two';
  const state = await view({ previews: [fixture(), fresh], confirms: [fail(409), applied()] });
  await accept(state); await state.click(confirmLabel);
  assert.equal(previews(state).length, 2); assert.equal(state.checkbox().props.checked, false); assert.equal(state.button(confirmLabel).props.disabled, true);
  await accept(state); await state.click(confirmLabel);
  assert.equal(confirms(state)[1].body.previewFingerprint, 'preview-two'); assert.notEqual(confirms(state)[0].body.commandId, confirms(state)[1].body.commandId);
});

test('one command is in flight and a changed session cannot receive its result or file', async () => {
  const wait = deferred(); const state = await view({ confirmWait: () => wait.promise }); await accept(state);
  const handler = state.button(confirmLabel).props.onClick; const pending = handler(); await state.settle(); await handler();
  assert.equal(confirms(state).length, 1); state.invalidate(); wait.resolve(); await pending; await state.settle();
  assert.equal(state.complete.length, 0); assert.equal(state.downloads.length, 0);
});

test('late preview responses after unmount produce no state updates', async () => {
  const wait = deferred(); const state = await view({ previewWait: () => wait.promise });
  state.unmount(); wait.resolve(); await state.settle();
  assert.equal(state.lateUpdates(), 0); assert.equal(state.complete.length, 0); assert.equal(confirms(state).length, 0);
});

test('a whole-file blocker identifies the order and cannot be bypassed through a retained handler', async () => {
  const data = fixture(); data.canConfirm = false; data.blockedReasons = [{ orderNumber: '#NEW', message: '商城訂單已出貨' }];
  const state = await view({ previews: [data] });
  assert.equal(state.checkbox().props.disabled, true); assert.equal(state.button(confirmLabel).props.disabled, true);
  await accept(state); await state.button(confirmLabel).props.onClick(); await state.settle();
  assert.match(state.text(state.render()), /#NEW：商城訂單已出貨/); assert.equal(confirms(state).length, 0); assert.equal(state.downloads.length, 0);
});

test('a blocker array also prevents confirmation even if canConfirm is inconsistent', async () => {
  const data = fixture(); data.blockedReasons = ['此筆待核對']; const state = await view({ previews: [data] });
  await accept(state); assert.equal(state.button(confirmLabel).props.disabled, true);
});

test('legacy or incomplete previews cannot be confirmed as complete-file comparisons', async () => {
  for (const alter of [data => delete data.scopeMode, data => delete data.summary, data => data.summary.totalOrderCount++, data => delete data.canConfirm, data => delete data.blockedReasons]) {
    const data = fixture(); alter(data); const state = await view({ previews: [data] });
    assert.match(state.text(state.render()), /整份檔案比對未完成/); assert.equal(state.button(confirmLabel), undefined); assert.equal(confirms(state).length, 0);
  }
});

test('preview and rejected confirm errors include the server order number', async () => {
  const failure = fail(422); failure.response.data = { orderNumber: '#155116', message: '訂單狀態需要核對' };
  const preview = await view({ previews: [failure] }); assert.match(preview.text(preview.render()), /#155116：訂單狀態需要核對/);
  const confirm = await view({ confirms: [failure] }); await accept(confirm); await confirm.click(confirmLabel);
  assert.match(confirm.text(confirm.render()), /#155116：訂單狀態需要核對/); assert.equal(confirm.downloads.length, 0);
});

test('standalone downloads use only the export batch link without a second save', async () => {
  const state = await view({ native: false }); await accept(state); await state.click(confirmLabel);
  assert.equal(state.clicked[0], 'https://wms.invalid/api/marketplace-files/synthetic');
  assert.equal(state.requests.filter(request => request.url.endsWith('/90/download-link')).length, 1); assert.equal(confirms(state).length, 1);
});

test('download failure keeps the known receipt and retries the file without repeating confirmation', async () => {
  const state = await view({ downloadResults: [fail(503), true] }); await accept(state); await state.click(confirmLabel);
  assert.match(state.text(state.render()), /整份銷貨檔已準備完成/); assert.equal(state.button('核對同一筆操作結果'), undefined);
  assert.equal(state.complete.length, 1); await state.click('下載整份銷貨檔');
  assert.equal(confirms(state).length, 1); assert.equal(state.downloads.length, 2); assert.ok(state.downloads.every(download => download.id === 90));
});

test('an incomplete completion response does not download original batches or invent a new command', async () => {
  const incomplete = applied(); delete incomplete.exportBatch; const state = await view({ confirms: [incomplete, applied()] });
  await accept(state); await state.click(confirmLabel); assert.equal(state.downloads.length, 0); assert.equal(state.complete.length, 0);
  await state.click('核對同一筆操作結果'); assert.equal(confirms(state)[0].body, confirms(state)[1].body); assert.equal(state.downloads[0].id, 90);
});
