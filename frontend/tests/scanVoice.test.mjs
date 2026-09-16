import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
const { code } = await transform(await readFile(new URL('../src/utils/voiceNotification.js', import.meta.url), 'utf8'), { format: 'cjs' });
const female = { lang: 'zh-TW', name: 'Microsoft HsiaoChen', voiceURI: 'female-tw' };
const male = { lang: 'zh-TW', name: 'Microsoft YunJhe', voiceURI: 'male-tw' };
function voice({ voices = [female, male], enabled = true, throwAudio = false } = {}) {
    const spoken = [], module = { exports: {} }, listeners = {}, storage = new Map([['voice_enabled', String(enabled)]]);
    let cancelled = 0;
    vm.runInNewContext(code, { module, exports: module.exports, console,
        localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
        SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
        window: { speechSynthesis: { getVoices: () => voices, addEventListener: (event, fn) => { listeners[event] = fn; }, cancel: () => cancelled++, speak: value => { if (throwAudio) throw Error('device failed'); spoken.push(value); } } }
    });
    return { service: module.exports.default, spoken, storage, cancelled: () => cancelled, load: next => { voices = next; listeners.voiceschanged(); } };
}
test('short confirmed quantities omit names and choose separate stage voices', () => {
    const { service, spoken } = voice();
    service.speakScanSuccess(3, 2, { name: '甲', type: 'pick' });
    service.speakScanSuccess(4, 1, { name: '乙', type: 'pack' });
    service.speakScanError({ name: '乙', type: 'pack' });
    assert.deepEqual(spoken.map(v => v.text), ['揀貨 3，剩 2', '裝箱 4，剩 1', '裝箱未完成，請確認']);
    assert.deepEqual(spoken.map(v => v.voice.voiceURI), ['female-tw', 'male-tw', 'male-tw']);
});
test('zero remaining does not claim completion; explicit completion names the stage', () => {
    const { service, spoken } = voice();
    service.speakScanSuccess(5, 0, { type: 'pick' });
    service.speakTaskComplete('pick');
    service.speakTaskComplete('pack');
    assert.deepEqual(spoken.map(v => v.text), ['揀貨 5，剩 0', '揀貨任務完成', '裝箱任務完成']);
});
test('completion is not cancelled by new tasks and only the latest subsequent progress survives', () => {
    const v = voice();
    v.service.speakTaskComplete('pick');
    const cancels = v.cancelled();
    v.service.speakNewTask();
    v.service.speakScanSuccess(1, 9, { type: 'pack' });
    v.service.speakScanSuccess(2, 8, { type: 'pack' });
    assert.equal(v.cancelled(), cancels);
    assert.equal(v.spoken.length, 1);
    v.spoken[0].onend();
    assert.equal(v.spoken[1].text, '裝箱 2，剩 8');
});
test('single-voice fallback reports same voice and uses distinguishable pitch', () => {
    const { service, spoken } = voice({ voices: [female] });
    service.speakScanSuccess(1, 2, { type: 'pick' });
    service.speakScanSuccess(1, 2, { type: 'pack' });
    assert.equal(service.getStageSettings().sameVoice, true);
    assert.equal(spoken[0].voice, spoken[1].voice);
    assert.ok(spoken[0].pitch > spoken[1].pitch);
});
test('late voice lists refresh UI, preserve manual choices and recover unavailable voices', () => {
    const v = voice({ voices: [] });
    let updates = 0;
    const unsubscribe = v.service.subscribe(() => updates++);
    v.load([female, male]);
    v.service.setStageVoice('pick', male.voiceURI);
    v.load([female]);
    assert.equal(v.service.getStageSettings().selected.pick, male.voiceURI);
    assert.equal(v.service.getStageSettings().pick.voice, female);
    v.load([female, male]);
    assert.equal(v.service.getStageSettings().pick.voice, male);
    assert.equal(JSON.parse(v.storage.get('wms_stage_voices_v1')).pick, male.voiceURI);
    assert.equal(updates, 4);
    unsubscribe();
});
test('mute stops queued speech and preview never changes the saved mute preference', () => {
    const v = voice();
    v.service.speakTaskComplete('pick');
    v.service.speakScanError({ type: 'pack' });
    v.service.setEnabled(false);
    v.spoken[0].onend();
    v.service.speakTaskComplete('pack');
    assert.equal(v.spoken.length, 1);
    assert.equal(v.service.preview('pack'), true);
    assert.equal(v.spoken.length, 2);
    assert.equal(v.storage.get('voice_enabled'), 'false');
});
test('unavailable audio and empty voice lists never throw into scan persistence handling', () => {
    assert.equal(voice({ throwAudio: true }).service.speakTaskComplete('pick'), false);
    const v = voice({ voices: [] });
    assert.equal(v.service.speakScanSuccess(1, 1, { type: 'pick' }), true);
    assert.equal(v.spoken[0].lang, 'zh-TW');
    assert.equal(v.spoken[0].voice, undefined);
});
