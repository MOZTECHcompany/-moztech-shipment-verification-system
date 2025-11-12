// frontend/src/components/LoginPage-modern.jsx
// Apple 風格現代化登入頁面

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, User, Lock, ArrowRight, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '../api/api';

export function LoginPage({ onLogin }) {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [focusedField, setFocusedField] = useState(null);

  const handleLoginClick = async () => {
    if (!username || !password) {
        setError('請提供使用者名稱和密碼');
        toast.error('請填寫完整登入資訊');
        return;
    }
    setError('');
    setIsLoggingIn(true);
    
    try {
        const response = await apiClient.post('/api/auth/login', {
            username,
            password
        });
        
        const responseData = response.data;
        toast.success(`🎉 歡迎回來，${responseData.user.name || responseData.user.username}！`);
        onLogin(responseData);
        
        if (responseData.user.role === 'admin') {
            navigate('/admin');
        } else {
            navigate('/tasks');
        }
        
    } catch (err) {
        console.error("登入失敗", err);
        const errorMessage = err.response?.data?.message || '登入時發生錯誤，請稍後再試。';
        setError(errorMessage);
        toast.error(errorMessage);
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
    <div className="relative flex items-center justify-center min-h-screen p-4 overflow-hidden bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* 背景裝飾 */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-20 w-72 h-72 bg-blue-400/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-20 right-20 w-96 h-96 bg-purple-400/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-pink-400/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      {/* 登入卡片 */}
      <div
        className="relative w-full max-w-md animate-scale-in"
        onKeyDown={handleKeyDown}
      >
        {/* 主卡片 */}
        <div className="glass rounded-3xl p-10 shadow-apple-xl border border-white/30">
          {/* Logo 和標題 */}
          <div className="flex flex-col items-center mb-10 animate-fade-in">
            <div className="relative mb-6">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-purple-600 rounded-3xl blur-xl opacity-30 animate-pulse" />
              <img 
                src="/MOZTECH-002.png" 
                alt="MOZTECH Logo" 
                className="relative h-28 w-28 object-contain drop-shadow-2xl" 
              />
            </div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-gray-900 via-gray-800 to-gray-700 bg-clip-text text-transparent mb-2">
              倉儲作業系統
            </h1>
            <p className="text-gray-500 text-sm flex items-center gap-1">
              <Sparkles size={14} className="text-blue-500" />
              現代化智能管理平台
            </p>
          </div>

          {/* 輸入欄位 */}
          <div className="space-y-5 mb-6">
            {/* 使用者名稱 */}
            <div className="animate-slide-up" style={{ animationDelay: '100ms' }}>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                使用者名稱
              </label>
              <div className="relative group">
                <div className={`
                  absolute inset-0 rounded-xl transition-all duration-300
                  ${focusedField === 'username' 
                    ? 'bg-gradient-to-r from-blue-500 to-purple-600 opacity-20 blur-md' 
                    : 'opacity-0'
                  }
                `} />
                <User className={`
                  absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 transition-colors duration-200
                  ${focusedField === 'username' ? 'text-blue-600' : 'text-gray-400'}
                `} />
                <input 
                  type="text" 
                  placeholder="請輸入使用者名稱" 
                  value={username} 
                  onChange={(e) => setUsername(e.target.value)}
                  onFocus={() => setFocusedField('username')}
                  onBlur={() => setFocusedField(null)}
                  className="
                    relative w-full pl-12 pr-4 py-4 
                    bg-white/80 backdrop-blur-sm
                    border-2 border-gray-200
                    rounded-xl 
                    focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10
                    outline-none transition-all duration-200
                    text-gray-900 placeholder-gray-400
                  " 
                />
              </div>
            </div>

            {/* 密碼 */}
            <div className="animate-slide-up" style={{ animationDelay: '200ms' }}>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                密碼
              </label>
              <div className="relative group">
                <div className={`
                  absolute inset-0 rounded-xl transition-all duration-300
                  ${focusedField === 'password' 
                    ? 'bg-gradient-to-r from-blue-500 to-purple-600 opacity-20 blur-md' 
                    : 'opacity-0'
                  }
                `} />
                <Lock className={`
                  absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 transition-colors duration-200
                  ${focusedField === 'password' ? 'text-blue-600' : 'text-gray-400'}
                `} />
                <input 
                  type="password" 
                  placeholder="請輸入密碼" 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocusedField('password')}
                  onBlur={() => setFocusedField(null)}
                  className="
                    relative w-full pl-12 pr-4 py-4 
                    bg-white/80 backdrop-blur-sm
                    border-2 border-gray-200
                    rounded-xl 
                    focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10
                    outline-none transition-all duration-200
                    text-gray-900 placeholder-gray-400
                  " 
                />
              </div>
            </div>
          </div>

          {/* 錯誤訊息 */}
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl animate-shake">
              <p className="text-sm text-red-600 text-center">{error}</p>
            </div>
          )}

          {/* 登入按鈕 */}
          <button 
            onClick={handleLoginClick} 
            disabled={isLoggingIn}
            className="
              w-full py-4 px-6
              bg-gradient-to-r from-blue-600 to-purple-600
              hover:from-blue-700 hover:to-purple-700
              disabled:from-gray-400 disabled:to-gray-500
              text-white font-semibold text-lg
              rounded-xl
              shadow-lg shadow-blue-500/30
              hover:shadow-xl hover:shadow-blue-500/40
              active:scale-[0.98]
              transition-all duration-200
              flex items-center justify-center gap-2
              group
              animate-slide-up
            "
            style={{ animationDelay: '300ms' }}
          >
            {isLoggingIn ? (
              <>
                <Loader2 className="animate-spin" size={22} />
                登入中...
              </>
            ) : (
              <>
                登入
                <ArrowRight size={22} className="group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>

          {/* 底部提示 */}
          <div className="mt-8 text-center animate-fade-in" style={{ animationDelay: '400ms' }}>
            <p className="text-sm text-gray-500">
              © 2025 MOZTECH 倉儲管理系統
            </p>
          </div>
        </div>

        {/* 裝飾性卡片陰影 */}
        <div className="absolute -inset-4 bg-gradient-to-r from-blue-500/10 to-purple-500/10 rounded-3xl blur-2xl -z-10" />
      </div>
    </div>
  );
}
