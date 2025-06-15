// 檔案路徑: src/contexts/AuthContext.jsx
// 這是全新的檔案，請直接貼上

import React, from 'react';
import apiClient from '../api/api';

const AuthContext = React.createContext(null);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = React.useState(() => {
        try {
            return JSON.parse(localStorage.getItem('user'));
        } catch {
            return null;
        }
    });
    const [token, setToken] = React.useState(() => localStorage.getItem('token'));
    const [isAuthLoading, setIsAuthLoading] = React.useState(true);

    React.useEffect(() => {
        const storedToken = localStorage.getItem('token');
        const storedUser = localStorage.getItem('user');
        if (storedToken && storedUser) {
            setToken(storedToken);
            setUser(JSON.parse(storedUser));
        }
        setIsAuthLoading(false);
    }, []);

    const login = React.useCallback(async (username, password) => {
        const response = await apiClient.post('/api/auth/login', { username, password });
        const { token, user } = response.data;
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        setToken(token);
        setUser(user);
        return user;
    }, []);

    const logout = React.useCallback(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setToken(null);
        setUser(null);
    }, []);

    const value = React.useMemo(() => ({
        user,
        token,
        isAuthLoading,
        login,
        logout,
    }), [user, token, isAuthLoading, login, logout]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = React.useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth 必須在 AuthProvider 內部使用');
    }
    return context;
};