import React, { useEffect, useRef, useState } from 'react';
import apiClient from '@/api/api.js';
import { claimStageForRole, createClaimScanController } from '../utils/claimScan';

export default function ScanToClaim({ user, active = true, disabled = false, onAcquire, onLockChange, onSuccess }) {
    const [selectedStage, setSelectedStage] = useState('');
    const [view, setView] = useState({ phase: 'idle' });
    const [rejected, setRejected] = useState('');
    const inputRef = useRef(null);
    const alive = useRef(true);
    const propsRef = useRef(null);
    propsRef.current = { active, onAcquire, onLockChange, onSuccess };
    const controllerRef = useRef(null);
    if (!controllerRef.current) controllerRef.current = createClaimScanController({
        api: apiClient, userId: user.id,
        storage: typeof sessionStorage === 'undefined' ? undefined : sessionStorage,
        newCommandId: () => globalThis.crypto?.randomUUID?.() || '',
        isCurrentActor: () => {
            try { return Number(JSON.parse(localStorage.getItem('wms_user'))?.id) === Number(user.id); } catch { return false; }
        },
        onState: state => { if (alive.current) setView(state); },
        acquire: () => propsRef.current.active && propsRef.current.onAcquire(),
        release: () => { if (alive.current) propsRef.current.onLockChange(false); },
        onSuccess: result => { if (alive.current && propsRef.current.active) propsRef.current.onSuccess(result); },
    });
    const controller = controllerRef.current;
    useEffect(() => {
        alive.current = true;
        setView(controller.getState());
        if (controller.isLocked()) propsRef.current.onLockChange(true);
        return () => { alive.current = false; };
    }, [controller]);
    const stage = claimStageForRole(user.role, selectedStage);
    const stageLabel = stage === 'pick' ? '揀貨' : stage === 'pack' ? '裝箱' : '請選擇階段';
    const locked = ['submitting', 'checking', 'unknown'].includes(view.phase);
    const busy = ['submitting', 'checking'].includes(view.phase);
    const submit = event => {
        event.preventDefault();
        const value = inputRef.current?.value?.trim() || '';
        if (inputRef.current) inputRef.current.value = '';
        if (!value) return;
        if (controller.isLocked() || disabled || !active) { setRejected(value); return; }
        setRejected('');
        controller.submit(value, stage);
    };
    if (!active && !locked) return null;
    return <section aria-label="掃碼認領工作單" className="mb-4 rounded-xl border border-blue-200 bg-white p-4">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
            <div className="w-full"><h2 className="font-semibold text-slate-900">掃描工作單條碼即認領</h2><p className="mt-1 text-sm text-slate-600">操作人員：<strong>{user.name || user.username}</strong> · 掃碼後將{stage ? stageLabel : '所選階段'}綁定登入者，並開啟商品核對。</p></div>
            {['admin', 'superadmin'].includes(user.role) ? <div><label htmlFor="claim-stage" className="mb-1 block text-xs text-slate-600">認領階段（必選）</label><select id="claim-stage" value={selectedStage} disabled={locked || disabled || !active} onChange={event => setSelectedStage(event.target.value)} className="min-h-11 rounded-lg border border-slate-300 px-3"><option value="">請選擇階段</option><option value="pick">揀貨</option><option value="pack">裝箱</option></select></div>
                : <span className="rounded-lg bg-blue-50 px-3 py-3 text-sm font-semibold text-blue-800">{stageLabel}</span>}
            <div className="min-w-0 flex-1 basis-60"><label htmlFor="claim-barcode" className="mb-1 block text-xs text-slate-600">工作單認領條碼</label><input ref={inputRef} id="claim-barcode" autoComplete="off" placeholder="掃描 WT… 工作碼後按 Enter 即認領" readOnly={locked || disabled || !active} className="min-h-11 w-full rounded-lg border border-slate-300 px-3 font-mono text-sm read-only:bg-slate-50" /></div>
            <button type="submit" disabled={locked || disabled || !active || !stage} className="min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? '正在確認…' : `認領${stage ? stageLabel : '工作單'}`}</button>
        </form>
        <p className="mt-2 text-xs text-slate-500">使用 WMS 列印的工作單認領條碼。平台紙單沒有條碼時，可從出貨管理批量列印工作單後附在紙單上；也可使用下方人工領單。</p>
        {view.message && <p role="alert" className={`mt-3 text-sm ${view.phase === 'unknown' ? 'text-amber-800' : 'text-red-700'}`}>{view.message}</p>}
        {view.command && <p className="mt-2 break-all font-mono text-xs text-slate-600">待確認：{view.command.barcode} · {view.command.stage === 'pick' ? '揀貨' : '裝箱'} · {view.command.commandId}</p>}
        {view.phase === 'unknown' && <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => controller.recover()} className="min-h-11 rounded-lg border border-amber-300 px-3 text-sm">查詢原認領結果</button>{view.canRetry && <button type="button" onClick={() => controller.retrySame()} className="min-h-11 rounded-lg border border-amber-300 px-3 text-sm">以相同識別碼重送原認領</button>}</div>}
        {rejected && <p role="status" className="mt-2 break-all text-sm text-amber-800">尚未接受：{rejected}。完成目前認領後，請重新掃描。</p>}
    </section>;
}
