// src/App.jsx
import React from 'react'; // 確保 React 被引入
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
    // 將背景色設定在這裡，確保整個應用都有統一的底色
    <div className="bg-gray-50 min-h-screen font-sans">
      <Toaster richColors position="top-right" />
      {user ? (
        <Dashboard user={user} onLogout={handleLogout} />
      ) : (
        <LoginPage onLogin={handleLogin} />
      )}
    </div>
  );
}