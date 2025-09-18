// src/components/LoginPage.jsx
import React, { useState } from 'react';
import { Loader2, User, Lock } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '../api/api';

export function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLoginClick = async () => {
    // 基本验证
    if (!username || !password) {
        setError('請提供使用者名稱和密碼');
        return;
    }
    setError('');
    setIsLoggingIn(true);
    
    try {
        // 使用 POST 请求，并将 username 和 password 作为请求体发送
        const response = await apiClient.post('/api/auth/login', {
            username,
            password
        });
        
        // 【关键修改 1】后端返回的是一个包含 accessToken 和 user 对象的 data
        // 我们直接将整个 response.data 传递给 onLogin 函数
        const responseData = response.data;

        toast.success(`歡迎回來, ${responseData.user.name || responseData.user.username}!`);

        // 【关键修改 2】调用 App.jsx 传来的 onLogin 函数，并传入完整的 data 对象
        // App.jsx 会负责处理 localStorage 的存储
        onLogin(responseData);
        
    } catch (err) {
        // 处理登录失败
        console.error("登入失敗", err);
        const errorMessage = err.response?.data?.message || '登入時發生錯誤，請稍後再試。';
        setError(errorMessage);
        // 也可以使用 toast 来显示错误
        // toast.error('登入失敗', { description: errorMessage });
    } finally {
        setIsLoggingIn(false);
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
        className="w-full max-w-sm p-8 bg-white/60 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20"
        onKeyDown={handleKeyDown}
      >
        <div className="flex flex-col items-center mb-8">
          {/* 建议将图片放在 public 文件夹下，这样路径就是 /MOZTECH-002.png */}
          <img src="/MOZTECH-002.png" alt="MOZTECH Logo" className="h-24 w-24 mb-4 object-contain" />
          <h1 className="text-3xl font-bold text-gray-800">倉儲作業系統</h1>
        </div>

        <div className="space-y-6">
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="使用者名稱"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="pl-10 w-full px-4 py-3 bg-white/80 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          
          <div className="relative">
             <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="password"
              placeholder="密碼"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-10 w-full px-4 py-3 bg-white/80 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>
        
        {error && <p className="mt-4 text-center text-red-500 text-sm">{error}</p>}

        <div className="mt-6">
          <button
            onClick={handleLoginClick}
            disabled={!username || !password || isLoggingIn}
            className="w-full flex items-center justify-center gap-2 text-white font-bold py-3 px-4 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 transition-transform duration-200 hover:scale-105 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed disabled:scale-100"
          >
            {isLoggingIn ? <><Loader2 className="animate-spin h-5 w-5" />登入中...</> : '安全登入'}
          </button>
        </div>
      </div>
    </div>
  );
}