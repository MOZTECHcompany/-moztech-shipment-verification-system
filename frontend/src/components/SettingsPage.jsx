import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, ChevronRight, History, MessageSquare, Users, Volume2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../ui';
import soundNotification from '../utils/soundNotification';
import voiceNotification from '../utils/voiceNotification';
import desktopNotification from '../utils/desktopNotification';

export function SettingsPage({ user }) {
  const [sound, setSound] = useState(() => soundNotification.isEnabled());
  const [voice, setVoice] = useState(() => voiceNotification.isEnabled());
  const [desktop, setDesktop] = useState(() => desktopNotification.isEnabled());
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const admin = ['admin', 'superadmin'].includes(user?.role);
  const toggle = (service, enabled, update) => {
    try { service.setEnabled(!enabled); update(service.isEnabled()); }
    catch { update(service.isEnabled()); toast.error('無法儲存提示偏好，請檢查瀏覽器設定。'); }
  };
  const toggleDesktop = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const accepted = await desktopNotification.setEnabled(!desktop);
      setDesktop(desktopNotification.isEnabled());
      if (!accepted) toast.error('請在瀏覽器允許通知後再開啟。');
    } catch { toast.error('暫時無法更新桌面通知設定。'); }
    finally { pending.current = false; setBusy(false); }
  };
  const preferences = [
    { label: '掃碼音效', icon: Volume2, checked: sound, action: () => toggle(soundNotification, sound, setSound) },
    { label: '語音播報', icon: MessageSquare, checked: voice, action: () => toggle(voiceNotification, voice, setVoice) },
    { label: '桌面通知', icon: Bell, checked: desktop, action: toggleDesktop, disabled: busy || !desktopNotification.isSupported() },
  ];
  return <div className="pb-8">
    <PageHeader title="設定" />
    <div className="grid items-start gap-6 xl:grid-cols-2">
      {admin && <section aria-labelledby="system-settings-title" className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 id="system-settings-title" className="mb-4 font-semibold">系統管理</h2>
        {[{to:'/admin/users', label:'成員與角色', icon:Users}, {to:'/admin/operation-logs', label:'操作日誌', icon:History}].map(({to,label,icon:Icon}) => <Link key={to} to={to} className="flex min-h-14 items-center gap-3 rounded-lg px-3 py-4 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700"><Icon size={19} /><span className="flex-1">{label}</span><ChevronRight size={17} /></Link>)}
      </section>}
      <section aria-labelledby="personal-settings-title" className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 id="personal-settings-title" className="font-semibold">提示與通知</h2>
        <p className="mt-1 text-xs text-slate-500">套用於此瀏覽器</p>
        <div className="mt-4 divide-y divide-slate-100">{preferences.map(({label,icon:Icon,checked,action,disabled}) => <div key={label} className="flex min-h-16 items-center gap-3 py-3">
          <Icon size={19} className="text-slate-500" /><span className="flex-1 text-sm">{label}</span>
          <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={action} className={`relative inline-flex h-11 w-14 shrink-0 items-center rounded-lg px-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-40`}>
            <span aria-hidden="true" className={`flex h-7 w-12 items-center rounded-full p-1 transition-colors ${checked ? 'bg-blue-600' : 'bg-slate-300'}`}><span className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : ''}`} /></span>
          </button>
        </div>)}</div>
        {!desktopNotification.isSupported() && <p className="mt-2 text-xs text-slate-500">此瀏覽器不支援桌面通知。</p>}
      </section>
    </div>
    <p className="mt-8 text-xs text-slate-400">Design by Corely AI</p>
  </div>;
}
