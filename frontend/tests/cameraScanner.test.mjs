import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = await readFile(new URL('../src/components/CameraScanner.jsx', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'jsx', format: 'cjs' });

test('decoder uses the latest onScan callback, debounces repeated frames and never signals API success', async () => {
    const refs = [];
    const states = [];
    const effects = [];
    const timers = new Map();
    let stateIndex = 0, refIndex = 0, timerId = 0, decode;
    const calls = [];
    const noop = () => {};
    class Reader {
        listVideoInputDevices = async () => [{ deviceId: 'fixture', label: 'back' }];
        reset = noop;
        decodeFromVideoDevice = async (_, __, callback) => { decode = callback; };
    }
    const react = {
        createElement(type, props, ...children) {
            if (type === 'video') props.ref.current = {};
            return { type, props: { ...props, children } };
        },
        useState(initial) {
            const i = stateIndex++;
            if (!(i in states)) states[i] = initial;
            return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }];
        },
        useRef(initial) { const i = refIndex++; return refs[i] ||= { current: initial }; },
        useEffect: callback => effects.push(callback)
    };
    const module = { exports: {} };
    vm.runInNewContext(code, {
        module, exports: module.exports, console,
        setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
        clearTimeout: id => timers.delete(id),
        require(name) {
            if (name === 'react') return react;
            if (name === '@zxing/library') return { BrowserMultiFormatReader: Reader, NotFoundException: class extends Error {} };
            if (name === 'sonner') return { toast: { warning: noop } };
            if (name.includes('soundNotification')) throw new Error('Decoder must not play acceptance sounds');
            return new Proxy({}, { get: (_, key) => key === '__esModule' ? false : String(key) });
        }
    });
    const render = onScan => {
        stateIndex = 0; refIndex = 0;
        return module.exports.CameraScanner({ onScan, onClose: noop });
    };
    render(code => { calls.push(['old', code]); return true; });
    const cleanup = effects[0]();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    render(code => { calls.push(['current', code]); return false; });
    decode({ getText: () => 'SN-1' });
    decode({ getText: () => 'SN-1' });
    assert.deepEqual(calls, [['current', 'SN-1']]);
    for (const callback of timers.values()) callback();
    decode({ getText: () => 'SN-1' });
    assert.deepEqual(calls, [['current', 'SN-1'], ['current', 'SN-1']]);
    cleanup();
});
