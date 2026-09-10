// frontend/src/utils/voiceNotification.js
// 語音播報工具 - 使用 Web Speech API

class VoiceNotification {
    constructor() {
        this.enabled = localStorage.getItem('voice_enabled') === 'true'; // 預設關閉
        this.synth = window.speechSynthesis;
        this.voice = null;
        
        // 初始化語音
        this.initVoice();
    }

    initVoice() {
        if (!this.synth) {
            console.warn('[VoiceNotification] 瀏覽器不支援語音播報');
            return;
        }

        // 等待語音列表載入
        const loadVoices = () => {
            const voices = this.synth.getVoices();
            // 優先選擇繁體中文語音
            this.voice = voices.find(v => v.lang === 'zh-TW') || 
                         voices.find(v => v.lang.startsWith('zh')) ||
                         voices[0];
            
            console.log('[VoiceNotification] 已選擇語音:', this.voice?.name, this.voice?.lang);
        };

        // 語音列表可能需要時間載入
        if (this.synth.getVoices().length > 0) {
            loadVoices();
        } else {
            this.synth.addEventListener('voiceschanged', loadVoices);
        }
    }

    /**
     * 播報文字
     * @param {string} text - 要播報的文字
     * @param {object} options - 播報選項 {rate, pitch, volume}
     */
    speak(text, options = {}) {
        if (!this.enabled || !this.synth) {
            console.log('[VoiceNotification] 語音播報已關閉或不支援');
            return;
        }

        // 停止當前播報
        this.synth.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        
        // 設定語音參數
        if (this.voice) {
            utterance.voice = this.voice;
        }
        utterance.lang = 'zh-TW';
        utterance.rate = options.rate || 1.0;    // 語速 (0.1-10)
        utterance.pitch = options.pitch || 1.0;  // 音調 (0-2)
        utterance.volume = options.volume || 1.0; // 音量 (0-1)

        console.log('[VoiceNotification] 播報:', text);
        this.synth.speak(utterance);
    }

    // === 預設播報訊息 ===

    /**
     * 掃描成功
     * @param {number} scannedCount - 已掃描數量
     * @param {number} remainingCount - 剩餘數量
     */
    speakScanSuccess(scannedCount, remainingCount) {
        if (remainingCount === 0) {
            this.speak('全部完成', { rate: 1.1 });
        } else {
            this.speak(`已掃描 ${scannedCount} 個，還剩 ${remainingCount} 個`, { rate: 1.2 });
        }
    }

    /**
     * 掃描錯誤
     */
    speakScanError() {
        this.speak('條碼錯誤！請確認', { rate: 1.3, pitch: 1.2 });
    }

    /**
     * 新任務到達
     * @param {number} taskCount - 新任務數量
     */
    speakNewTask(taskCount = 1) {
        if (taskCount === 1) {
            this.speak('新任務到達');
        } else {
            this.speak(`有 ${taskCount} 個新任務`);
        }
    }

    /**
     * 任務完成
     */
    speakTaskComplete() {
        this.speak('任務完成', { rate: 1.1 });
    }

    /**
     * 批次認領成功
     * @param {number} count - 認領數量
     */
    speakBatchClaim(count) {
        this.speak(`已認領 ${count} 個任務`, { rate: 1.2 });
    }

    /**
     * 操作錯誤
     * @param {string} message - 錯誤訊息(可選)
     */
    speakOperationError(message) {
        this.speak(message || '操作錯誤', { rate: 1.2, pitch: 1.1 });
    }

    // === 控制方法 ===

    /**
     * 停止當前播報
     */
    stop() {
        if (this.synth) {
            this.synth.cancel();
        }
    }

    /**
     * 暫停播報
     */
    pause() {
        if (this.synth && this.synth.speaking) {
            this.synth.pause();
        }
    }

    /**
     * 恢復播報
     */
    resume() {
        if (this.synth && this.synth.paused) {
            this.synth.resume();
        }
    }

    /**
     * 開啟/關閉語音播報
     */
    setEnabled(enabled) {
        console.log('[VoiceNotification] setEnabled:', enabled);
        this.enabled = enabled;
        localStorage.setItem('voice_enabled', enabled.toString());
        
        if (!enabled) {
            this.stop();
        }
    }

    /**
     * 檢查是否啟用
     */
    isEnabled() {
        return this.enabled;
    }

    /**
     * 檢查瀏覽器是否支援
     */
    isSupported() {
        return !!this.synth;
    }

    /**
     * 獲取可用語音列表
     */
    getVoices() {
        return this.synth ? this.synth.getVoices() : [];
    }

    /**
     * 設定語音
     * @param {SpeechSynthesisVoice} voice - 語音對象
     */
    setVoice(voice) {
        this.voice = voice;
        console.log('[VoiceNotification] 語音已切換:', voice.name);
    }
}

// 匯出單例
const voiceNotification = new VoiceNotification();
export { voiceNotification };
export default voiceNotification;
