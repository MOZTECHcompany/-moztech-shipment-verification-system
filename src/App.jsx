// 檔案路徑: src/App.jsx
// 這是全新的 App.jsx，負責整體佈局和導航

import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { ScanLine, LayoutDashboard, LogOut } from 'lucide-react';

function App() {
    const { user, logout } = useAuth();
    const location = useLocation();

    // 判斷是否在管理後台頁面
    const isAdminRoute = location.pathname.startsWith('/admin');

    // 如果是管理後台，則使用 AdminLayout，不需要這裡的導航
    if (isAdminRoute) {
        return <Outlet />;
    }

    return (
        <div className="min-h-screen bg-gray-100">
            <nav className="bg-white shadow-md">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-16">
                        <div className="flex items-center">
                            <span className="font-bold text-xl text-gray-800">MOZTECH WMS</span>
                        </div>
                        <div className="flex items-center gap-4">
                            <NavLink to="/" className={({isActive}) => `flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium ${isActive ? 'text-blue-600 bg-blue-100' : 'text-gray-600 hover:bg-gray-100'}`}>
                                <ScanLine size={18} /> 作業頁面
                            </NavLink>
                            {user?.role === 'admin' && (
                                <NavLink to="/admin" className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-100">
                                    <LayoutDashboard size={18} /> 管理後台
                                </NavLink>
                            )}
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-gray-700">歡迎, {user?.name || '使用者'}</span>
                            <button onClick={logout} className="flex items-center gap-2 p-2 rounded-md text-sm font-medium text-red-600 hover:bg-red-100">
                                <LogOut size={18} />
                            </button>
                        </div>
                    </div>
                </div>
            </nav>
            <main>
                <Outlet /> {/* 主要內容區域，會根據路由顯示不同頁面 */}
            </main>
        </div>
    );
}

export default App;