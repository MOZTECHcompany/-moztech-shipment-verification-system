import React from 'react';
import { Outlet } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { Button } from './Button';

export function AppLayout({ user, onLogout, children }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 glass border-b-0">
        <div className="mx-auto max-w-[1440px] px-6 py-4 flex items-center justify-between">
          <div className="text-sm font-medium text-gray-500 tracking-wide">出貨／倉儲管理系統</div>
          {user && (
            <Button variant="secondary" size="sm" onClick={onLogout} leadingIcon={LogOut} className="bg-white/50 hover:bg-white/80 border-0 shadow-sm">
              登出
            </Button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-6 py-8 animate-in fade-in duration-500">
        {children ? children : <Outlet />}
      </main>
    </div>
  );
}

export default AppLayout;
