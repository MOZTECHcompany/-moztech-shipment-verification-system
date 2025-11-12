// frontend/src/utils/soundNotification.js
// 音效通知工具 - 處理各種系統事件的音效提示

class SoundNotification {
    constructor() {
        this.enabled = localStorage.getItem('sound_enabled') !== 'false'; // 預設開啟
        this.volume = parseFloat(localStorage.getItem('sound_volume') || '0.5');
        this.sounds = {
            newTask: new Audio('/sounds/new-task.mp3'),
            taskClaimed: new Audio('/sounds/task-claimed.mp3'),
            taskCompleted: new Audio('/sounds/task-completed.mp3'),
            error: new Audio('/sounds/error.mp3'),
            success: new Audio('/sounds/success.mp3')
        };
        
        // 設定音量
        Object.values(this.sounds).forEach(sound => {
            sound.volume = this.volume;
        });
    }

    // 播放音效
    play(soundName) {
        if (!this.enabled) return;
        
        const sound = this.sounds[soundName];
        if (sound) {
            sound.currentTime = 0; // 重置播放位置
            sound.play().catch(err => {
                console.warn('音效播放失敗:', err);
            });
        }
    }

    // 新任務到達
    playNewTask() {
        this.play('newTask');
    }

    // 任務被認領
    playTaskClaimed() {
        this.play('taskClaimed');
    }

    // 任務完成
    playTaskCompleted() {
        this.play('taskCompleted');
    }

    // 錯誤提示
    playError() {
        this.play('error');
    }

    // 成功提示
    playSuccess() {
        this.play('success');
    }

    // 開啟/關閉音效
    setEnabled(enabled) {
        this.enabled = enabled;
        localStorage.setItem('sound_enabled', enabled.toString());
    }

    // 設定音量（0.0 - 1.0）
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        localStorage.setItem('sound_volume', this.volume.toString());
        Object.values(this.sounds).forEach(sound => {
            sound.volume = this.volume;
        });
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
export default soundNotification;
