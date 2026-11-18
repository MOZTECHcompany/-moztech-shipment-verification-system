import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Box, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/api/api';
import { Button } from '@/ui';
import { isWarehouseAdmin } from '@/utils/managementScope';
import { addCartonSplitSerial, applyCartonResponse, applyStickerSerialResponse, cartonSplitOrderItems, makeCartonCommand, sendCartonCommand, sendCartonMutation, cartonSessionKey, getStickerSerialReview } from '@/utils/cartonScan';
import { makeScanCommand } from '@/utils/scanDelta';
import { CartonDialog } from './CartonDialog';
import { buildCartonShipmentTrace, buildPackedCartonShipmentTrace, cartonTraceNotes } from '@/utils/cartonShipmentTrace.mjs';
import { EcountReferenceCard } from './EcountReferenceCard';

const message = err => err.response?.data?.message || err.message || '箱號作業失敗';
const field = 'w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm';

function SplitLine({ line, selections, setSelections, items, instances, carton, stage }) {
    if (!line.actualSN.length || stage !== 'pick') {
        return <p className="mt-3 text-sm">{line.productName || line.itemCode} · 來源箱剩餘 {line.remainingQuantity} 件</p>;
    }
    const groups = selections.map((value, index) => ({ value, index })).filter(group => group.value.lineId === line.lineId);
    const update = (index, patch) => setSelections(old => old.map((s,i)=>i===index?{...s,...patch}:s));
    return <fieldset className="mt-3 rounded-lg border p-3"><legend className="px-1 text-sm">{line.productName || line.itemCode} · 剩餘 {line.remainingQuantity} 件</legend>{stage === 'pick' && <>
        {groups.map(({value,index}) => <div key={index} className="mb-3 rounded-lg bg-slate-50 p-3">
            <label className="text-sm">理貨單品項<select value={value.orderItemId || ''} className={field} onChange={e=>update(index,{orderItemId:e.target.value})}><option value="">自動比對</option>{cartonSplitOrderItems(line, items, instances, carton).map(item=><option key={item.id} value={item.id}>{item.product_name} · {item.product_code}{item.source_order_number ? ` · ${item.source_order_number}` : ` · 列 ${item.id}`} · 尚餘 {item.quantity - item.picked_quantity}</option>)}</select></label>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1 max-h-48 overflow-y-auto">{line.remainingSN.map(sn=><label key={sn} className="flex items-center gap-2 text-sm break-all"><input type="checkbox" checked={value.actualSN.includes(sn)} disabled={selections.some((s,i)=>i!==index&&s.actualSN.includes(sn))} onChange={e=>{const actualSN=e.target.checked?[...value.actualSN,sn]:value.actualSN.filter(v=>v!==sn);update(index,{actualSN,quantity:actualSN.length});}} />{sn}</label>)}</div>
            {groups.length>1 && <button type="button" className="mt-2 text-sm text-red-700" onClick={()=>setSelections(old=>old.filter((_,i)=>i!==index))}>移除此分配</button>}
        </div>)}
        <Button size="sm" variant="secondary" onClick={()=>setSelections(old=>[...old,{lineId:line.lineId,orderItemId:'',quantity:0,actualSN:[]}])}>新增分配品項</Button>
    </>}</fieldset>;
}

export const CartonWorkControls = forwardRef(function CartonWorkControls({ orderData, user, stage, blocked, submissionRef, onBusy, onResponse, onError, onFocusScanner }, ref) {
    const [open, setOpen] = useState(false), [scanValue, setScanValue] = useState(''), [box, setBox] = useState(null);
    const [selections, setSelections] = useState([]), [error, setError] = useState(''), [reading, setReading] = useState(false);
    const [shipments, setShipments] = useState(null), [detailsOpen, setDetailsOpen] = useState(false);
    const [release, setRelease] = useState(null), [reason, setReason] = useState('');
    const [serialReview, setSerialReview] = useState(null);
    const [splitSerialValue, setSplitSerialValue] = useState('');
    const [unitValue, setUnitValue] = useState(''), [unitItemId, setUnitItemId] = useState('');
    const readRequest = useRef(0), alive = useRef(true), cartonInput = useRef(null), splitSerialInput = useRef(null);
    const unitInput = useRef(null);
    const clearLookup = () => { readRequest.current++; setReading(false); setBox(null); setSelections([]); setSplitSerialValue(''); setUnitValue(''); setUnitItemId(''); };
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
    useEffect(() => { setShipments(null); setBox(null); setOpen(false); setSerialReview(null); }, [orderId]);
    const showCarton = carton => {
        setBox(carton);
        setSplitSerialValue('');
        setSelections(carton.lines.filter(line => line.actualSN.length).map(line => {
            const matches = cartonSplitOrderItems(line, orderData.items, orderData.instances, carton);
            const item = matches.length === 1 ? matches[0] : null;
            return { lineId: line.lineId, orderItemId: item?.id || '', quantity: 0, actualSN: [] };
        }));
        setError(carton.matchedSerials?.length && stage === 'pick' ? '這張貼紙只包含部分箱內 SN，請逐件掃描本次要揀的實物 SN' : '');
    };
    useEffect(() => {
        if (!open || blocked) return;
        if (box && unitInput.current) unitInput.current.focus();
        else if (box && stage === 'pick' && splitSerialInput.current) splitSerialInput.current.focus();
        else if (!box) cartonInput.current?.focus();
    }, [open, box, stage, blocked]);
    const reviewStale = serialReview && (serialReview.expectedState !== orderData.stateToken || serialReview.type !== stage
        || serialReview.session !== cartonSessionKey(api, user) || !/^[0-9a-f]{64}$/.test(serialReview.expectedState || ''));
    const submit = (value, type, options = {}, onLooseScan) => {
        if (blocked || !type) return false;
        const snapshot = orderData;
        const session = cartonSessionKey(api, user);
        const current = () => alive.current && session === cartonSessionKey(api, user);
        const { knownSerial, ...scanOptions } = options;
        let useLooseScan = false;
        const result = submissionRef.current.submit(value, async () => {
            let sent = false;
            try {
                let body = { scanValue: value, type, serialPolicy: 'from-carton', expectedActorId: user.id, ...scanOptions };
                const previewCarton = async input => (await api.post(`/api/orders/${orderId}/carton-preview`,
                    { ...input, matchSerialSubset: !['serial', 'split', 'unit'].includes(input.mode) }, { timeout: 15000 })).data;
                let preview;
                try {
                    preview = await previewCarton(body);
                } catch (err) {
                    if (!onLooseScan || err.response?.data?.code !== 'CARTON_SERIAL_NOT_REGISTERED') throw err;
                    if (!current()) return;
                    if (knownSerial || options.orderItemId) { useLooseScan = true; return; }
                    body = { scanValue: value, type, serialPolicy: 'from-carton', expectedActorId: user.id };
                    try { preview = await previewCarton(body); }
                    catch (cartonError) {
                        if (cartonError.response?.data?.code !== 'CARTON_NOT_FOUND') throw cartonError;
                        useLooseScan = true;
                        return;
                    }
                }
                if (!current()) return;
                if ((preview.expectedState || preview.stateToken) !== snapshot.stateToken) throw new Error('訂單已更新，請重新載入後再掃箱號');
                if (preview.carton?.matchedSerials?.length) {
                    clearLookup(); setError(''); setScanValue(value); showCarton(preview.carton); setOpen(true);
                    return;
                }
                const command = makeCartonCommand(preview, body);
                sent = true;
                const { data } = await sendCartonCommand(api, orderId, command);
                const updated = applyCartonResponse(snapshot, data);
                if (!current()) return;
                const amount = (data.appliedSelection || preview.selection || data.allocation?.lines || [])
                    .reduce((sum, line) => sum + Number(line.quantity || 0), 0);
                const itemScan = ['serial', 'unit'].includes(body.mode);
                onResponse(updated, { value: itemScan ? value : data.carton?.cartonId || value, type, amount, allocation: data.allocation });
                const stageFinished = (type === 'pick' && updated.order.status === 'picked')
                    || (type === 'pack' && updated.order.status === 'completed');
                if (body.mode === 'unit' && !stageFinished && (type === 'pick' || !data.packComplete)) {
                    setBox(data.carton); setUnitValue(''); setUnitItemId('');
                } else {
                    setOpen(false); clearLookup();
                }
                setError('');
                loadShipments().catch(() => {});
                toast.success(itemScan
                    ? `${type === 'pick' ? '已拆箱揀貨' : '已逐件核對'} · ${value}`
                    : `箱號${type === 'pick' ? '揀貨' : '裝箱'}已確認`);
            } catch (err) {
                if (!alive.current) return;
                if (!sent && current() && options.mode !== 'unit' &&
                    ['CARTON_PACK_UNIT_REQUIRED', 'CARTON_SPLIT_UNIT_REQUIRED'].includes(err.response?.data?.code)) {
                    setScanValue(value); setOpen(true);
                    await lookup(value);
                    return;
                }
                if (!sent && current() && err.response?.status === 404 && err.response.data?.code === 'CARTON_NOT_FOUND') {
                    if (type === 'pack' && value.includes(',')) {
                        const packError = new Error('找不到可整箱核對的箱號，請逐件掃描本次出貨的 SN');
                        setError(packError.message); onError(value, packError, false);
                        return;
                    }
                    const review = getStickerSerialReview(value, type, snapshot);
                    if (review) {
                        setOpen(false); clearLookup(); setError('');
                        setSerialReview({ ...review, value, type, session, expectedState: snapshot.stateToken, selectedSerials: [] });
                        return;
                    }
                }
                setError(message(err));
                const unknown = sent && (!err.response || (err.response.status >= 500 && !err.response.data?.scanNotApplied && err.response.data?.code !== 'SCAN_NOT_APPLIED'));
                onError(value, err, unknown);
            } finally { if (alive.current) { if (!current()) onError(value, new Error('登入已更新，請重新載入訂單'), sent); onBusy(false); } }
        });
        if (!result.accepted) { toast.warning(result.reason === 'review' ? '請先核對上一筆掃描結果' : '請等候上一筆掃描完成'); return false; }
        onBusy(true, value);
        void result.completion.then(() => { if (useLooseScan && current()) onLooseScan(); });
        return true;
    };
    const openCartonScanner = () => { setScanValue(''); clearLookup(); setError(''); setOpen(true); };
    useImperativeHandle(ref, () => ({ scan: submit, openScanner: openCartonScanner }));
    const confirmSerialReview = () => {
        if (blocked || reviewStale || !serialReview?.selectedSerials.length) return;
        const { value, type, session, selectedSerials } = serialReview;
        const snapshot = orderData;
        const current = () => alive.current && session === cartonSessionKey(api, user);
        const result = submissionRef.current.submit(value, async () => {
            let sent = false;
            try {
                if (!current()) return;
                const command = makeScanCommand(snapshot, { orderId, scanValue: value, selectedSerials, type, expectedActorId: user.id });
                sent = true;
                const { data } = await sendCartonMutation(api, '/api/orders/update_item', command);
                const updated = applyStickerSerialResponse(snapshot, data, command);
                if (!current()) return;
                onResponse(updated, { value: 'SN QR Code', type, amount: selectedSerials.length });
                setSerialReview(null); setError('');
                toast.success(`已核對 ${selectedSerials.length} 個 SN`);
            } catch (err) {
                if (!current()) return;
                const unknown = sent && (!err.response || err.response.data?.code === 'SCAN_RESULT_UNKNOWN'
                    || (err.response.status >= 500 && !err.response.data?.scanNotApplied && err.response.data?.code !== 'SCAN_NOT_APPLIED'));
                const changed = err.response?.data?.reason === 'STATE_CHANGED' || err.response?.data?.code === 'STATE_CHANGED';
                if (unknown || changed) setSerialReview(null);
                else setError(message(err));
                onError(value, err, unknown || changed);
            } finally {
                if (alive.current) {
                    if (!current()) onError(value, new Error('登入已更新，請重新載入訂單'), sent);
                    onBusy(false);
                }
            }
        });
        if (result.accepted) { onBusy(true, value); void result.completion; }
    };
    const lookup = async (value = scanValue) => {
        if (!value.trim()) return;
        const request = ++readRequest.current; setReading(true); setError(''); setBox(null);
        const session = cartonSessionKey(api, user);
        try {
            const { data } = await api.get('/api/cartons/lookup', { params: { scanValue: value.trim(), matchSerialSubset: true } });
            if (!alive.current || request !== readRequest.current || session !== cartonSessionKey(api, user)) return;
            showCarton(data.carton || data);
        } catch (err) { if (alive.current && session === cartonSessionKey(api, user) && request === readRequest.current) setError(message(err)); }
        finally { if (request === readRequest.current) setReading(false); }
    };
    const scanSplitSerial = value => {
        if (blocked || !box || !value.trim()) return;
        setSplitSerialValue('');
        try {
            setSelections(addCartonSplitSerial(box, selections, orderData.instances, value));
            setError('');
        } catch (error) { setError(message(error)); }
    };
    const split = () => {
        if (!box) return;
        const selected = selections.filter(s => s.actualSN.length || Number(s.quantity) > 0).map(s => ({ lineId: s.lineId, ...(s.orderItemId ? { orderItemId: Number(s.orderItemId) } : {}), quantity: Number(s.quantity), actualSN: s.actualSN }));
        if (!selected.length) { setError('請選擇要出貨的數量或 SN'); return; }
        submit(`CARTON:${box.cartonId}`, 'pick', { mode: 'split', selections: selected });
    };
    const exportFile = async (history = false) => {
        const session = cartonSessionKey(api, user);
        try {
            const data = history ? await loadShipments() : (await api.get(`/api/orders/${orderId}/ecount-reference`, { timeout: 15000 })).data;
            if (!data || !alive.current) return;
            const table = history ? buildCartonShipmentTrace(data) : buildPackedCartonShipmentTrace(data);
            const rows = table.rows;
            if (!rows.length) throw new Error(history ? '此單尚無箱號作業紀錄' : '此單尚無已裝箱內容');
            const xlsx = await import('xlsx');
            if (!alive.current || session !== cartonSessionKey(api, user)) return;
            const workbook = xlsx.utils.book_new();
            xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([table.headers, ...rows]), table.name);
            xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet(table.notes || cartonTraceNotes(data)), '說明');
            xlsx.writeFile(workbook, `${history ? '完整箱號作業紀錄' : '已裝箱對照'}-${String(orderData.order.voucher_number).replace(/[^\w\u4e00-\u9fff-]/g, '_')}.xlsx`);
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
    const showSerialScanner = stage === 'pick' && box?.lines.some(line => line.actualSN.length);
    const allocation = box?.allocations?.find(entry => Number(entry.orderId) === Number(orderId) && entry.status === 'picked');
    const unitLines = box?.lines.filter(line => !line.actualSN.length &&
        (stage === 'pick' ? line.remainingQuantity > 0 : allocation?.lines.some(entry =>
            entry.lineId === line.lineId && (entry.packedQuantity ?? 0) < entry.quantity))) || [];
    const unitTargets = new Map();
    for (const line of unitLines) {
        const candidates = stage === 'pick' ? cartonSplitOrderItems(line, orderData.items, orderData.instances, box)
            .filter(item => item.picked_quantity < item.quantity)
            : orderData.items.filter(item => allocation.lines.some(entry => entry.lineId === line.lineId
                && entry.orderItemId === item.id && (entry.packedQuantity ?? 0) < entry.quantity));
        for (const item of candidates) {
            const barcode = line.ean || line.internalScanCode || item.internal_scan_code;
            if (barcode && barcode === unitValue.trim()) unitTargets.set(item.id, item);
        }
    }
    const scanUnit = () => {
        if (!box || !unitValue.trim() || (unitTargets.size > 1 && !unitItemId)) return;
        const accepted = submit(unitValue.trim(), stage, { mode: 'unit', cartonId: box.cartonId,
            ...(unitItemId ? { orderItemId: Number(unitItemId) } : {}) });
        if (accepted) { setUnitValue(''); setUnitItemId(''); }
    };
    const selectedSerialCount = selections.reduce((count, selection) => count + selection.actualSN.length, 0);
    const returnToScanner = () => {
        clearLookup(); setError(''); setOpen(false);
        requestAnimationFrame(() => onFocusScanner?.());
    };
    return <div className="space-y-3"><section className="rounded-xl border bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold flex items-center gap-2"><Box size={18} />箱號作業</h3><Button size="sm" variant="secondary" disabled={blocked || !stage} onClick={openCartonScanner}>掃箱／拆箱</Button></div>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={reading} onClick={() => { setError(''); setDetailsOpen(true); loadShipments().catch(err => setError(message(err))); }}>箱號明細</Button><Button size="sm" variant="secondary" disabled={reading} onClick={() => exportFile(false)}><FileDown size={14} />匯出對照</Button><Button size="sm" variant="secondary" disabled={reading} onClick={() => exportFile(true)}><FileDown size={14} />匯出異動歷程</Button></div>
        <CartonDialog open={open} title={stage === 'pack' ? '箱號裝箱核對' : '箱號揀貨'} onClose={() => { if (!blocked) returnToScanner(); }} footer={<Button variant="secondary" disabled={blocked || !scanValue.trim() || !!box?.matchedSerials?.length} onClick={() => submit(scanValue.trim(), stage)}>{stage === 'pack' ? '按箱號核對' : '整箱揀貨'}</Button>}>
            <div className="flex gap-2"><input ref={cartonInput} aria-label="箱號" value={scanValue} disabled={blocked} onChange={e => { setScanValue(e.target.value); clearLookup(); }} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (!reading && !blocked) void lookup(); } }} className={field} /><Button variant="secondary" disabled={reading || blocked} onClick={() => lookup()}>查詢</Button></div>
            {box && <p className="mt-3 text-sm font-medium">來源箱號 {box.cartonId}</p>}
            {stage === 'pack' && <p className="mt-2 text-sm">有 SN 的拆箱件，請<button type="button" className="mx-1 text-blue-700 underline" disabled={blocked} onClick={returnToScanner}>回到掃描欄</button>逐件核對。</p>}
            {!!unitLines.length && <div className="mt-3">
                <div className="flex flex-wrap items-end gap-2">
                    <label className="min-w-48 flex-1 text-sm">逐件掃描國條／內部碼
                        <input ref={unitInput} value={unitValue} className={field} disabled={blocked}
                            onChange={event => { setUnitValue(event.target.value); setUnitItemId(''); }}
                            onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); scanUnit(); } }} />
                    </label>
                    <Button disabled={blocked || !unitValue.trim() || (unitTargets.size > 1 && !unitItemId)} onClick={scanUnit}>核對一件</Button>
                </div>
                {unitTargets.size > 1 && <label className="mt-2 block text-sm">理貨單品項
                    <select value={unitItemId} className={field} disabled={blocked}
                        onChange={event => setUnitItemId(event.target.value)}>
                        <option value="">請選擇商品列</option>
                        {[...unitTargets.values()].map(item => <option key={item.id} value={item.id}>{item.product_name} · {item.source_order_number || `列 ${item.id}`}</option>)}
                    </select>
                </label>}
                {stage === 'pack' && <p aria-live="polite" className="mt-1 text-sm">無 SN 已核對 {allocation.lines.filter(line => !line.actualSN.length)
                    .reduce((total, line) => total + (line.packedQuantity ?? 0), 0)}／{allocation.lines.filter(line => !line.actualSN.length)
                    .reduce((total, line) => total + line.quantity, 0)} 件</p>}
            </div>}
            {showSerialScanner && <div className="mt-3">
                <div className="flex flex-wrap items-end gap-2">
                    <label className="min-w-48 flex-1 text-sm">掃描箱內 SN
                        <input ref={splitSerialInput} value={splitSerialValue} className={field} disabled={blocked}
                            onChange={event => setSplitSerialValue(event.target.value)}
                            onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); scanSplitSerial(event.currentTarget.value); } }} />
                    </label>
                    <Button disabled={blocked || !selections.some(selection => Number(selection.quantity) > 0)} onClick={split}>確認拆箱揀貨</Button>
                </div>
                <p aria-live="polite" className="mt-1 text-sm">已選 {selectedSerialCount} 個 SN</p>
            </div>}
            {error && <p role="alert" className="my-3 text-sm text-red-700">{error}</p>}
            {box?.lines.map(line => <SplitLine key={line.lineId} line={line} selections={selections} setSelections={setSelections} items={orderData.items} instances={orderData.instances} carton={box} stage={stage} />)}
        </CartonDialog>
        <CartonDialog open={!!serialReview} title="舊箱貼 SN 核對" onClose={() => { if (!submissionRef.current.isBusy()) { setSerialReview(null); setError(''); } }}
            footer={<Button disabled={blocked || reviewStale || !serialReview?.selectedSerials.length} onClick={confirmSerialReview}>確認{serialReview?.type === 'pack' ? '裝箱' : '揀貨'}（{serialReview?.selectedSerials.length ?? 0}）</Button>}>
            {serialReview && <>
                <p className="mb-3 text-sm">這張箱貼查不到已登記的箱號。</p>
                {serialReview.candidates.length
                    ? <p className="mb-3 text-sm">請勾選這次實際{serialReview.type === 'pack' ? '裝箱' : '揀貨'}的 SN。符合本單 {serialReview.candidates.length} 個，已排除 {serialReview.excluded} 個。</p>
                    : <p role="alert" className="mb-3 text-sm text-red-700">這張箱貼沒有符合本單目前作業狀態的 SN，已排除 {serialReview.excluded} 個。</p>}
                {reviewStale && <p role="alert" className="mb-3 text-sm text-red-700">訂單或登入狀態已變更，請關閉後重新核對。</p>}
                {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
                <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">{serialReview.candidates.map(({ serial, productName }) => (
                    <label key={serial} className="flex items-start gap-2 break-all rounded-lg border p-2 text-sm">
                        <input type="checkbox" className="mt-1" disabled={blocked || reviewStale} checked={serialReview.selectedSerials.includes(serial)}
                            onChange={event => {
                                const checked = event.target.checked;
                                setSerialReview(review => review && ({ ...review, selectedSerials: checked
                                    ? [...review.selectedSerials, serial] : review.selectedSerials.filter(value => value !== serial) }));
                            }} />
                        <span>{serial}{productName && <span className="block text-xs text-slate-600">{productName}</span>}</span>
                    </label>
                ))}</div>
            </>}
        </CartonDialog>
        <CartonDialog open={detailsOpen} title="出貨箱號明細" onClose={() => setDetailsOpen(false)} footer={<><Button variant="secondary" onClick={() => exportFile(false)}>已裝箱對照</Button><Button variant="secondary" onClick={() => exportFile(true)}>完整作業紀錄</Button></>}>
            {error && <p role="alert" className="text-red-700 mb-3">{error}</p>}
            {shipments?.referenceWarning && <p role="alert" className="mb-3 text-sm text-amber-800">{shipments.referenceWarning}</p>}
            {(shipments?.allocations || []).map(a => <div key={a.allocationId || a.id} className="mb-3 rounded-lg border p-3"><div className="flex flex-wrap justify-between gap-2"><strong>{a.cartonId}</strong><span className="text-sm">{a.status === 'packed' ? '裝箱核對完成' : a.status === 'released' ? '已解除' : '已揀貨'}</span></div>{a.lines.map(l => <p key={`${l.lineId}:${l.orderItemId}`} className="text-sm mt-1">{l.itemCode} × {l.quantity}{l.actualSN?.length ? ` · ${l.actualSN.join('、')}` : ''}</p>)}{isWarehouseAdmin(user) && a.status === 'picked' && <button type="button" className="mt-2 text-sm text-red-700 underline" onClick={() => { setRelease(a); setReason(''); }}>解除分配</button>}</div>)}
            {shipments && !shipments.allocations?.length && <p className="text-sm text-slate-500">尚無箱號作業紀錄</p>}
        </CartonDialog>
        <CartonDialog open={!!release} title="解除箱號分配" onClose={() => !blocked && setRelease(null)} footer={<Button disabled={!reason.trim() || blocked} onClick={releaseAllocation}>確認解除</Button>}>
            <p className="mb-3">{release?.cartonId}</p><label className="text-sm">原因<input autoFocus className={field} value={reason} onChange={e => setReason(e.target.value)} /></label>{error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
        </CartonDialog>
    </section><EcountReferenceCard orderData={orderData} user={user} refreshKey={shipments} referenceWarning={shipments?.referenceWarning} /></div>;
});
