// Personal timbre; scan stage and result always keep their own rhythm.
export const SOUND_PROFILES = Object.freeze([
    { id: 'clear', label: '清脆鈴音', wave: 'sine', pitch: 1, gain: 1 },
    { id: 'wood', label: '木質低音', wave: 'triangle', pitch: 0.65, gain: 1 },
    { id: 'bright', label: '明亮高音', wave: 'triangle', pitch: 1.35, gain: 0.85 },
    { id: 'round', label: '柔和低鈴', wave: 'sine', pitch: 0.6, gain: 1 },
    { id: 'digital', label: '電子短音', wave: 'square', pitch: 0.85, gain: 0.3 },
    { id: 'crystal', label: '水晶高鈴', wave: 'sine', pitch: 1.55, gain: 0.8 },
    { id: 'mellow', label: '渾厚木音', wave: 'triangle', pitch: 0.45, gain: 1 },
    { id: 'pulse', label: '低頻脈衝', wave: 'square', pitch: 0.45, gain: 0.3 }
]);
const MOTIFS = {
    pickSuccess: [[1200, 0.08, 0]],
    packSuccess: [[660, 0.08, 0], [880, 0.1, 0.1]],
    error: [[800, 0.1, 0], [200, 0.15, 0.1], [800, 0.1, 0.25]],
    success: [[1200, 0.08, 0]],
    newTask: [[800, 0.15, 0], [600, 0.2, 0.15]],
    taskClaimed: [[1000, 0.1, 0]],
    taskCompleted: [[523, 0.1, 0], [659, 0.1, 0.1], [784, 0.15, 0.2]]
};
const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const parse = value => { try { return JSON.parse(value); } catch { return null; } };
const volumeValue = value => value !== null && value !== '' && Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : 0.3;
const profileFor = id => SOUND_PROFILES.find(profile => profile.id === id);
const identity = id => id == null ? 'guest' : String(id);
const settingsKey = id => `corely:wms:sound:v1:${identity(id)}`;
function defaultProfile(id) {
    if (id == null) return SOUND_PROFILES[0].id;
    const hash = [...String(id)].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
    return SOUND_PROFILES[hash % SOUND_PROFILES.length].id;
}
class SoundNotification {
    constructor() {
        this.userId = parse(read('wms_user'))?.id ?? null;
        this.audioContext = null;
        this.userInteracted = false;
        this.sequence = 0;
        this.activeTones = new Set();
        this.listeners = new Set();
        this.settings = this.getSettings(this.userId);
        const activate = () => {
            if (this.userInteracted) return;
            this.userInteracted = true;
            void this.initAudioContext();
            for (const event of ['click', 'keydown', 'touchstart']) document.removeEventListener(event, activate);
        };
        for (const event of ['click', 'keydown', 'touchstart']) document.addEventListener(event, activate, { once: true });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.userInteracted) void this.initAudioContext();
        });
        window.addEventListener?.('storage', event => {
            if (event.key === settingsKey(this.userId) || event.key === null) {
                this.settings = this.getSettings(this.userId);
                this.stop();
                this.emit();
            }
        });
    }
    getSettings(userId = this.userId) {
        const stored = parse(read(settingsKey(userId))) || {};
        return {
            enabled: typeof stored.enabled === 'boolean' ? stored.enabled : read('sound_enabled') !== 'false',
            volume: volumeValue(stored.volume ?? read('sound_volume')),
            profile: profileFor(stored.profile)?.id || defaultProfile(userId)
        };
    }
    setUser(userId) {
        if (identity(this.userId) === identity(userId)) return;
        this.stop();
        this.userId = userId ?? null;
        this.settings = this.getSettings(this.userId);
        this.emit();
    }
    subscribe(callback) { this.listeners.add(callback); return () => this.listeners.delete(callback); }
    emit() { this.listeners.forEach(callback => callback()); }
    update(patch) {
        const next = { ...this.settings, ...patch };
        // Persist before changing active settings, so a storage failure is visible to the UI.
        localStorage.setItem(settingsKey(this.userId), JSON.stringify(next));
        this.settings = next;
        this.stop();
        this.emit();
    }
    setEnabled(enabled) { this.update({ enabled: !!enabled }); }
    isEnabled() { return this.settings.enabled; }
    setVolume(volume) { this.update({ volume: volumeValue(volume) }); }
    setProfile(profile) {
        if (!profileFor(profile)) throw Error('Unknown sound profile');
        this.update({ profile });
    }
    async initAudioContext() {
        if (!this.userInteracted) return null;
        try {
            if (!this.audioContext || this.audioContext.state === 'closed') this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            if (this.audioContext.state === 'suspended') await this.audioContext.resume();
            return this.audioContext.state === 'running' ? this.audioContext : null;
        } catch { return null; }
    }
    stop() {
        this.sequence++;
        for (const oscillator of this.activeTones) {
            try { oscillator.stop(); } catch { /* already stopped */ }
        }
        this.activeTones.clear();
    }
    async play(soundName, { preview = false } = {}) {
        const notes = MOTIFS[soundName];
        if (!notes || (!preview && !this.settings.enabled)) return false;
        this.stop();
        const sequence = this.sequence;
        const ctx = await this.initAudioContext();
        if (!ctx || sequence !== this.sequence) return false;
        const profile = profileFor(this.settings.profile) || SOUND_PROFILES[0];
        const volume = this.settings.volume * profile.gain;
        if (volume === 0) return false;
        const start = ctx.currentTime;
        try {
            // Schedule the whole motif from one clock, without a scan/audio backlog.
            for (const [frequency, duration, offset] of notes) {
                const oscillator = ctx.createOscillator();
                const gain = ctx.createGain();
                oscillator.connect(gain);
                gain.connect(ctx.destination);
                oscillator.type = profile.wave;
                oscillator.frequency.value = frequency * profile.pitch;
                const at = start + offset;
                gain.gain.setValueAtTime(0, at);
                gain.gain.linearRampToValueAtTime(volume, at + 0.008);
                gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
                oscillator.onended = () => {
                    oscillator.disconnect();
                    gain.disconnect();
                    this.activeTones.delete(oscillator);
                };
                this.activeTones.add(oscillator);
                oscillator.start(at);
                oscillator.stop(at + duration);
            }
            return true;
        } catch {
            this.stop();
            return false;
        }
    }
    preview(soundName) { this.userInteracted = true; return this.play(soundName, { preview: true }); }
    playNewTask() { return this.play('newTask'); }
    playTaskClaimed() { return this.play('taskClaimed'); }
    playTaskCompleted() { return this.play('taskCompleted'); }
    playError() { return this.play('error'); }
    playSuccess() { return this.play('success'); }
    playScanSuccess(type) { return this.play(type === 'pick' ? 'pickSuccess' : 'packSuccess'); }
}
const soundNotification = new SoundNotification();
export { soundNotification };
export default soundNotification;
