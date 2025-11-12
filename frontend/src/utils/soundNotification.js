// frontend/src/utils/soundNotification.js
// 音效通知工具 - 使用 Web Audio API 生成音效，無需外部音檔

class SoundNotification {
    constructor() {
        this.enabled = localStorage.getItem('sound_enabled') !== 'false'; // 預設開啟
        this.volume = parseFloat(localStorage.getItem('sound_volume') || '0.3');
        this.audioContext = null;
        
        // 延遲初始化 AudioContext（避免瀏覽器自動播放政策問題）
        this.initAudioContext = () => {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            return this.audioContext;
        };
    }

    /**
     * 播放單一音調
     * @param {number} frequency - 頻率 (Hz)
     * @param {number} duration - 持續時間（秒）
     * @param {number} startTime - 開始時間（相對於 AudioContext.currentTime）
     */
    playTone(frequency, duration, startTime = 0) {
        const ctx = this.initAudioContext();
        const now = ctx.currentTime + startTime;
        
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.frequency.value = frequency;
        oscillator.type = 'sine';

        // 音量包絡：快速淡入，緩慢淡出
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(this.volume, now + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + duration);

        oscillator.start(now);
        oscillator.stop(now + duration);
    }

    // 新任務到達 - 雙音提示音（叮咚）
    playNewTask() {
        if (!this.enabled) return;
        try {
            this.playTone(800, 0.15, 0);    // 高音
            this.playTone(600, 0.2, 0.15);  // 低音
        } catch (err) {
            console.warn('新任務音效播放失敗:', err);
        }
    }

    // 任務被認領 - 短促確認音
    playTaskClaimed() {
        if (!this.enabled) return;
        try {
            this.playTone(1000, 0.1, 0);
        } catch (err) {
            console.warn('任務認領音效播放失敗:', err);
        }
    }

    // 任務完成 - 上升三音階（C-E-G）
    playTaskCompleted() {
        if (!this.enabled) return;
        try {
            this.playTone(523, 0.1, 0);     // C5
            this.playTone(659, 0.1, 0.1);   // E5
            this.playTone(784, 0.15, 0.2);  // G5
        } catch (err) {
            console.warn('任務完成音效播放失敗:', err);
        }
    }

    // 錯誤提示 - 低沉警告音
    playError() {
        if (!this.enabled) return;
        try {
            this.playTone(200, 0.15, 0);
            this.playTone(150, 0.2, 0.15);
        } catch (err) {
            console.warn('錯誤音效播放失敗:', err);
        }
    }

    // 成功提示 - 清脆確認音
    playSuccess() {
        if (!this.enabled) return;
        try {
            this.playTone(1200, 0.08, 0);
        } catch (err) {
            console.warn('成功音效播放失敗:', err);
        }
    }

    /**
     * 通用播放方法
     * @param {string} soundName - 音效名稱: 'newTask', 'taskClaimed', 'taskCompleted', 'error', 'success'
     */
    play(soundName) {
        const methods = {
            newTask: () => this.playNewTask(),
            taskClaimed: () => this.playTaskClaimed(),
            taskCompleted: () => this.playTaskCompleted(),
            error: () => this.playError(),
            success: () => this.playSuccess()
        };

        const method = methods[soundName];
        if (method) {
            method();
        } else {
            console.warn(`未知的音效類型: ${soundName}`);
        }
    }

    // 開啟/關閉音效
    setEnabled(enabled) {
        this.enabled = enabled;
        localStorage.setItem('sound_enabled', enabled.toString());
    }

    // 檢查是否啟用
    isEnabled() {
        return this.enabled;
    }

    // 設定音量（0.0 - 1.0）
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        localStorage.setItem('sound_volume', this.volume.toString());
    }

    // 取得當前設定
    getSettings() {
        return {
            enabled: this.enabled,
            volume: this.volume
        };
    }
}

// 匯出單例
const soundNotification = new SoundNotification();
export { soundNotification };
export default soundNotification;
