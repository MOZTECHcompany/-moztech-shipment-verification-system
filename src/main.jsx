// src/main.jsx

import React from 'react';
import ReactDOM from 'react-dom/client';

// 【關鍵修改】將 App 的 import 移到 CSS import 的下面
// 確保 CSS 檔案被優先處理
import './index.css'; 
import App from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);