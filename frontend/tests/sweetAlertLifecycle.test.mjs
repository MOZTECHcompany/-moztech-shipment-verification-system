import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { guardDetachedTextarea } from '../config/sweetAlertLifecycle.mjs';

test('the locked SweetAlert headless build contains exactly the reviewed delayed measurement', async () => {
    const source = await readFile(new URL('../node_modules/sweetalert2/dist/sweetalert2.js', import.meta.url), 'utf8');
    const patched = guardDetachedTextarea(source);
    assert.equal(patched.split('const measuredPopup = getPopup();').length, 2);
    assert.throws(() => guardDetachedTextarea('changed dependency'), /Review SweetAlert/);
});

test('a disposed textarea never measures a missing or newer prompt; attached prompts retain their width', () => {
    const source = guardDetachedTextarea('const initialPopupWidth = parseInt(window.getComputedStyle(getPopup()).width); result = initialPopupWidth;');
    for (const [popup, attached, expected] of [[null, false, null], [{}, false, null], [{}, true, 320]]) {
        const context = { getPopup: () => popup, textarea: {}, document: { body: { contains: () => attached } }, result: null, window: { getComputedStyle: node => { assert.equal(node, popup); assert(node); return { width: '320px' }; } } };
        vm.runInNewContext(`(function(){${source}})()`, context);
        assert.equal(context.result, expected);
    }
});
