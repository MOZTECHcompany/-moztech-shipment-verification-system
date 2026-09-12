import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';

const { code } = await transform(await readFile(new URL('../src/api/useVisibleCommentReads.js', import.meta.url), 'utf8'), { format: 'cjs' });

function setup() {
    const effects = [], timers = new Map(), handlers = new Map(), calls = [], observed = new Set();
    let now = 0, sequence = 0, intersection, mutation;
    const elements = [1,2,3,4].map(id => ({ dataset: { commentId: String(id) }, isConnected: true }));
    const root = { querySelectorAll: () => elements, contains: element => elements.includes(element) };
    const document = { visibilityState: 'visible', addEventListener: (name, cb) => handlers.set(name, cb), removeEventListener: name => handlers.delete(name) };
    const module = { exports: {} };
    vm.runInNewContext(code, { module, exports: module.exports, document, console,
        setTimeout: (fn, ms) => { const id = ++sequence; timers.set(id, { at: now + ms, fn }); return id; }, clearTimeout: id => timers.delete(id),
        IntersectionObserver: class { constructor(cb) { intersection = cb; } observe(el) { observed.add(el); } unobserve(el) { observed.delete(el); } disconnect() { observed.clear(); } },
        MutationObserver: class { constructor(cb) { mutation = cb; } observe() {} disconnect() {} },
        require: name => { assert.equal(name, 'react'); return { useRef: value => ({ current: value }), useEffect: fn => effects.push(fn) }; }
    });
    module.exports.useVisibleCommentReads({ orderId: 1, rootRef: { current: root },
        comments: [{ id: 1 }, { id: 2 }, { id: 3, is_read: true }, { id: 4, __optimistic: true }, { id: 5 }],
        markVisibleRead: async ids => { calls.push(Array.from(ids)); return ids.map(String); }
    });
    const cleanup = effects[0]();
    const entry = (element, height = 100) => ({ target: element, isIntersecting: height > 0, boundingClientRect: { height: 100 }, intersectionRect: { height } });
    const advance = async ms => {
        const end = now + ms;
        while (true) {
            const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) break;
            now = next[1].at; timers.delete(next[0]); next[1].fn();
            await Promise.resolve(); await Promise.resolve();
        }
        now = end;
    };
    return { calls, elements, observed, document, handlers, entry, advance, cleanup, intersect: entries => intersection(entries), mutate: () => mutation() };
}

test('only sufficiently visible settled bubbles are marked, not offscreen, own/read or optimistic messages', async () => {
    const h = setup();
    h.intersect(h.elements.map((el, i) => h.entry(el, i === 1 ? 0 : 100)));
    await h.advance(399); assert.deepEqual(h.calls, []);
    await h.advance(151); assert.deepEqual(h.calls, [[1]]);
    h.cleanup();
});

test('a filtered/unmounted bubble and a hidden browser tab cancel pending read receipts', async () => {
    const h = setup();
    h.intersect([h.entry(h.elements[0])]);
    h.elements[0].isConnected = false;
    await h.advance(600); assert.deepEqual(h.calls, []);
    h.intersect([h.entry(h.elements[1])]);
    await h.advance(200);
    h.document.visibilityState = 'hidden'; h.handlers.get('visibilitychange')();
    await h.advance(1000); assert.deepEqual(h.calls, []);
    h.document.visibilityState = 'visible'; h.handlers.get('visibilitychange')();
    await h.advance(550); assert.deepEqual(h.calls, [[2]]);
    h.cleanup();
});

test('virtualized reused DOM nodes are observed under their new comment ID; cleanup prevents minimized reads', async () => {
    const h = setup();
    h.intersect([h.entry(h.elements[0])]);
    await h.advance(550); assert.deepEqual(h.calls, [[1]]);
    h.elements[0].dataset.commentId = '5'; h.mutate();
    h.intersect([h.entry(h.elements[0])]);
    await h.advance(550); assert.deepEqual(h.calls, [[1],[5]]);
    h.intersect([h.entry(h.elements[1])]); h.cleanup();
    await h.advance(1000); assert.deepEqual(h.calls, [[1],[5]]);
    assert.equal(h.observed.size, 0);
});
