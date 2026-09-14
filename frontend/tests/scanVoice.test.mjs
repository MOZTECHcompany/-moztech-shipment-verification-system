import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
const { code } = await transform(await readFile(new URL('../src/utils/voiceNotification.js', import.meta.url), 'utf8'), { format: 'cjs' });
function voice() {
    const spoken = [], module = { exports: {} }, noop = () => {};
    vm.runInNewContext(code, { module, exports: module.exports, console: {log:noop,warn:noop},
        localStorage: {getItem:()=> 'true',setItem:noop},
        SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
        window: { speechSynthesis: {getVoices:()=>[{lang:'zh-TW'}],cancel:noop,speak:value=>spoken.push(value.text)} }
    });
    return { service: module.exports.default, spoken };
}
test('enabled scan speech identifies the person and stage for both success and rejection', () => {
    const { service, spoken } = voice();
    service.speakScanSuccess(3, 2, {name:'甲',type:'pick'});
    service.speakScanError({name:'乙',type:'pack'});
    assert.deepEqual(spoken, ['甲，揀貨，已掃描 3 個，還剩 2 個', '乙，裝箱，掃描未完成，請確認']);
});
test('legacy voice callers and muted speech keep their behavior', () => {
    const { service, spoken } = voice();
    service.speakScanSuccess(5, 0);
    service.setEnabled(false);
    service.speakScanError({name:'甲',type:'pick'});
    assert.deepEqual(spoken, ['全部完成']);
});
