// 檔案路徑: src/api/api.js
import axios from 'axios';

const apiClient = axios.create({
    // 將這裡的 URL 換成您 `moztech-wms-api` 服務的 URL
    baseURL: 'https://moztech-wms-api.onrender.com', 
    headers: {
        'Content-Type': 'application/json',
    },
});

// ... (後面的攔截器不變)