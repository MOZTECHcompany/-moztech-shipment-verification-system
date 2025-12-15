// frontend/src/components/LoginPage-modern.jsx
// Apple 風格現代化登入頁面

// 統一使用設計系統元件的登入頁
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, User, Lock, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import apiClient from '../api/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Button, Input } from '../ui';

export function LoginPage({ onLogin }) {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLoginClick = async () => {
    if (!username || !password) {
      setError('請提供使用者名稱和密碼');
      toast.error('請填寫完整登入資訊');
      return;
    }
    setError('');
    setIsLoggingIn(true);
    try {
      const response = await apiClient.post('/api/auth/login', { username, password });
      const responseData = response.data;
      toast.success(`🎉 歡迎回來，${responseData.user.name || responseData.user.username}！`);
      onLogin(responseData);
      if (responseData.user.role === 'admin' || responseData.user.role === 'superadmin') {
        navigate('/admin');
      } else {
        navigate('/tasks');
      }
    } catch (err) {
      console.error('登入失敗', err);
      const errorMessage = err.response?.data?.message || '登入時發生錯誤，請稍後再試。';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleLoginClick();
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 sm:px-6 lg:px-10 py-12 sm:py-16 bg-gradient-to-br from-gray-50 via-white to-gray-100 safe-top safe-bottom">
      <div className="w-full max-w-[420px] sm:max-w-md" onKeyDown={handleKeyDown}>
        <Card className="p-0 overflow-hidden shadow-2xl border-white/30">
          <CardHeader className="pt-10 px-6 sm:px-10 pb-6 text-center space-y-4">
            <div className="flex justify-center">
              <img src="/MOZTECH-002.png" alt="MOZTECH Logo" className="h-16 w-16 sm:h-20 sm:w-20 object-contain" />
            </div>
            <div>
              <CardTitle className="text-xl sm:text-2xl tracking-tight">倉儲作業系統</CardTitle>
              <CardDescription className="mt-2 text-sm">現代化智能管理平台</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-6 sm:px-10 pb-6">
            <div className="space-y-5">
              <Input
                label="使用者名稱"
                icon={User}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="請輸入使用者名稱"
                autoComplete="username"
              />
              <Input
                label="密碼"
                type="password"
                icon={Lock}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="請輸入密碼"
                autoComplete="current-password"
              />
              {error && (
                <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-center">
                  <p className="text-sm font-medium text-red-600">{error}</p>
                </div>
              )}
              <Button
                onClick={handleLoginClick}
                disabled={isLoggingIn}
                variant="primary"
                size="lg"
                className="w-full justify-center gap-2"
              >
                {isLoggingIn ? (
                  <>
                    <Loader2 className="animate-spin" />
                    登入中...
                  </>
                ) : (
                  <>
                    登入
                    <ArrowRight className="ml-1" />
                  </>
                )}
              </Button>
            </div>
          </CardContent>
          <CardFooter className="px-6 sm:px-10 pb-8 pt-0 text-center">
            <p className="text-xs text-gray-400 font-medium">© 2025 MOZTECH 倉儲管理系統</p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
