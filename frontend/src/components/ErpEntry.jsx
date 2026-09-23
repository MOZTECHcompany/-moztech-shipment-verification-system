import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/api';

export function ErpEntry({ onLogin }) {
    const navigate = useNavigate();
    const [error, setError] = useState('');
    const busy = useRef(false);
    const [nonce] = useState(() => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2,'0')).join(''));
    useEffect(() => {
        let active = true, origin, timer;
        const receive = async event => {
            if (!active || !origin || event.origin !== origin || event.source !== window.opener || busy.current || event.data?.type !== 'corely-erp-ticket' || event.data?.nonce !== nonce) return;
            busy.current = true;
            clearTimeout(timer);
            try {
                const { data } = await api.post('/api/auth/erp/exchange', {ticket:event.data.ticket, nonce});
                if (!active) return;
                onLogin(data);
                window.opener?.postMessage({type:'corely-wms-opened'}, origin);
                window.opener = null;
                navigate(data.user.role === 'dispatcher' ? '/admin' : '/tasks', {replace:true});
            } catch { if (active) { setError('無法開啟工作台，請回營運系統重試。'); window.opener?.postMessage({type:'corely-wms-error'}, origin); } }
        };
        window.addEventListener('message', receive);
        api.get('/api/auth/erp/config').then(({data}) => {
            if (!active) return;
            if (!window.opener) { setError('請從營運管理系統的作業工作台進入。'); return; }
            origin = data.origin;
            window.opener.postMessage({type:'corely-wms-ready', nonce}, origin);
            timer = setTimeout(() => setError('連線逾時，請回營運系統重新開啟工作台。'), 30000);
        }).catch(() => { if (active) setError('統一登入暫時無法使用，請回營運系統重試。'); });
        return () => { active = false; clearTimeout(timer); window.removeEventListener('message', receive); };
    }, [nonce]);
    return <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6"><div className="max-w-md rounded-2xl bg-white p-8 shadow-sm"><h1 className="text-xl font-semibold">作業工作台</h1><p role={error ? 'alert' : 'status'} className="mt-4 text-slate-600">{error || '正在確認作業身分…'}</p></div></main>;
}
