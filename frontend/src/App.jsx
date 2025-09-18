// frontend/src/App.jsx

import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import apiClient from './api/api';

import { LoginPage } from './components/LoginPage';
import { AdminDashboard } from './components/AdminDashboard';
import { TaskDashboard } from './components/TaskDashboard'; // 新的任務列表
import { OrderWorkView } from './components/OrderWorkView'; // 我們舊的 Dashboard
import { useLocalStorage } from './hooks/useLocalStorage';
import { LogOut } from 'lucide-react';

// 頁面佈局組件，包含登出按鈕等
function AppLayout({ user, onLogout }) {
    return (
        <div>
            <header className="absolute top-4 right-4 z-10">
                 {user && <button onClick={onLogout} className="flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 shadow-lg"><LogOut className="mr-2 h-4 w-4" /> 登出</button>}
            </header>
            <main>
                <Outlet /> {/* 這裡是子路由頁面顯示的地方 */}
            </main>
        </div>
    );
}


// 保護路由，未登入則導向登入頁
function ProtectedRoute({ user }) {
    if (!user) {
        return <Navigate to="/login" replace />;
    }
    return <Outlet />;
}

function App() {
    const [user, setUser] = useLocalStorage('wms_user', null);
    const [token, setToken] = useLocalStorage('wms_token', null);

    useEffect(() => {
        if (token) {
            apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        } else {
            delete apiClient.defaults.headers.common['Authorization'];
        }
    }, [token]);

    const handleLogin = (data) => {
        setUser(data.user);
        setToken(data.accessToken);
    };

    const handleLogout = () => {
        setUser(null);
        setToken(null);
    };
    
    // 決定登入後要去哪個頁面
    const getHomeRoute = () => {
        if (!user) return "/login";
        if (user.role === 'admin') return "/admin";
        return "/tasks";
    };

    return (
        <>
            <Toaster richColors position="top-right" />
            <BrowserRouter>
                <Routes>
                    <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
                    
                    {/* 需要登入才能訪問的頁面 */}
                    <Route element={<ProtectedRoute user={user} />}>
                        <Route element={<AppLayout user={user} onLogout={handleLogout} />}>
                            <Route path="/admin" element={user?.role === 'admin' ? <AdminDashboard user={user} /> : <Navigate to="/tasks" />} />
                            <Route path="/tasks" element={<TaskDashboard user={user} />} />
                            <Route path="/order/:orderId" element={<OrderWorkView user={user} onLogout={handleLogout}/>} />
                        </Route>
                    </Route>

                    {/* 根路徑，根據登入狀態跳轉 */}
                    <Route path="/" element={<Navigate to={getHomeRoute()} replace />} />
                </Routes>
            </BrowserRouter>
        </>
    );
}

export default App;