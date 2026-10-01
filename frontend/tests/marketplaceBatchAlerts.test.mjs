import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as scope from '../src/utils/managementScope.js';
import * as sessions from '../src/utils/importBatches.js';

const source = await readFile(new URL('../src/components/MarketplaceBatchAlerts.jsx', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'jsx', format: 'cjs' });
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const fixture = (id = 1) => ({ noticeId: id, intakeId: id + 10, stage: id === 2 ? 'ready_for_print' : 'prepared', batchNumber: `WMS-${id}`, platform: 'SHOPLINE', store: 'Store', href: `/warehouse-intakes/${id + 10}` });

function alerts({ role = 'admin', management_scope = 'warehouse', online = true } = {}) {
  let user = { id: 7, role, management_scope }, token = 'token-A', cursor = 0, tree, mounted = true, lateUpdates = 0;
  const hooks = [], effects = [], reads = [], posts = [], errors = [], timers = new Map(), events = new Map(), sockets = new Map();
  const storage = new Map([['wms_user', JSON.stringify(user)], ['wms_token', JSON.stringify('token-A')]]);
  const network = { onLine: online };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const i = cursor++; hooks[i] ||= { value: typeof initial === 'function' ? initial() : initial }; return [hooks[i].value, next => { if (!mounted) lateUpdates++; hooks[i].value = typeof next === 'function' ? next(hooks[i].value) : next; }]; },
    useRef(initial) { const i = cursor++; return hooks[i] ||= { current: initial }; },
    useEffect(callback, deps) { const i = cursor++; if (!hooks[i] || !deps.every((dep, n) => dep === hooks[i].deps[n])) { const cleanup = hooks[i]?.cleanup; hooks[i] = { deps }; effects.push(() => { cleanup?.(); hooks[i].cleanup = callback(); }); } },
  };
  const deferred = (bucket, fields) => new Promise((resolve, reject) => bucket.push({ ...fields, resolve, reject }));
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: name => ({
      react, 'react-router-dom': { Link: 'Link' }, sonner: { toast: { error: message => errors.push(message) } },
      '@/api/api.js': { get: (url, options) => deferred(reads, { url, options }), post: url => deferred(posts, { url }) },
      '@/api/socket.js': { socket: { on: (key, cb) => sockets.set(key, cb), off: (key, cb) => { if (sockets.get(key) === cb) sockets.delete(key); } } },
      '@/utils/managementScope': scope, '../utils/importBatches': sessions,
    })[name],
    sessionStorage: { getItem: key => storage.get(key) ?? null }, navigator: network,
    setInterval: (cb, delay) => { const id = timers.size + 1; timers.set(id, { cb, delay }); return id; }, clearInterval: id => timers.delete(id),
    window: { addEventListener: (key, cb) => events.set(key, cb), removeEventListener: (key, cb) => { if (events.get(key) === cb) events.delete(key); } },
  });
  const render = () => { cursor = 0; tree = module.exports.default({ user, token }); while (effects.length) effects.shift()(); cursor = 0; return tree = module.exports.default({ user, token }); };
  const findAll = predicate => { const found = []; const walk = node => { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; if (predicate(node)) found.push(node); walk(node.props?.children); }; walk(render()); return found; };
  const text = node => Array.isArray(node) ? node.map(text).join(' ') : node == null || typeof node === 'boolean' ? '' : typeof node === 'object' ? text(node.props?.children) : String(node);
  render();
  return { render, text, findAll, reads, posts, storage, network, events, sockets, timers, errors,
    switchUser(next) { user = next; storage.set('wms_user', JSON.stringify(user)); render(); },
    refreshToken(next) { token = next; storage.set('wms_token', JSON.stringify(next)); render(); },
    unmount() { mounted = false; hooks.forEach(hook => hook.cleanup?.()); }, lateUpdates: () => lateUpdates };
}

test('only warehouse managers fetch batch notices and empty results add no empty section', async () => {
  for (const options of [{ role: 'picker' }, { role: 'packer' }, { role: 'dispatcher' }, { management_scope: 'orders' }]) {
    const view = alerts(options); assert.equal(view.render(), null); assert.equal(view.reads.length, 0); assert.equal(view.timers.size, 0);
  }
  for (const options of [{ role: 'superadmin' }, { management_scope: 'all' }, { management_scope: 'warehouse' }]) {
    const view = alerts(options); assert.equal(view.reads.length, 1); assert.equal(view.reads[0].url, '/api/marketplace-batch-notices');
    view.reads[0].resolve({ data: { notices: [] } }); await settle(); assert.equal(view.render(), null);
  }
});

test('five concise notices link to their batch, acknowledge without blocking navigation, and show the next pending notice', async () => {
  const view = alerts(); view.reads[0].resolve({ data: { notices: Array.from({ length: 7 }, (_, i) => fixture(i + 1)) } }); await settle();
  let links = view.findAll(node => node.type === 'Link' && view.text(node) === '開啟批次');
  assert.equal(links.length, 5); assert.equal(links[0].props.to, '/warehouse-intakes/11');
  assert.match(view.text(view.render()), /待 ECOUNT 回匯/); assert.match(view.text(view.render()), /可列印與預揀/);
  let prevented = false;
  assert.equal(links[0].props.onClick({ preventDefault() { prevented = true; } }), undefined);
  assert.equal(prevented, false); assert.equal(view.posts[0].url, '/api/marketplace-batch-notices/1/seen');
  links[0].props.onClick({ preventDefault() {} }); assert.equal(view.posts.length, 1);
  view.posts[0].resolve({ data: { ok: true } }); await settle();
  assert.doesNotMatch(view.text(view.render()), /WMS-1(?:\s|$)/);
  links = view.findAll(node => node.type === 'Link' && view.text(node) === '開啟批次'); assert.equal(links.length, 5);
  assert.ok(view.findAll(node => node.props?.to === '/warehouse-intakes').length);
});

test('polling recovers offline and transient failure, and a socket event refreshes without installing a separate connection', async () => {
  const view = alerts({ online: false }); assert.equal(view.reads.length, 0);
  assert.equal([...view.timers.values()][0].delay, 30000);
  view.network.onLine = true; view.events.get('online')(); assert.equal(view.reads.length, 1);
  view.reads[0].reject(Error('offline')); await settle(); assert.match(view.text(view.render()), /暫時無法更新/);
  [...view.timers.values()][0].cb(); assert.equal(view.reads.length, 2);
  view.reads[1].resolve({ data: { notices: [fixture()] } }); await settle(); assert.doesNotMatch(view.text(view.render()), /暫時無法更新/);
  view.sockets.get('marketplace_batch_notice')(); assert.equal(view.reads.length, 3);
  view.unmount(); view.reads[2].resolve({ data: { notices: [fixture(2)] } }); await settle();
  assert.equal(view.lateUpdates(), 0); assert.equal(view.timers.size, 0); assert.equal(view.sockets.size, 0); assert.equal(view.events.size, 0);
});

test('session changes clear cached notices and discard late responses and acknowledgements', async () => {
  const view = alerts(); view.reads[0].resolve({ data: { notices: [fixture()] } }); await settle();
  view.findAll(node => node.type === 'Link' && view.text(node) === '開啟批次')[0].props.onClick({ preventDefault() {} });
  [...view.timers.values()][0].cb();
  view.storage.set('wms_token', JSON.stringify('token-B')); view.events.get('storage')(); assert.equal(view.render(), null);
  view.reads[1].resolve({ data: { notices: [fixture(2)] } }); view.posts[0].reject(Error('late failure')); await settle();
  assert.equal(view.render(), null); assert.equal(view.errors.length, 0);
  [...view.timers.values()][0].cb(); assert.equal(view.reads.length, 2);
});

test('lost authorization clears data and stops polling, while ack failure keeps the notice with a short result', async () => {
  const denied = alerts(); denied.reads[0].reject({ response: { status: 403 } }); await settle();
  assert.equal(denied.render(), null); [...denied.timers.values()][0].cb(); assert.equal(denied.reads.length, 1);
  const view = alerts(); view.reads[0].resolve({ data: { notices: [fixture()] } }); await settle();
  view.findAll(node => node.type === 'Link' && view.text(node) === '開啟批次')[0].props.onClick({ preventDefault() {} });
  view.posts[0].reject(Error('temporary failure')); await settle();
  assert.match(view.text(view.render()), /WMS-1/); assert.equal(view.errors.length, 1); assert.match(view.errors[0], /通知尚未標記已讀/);
  view.switchUser({ id: 7, role: 'admin', management_scope: 'orders' }); assert.equal(view.render(), null); assert.equal(view.timers.size, 0);
});


test('a refreshed credential starts a fresh notice reader without accepting an older response', async () => {
  const view = alerts();
  view.refreshToken('token-B'); assert.equal(view.reads.length, 2);
  view.reads[0].resolve({ data: { notices: [fixture()] } }); await settle(); assert.equal(view.render(), null);
  view.reads[1].resolve({ data: { notices: [fixture(2)] } }); await settle();
  assert.match(view.text(view.render()), /WMS-2/); assert.doesNotMatch(view.text(view.render()), /WMS-1/);
  assert.equal(view.timers.size, 1); assert.equal(view.sockets.size, 1);
});
