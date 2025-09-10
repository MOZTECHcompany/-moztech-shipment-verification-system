// src/api/api.js
import axios from 'axios';

// 1. 建立一個自訂的 axios 實例
// 動態決定 baseURL：
// - 若設定了 VITE_API_URL，則使用該 URL
// - 否則使用相對路徑，讓開發環境由 Vite 代理到後端、正式環境由同網域反向代理
const resolvedBaseURL = import.meta.env.VITE_API_URL || '/';

const apiClient = axios.create({
    baseURL: resolvedBaseURL,
    headers: {
        'Content-Type': 'application/json',
    },
    // 跨來源時攜帶憑證（若後端需要）
    withCredentials: false,
});

// 2. 新增一個「請求攔截器 (Request Interceptor)」
// 這會在【每一次】請求發送前，自動執行這個函數
apiClient.interceptors.request.use(
    (config) => {
        // 從 localStorage 獲取 token
        const token = localStorage.getItem('token');
        if (token) {
            // 如果 token 存在，就把它加到 Authorization 標頭裡
            config.headers['Authorization'] = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        // 對請求錯誤做些什麼
        return Promise.reject(error);
    }
);

export default apiClient;