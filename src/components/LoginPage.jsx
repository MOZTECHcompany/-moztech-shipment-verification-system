// src/components/LoginPage.jsx
import React, { useState } from 'react';
import { LogIn, User, Lock, Loader2 } from 'lucide-react';
import { userDatabase } from '../users'; // 引入我們的使用者資料庫

export function LoginPage({ onLogin }) {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState(''); // 新增密碼 state
  const [error, setError] = useState(''); // 新增錯誤訊息 state
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLoginClick = () => {
    setError(''); // 先清除舊的錯誤訊息
    setIsLoggingIn(true);

    setTimeout(() => {
      const user = userDatabase[userId]; // 根據員工編號查找使用者

      // 驗證邏輯
      if (user && user.password === btoa(password)) {
        // 密碼正確，執行登入
        onLogin(userId, user.role, user.name);
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
    <div className="flex items-center justify-center min-h-screen p-4 font-sans bg-gray-50">
      <div
        className="w-[420px] p-8 bg-white shadow-xl rounded-2xl"
        onKeyDown={handleKeyDown}
      >
        <div className="flex flex-col items-center mb-8">
          <div className="bg-blue-100 p-4 rounded-full mb-4">
            <LogIn className="h-10 w-10 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-800">倉儲作業系統</h1>
        </div>

        <div className="space-y-4">
          {/* 員工編號輸入框 */}
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="員工編號"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="pl-10 w-full px-4 py-3 border rounded-lg"
            />
          </div>
          
          {/* 密碼輸入框 */}
          <div className="relative">
             <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="password"
              placeholder="密碼"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-10 w-full px-4 py-3 border rounded-lg"
            />
          </div>
        </div>
        
        {/* 顯示錯誤訊息 */}
        {error && <p className="mt-4 text-center text-red-500 text-sm">{error}</p>}

        {/* 登入按鈕 */}
        <div className="mt-6">
          <button
            onClick={handleLoginClick}
            disabled={!userId || !password || isLoggingIn}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
          >
            {isLoggingIn ? <Loader2 className="animate-spin" /> : '登入'}
          </button>
        </div>
      </div>
    </div>
  );
}