import React from 'react';
import { Toaster } from 'sonner';
import { Dashboard } from './components/Dashboard';
import { LoginPage } from './components/LoginPage';
import { useLocalStorage } from './hooks/useLocalStorage';
import './index.css';

export default function App() {
  const [user, setUser] = useLocalStorage("user", null);

  const handleLogin = (userId, role) => {
    if (userId && role) {
      setUser({ id: userId, role });
    }
  };

  const handleLogout = () => { // <--- 這裡已經被修正
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