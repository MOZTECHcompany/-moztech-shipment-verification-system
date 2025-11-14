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
      if (responseData.user.role === 'admin') {
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
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-gray-50 via-white to-gray-100">
      <div className="w-full max-w-md" onKeyDown={handleKeyDown}>
        <Card className="p-0 overflow-hidden">
          <CardHeader className="pt-10 px-10 pb-6 text-center">
            <div className="flex justify-center mb-8">
              <img src="/MOZTECH-002.png" alt="MOZTECH Logo" className="h-20 w-20 object-contain" />
            </div>
            <CardTitle className="text-2xl tracking-tight">倉儲作業系統</CardTitle>
            <CardDescription className="mt-2 text-sm">現代化智能管理平台</CardDescription>
          </CardHeader>
          <CardContent className="px-10 pb-4">
            <div className="space-y-6">
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
                <div className="p-3 rounded-lg border border-red-200 bg-red-50">
                  <p className="text-sm font-medium text-red-600 text-center">{error}</p>
                </div>
              )}
              <Button
                onClick={handleLoginClick}
                disabled={isLoggingIn}
                variant="primary"
                size="lg"
                className="w-full justify-center"
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
          <CardFooter className="px-10 pb-8 pt-2 text-center">
            <p className="text-xs text-gray-400 font-medium">© 2025 MOZTECH 倉儲管理系統</p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
