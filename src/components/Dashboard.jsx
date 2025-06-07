import React from 'react';
import { LogOut } from 'lucide-react';

export function Dashboard({ user, onLogout }) {
  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <header className="flex justify-between items-center mb-6 pb-4 border-b">
        <h1 className="text-3xl font-bold text-gray-800">
          歡迎, {user.role === 'picker' ? '揀貨人員' : '裝箱人員'} {user.id}
        </h1>
        <button onClick={onLogout} className="flex items-center px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600">
          <LogOut className="mr-2 h-4 w-4" /> 登出
        </button>
      </header>
      <div className="p-10 border-dashed border-2 border-gray-300 rounded-lg mt-4 bg-white">
        <p className="text-center text-gray-500">掃描系統儀表板</p>
      </div>
    </div>
  );
}