import axios from 'axios';

// 從環境變數讀取後端 API 的 URL，這是一個好習慣
// 在 .env 檔案中可以設定 VITE_API_URL=https://moztech-wms-api.onrender.com
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_URL,
});

// 建立請求攔截器 (Request Interceptor)
api.interceptors.request.use(
  (config) => {
    // 從 localStorage 中獲取 token
    const token = localStorage.getItem('token');
    
    // 如果 token 存在，則在每個請求的 Header 中加入 Authorization
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    
    return config;
  },
  (error) => {
    // 對請求錯誤做些什麼
    return Promise.reject(error);
  }
);

// 如果需要，也可以加入回應攔截器來處理 401/403 等全局錯誤
// api.interceptors.response.use(...)

export default api;