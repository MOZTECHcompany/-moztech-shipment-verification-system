// 檔案路徑: src/pages/LoginPage.jsx
// 這是全新的檔案，請直接貼上

import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

function LoginPage() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);
        try {
            const user = await login(username, password);
            if (user.role === 'admin') {
                navigate('/admin');
            } else {
                navigate('/');
            }
        } catch (err) {
            setError(err.response?.data?.message || '登入失敗，請檢查帳號密碼');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-100">
            <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-lg shadow-md">
                <h1 className="text-2xl font-bold text-center text-gray-800">MOZTECH WMS 登入</h1>
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label className="text-sm font-bold text-gray-600 block">帳號</label>
                        <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                            className="w-full p-2 mt-1 border rounded-md" required />
                    </div>
                    <div>
                        <label className="text-sm font-bold text-gray-600 block">密碼</label>
                        <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                            className="w-full p-2 mt-1 border rounded-md" required />
                    </div>
                    {error && <p className="text-red-500 text-sm">{error}</p>}
                    <div>
                        <button type="submit" disabled={isLoading}
                            className="w-full px-4 py-2 font-bold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-gray-400">
                            {isLoading ? '登入中...' : '登入'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default LoginPage;