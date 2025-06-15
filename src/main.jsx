// 檔案路徑: src/main.jsx

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';

import App from './App.jsx';
import LoginPage from './pages/LoginPage.jsx';
import VerificationPage from './pages/VerificationPage.jsx';
import AdminLayout from './components/AdminLayout.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import AdminReportsPage from './pages/AdminReportsPage.jsx';
import UserManagementPage from './pages/UserManagementPage.jsx';

import './index.css';

// 路由保護 HOC (高階元件)
const ProtectedRoute = ({ children, adminOnly = false }) => {
    const { user, isAuthLoading } = useAuth();

    if (isAuthLoading) {
        return <div>全域驗證載入中...</div>; // 或一個好看的 Loading Spinner
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    if (adminOnly && user.role !== 'admin') {
        // 如果需要管理員權限但使用者不是，導向到一般頁面
        return <Navigate to="/" replace />;
    }

    return children;
};


const AppRoutes = () => {
    return (
        <Routes>
            {/* 登入頁 */}
            <Route path="/login" element={<LoginPage />} />

            {/* 主要應用程式佈局 */}
            <Route path="/" element={<ProtectedRoute><App /></ProtectedRoute>}>
                <Route index element={<VerificationPage />} />
                {/* 如果未來有其他一般使用者頁面，可以加在這裡 */}
            </Route>
            
            {/* 管理後台路由群組 */}
            <Route path="/admin" element={<ProtectedRoute adminOnly={true}><AdminLayout /></ProtectedRoute>}>
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="reports" element={<AdminReportsPage />} />
                <Route path="users" element={<UserManagementPage />} />
            </Route>

            {/* 如果找不到任何頁面，導向到登入頁 */}
            <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
    );
};


ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);