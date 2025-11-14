import React from 'react';
import { Outlet } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { Button } from './Button';

export function AppLayout({ user, onLogout, children }) {
  return (
    <div className="min-h-screen bg-secondary">
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-white/70 border-b border-gray-200">
        <div className="mx-auto max-w-[1440px] px-6 py-3 flex items-center justify-between">
          <div className="text-sm text-gray-500">出貨／倉儲管理系統</div>
          {user && (
            <Button variant="secondary" size="sm" onClick={onLogout} leadingIcon={LogOut}>
              登出
            </Button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-6 py-6">
        {children ? children : <Outlet />}
      </main>
    </div>
  );
}

export default AppLayout;
