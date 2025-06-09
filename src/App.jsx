import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link } from 'react-router-dom';
import { Toaster } from 'sonner';
import { LogOut, LayoutDashboard, HardHat } from 'lucide-react';

import { LoginPage } from './components/LoginPage';
import { AdminDashboard } from './components/AdminDashboard';
import { Dashboard as PickingDashboard } from './components/Dashboard';
import { useLocalStorage } from './hooks/useLocalStorage';
import './index.css';

function AppNavbar({ user, onLogout }) {
  if (!user) return null;
  return (
    <nav className="bg-gray-800 text-white p-4 sticky top-0 z-50 shadow-md">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <div className="flex items-center gap-8">
          <span className="font-bold text-lg">MOZTECH WMS</span>
          <Link to="/" className="flex items-center gap-2 text-gray-300 hover:bg-gray-700 hover:text-white px-3 py-2 rounded-md text-sm font-medium"><LayoutDashboard size={16}/>數據總覽</Link>
          <Link to="/picking" className="flex items-center gap-2 text-gray-300 hover:bg-gray-700 hover:text-white px-3 py-2 rounded-md text-sm font-medium"><HardHat size={16}/>本地作業</Link>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-gray-300 text-sm">歡迎, {user.name}</span>
          <button onClick={onLogout} className="bg-red-500 hover:bg-red-600 text-white px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2">
            <LogOut size={16} /><span>登出</span>
          </button>
        </div>
      </div>
    </nav>
  );
}

export default function App() {
  const [user, setUser] = useLocalStorage("user", null);

  const handleLogin = (userId, role, name) => {
    if (userId && role && name) setUser({ id: userId, role: role, name: name });
  };
  const handleLogout = () => {
    setUser(null); 
    localStorage.clear();
  };

  return (
    <Router>
      <div className="min-h-screen font-sans bg-gray-50">
        <Toaster richColors position="top-right" />
        <AppNavbar user={user} onLogout={handleLogout} />
        <Routes>
          <Route path="/login" element={!user ? <LoginPage onLogin={handleLogin} /> : <Navigate to="/" />} />
          <Route path="/" element={user ? <AdminDashboard user={user} /> : <Navigate to="/login" />} />
          <Route path="/picking" element={user ? <PickingDashboard user={user} onLogout={handleLogout} /> : <Navigate to="/login" />} />
          <Route path="*" element={<Navigate to={user ? "/" : "/login"} />} />
        </Routes>
      </div>
    </Router>
  );
}