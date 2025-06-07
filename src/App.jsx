// src/App.jsx
import React from 'react';
import { Toaster } from 'sonner';
import { Dashboard } from './components/Dashboard';
import { LoginPage } from './components/LoginPage';
import { useLocalStorage } from './hooks/useLocalStorage';
import './index.css';

export default function App() {
  const [user, setUser] = useLocalStorage("user", null);
  const handleLogin = (userId, role) => { if (userId && role) { setUser({ id: userId, role }); } };
  const handleLogout = () => { setUser(null); };

  return (
    // 【關鍵修改】直接將漸層背景的 class 寫在這裡
    <div className="min-h-screen font-sans bg-gradient-to-br from-indigo-100 via-purple-100 to-pink-100">
      <Toaster richColors position="top-right" />
      {user ? (
        <Dashboard user={user} onLogout={handleLogout} />
      ) : (
        <LoginPage onLogin={handleLogin} />
      )}
    </div>
  );
}