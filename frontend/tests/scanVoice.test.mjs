import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
const { code } = await transform(await readFile(new URL('../src/utils/voiceNotification.js', import.meta.url), 'utf8'), { format: 'cjs' });
const female = { lang: 'zh-TW', name: 'Microsoft HsiaoChen', voiceURI: 'female-tw' };
const male = { lang: 'zh-TW', name: 'Microsoft YunJhe', voiceURI: 'male-tw' };
function voice({ voices = [female, male], enabled = true, throwAudio = false, selected } = {}) {
    const spoken = [], module = { exports: {} }, listeners = {}, storage = new Map([['voice_enabled', String(enabled)]]);
    if (selected) storage.set('wms_stage_voices_v1', JSON.stringify(selected));
    let cancelled = 0;
    vm.runInNewContext(code, { module, exports: module.exports, console,
        localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
        SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
        window: { speechSynthesis: { getVoices: () => voices, addEventListener: (event, fn) => { listeners[event] = fn; }, cancel: () => cancelled++, speak: value => { if (throwAudio) throw Error('device failed'); spoken.push(value); } } }
    });
    return { service: module.exports.default, reportedVoice: module.exports.reportedVoice, spoken, storage, cancelled: () => cancelled, load: next => { voices = next; listeners.voiceschanged(); } };
}
test('short confirmed quantities omit names and choose separate stage voices', () => {
    const { service, spoken } = voice();
    service.speakScanSuccess(3, 2, { name: '甲', type: 'pick' });
    service.speakScanSuccess(4, 1, { name: '乙', type: 'pack' });
    service.speakScanError({ name: '乙', type: 'pack' });
    assert.deepEqual(spoken.map(v => v.text), ['撿貨，3，剩 2', '裝箱，4，剩 1', '裝箱未完成，請確認']);
    assert.deepEqual(spoken.map(v => v.voice.voiceURI), ['female-tw', 'male-tw', 'male-tw']);
    assert.ok(spoken.every(v => v.pitch === 1 && v.rate === 1));
});
test('zero remaining does not claim completion; explicit completion names the stage', () => {
    const { service, spoken } = voice();
    service.speakScanSuccess(5, 0, { type: 'pick' });
    service.speakTaskComplete('pick');
    service.speakTaskComplete('pack');
    assert.deepEqual(spoken.map(v => v.text), ['撿貨，5，剩 0', '撿貨任務完成', '裝箱任務完成']);
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
    assert.equal(v.spoken[1].text, '裝箱，2，剩 8');
});
test('single-voice fallback reports same voice and preserves native pitch', () => {
    const { service, spoken } = voice({ voices: [female] });
    service.speakScanSuccess(1, 2, { type: 'pick' });
    service.speakScanSuccess(1, 2, { type: 'pack' });
    assert.equal(service.getStageSettings().sameVoice, true);
    assert.equal(spoken[0].voice, spoken[1].voice);
    assert.equal(spoken[0].pitch, 1);
    assert.equal(spoken[1].pitch, 1);
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
    assert.equal(v.service.speakScanSuccess(1, 1, { type: 'pick' }), false);
    assert.equal(v.spoken.length, 0);
    v.load([female]);
    assert.equal(v.service.speakScanSuccess(1, 1, { type: 'pick' }), true);
    assert.equal(v.spoken[0].voice, female);
});
test('all Chinese choices remain selectable; only exact reported CN variants are marked', () => {
    const reported = ['Eddy', 'Flo', 'Grandma', 'Grandpa', 'Reed', 'Rocko', 'Sandy', 'Shelley'].flatMap(name =>
        ['zh-TW', 'zh-CN'].map(lang => ({ name: `${name} (中文)`, lang, voiceURI: `${name}-${lang}` })));
    const meijia = { name: '美佳', lang: 'zh-TW', voiceURI: 'meijia' };
    const other = [
        { name: '婷婷', lang: 'zh-CN', voiceURI: 'tingting' },
        { name: 'Sinji', lang: 'zh-HK', voiceURI: 'sinji' },
        { name: 'English', lang: 'en-US', voiceURI: 'en' }
    ];
    const { service, reportedVoice } = voice({ voices: [...reported, ...other, meijia] });
    assert.equal(service.getChineseVoices().length, 19);
    assert.ok(service.getChineseVoices().every(v => v.lang !== 'en-US'));
    assert.equal(service.getChineseVoices().filter(reportedVoice).length, 9);
    assert.ok(reported.filter(v => v.lang === 'zh-TW').every(v => !reportedVoice(v)));
    assert.equal(reportedVoice({ name: 'Microsoft Xiaoxiao', lang: 'zh-CN' }), false);
    assert.equal(reportedVoice({ name: 'Ting-Ting', lang: 'zh_CN' }), true);
    service.setStageVoice('pack', 'Sandy-zh-CN');
    assert.equal(service.getStageSettings().selected.pack, 'Sandy-zh-CN');
    assert.equal(service.getStageSettings().pack.voice.voiceURI, 'Sandy-zh-CN');
});
test('saved Taiwan choices recover and separate stage previews use their selected voices without unmuting', () => {
    const meijia = { name: '美佳', lang: 'zh-TW', voiceURI: 'meijia' };
    const selected = { pick: 'Shelley-zh-TW', pack: 'Eddy-zh-TW' };
    const shelley = { name: 'Shelley (中文)', lang: 'zh-TW', voiceURI: selected.pick };
    const eddy = { name: 'Eddy (中文)', lang: 'zh-TW', voiceURI: selected.pack };
    const v = voice({ voices: [shelley, eddy, meijia], enabled: false, selected });
    assert.equal(v.service.getStageSettings().pick.voice, shelley);
    assert.equal(v.service.getStageSettings().pack.voice, eddy);
    assert.equal(v.service.speakTaskComplete('pick'), false);
    v.service.preview('pick');
    v.service.preview('pack');
    assert.deepEqual(v.spoken.map(s => s.text), ['撿貨，3，剩 2。撿貨任務完成', '裝箱，3，剩 2。裝箱任務完成']);
    assert.deepEqual(v.spoken.map(s => s.voice), [shelley, eddy]);
    assert.ok(v.spoken.every(s => s.pitch === 1 && s.rate === 1 && s.lang === 'zh-TW'));
    assert.equal(v.storage.get('voice_enabled'), 'false');
    assert.deepEqual(JSON.parse(v.storage.get('wms_stage_voices_v1')), selected);
});
test('automatic mode recognizes language variants and chooses distinct options with known genders first', () => {
    const meijia = { name: '美佳', lang: 'zh_TW', voiceURI: 'meijia' };
    const second = { name: 'Another voice', lang: 'cmn-TW', voiceURI: 'second' };
    const v = voice({ voices: [second, meijia] });
    assert.equal(v.service.getStageSettings().pick.voice, meijia);
    assert.equal(v.service.getStageSettings().pack.voice, second);
    v.load([second, meijia, { ...male, name: '雲哲' }]);
    assert.equal(v.service.getStageSettings().pack.voice.voiceURI, 'male-tw');
});
test('invalid language selections do not revive an unknown default voice', () => {
    const v = voice();
    v.service.setVoice({ name: 'English', lang: 'en-US', voiceURI: 'en' });
    v.service.speakNewTask();
    assert.equal(v.spoken[0].voice, female);
    const unavailable = voice({ voices: [{ name: '婷婷', lang: 'zh-CN', voiceURI: 'cn-only' }] });
    assert.equal(unavailable.service.preview('pack'), false);
    assert.equal(unavailable.service.speakTaskComplete('pick'), false);
    assert.equal(unavailable.spoken.length, 0);
});
test('reported voices are skipped automatically but explicit choices can be previewed and used', () => {
    const reported = { name: 'Sandy (中文（中國大陸）)', lang: 'zh-CN', voiceURI: 'sandy-cn' };
    const v = voice({ voices: [reported, female, male] });
    assert.equal(v.service.getStageSettings().pick.voice, female);
    assert.equal(v.service.getStageSettings().pack.voice, male);
    v.service.setStageVoice('pack', reported.voiceURI);
    v.service.preview('pack');
    v.service.speakScanSuccess(2, 1, { type: 'pack' });
    assert.ok(v.spoken.every(s => s.voice === reported && s.lang === 'zh-CN'));
    v.service.setStageVoice('pack', 'auto');
    assert.equal(v.service.getStageSettings().pack.voice, male);
    const onlyReported = voice({ voices: [reported], selected: { pick: reported.voiceURI, pack: 'auto' } });
    assert.equal(onlyReported.service.preview('pick'), true);
    assert.equal(onlyReported.service.preview('pack'), false);
});
test('unreported CN and HK options work without requiring a Taiwan voice installation', () => {
    const voices = [
        { name: 'Microsoft Xiaoxiao', lang: 'zh-CN', voiceURI: 'xiaoxiao' },
        { name: 'Microsoft Yunxi', lang: 'cmn-CN', voiceURI: 'yunxi' },
        { name: 'Sinji', lang: 'zh-HK', voiceURI: 'sinji' }
    ];
    const v = voice({ voices });
    assert.equal(v.service.getStageSettings().pick.voice, voices[0]);
    assert.equal(v.service.getStageSettings().pack.voice, voices[1]);
    v.service.setStageVoice('pack', 'sinji');
    v.service.speakScanSuccess(2, 1, { type: 'pack' });
    assert.equal(v.spoken[0].voice, voices[2]);
});
