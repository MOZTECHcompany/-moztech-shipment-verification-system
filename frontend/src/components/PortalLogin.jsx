import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../api/api';
import { LoginPage } from './LoginPage';
import { safeEntryDestination } from '../utils/entryDestination';
const entries = {'/admin':'dispatch','/admin/marketplace-converter':'marketplace','/admin/users':'users','/admin/operation-logs':'logs','/admin/analytics':'overview','/admin/scan-errors':'scan-errors','/admin/defects':'defects','/admin/exceptions':'exceptions','/settings':'settings','/settings/logistics':'logistics','/warehouse-intakes':'intakes','/team':'team'};
export function PortalLogin(props) {
  const [config,setConfig] = useState(null), [error,setError] = useState(false);
  const location = useLocation();
  const load = () => {setError(false); api.get('/api/auth/erp/config').then(({data})=>setConfig(data)).catch(()=>setError(true));};
  useEffect(load, []);
  if (config && !config.erpOnly) return <LoginPage {...props}/>;
  const next = safeEntryDestination(new URLSearchParams(location.search).get('next'));
  const entry = next.startsWith('/corely-intakes') ? 'dispatch' : entries[next];
  return <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6"><section className="max-w-md rounded-2xl bg-white p-8 shadow-sm"><h1 className="text-xl font-semibold">儲運管理</h1>
    {error ? <><p role="alert" className="my-4">暫時無法確認登入入口，請稍後重試。</p><button onClick={load}>重新連線</button></> : config ? <><p className="my-4 text-slate-600">使用營運管理系統帳號進入，不需要另填儲運帳密。</p><a className="inline-flex rounded-lg bg-blue-600 px-5 py-3 text-white" href={config.origin + '/warehouse' + (entry ? '/'+entry : '')}>返回營運管理系統</a></> : <p role="status" className="mt-4">正在確認登入入口…</p>}
  </section></main>;
}
