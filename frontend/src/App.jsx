// frontend/src/App.jsx

import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Toaster } from 'sonner';
import { socket } from './api/socket'; 
import { LoginPage } from './components/LoginPage';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { UserManagement } from './components/admin/UserManagement';
// ✅ 【最终修正】: 将导入路径从 './pages/TaskDashboard' 改为正确的 './components/TaskDashboard'
import { TaskDashboard } from './components/TaskDashboard'; 
import { OrderWorkView } from './components/OrderWorkView';
import { useLocalStorage } from './hooks/useLocalStorage';
import { LogOut } from 'lucide-react';

function AppLayout({ user, onLogout }) {
    return (
        <div>
            <main>
                <Outlet context={{ user, onLogout }} /> 
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
    const [user, setUser] = useLocalStorage('user', null);
    const [token, setToken] = useLocalStorage('token', null);

    useEffect(() => {
        if (token) {
            if (!socket.connected) {
                socket.auth = { token };
                socket.connect();
            }
        } else {
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
                    <Route path="/login" element={token ? <Navigate to={getHomeRoute()} /> : <LoginPage onLogin={handleLogin} />} />
                    
                    <Route element={<ProtectedRoute user={user} token={token} />}>
                        <Route element={<AppLayout user={user} onLogout={handleLogout} />}>
                            <Route path="/admin" element={user?.role === 'admin' ? <AdminDashboard /> : <Navigate to="/tasks" />} />
                            <Route path="/admin/users" element={user?.role === 'admin' ? <UserManagement /> : <Navigate to="/tasks" />} />
                            <Route path="/tasks" element={<TaskDashboard user={user} onLogout={handleLogout} />} />
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