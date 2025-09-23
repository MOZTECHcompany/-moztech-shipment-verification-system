// frontend/src/api/api.js

import axios from 'axios';

/**
 * 根據環境變數智慧設定 API 的基礎 URL。
 * - 在本地開發環境 (npm run dev)，它會指向 http://localhost:3001/api
 * - 在生產部署環境 (npm run build)，它會指向 https://moztech-wms-api.onrender.com/api
 * 這樣做的好處是，開發人員無需手動切換 API 地址，且元件內呼叫 API 時無需關心 /api 前綴。
 */
const baseURL = import.meta.env.PROD
  ? 'https://moztech-wms-api.onrender.com/api' // 生產環境 API (已包含 /api)
  : 'http://localhost:3001/api';              // 開發環境 API (已包含 /api)

// 在開發者工具的 Console 中印出目前的 API 環境，方便除錯
console.log(`[API Service] Initialized. Mode: ${import.meta.env.MODE}, Base URL: ${baseURL}`);

// 建立一個自訂配置的 Axios 實例
const apiClient = axios.create({
    baseURL: baseURL, // 使用上面智慧設定的 baseURL
    headers: {
        'Content-Type': 'application/json',
    },
});

/**
 * 設置 Axios 請求攔截器 (Request Interceptor)。
 * 這個攔截器會在每一次透過 apiClient 發送請求之前自動執行。
 * 它的核心作用是檢查本地儲存 (localStorage) 中是否存在 JWT，
 * 如果存在，就自動將其附加到請求的 Authorization 標頭中。
 * 這確保了所有需要認證的 API 請求都能攜帶有效的身份憑證。
 */
apiClient.interceptors.request.use(
    (config) => {
        // 從 localStorage 中獲取 token
        const token = localStorage.getItem('token');
        
        // 如果 token 存在，則將其格式化為 "Bearer <token>" 並設置到標頭中
        if (token) {
            config.headers['Authorization'] = `Bearer ${token}`;
        }
        
        // 返回修改後的 config 物件，讓請求繼續發送
        return config;
    },
    (error) => {
        // 如果在設置請求時發生錯誤，則將錯誤拋出
        return Promise.reject(error);
    }
);

/**
 * 也可以選擇性地添加回應攔截器 (Response Interceptor) 來全局處理錯誤。
 * 例如，如果收到 401 Unauthorized 錯誤，可以在這裡統一處理登出邏輯。
 */
// apiClient.interceptors.response.use(
//     (response) => response,
//     (error) => {
//         if (error.response && error.response.status === 401) {
//             // 例如：清除本地 token 並導向到登入頁
//             localStorage.removeItem('token');
//             window.location.href = '/login';
//         }
//         return Promise.reject(error);
//     }
// );


// 匯出這個配置好的 apiClient 實例，供整個應用程式使用
export default apiClient;