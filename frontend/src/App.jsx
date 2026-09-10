// frontend/src/App.jsx

import { lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Toaster, toast } from 'sonner';
import apiClient from './api/api';
import { socket, setSocketSession } from './api/socket';

import { LoginPage } from './components/LoginPage';
const SettingsPage = lazy(() => import('./components/SettingsPage').then(module => ({ default: module.SettingsPage })));
const AdminDashboard = lazy(() => import('./components/admin/AdminDashboard').then(module => ({ default: module.AdminDashboard })));
const UserManagement = lazy(() => import('./components/admin/UserManagement').then(module => ({ default: module.UserManagement })));
const OperationLogs = lazy(() => import('./components/admin/OperationLogs').then(module => ({ default: module.OperationLogs })));
const Analytics = lazy(() => import('./components/admin/Analytics').then(module => ({ default: module.Analytics })));
const ScanErrors = lazy(() => import('./components/admin/ScanErrors').then(module => ({ default: module.ScanErrors })));
const DefectStats = lazy(() => import('./components/admin/DefectStats').then(module => ({ default: module.DefectStats })));
const Exceptions = lazy(() => import('./components/admin/Exceptions').then(module => ({ default: module.Exceptions })));
const TaskDashboard = lazy(() => import('./components/TaskDashboard').then(module => ({ default: module.TaskDashboard })));
const OrderWorkView = lazy(() => import('./components/OrderWorkView').then(module => ({ default: module.OrderWorkView })));
const TeamBoard = lazy(() => import('./components/TeamBoard').then(module => ({ default: module.TeamBoard })));
const TeamPostView = lazy(() => import('./components/TeamPostView').then(module => ({ default: module.TeamPostView })));
import { useLocalStorage } from './hooks/useLocalStorage';
import { AppLayout } from '@/ui';

// AppLayout 已抽成共用元件，提供一致背景/內距/置頂導覽

function ProtectedRoute({ user, token }) {
    if (!user || !token) {
        return <Navigate to="/login" replace />;
    }
    return <Outlet />;
}

function App() {
    const [user, setUser] = useLocalStorage('wms_user', null);
    const [token, setToken] = useLocalStorage('wms_token', null);

    // Update the transport credentials on login, refresh, account switch and logout.
    useEffect(() => {
        if (token) {
            apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        } else {
            delete apiClient.defaults.headers.common['Authorization'];
        }
        setSocketSession(token);
        return () => setSocketSession(null);
    }, [token]);

    useEffect(() => {
        const requireLogin = (reason = {}) => {
            setSocketSession(null);
            setUser(null);
            setToken(null);
            toast.error(reason.code === 'SOCKET_AUTH_UNAVAILABLE' ? '即時連線驗證暫時無法完成，請稍後重新登入' : '登入已失效，請重新登入');
        };
        const onConnectError = error => {
            if (error.data?.code === 'SOCKET_AUTH_REQUIRED') requireLogin();
        };
        socket.on('session_expired', requireLogin);
        socket.on('connect_error', onConnectError);
        return () => {
            socket.off('session_expired', requireLogin);
            socket.off('connect_error', onConnectError);
        };
    }, [setToken, setUser]);

    const handleLogin = (data) => {
        setToken(data.accessToken);
        setUser(data.user);
    };

    const handleLogout = () => {
        setSocketSession(null);
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
                    
                    <Route element={<ProtectedRoute user={user} token={token} />}>
                        <Route element={<AppLayout user={user} onLogout={handleLogout} />}>
                            <Route path="/settings" element={<SettingsPage user={user} />} />
                            <Route path="/admin" element={(user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'dispatcher') ? <AdminDashboard user={user} /> : <Navigate to="/tasks" />} />
                            <Route path="/admin/users" element={(user?.role === 'admin' || user?.role === 'superadmin') ? <UserManagement currentUser={user} /> : <Navigate to="/tasks" />} />
                            <Route path="/admin/operation-logs" element={(user?.role === 'admin' || user?.role === 'superadmin') ? <OperationLogs /> : <Navigate to="/tasks" />} />
                            <Route path="/admin/analytics" element={(user?.role === 'admin' || user?.role === 'superadmin') ? <Analytics /> : <Navigate to="/tasks" />} />
                            <Route path="/admin/scan-errors" element={(user?.role === 'admin' || user?.role === 'superadmin') ? <ScanErrors /> : <Navigate to="/tasks" />} />
                            <Route path="/admin/defects" element={(user?.role === 'admin' || user?.role === 'superadmin') ? <DefectStats /> : <Navigate to="/tasks" />} />
                            <Route path="/admin/exceptions" element={(user?.role === 'admin' || user?.role === 'superadmin') ? <Exceptions /> : <Navigate to="/tasks" />} />
                            <Route path="/tasks" element={<TaskDashboard user={user} />} />
                            <Route path="/team" element={<TeamBoard user={user} />} />
                            <Route path="/team/:postId" element={<TeamPostView user={user} />} />
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
