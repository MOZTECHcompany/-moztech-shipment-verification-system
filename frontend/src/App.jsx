// frontend/src/App.jsx

import { lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Toaster, toast } from 'sonner';
import apiClient from './api/api';
import { socket, setSocketSession } from './api/socket';
import soundNotification from './utils/soundNotification';

import { ErpEntry } from './components/ErpEntry';
import { PortalLogin } from './components/PortalLogin';
const LogisticsSettings = lazy(() => import('./components/LogisticsSettings').then(module => ({ default: module.LogisticsSettings })));
const SettingsPage = lazy(() => import('./components/SettingsPage').then(module => ({ default: module.SettingsPage })));
const AdminDashboard = lazy(() => import('./components/admin/AdminDashboard').then(module => ({ default: module.AdminDashboard })));
const MarketplaceConverter = lazy(() => import('./components/admin/MarketplaceConverter').then(module => ({ default: module.MarketplaceConverter })));
const UserManagement = lazy(() => import('./components/admin/UserManagement').then(module => ({ default: module.UserManagement })));
const OperationLogs = lazy(() => import('./components/admin/OperationLogs').then(module => ({ default: module.OperationLogs })));
const Analytics = lazy(() => import('./components/admin/Analytics').then(module => ({ default: module.Analytics })));
const ScanErrors = lazy(() => import('./components/admin/ScanErrors').then(module => ({ default: module.ScanErrors })));
const DefectStats = lazy(() => import('./components/admin/DefectStats').then(module => ({ default: module.DefectStats })));
const Exceptions = lazy(() => import('./components/admin/Exceptions').then(module => ({ default: module.Exceptions })));
const TaskDashboard = lazy(() => import('./components/TaskDashboard').then(module => ({ default: module.TaskDashboard })));
const OrderWorkView = lazy(() => import('./components/OrderWorkView').then(module => ({ default: module.OrderWorkView })));
const WarehouseRelease = lazy(() => import('./components/WarehouseRelease'));
const ImportBatchView = lazy(() => import('./components/ImportBatchView').then(module => ({ default: module.ImportBatchView })));
const TeamBoard = lazy(() => import('./components/TeamBoard').then(module => ({ default: module.TeamBoard })));
const TeamPostView = lazy(() => import('./components/TeamPostView').then(module => ({ default: module.TeamPostView })));
import { loginEntryUrl } from './utils/entryDestination';
import { useLocalStorage } from './hooks/useLocalStorage';
import { AppLayout } from '@/ui';

// AppLayout 已抽成共用元件，提供一致背景/內距/置頂導覽

function ProtectedRoute({ user, token }) {
    const location = useLocation();
    if (!user || !token) {
        return <Navigate to={loginEntryUrl(location.pathname + location.search)} replace />;
    }
    return <Outlet />;
}

function TasksEntry({ user }) {
    const location = useLocation();
    return <TaskDashboard key={`${user?.id}:${user?.role}:${location.search}`} user={user} />;
}

function App() {
    const [user, setUser] = useLocalStorage('wms_user', null);
    const [token, setToken] = useLocalStorage('wms_token', null);

    useEffect(() => { soundNotification.setUser(user?.id); }, [user?.id]);

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
            if (user?.erpSubject && user?.erpOrigin) { window.location.assign(user.erpOrigin + '/warehouse'); return; }
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
        // Make the new identity available before child effects start loading tasks.
        localStorage.setItem('wms_token', JSON.stringify(data.accessToken));
        localStorage.setItem('wms_user', JSON.stringify(data.user));
        apiClient.defaults.headers.common['Authorization'] = `Bearer ${data.accessToken}`;
        soundNotification.setUser(data.user?.id);
        setToken(data.accessToken);
        setUser(data.user);
    };

    const handleLogout = async () => {
        if (user?.erpSubject) {
            try { await apiClient.post('/api/auth/erp/logout'); }
            catch { toast.error('無法完成登出，請稍後重試'); return; }
        }
        soundNotification.setUser(null);
        setSocketSession(null);
        setUser(null);
        setToken(null);
        if (user?.erpSubject && user?.erpOrigin) window.location.assign(user.erpOrigin + '/warehouse');
    };
    
    const canRead = permission => ['admin','superadmin'].includes(user?.role) || (user?.erpSubject && user.permissions?.includes(permission));
    const getHomeRoute = () => {
        if (!user || !token) return "/login";
        return "/tasks";
    };

    return (
        <>
            <Toaster richColors position="top-right" />
            <BrowserRouter>
                <Routes>
                    <Route path="/erp-entry" element={<ErpEntry onLogin={handleLogin} />} />
                    <Route path="/login" element={<PortalLogin onLogin={handleLogin} />} />
                    
                    <Route element={<ProtectedRoute user={user} token={token} />}>
                        <Route element={<AppLayout user={user} onLogout={handleLogout} />}>
                            <Route path="/settings/logistics" element={['admin','superadmin'].includes(user?.role) ? <LogisticsSettings /> : <Navigate to="/tasks" />} />
                            <Route path="/settings" element={<SettingsPage user={user} />} />
                            <Route path="/admin" element={(user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'dispatcher') ? <AdminDashboard user={user} /> : <Navigate to="/tasks" />} />
                            <Route path="/admin/marketplace-converter" element={['admin', 'superadmin', 'dispatcher'].includes(user?.role) ? <MarketplaceConverter key={`${user?.id}:${user?.role}:${token}`} user={user} /> : <Navigate to="/tasks" replace />} />
                            <Route path="/admin/users" element={(user?.role === 'admin' || user?.role === 'superadmin') ? <UserManagement currentUser={user} /> : <Navigate to="/tasks" />} />
                            <Route path="/admin/operation-logs" element={canRead('wms_logs:read') ? <OperationLogs /> : <Navigate to="/tasks" />} />
                            <Route path="/admin/analytics" element={canRead('wms_overview:read') ? <Analytics /> : <Navigate to="/tasks" />} />
                            <Route path="/admin/scan-errors" element={canRead('wms_scan_errors:read') ? <ScanErrors /> : <Navigate to="/tasks" />} />
                            <Route path="/admin/defects" element={canRead('wms_defects:read') ? <DefectStats /> : <Navigate to="/tasks" />} />
                            <Route path="/admin/exceptions" element={canRead('wms_exceptions:read') ? <Exceptions /> : <Navigate to="/tasks" />} />
                            <Route path="/tasks" element={<TasksEntry key={`${user?.id}:${user?.role}`} user={user} />} />
                            <Route path="/team" element={<TeamBoard user={user} />} />
                            <Route path="/team/:postId" element={<TeamPostView user={user} />} />
                            <Route path="/order/:orderId" element={<OrderWorkView user={user} />} />
                            <Route path="/warehouse-intakes" element={<WarehouseRelease user={user} token={token} />} />
                            <Route path="/warehouse-intakes/:intakeId" element={<WarehouseRelease user={user} token={token} />} />
                            <Route path="/batches/:batchId" element={<ImportBatchView key={`${user?.id}:${user?.role}:${token}`} user={user} />} />
                        </Route>
                    </Route>

                    <Route path="/" element={<Navigate to={getHomeRoute()} replace />} />
                </Routes>
            </BrowserRouter>
        </>
    );
}

export default App;
