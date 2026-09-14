import React, { Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ClipboardList, LayoutDashboard, LogOut, MessageSquare, PanelLeftClose, PanelLeftOpen, Settings, WifiOff } from 'lucide-react';
import ErrorBoundary from '../components/ErrorBoundary';

const roleLabels = { picker: '揀貨員', packer: '裝箱員', dispatcher: '出貨調度', admin: '管理員', superadmin: '系統管理員' };

export function AppLayout({ user, onLogout, children }) {
  const location = useLocation();
  const clampWidth = value => Math.min(360, Math.max(180, value));
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try { const value = Number(localStorage.getItem('wms_sidebar_width')); return Number.isFinite(value) && value > 0 ? clampWidth(value) : 208; } catch { return 208; }
  });
  const [resizing, setResizing] = useState(false);
  const drag = useRef(null);
  useEffect(() => {
    try { localStorage.setItem('wms_sidebar_width', String(sidebarWidth)); } catch { /* Resizing also works when persistence is unavailable. */ }
  }, [sidebarWidth]);
  const beginResize = event => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag.current = { x: event.clientX, width: sidebarWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizing(true);
  };
  const endResize = () => { drag.current = null; setResizing(false); };
  const resizeWithKeyboard = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    setSidebarWidth(width => event.key === 'Home' ? 180 : event.key === 'End' ? 360 : clampWidth(width + (event.key === 'ArrowRight' ? 16 : -16)));
  };
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('wms_sidebar_collapsed') === 'true'; } catch { return false; }
  });
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const online = () => setOffline(false);
    const offline = () => setOffline(true);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, []);
  const toggleSidebar = () => setCollapsed(previous => {
    const next = !previous;
    try { localStorage.setItem('wms_sidebar_collapsed', String(next)); } catch { /* The layout still works without browser storage. */ }
    return next;
  });
  const links = [
    { to: '/tasks', label: '工作台', icon: ClipboardList },
    { to: '/team', label: '公告板', icon: MessageSquare },
    ...(['admin', 'superadmin', 'dispatcher'].includes(user?.role) ? [{ to: '/admin', label: '出貨管理', icon: LayoutDashboard }] : []),
  ];
  const inSettings = ['/settings', '/admin/users', '/admin/operation-logs'].includes(location.pathname);
  const section = inSettings ? '設定' : location.pathname.startsWith('/order/') ? '出貨核對' : links.find(link => location.pathname.startsWith(link.to))?.label || '工作台';
  return (
    <div className={`wms-workspace corely-shell ${collapsed ? 'corely-shell--collapsed' : ''} ${resizing ? 'corely-shell--resizing' : ''}`} style={{ '--sidebar-width': `${sidebarWidth}px` }}>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:p-3">跳到主要內容</a>
      <aside className="corely-sidebar">
        <Link to="/tasks" className="corely-brand" aria-label="Corely AI 儲運管理系統，返回工作台">
          <img src="/branding/corely-app.png" alt="" width="36" height="36" />
          <span className="corely-sidebar-label"><strong>Corely AI</strong><span>儲運管理系統</span></span>
        </Link>
        <nav id="workspace-nav" aria-label="主要導覽" className="corely-nav">
          {links.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/admin' && inSettings} title={label} aria-label={label} className={({ isActive }) => `corely-nav-link ${(isActive && !inSettings) || (to === '/tasks' && location.pathname.startsWith('/order/')) ? 'corely-nav-link--active' : ''}`}><Icon size={19} aria-hidden="true" /><span className="corely-sidebar-label">{label}</span></NavLink>)}
        </nav>
        <div className="corely-sidebar-footer">
          <Link to="/settings" aria-label="設定" title="設定" aria-current={inSettings ? 'page' : undefined} className={`corely-settings-link ${inSettings ? 'corely-nav-link--active' : ''}`}><Settings size={20} aria-hidden="true" /><span className="corely-sidebar-label">設定</span></Link>
          <button type="button" onClick={toggleSidebar} aria-label={collapsed ? '展開側欄' : '收合側欄'} aria-expanded={!collapsed} aria-controls="workspace-nav" className="corely-sidebar-toggle" title={collapsed ? '展開側欄' : '收合側欄'}>{collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}</button>
        </div>
        {!collapsed && <div role="separator" aria-label="調整側邊欄寬度" aria-orientation="vertical" aria-valuemin={180} aria-valuemax={360} aria-valuenow={sidebarWidth} aria-valuetext={`${sidebarWidth} 像素`} tabIndex={0} className="corely-resize-handle" title="拖曳調整寬度，雙擊還原" onPointerDown={beginResize} onPointerMove={event => { if (drag.current) setSidebarWidth(clampWidth(drag.current.width + event.clientX - drag.current.x)); }} onPointerUp={endResize} onPointerCancel={endResize} onLostPointerCapture={endResize} onKeyDown={resizeWithKeyboard} onDoubleClick={() => setSidebarWidth(208)} />}
      </aside>
      <div className="corely-main-shell">
        <header className="corely-topbar">
          <span className="text-sm font-medium text-slate-600">{section}</span>
          {user && <div className="ml-auto flex min-w-0 items-center gap-3">
            <span className="hidden text-xs text-slate-500 sm:block">{roleLabels[user.role] || '作業人員'}</span>
            <span className="max-w-32 truncate text-sm font-medium" title={user.name || user.username}>{user.name || user.username}</span>
            <button type="button" onClick={onLogout} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-slate-500 hover:bg-slate-100" aria-label="登出"><LogOut size={16} aria-hidden="true" /><span className="hidden sm:inline">登出</span></button>
          </div>}
        </header>
        {offline && <div role="status" className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><WifiOff className="mt-0.5 shrink-0" size={17} /><span>網路已離線。請恢復連線並核對操作結果後，再繼續掃碼。</span></div>}
        <main id="main-content" tabIndex={-1} data-layout-content className="corely-main safe-bottom">
          <ErrorBoundary key={location.pathname}>
            <Suspense fallback={<div role="status" className="rounded-xl border border-slate-200 bg-white p-6">正在開啟作業畫面…</div>}>
              {children || <Outlet />}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export default AppLayout;
