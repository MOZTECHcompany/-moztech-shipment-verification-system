import React from 'react';
import { Outlet } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { Button } from './Button';

export function AppLayout({ user, onLogout, children }) {
  return (
    <div className="min-h-screen bg-mesh relative overflow-x-hidden">
      <div className="noise-overlay" aria-hidden="true"></div>
      <header className="fixed inset-x-0 top-3 sm:top-6 flex justify-center pointer-events-none z-50 safe-top px-3 sm:px-4">
        <div className="pointer-events-auto w-full max-w-7xl">
          <div className="glass-panel rounded-3xl sm:rounded-full px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-0 justify-between transition-all duration-300 hover:scale-[1.005] shadow-lg shadow-black/5 border border-white/20 backdrop-blur-xl bg-white/50">
            <div className="text-xs sm:text-sm font-bold text-gray-800 tracking-wide flex items-center gap-2">
              <div className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-sm"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-500 shadow-sm"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-sm"></span>
              </div>
              <span className="opacity-80 whitespace-nowrap">出貨／倉儲管理系統</span>
            </div>
            {user && (
              <div className="flex justify-end">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onLogout}
                  leadingIcon={LogOut}
                  className="bg-white/70 hover:bg-white/90 border-0 shadow-sm rounded-full px-4 w-full sm:w-auto"
                >
                  登出
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main
        data-layout-content
        className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 pt-28 sm:pt-32 pb-10 sm:pb-12 safe-bottom animate-scale-up"
      >
        {children ? children : <Outlet />}
      </main>
    </div>
  );
}

export default AppLayout;
