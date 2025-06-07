// src/components/LoginPage.jsx
import React, { useState } from 'react';
// 我們不再需要從 lucide-react 引入 LogIn, User, Shield 等圖示
// import { LogIn, User, Shield, Loader2 } from 'lucide-react'; 
import { Loader2 } from 'lucide-react'; // 只保留 Loader2 給按鈕用

export function LoginPage({ onLogin }) {
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLoginClick = () => {
    if (userId.trim() && role && !isLoggingIn) {
      setIsLoggingIn(true);
      setTimeout(() => {
        onLogin(userId, role);
        setIsLoggingIn(false);
      }, 500);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleLoginClick();
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen p-4 font-sans bg-gradient-to-br from-indigo-100 via-purple-100 to-pink-100">
      <div
        className="w-[420px] p-8 bg-white/60 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20"
        onKeyDown={handleKeyDown}
      >
        {/* 【關鍵修改】將圖示區塊換成您公司的 LOGO */}
        <div className="flex flex-col items-center mb-8">
          <img 
            src="/moztech-logo.png" // 直接引用 public 資料夾下的路徑
            alt="MOZTECH Logo" 
            className="h-24 w-24 mb-4" // 調整 LOGO 大小
          />
          <h1 className="text-3xl font-bold text-gray-800">
            倉儲作業系統
          </h1>
          <p className="text-gray-600 mt-2">請登入以開始您的作業流程</p>
        </div>

        <div className="space-y-6">
          {/* 【關鍵修改】移除輸入框前面的圖示 */}
          <div>
            <label htmlFor="userId" className="text-sm font-medium text-gray-700">員工編號</label>
            <input
              id="userId"
              type="text"
              placeholder="請輸入您的員工編號"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="mt-1 w-full px-4 py-3 bg-white/80 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
            />
          </div>

          <div>
            <label htmlFor="role" className="text-sm font-medium text-gray-700">選擇身份</label>
            <select
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1 w-full px-4 py-3 bg-white/80 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
            >
              <option value="" disabled>請選擇身份...</option>
              <option value="picker">揀貨人員</option>
              <option value="packer">裝箱人員</option>
            </select>
          </div>
        </div>

        <div className="mt-8">
          <button
            onClick={handleLoginClick}
            disabled={!userId.trim() || !role || isLoggingIn}
            className={`w-full flex items-center justify-center gap-2 text-white font-bold py-3 px-4 rounded-lg transition-all duration-300 transform
                        bg-gradient-to-r from-purple-600 to-indigo-600
                        hover:from-purple-700 hover:to-indigo-700 hover:scale-105
                        focus:outline-none focus:ring-4 focus:ring-purple-300
                        disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed disabled:scale-100`}
          >
            {isLoggingIn ? (
              <>
                <Loader2 className="animate-spin h-5 w-5" />
                登入中...
              </>
            ) : (
              '安全登入'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}