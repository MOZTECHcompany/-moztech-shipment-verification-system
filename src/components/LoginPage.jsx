// src/components/LoginPage.jsx
import React, { useState } from 'react';
import { Loader2, User, Lock } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '../api/api'; // ✨ 1. 引入我們全局的 apiClient
import { userDatabase } from '../users';

export function LoginPage({ onLogin }) {
  const [username, setUsername] = useState(''); // 改成 username 來匹配後端
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLoginClick = async () => {
    setError('');
    setIsLoggingIn(true);
    
    try {
        // ✨ 2. 呼叫後端的 /api/auth/login API
        const response = await apiClient.post('/api/auth/login', {
            username,
            password
        });
        
        // ✨ 3. 從後端的回應中獲取 token 和 user 資訊
        const { token, user } = response.data;
        
        // ✨ 4. 將 token 和 user 資訊儲存到 localStorage
        localStorage.setItem('token', token);
        // 我們也在 App.jsx 層級儲存了 user，這裡可以不用重複儲存
        // localStorage.setItem('user', JSON.stringify(user));

        toast.success(`歡迎回來, ${user.name || user.username}!`);

        // ✨ 5. 呼叫 App.jsx 傳來的 onLogin 函數，更新全局狀態
        onLogin(user.id, user.role, user.name || user.username);
        
    } catch (err) {
        // 後端失敗時，嘗試本機離線帳號登入
        try {
          const localUser = userDatabase[username];
          if (localUser && localUser.password === btoa(String(password))) {
            const offlineUser = { id: username, username, name: localUser.name || username, role: localUser.role };
            localStorage.setItem('token', 'offline-token');
            toast.success(`已使用離線模式登入，歡迎 ${offlineUser.name}`);
            onLogin(offlineUser.id, offlineUser.role, offlineUser.name);
            setError('');
          } else {
            const errorMessage = err.response?.data?.message || '使用者名稱或密碼錯誤';
            setError(errorMessage);
          }
        } catch (offlineErr) {
          console.error('離線登入處理失敗', offlineErr);
          const errorMessage = err.response?.data?.message || '登入時發生錯誤，請稍後再試。';
          setError(errorMessage);
        }
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
              placeholder="使用者名稱" // 標籤也改成使用者名稱
              value={username}
              onChange={(e) => setUsername(e.target.value)}
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
        
        {error && <p className="mt-4 text-center text-red-500 text-sm">{error}</p>}

        <div className="mt-6">
          <button
            onClick={handleLoginClick}
            disabled={!username || !password || isLoggingIn}
            className={`w-full flex items-center justify-center gap-2 text-white font-bold py-3 px-4 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:scale-105 disabled:from-gray-400 disabled:to-gray-500 disabled:cursor-not-allowed disabled:scale-100`}
          >
            {isLoggingIn ? <><Loader2 className="animate-spin h-5 w-5" />登入中...</> : '安全登入'}
          </button>
        </div>
      </div>
    </div>
  );
}