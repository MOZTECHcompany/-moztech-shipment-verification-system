// frontend/src/App.jsx

import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Toaster } from 'sonner';
import { socket } from './api/socket'; // 引入 socket 實例
import { LoginPage } from './components/LoginPage';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { UserManagement } from './components/admin/UserManagement';
import { TaskDashboard } from './pages/TaskDashboard'; // ✅ 修正路徑，假設 TaskDashboard 在 pages 資料夾
import { OrderWorkView } from './components/OrderWorkView';
import { useLocalStorage } from './hooks/useLocalStorage';
import { LogOut } from 'lucide-react';

// 登出按鈕和頁面佈局
function AppLayout({ user, onLogout }) {
    return (
        <div>
            {/* 為了簡化，您可以將登出按鈕直接放到需要的元件裡，例如 TaskDashboard */}
            <main>
                <Outlet context={{ user, onLogout }} /> {/* 將 user 和 onLogout 傳遞給子路由 */}
            </main>
        </div>
    );
}

// 受保護的路由，檢查使用者是否登入
function ProtectedRoute({ user, token }) {
    if (!user || !token) {
        return <Navigate to="/login" replace />;
    }
    return <Outlet />;
}

function App() {
    // ✅ 【關鍵修正 #1】: 將 localStorage 的 key 與 api.js 統一
    const [user, setUser] = useLocalStorage('user', null);
    const [token, setToken] = useLocalStorage('token', null);

    // ✅ 【關鍵修正 #2】: 移除手動設置 apiClient header 的 useEffect，完全信賴 api.js 的攔截器。
    //    只保留控制 socket 連接的邏輯。
    useEffect(() => {
        if (token) {
            // 如果有 token 且 socket 未連接，則手動連接
            if (!socket.connected) {
                socket.auth = { token }; // 可以將 token 用於 socket 連接認證
                socket.connect();
            }
        } else {
            // 如果沒有 token（例如登出時），則斷開連接
            socket.disconnect();
        }
    }, [token]);

    // 登入處理函式：接收登入數據，更新 state 和 localStorage
    const handleLogin = (data) => {
        setToken(data.accessToken);
        setUser(data.user);
    };

    // 登出處理函式：清空 state 和 localStorage
    const handleLogout = () => {
        setUser(null);
        setToken(null);
        // 清理 localStorage 是可選的，因為 useLocalStorage hook 在設為 null 時會自動移除
    };
    
    // 根據用戶角色決定首頁跳轉路徑
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
                    {/* 如果已登入，訪問 /login 會自動跳轉到任務頁 */}
                    <Route path="/login" element={token ? <Navigate to={getHomeRoute()} /> : <LoginPage onLogin={handleLogin} />} />
                    
                    {/* 所有需要登入才能訪問的頁面都放在這裡 */}
                    <Route element={<ProtectedRoute user={user} token={token} />}>
                        <Route element={<AppLayout user={user} onLogout={handleLogout} />}>
                            <Route path="/admin" element={user?.role === 'admin' ? <AdminDashboard /> : <Navigate to="/tasks" />} />
                            <Route path="/admin/users" element={user?.role === 'admin' ? <UserManagement /> : <Navigate to="/tasks" />} />
                            <Route path="/tasks" element={<TaskDashboard user={user} onLogout={handleLogout} />} />
                            <Route path="/order/:orderId" element={<OrderWorkView user={user} />} />
                        </Route>
                    </Route>

                    {/* 預設根路徑，根據登入狀態跳轉 */}
                    <Route path="/" element={<Navigate to={getHomeRoute()} replace />} />
                </Routes>
            </BrowserRouter>
        </>
    );
}

export default App;