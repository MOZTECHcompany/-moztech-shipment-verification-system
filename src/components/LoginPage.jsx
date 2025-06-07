// src/components/LoginPage.jsx
import React, { useState } from 'react';
import { LogIn, User, Shield, Loader2 } from 'lucide-react';

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
    <div className="flex items-center justify-center min-h-screen p-4 font-sans">
      <div
        className="w-[420px] p-8 bg-white/60 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20"
        onKeyDown={handleKeyDown}
      >
        <div className="flex flex-col items-center mb-8">
          <div className="bg-white/70 p-4 rounded-full mb-4 shadow-inner">
            <LogIn className="h-10 w-10 text-indigo-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-800">
            倉儲作業系統
          </h1>
          <p className="text-gray-600 mt-2">請登入以開始您的作業流程</p>
        </div>

        <div className="space-y-6">
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              id="userId"
              type="text"
              placeholder="員工編號"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="pl-10 w-full px-4 py-3 bg-white/80 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
            />
          </div>

          <div className="relative">
            <Shield className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <select
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="pl-10 appearance-none w-full px-4 py-3 bg-white/80 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
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