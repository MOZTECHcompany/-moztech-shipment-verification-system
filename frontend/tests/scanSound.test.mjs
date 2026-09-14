import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = await readFile(new URL('../src/utils/soundNotification.js', import.meta.url), 'utf8');
const { code } = await transform(source, { format: 'cjs' });

function sounds(storage = new Map()) {
    const tones = [];
    const noop = () => {};
    const context = {
        state: 'running', currentTime: 0, destination: {},
        createOscillator: () => {
            const oscillator = { frequency: { value: 0 }, connect: noop, disconnect: () => { oscillator.disconnected = true; }, start: at => { oscillator.startedAt = at; }, stop: at => { oscillator.stoppedAt = at; } };
            tones.push(oscillator);
            return oscillator;
        },
        createGain: () => ({ gain: { setValueAtTime: noop, linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop, disconnect: noop })
    };
    const module = { exports: {} };
    vm.runInNewContext(code, {
        module, exports: module.exports,
        localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
        document: { addEventListener: noop, removeEventListener: noop },
        window: { AudioContext: class { constructor() { return context; } } },
        console: { log: noop, warn: noop, error: noop }
    });
    const sound = module.exports.default;
    sound.userInteracted = true;
    return { sound, tones, profiles: module.exports.SOUND_PROFILES, storage };
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

test('personal profiles persist per account, survive reload and cannot leak across account switches', async () => {
    const { sound, tones, storage } = sounds();
    sound.setUser(101); sound.setProfile('wood'); sound.setVolume(0.4);
    await sound.play('pickSuccess');
    assert.equal(tones.at(-1).type, 'triangle');
    assert.equal(tones.at(-1).frequency.value, 780);
    sound.setUser(102); sound.setProfile('digital'); sound.setEnabled(false);
    assert.equal(sound.isEnabled(), false);
    sound.setUser(101);
    assert.equal(sound.isEnabled(), true);
    assert.equal(sound.getSettings().profile, 'wood');
    assert.equal(sound.getSettings().volume, 0.4);
    const reload = sounds(storage).sound;
    reload.setUser(102);
    assert.equal(reload.getSettings().profile, 'digital');
    assert.equal(reload.isEnabled(), false);
});

test('every personal timbre has distinct pick, pack and warning patterns with one scheduling clock', async () => {
    const { sound, tones, profiles } = sounds();
    const signatures = new Set();
    for (const profile of profiles) {
        sound.setProfile(profile.id);
        const motifs = [];
        for (const name of ['pickSuccess', 'packSuccess', 'error']) {
            tones.splice(0);
            assert.equal(await sound.play(name), true);
            motifs.push(tones.map(t => [t.type, t.frequency.value, t.startedAt, t.stoppedAt]));
        }
        assert.deepEqual(motifs.map(m => m.length), [1, 2, 3]);
        assert.equal(new Set(motifs.map(m => JSON.stringify(m))).size, 3);
        signatures.add(JSON.stringify(motifs));
    }
    assert.equal(signatures.size, profiles.length);
});

test('muting or switching account cancels a pending audio start; explicit preview keeps mute unchanged', async () => {
    const { sound, tones } = sounds();
    const queued = sound.play('packSuccess');
    sound.setUser(7);
    assert.equal(await queued, false);
    assert.equal(tones.length, 0);
    sound.setEnabled(false);
    assert.equal(await sound.play('error'), false);
    assert.equal(await sound.preview('error'), true);
    assert.equal(sound.isEnabled(), false);
    sound.setVolume(0);
    assert.equal(await sound.preview('error'), false);
});

test('invalid saved profile or volume is normalized and storage failures do not crash construction', () => {
    const storage = new Map([['corely:wms:sound:v1:guest', '{"profile":"bad","volume":"NaN"}']]);
    const { sound } = sounds(storage);
    assert.equal(sound.getSettings().profile, 'clear');
    assert.equal(sound.getSettings().volume, 0.3);
    assert.throws(() => sound.setProfile('missing'));
    const broken = { get() { throw Error('unavailable'); }, set() { throw Error('unavailable'); } };
    const safe = sounds(broken).sound;
    assert.equal(safe.isEnabled(), true);
    assert.throws(() => safe.setEnabled(false));
    assert.equal(safe.isEnabled(), true);
});

test('mute disables both new scan motifs', async () => {
    const { sound, tones } = sounds();
    sound.setEnabled(false);
    await sound.play('pickSuccess');
    await sound.play('packSuccess');
    assert.equal(tones.length, 0);
});
