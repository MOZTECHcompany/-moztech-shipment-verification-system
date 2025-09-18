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
    
    const getHomeRoute = () => {
        if (!user) return "/login";
        // 登入後預設都去 /tasks
        return "/tasks";
    };

    return (
        <>
            <Toaster richColors position="top-right" />
            <BrowserRouter>
                <Routes>
                    <Route path="/login" element={<LoginPage onLogin={handleLogin} />} />
                    
                    <Route element={<ProtectedRoute user={user} />}>
                        <Route element={<AppLayout user={user} onLogout={handleLogout} />}>
                            <Route path="/admin" element={user?.role === 'admin' ? <AdminDashboard /> : <Navigate to="/tasks" />} />
                            {/* 【关键修改】将 user prop 传递给 TaskDashboard */}
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