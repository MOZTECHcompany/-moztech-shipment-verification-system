import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as nativeRuntime from '../src/workspace/nativeRuntime.js';
import { withWorkspacePrintOptions } from '../src/workspace/printing.js';

test('native print clone inherits scoped theme while original print guards and commands remain intact', t => {
    const before = async () => {}, print = async () => {};
    const options = { bodyClass: 'original-print', onBeforePrint: before, print, documentTitle: 'Original document', pageStyle: '@page{size:A4}' };
    assert.equal(withWorkspacePrintOptions(options), options);
    const dispose = nativeRuntime.installNativeRuntime({ portalTarget: {} }); t.after(dispose);
    const native = withWorkspacePrintOptions(options);
    assert.equal(native.bodyClass, 'original-print wms-native-portal');
    assert.equal(native.onBeforePrint, before); assert.equal(native.print, print); assert.equal(native.documentTitle, options.documentTitle);
    assert.equal(withWorkspacePrintOptions(native).bodyClass, native.bodyClass);
});
test('native DEV banner shows its label without changing the ERP document title', async t => {
    const source = await readFile(new URL('../src/components/EnvironmentBanner.jsx', import.meta.url), 'utf8');
    const { code } = await transform(source, { loader: 'jsx', format: 'cjs', define: { 'import.meta.env.VITE_DEPLOY_ENV': '"dev"' } });
    const effects = [], document = { title: 'ERP warehouse' }, module = { exports: {} };
    const react = { createElement: (type, props, ...children) => ({ type, props, children }), useEffect: callback => effects.push(callback) };
    vm.runInNewContext(code, { module, exports: module.exports, document, require: name => name === 'react' ? react : name === '../workspace/nativeRuntime.js' ? nativeRuntime : {
        isDevDeployment: flag => flag === 'dev', applyDeploymentTitle: doc => { doc.title = 'Changed title'; return () => {}; },
    } });
    const dispose = nativeRuntime.installNativeRuntime({ portalTarget: {} }); t.after(dispose);
    const banner = module.exports.EnvironmentBanner({}); effects[0]();
    assert.equal(document.title, 'ERP warehouse'); assert.equal(banner.props['data-testid'], 'deployment-environment');
});
