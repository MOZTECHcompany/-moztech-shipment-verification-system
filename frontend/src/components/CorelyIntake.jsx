import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useReactToPrint } from 'react-to-print';
import api from '@/api/api.js';
import { Button } from '@/ui';
import { OrderBarcode } from './OrderBarcode';
import CorelyHandover from './CorelyHandover';

const box = 'rounded-2xl border border-slate-200 bg-white p-5';
const field = 'min-h-11 rounded-lg border border-slate-300 bg-white px-3';
const manager = user => ['admin', 'superadmin', 'dispatcher'].includes(user.role);
export default function CorelyIntake({ user, token }) {
    const { intakeId } = useParams();
    return intakeId ? <IntakeDetail key={`${user.id}:${intakeId}`} id={intakeId} user={user} token={token} /> : <IntakeList user={user} />;
}
function IntakeList({ user }) {
    const [rows, setRows] = useState([]), [error, setError] = useState('');
    useEffect(() => { let live = true; api.get('/api/corely-intakes').then(r => { if (live) setRows(r.data.batches); }).catch(e => { if (live) setError(e.response?.data?.message || '讀取失敗'); }); return () => { live = false; }; }, [user.id]);
    return <main className="mx-auto max-w-6xl space-y-5 pb-8"><Link className="text-blue-700" to="/tasks">← 返回工作台</Link><h1 className="text-2xl font-semibold">Corely 出貨預揀</h1>{error && <p role="alert">{error}</p>}<div className="grid gap-4 md:grid-cols-2">{rows.map(r => <Link key={r.id} to={`/corely-intakes/${r.id}`} className={box + ' hover:border-blue-500'}><strong>{r.order_number}</strong><p className="mt-2">{r.brand}</p><p className="mt-2 text-blue-700">{!r.reservation_accepted ? '待 Corely 預留核對' : r.prepick_completed_at ? '預揀完成' : r.printed_at ? '預揀中' : '待列印／指派'}</p><p className="mt-2 text-sm">預揀：{r.prepick_owner_name || '未指派'}</p></Link>)}</div>{!rows.length && !error && <p>{manager(user) ? '目前沒有 Corely 出貨預揀單。' : '目前沒有指派給你的 Corely 預揀單。'}</p>}</main>;
}
function IntakeDetail({ id, user, token }) {
    const [data, setData] = useState(null), [staff, setStaff] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const [assignee, setAssignee] = useState(''), [productKey, setProductKey] = useState(''), [barcode, setBarcode] = useState(''), [quantity, setQuantity] = useState(1);
    const [printData, setPrintData] = useState(null);
    const paperRef = useRef(null), printResolve = useRef(null), pending = useRef(null), alive = useRef(true);
    const pendingKey = `corely-prepick:${user.id}:${id}`;
    const valid = () => alive.current && sessionStorage.getItem('wms_token') === JSON.stringify(token);
    const refresh = async () => { const r = await api.get(`/api/corely-intakes/${id}`); if (valid()) setData(r.data); return r.data; };
    useEffect(() => {
        alive.current = true;
        try { pending.current = JSON.parse(sessionStorage.getItem(pendingKey) || 'null'); if (pending.current) setError('上一操作結果待確認，請重試原操作。'); } catch { /* Invalid browser-only state is ignored. */ }
        refresh().catch(e => { if (valid()) setError(e.response?.data?.message || '讀取失敗'); });
        if (manager(user)) api.get('/api/corely-intakes/staff').then(r => { if (valid()) setStaff(r.data.staff); }).catch(() => {});
        return () => { alive.current = false; };
    }, [id, user.id, token]);
    useEffect(() => { if (printData && printResolve.current) { printResolve.current(); printResolve.current = null; } }, [printData]);
    const mutate = async (action, payload = {}) => {
        if (!valid()) throw Error('登入人員已變更，請重新整理');
        const content = JSON.stringify([action, payload]);
        if (pending.current && pending.current.content !== content) throw Error('上一操作結果待確認，請先重試原操作');
        pending.current ||= { content, body: { ...payload, commandId: crypto.randomUUID(), expectedActorId: user.id } };
        sessionStorage.setItem(pendingKey, JSON.stringify(pending.current));
        try { await api.post(`/api/corely-intakes/${id}/${action}`, pending.current.body); pending.current = null; sessionStorage.removeItem(pendingKey); }
        catch (e) { if (e.response && e.response.status < 500) { pending.current = null; sessionStorage.removeItem(pendingKey); } throw e; }
        return refresh();
    };
    const run = async (action, payload) => {
        if (busy) return; setBusy(true); setError('');
        try { await mutate(action, payload); if (action === 'scan') setBarcode(''); }
        catch (e) { if (valid()) setError(e.response?.data?.message || e.message); }
        finally { if (valid()) setBusy(false); }
    };
    const print = useReactToPrint({ contentRef: paperRef, documentTitle: `Corely 預揀-${data?.orderNumber || id}`,
        onBeforePrint: async () => { const current = await mutate('print'); if (!valid()) throw Error('登入人員已變更，已停止列印'); await new Promise(resolve => { printResolve.current = resolve; setPrintData(current); }); },
        onAfterPrint: () => setBusy(false), onPrintError: (_, e) => { setError(e.response?.data?.message || e.message); setBusy(false); },
        pageStyle: '@page {size:A4;margin:10mm} @media print {thead{display:table-header-group} tr{break-inside:avoid}.corely-paper{break-after:page}.corely-paper:last-child{break-after:auto}}' });
    if (!data) return <main><p role="status">{error || '載入 Corely 預揀單…'}</p></main>;
    const complete = data.products.every(p => data.counts[p.key] === p.quantity);
    return <main className="mx-auto max-w-6xl space-y-5 pb-8"><div className="flex items-center justify-between"><Link className="text-blue-700" to="/corely-intakes">← Corely 出貨預揀</Link><Button variant="secondary" disabled={busy} onClick={() => refresh().catch(e => setError(e.response?.data?.message || '讀取失敗'))}>更新</Button></div>
        <header><h1 className="text-2xl font-semibold">{data.orderNumber}</h1><p className="mt-2">{data.brand} · {data.snapshot.required} 件</p><p className="mt-2 text-blue-700">{data.prepickCompletedAt ? '預揀完成，可進行揀貨與裝箱' : data.reservationAccepted ? 'Corely 已預留，待預揀核對' : 'Corely 預留證據未齊，暫停放行'}</p></header>
        {error && <div role="alert" className="rounded-xl bg-amber-50 p-4"><p>{error}</p>{pending.current && <Button disabled={busy} onClick={() => { const [action, payload] = JSON.parse(pending.current.content); run(action, payload); }}>重試原操作</Button>}</div>}
        {manager(user) && <section className={box}><h2 className="font-semibold">列印與指派</h2><p className="mt-2 text-sm">領單：{data.printOwnerName || '未領取'} · 預揀：{data.prepickOwnerName || '未指派'}</p><div className="mt-4 flex flex-wrap items-center gap-3"><Button disabled={busy} onClick={() => { setBusy(true); setError(''); print(); }}>{data.printedAt ? '重印總表與明細' : '列印總表與明細'}</Button><select aria-label="預揀人員" className={field} value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">選擇預揀人員</option>{staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><Button disabled={busy || !assignee || !data.printedAt || !!data.prepickCompletedAt} onClick={() => run('assign', { assigneeId: Number(assignee) })}>指派預揀</Button></div></section>}
        <section className={box}><h2 className="font-semibold">商品查核</h2><div className="mt-4 space-y-3">{data.products.map(p => <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3" key={p.key}><div><strong>{p.name}</strong><p className="mt-1 text-sm text-slate-600">{p.sku} · {p.barcode}</p></div><span>已核對 {data.counts[p.key] || 0} / {p.quantity}</span></div>)}</div>
            {data.prepickOwnerId === user.id && !data.prepickCompletedAt && <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); run('scan', { productKey, barcode, quantity: Number(quantity) }); }}><label className="flex flex-col gap-1">商品<select className={field} value={productKey} onChange={e => setProductKey(e.target.value)} required><option value="">選擇商品</option>{data.products.map(p => <option value={p.key} key={p.key}>{p.name}</option>)}</select></label><label className="flex flex-col gap-1">商品條碼<input className={field} value={barcode} onChange={e => setBarcode(e.target.value)} autoComplete="off" required /></label><label className="flex flex-col gap-1">本次實點<input type="number" min="1" step="1" className={field + ' w-24'} value={quantity} onChange={e => setQuantity(e.target.value)} required /></label><Button disabled={busy} type="submit">確認實點</Button></form>}
            <div className="mt-5 flex flex-wrap gap-3"><Button disabled={busy || data.prepickOwnerId !== user.id || !!data.prepickCompletedAt || !data.reservationAccepted || !complete} onClick={() => run('complete')}>完成預揀並放行</Button>{data.prepickCompletedAt && <Button as={Link} to={`/order/${data.snapshot.wmsOrderId}`}>開啟工作單</Button>}</div>
        </section>{manager(user) && data.prepickCompletedAt && <CorelyHandover id={id} user={user} token={token} />}<div style={{ display: 'none' }}><div ref={paperRef}><CorelyIntakePaper data={printData || data} /></div></div>
    </main>;
}
export function CorelyIntakePaper({ data }) {
    const cell = { border: '1px solid #777', padding: 8, verticalAlign: 'top' };
    const table = items => <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>{['商品', '商品條碼', '數量'].map(h => <th key={h} style={cell}>{h}</th>)}</tr></thead><tbody>{items.map((i, index) => <tr key={index}><td style={cell}>{i.name}<br />{i.sku}{i.serials?.length > 0 && <p>須核對 {i.serials.length} 組 SN</p>}</td><td style={cell}><OrderBarcode value={i.barcode} label="商品條碼" /></td><td style={cell}>{i.quantity}</td></tr>)}</tbody></table>;
    return <div style={{ fontFamily: 'sans-serif', fontSize: '11pt' }}><section className="corely-paper"><h1>Corely 預揀總表</h1><p>{data.orderNumber} · {data.brand} · 領單：{data.printOwnerName || '未領取'}</p>{table(data.products)}<p>預揀查核：________________</p></section><section className="corely-paper"><h1>Corely 訂單作業明細</h1><p>{data.orderNumber}</p><OrderBarcode value={data.snapshot.workBarcode} label="揀貨／裝箱工作條碼" />{table(data.snapshot.items)}<p>揀貨：________________　裝箱：________________</p></section></div>;
}
