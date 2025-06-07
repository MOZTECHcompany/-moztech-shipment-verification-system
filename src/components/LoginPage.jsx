// src/components/LoginPage.jsx
import React, { useState } from 'react'; // 確保 React 被引入
import { LogIn } from 'lucide-react'; // 引入圖示

export function LoginPage({ onLogin }) {
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('');

  const handleLoginClick = () => {
    if (userId.trim() && role) {
      onLogin(userId, role);
    }
  };
  
  // 增加 Enter 鍵登入功能
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleLoginClick();
    }
  };

  return (
    // 使用 Flexbox 讓整個卡片在螢幕中垂直和水平置中
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      
      {/* 登入卡片 */}
      <div 
        className="p-8 bg-white shadow-xl rounded-2xl w-full max-w-sm transform transition-all hover:scale-105"
        // 將 keydown 事件綁定到整個卡片上
        onKeyDown={handleKeyDown}
      >
        <div className="flex flex-col items-center mb-6">
          <div className="bg-blue-100 p-3 rounded-full mb-3">
            <LogIn className="h-8 w-8 text-blue-600" />
          </div>
          {/* 標題置中 */}
          <h1 className="text-2xl font-bold text-gray-800 text-center">
            倉儲作業系統
          </h1>
          <p className="text-sm text-gray-500 mt-1">請登入以開始作業</p>
        </div>

        {/* 輸入欄位 */}
        <div className="space-y-4">
          <div>
            <label htmlFor="userId" className="text-sm font-medium text-gray-700">員工編號</label>
            <input
              id="userId"
              type="text"
              placeholder="請輸入您的員工編號"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
            />
          </div>
          
          <div>
            <label htmlFor="role" className="text-sm font-medium text-gray-700">選擇身份</label>
            <select
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1 w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">請選擇...</option>
              <option value="picker">揀貨人員</option>
              <option value="packer">裝箱人員</option>
            </select>
          </div>

          {/* 登入按鈕 */}
          <button
            onClick={handleLoginClick}
            disabled={!userId.trim() || !role}
            className="w-full bg-blue-600 text-white font-semibold py-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            登入
          </button>
        </div>
      </div>
    </div>
  );
}