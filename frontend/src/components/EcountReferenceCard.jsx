import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/api/api';
import { Button } from '@/ui';
import { cartonSessionKey } from '@/utils/cartonScan';
import { assertEcountReferenceRequestSize, buildEcountCartonSummary, canonicalEcountVoucher, ecountReferenceStatus, parseExternalEcountLines, pendingEcountReferenceKey, validEcountReferenceResponse } from '@/utils/ecountReference.mjs';
import { CartonDialog } from './CartonDialog';

const field = 'mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm disabled:bg-slate-50';
const message = error => error.response?.data?.message || error.message || '銷貨對照未完成';
const uncertain = error => !error.response || error.response.status >= 500;
const readPending = (actorId, orderId) => {
    try {
        const body = JSON.parse(sessionStorage.getItem(pendingEcountReferenceKey(actorId, orderId)) || 'null');
        return body?.expectedActorId === actorId && typeof body.commandId === 'string' && /^[a-f0-9]{64}$/.test(body.expectedFingerprint || '') ? body : null;
    } catch { return null; }
};
const time = value => value ? new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '';

export function EcountReferenceCard({ orderData, user, refreshKey, referenceWarning }) {
    const orderId = orderData.order?.id, stateToken = orderData.stateToken;
    const [data, setData] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
    const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [pending, setPending] = useState(() => readPending(user.id, orderId));
    const [company, setCompany] = useState(''), [voucher, setVoucher] = useState(''), [reason, setReason] = useState('');
    const [external, setExternal] = useState(''), [existingChecked, setExistingChecked] = useState(false), [metadataChecked, setMetadataChecked] = useState(false), [showSummary, setShowSummary] = useState(false);
    const alive = useRef(true), requests = useRef(0), mutation = useRef(false), mutationSequence = useRef(0), loadedToken = useRef(null), context = useRef(null), pendingRef = useRef(pending);
    const sessionKey = cartonSessionKey(api, user);
    context.current = { orderId, actorId: user.id, token: stateToken, session: sessionKey };
    pendingRef.current = pending;
    const canManage = !!data?.canManage && ['dispatcher', 'admin', 'superadmin'].includes(user.role);
    const stale = !!data && loadedToken.current !== stateToken;
    const referenceUnchanged = !!data?.reference && data.reference.companyCode === company.trim() && canonicalEcountVoucher(data.reference.voucherNumber) === canonicalEcountVoucher(voucher);
    useEffect(() => { alive.current = true; return () => { alive.current = false; requests.current++; }; }, []);
    useEffect(() => {
        const restored = orderId ? readPending(user.id, orderId) : null;
        requests.current++; loadedToken.current = null; pendingRef.current = restored; mutation.current = false;
        setPending(restored); setData(null); setOpen(false); setError('');
        setBusy(false); setCompany(''); setVoucher(''); setReason(''); setExternal(''); setExistingChecked(false); setMetadataChecked(false);
    }, [orderId, user.id, sessionKey]);
    const currentContext = captured => alive.current && captured.orderId === context.current.orderId && captured.actorId === context.current.actorId && captured.session === context.current.session && captured.session === cartonSessionKey(api, user);
    const load = useCallback(async (options = {}) => {
        if (!orderId) return null;
        const request = ++requests.current, captured = { ...context.current };
        setLoading(true); if (!options.preserveError) setError('');
        try {
            const { data: result } = await api.get(`/api/orders/${orderId}/ecount-reference`, { timeout: 15000 });
            if (!currentContext(captured) || request !== requests.current) return null;
            if (!validEcountReferenceResponse(result, orderId)) throw new Error('銷貨對照回應不完整，請重新整理。');
            loadedToken.current = captured.token; setData(result); return result;
        } catch (error) { if (currentContext(captured) && request === requests.current) setError(message(error)); return null; }
        finally { if (currentContext(captured) && request === requests.current) setLoading(false); }
    }, [orderId, user, sessionKey]);
    // Unit scans keep their existing request budget. Refresh the reference after
    // a carton result/status transition or when the person opens reconciliation.
    useEffect(() => { void load(); }, [load, orderData.order?.status, refreshKey]);
    const openDialog = () => {
        const previous = pendingRef.current;
        setCompany(previous?.companyCode ?? data?.reference?.companyCode ?? '');
        setVoucher(previous?.voucherNumber ?? data?.reference?.voucherNumber ?? '');
        setReason(previous?.reason || '');
        setExternal(previous?.confirmation?.lines.flatMap(line => line.actualSN?.length ? line.actualSN.map(sn => `${line.itemCode}\t1\t${sn}`) : [`${line.itemCode}\t${line.quantity}\t`]).join('\n') || '');
        setExistingChecked(!!previous?.confirmation?.acknowledgeExistingSales); setMetadataChecked(!!previous?.confirmation?.acknowledgeMetadataSaved);
        setShowSummary(false); setOpen(true); void load();
    };
    const send = async body => {
        if (mutation.current || !canManage) return;
        const operation = ++mutationSequence.current; mutation.current = operation;
        const captured = { ...context.current }, key = pendingEcountReferenceKey(user.id, orderId);
        const ensureCurrent = () => { if (!currentContext(captured)) throw new Error('登入或訂單已更新，請重新載入核對。'); };
        setBusy(true); setError('');
        try {
            ensureCurrent();
            if (body.expectedActorId !== captured.actorId) throw new Error('原操作屬於另一位人員，請重新登入核對。');
            try { assertEcountReferenceRequestSize(body); } catch (error) { throw Object.assign(error, { notSent: true }); }
            try { sessionStorage.setItem(key, JSON.stringify(body)); } catch { throw Object.assign(new Error('瀏覽器無法保存核對追蹤，請確認儲存設定後再試。'), { notSent: true }); }
            pendingRef.current = body; setPending(body);
            const { data: result } = await api.post(`/api/orders/${orderId}/ecount-reference`, body, { timeout: 15000 });
            ensureCurrent();
            if (!validEcountReferenceResponse(result, orderId) || result.commandId !== body.commandId) throw new Error('儲存結果尚未確認，請重新確認原操作。');
            loadedToken.current = captured.token; setData(result);
            pendingRef.current = null; setPending(null); try { sessionStorage.removeItem(key); } catch { /* Replaying this same command remains safe. */ }
            setOpen(false); setExternal(''); setExistingChecked(false); setMetadataChecked(false);
            if (result.unchanged) toast.info(result.status === 'changed' ? '原單未變更，內容仍待重新核對' : '原單未變更');
            else if (result.status === 'changed') toast.info('原操作已確認，內容仍待重新核對');
            else if (result.replayed) toast.info('原操作結果已確認');
            else toast.success(result.status === 'manual_checked' ? '已保存人工核對紀錄' : '原銷貨單號已保存');
        } catch (error) {
            if (currentContext(captured) && !error.notSent && !uncertain(error)) { try { sessionStorage.removeItem(key); } catch { /* A definite rejection can be reviewed after reload. */ } pendingRef.current = null; setPending(null); }
            if (currentContext(captured)) { setError(message(error)); if (!error.notSent && !uncertain(error)) void load({ preserveError: true }); }
        } finally { if (mutation.current === operation) { mutation.current = false; if (currentContext(captured)) setBusy(false); } }
    };
    const save = manual => {
        if (mutation.current || pendingRef.current || !data || stale) return;
        if (!manual && referenceUnchanged) return;
        try {
            if (!company.trim() || company.trim().length > 64 || !voucher.trim() || voucher.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(company + voucher)) throw new Error('請填寫 ECOUNT 公司代碼與原銷貨單號。');
            if (data.reference && !referenceUnchanged && !reason.trim()) throw new Error('更換原銷貨單時請填寫變更原因。');
            let confirmation = null;
            if (manual) {
                if (!data.ready) throw new Error('請先完成出貨核對並處理下方提示。');
                if (!existingChecked || !metadataChecked) throw new Error('請先確認原銷貨單與箱號補註。');
                confirmation = { kind: 'manual-line-check', lines: parseExternalEcountLines(external), acknowledgeExistingSales: true, acknowledgeMetadataSaved: true };
            }
            void send({ commandId: crypto.randomUUID(), expectedRevision: data.reference?.revision || 0, expectedFingerprint: data.fingerprint, expectedActorId: user.id, companyCode: company.trim(), voucherNumber: voucher.trim(), ...(reason.trim() ? { reason: reason.trim() } : {}), confirmation });
        } catch (error) { setError(message(error)); }
    };
    const summary = data ? buildEcountCartonSummary(data) : '';
    const copy = async () => {
        setShowSummary(true);
        try { await navigator.clipboard.writeText(summary); toast.success('箱號摘要已複製'); }
        catch { toast.info('可選取下方箱號摘要複製。'); }
    };
    const warnings = [...new Set([referenceWarning, data?.referenceWarning].filter(Boolean))];
    const blockers = data?.blockers || [];
    const total = data?.totals.reduce((sum, line) => sum + line.quantity, 0) || 0;
    const displayRows = [...(data?.rows || []), ...(data?.looseRows || [])];
    return <section aria-label="ECOUNT銷貨對照" className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">ECOUNT 銷貨對照</h3><span className={`rounded-full px-2 py-1 text-xs font-semibold ${stale || data?.status === 'changed' ? 'bg-amber-50 text-amber-800' : data?.status === 'manual_checked' ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{pending ? '上次操作待確認' : stale ? '內容已更新，待重新整理' : data ? ecountReferenceStatus[data.status] : loading ? '載入中' : '尚未載入'}</span></div>
        {data && <><p className="break-all text-sm text-slate-700">{data.reference ? `${data.reference.companyCode} / ${data.reference.voucherNumber}` : '尚未填寫原 ECOUNT 銷貨單號'}</p><p className="text-xs text-slate-500">{data.shipmentReference} · {data.cartonSummary.length} 箱 · {total} 件</p></>}
        {!open && error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {warnings.map(warning => <p key={warning} role="alert" className="text-sm text-amber-800">{warning}</p>)}
        {blockers.length > 0 && <ul className="space-y-1 text-sm text-amber-800">{blockers.map((blocker, index) => <li key={`${blocker.code}:${index}`}>{blocker.message}</li>)}</ul>}
        {!!displayRows.length && <div className="max-h-52 overflow-auto rounded-lg border border-slate-200"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-slate-50"><tr><th className="p-2">箱號</th><th className="p-2">商品</th><th className="p-2 text-right whitespace-nowrap">本次件數</th></tr></thead><tbody>{displayRows.map(row => <tr key={`${row.cartonId || 'loose'}:${row.allocationId}:${row.cartonLineId}:${row.orderItemId}`} className="border-t"><td className="p-2 align-top break-all">{row.cartonId || '未使用箱號'}</td><td className="p-2"><p className="break-words">{row.productName || row.itemCode}</p><p className="break-all text-xs text-slate-500">{row.itemCode}</p>{!!row.actualSN?.length && <details className="mt-1 text-xs"><summary>SN {row.actualSN.length} 個</summary><p className="mt-1 break-all font-mono">{row.actualSN.join('、')}</p></details>}</td><td className="p-2 text-right align-top font-semibold">{row.quantity}</td></tr>)}</tbody></table></div>}
        <div className="flex flex-wrap gap-2">{canManage && <Button size="sm" variant="secondary" disabled={busy || loading || !data} onClick={openDialog}>銷貨單核對</Button>}<Button size="sm" variant="secondary" disabled={busy || loading || stale || !data} onClick={copy}><Copy size={14} />複製箱號摘要</Button><Button size="sm" variant="secondary" aria-label="重新整理銷貨對照" disabled={busy || loading} onClick={load}><RefreshCw size={14} />重新整理</Button></div>
        {showSummary && !open && <textarea readOnly aria-label="箱號摘要" value={summary} rows={4} className={`${field} font-mono text-xs`} />}
        <CartonDialog open={open} title="ECOUNT銷貨對照" onClose={() => { if (!busy) setOpen(false); }} footer={<><Button type="button" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>關閉</Button>{canManage && (pending ? <Button disabled={busy} onClick={() => send(pendingRef.current)}>重新確認原操作</Button> : <Button disabled={busy || loading || stale || referenceUnchanged} onClick={() => save(false)}>儲存單號</Button>)}</>}>
            {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            {pending && <p role="alert" className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">上一筆結果待確認，請重新確認原操作。</p>}
            <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">ECOUNT 公司代碼<input data-carton-autofocus aria-label="ECOUNT公司代碼" value={company} maxLength={64} disabled={busy || !!pending || !canManage} onChange={event => setCompany(event.target.value)} className={field} /></label><label className="text-sm">原 ECOUNT 銷貨單號<input aria-label="原ECOUNT銷貨單號" value={voucher} placeholder="2026/10/15-1" maxLength={100} disabled={busy || !!pending || !canManage} onChange={event => setVoucher(event.target.value)} className={field} /></label></div>
            {data?.reference && <label className="mt-3 block text-sm">變更原因<input aria-label="核對變更原因" value={reason} maxLength={1000} placeholder="更換原單時必填" disabled={busy || !!pending || !canManage} onChange={event => setReason(event.target.value)} className={field} /></label>}
            <details className="my-4 rounded-lg border border-slate-200 p-3 text-sm" open={!!pending?.confirmation || undefined}><summary className="cursor-pointer font-semibold">人工核對原單</summary><p className="mt-3 text-xs text-slate-600">從 ECOUNT 原單複製「品項、數量、序號/批號」，以 Tab 分隔。選填的 SN 必須是實際序號，每列一個、數量填 1。</p><label className="mt-3 block">ECOUNT 原單明細<textarea aria-label="ECOUNT原單明細" value={external} onChange={event => setExternal(event.target.value)} disabled={busy || !!pending || !canManage} rows={5} placeholder={'品項\t數量\t序號/批號'} className={`${field} font-mono`} /></label>
                <label className="mt-3 flex items-start gap-2"><input type="checkbox" aria-label="已存在原ECOUNT銷貨單" checked={existingChecked} disabled={busy || !!pending || !canManage} onChange={event => setExistingChecked(event.target.checked)} className="mt-1" />這是 ECOUNT 已存在的銷貨單，不新增銷貨、不重複扣庫。</label><label className="mt-3 flex items-start gap-2"><input type="checkbox" aria-label="已補箱號且不重複扣庫" checked={metadataChecked} disabled={busy || !!pending || !canManage} onChange={event => setMetadataChecked(event.target.checked)} className="mt-1" />已在原單補箱號明細，不另建銷貨或更動數量。</label>
                {blockers.map((blocker, index) => <p key={`${blocker.code}:${index}`} className="mt-2 text-amber-800">{blocker.message}</p>)}{stale && <p className="mt-2 text-amber-800">作業內容已更新，請先重新整理對照。</p>}
                {canManage && <Button type="button" size="sm" className="mt-3" disabled={busy || loading || !!pending || stale || !data?.ready} onClick={() => save(true)}>儲存人工核對</Button>}
            </details>
            <details className="text-sm" open={showSummary || undefined}><summary className="cursor-pointer text-blue-700">全單箱號摘要</summary><p className="mt-2 text-xs text-slate-600">全單對照可附原單附件；原單摘要只貼對應品項那一列，保留原摘要、SN 與數量。</p><textarea readOnly aria-label="銷貨箱號摘要" value={summary} rows={4} className={`${field} font-mono text-xs`} /><Button type="button" size="sm" variant="secondary" disabled={stale || loading || !data} onClick={copy}>複製箱號摘要</Button></details>
            {data?.reference?.confirmedAt && <p className="mt-4 text-xs text-slate-500">人工核對：{data.reference.confirmedBy?.name || data.reference.confirmedBy?.username || '已記錄人員'} · {time(data.reference.confirmedAt)}</p>}
            <p className="mt-3 text-xs text-slate-500">此處保存 WMS 追溯紀錄，沒有自動回寫 ECOUNT。</p>
            {!!data?.history?.length && <details className="mt-4 text-xs text-slate-600"><summary className="cursor-pointer">核對紀錄</summary>{data.history.map(event => <p key={event.id || event.revision} className="mt-2">{event.actorSnapshot?.name || event.actorSnapshot?.username || '作業人員'} · {time(event.createdAt)}{event.reason ? ` · ${event.reason}` : ''}</p>)}</details>}
        </CartonDialog>
    </section>;
}
