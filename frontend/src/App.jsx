// frontend/src/App.jsx
import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Toaster } from 'sonner';
import apiClient from './api/api';

import { LoginPage } from './components/LoginPage';
// 【修正】从正确的 admin 文件夹中引入
import { AdminDashboard } from './components/admin/AdminDashboard';
import { UserManagement } from './components/admin/UserManagement';
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
            delete apiClient.defaults.headers.common['Authorization'];
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
    
    const getHomeRoute = () => {
        if (!user || !token) return "/login";
        if (user.role === 'admin') return "/admin";
        return "/tasks";
    };

    return (
        <>
            <Toaster richColors position="top-right" />
            <BrowserRouter>
                <Routes>
                    <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
                    
                    <Route element={<ProtectedRoute user={user} token={token} />}>
                        <Route element={<AppLayout user={user} onLogout={handleLogout} />}>
                            <Route path="/admin" element={user?.role === 'admin' ? <AdminDashboard /> : <Navigate to="/tasks" />} />
                            <Route path="/admin/users" element={user?.role === 'admin' ? <UserManagement /> : <Navigate to="/tasks" />} />
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