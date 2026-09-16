// Web Speech voices belong to the workstation; the API does not expose gender.
const STORAGE_KEY = 'wms_stage_voices_v1';
const stageLabel = type => type === 'pick' ? '揀貨' : type === 'pack' ? '裝箱' : '掃描';
// Keep the UI's warehouse term 揀貨; use its common homophone for speech.
const spokenStageLabel = type => type === 'pick' ? '撿貨' : stageLabel(type);
const voiceId = voice => voice.voiceURI || `${voice.lang}:${voice.name}`;
const knownFemale = /HsiaoChen|HsiaoYu|Mei[- ]?Jia|美佳|Hanhan|Yating|曉臻|曉雨|涵涵|雅婷/i;
const knownMale = /YunJhe|Zhiwei|雲哲|云哲|志偉|志伟/i;
const incompatibleVoice = /\b(?:Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/i;
const taiwanMandarin = voice => /^(?:zh|cmn)[-_]TW$/i.test(voice.lang) && !incompatibleVoice.test(voice.name);

class VoiceNotification {
    constructor() {
        this.enabled = false;
        this.selected = { pick: 'auto', pack: 'auto' };
        try {
            this.enabled = localStorage.getItem('voice_enabled') === 'true';
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            for (const type of ['pick', 'pack']) if (typeof saved?.[type] === 'string') this.selected[type] = saved[type];
        } catch { /* Unavailable storage must not prevent warehouse work. */ }
        this.synth = window.speechSynthesis;
        this.listeners = new Set();
        this.current = null;
        this.pending = null;
        this.voice = null;
        this.synth?.addEventListener?.('voiceschanged', () => this.notify());
    }
    subscribe(callback) { this.listeners.add(callback); return () => this.listeners.delete(callback); }
    notify() { this.listeners.forEach(callback => callback()); }
    getVoices() { return this.synth?.getVoices() || []; }
    getChineseVoices() {
        // A zh tag alone did not guarantee intelligible warehouse Mandarin.
        // Do not offer the reported character voices, mainland or Cantonese voices.
        return this.getVoices().filter(taiwanMandarin);
    }
    getStageSettings() {
        const voices = this.getChineseVoices();
        const manual = type => voices.find(voice => voiceId(voice) === this.selected[type]);
        const pick = manual('pick') || voices.find(voice => knownFemale.test(voice.name)) || voices[0];
        const pack = manual('pack') || voices.find(voice => knownMale.test(voice.name)) || pick;
        const sameVoice = !pick || !pack || voiceId(pick) === voiceId(pack);
        return { enabled: this.enabled, supported: this.isSupported(), voices, selected: { ...this.selected }, sameVoice,
            pick: { voice: pick, pitch: 1 }, pack: { voice: pack, pitch: 1 } };
    }
    setStageVoice(type, id) {
        if (!['pick', 'pack'].includes(type)) return;
        if (id !== 'auto' && !this.getChineseVoices().some(voice => voiceId(voice) === id)) return;
        const selected = { ...this.selected, [type]: id };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
        this.selected = selected;
        this.notify();
    }
    speak(text, options = {}) {
        if ((!this.enabled && !options.preview) || !this.synth) return false;
        // Completion survives navigation/new-task notifications. Keep at most one
        // subsequent scan announcement, so rapid scans never create a stale queue.
        if (this.current?.critical && Date.now() < this.current.until && !options.critical) {
            if (!options.background) this.pending = { text, options };
            return true;
        }
        try {
            const utterance = new SpeechSynthesisUtterance(text);
            const settings = this.getStageSettings();
            const stage = settings[options.type];
            const chosen = stage?.voice || (this.voice && taiwanMandarin(this.voice) ? this.voice : settings.pick.voice);
            // Never silently fall back to an unknown system/default voice.
            if (!chosen || !taiwanMandarin(chosen)) return false;
            utterance.voice = chosen;
            utterance.lang = chosen?.lang || 'zh-TW';
            utterance.rate = options.rate ?? 1;
            utterance.pitch = stage?.pitch ?? options.pitch ?? 1;
            utterance.volume = options.volume ?? 1;
            this.current = null;
            this.pending = null;
            this.synth.cancel();
            const current = { utterance, critical: !!options.critical, until: Date.now() + 10000 };
            this.current = current;
            const finish = () => {
                if (this.current !== current) return;
                this.current = null;
                const pending = this.pending;
                this.pending = null;
                if (pending) this.speak(pending.text, pending.options);
            };
            utterance.onend = finish;
            utterance.onerror = finish;
            this.synth.speak(utterance);
            return true;
        } catch {
            // Audio failure must never turn an accepted server scan into a failure.
            this.current = null;
            this.pending = null;
            return false;
        }
    }
    speakScanSuccess(scannedCount, remainingCount, { type } = {}) {
        // Zero remaining alone is not proof of a completed workflow (exceptions).
        return this.speak(`${spokenStageLabel(type)}，${scannedCount}，剩 ${remainingCount}`, { type });
    }
    speakScanError({ type } = {}) { return this.speak(`${spokenStageLabel(type)}未完成，請確認`, { type }); }
    speakTaskComplete(type) { return this.speak(`${type ? spokenStageLabel(type) : ''}任務完成`, { type, critical: true }); }
    speakNewTask(count = 1) { return this.speak(count === 1 ? '新任務到達' : `有 ${count} 個新任務`, { background: true }); }
    speakBatchClaim(count) { return this.speak(`已認領 ${count} 個任務`); }
    speakOperationError(message) { return this.speak(message || '操作錯誤'); }
    preview(type) { return this.speak(`${spokenStageLabel(type)}，3，剩 2。${spokenStageLabel(type)}任務完成`, { type, preview: true }); }
    stop() { this.current = null; this.pending = null; try { this.synth?.cancel(); } catch { /* optional device audio */ } }
    pause() { if (this.synth?.speaking) this.synth.pause(); }
    resume() { if (this.synth?.paused) this.synth.resume(); }
    setEnabled(enabled) {
        localStorage.setItem('voice_enabled', String(!!enabled));
        this.enabled = !!enabled;
        if (!this.enabled) this.stop();
        this.notify();
    }
    isEnabled() { return this.enabled; }
    isSupported() { return !!this.synth; }
    setVoice(voice) { this.voice = voice; }
}
const voiceNotification = new VoiceNotification();
export { voiceNotification, voiceId };
export default voiceNotification;
