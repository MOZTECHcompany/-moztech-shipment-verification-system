// src/components/LoginPage.jsx
import React, { useState } from 'react';
import { Loader2, User, Lock } from 'lucide-react';
import { userDatabase } from '../users'; // 引入我們的使用者資料庫

export function LoginPage({ onLogin }) {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLoginClick = () => {
    setError('');
    setIsLoggingIn(true);

    setTimeout(() => {
      // 【關鍵修改】在查找之前，將使用者輸入的 userId 轉換為小寫
      const userFromDb = userDatabase[userId.toLowerCase()]; 

      if (userFromDb && userFromDb.password === btoa(password)) {
        // 登入成功時，我們傳遞的是使用者輸入的原始 userId (或轉換成小寫的，取決於您的偏好)
        onLogin(userId, userFromDb.role, userFromDb.name);
      } else {
        setError('員工編號或密碼錯誤，請重新輸入。');
      }
      setIsLoggingIn(false);
    }, 500);
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
        <div className="flex flex-col items-center mb-8">
          <img src="/MOZTECH-002.png" alt="MOZTECH Logo" className="h-32 w-32 mb-4 object-contain" />
          <h1 className="text-3xl font-bold text-gray-800">倉儲作業系統</h1>
        </div>

        <div className="space-y-6">
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="員工編號"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="pl-10 w-full px-4 py-3 bg-white/80 border border-gray-300 rounded-lg"
            />
          </div>
          
          <div className="relative">
             <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="password"
              placeholder="密碼"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-10 w-full px-4 py-3 bg-white/80 border border-gray-300 rounded-lg"
            />
          </div>
        </div>
        
        {error && <p className="mt-4 text-center text-red-500 text-sm animate-pulse">{error}</p>}

        <div className="mt-6">
          <button
            onClick={handleLoginClick}
            disabled={!userId || !password || isLoggingIn}
            className={`w-full flex items-center justify-center gap-2 text-white font-bold py-3 px-4 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:scale-105 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed disabled:scale-100`}
          >
            {isLoggingIn ? <><Loader2 className="animate-spin h-5 w-5" />登入中...</> : '安全登入'}
          </button>
        </div>
      </div>
    </div>
  );
}