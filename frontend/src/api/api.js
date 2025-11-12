// src/api/api.js
import axios from 'axios';

// 1. 建立一個自訂的 axios 實例
const apiClient = axios.create({
    baseURL: 'https://moztech-wms-api.onrender.com', // 你的後端基礎 URL
    headers: {
        'Content-Type': 'application/json',
    },
});

// 2. 新增一個「請求攔截器 (Request Interceptor)」
// 這會在【每一次】請求發送前，自動執行這個函數
apiClient.interceptors.request.use(
    (config) => {
        // 從 localStorage 獲取 token（使用正確的 key: 'wms_token'）
        const tokenData = localStorage.getItem('wms_token');
        if (tokenData) {
            try {
                // useLocalStorage 會將資料以 JSON 格式儲存，所以需要 parse
                const token = JSON.parse(tokenData);
                if (token) {
                    // 如果 token 存在，就把它加到 Authorization 標頭裡
                    config.headers['Authorization'] = `Bearer ${token}`;
                }
            } catch (e) {
                console.error('解析 token 失敗:', e);
            }
        }
        return config;
    },
    (error) => {
        // 對請求錯誤做些什麼
        return Promise.reject(error);
    }
);

export default apiClient;