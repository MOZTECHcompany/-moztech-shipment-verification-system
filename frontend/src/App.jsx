// frontend/src/App.jsx

import { isWarehouseAdmin } from './utils/managementScope';
import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, MemoryRouter, Routes, Route, Navigate, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
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
const CartonsPage = lazy(() => import('./components/CartonsPage').then(module => ({ default: module.CartonsPage })));
const OrderWorkView = lazy(() => import('./components/OrderWorkView').then(module => ({ default: module.OrderWorkView })));
const WarehouseRelease = lazy(() => import('./components/WarehouseRelease'));
const ImportBatchView = lazy(() => import('./components/ImportBatchView').then(module => ({ default: module.ImportBatchView })));
const TeamBoard = lazy(() => import('./components/TeamBoard').then(module => ({ default: module.TeamBoard })));
const TeamPostView = lazy(() => import('./components/TeamPostView').then(module => ({ default: module.TeamPostView })));
import { loginEntryUrl } from './utils/entryDestination';
import { useWarehouseSession } from './hooks/useWarehouseSession';
import { AppLayout } from '@/ui';
import OrderReviewAlerts from './components/OrderReviewAlerts';
import ErrorBoundary from './components/ErrorBoundary';
import { EnvironmentBanner } from './components/EnvironmentBanner';

// AppLayout 已抽成共用元件，提供一致背景/內距/置頂導覽

function ProtectedRoute({ user, token, host }) {
    const location = useLocation();
    if (!user || !token) {
        return host ? <p role="alert">作業身分已失效，請從營運系統重新選擇工作身分。</p> : <Navigate to={loginEntryUrl(location.pathname + location.search)} replace />;
    }
    return <Outlet />;
}

function WorkspaceNavigation({ host }) {
    const location = useLocation();
    const navigate = useNavigate();
    const navigationType = useNavigationType();
    const path = location.pathname + location.search + location.hash;
    useEffect(() => host.registerNavigate(navigate), [host, navigate]);
    useEffect(() => { host.onNavigate?.(path, { replace: navigationType !== 'PUSH' }); }, [host, path, navigationType]);
    return null;
}

function NativeLayout({ user }) {
    const location = useLocation();
    const [offline, setOffline] = useState(() => navigator.onLine === false);
    useEffect(() => {
        const online = () => setOffline(false), offline = () => setOffline(true);
        window.addEventListener('online', online); window.addEventListener('offline', offline);
        return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
    }, []);
    return <div className="wms-workspace wms-native-workspace">
        <EnvironmentBanner />
        <OrderReviewAlerts key={user?.id} user={user} />
        {offline && <p role="status" className="mb-4 rounded-lg bg-amber-50 p-3 text-amber-900">網路已離線。請恢復連線並核對操作結果後，再繼續掃碼。</p>}
        <ErrorBoundary key={location.pathname}><Suspense fallback={<p role="status">正在開啟作業畫面…</p>}><Outlet /></Suspense></ErrorBoundary>
    </div>;
}

function TasksEntry({ user, token }) {
    const location = useLocation();
    return <TaskDashboard key={`${user?.id}:${user?.role}:${location.search}`} user={user} token={token} />;
}

function App({ host } = {}) {
    // A handoff tab may contain a superseded station token from another tab.
    // Do not start its socket while the new ERP ticket is being exchanged.
    const [handoffPending, setHandoffPending] = useState(() => !host && window.location.pathname === '/erp-entry');
    const [user, setUser] = useWarehouseSession('wms_user', null);
    const [token, setToken] = useWarehouseSession('wms_token', null);

    useEffect(() => { soundNotification.setUser(user?.id); }, [user?.id]);
    useEffect(() => {
        if (!token) return;
        let alive=true;
        apiClient.get('/api/auth/me',{headers:{Authorization:`Bearer ${token}`}}).then(({data})=>{if(alive)setUser(data.user);}).catch(error=>{
            if (alive && host && [401,403].includes(error.response?.status)) host.onAuthRequired?.(error.response?.data || {});
        });
        return()=>{alive=false;};
    },[token,setUser]);


    // Update the transport credentials on login, refresh, account switch and logout.
    useEffect(() => {
        if (handoffPending) { setSocketSession(null); return; }
        if (token) {
            apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        } else {
            delete apiClient.defaults.headers.common['Authorization'];
        }
        setSocketSession(token);
        return () => setSocketSession(null);
    }, [token, handoffPending]);

    useEffect(() => {
        const requireLogin = (reason = {}) => {
            if (handoffPending) return;
            setSocketSession(null);
            setUser(null);
            setToken(null);
            if (host) { host.onAuthRequired?.(reason); return; }
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
    }, [setToken, setUser, handoffPending, user?.erpOrigin, user?.erpSubject, host]);

    const handleLogin = (data) => {
        // Make the new identity available before child effects start loading tasks.
        sessionStorage.setItem('wms_token', JSON.stringify(data.accessToken));
        sessionStorage.setItem('wms_user', JSON.stringify(data.user));
        apiClient.defaults.headers.common['Authorization'] = `Bearer ${data.accessToken}`;
        soundNotification.setUser(data.user?.id);
        setToken(data.accessToken);
        setUser(data.user);
        setHandoffPending(false);
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
        if (host) host.onAuthRequired?.({ code: 'WORKSPACE_CLOSED' });
        else if (user?.erpSubject && user?.erpOrigin) window.location.assign(user.erpOrigin + '/warehouse');
    };
    
    const canRead = permission => ['admin','superadmin'].includes(user?.role) || (user?.erpSubject && user.permissions?.includes(permission));
    const getHomeRoute = () => {
        if (!user || !token) return host ? "/tasks" : "/login";
        return "/tasks";
    };

    const Router = host ? MemoryRouter : BrowserRouter;
    return (
        <>
            <Toaster richColors position="top-right" />
            <Router {...(host ? { initialEntries: [host.initialPath || '/tasks'] } : {})}>
                {host && <WorkspaceNavigation host={host} />}
                <Routes>
                    {!host && <Route path="/erp-entry" element={<ErpEntry onLogin={handleLogin} />} />}
                    {!host && <Route path="/login" element={<PortalLogin onLogin={handleLogin} />} />}
                    
                    <Route element={<ProtectedRoute user={user} token={token} host={host} />}>
                        <Route element={host ? <NativeLayout user={user} /> : <AppLayout user={user} onLogout={handleLogout} />}>
                            <Route path="/settings/logistics" element={['admin','superadmin'].includes(user?.role) ? <LogisticsSettings /> : <Navigate to="/tasks" />} />
                            <Route path="/settings" element={<SettingsPage user={user} />} />
                            <Route path="/admin" element={(user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'dispatcher') ? <AdminDashboard user={user} /> : <Navigate to="/tasks" />} />
                            <Route path="/admin/marketplace-converter" element={['admin', 'superadmin', 'dispatcher'].includes(user?.role) ? <MarketplaceConverter key={`${user?.id}:${user?.role}:${token}`} user={user} /> : <Navigate to="/tasks" replace />} />
                            <Route path="/admin/users" element={isWarehouseAdmin(user) ? <UserManagement currentUser={user} /> : <Navigate to="/tasks" />} />
                            <Route path="/admin/operation-logs" element={canRead('wms_logs:read') ? <OperationLogs /> : <Navigate to="/tasks" />} />
                            <Route path="/admin/analytics" element={canRead('wms_overview:read') ? <Analytics /> : <Navigate to="/tasks" />} />
                            <Route path="/admin/scan-errors" element={canRead('wms_scan_errors:read') ? <ScanErrors /> : <Navigate to="/tasks" />} />
                            <Route path="/admin/defects" element={canRead('wms_defects:read') ? <DefectStats /> : <Navigate to="/tasks" />} />
                            <Route path="/admin/exceptions" element={canRead('wms_exceptions:read') ? <Exceptions user={user} /> : <Navigate to="/tasks" />} />
                            <Route path="/tasks" element={<TasksEntry key={`${user?.id}:${user?.role}`} user={user} token={token} />} />
                            <Route path="/team" element={<TeamBoard user={user} />} />
                            <Route path="/team/:postId" element={<TeamPostView user={user} />} />
                            <Route path="/cartons" element={['admin', 'superadmin', 'dispatcher', 'picker', 'packer'].includes(user?.role) ? <CartonsPage key={`${user?.id}:${user?.role}`} user={user} /> : <Navigate to="/tasks" />} />
                            <Route path="/order/:orderId" element={<OrderWorkView user={user} />} />
                            <Route path="/warehouse-intakes" element={<WarehouseRelease user={user} token={token} />} />
                            <Route path="/warehouse-intakes/:intakeId" element={<WarehouseRelease user={user} token={token} />} />
                            <Route path="/batches/:batchId" element={<ImportBatchView key={`${user?.id}:${user?.role}:${token}`} user={user} />} />
                        </Route>
                    </Route>

                    <Route path="/" element={<Navigate to={getHomeRoute()} replace />} />
                </Routes>
            </Router>
        </>
    );
}

export default App;
