// frontend/src/App.jsx

import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Toaster } from 'sonner';
import apiClient from './api/api';
import { socket } from './api/socket'; // 引入我们创建的 socket 实例

import { LoginPage } from './components/LoginPage';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { UserManagement } from './components/admin/UserManagement';
import { OperationLogs } from './components/admin/OperationLogs';
import { Analytics } from './components/admin/Analytics';
import { ScanErrors } from './components/admin/ScanErrors';
import { TaskDashboard } from './components/TaskDashboard';
import { OrderWorkView } from './components/OrderWorkView';
import { useLocalStorage } from './hooks/useLocalStorage';
import { LogOut } from 'lucide-react';

function AppLayout({ user, onLogout, onToggleTheme, theme }) {
    return (
        <div className="app-shell">
            <header className="absolute top-4 right-4 z-20 flex items-center gap-3 pr-4">
                 {user && (
                    <>
                        <button
                            type="button"
                            onClick={onToggleTheme}
                            className="flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-white/80 backdrop-blur border border-gray-200 shadow-sm hover:bg-gray-50"
                        >
                            <span className="mr-1">{theme === 'dark' ? '🌙 暗色' : '☀️ 亮色'}</span>
                            <span className="text-gray-500">切換</span>
                        </button>
                        <button
                            onClick={onLogout}
                            className="flex items-center px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 shadow-lg"
                        >
                            <LogOut className="mr-2 h-4 w-4" /> 登出
                        </button>
                    </>
                 )}
            </header>
            <main className="app-shell-main">
                <Outlet />
            </main>
        </div>
    );
}

function ProtectedRoute({ user, token }) {
    if (!user || !token) {
        return <Navigate to="/login" replace />;
    }
    return <Outlet />;
}

function App() {
    const [user, setUser] = useLocalStorage('wms_user', null);
    const [token, setToken] = useLocalStorage('wms_token', null);
    const [theme, setTheme] = useLocalStorage('wms_theme', 'light'); // 'light' | 'dark'

    // 【关键修改】在 token 变化时控制 apiClient 和 socket 连接
    useEffect(() => {
        if (token) {
            apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;
            // 如果有 token 且 socket 未连接，则手动连接
            if (!socket.connected) {
                socket.connect();
            }
        } else {
            delete apiClient.defaults.headers.common['Authorization'];
            // 如果没有 token（例如登出时），则断开连接
            socket.disconnect();
        }
    }, [token]);

    const handleLogin = (data) => {
        setToken(data.accessToken);
        setUser(data.user);
    };

    const handleLogout = () => {
        setUser(null);
        setToken(null);
    };

    // 主題切換：在 body 上切換 .theme-dark 類別
    useEffect(() => {
        if (typeof document === 'undefined') return;
        const body = document.body;
        if (theme === 'dark') {
            body.classList.add('theme-dark');
        } else {
            body.classList.remove('theme-dark');
        }
    }, [theme]);
    
    const getHomeRoute = () => {
        if (!user || !token) return "/login";
        if (user.role === 'admin') return "/admin";
        return "/tasks";
    };

    const toggleTheme = () => {
        setTheme(prev => prev === 'dark' ? 'light' : 'dark');
    };

    return (
        <>
            <Toaster richColors position="top-right" />
            <BrowserRouter>
                <Routes>
                    <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
                    
                    <Route element={<ProtectedRoute user={user} token={token} />}>
                        <Route element={<AppLayout user={user} onLogout={handleLogout} onToggleTheme={toggleTheme} theme={theme} />}>
                            <Route path="/admin" element={user?.role === 'admin' ? <AdminDashboard /> : <Navigate to="/tasks" />} />
                            <Route path="/admin/users" element={user?.role === 'admin' ? <UserManagement /> : <Navigate to="/tasks" />} />
                            <Route path="/admin/operation-logs" element={user?.role === 'admin' ? <OperationLogs /> : <Navigate to="/tasks" />} />
                            <Route path="/admin/analytics" element={user?.role === 'admin' ? <Analytics /> : <Navigate to="/tasks" />} />
                            <Route path="/admin/scan-errors" element={user?.role === 'admin' ? <ScanErrors /> : <Navigate to="/tasks" />} />
                            <Route path="/tasks" element={<TaskDashboard user={user} />} />
                            <Route path="/order/:orderId" element={<OrderWorkView user={user} />} />
                        </Route>
                    </Route>

                    <Route path="/" element={<Navigate to={getHomeRoute()} replace />} />
                </Routes>
            </BrowserRouter>
        </>
    );
}

export default App;