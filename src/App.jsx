// src/App.jsx
import React from 'react';
import { Toaster } from 'sonner';
import { Dashboard } from './components/Dashboard';
import { LoginPage } from './components/LoginPage';
import { useLocalStorage } from './hooks/useLocalStorage';
import './index.css';

export default function App() {
  const [user, setUser] = useLocalStorage("user", null);

  // 【修改】新的 handleLogin 函式，接收 name 和 role
  const handleLogin = (userId, role, name) => {
    if (userId && role && name) {
      setUser({ id: userId, role: role, name: name });
    }
  };

  const handleLogout = () => {
    setUser(null);
  };

  return (
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