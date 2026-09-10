// frontend/src/utils/desktopNotification.js
// 桌面通知工具 - 使用 Notification API

class DesktopNotification {
    constructor() {
        this.enabled = localStorage.getItem('desktop_notification_enabled') === 'true';
        this.permission = 'default';
        
        // 檢查瀏覽器支援
        if ('Notification' in window) {
            this.permission = Notification.permission;
            console.log('[DesktopNotification] 瀏覽器支援桌面通知, 權限:', this.permission);
        } else {
            console.warn('[DesktopNotification] 瀏覽器不支援桌面通知');
        }
    }

    /**
     * 請求通知權限
     */
    async requestPermission() {
        if (!('Notification' in window)) {
            console.warn('[DesktopNotification] 瀏覽器不支援桌面通知');
            return false;
        }

        if (this.permission === 'granted') {
            console.log('[DesktopNotification] 已有通知權限');
            return true;
        }

        try {
            const permission = await Notification.requestPermission();
            this.permission = permission;
            console.log('[DesktopNotification] 權限請求結果:', permission);
            
            if (permission === 'granted') {
                this.setEnabled(true);
                return true;
            }
            return false;
        } catch (error) {
            console.error('[DesktopNotification] 請求權限失敗:', error);
            return false;
        }
    }

    /**
     * 顯示通知
     * @param {string} title - 通知標題
     * @param {object} options - 通知選項
     */
    show(title, options = {}) {
        if (!this.enabled || this.permission !== 'granted') {
            console.log('[DesktopNotification] 通知已關閉或無權限');
            return null;
        }

        const defaultOptions = {
            icon: '/branding/corely-app.png',
            badge: '/branding/corely-app.png',
            dir: 'auto',
            lang: 'zh-TW',
            requireInteraction: false,
            silent: false,
            ...options
        };

        try {
            const notification = new Notification(title, defaultOptions);
            
            // 點擊通知時聚焦視窗
            notification.onclick = (event) => {
                event.preventDefault();
                window.focus();
                if (options.onClick) {
                    options.onClick(event);
                }
                notification.close();
            };

            // 自動關閉
            if (!defaultOptions.requireInteraction) {
                setTimeout(() => notification.close(), options.duration || 5000);
            }

            console.log('[DesktopNotification] 通知已顯示:', title);
            return notification;
        } catch (error) {
            console.error('[DesktopNotification] 顯示通知失敗:', error);
            return null;
        }
    }

    // === 預設通知訊息 ===

    /**
     * 新任務通知
     * @param {object} task - 任務資訊
     */
    notifyNewTask(task) {
        return this.show('🆕 新任務到達', {
            body: `訂單: ${task.voucher_number}\n客戶: ${task.customer_name}`,
            tag: 'new-task',
            icon: '/branding/corely-app.png',
            requireInteraction: true, // 需要用戶手動關閉
            data: { type: 'new-task', taskId: task.id }
        });
    }

    /**
     * 批次新任務通知
     * @param {number} count - 任務數量
     */
    notifyNewTasks(count) {
        return this.show('🆕 新任務到達', {
            body: `有 ${count} 個新任務等待處理`,
            tag: 'new-tasks',
            icon: '/branding/corely-app.png',
            requireInteraction: true
        });
    }

    /**
     * 任務完成通知
     * @param {string} voucherNumber - 訂單號
     */
    notifyTaskComplete(voucherNumber) {
        return this.show('✅ 任務完成', {
            body: `訂單 ${voucherNumber} 已完成`,
            tag: 'task-complete',
            duration: 3000
        });
    }

    /**
     * 掃描錯誤通知
     * @param {string} message - 錯誤訊息
     */
    notifyScanError(message) {
        return this.show('❌ 掃描錯誤', {
            body: message,
            tag: 'scan-error',
            duration: 4000,
            requireInteraction: false
        });
    }

    /**
     * 批次認領成功通知
     * @param {number} count - 認領數量
     */
    notifyBatchClaim(count) {
        return this.show('✅ 批次認領成功', {
            body: `已成功認領 ${count} 個任務`,
            tag: 'batch-claim',
            duration: 3000
        });
    }

    /**
     * 系統提示通知
     * @param {string} title - 標題
     * @param {string} message - 訊息
     */
    notifySystemMessage(title, message) {
        return this.show(`ℹ️ ${title}`, {
            body: message,
            tag: 'system-message',
            duration: 5000
        });
    }

    /**
     * 警告通知
     * @param {string} message - 警告訊息
     */
    notifyWarning(message) {
        return this.show('⚠️ 警告', {
            body: message,
            tag: 'warning',
            requireInteraction: true
        });
    }

    // === 控制方法 ===

    /**
     * 開啟/關閉桌面通知
     */
    async setEnabled(enabled) {
        console.log('[DesktopNotification] setEnabled:', enabled);
        
        if (enabled && this.permission !== 'granted') {
            // 需要先請求權限
            const granted = await this.requestPermission();
            if (!granted) {
                console.warn('[DesktopNotification] 無法開啟通知，權限未授予');
                return false;
            }
        }
        
        this.enabled = enabled;
        localStorage.setItem('desktop_notification_enabled', enabled.toString());
        return true;
    }

    /**
     * 檢查是否啟用
     */
    isEnabled() {
        return this.enabled && this.permission === 'granted';
    }

    /**
     * 檢查瀏覽器是否支援
     */
    isSupported() {
        return 'Notification' in window;
    }

    /**
     * 獲取當前權限狀態
     */
    getPermission() {
        return this.permission;
    }

    /**
     * 關閉所有通知 (僅 Chrome/Edge 支援)
     */
    closeAll() {
        // 注意: 這個功能不是所有瀏覽器都支援
        console.log('[DesktopNotification] 嘗試關閉所有通知');
    }
}

// 匯出單例
const desktopNotification = new DesktopNotification();
export { desktopNotification };
export default desktopNotification;
