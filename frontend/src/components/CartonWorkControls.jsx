import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Box, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/api/api';
import { Button } from '@/ui';
import { isWarehouseAdmin } from '@/utils/managementScope';
import { applyCartonResponse, makeCartonCommand, sendCartonCommand, sendCartonMutation, cartonSessionKey } from '@/utils/cartonScan';
import { CartonDialog } from './CartonDialog';
import { buildCartonShipmentTrace } from '@/utils/cartonShipmentTrace.mjs';

const message = err => err.response?.data?.message || err.message || '箱號作業失敗';
const field = 'w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm';

function SplitLine({ line, selections, setSelections, items, stage }) {
    const groups = selections.map((value, index) => ({ value, index })).filter(group => group.value.lineId === line.lineId);
    const update = (index, patch) => setSelections(old => old.map((s,i)=>i===index?{...s,...patch}:s));
    return <fieldset className="mt-3 rounded-lg border p-3"><legend className="px-1 text-sm">{line.productName || line.itemCode} · 剩餘 {line.remainingQuantity} 件</legend>{stage === 'pick' && <>
        {groups.map(({value,index}) => <div key={index} className="mb-3 rounded-lg bg-slate-50 p-3">
            <label className="text-sm">理貨單品項<select value={value.orderItemId || ''} className={field} onChange={e=>update(index,{orderItemId:e.target.value})}><option value="">自動比對</option>{items.filter(item=>item.product_code===line.itemCode&&Number(item.quantity_sign??1)===1).map(item=><option key={item.id} value={item.id}>{item.product_name} · {item.product_code}{item.source_order_number ? ` · ${item.source_order_number}` : ` · 列 ${item.id}`} · 尚餘 {item.quantity - item.picked_quantity}</option>)}</select></label>
            {line.actualSN.length ? <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-48 overflow-y-auto">{line.remainingSN.map(sn=><label key={sn} className="flex items-center gap-2 text-sm break-all"><input type="checkbox" checked={value.actualSN.includes(sn)} disabled={selections.some((s,i)=>i!==index&&s.actualSN.includes(sn))} onChange={e=>{const actualSN=e.target.checked?[...value.actualSN,sn]:value.actualSN.filter(v=>v!==sn);update(index,{actualSN,quantity:actualSN.length});}} />{sn}</label>)}</div> : <label className="mt-2 block text-sm">本次取出數量<input type="number" min="0" max={line.remainingQuantity} step="1" value={value.quantity} onChange={e=>update(index,{quantity:Number(e.target.value)})} className={field} /></label>}
            {groups.length>1 && <button type="button" className="mt-2 text-sm text-red-700" onClick={()=>setSelections(old=>old.filter((_,i)=>i!==index))}>移除此分配</button>}
        </div>)}
        <Button size="sm" variant="secondary" onClick={()=>setSelections(old=>[...old,{lineId:line.lineId,orderItemId:'',quantity:0,actualSN:[]}])}>新增分配品項</Button>
    </>}</fieldset>;
}

export const CartonWorkControls = forwardRef(function CartonWorkControls({ orderData, user, stage, blocked, submissionRef, onBusy, onResponse, onError }, ref) {
    const [open, setOpen] = useState(false), [scanValue, setScanValue] = useState(''), [box, setBox] = useState(null);
    const [selections, setSelections] = useState([]), [error, setError] = useState(''), [reading, setReading] = useState(false);
    const [shipments, setShipments] = useState(null), [detailsOpen, setDetailsOpen] = useState(false);
    const [release, setRelease] = useState(null), [reason, setReason] = useState('');
    const readRequest = useRef(0), alive = useRef(true);
    const clearLookup = () => { readRequest.current++; setReading(false); setBox(null); setSelections([]); };
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const orderId = orderData.order?.id;
    const loadShipments = useCallback(async () => {
        if (!orderId) return;
        const session = cartonSessionKey(api, user);
        const { data } = await api.get(`/api/orders/${orderId}/carton-shipments`);
        if (!alive.current || session !== cartonSessionKey(api, user)) return null;
        setShipments(data);
        return data;
    }, [orderId, user]);
    useEffect(() => { setShipments(null); setBox(null); setOpen(false); }, [orderId]);
    const submit = (value, type, options = {}) => {
        if (blocked || !type) return false;
        const snapshot = orderData;
        const session = cartonSessionKey(api, user);
        const current = () => alive.current && session === cartonSessionKey(api, user);
        const result = submissionRef.current.submit(value, async () => {
            let sent = false;
            try {
                const body = { scanValue: value, type, serialPolicy: 'from-carton', expectedActorId: user.id, ...options };
                const { data: preview } = await api.post(`/api/orders/${orderId}/carton-preview`, body, { timeout: 15000 });
                if (!current()) return;
                if ((preview.expectedState || preview.stateToken) !== snapshot.stateToken) throw new Error('訂單已更新，請重新載入後再掃箱號');
                const command = makeCartonCommand(preview, body);
                sent = true;
                const { data } = await sendCartonCommand(api, orderId, command);
                const updated = applyCartonResponse(snapshot, data);
                if (!current()) return;
                const amount = (data.allocation?.lines || preview.selection || []).reduce((sum, l) => sum + Number(l.quantity || 0), 0);
                onResponse(updated, { value: data.carton?.cartonId || value, type, amount, allocation: data.allocation });
                setOpen(false); clearLookup(); setError('');
                loadShipments().catch(() => {});
                toast.success(`箱號${type === 'pick' ? '揀貨' : '裝箱'}已確認`);
            } catch (err) {
                if (!alive.current) return;
                setError(message(err));
                const unknown = sent && (!err.response || (err.response.status >= 500 && !err.response.data?.scanNotApplied && err.response.data?.code !== 'SCAN_NOT_APPLIED'));
                onError(value, err, unknown);
            } finally { if (alive.current) { if (!current()) onError(value, new Error('登入已更新，請重新載入訂單'), sent); onBusy(false); } }
        });
        if (!result.accepted) { toast.warning(result.reason === 'review' ? '請先核對上一筆掃描結果' : '請等候上一筆掃描完成'); return false; }
        onBusy(true, value); void result.completion; return true;
    };
    useImperativeHandle(ref, () => ({ scan: (value, type) => submit(value, type) }));
    const lookup = async () => {
        if (!scanValue.trim()) return;
        const request = ++readRequest.current; setReading(true); setError(''); setBox(null);
        const session = cartonSessionKey(api, user);
        try {
            const { data } = await api.get('/api/cartons/lookup', { params: { scanValue: scanValue.trim() } });
            if (!alive.current || request !== readRequest.current || session !== cartonSessionKey(api, user)) return;
            const carton = data.carton || data; setBox(carton);
            setSelections(carton.lines.map(line => {
                const matches = orderData.items.filter(item => item.product_code === line.itemCode && Number(item.quantity_sign ?? 1) === 1);
                const item = matches.length === 1 ? matches[0] : null;
                const remaining = item ? Number(item.quantity) - Number(item.picked_quantity || 0) : line.remainingQuantity;
                return { lineId: line.lineId, orderItemId: item?.id || '', quantity: line.actualSN.length ? 0 : Math.max(0, Math.min(line.remainingQuantity, remaining)), actualSN: [] };
            }));
        } catch (err) { if (alive.current && session === cartonSessionKey(api, user) && request === readRequest.current) setError(message(err)); }
        finally { if (request === readRequest.current) setReading(false); }
    };
    const split = () => {
        const selected = selections.filter(s => s.actualSN.length || Number(s.quantity) > 0).map(s => ({ lineId: s.lineId, ...(s.orderItemId ? { orderItemId: Number(s.orderItemId) } : {}), quantity: Number(s.quantity), actualSN: s.actualSN }));
        if (!selected.length) { setError('請選擇要出貨的數量或 SN'); return; }
        submit(scanValue.trim(), 'pick', { mode: 'split', selections: selected });
    };
    const exportFile = async () => {
        const session = cartonSessionKey(api, user);
        try {
            const data = await loadShipments();
            if (!data || !alive.current) return;
            const table = buildCartonShipmentTrace(data);
            const rows = table.rows;
            if (!rows.length) throw new Error('此單尚無箱號作業紀錄');
            const xlsx = await import('xlsx');
            if (!alive.current || session !== cartonSessionKey(api, user)) return;
            const workbook = xlsx.utils.book_new();
            xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([table.headers, ...rows]), table.name);
            xlsx.writeFile(workbook, `出貨箱號對照-${String(orderData.order.voucher_number).replace(/[^\w\u4e00-\u9fff-]/g, '_')}.xlsx`);
        } catch (err) { if (alive.current) toast.error(message(err)); }
    };
    const releaseAllocation = () => {
        if (!reason.trim() || blocked) return;
        const snapshot = orderData;
        const session = cartonSessionKey(api, user);
        const current = () => alive.current && session === cartonSessionKey(api, user);
        const result = submissionRef.current.submit(release.cartonId, async () => {
            let sent = false;
            try {
                const { data } = await api.get(`/api/cartons/${encodeURIComponent(release.cartonId)}`);
                if (!current()) return;
                const carton = data.carton || data;
                const command = { commandId: crypto.randomUUID(), expectedState: snapshot.stateToken, expectedCartonRevision: carton.stateRevision, expectedActorId: user.id, reason: reason.trim() };
                sent = true;
                const response = await sendCartonMutation(api, `/api/cartons/allocations/${release.allocationId || release.id}/release`, command);
                const updated = applyCartonResponse(snapshot, response.data);
                if (!current()) return;
                onResponse(updated, { value: release.cartonId, type: 'release', amount: 0 }); setRelease(null); loadShipments().catch(() => {});
                toast.success('箱號分配已解除');
            } catch (err) { if (alive.current) { setError(message(err)); onError(release.cartonId, err, sent && (!err.response || (err.response.status >= 500 && !err.response.data?.scanNotApplied && err.response.data?.code !== 'SCAN_NOT_APPLIED'))); } }
            finally { if (alive.current) { if (!current()) onError(release.cartonId, new Error('登入已更新，請重新載入訂單'), sent); onBusy(false); } }
        });
        if (result.accepted) { onBusy(true, release.cartonId); void result.completion; }
    };
    return <section className="rounded-xl border bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold flex items-center gap-2"><Box size={18} />箱號作業</h3><Button size="sm" variant="secondary" disabled={blocked || !stage} onClick={() => { setScanValue(''); clearLookup(); setError(''); setOpen(true); }}>掃箱／拆箱</Button></div>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={reading} onClick={() => { setError(''); setDetailsOpen(true); loadShipments().catch(err => setError(message(err))); }}>箱號明細</Button><Button size="sm" variant="secondary" disabled={reading} onClick={exportFile}><FileDown size={14} />匯出對照</Button></div>
        <CartonDialog open={open} title={stage === 'pack' ? '箱號裝箱核對' : '箱號揀貨'} onClose={() => { if (!blocked) { clearLookup(); setOpen(false); } }} footer={<><Button variant="secondary" disabled={blocked || !scanValue.trim()} onClick={() => submit(scanValue.trim(), stage)}>整箱{stage === 'pack' ? '裝箱' : '揀貨'}</Button>{stage === 'pick' && box && <Button disabled={blocked} onClick={split}>確認拆箱揀貨</Button>}</>}>
            <div className="flex gap-2"><input autoFocus aria-label="箱號" value={scanValue} disabled={blocked} onChange={e => { setScanValue(e.target.value); clearLookup(); }} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); submit(scanValue.trim(), stage); } }} className={field} /><Button variant="secondary" disabled={reading || blocked} onClick={lookup}>查詢</Button></div>
            {error && <p role="alert" className="my-3 text-sm text-red-700">{error}</p>}
            {box?.lines.map(line => <SplitLine key={line.lineId} line={line} selections={selections} setSelections={setSelections} items={orderData.items} stage={stage} />)}
        </CartonDialog>
        <CartonDialog open={detailsOpen} title="出貨箱號明細" onClose={() => setDetailsOpen(false)} footer={<Button variant="secondary" onClick={exportFile}>匯出對照</Button>}>
            {error && <p role="alert" className="text-red-700 mb-3">{error}</p>}
            {(shipments?.allocations || []).map(a => <div key={a.allocationId || a.id} className="mb-3 rounded-lg border p-3"><div className="flex flex-wrap justify-between gap-2"><strong>{a.cartonId}</strong><span className="text-sm">{a.status === 'packed' ? '裝箱核對完成' : a.status === 'released' ? '已解除' : '已揀貨'}</span></div>{a.lines.map(l => <p key={`${l.lineId}:${l.orderItemId}`} className="text-sm mt-1">{l.itemCode} × {l.quantity}{l.actualSN?.length ? ` · ${l.actualSN.join('、')}` : ''}</p>)}{isWarehouseAdmin(user) && a.status === 'picked' && <button type="button" className="mt-2 text-sm text-red-700 underline" onClick={() => { setRelease(a); setReason(''); }}>解除分配</button>}</div>)}
            {shipments && !shipments.allocations?.length && <p className="text-sm text-slate-500">尚無箱號作業紀錄</p>}
        </CartonDialog>
        <CartonDialog open={!!release} title="解除箱號分配" onClose={() => !blocked && setRelease(null)} footer={<Button disabled={!reason.trim() || blocked} onClick={releaseAllocation}>確認解除</Button>}>
            <p className="mb-3">{release?.cartonId}</p><label className="text-sm">原因<input autoFocus className={field} value={reason} onChange={e => setReason(e.target.value)} /></label>{error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
        </CartonDialog>
    </section>;
});
