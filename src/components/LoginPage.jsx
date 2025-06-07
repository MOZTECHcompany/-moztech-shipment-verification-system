// src/components/LoginPage.jsx
import React, { useState } from 'react';
import { Loader2, User, Lock } from 'lucide-react';
import { userDatabase } from '../users'; // 【新增】引入我們的使用者資料庫

export function LoginPage({ onLogin }) {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState(''); // 【新增】密碼 state
  const [error, setError] = useState('');     // 【新增】錯誤訊息 state
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLoginClick = () => {
    setError(''); // 先清除舊的錯誤訊息
    setIsLoggingIn(true);

    setTimeout(() => {
      const userFromDb = userDatabase[userId.toLowerCase()]; // 根據員工編號查找使用者 (忽略大小寫)

      // 【核心修改】驗證邏輯
      if (userFromDb && userFromDb.password === btoa(password)) {
        // 帳號密碼都正確，執行登入
        onLogin(userId, userFromDb.role, userFromDb.name);
      } else {
        // 帳號或密碼錯誤
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
          {/* 員工編號輸入框 */}
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
          
          {/* 【修改】密碼輸入框 */}
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
        
        {/* 顯示錯誤訊息 */}
        {error && <p className="mt-4 text-center text-red-500 text-sm animate-pulse">{error}</p>}

        <div className="mt-8">
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