import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as runtime from '../src/workspace/nativeRuntime.js';
import { downloadNativeMarketplaceFile, responseFilename, saveBlobDownload } from '../src/workspace/downloads.js';

const leases = [];
const originalWindow = globalThis.window, originalDocument = globalThis.document;
afterEach(() => {
    leases.splice(0).reverse().forEach(dispose => dispose());
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
});

function browser() {
    const clicked = [], revoked = [], appended = [];
    const shadow = { activeElement: null, host: {} };
    const portal = { appendChild: anchor => appended.push(anchor), getRootNode: () => document };
    globalThis.document = {
        body: {}, activeElement: null,
        createElement: () => ({ href: '', download: '', click() { clicked.push({ href: this.href, filename: this.download }); }, remove() {} })
    };
    globalThis.window = { location: { pathname: '/standalone', search: '?original=1', hash: '#source', reload() { throw Error('ERP must not reload'); } }, URL: { createObjectURL: () => 'blob:local-only', revokeObjectURL: value => revoked.push(value) } };
    document.activeElement = document.body;
    return { clicked, revoked, appended, portal, shadow };
}
function mount(options) {
    const dispose = runtime.installNativeRuntime(options);
    leases.push(dispose);
    return dispose;
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('operational widget gating applies only to the native viewer entry', () => {
    const { portal } = browser();
    assert.equal(runtime.isNativeViewer({ role: 'viewer' }), false, 'standalone viewer behavior stays intact');
    const dispose = mount({ portalTarget: portal });
    assert.equal(runtime.isNativeViewer({ role: 'viewer' }), true);
    for (const role of ['picker', 'packer', 'dispatcher', 'admin', 'superadmin']) {
        assert.equal(runtime.isNativeViewer({ role }), false, `${role} retains operational widgets`);
    }
    dispose();
    assert.equal(runtime.isNativeViewer({ role: 'viewer' }), false);
});

test('one native lease owns cleanup and an old dispose cannot clear a newer workspace', () => {
    const { portal } = browser();
    const first = mount({ portalTarget: portal });
    assert.throws(() => mount({ portalTarget: {} }), /already mounted/);
    let closes = 0;
    runtime.registerNativeCleanup(() => { closes++; });
    first();
    assert.equal(closes, 1);
    mount({ portalTarget: portal, assetOrigin: 'https://wms.example.invalid/workspace' });
    const second = runtime.getNativeRuntime();
    first();
    assert.equal(runtime.getNativeRuntime(), second);
    assert.equal(closes, 1);
});

test('native assets, path and scanner focus resolve to their owning WMS surface', () => {
    const { portal, shadow } = browser();
    let reloads = 0;
    mount({ portalTarget: portal, workspaceRoot: shadow, assetOrigin: 'https://wms.example.invalid/workspace/', getPath: () => '/order/12?type=missing#items', reload: () => reloads++ });
    assert.equal(runtime.assetUrl('/branding/corely-app.png'), 'https://wms.example.invalid/workspace/branding/corely-app.png');
    assert.equal(runtime.assetUrl('sounds/40umb-rztga.mp3'), 'https://wms.example.invalid/workspace/sounds/40umb-rztga.mp3');
    for (const url of ['blob:local', 'https://cdn.example.invalid/icon.png', 'data:image/png;base64,AAA', '//cdn.example.invalid/icon.png']) assert.equal(runtime.assetUrl(url), url);
    assert.deepEqual(runtime.getWorkspaceLocation(), { pathname: '/order/12', search: '?type=missing', hash: '#items' });
    assert.equal(runtime.getPortalTarget(), portal);
    assert.equal(runtime.getWorkspaceRoot(), shadow);
    assert.equal(runtime.isWorkspaceFocusIdle(), true);
    shadow.activeElement = { tagName: 'INPUT' };
    assert.equal(runtime.isWorkspaceFocusIdle(), false);
    shadow.activeElement = null;
    document.activeElement = { tagName: 'INPUT' };
    assert.equal(runtime.isWorkspaceFocusIdle(), false, 'an ERP field or portal prompt retains focus');
    runtime.reloadWorkspace();
    assert.equal(reloads, 1);
});

test('native hash links and menu outside-click checks stay inside the shadow workspace', () => {
    const { portal, shadow } = browser();
    const events = [];
    shadow.getElementById = id => ({ scrollIntoView: () => events.push(`scroll:${id}`), focus: () => events.push(`focus:${id}`) });
    const originalTarget = { tagName: 'BUTTON' }, retargetedHost = { tagName: 'ERP-HOST' };
    assert.equal(runtime.getEventTarget({ target: retargetedHost, composedPath: () => [originalTarget, retargetedHost] }), originalTarget);
    assert.equal(runtime.getEventTarget({ target: originalTarget }), originalTarget);
    const event = { preventDefault: () => events.push('prevent-default') };
    runtime.handleWorkspaceAnchor(event, 'main-content');
    assert.equal(events.length, 0, 'standalone keeps ordinary anchor behavior');
    mount({ portalTarget: portal, workspaceRoot: shadow });
    runtime.handleWorkspaceAnchor(event, 'main-content', { focus: true });
    assert.deepEqual(events, ['prevent-default', 'scroll:main-content', 'focus:main-content']);
    assert.equal(window.location.hash, '#source');
});

test('native download delegates only id and kind and saves the server filename via a local blob', async () => {
    const { portal, clicked, revoked } = browser();
    const calls = [];
    mount({ portalTarget: portal, download: async args => { calls.push(args); return { data: new Blob(['source-file']), headers: { 'content-disposition': "attachment; filename*=UTF-8''%E9%8A%B7%E8%B2%A8_%E5%8E%9F%E8%A8%82%E5%96%AE.xlsx" } }; } });
    assert.equal(await downloadNativeMarketplaceFile({ id: 19, kind: 'ecount-grouped' }), true);
    assert.deepEqual(calls, [{ id: 19, kind: 'ecount-grouped' }]);
    assert.deepEqual(clicked, [{ href: 'blob:local-only', filename: '銷貨_原訂單.xlsx' }]);
    assert.deepEqual(revoked, ['blob:local-only']);
    assert.doesNotMatch(JSON.stringify(calls) + JSON.stringify(clicked), /token|capability|jwt|download-link|marketplace-files/i);
    assert.equal(responseFilename({ 'Content-Disposition': 'attachment; filename="original.csv"' }), 'original.csv');
    assert.equal(responseFilename({}, 'saved.xlsx'), 'saved.xlsx');
    assert.equal(responseFilename({ 'content-disposition': 'attachment; filename="../unsafe.xlsx"' }), '.._unsafe.xlsx');
});

test('disposed hosts, account changes and changed page context suppress late native downloads', async () => {
    for (const stale of ['dispose', 'account', 'context']) {
        const { portal, clicked } = browser();
        const wait = deferred();
        let sessionCurrent = true, contextCurrent = true;
        const dispose = mount({ portalTarget: portal, isSessionCurrent: () => sessionCurrent, download: () => wait.promise });
        const pending = downloadNativeMarketplaceFile({ id: 19, kind: 'prepick' }, { isCurrent: () => contextCurrent });
        if (stale === 'dispose') dispose();
        else if (stale === 'account') sessionCurrent = false;
        else contextCurrent = false;
        wait.resolve({ data: new Blob(['must-not-download']), headers: {} });
        assert.equal(await pending, false);
        assert.equal(clicked.length, 0);
        dispose();
    }
});

test('401 download errors keep their original status and do not produce files', async () => {
    const { portal, clicked } = browser();
    const error = Object.assign(Error('請重新登入'), { response: { status: 401, data: { message: '請重新登入' } } });
    mount({ portalTarget: portal, download: async () => { throw error; } });
    await assert.rejects(downloadNativeMarketplaceFile({ id: 19, kind: 'ecount' }), value => value === error && value.response.status === 401);
    assert.equal(clicked.length, 0);
});

test('blob reports and attachments obey the same native lease before creating an anchor', () => {
    const { portal, clicked } = browser();
    const dispose = mount({ portalTarget: portal });
    const old = runtime.getNativeRuntime();
    assert.equal(saveBlobDownload(new Blob(['csv']), 'original.csv', { runtime: old }), true);
    dispose();
    mount({ portalTarget: portal });
    assert.equal(saveBlobDownload(new Blob(['old']), 'stale.csv', { runtime: old }), false);
    assert.equal(clicked.length, 1);
});

test('SweetAlert wrapper preserves public fire, mixin and actual React extension hooks', async () => {
    const { portal } = browser();
    const renders = [], unmounts = [], params = [];
    let current;
    class BaseSwal {
        constructor(...args) { this.promise = this._main(this.constructor.argsToParams(args)); }
        _main(values, defaults = {}) {
            this.params = { ...defaults, ...values }; params.push(this.params); current = this;
            this.params.willOpen?.({});
            return new Promise(resolve => { this.resolve = resolve; });
        }
        then(callback) { return this.promise.then(callback); }
        finally(callback) { return this.promise.finally(callback); }
        update(values) { Object.assign(this.params, values); }
        static argsToParams(args) { return typeof args[0] === 'object' ? args[0] : { title: args[0], html: args[1], icon: args[2] }; }
        static fire(...args) { return new this(...args); }
        static mixin(defaults) { return class extends this { _main(values, priorities) { return super._main(values, { ...defaults, ...priorities }); } }; }
        static getContainer() { return { parentNode: current?.params.target }; }
        static getTitle() { return { kind: 'title' }; }
        static update(values) { current.update(values); }
        static close() { current.params.didDestroy?.(); current.resolve({ isDismissed: true }); }
    }
    const source = await readFile(new URL('../src/workspace/nativeSwal.js', import.meta.url), 'utf8');
    const { code } = await transform(source, { format: 'cjs' });
    const module = { exports: {} };
    vm.runInNewContext(code, { module, exports: module.exports, require: name => name.includes('sweetalert2/dist/') ? BaseSwal : runtime });
    const Swal = module.exports.default;
    const reactModule = { exports: {} };
    const extension = await readFile(new URL('../node_modules/sweetalert2-react-content/dist/sweetalert2-react-content.cjs.js', import.meta.url), 'utf8');
    vm.runInNewContext(extension, { module: reactModule, exports: reactModule.exports, setTimeout, require: name => name === 'react' ? { isValidElement: value => value?.reactElement === true } : { createRoot: node => ({ render: value => renders.push({ node, value }), unmount: () => unmounts.push(node) }) } });
    const dispose = mount({ portalTarget: portal });
    const title = { reactElement: true, text: 'Original prompt' };
    const ReactSwal = reactModule.exports(Swal).mixin({ confirmButtonText: '核可' });
    const pending = ReactSwal.fire(title);
    assert.equal(params[0].target, portal);
    assert.equal(params[0].heightAuto, false);
    assert.equal(params[0].scrollbarPadding, false);
    assert.equal(params[0].confirmButtonText, '核可');
    assert.equal(renders[0].value, title);
    dispose();
    assert.equal((await pending).isDismissed, true);
    assert.equal(unmounts.length, renders.length, 'disposal releases every React root, including update renders');
    assert.equal(params[0].returnFocus, false);
    assert.equal(params[0].hideClass.popup, '');
    const standalone = Swal.fire('Standalone', 'Original HTML', 'success');
    assert.equal(params[1].title, 'Standalone');
    assert.equal(params[1].target, undefined);
    BaseSwal.close();
    await standalone;
});
