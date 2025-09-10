// src/api/api.js
import axios from 'axios';

// 1. 建立一個自訂的 axios 實例
//    允許透過環境變數設定 API Base URL（Vite: VITE_API_BASE_URL）
const API_BASE_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE_URL)
  ? import.meta.env.VITE_API_BASE_URL
  : 'https://moztech-wms-api.onrender.com';

const apiClient = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
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