import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = await readFile(new URL('../src/utils/soundNotification.js', import.meta.url), 'utf8');
const { code } = await transform(source, { format: 'cjs' });

function sounds() {
    const tones = [];
    const noop = () => {};
    const context = {
        state: 'running', currentTime: 0, destination: {},
        createOscillator: () => {
            const oscillator = { frequency: { value: 0 }, connect: noop, disconnect: () => { oscillator.disconnected = true; }, start: noop, stop: noop };
            tones.push(oscillator);
            return oscillator;
        },
        createGain: () => ({ gain: { setValueAtTime: noop, linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop, disconnect: noop })
    };
    const module = { exports: {} };
    vm.runInNewContext(code, {
        module, exports: module.exports,
        localStorage: { getItem: () => null, setItem: noop },
        document: { addEventListener: noop, removeEventListener: noop },
        window: { AudioContext: class { constructor() { return context; } } },
        console: { log: noop, warn: noop, error: noop }
    });
    const sound = module.exports.default;
    sound.userInteracted = true;
    return { sound, tones };
}

test('accepted pick, pack and error have distinct motifs and stopped oscillators disconnect', async () => {
    const { sound, tones } = sounds();
    await sound.play('pickSuccess');
    assert.deepEqual(tones.map(tone => tone.frequency.value), [1200]);
    tones.splice(0);
    await sound.play('packSuccess');
    assert.deepEqual(tones.map(tone => tone.frequency.value), [660, 880]);
    tones.forEach(tone => { tone.onended(); assert.equal(tone.disconnected, true); });
    tones.splice(0);
    await sound.play('error');
    assert.deepEqual(tones.map(tone => tone.frequency.value), [800, 200, 800]);
});

test('mute disables both new scan motifs', async () => {
    const { sound, tones } = sounds();
    sound.setEnabled(false);
    await sound.play('pickSuccess');
    await sound.play('packSuccess');
    assert.equal(tones.length, 0);
});
