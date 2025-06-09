import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link } from 'react-router-dom';
import { Toaster } from 'sonner';
import { LogOut, LayoutDashboard, HardHat } from 'lucide-react';

import { LoginPage } from './components/LoginPage';
import { AdminDashboard } from './components/AdminDashboard';
import { Dashboard as PickingDashboard } from './components/Dashboard';
import { useLocalStorage } from './hooks/useLocalStorage';
import './index.css';

// ✨✨✨ 修改後的 Navbar 元件 ✨✨✨
function AppNavbar({ user, onLogout }) {
  if (!user) return null;
  return (
    <nav className="bg-gray-800 text-white p-4 sticky top-0 z-50 shadow-md">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        {/* 左側 Logo 和標題 */}
        <div className="flex items-center gap-3">
            {/* 請確保你的新 Logo 圖片放在 public 資料夾下 */}
            <img src="/new-logo.png" alt="MOZTECH Logo" className="h-8 w-auto" /> {/* 調整 h-8 來改變高度 */}
            <span className="font-semibold text-xl tracking-wider">WMS</span>
        </div>
        
        {/* 中間導覽連結 */}
        <div className="flex items-center gap-2">
          <Link to="/" className="flex items-center gap-2 text-gray-300 hover:bg-gray-700 hover:text-white px-3 py-2 rounded-md text-sm font-medium"><LayoutDashboard size={16}/>數據總覽</Link>
          <Link to="/picking" className="flex items-center gap-2 text-gray-300 hover:bg-gray-700 hover:text-white px-3 py-2 rounded-md text-sm font-medium"><HardHat size={16}/>本地作業</Link>
        </div>

        {/* 右側使用者資訊和登出 */}
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


// 主 App 元件 (保持不變)
export default function App() {
  const [user, setUser] = useLocalStorage("user", null);

  const handleLogin = (userId, role, name) => {
    if (userId && role) setUser({ id: userId, role: role, name: name || userId });
  };
  const handleLogout = () => {
    setUser(null); 
    // 清理所有相關的 localStorage
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    localStorage.removeItem('shipment_data');
    localStorage.removeItem('scanned_items');
    localStorage.removeItem('confirmed_items');
    localStorage.removeItem('order_id');
    localStorage.removeItem('order_header');
    localStorage.removeItem('shipment_errors');
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