// src/App.jsx
import React from 'react';
import { Toaster } from 'sonner';
import { Dashboard } from './components/Dashboard';
import { LoginPage } from './components/LoginPage';
import { useLocalStorage } from './hooks/useLocalStorage';
import './index.css';

export default function App() {
  const [user, setUser] = useLocalStorage("user", null);

  // 新的 handleLogin 函式，接收 name 和 role
  const handleLogin = (userId, role, name) => {
    if (userId && role && name) {
      setUser({ id: userId, role: role, name: name });
    }
  };

  const handleLogout = () => {
    setUser(null);
  };

  return (
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