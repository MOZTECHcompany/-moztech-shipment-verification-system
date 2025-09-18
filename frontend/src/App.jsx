// frontend/src/App.jsx
import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Toaster } from 'sonner';
import apiClient from './api/api';

import { LoginPage } from './components/LoginPage';
import { AdminDashboard } from './components/AdminDashboard';
import { TaskDashboard } from './components/TaskDashboard';
import { OrderWorkView } from './components/OrderWorkView';
import { useLocalStorage } from './hooks/useLocalStorage';
import { LogOut } from 'lucide-react';

function AppLayout({ user, onLogout }) {
    return (
        <div>
            <header className="absolute top-4 right-4 z-10">
                 {user && <button onClick={onLogout} className="flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 shadow-lg"><LogOut className="mr-2 h-4 w-4" /> 登出</button>}
            </header>
            <main>
                <Outlet />
            </main>
        </div>
    );
}

// 【关键修改】让 ProtectedRoute 依赖 token 和 user
function ProtectedRoute({ user, token }) {
    if (!user || !token) {
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
            // 确保在 token 不存在时清除 header
            delete apiClient.defaults.headers.common['Authorization'];
        }
    }, [token]);

    const handleLogin = (data) => {
        // 先设置 token，再设置 user，保证 useEffect 的顺序
        setToken(data.accessToken);
        setUser(data.user);
    };

    const handleLogout = () => {
        // 先清除 user，再清除 token
        setUser(null);
        setToken(null);
    };
    
    const getHomeRoute = () => {
        if (!user || !token) return "/login";
        return "/tasks";
    };

    return (
        <>
            <Toaster richColors position="top-right" />
            <BrowserRouter>
                <Routes>
                    <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
                    
                    {/* 【关键修改】将 token 传入 ProtectedRoute */}
                    <Route element={<ProtectedRoute user={user} token={token} />}>
                        <Route element={<AppLayout user={user} onLogout={handleLogout} />}>
                            {/* 管理员专属路由，如果不是 admin 则重定向到 /tasks */}
                            <Route 
                                path="/admin" 
                                element={user?.role === 'admin' ? <AdminDashboard /> : <Navigate to="/tasks" />} 
                            />
                            <Route path="/tasks" element={<TaskDashboard user={user} />} />
                            <Route path="/order/:orderId" element={<OrderWorkView user={user} />} />
                        </Route>
                    </Route>

                    {/* 根路径，根据登录状态决定跳转方向 */}
                    <Route path="/" element={<Navigate to={getHomeRoute()} replace />} />
                </Routes>
            </BrowserRouter>
        </>
    );
}

export default App;