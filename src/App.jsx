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
    // 【關鍵修改】移除所有 class，讓它變成一個最簡單的容器
    <>
      <Toaster richColors position="top-right" />
      {user ? (
        <Dashboard user={user} onLogout={handleLogout} />
      ) : (
        <LoginPage onLogin={handleLogin} />
      )}
    </>
  );
}