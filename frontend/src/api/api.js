import axios from 'axios';

// 根據環境變數智慧設定 baseURL
// 在本地開發時 (npm run dev)，import.meta.env.DEV 會是 true
// 在生產環境構建時 (npm run build)，import.meta.env.PROD 會是 true
const baseURL = import.meta.env.PROD
  ? 'https://moztech-wms-api.onrender.com' // 生產環境 API
  : 'http://localhost:3001';              // 開發環境 API

console.log(`[API] Current mode: ${import.meta.env.MODE}, Base URL: ${baseURL}`);

const apiClient = axios.create({
    baseURL: baseURL, // 使用智慧設定的 baseURL
    headers: {
        'Content-Type': 'application/json',
    },
});

// 請求攔截器 (這部分您的程式碼是完美的，保持不變)
apiClient.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers['Authorization'] = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

export default apiClient;