# 音效檔案說明

## 所需音效檔案

請在此目錄下放置以下音效檔案（MP3 格式）：

### 1. new-task.mp3
- **用途**: 新任務到達通知
- **建議音效**: 輕快的提示音（如：叮咚聲）
- **時長**: 1-2 秒

### 2. task-claimed.mp3
- **用途**: 任務被認領確認
- **建議音效**: 簡短確認音（如：咔噠聲）
- **時長**: 0.5-1 秒

### 3. task-completed.mp3
- **用途**: 任務完成慶祝
- **建議音效**: 愉快的完成音（如：成功音效）
- **時長**: 1-2 秒

### 4. error.mp3
- **用途**: 錯誤警示
- **建議音效**: 低沉警告音（如：嗶聲）
- **時長**: 0.5-1 秒

### 5. success.mp3
- **用途**: 操作成功確認
- **建議音效**: 清脆確認音（如：叮聲）
- **時長**: 0.5-1 秒

## 獲取免費音效資源

以下網站提供免費的音效檔案：

1. **Freesound.org** - https://freesound.org/
   - 需註冊，提供大量 CC 授權音效

2. **Zapsplat** - https://www.zapsplat.com/
   - 免費使用，音效品質高

3. **SoundBible** - http://soundbible.com/
   - 公共領域音效

4. **Mixkit** - https://mixkit.co/free-sound-effects/
   - 免費商用音效

## 快速設定（推薦）

如果您想快速測試，可以使用以下簡單的 Web Audio API 生成的音效：

```javascript
// 在瀏覽器 console 執行以下代碼來生成並下載簡單的提示音

function generateBeep(frequency, duration, filename) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + duration);
    
    // 此處需要額外的代碼來錄製並下載音效
    // 建議使用上述網站下載現成的音效檔案
}
```

## 音效使用規範

- **音量**: 建議音效檔案的音量保持在 -6dB 左右
- **格式**: MP3（瀏覽器相容性最佳）
- **檔案大小**: 每個檔案建議小於 50KB
- **取樣率**: 44.1kHz 或 48kHz

## 授權注意事項

確保您使用的音效檔案符合以下條件之一：
- 公共領域 (Public Domain)
- CC0 授權
- CC BY 授權（需標註作者）
- 您擁有商業使用權

## 臨時解決方案

如果暫時沒有音效檔案，系統會自動靜音運作。您可以稍後再添加音效檔案，無需修改程式碼。
