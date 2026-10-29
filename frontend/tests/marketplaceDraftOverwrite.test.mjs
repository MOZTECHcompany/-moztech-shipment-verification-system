import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { transform } from 'esbuild';
import * as draftDiff from '../src/utils/marketplaceDraftDiff.mjs';

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
    useId() { const i = cursor++; return (hooks[i] ||= { value: `confirmation-${i}` }).value; },
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
    react, '../../utils/marketplaceDraftDiff.mjs': draftDiff, '../../ui': { Button: 'Button' }, '@/api/api.js': api, '../../api/origin': { API_ORIGIN: 'https://wms.invalid' },
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
  const visibleText = node => Array.isArray(node) ? node.map(visibleText).join(' ') : node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : node.type === 'details' && !node.props.open ? visibleText((node.props.children || []).filter(child => child?.type === 'summary')) : visibleText(node.props?.children || []);
  const button = label => all(node => node.type === 'Button' && text(node).trim() === label)[0];
  const checkbox = () => all(node => node.type === 'input' && node.props.type === 'checkbox')[0];
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); render(); };
  const click = async label => { const control = button(label); assert.ok(control, `Button ${label}`); assert.notEqual(control.props.disabled, true, `${label} should be enabled`); await control.props.onClick(); await settle(); };
  render(); await settle();
  return { render, text, visibleText, all, button, checkbox, click, settle, requests, downloads, clicked, complete, busyChanges, props, closeCount: () => closed, invalidate: () => { allowed = false; }, unmount: () => { mounted = false; hooks.forEach(hook => hook?.cleanup?.()); }, lateUpdates: () => lateUpdates };
}

const confirms = state => state.requests.filter(request => request.url.endsWith('/confirm'));
const previews = state => state.requests.filter(request => request.url.endsWith('/preview'));

const confirmLabel = '確認未匯入並轉檔';

test('mixed file is confirmed once and automatically downloads one complete export batch', async () => {
  const state = await view();
  const text = state.text(state.render());
  assert.match(text, /重複\s+1\s+筆・需核對\s+0\s+筆・新增\s+1\s+筆/);
  assert.match(text, /整份\s+2\s+筆・\s*3\s+件・NT\$\s+300/);
  assert.match(text, /1\s+筆舊單未上傳，保留原狀，不列入本次銷貨檔/);
  assert.doesNotMatch(text, /整筆訂單未在新版中|是否依新版暫停|修訂|schema|revision/i);
  assert.equal(state.button('依新版暫不出貨'), undefined); assert.equal(state.button('保留原訂單'), undefined);
  assert.equal(state.checkbox(), undefined);
  assert.equal(confirms(state).length, 0, 'Preview alone never confirms or downloads');
  assert.equal(state.downloads.length, 0);
  assert.equal(state.button(confirmLabel).props.disabled, false);
  const description = state.all(node => node.props?.id === state.button(confirmLabel).props['aria-describedby'])[0];
  assert.equal(state.text(description), '確認此批尚未匯入 ECOUNT，新檔取代舊檔。');
  await state.click(confirmLabel);
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

test('changed orders show only changed fields and distinct live money without full snapshots', async () => {
  const data = fixture(); const order = data.affectedBatches[0].uploadedOrders[0];
  order.changed = true; order.before = snapshot(2, 20000); order.after = snapshot(1, 9000);
  order.before.items[0].unitMinor = 10000; order.after.items[0].unitMinor = 9000;
  data.summary.changedOrderCount = 1; data.summary.unchangedOrderCount = 0; data.summary.totalMinor = 29000;
  order.before.shipping = { recipient: '不變的收件人', phone: '0912345000', address: '原示意地址' }; order.after.shipping = { ...order.before.shipping, address: '新示意地址' };
  order.live = { totalMinor: 30000, receivedMinor: 20000, outstandingMinor: 10000, quantity: 3 };
  const state = await view({ previews: [data] }); const content = state.text(state.render());
  assert.match(content, /重複／\s*有異動/); assert.match(content, /掛繩充電線/); assert.match(content, /數量\s+2\s+→\s+1/);
  assert.match(content, /單價\s+NT\$ 100\s+→\s+NT\$ 90/); assert.match(content, /金額\s+NT\$ 200\s+→\s+NT\$ 90/);
  assert.match(content, /商城目前成交 NT\$\s+300\s*／已收款 NT\$ 200\s*／未收款 NT\$ 100/);
  assert.match(content, /出貨金額 NT\$\s+200\s+→ NT\$\s+90/); assert.match(content, /不會修改商城收款/);
  assert.match(content, /原示意地址\s+→\s+新示意地址/);
  assert.doesNotMatch(content, /原訂單|新版訂單|不變的收件人|0912345000|原批次/);
  const main = state.visibleText(state.render());
  assert.match(main, /數量\s+2\s+→\s+1/); assert.match(main, /商城仍 NT\$ 300/);
  assert.doesNotMatch(main, /4711299273674|已收款|未收款/);
  assert.ok(state.all(node => node.type === 'details').every(node => !node.props.open));
  await state.click(confirmLabel); assert.equal(confirms(state)[0].body.decisions, undefined);
});

test('identical-only files can be reproduced without requiring a change or omitted-order answer', async () => {
  const data = fixture(); data.newOrders = []; data.summary = { totalOrderCount: 1, newOrderCount: 0, changedOrderCount: 0, unchangedOrderCount: 1, quantity: 1, totalMinor: 10000 };
  const state = await view({ previews: [data] });
  assert.match(state.visibleText(state.render()), /相同\s+1\s+筆，一併轉檔・查看單號/);
  assert.doesNotMatch(state.visibleText(state.render()), /#155116|WMS-TEST-52|掛繩充電線/);
  const same = state.all(node => node.props?.['aria-label'] === '相同訂單單號')[0];
  assert.ok(same); assert.notEqual(same.props.open, true); assert.match(state.text(same), /#155116/);
  assert.doesNotMatch(state.text(same), /掛繩充電線|NT\$|WMS-TEST/);
  await state.click(confirmLabel);
  assert.equal(confirms(state).length, 1); assert.equal(state.downloads[0].id, 90);
  assert.equal(state.requests.some(request => request.url === '/api/marketplace-intakes'), false);
});

test('assistant supports all-new complete files too', async () => {
  const data = fixture(); data.affectedBatches = []; data.summary = { totalOrderCount: 1, newOrderCount: 1, changedOrderCount: 0, unchangedOrderCount: 0, quantity: 2, totalMinor: 20000 };
  const state = await view({ previews: [data] });
  await state.click(confirmLabel); assert.equal(confirms(state).length, 1);
});

test('multiple original batches still produce and download just exportBatch', async () => {
  const data = fixture(); data.affectedBatches.push({ id: 53, batchNumber: 'WMS-TEST-53', revision: 1, retainedOrderCount: 0, uploadedOrders: [{ orderNumber: '#SECOND', changed: true, before: snapshot(), after: snapshot(2, 10000) }], omittedOrders: [] });
  data.summary.totalOrderCount = 3; data.summary.changedOrderCount = 1; data.summary.quantity = 5; data.summary.totalMinor = 40000;
  const result = applied(); result.batches.push({ id: 53, batchNumber: 'SHOULD-NOT-DOWNLOAD', activeOrderCount: 1 });
  const state = await view({ previews: [data], confirms: [result] });
  await state.click(confirmLabel);
  assert.equal(state.downloads.length, 1); assert.equal(state.downloads[0].id, 90);
  assert.equal(state.all(node => node.type === 'Button' && state.text(node).trim() === '重新下載整份銷貨檔').length, 1);
  assert.doesNotMatch(state.text(state.render()), /請分批下載|SHOULD-NOT-DOWNLOAD/);
});

test('uncertain response freezes confirmation and retries the exact same command UUID', async () => {
  const state = await view({ confirms: [fail(503), applied()] });
  const cancel = state.button('取消').props.onClick;
  await state.click(confirmLabel);
  assert.equal(state.button('取消').props.disabled, true); assert.equal(state.checkbox(), undefined);
  await cancel(); assert.equal(state.closeCount(), 0);
  assert.equal(state.complete.length, 0); assert.equal(state.downloads.length, 0);
  await state.click('核對同一筆操作結果');
  assert.equal(confirms(state).length, 2); assert.equal(confirms(state)[0].body, confirms(state)[1].body);
  assert.equal(state.complete.length, 1); assert.equal(state.downloads.length, 1);
});

test('an acknowledged command cannot be repeated through its retained confirmation handler', async () => {
  const state = await view();
  const handler = state.button(confirmLabel).props.onClick;
  await handler(); await state.settle(); await handler(); await state.settle();
  assert.equal(confirms(state).length, 1); assert.equal(state.downloads.length, 1); assert.equal(state.complete.length, 1);
});

test('stale comparison rechecks the file and waits for another explicit click with a fresh UUID', async () => {
  const fresh = fixture(); fresh.previewFingerprint = 'preview-two';
  const state = await view({ previews: [fixture(), fresh], confirms: [fail(409), applied()] });
  const retained = state.button(confirmLabel).props.onClick;
  await state.click(confirmLabel);
  assert.equal(previews(state).length, 2); assert.equal(confirms(state).length, 1);
  assert.equal(state.checkbox(), undefined); assert.equal(state.button(confirmLabel).props.disabled, false);
  await retained(); await state.settle(); assert.equal(confirms(state).length, 1, 'Old comparison callback cannot confirm a newer preview');
  await state.click(confirmLabel);
  assert.equal(confirms(state)[1].body.previewFingerprint, 'preview-two'); assert.notEqual(confirms(state)[0].body.commandId, confirms(state)[1].body.commandId);
});

test('one command is in flight and a changed session cannot receive its result or file', async () => {
  const wait = deferred(); const state = await view({ confirmWait: () => wait.promise });
  const handler = state.button(confirmLabel).props.onClick; const pending = handler(); await state.settle(); await handler();
  assert.equal(confirms(state).length, 1); state.invalidate(); wait.resolve(); await pending; await state.settle();
  assert.equal(state.complete.length, 0); assert.equal(state.downloads.length, 0);
});

test('late preview responses after unmount produce no state updates', async () => {
  const wait = deferred(); const state = await view({ previewWait: () => wait.promise });
  state.unmount(); wait.resolve(); await state.settle();
  assert.equal(state.lateUpdates(), 0); assert.equal(state.complete.length, 0); assert.equal(confirms(state).length, 0);
});

test('a whole-file blocker identifies the order and offers only recheck instead of a disabled conversion', async () => {
  const data = fixture(); data.canConfirm = false; data.blockedReasons = [{ orderNumber: '#NEW', message: '商城訂單已出貨' }];
  const state = await view({ previews: [data] });
  assert.equal(state.checkbox(), undefined); assert.equal(state.button(confirmLabel), undefined);
  assert.ok(state.button('重新核對'));
  assert.match(state.text(state.render()), /#NEW：商城訂單已出貨/); assert.equal(confirms(state).length, 0); assert.equal(state.downloads.length, 0);
});

test('a blocker array also prevents confirmation even if canConfirm is inconsistent', async () => {
  const data = fixture(); data.blockedReasons = ['此筆待核對']; const state = await view({ previews: [data] });
  assert.equal(state.button(confirmLabel), undefined); assert.ok(state.button('重新核對'));
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
  const confirm = await view({ confirms: [failure] }); await confirm.click(confirmLabel);
  assert.match(confirm.text(confirm.render()), /#155116：訂單狀態需要核對/); assert.equal(confirm.downloads.length, 0);
});

test('standalone downloads use only the export batch link without a second save', async () => {
  const state = await view({ native: false }); await state.click(confirmLabel);
  assert.equal(state.clicked[0], 'https://wms.invalid/api/marketplace-files/synthetic');
  assert.equal(state.requests.filter(request => request.url.endsWith('/90/download-link')).length, 1); assert.equal(confirms(state).length, 1);
});

test('download failure keeps the known receipt and retries the file without repeating confirmation', async () => {
  const state = await view({ downloadResults: [fail(503), true] }); await state.click(confirmLabel);
  assert.match(state.text(state.render()), /整份銷貨檔已準備完成/); assert.equal(state.button('核對同一筆操作結果'), undefined);
  assert.equal(state.complete.length, 1); await state.click('下載整份銷貨檔');
  assert.equal(confirms(state).length, 1); assert.equal(state.downloads.length, 2); assert.ok(state.downloads.every(download => download.id === 90));
});

test('an incomplete completion response does not download original batches or invent a new command', async () => {
  const incomplete = applied(); delete incomplete.exportBatch; const state = await view({ confirms: [incomplete, applied()] });
  await state.click(confirmLabel); assert.equal(state.downloads.length, 0); assert.equal(state.complete.length, 0);
  await state.click('核對同一筆操作結果'); assert.equal(confirms(state)[0].body, confirms(state)[1].body); assert.equal(state.downloads[0].id, 90);
});


test('projection-empty blocked45 response shows one short reason without fake changed orders or zero money', async () => {
  const data = fixture(); data.newOrders = []; data.canConfirm = false;
  data.affectedBatches[0].uploadedOrders = Array.from({ length: 45 }, (_, index) => ({ orderNumber: `#BLOCKED-${index}`, changed: true, before: snapshot(), after: { items: [], quantity: 0, totalMinor: null, shipping: {} } }));
  data.summary = { totalOrderCount: 45, newOrderCount: 0, changedOrderCount: 45, unchangedOrderCount: 0, quantity: 0, totalMinor: 0 };
  data.blockedReasons = ['已出貨訂單不能覆蓋', '已出貨訂單不能覆蓋', ' 已出貨訂單不能覆蓋 '];
  const state = await view({ previews: [data] }); const content = state.text(state.render());
  assert.match(content, /尚無法完成比對/); assert.equal(content.match(/已出貨訂單不能覆蓋/g).length, 1);
  assert.doesNotMatch(content, /異動\s*45|#BLOCKED|NT\$|0\s*件|移除|原有|改為/);
  assert.equal(state.checkbox(), undefined); assert.equal(state.button(confirmLabel), undefined);
  assert.ok(state.button('重新核對'));
  assert.equal(state.all(node => node.type === 'Button' && !node.props.disabled).length, 2, 'Only cancel and recheck remain');
  assert.equal(confirms(state).length, 0); assert.equal(state.downloads.length, 0);
});

test('removing one strap shows that removal and amount change but never unchanged product or recipient', async () => {
  const data = fixture(), order = data.affectedBatches[0].uploadedOrders[0];
  const fixed = { sku: 'POWER', name: '不變的行動電源', quantity: 1, unitMinor: 10000, lineSubtotalMinor: 10000 };
  const strap = { sku: 'STRAP', name: '掛繩充電線', quantity: 1, unitMinor: 3000, lineSubtotalMinor: 3000 };
  order.changed = true; order.before = { items: [fixed, strap], quantity: 2, totalMinor: 13000, shipping: { recipient: '不變的收件人' } };
  order.after = { items: [fixed], quantity: 1, totalMinor: 10000, shipping: { recipient: '不變的收件人' } };
  data.newOrders = []; data.summary = { totalOrderCount: 1, newOrderCount: 0, changedOrderCount: 1, unchangedOrderCount: 0, quantity: 1, totalMinor: 10000 };
  const state = await view({ previews: [data] }); const content = state.text(state.render());
  assert.match(content, /移除\s+掛繩充電線/); assert.match(content, /130\s+→\s+NT\$\s+100/);
  assert.doesNotMatch(content, /不變的行動電源|不變的收件人|原訂單|新版訂單/);
});

test('restoring and unknown changed orders remain visible when no known fields differ', async () => {
  const data = fixture(); data.newOrders = [];
  const snapshotValue = snapshot(1, 10000);
  data.affectedBatches[0].uploadedOrders = [{ orderNumber: '#RESTORE', changed: true, restoring: true, changes: [], before: snapshotValue, after: snapshotValue }, { orderNumber: '#UNKNOWN', changed: true, changes: [], before: snapshotValue, after: snapshotValue }];
  data.summary = { totalOrderCount: 2, newOrderCount: 0, changedOrderCount: 2, unchangedOrderCount: 0, quantity: 2, totalMinor: 20000 };
  const state = await view({ previews: [data] }); const content = state.text(state.render());
  assert.match(content, /#RESTORE/); assert.match(content, /恢復出貨/); assert.match(content, /#UNKNOWN/); assert.match(content, /其他內容有異動/);
});

test('all genuine changed values remain visible while auxiliary details stay closed', async () => {
  const data = fixture(); data.newOrders = [];
  data.affectedBatches[0].uploadedOrders = Array.from({ length: 25 }, (_, index) => ({ orderNumber: `#CHANGE-${index}`, changed: true, before: snapshot(2, 20000), after: snapshot(1, 10000) }));
  data.summary = { totalOrderCount: 25, newOrderCount: 0, changedOrderCount: 25, unchangedOrderCount: 0, quantity: 25, totalMinor: 250000 };
  const state = await view({ previews: [data] });
  assert.equal(state.all(node => /^訂單異動 /.test(node.props?.['aria-label'] || '')).length, 25);
  assert.ok(state.all(node => node.type === 'details').every(node => !node.props.open));
  const main = state.visibleText(state.render());
  assert.equal((main.match(/數量\s+2\s+→\s+1/g) || []).length, 25);
  assert.equal(state.button(confirmLabel).props.disabled, false);
});

test('safe cancel works after current-session predicate becomes false when no command is pending', async () => {
  const state = await view(); state.invalidate();
  await state.click('取消'); assert.equal(state.closeCount(), 1); assert.equal(confirms(state).length, 0);
});

test('completed preview clears busy after session expiry so safe cancel is available, without accepting data', async () => {
  const wait = deferred(); const state = await view({ previewWait: () => wait.promise });
  assert.equal(state.button('取消').props.disabled, true); state.invalidate(); wait.resolve(); await state.settle();
  assert.equal(state.button('取消').props.disabled, false); await state.click('取消'); assert.equal(state.closeCount(), 1);
  assert.equal(state.checkbox(), undefined); assert.equal(confirms(state).length, 0); assert.equal(state.downloads.length, 0);
});

test('session expiry during a submitted command cannot unlock cancel or issue another command', async () => {
  const wait = deferred(); const state = await view({ confirmWait: () => wait.promise });
  const handler = state.button(confirmLabel).props.onClick; const pending = handler(); await state.settle();
  state.invalidate(); wait.resolve(); await pending; await state.settle();
  assert.equal(state.button('取消').props.disabled, true); await state.button('取消').props.onClick(); await handler(); await state.settle();
  assert.equal(state.closeCount(), 0); assert.equal(confirms(state).length, 1); assert.equal(state.complete.length, 0); assert.equal(state.downloads.length, 0);
});


test('new API quantities or money that differ stay distinguishable without exposing ordinary payment snapshots', async () => {
  const data = fixture(); data.newOrders[0].live = { totalMinor: 25000, receivedMinor: 25000, outstandingMinor: 0, quantity: 3 };
  const state = await view({ previews: [data] }); const content = state.text(state.render());
  assert.match(content, /商城目前成交 NT\$\s+250/); assert.match(content, /本次出貨\s+2\s+件／商城現況\s+3\s+件/);
  assert.equal(state.all(node => node.type === 'details' && node.props.open === true).length, 0);
  const main = state.visibleText(state.render());
  assert.match(main, /重複\s+1\s+筆・需核對\s+1\s+筆・新增\s+1\s+筆/);
  assert.match(main, /#NEW/); assert.match(main, /出貨金額 NT\$\s+200\s*／商城 NT\$\s+250/);
  assert.match(main, /本次出貨\s+2\s+件／商城現況\s+3\s+件/); assert.doesNotMatch(main, /已收款|未收款|4711299273674/);
  const unchanged = await view(); assert.doesNotMatch(unchanged.text(unchanged.render()), /商城目前成交|已收款|未收款/);
});


test('same saved draft with a different current API amount or quantity remains a compact required comparison', async () => {
  for (const live of [{ totalMinor: 15000, quantity: 1 }, { totalMinor: 10000, quantity: 3 }]) {
    const data = fixture(); data.newOrders = []; data.summary = { totalOrderCount: 1, newOrderCount: 0, changedOrderCount: 0, unchangedOrderCount: 1, quantity: 1, totalMinor: 10000 };
    const value = snapshot(1, 10000); data.affectedBatches[0].uploadedOrders = [{ orderNumber: '#API-DIFF', changed: false, diffAPI: true, before: value, after: value, live }];
    const state = await view({ previews: [data] }); const content = state.text(state.render());
    assert.match(content, /#API-DIFF/); assert.match(content, /需核對商城現況/); assert.match(content, /不會修改商城收款/);
    if (live.totalMinor !== 10000) { assert.match(state.visibleText(state.render()), /出貨金額 NT\$\s+100\s*／商城 NT\$\s+150/); }
    else assert.match(content, /本次出貨\s+1\s+件／商城現況\s+3\s+件/);
    assert.doesNotMatch(content, /掛繩充電線|原訂單|新版訂單/); assert.ok(state.all(node=>node.type==='details').every(node=>!node.props.open));
    assert.match(state.visibleText(state.render()), /重複\s+1\s+筆・需核對\s+1\s+筆・新增\s+0/);
  }
});

test('a diffAPI flag without actual API values does not invent current amounts or list normal identical orders', async () => {
  const data = fixture(); data.newOrders = []; data.summary = { totalOrderCount: 1, newOrderCount: 0, changedOrderCount: 0, unchangedOrderCount: 1, quantity: 1, totalMinor: 10000 };
  data.affectedBatches[0].uploadedOrders[0].diffAPI = true; data.affectedBatches[0].uploadedOrders[0].live = {};
  const state = await view({ previews: [data] }); assert.doesNotMatch(state.visibleText(state.render()), /#155116|需核對商城現況|商城目前成交|商城現況/);
  assert.match(state.text(state.render()), /#155116/); assert.match(state.visibleText(state.render()), /需核對\s+0\s+筆/);
});


test('a retained click from an earlier preview cannot bypass newly discovered whole-file blockers', async () => {
  const blocked = fixture(); blocked.previewFingerprint = 'blocked-next'; blocked.canConfirm = false;
  blocked.blockedReasons = [{ orderNumber: '#155116', message: '原單已開始倉庫作業' }];
  const state = await view({ previews: [fixture(), blocked], confirms: [fail(409)] });
  const retained = state.button(confirmLabel).props.onClick;
  await state.click(confirmLabel); assert.equal(state.button(confirmLabel), undefined);
  await retained(); await state.settle();
  assert.equal(confirms(state).length, 1); assert.equal(state.downloads.length, 0);
  assert.match(state.visibleText(state.render()), /#155116：原單已開始倉庫作業/);
  assert.equal(state.all(node => node.props?.['aria-label'] === '需核對訂單').length, 0);
});

test('ambiguous same-SKU group keeps every residual material value visible without inventing row matches', async () => {
  const data = fixture(); data.newOrders = [];
  const make = (name, quantity, unitMinor, lineSubtotalMinor) => ({ sku: 'DUPLICATE-SKU', name, quantity, unitMinor, lineSubtotalMinor });
  const stable = make('不變品項', 5, 10000, 50000);
  const order = data.affectedBatches[0].uploadedOrders[0]; order.changed = true;
  order.before = { items: [stable, make('甲款', 1, 12000, 12000), make('乙款', 2, 9000, 18000)], quantity: 8, totalMinor: 80000 };
  order.after = { items: [make('丙款', 3, 5000, 15000), stable], quantity: 8, totalMinor: 65000 };
  data.summary = { totalOrderCount: 1, newOrderCount: 0, changedOrderCount: 1, unchangedOrderCount: 0, quantity: 8, totalMinor: 65000 };
  const state = await view({ previews: [data] }); const main = state.visibleText(state.render());
  assert.match(main, /同品號多筆明細異動/);
  for (const name of ['甲款', '乙款', '丙款']) assert.match(main, new RegExp(name));
  assert.match(main, /1 件・單價 NT\$ 120・金額 NT\$ 120/); assert.match(main, /2 件・單價 NT\$ 90・金額 NT\$ 180/);
  assert.match(main, /3 件・單價 NT\$ 50・金額 NT\$ 150/);
  assert.doesNotMatch(main, /DUPLICATE-SKU|不變品項/);
  assert.equal((main.match(/→/g) || []).length, 1, 'Only the order total has an arrow; no invented per-row match');
  assert.match(state.text(state.render()), /DUPLICATE-SKU/);
});
