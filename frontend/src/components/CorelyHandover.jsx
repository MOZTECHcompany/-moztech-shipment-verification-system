import React, { useEffect, useRef, useState } from 'react';
import api from '@/api/api.js';
import { Button } from '@/ui';

const field = 'min-h-11 rounded-lg border border-slate-300 bg-white px-3';
export const deliveryLabel = status => ({ acknowledged: 'ERP 已收件，待核銷', rejected: 'ERP 回傳異常，待核對', sending: '交運已記錄，回傳中', retry: '交運已記錄，回傳待重試', pending: '交運已記錄，待回傳' }[status] || '交運已記錄，待回傳');
export function selectedHandoverLines(rows, values) {
    return rows.filter(row => Number(values[row.salesOrderLineId]?.quantity) > 0).map(row => {
        const v = values[row.salesOrderLineId], quantity = Number(v.quantity);
        if (!Number.isSafeInteger(quantity) || quantity > row.availableQuantity || !v.packageId?.trim()) throw Error('請核對本次交運數量與箱號');
        return { salesOrderLineId: row.salesOrderLineId, quantity, packages: [{ packageId: v.packageId.trim(), quantity }] };
    });
}
export default function CorelyHandover({ id, user, token }) {
    const [data, setData] = useState(null), [values, setValues] = useState({}), [handover, setHandover] = useState({ method: 'carrier_collection' });
    const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [pendingBody, setPendingBody] = useState(null);
    const live = useRef(true), busyRef = useRef(false), pending = useRef(null);
    const key = `corely-handover:${user.id}:${id}`;
    const valid = () => live.current && sessionStorage.getItem('wms_token') === JSON.stringify(token);
    const refresh = async () => { const r = await api.get(`/api/corely-intakes/${id}/shipments`); if (valid()) setData(r.data); };
    useEffect(() => {
        live.current = true;
        try { pending.current = JSON.parse(sessionStorage.getItem(key) || 'null'); setPendingBody(pending.current); } catch { /* Only this tab's retry body is read. */ }
        refresh().catch(e => { if (valid()) setError(e.response?.data?.message || '交運資料讀取失敗'); });
        return () => { live.current = false; };
    }, [id, user.id, token]);
    const run = async fn => {
        if (busyRef.current || !valid()) return;
        busyRef.current = true; setBusy(true); setError(''); setNotice('');
        try { await fn(); } catch (e) { if (valid()) setError(e.response?.data?.message || e.message || '操作失敗'); }
        finally { busyRef.current = false; if (valid()) setBusy(false); }
    };
    const submit = async retry => {
        let body = pending.current;
        if (!retry) {
            if (body) throw Error('上一交運結果待確認，請先重試原操作');
            const lines = selectedHandoverLines(data.lines, values);
            if (!lines.length || !confirmed) throw Error('請選擇商品並確認實際交運');
            const evidence = Object.fromEntries(Object.entries(handover).map(([k,v]) => [k,v.trim()]).filter(([,v]) => v));
            body = { commandId: crypto.randomUUID(), expectedActorId: user.id, confirmed: true, handover: evidence, lines };
            pending.current = body; sessionStorage.setItem(key, JSON.stringify(body)); setPendingBody(body);
        }
        if (!body || !valid()) return;
        try {
            await api.post(`/api/corely-intakes/${id}/shipments`, body);
            pending.current = null; sessionStorage.removeItem(key);
            if (valid()) { setPendingBody(null); setValues({}); setConfirmed(false); setNotice('交運已記錄，待 ERP 收件與核銷。'); }
        } catch (e) {
            if (e.response && e.response.status < 500) { pending.current = null; sessionStorage.removeItem(key); if (valid()) setPendingBody(null); }
            throw e;
        }
        await refresh();
    };
    if (!data) return <section className="rounded-2xl border bg-white p-5"><h2 className="font-semibold">實際交運</h2><p role="status" className="mt-3">{error || '讀取交運資料…'}</p></section>;
    const update = (line, key, value) => setValues(old => ({ ...old, [line]: { ...old[line], [key]: value } }));
    return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">實際交運</h2><Button variant="secondary" disabled={busy} onClick={() => run(refresh)}>更新交運狀態</Button></div>
        {error && <p role="alert" className="rounded-lg bg-amber-50 p-3">{error}</p>}{notice && <p role="status" className="text-emerald-800">{notice}</p>}
        {pendingBody && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3"><p>上一批交運結果待確認，請重試同一筆操作。</p><Button disabled={busy} onClick={() => run(() => submit(true))}>重試原交運確認</Button></div>}
        {data.blocker ? <p className="rounded-lg bg-amber-50 p-3">{data.blocker}</p> : data.lines.some(l => l.availableQuantity > 0) ? <form className="space-y-4" onSubmit={e => { e.preventDefault(); run(() => submit(false)); }}>
            <fieldset disabled={busy || !!pendingBody} className="space-y-4">
                <div className="space-y-3">{data.lines.map(line => <div key={line.salesOrderLineId} className="flex flex-wrap items-end gap-3 rounded-xl border p-3"><div className="min-w-48 flex-1"><strong>{line.name}</strong><p className="text-sm text-slate-600">{line.sku} · 明細 {line.salesOrderLineId}</p><p className="mt-1 text-sm">已裝箱 {line.packedQuantity} · 已交運 {line.handedOverQuantity} · 可交運 {line.availableQuantity}</p></div><label className="flex flex-col gap-1 text-sm">本次數量<input className={field + ' w-24'} type="number" min="0" max={line.availableQuantity} step="1" value={values[line.salesOrderLineId]?.quantity || ''} disabled={!line.availableQuantity} onChange={e => update(line.salesOrderLineId, 'quantity', e.target.value)} /></label><label className="flex flex-col gap-1 text-sm">箱號<input className={field + ' w-40'} maxLength="100" value={values[line.salesOrderLineId]?.packageId || ''} disabled={!line.availableQuantity} required={Number(values[line.salesOrderLineId]?.quantity) > 0} onChange={e => update(line.salesOrderLineId, 'packageId', e.target.value)} /></label></div>)}</div>
                <div className="flex flex-wrap gap-3"><label className="flex flex-col gap-1 text-sm">交運方式<select className={field} value={handover.method} onChange={e => { setHandover({ method: e.target.value }); setConfirmed(false); }}><option value="carrier_collection">交給物流</option><option value="customer_pickup">客戶自取</option></select></label>{handover.method === 'carrier_collection' && <><label className="flex flex-col gap-1 text-sm">承運商<input className={field} required maxLength="200" value={handover.carrier || ''} onChange={e => setHandover(h => ({...h,carrier:e.target.value}))} /></label><label className="flex flex-col gap-1 text-sm">追蹤號碼<input className={field} maxLength="200" value={handover.trackingNo || ''} onChange={e => setHandover(h => ({...h,trackingNo:e.target.value}))} /></label></>}<label className="flex flex-col gap-1 text-sm">{handover.method === 'customer_pickup' ? '簽收編號' : '交接清單編號'}<input className={field} maxLength="200" value={handover.manifestId || ''} onChange={e => setHandover(h => ({...h,manifestId:e.target.value}))} /></label></div>
                <label className="flex flex-col gap-1 text-sm">交接紀錄<textarea className="min-h-20 rounded-lg border p-3" maxLength="500" value={handover.note || ''} onChange={e => setHandover(h => ({...h,note:e.target.value}))} /></label>
                <p className="text-sm text-slate-600">{handover.method === 'carrier_collection' ? '請填追蹤號碼或交接清單編號。' : '請填簽收編號或交接紀錄。'}</p>
                <label className="flex items-start gap-2"><input className="mt-1" type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} required /><span>本批商品已實際交付，數量、箱號與交接紀錄已核對。確認後需依異常流程處理更正。</span></label>
                <Button type="submit" disabled={!confirmed}>確認本批已交運</Button>
            </fieldset>
        </form> : <p className="text-slate-600">目前沒有尚未交運的已裝箱商品。</p>}
        {!!data.shipments.length && <details open><summary className="cursor-pointer font-semibold">交運記錄（{data.shipments.length} 批）</summary><div className="mt-3 space-y-3">{data.shipments.map(s => <article key={s.id} className="rounded-xl border p-3"><div className="flex flex-wrap justify-between gap-2"><strong>{new Date(s.occurredAt).toLocaleString('zh-TW')}</strong><span className="text-blue-800">{deliveryLabel(s.deliveryStatus)}</span></div><p className="mt-2 text-sm">{s.method === 'customer_pickup' ? '客戶自取' : s.carrier} · {s.trackingNo || s.manifestId || s.note}</p><ul className="mt-2 text-sm">{s.lines.map(l => <li key={l.shipmentLineId}>{l.sku} · {l.quantity} 件 · {l.packages.map(p => `${p.packageId}（${p.quantity}）`).join('、')}</li>)}</ul>{['pending','retry','rejected'].includes(s.deliveryStatus) && <Button variant="secondary" disabled={busy} onClick={() => run(async () => { await api.post(`/api/corely-intakes/${id}/shipments/${s.id}/retry`, {}); if (valid()) setNotice('已排入回傳重試；交運記錄保持不變。'); await refresh(); })}>重試回傳 ERP</Button>}</article>)}</div></details>}
    </section>;
}
