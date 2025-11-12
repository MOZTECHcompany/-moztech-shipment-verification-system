// backend/utils/logger.js
// 環境感知的日誌工具 - 生產環境只記錄錯誤，開發環境記錄所有資訊

const LOG_LEVELS = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3
};

class Logger {
    constructor() {
        // 根據環境變數決定日誌等級
        // 生產環境：只記錄錯誤和警告
        // 開發環境：記錄所有資訊
        this.level = process.env.NODE_ENV === 'production' ? LOG_LEVELS.WARN : LOG_LEVELS.DEBUG;
    }

    error(message, ...args) {
        if (this.level >= LOG_LEVELS.ERROR) {
            console.error(`[ERROR] ${new Date().toISOString()}:`, message, ...args);
        }
    }

    warn(message, ...args) {
        if (this.level >= LOG_LEVELS.WARN) {
            console.warn(`[WARN] ${new Date().toISOString()}:`, message, ...args);
        }
    }

    info(message, ...args) {
        if (this.level >= LOG_LEVELS.INFO) {
            console.log(`[INFO] ${new Date().toISOString()}:`, message, ...args);
        }
    }

    debug(message, ...args) {
        if (this.level >= LOG_LEVELS.DEBUG) {
            console.log(`[DEBUG] ${new Date().toISOString()}:`, message, ...args);
        }
    }

    // 特殊方法：安全地記錄包含敏感資訊的資料
    // 在生產環境中會隱藏敏感欄位
    debugSensitive(message, data) {
        if (this.level >= LOG_LEVELS.DEBUG) {
            if (process.env.NODE_ENV === 'production') {
                // 生產環境：隱藏敏感資訊
                const sanitized = this._sanitize(data);
                console.log(`[DEBUG] ${new Date().toISOString()}:`, message, sanitized);
            } else {
                // 開發環境：顯示完整資訊
                console.log(`[DEBUG] ${new Date().toISOString()}:`, message, data);
            }
        }
    }

    // 清理敏感資料
    _sanitize(data) {
        if (!data || typeof data !== 'object') return data;
        
        const sensitive = ['password', 'token', 'accessToken', 'authorization'];
        const sanitized = { ...data };
        
        for (const key of Object.keys(sanitized)) {
            if (sensitive.includes(key.toLowerCase())) {
                sanitized[key] = '***HIDDEN***';
            } else if (key.toLowerCase().includes('token') || key.toLowerCase().includes('password')) {
                sanitized[key] = '***HIDDEN***';
            }
        }
        
        return sanitized;
    }
}

// 匯出單例
const logger = new Logger();
module.exports = logger;
