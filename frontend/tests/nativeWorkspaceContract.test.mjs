import test from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { workspacePath, exactWorkspaceOrigin, validateWorkspaceManifest, createWorkspaceSession } from '../src/workspace/contract.mjs';
import { shadowCss, portalCss, workspaceManifestPlugin } from '../config/workspaceBuild.mjs';

const user = { id: 7, role: 'dispatcher', erpSubject: 'erp-user', entityId: 'company' };
const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };
test('native navigation retains batch, return, exception and deep-link context without URL credentials', () => {
    for (const path of ['/admin/marketplace-converter?batch=42&view=return#batch-detail', '/admin/exceptions?type=order_change', '/cartons', '/order/31', '/warehouse-intakes/42', '/batches/18']) assert.equal(workspacePath(path), path);
    for (const path of ['https://elsewhere.test/tasks', '//elsewhere.test/tasks', '/api/orders', '/login', '/erp-entry', '/tasks?token=secret', '/tasks?ticket=secret', '/tasks\\bad']) assert.throws(() => workspacePath(path));
    assert.equal(exactWorkspaceOrigin('https://wms.example'), 'https://wms.example');
    for (const origin of ['https://wms.example/', 'https://wms.example/api', 'https://user:password@wms.example']) assert.throws(() => exactWorkspaceOrigin(origin));
});
test('session guard binds numeric WMS actor, ERP subject, role, entity and token; disposal preserves a newer actor', () => {
    const cache = storage(), lease = createWorkspaceSession(cache, { user, accessToken: 'token-A' });
    assert.equal(lease.isCurrentSession(), true);
    cache.setItem('wms_user', JSON.stringify({ ...user, name: 'Updated name' }));
    assert.equal(lease.isCurrentSession(), true);
    cache.setItem('wms_user', JSON.stringify({ ...user, entityId: 'other-company' }));
    assert.equal(lease.isCurrentSession(), false);
    const newer = createWorkspaceSession(cache, { user: { ...user, id: 8 }, accessToken: 'token-B' });
    lease.dispose(); assert.equal(newer.isCurrentSession(), true);
    newer.dispose(); assert.equal(cache.getItem('wms_token'), null); assert.equal(cache.getItem('wms_user'), null);
});
test('native session cannot be created from client role/user data alone', () => {
    for (const actor of [{ id: 7, role: 'admin' }, { ...user, entityId: '' }, { ...user, id: '7' }]) assert.throws(() => createWorkspaceSession(storage(), { user: actor, accessToken: 'token' }));
});
test('portal theme preserves functional selector lists and keyframes while scoping every rule', () => {
    const css = portalCss(':root{--color:red}html,body{font:inherit}.button:is(.one,.two),[data-value="a,b"]{animation:flash 1s}@media(min-width:1px){.modal{color:red}}@keyframes flash{from{opacity:0}to{opacity:1}}');
    const parsed = postcss.parse(css);
    parsed.walkRules(rule => {
        if (rule.parent.type === 'atrule' && rule.parent.name === 'keyframes') return;
        for (const selector of postcss.list.comma(rule.selector)) assert.match(selector, /^\.wms-native-portal(?:\s|$)/);
    });
    assert.match(css, /\.button:is\(\.one,\.two\)/);
    assert.match(css, /\[data-value="a,b"\]/);
    assert.match(css, /animation:wms-native-flash 1s/);
    assert.match(css, /@keyframes wms-native-flash/);
    const swal = portalCss('.swal2-hide{animation:swal2-hide .1s}@keyframes swal2-hide{from{opacity:1}to{opacity:0}}');
    assert.match(swal, /animation:swal2-hide .1s/); assert.match(swal, /@keyframes swal2-hide/);
    assert.match(swal, /\.wms-native-portal \.swal2-popup\s*\{transition-duration:\s*0s\s*!important/);
});
test('Shadow styles install their own root theme and preflight without depending on ERP root variables', () => {
    const css = shadowCss(':root{--wms-color:red}html,body{font:inherit}.button{color:var(--wms-color)}@keyframes flash{from{opacity:0}}');
    assert.match(css, /:host\{--wms-color:red\}/);
    assert.match(css, /:host,:host\{font:inherit\}/);
    assert.doesNotMatch(css, /:root|html|body/);
    assert.match(css, /@keyframes flash\{from\{opacity:0\}\}/);
});
test('one immutable release manifest binds hashed SDK, Shadow styles and portal styles to its source commit', () => {
    const files = [], commit = 'a'.repeat(40);
    workspaceManifestPlugin(commit).generateBundle.handler.call({ emitFile: file => files.push(file) }, {}, {
        entry: { type: 'chunk', isEntry: true, name: 'workspace', fileName: 'assets/workspace-hash.js', exports: ['mountWorkspace', 'sourceCommit'] },
        css: { type: 'asset', fileName: 'assets/style-hash.css', source: ':root{--color:red}.modal{color:var(--color)}' },
    });
    const manifest = JSON.parse(files.find(file => file.fileName === 'workspace-manifest.json').source);
    assert.equal(validateWorkspaceManifest(manifest, commit), manifest);
    assert.match(manifest.portalStyles[0], /^\/assets\/workspace-portal-[a-f0-9]{16}\.css$/);
    assert.throws(() => validateWorkspaceManifest(manifest, 'b'.repeat(40)));
    assert.throws(() => validateWorkspaceManifest({ ...manifest, styles: ['https://evil.test/global.css'] }, commit));
});
