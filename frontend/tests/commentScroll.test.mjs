import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';

const { code } = await transform(await readFile(new URL('../src/api/useCommentScroll.js', import.meta.url), 'utf8'), { format: 'cjs' });
test('latest is initially reachable, history prepends preserve position and background messages do not steal scroll', async () => {
    let refIndex = 0, stateIndex = 0;
    const refs = [], states = [], effects = [];
    const module = { exports: {} };
    vm.runInNewContext(code, { module, exports: module.exports, require: () => ({
        useRef: value => refs[refIndex++] ||= { current: value },
        useState: initial => { const i = stateIndex++; states[i] ??= initial; return [states[i], value => { states[i] = value; }]; },
        useCallback: fn => fn, useLayoutEffect: fn => effects.push(fn)
    }) });
    const root = { scrollHeight: 1000, clientHeight: 200, scrollTop: 0 }, rootRef = { current: root };
    let resolveOlder;
    const fetchNextPage = () => new Promise(resolve => { resolveOlder = resolve; });
    const render = comments => {
        refIndex = stateIndex = 0; effects.length = 0;
        const result = module.exports.useCommentScroll({ rootRef, comments, orderId: 1, fetchNextPage });
        effects.forEach(fn => fn()); return result;
    };
    let ui = render([{ id: 51 }, { id: 100 }]);
    assert.equal(root.scrollTop, 1000);
    root.scrollTop = 100; ui.onScroll();
    const loading = ui.loadOlder();
    resolveOlder({ isError: false }); await loading; // React's render can happen after this promise.
    root.scrollHeight = 1600;
    ui = render([{ id: 1 }, { id: 51 }, { id: 100 }]);
    assert.equal(root.scrollTop, 700);
    root.scrollTop = 600; ui.onScroll();
    root.scrollHeight = 1800;
    ui = render([{ id: 1 }, { id: 51 }, { id: 100 }, { id: 101 }]);
    assert.equal(root.scrollTop, 600);
    ui = render([{ id: 1 }, { id: 51 }, { id: 100 }, { id: 101 }]);
    assert.equal(ui.hasNewMessages, true);
    ui.jumpToLatest(); assert.equal(root.scrollTop, 1800);
});
