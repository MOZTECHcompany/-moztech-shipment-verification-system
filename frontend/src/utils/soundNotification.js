// frontend/src/utils/soundNotification.js
// 音效通知工具 - 使用 Web Audio API 生成音效，無需外部音檔

class SoundNotification {
    constructor() {
        this.enabled = localStorage.getItem('sound_enabled') !== 'false'; // 預設開啟
        this.volume = parseFloat(localStorage.getItem('sound_volume') || '0.3');
        this.audioContext = null;
        this.initialized = false;
        this.userInteracted = false; // 追蹤用戶是否已互動
        
        // 延遲初始化 AudioContext（避免瀏覽器自動播放政策問題）
        this.initAudioContext = async () => {
            if (!this.audioContext) {
                try {
                    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    console.log('[SoundNotification] AudioContext 已創建, 狀態:', this.audioContext.state);
                } catch (error) {
                    console.error('[SoundNotification] 無法初始化 AudioContext:', error);
                    return null;
                }
            }
            
            // 如果 AudioContext 處於 suspended 狀態，嘗試恢復
            if (this.audioContext.state === 'suspended') {
                console.log('[SoundNotification] AudioContext 處於 suspended 狀態, 嘗試恢復...');
                try {
                    await this.audioContext.resume();
                    console.log('[SoundNotification] AudioContext 已恢復, 狀態:', this.audioContext.state);
                    this.initialized = true;
                } catch (err) {
                    console.error('[SoundNotification] 無法恢復 AudioContext:', err);
                    return null;
                }
            } else if (this.audioContext.state === 'running') {
                this.initialized = true;
            }
            
            return this.audioContext;
        };
        
        // 監聽用戶首次互動以啟動 AudioContext
        this.setupUserInteraction();
    }
    
    setupUserInteraction() {
        const activate = async () => {
            if (this.userInteracted) return;
            
            console.log('[SoundNotification] 用戶首次互動檢測到, 啟動 AudioContext...');
            this.userInteracted = true;
            
            // 立即初始化並恢復 AudioContext
            await this.initAudioContext();
            
            // 播放測試音效（靜音）以確保 AudioContext 真正啟動
            if (this.audioContext && this.audioContext.state === 'running') {
                try {
                    const testOsc = this.audioContext.createOscillator();
                    const testGain = this.audioContext.createGain();
                    testGain.gain.value = 0; // 靜音測試
                    testOsc.connect(testGain);
                    testGain.connect(this.audioContext.destination);
                    testOsc.start();
                    testOsc.stop(this.audioContext.currentTime + 0.001);
                    console.log('[SoundNotification] AudioContext 測試成功');
                } catch (e) {
                    console.warn('[SoundNotification] AudioContext 測試失敗:', e);
                }
            }
            
            // 移除監聽器
            document.removeEventListener('click', activate);
            document.removeEventListener('keydown', activate);
            document.removeEventListener('touchstart', activate);
        };
        
        document.addEventListener('click', activate, { once: true });
        document.addEventListener('keydown', activate, { once: true });
        document.addEventListener('touchstart', activate, { once: true });
    }

    /**
     * 播放單一音調
     * @param {number} frequency - 頻率 (Hz)
     * @param {number} duration - 持續時間（秒）
     * @param {number} startTime - 開始時間（相對於 AudioContext.currentTime）
     */
    async playTone(frequency, duration, startTime = 0) {
        const ctx = await this.initAudioContext();
        
        if (!ctx || ctx.state !== 'running') {
            console.warn('[SoundNotification] AudioContext 未就緒, 狀態:', ctx?.state || 'null');
            return;
        }
        
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
    async playNewTask() {
        if (!this.enabled) return;
        try {
            await this.playTone(800, 0.15, 0);    // 高音
            await this.playTone(600, 0.2, 0.15);  // 低音
        } catch (err) {
            console.warn('新任務音效播放失敗:', err);
        }
    }

    // 任務被認領 - 短促確認音
    async playTaskClaimed() {
        if (!this.enabled) return;
        try {
            await this.playTone(1000, 0.1, 0);
        } catch (err) {
            console.warn('任務認領音效播放失敗:', err);
        }
    }

    // 任務完成 - 上升三音階（C-E-G）
    async playTaskCompleted() {
        if (!this.enabled) return;
        try {
            await this.playTone(523, 0.1, 0);     // C5
            await this.playTone(659, 0.1, 0.1);   // E5
            await this.playTone(784, 0.15, 0.2);  // G5
        } catch (err) {
            console.warn('任務完成音效播放失敗:', err);
        }
    }

    // 錯誤提示 - 低沉警告音
    async playError() {
        if (!this.enabled) return;
        try {
            await this.playTone(200, 0.15, 0);
            await this.playTone(150, 0.2, 0.15);
        } catch (err) {
            console.warn('錯誤音效播放失敗:', err);
        }
    }

    // 成功提示 - 清脆確認音
    async playSuccess() {
        if (!this.enabled) return;
        try {
            await this.playTone(1200, 0.08, 0);
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
