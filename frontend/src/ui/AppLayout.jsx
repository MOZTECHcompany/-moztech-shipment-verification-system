import React from 'react';
import { Outlet } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { Button } from './Button';

export function AppLayout({ user, onLogout, children }) {
  return (
    <div className="min-h-screen bg-mesh relative overflow-x-hidden">
      <div className="noise-overlay"></div>
      <header className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-[1200px]">
        <div className="glass-pill px-6 py-3 flex items-center justify-between transition-all duration-300 hover:scale-[1.01]">
          <div className="text-sm font-bold text-gray-800 tracking-wide flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500 shadow-sm"></div>
            <div className="w-3 h-3 rounded-full bg-yellow-500 shadow-sm"></div>
            <div className="w-3 h-3 rounded-full bg-green-500 shadow-sm"></div>
            <span className="ml-2 opacity-80">出貨／倉儲管理系統</span>
          </div>
          {user && (
            <Button variant="secondary" size="sm" onClick={onLogout} leadingIcon={LogOut} className="bg-white/50 hover:bg-white/80 border-0 shadow-sm rounded-full px-4">
              登出
            </Button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-6 pt-28 pb-8 animate-scale-up">
        {children ? children : <Outlet />}
      </main>
    </div>
  );
}

export default AppLayout;
