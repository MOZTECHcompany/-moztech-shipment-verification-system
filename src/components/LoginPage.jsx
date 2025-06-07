// src/components/LoginPage.jsx
import { useState } from 'react';

export function LoginPage({ onLogin }) {
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('');

  const handleLoginClick = () => {
    if (userId.trim() && role) {
      onLogin(userId, role);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="p-8 bg-white shadow-md rounded-lg w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-6 text-center">登入系統</h1>
        <div className="space-y-4">
          <input
            type="text"
            placeholder="請輸入員工編號"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">請選擇您的身份...</option>
            <option value="picker">揀貨人員</option>
            <option value="packer">裝箱人員</option>
          </select>
          <button
            onClick={handleLoginClick}
            disabled={!userId.trim() || !role}
            className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400"
          >
            登入
          </button>
        </div>
      </div>
    </div>
  );
}