import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { socket } from '@/api/socket.js';
import { isWarehouseAdmin } from '@/utils/managementScope';
import { batchSessionMatches } from '../utils/importBatches';

export default function MarketplaceBatchAlerts({ user, token }) {
  const [notices, setNotices] = useState([]), [failed, setFailed] = useState(false);
  const current = useRef(null), acknowledgements = useRef(new Set());
  useEffect(() => {
    setNotices([]); setFailed(false); current.current = null;
    if (!isWarehouseAdmin(user)) return;
    let active = true, fetching = false, queued = false, denied = false;
    let credential;
    try { credential = JSON.parse(sessionStorage.getItem('wms_token')); } catch { return; }
    if (token && token !== credential) return;
    const sameSession = () => {
      try { return batchSessionMatches(sessionStorage, user, credential) && isWarehouseAdmin(JSON.parse(sessionStorage.getItem('wms_user'))); }
      catch { return false; }
    };
    const clear = () => { if (active) { setNotices([]); setFailed(false); } };
    const refresh = async () => {
      if (!active || denied) return;
      if (!sameSession()) { clear(); return; }
      if (navigator.onLine === false) return;
      if (fetching) { queued = true; return; }
      fetching = true;
      try {
        const response = await apiClient.get('/api/marketplace-batch-notices', { timeout: 15000 });
        if (!active) return;
        if (!sameSession()) { clear(); return; }
        const rows = (response.data.notices || []).map(notice => ({ ...notice, id: notice.noticeId })).filter(notice => /^[1-9]\d*$/.test(String(notice.id)) && /^[1-9]\d*$/.test(String(notice.intakeId)));
        setNotices(rows); setFailed(false);
      } catch (error) {
        if (!active) return;
        if (!sameSession() || [401, 403].includes(error.response?.status)) { denied = true; clear(); }
        else setFailed(true);
      } finally {
        fetching = false;
        if (queued && active && !denied) { queued = false; void refresh(); }
      }
    };
    current.current = { sameSession, clear, active: () => active };
    acknowledgements.current = new Set();
    const changed = () => { if (!sameSession()) clear(); };
    void refresh();
    const interval = setInterval(refresh, 30000);
    window.addEventListener('online', refresh); window.addEventListener('storage', changed);
    socket.on('marketplace_batch_notice', refresh);
    return () => {
      active = false; current.current = null; clearInterval(interval);
      window.removeEventListener('online', refresh); window.removeEventListener('storage', changed);
      socket.off('marketplace_batch_notice', refresh);
    };
  }, [user?.id, user?.role, user?.management_scope, token]);
  const open = (event, notice) => {
    const context = current.current;
    if (!context?.sameSession()) { event.preventDefault(); context?.clear(); return; }
    const pending = acknowledgements.current;
    if (pending.has(notice.id)) return;
    pending.add(notice.id);
    void apiClient.post(`/api/marketplace-batch-notices/${notice.id}/seen`).then(() => {
      if (context.active() && context.sameSession()) setNotices(rows => rows.filter(row => row.id !== notice.id));
    }).catch(() => {
      if (context.sameSession()) toast.error('已開啟批次；通知尚未標記已讀。');
    }).finally(() => pending.delete(notice.id));
  };
  if (!isWarehouseAdmin(user) || (!notices.length && !failed)) return null;
  return <section aria-label="商城批次待辦" className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">待處理批次</h2><Link to="/warehouse-intakes" className="inline-flex min-h-11 items-center text-sm font-medium text-blue-700">查看待辦</Link></div>
    {failed && <p role="status" className="text-sm text-amber-800">批次待辦暫時無法更新。</p>}
    {!!notices.length && <ul className="divide-y divide-slate-100">{notices.slice(0, 5).map(notice => <li key={notice.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0"><p className="break-all font-medium">{notice.batchNumber}</p><p className="mt-1 text-sm text-slate-600">{notice.platform} · {notice.store} · {notice.stage === 'ready_for_print' ? '可列印與預揀' : '待 ECOUNT 回匯'}</p></div>
      <Link to={`/warehouse-intakes/${notice.intakeId}`} onClick={event => open(event, notice)} className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-slate-300 px-3 text-sm font-medium text-blue-700">開啟批次</Link>
    </li>)}</ul>}
  </section>;
}
