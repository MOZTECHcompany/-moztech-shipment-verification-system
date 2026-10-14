import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeWriter, BarcodeFormat } from '@zxing/library';
import { Box, Plus, Printer, Upload } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/api/api';
import { Button } from '@/ui';
import { parseSerialInput, cartonSessionKey } from '@/utils/cartonScan';
import { appendCartonSerial, blankCartonLine, canManageCartons, cartonLabelSize, editorLinePayload, pendingBoxCreationKey, pendingCartonEditorKey } from '@/utils/cartonEditor';
import { CartonDialog } from './CartonDialog';
import { CartonItemEditor, cartonFieldClass as field } from './CartonItemEditor';

const newId = kind => `${kind === 'spec' ? 'BSP' : 'CTN'}-${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date()).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8)}`;
const errText = error => error.response?.data?.message || error.message || '操作失敗';
const unknown = error => !error.response || error.response.status >= 500;
const endpoint = kind => kind === 'spec' ? '/api/box-specs' : '/api/cartons';
const idOf = (record, kind) => kind === 'spec' ? record.specId : record.cartonId;
const editLines = record => record.lines.map(line => ({ ...line, editorLineId: crypto.randomUUID(), hasSerials: !!line.actualSN?.length, serialInput: (line.actualSN || []).join('\n') }));
const sourceOf = carton => { try { return carton.sourceSystem === 'corely-box-spec' ? JSON.parse(carton.sourceReference || '{}') : null; } catch { return null; } };
const unwrap = (data, kind, id) => { const record = data.carton || data; if (idOf(record, kind) !== id || !Array.isArray(record.lines) || !Number.isSafeInteger(record.contentRevision)) throw new Error('儲存回應不完整，請核對相同箱號的結果。'); return record; };

function QrLabel({ carton, size }) {
    const matrix = new QRCodeWriter().encode(`CARTON:${carton.cartonId}`, BarcodeFormat.QR_CODE, 0, 0, null);
    let path = '';
    for (let y = 0; y < matrix.getHeight(); y++) for (let x = 0; x < matrix.getWidth(); x++) if (matrix.get(x, y)) path += `M${x},${y}h1v1h-1z`;
    const source = sourceOf(carton), quantity = carton.lines.reduce((sum, line) => sum + line.quantity, 0);
    return <div data-carton-label className="mx-auto border border-slate-200 bg-white text-black" style={{ width: `${size.width}mm`, minHeight: `${size.height}mm`, padding: '2mm', boxSizing: 'border-box', fontSize: '8pt', lineHeight: 1.15 }}>
        <div style={{ fontWeight: 700 }}>實體箱 · {quantity} 入{source?.batchNumber ? ` · 第 ${source.batchNumber} 箱` : ''}</div><div style={{ overflowWrap: 'anywhere', fontFamily: 'monospace', fontWeight: 700 }}>{carton.cartonId}</div>
        <svg aria-label={`箱號 QR Code ${carton.cartonId}`} viewBox={`0 0 ${matrix.getWidth()} ${matrix.getHeight()}`} style={{ display: 'block', width: `${size.qr}mm`, height: `${size.qr}mm`, margin: '1mm auto' }} shapeRendering="crispEdges"><rect width="100%" height="100%" fill="white" /><path d={path} fill="black" /></svg>
        {carton.lines.slice(0, 2).map((line, index) => <div key={line.lineId || index} style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{line.productName || line.itemCode} × {line.quantity}</div>)}{carton.lines.length > 2 && <div>共 {carton.lines.length} 個品項</div>}
        {source?.specId && <div style={{ fontSize: '6pt', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>箱規 {source.specId} · v{source.contentRevision}</div>}
    </div>;
}

function QuantityCell({ record, template }) {
    const quantity = record.lines?.reduce((sum, line) => sum + line.quantity, 0) ?? record.quantity;
    const remaining = record.lines?.reduce((sum, line) => sum + line.remainingQuantity, 0) ?? record.remainingQuantity;
    if (template) return <span>{quantity ?? '—'}</span>;
    return <span className="inline-flex items-baseline gap-1 tabular-nums"><strong className={`text-lg ${remaining > 0 && remaining < quantity ? 'text-amber-700' : remaining > 0 ? 'text-emerald-700' : 'text-slate-500'}`}>{remaining ?? '—'}</strong><span className="text-xs text-slate-500">／{quantity ?? '—'}</span></span>;
}

function SerialLookup({ user, onOpen }) {
    const [query, setQuery] = useState(''), [match, setMatch] = useState('exact'), [result, setResult] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
    const request = useRef(0), alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; request.current++; }; }, []);
    const search = async event => {
        event.preventDefault(); if (!query.trim()) return;
        const id = ++request.current, session = cartonSessionKey(api, user), current = () => alive.current && id === request.current && session === cartonSessionKey(api, user);
        setLoading(true); setError(''); setResult(null);
        try { const { data } = await api.get('/api/cartons/serials', { params: { q: query.trim(), match, limit: 30 }, timeout: 10000 }); if (current()) setResult(data); }
        catch (error) { if (current()) setError(errText(error)); }
        finally { if (current()) setLoading(false); }
    };
    return <section className="space-y-4"><form onSubmit={search} className="flex flex-wrap items-end gap-3"><label className="min-w-48 flex-1 text-sm">SN 查詢<input aria-label="SN 查詢" placeholder="掃描或輸入實際 SN" value={query} onChange={event => { request.current++; setLoading(false); setResult(null); setQuery(event.target.value); }} className={`${field} mt-1`} maxLength={100} /></label><label className="text-sm">查詢方式<select aria-label="SN 查詢方式" value={match} onChange={event => { request.current++; setLoading(false); setResult(null); setMatch(event.target.value); }} className={`${field} mt-1`}><option value="exact">完整 SN</option><option value="contains">包含文字</option></select></label><Button type="submit" disabled={loading || !query.trim()}>查詢</Button></form>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{loading && <p role="status" className="text-sm text-slate-500">查詢中…</p>}{result && !result.items?.length && <p className="rounded-xl border bg-white p-4 text-sm text-slate-600">找不到已登錄的 SN。</p>}
        {!!result?.items?.length && <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-3">實際 SN</th><th>商品</th><th>實體箱</th><th>狀態</th></tr></thead><tbody>{result.items.map(item => <tr key={`${item.cartonId}:${item.serialNumber}`} className="border-t"><td className="p-3 font-mono break-all">{item.serialNumber}</td><td className="p-3">{item.productName || item.itemCode}</td><td className="p-3"><button type="button" className="break-all text-blue-700 underline" onClick={() => onOpen(item.cartonId, 'physical')}>{item.cartonId}</button></td><td className="p-3 whitespace-nowrap">{item.readyForPicking ? '箱內可用' : item.available ? '待確認' : '已分配'}</td></tr>)}</tbody></table></div>}{result?.hasMore && <p className="text-sm text-slate-500">目前顯示前 30 筆，請縮小查詢範圍。</p>}
    </section>;
}

export function CartonsPage({ user }) {
    const canManage = canManageCartons(user);
    const [tab, setTab] = useState('physical'), [query, setQuery] = useState(''), [records, setRecords] = useState([]), [detail, setDetail] = useState(null);
    const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [editor, setEditor] = useState(null), [lines, setLines] = useState([blankCartonLine()]), [review, setReview] = useState(false), [labels, setLabels] = useState(null);
    const [width, setWidth] = useState('60'), [height, setHeight] = useState('75'), [labelIndex, setLabelIndex] = useState(0), [reopenReason, setReopenReason] = useState(null), [boxCount, setBoxCount] = useState('1');
    const [prefix, setPrefix] = useState('N'), [startNumber, setStartNumber] = useState(''), [numberLoading, setNumberLoading] = useState(false);
    const prefixRequest = useRef(0), startTouched = useRef(false);
    const importRef = useRef(null), mutationRef = useRef(false), listRequest = useRef(0), detailRequest = useRef(0), editorRef = useRef(null), linesRef = useRef(lines), creationRef = useRef(null), alive = useRef(true);
    linesRef.current = lines;
    const updateLines = update => { const next = typeof update === 'function' ? update(linesRef.current) : update; linesRef.current = next; setLines(next); };
    const updateEditor = next => { editorRef.current = next; setEditor(next); };
    const persistEditorRecovery = current => {
        try { sessionStorage.setItem(pendingCartonEditorKey(user.id), JSON.stringify({ editor: { ...current, unknown: true }, lines: linesRef.current })); }
        catch { throw new Error('此瀏覽器無法保存建箱追蹤，請確認瀏覽器儲存設定後重試。'); }
    };
    const uncertainEditor = current => {
        const next = { ...current, unknown: true };
        if (alive.current) updateEditor(next);
        try { persistEditorRecovery(next); } catch { /* Keep the same ID in this tab when storage is unavailable. */ }
    };
    const clearEditorRecovery = () => { try { sessionStorage.removeItem(pendingCartonEditorKey(user.id)); } catch { /* The current tab has already confirmed the result. */ } };
    useEffect(() => { alive.current = true; return () => { alive.current = false; listRequest.current++; detailRequest.current++; prefixRequest.current++; }; }, []);
    useEffect(() => {
        if (!canManage) return;
        try {
            const cached = JSON.parse(sessionStorage.getItem(pendingCartonEditorKey(user.id)) || 'null');
            if (cached?.editor?.unknown && ['spec','physical'].includes(cached.editor.kind) && Array.isArray(cached.lines)) { updateEditor(cached.editor); updateLines(cached.lines); setReview(true); setError('上一筆儲存結果待確認，請核對相同編號。'); }
        } catch { /* Invalid temporary state does not create an order or carton. */ }
    }, [user.id, canManage]);
    useEffect(() => {
        if (detail?.kind !== 'spec' || detail.record.status !== 'active' || creationRef.current) return;
        const id = ++prefixRequest.current, session = cartonSessionKey(api, user), value = prefix.trim();
        const current = () => alive.current && id === prefixRequest.current && session === cartonSessionKey(api, user);
        if (!value) { setNumberLoading(false); return; }
        setNumberLoading(true);
        api.get('/api/box-specs/next-number', { params: { prefix: value }, timeout: 10000 }).then(({data}) => {
            if (current() && !startTouched.current && Number.isSafeInteger(data.nextNumber) && data.nextNumber > 0) setStartNumber(String(data.nextNumber));
        }).catch(error => { if (current()) setError(errText(error)); }).finally(() => { if (current()) setNumberLoading(false); });
        return () => { prefixRequest.current++; };
    }, [detail?.kind, detail?.record.specId, detail?.record.status, prefix, user]);
    const load = useCallback(async () => {
        if (tab === 'serials') return;
        const id = ++listRequest.current, session = cartonSessionKey(api, user), current = () => alive.current && id === listRequest.current && session === cartonSessionKey(api, user);
        setLoading(true); setError('');
        try { const { data } = await api.get(endpoint(tab), { params: { q: query.trim().replace(/^BOX-SPEC:/i, ''), limit: 100 }, timeout: 10000 }); if (current()) setRecords(data.cartons || data.items || []); }
        catch (error) { if (current()) setError(errText(error)); }
        finally { if (current()) setLoading(false); }
    }, [query, tab, user]);
    useEffect(() => { setRecords([]); const timeout = setTimeout(load, 200); return () => { clearTimeout(timeout); listRequest.current++; }; }, [load]);
    const mutate = async action => {
        if (mutationRef.current) return false;
        mutationRef.current = true; setBusy(true); setError('');
        const session = cartonSessionKey(api, user), ensureCurrent = () => { if (!alive.current || session !== cartonSessionKey(api, user)) throw new Error('登入已更新，請重新載入核對'); };
        try { await action(ensureCurrent); ensureCurrent(); await load(); return true; }
        catch (error) { if (alive.current) setError(errText(error)); return false; }
        finally { mutationRef.current = false; if (alive.current) setBusy(false); }
    };
    const open = async (id, kind = tab) => {
        const request = ++detailRequest.current, session = cartonSessionKey(api, user);
        try { const { data } = await api.get(`${endpoint(kind)}/${encodeURIComponent(id)}`); if (alive.current && request === detailRequest.current && session === cartonSessionKey(api, user)) {
            let pending = null; try { pending = kind === 'spec' ? JSON.parse(sessionStorage.getItem(pendingBoxCreationKey(user.id, id)) || 'null') : null; } catch { /* No pending creation in this tab. */ }
            if (pending?.id !== id || pending?.body?.expectedActorId !== user.id || !pending?.body?.creationId) pending = null;
            creationRef.current = pending; startTouched.current = !!pending; setDetail({ kind, record: data.carton || data }); setBoxCount(String(pending?.body.count || 1)); setPrefix(pending?.body.prefix || 'N'); setStartNumber(pending ? String(pending.body.startNumber) : '');
        } }
        catch (error) { if (alive.current && request === detailRequest.current) setError(errText(error)); }
    };
    const edit = (record, kind = 'physical') => {
        const nextLines = record ? editLines(record) : [blankCartonLine()];
        updateEditor({ kind, id: record ? idOf(record, kind) : newId(kind), editing: !!record, expectedContentRevision: record?.contentRevision, reason: '', savedRecord: record || null, savedKey: record ? JSON.stringify(editorLinePayload(nextLines, kind)) : null });
        updateLines(nextLines); setReview(false); setError(''); setLabels(null);
    };
    const closeEditor = () => { if (!busy && !editorRef.current?.unknown) { updateEditor(null); setReview(false); } else if (editorRef.current?.unknown) toast.info('請先核對儲存結果，箱號已保留。'); };
    const showLabels = cartons => { if (!cartons.length || cartons.some(carton => carton.status !== 'sealed')) throw new Error('箱內內容尚未確認，不能列印實體箱 QR。'); setLabels(cartons); setLabelIndex(0); };
    const verifySaved = () => mutate(async ensureCurrent => {
        const current = editorRef.current;
        try {
            const { data } = await api.get(`${endpoint(current.kind)}/${encodeURIComponent(current.id)}`); ensureCurrent();
            const record = unwrap(data, current.kind, current.id), key = JSON.stringify(editorLinePayload(editLines(record), current.kind));
            if (key !== JSON.stringify(editorLinePayload(linesRef.current, current.kind))) throw new Error('此編號已有不同內容，請關閉並開啟原紀錄核對。');
            updateEditor({ ...current, editing: true, unknown: false, savedRecord: record, savedKey: key, expectedContentRevision: record.contentRevision }); clearEditorRecovery(); toast.success('儲存結果已確認，箱號沒有重複建立');
        } catch (error) { if (error.response?.status === 404 && !current.editing) { ensureCurrent(); updateEditor({ ...current, unknown: false }); clearEditorRecovery(); toast.info('此箱尚未建立，可使用相同編號重試。'); } else throw error; }
    });
    const save = confirm => mutate(async ensureCurrent => {
        let current = editorRef.current;
        if (!current || current.unknown) throw new Error('請先核對上一筆儲存結果。');
        const payload = editorLinePayload(linesRef.current, current.kind), key = JSON.stringify(payload);
        let record = current.savedRecord;
        if (!record || key !== current.savedKey) {
            if (current.kind === 'spec' && current.editing && !current.reason?.trim()) throw new Error('請填寫修改箱規的原因。');
            const body = { lines: payload, expectedActorId: user.id, ...(current.editing ? { expectedContentRevision: current.expectedContentRevision, ...(current.kind === 'spec' ? { reason: current.reason.trim() } : {}) } : { [current.kind === 'spec' ? 'specId' : 'cartonId']: current.id }) };
            ensureCurrent(); persistEditorRecovery(current);
            try {
                const { data } = current.editing ? await api.patch(`${endpoint(current.kind)}/${encodeURIComponent(current.id)}`, body) : await api.post(endpoint(current.kind), body); ensureCurrent();
                record = unwrap(data, current.kind, current.id); current = { ...current, editing: true, savedRecord: record, savedKey: key, expectedContentRevision: record.contentRevision }; updateEditor(current);
            } catch (error) { if (unknown(error)) uncertainEditor(current); else clearEditorRecovery(); throw error; }
        }
        if (confirm && record.status !== (current.kind === 'spec' ? 'active' : 'sealed')) {
            ensureCurrent(); persistEditorRecovery(current);
            try { const { data } = await api.post(`${endpoint(current.kind)}/${encodeURIComponent(current.id)}/${current.kind === 'spec' ? 'activate' : 'seal'}`, { expectedContentRevision: record.contentRevision, expectedActorId: user.id }); ensureCurrent(); record = unwrap(data, current.kind, current.id); updateEditor({ ...current, savedRecord: record }); }
            catch (error) { if (unknown(error)) uncertainEditor(current); else clearEditorRecovery(); throw error; }
        }
        ensureCurrent(); clearEditorRecovery(); creationRef.current = null; startTouched.current = false; setStartNumber(''); setDetail({ kind: current.kind, record }); updateEditor(null); setReview(false); if (confirm && current.kind === 'physical') showLabels([record]);
        toast.success(confirm ? current.kind === 'spec' ? '箱規已啟用，可建立實體箱' : '實體箱已確認，請列印 QR' : '草稿已儲存');
    });
    const reviewContent = () => { try { editorLinePayload(linesRef.current, editor.kind); setError(''); setReview(true); } catch (error) { setError(error.message); } };
    const importFile = event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; void mutate(async ensureCurrent => { if (file.size > 2 * 1024 * 1024) throw new Error('箱號檔案不可超過 2 MB'); const body = JSON.parse(await file.text()); if (body.format !== 'corely-cartons-v1' || !Array.isArray(body.cartons)) throw new Error('請選擇 ERP 匯出的箱號檔案'); ensureCurrent(); await api.post('/api/cartons/import', { ...body, expectedActorId: user.id }); ensureCurrent(); toast.success(`已匯入 ${body.cartons.length} 箱`); }); };
    const sealDetail = () => mutate(async ensureCurrent => { const { kind, record } = detail; ensureCurrent(); const { data } = await api.post(`${endpoint(kind)}/${encodeURIComponent(idOf(record, kind))}/${kind === 'spec' ? 'activate' : 'seal'}`, { expectedContentRevision: record.contentRevision, expectedActorId: user.id }); ensureCurrent(); const saved = unwrap(data, kind, idOf(record, kind)); setDetail({ kind, record: saved }); if (kind === 'physical') showLabels([saved]); });
    const reopen = () => mutate(async ensureCurrent => { const { record } = detail; if (!reopenReason?.trim()) throw new Error('請填寫重新編輯原因。'); ensureCurrent(); const { data } = await api.post(`/api/cartons/${encodeURIComponent(record.cartonId)}/reopen`, { reason: reopenReason.trim(), expectedContentRevision: record.contentRevision, expectedStateRevision: record.stateRevision, expectedActorId: user.id }); ensureCurrent(); setReopenReason(null); edit(unwrap(data, 'physical', record.cartonId), 'physical'); });
    const createFromSpec = () => mutate(async ensureCurrent => {
        const { record } = detail, count = Number(boxCount), start = Number(startNumber);
        if (!Number.isSafeInteger(count) || count < 1 || count > 100) throw new Error('每次可建立 1 至 100 箱。');
        if (!/^[A-Z][A-Z0-9_-]{0,24}$/.test(prefix.trim()) || !Number.isSafeInteger(start) || start < 1 || start + count - 1 > 9999999) throw new Error('請填大寫英文箱號前綴，整批號碼必須介於 1–9999999。');
        if (!creationRef.current) {
            creationRef.current = { id: record.specId, quantityPerBox: record.lines.reduce((sum,line)=>sum+line.quantity,0), body: { prefix: prefix.trim(), startNumber: start, count, creationId: crypto.randomUUID(), expectedContentRevision: record.contentRevision, expectedActorId: user.id } };
            try { sessionStorage.setItem(pendingBoxCreationKey(user.id, record.specId), JSON.stringify(creationRef.current)); } catch { throw new Error('此瀏覽器無法保存建箱追蹤，請確認瀏覽器儲存設定後重試。'); }
        }
        const request = creationRef.current;
        try { ensureCurrent(); const { data } = await api.post(`/api/box-specs/${encodeURIComponent(request.id)}/cartons`, request.body, { timeout: 15000 }); ensureCurrent();
            const expected = Array.from({length:request.body.count},(_,i)=>`${request.body.prefix}${request.body.startNumber+i}`);
            if (!Array.isArray(data.cartons) || data.cartons.length !== expected.length || new Set(data.cartons.map(carton => carton.cartonId)).size !== expected.length || expected.some(id=>!data.cartons.some(carton=>carton.cartonId===id))) throw new Error('建箱結果不完整，請重新確認同一筆建箱結果。');
            showLabels(expected.map(id=>data.cartons.find(carton=>carton.cartonId===id))); sessionStorage.removeItem(pendingBoxCreationKey(user.id, request.id)); creationRef.current = null; toast.success(`已建立 ${data.cartons.length} 個獨立箱號`); }
        catch (error) { if (!unknown(error)) { sessionStorage.removeItem(pendingBoxCreationKey(user.id, request.id)); creationRef.current = null; } throw error; }
    });
    const print = () => {
        let size; try { size = cartonLabelSize(width, height); } catch (error) { setError(error.message); return; }
        const markup = [...document.querySelectorAll('[data-carton-label]')].map(node => node.outerHTML).join(''), win = markup && window.open('', '_blank'); if (!win) { toast.error('請允許列印視窗'); return; }
        win.document.open(); win.document.write(`<html><head><title>實體箱 QR 貼紙</title><style>@page{size:${size.width}mm ${size.height}mm;margin:0}body{margin:0;font-family:sans-serif}[data-carton-label]{width:${size.width}mm!important;height:${size.height}mm;min-height:0!important;margin:0!important;border:0!important;box-sizing:border-box;break-after:page;page-break-after:always}[data-carton-label]:last-child{break-after:auto;page-break-after:auto}</style></head><body>${markup}</body></html>`); win.document.close(); win.focus(); win.print();
    };
    let labelSize; try { labelSize = cartonLabelSize(width, height); } catch { labelSize = cartonLabelSize(60, 75); }
    const record = detail?.record;
    const displayedRecords = tab === 'physical' ? [...records].sort((a, b) => String(a.cartonId).localeCompare(String(b.cartonId), 'zh-TW', { numeric: true })) : records;
    return <section className="space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-xl font-semibold flex items-center gap-2"><Box size={22} />箱號管理</h1>{canManage && <div className="flex flex-wrap gap-2">{tab === 'physical' && <><Button variant="secondary" onClick={() => importRef.current.click()} disabled={busy}><Upload size={16} />匯入箱號</Button><Button onClick={() => edit(null, 'physical')} disabled={busy}><Plus size={16} />新增箱號</Button></>}{tab === 'spec' && <Button onClick={() => edit(null, 'spec')} disabled={busy}><Plus size={16} />新增箱規</Button>}<input ref={importRef} type="file" accept=".json,application/json" onChange={importFile} className="hidden" aria-label="匯入箱號檔案" /></div>}</header>
        <div role="tablist" aria-label="箱號管理分類" className="flex flex-wrap gap-2">{[['spec','箱規'],['physical','實體箱／SN'],['serials','SN查詢']].map(([value, text]) => <button key={value} type="button" role="tab" aria-selected={tab === value} disabled={busy} onClick={() => { listRequest.current++; setTab(value); setQuery(''); setError(''); }} className={`min-h-11 rounded-lg px-4 text-sm font-semibold ${tab === value ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}>{text}</button>)}</div>
        {tab !== 'serials' && <input aria-label={tab === 'spec' ? '搜尋箱規或品號' : '搜尋箱號或品號'} placeholder={tab === 'spec' ? '搜尋箱規或品號' : '搜尋箱號或品號'} value={query} onChange={event => setQuery(event.target.value)} className={`${field} max-w-sm`} />}
        {error && !editor && !labels && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {tab === 'serials' ? <SerialLookup user={user} onOpen={open} /> : <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-3">{tab === 'spec' ? '箱規' : '實體箱號'}</th><th>狀態</th><th>品項</th><th>{tab === 'spec' ? '每箱件數' : '剩餘／總件數'}</th></tr></thead><tbody>{displayedRecords.map(item => <tr key={idOf(item, tab)} className="border-t"><td className="p-3"><button type="button" className="text-blue-700 underline break-all" onClick={() => open(idOf(item, tab), tab)}>{idOf(item, tab)}</button></td><td className="whitespace-nowrap">{item.status === 'active' ? '已啟用' : item.status === 'sealed' ? '已確認' : '草稿'}</td><td className="p-3">{item.lines?.length ?? item.lineCount ?? '—'}</td><td className="p-3 whitespace-nowrap"><QuantityCell record={item} template={tab === 'spec'} /></td></tr>)}</tbody></table>{loading && <p role="status" className="p-4">載入中…</p>}{!loading && !records.length && <p className="p-6 text-sm text-slate-500">尚無符合的{tab === 'spec' ? '箱規' : '實體箱號'}</p>}</div>}
        <CartonDialog open={!!editor} title={editor?.kind === 'spec' ? editor.editing ? '編輯箱規' : '新增箱規' : editor?.editing ? '編輯箱內內容' : '新增箱號'} onClose={closeEditor} footer={<><Button type="button" variant="secondary" disabled={busy} onClick={closeEditor}>取消</Button>{editor?.unknown ? <Button disabled={busy} onClick={verifySaved}>核對儲存結果</Button> : review ? <><Button type="button" variant="secondary" disabled={busy} onClick={() => setReview(false)}>返回修改</Button><Button type="button" disabled={busy} onClick={() => save(true)}>{editor?.kind === 'spec' ? '確認箱規並啟用' : '確認建箱並列印'}</Button></> : <><Button type="button" variant="secondary" disabled={busy} onClick={() => save(false)}>儲存草稿</Button><Button type="button" disabled={busy} onClick={reviewContent}>確認內容</Button></>}</>}>
            {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <div className="mb-4 flex flex-wrap gap-2 text-xs font-semibold"><span className="rounded-full bg-blue-50 px-3 py-2 text-blue-700">1 選商品</span><span className="rounded-full bg-blue-50 px-3 py-2 text-blue-700">2 箱內內容</span><span className={`rounded-full px-3 py-2 ${review ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}>3 確認與列印</span></div>
            <div className="mb-4 rounded-lg bg-slate-50 px-3 py-2"><span className="text-xs text-slate-500">{editor?.kind === 'spec' ? '箱規編號' : '實體箱號'} · 自動產生</span><p className="break-all font-mono text-xs text-slate-700">{editor?.id}</p></div>
            {editor?.kind === 'spec' && <p className="mb-4 text-sm text-slate-600">箱規記錄每箱內容，建箱後每個實體箱各有自己的 QR。</p>}
            {editor?.kind === 'spec' && editor.editing && <label className="mb-4 block text-sm">修改原因<input aria-label="修改原因" value={editor.reason || ''} disabled={busy} onChange={event => updateEditor({ ...editorRef.current, reason: event.target.value })} className={`${field} mt-1`} /></label>}
            {review ? <section aria-label="確認箱內內容" className="space-y-3">{lines.map(line => <div key={line.editorLineId} className="rounded-xl border p-4"><p className="font-semibold">{line.productName || line.itemCode}</p><p className="mt-1 break-all text-xs text-slate-500">品號 {line.itemCode}</p><p className="mt-2 text-sm">每箱 {line.quantity} 件{line.hasSerials ? ` · 實際 SN ${parseSerialInput(line.serialInput).length} 個` : ' · 無 SN'}</p>{line.ean && <p className="mt-1 break-all text-xs">國際條碼 {line.ean}</p>}{line.internalScanCode && <p className="mt-1 break-all text-xs">內部掃描碼 {line.internalScanCode}</p>}{line.hasSerials && <details className="mt-2 text-sm"><summary>核對 SN</summary><ul className="mt-2 max-h-36 overflow-y-auto font-mono text-xs">{parseSerialInput(line.serialInput).map((sn, i) => <li key={i} className="break-all py-1">{sn}</li>)}</ul></details>}</div>)}<p className="text-sm font-semibold">合計每箱 {lines.reduce((sum, line) => sum + Number(line.quantity), 0)} 件</p></section> : <div className="space-y-4">{lines.map((line, index) => <CartonItemEditor key={line.editorLineId} user={user} line={line} index={index} template={editor?.kind === 'spec'} disabled={busy || !!editor?.unknown} focus={index === 0} onChange={patch => updateLines(old => old.map((item, i) => i === index ? { ...item, ...patch } : item))} onSelect={item => updateLines(old => old.map((line, i) => i === index ? { ...line, itemCode: item.itemCode, productName: item.productName || '', importedBarcode: item.importedBarcode || null, ean: '', internalScanCode: '' } : line))} onScan={raw => updateLines(appendCartonSerial(linesRef.current, index, raw))} onRemove={lines.length > 1 ? () => updateLines(old => old.filter((_, i) => i !== index)) : undefined} />)}<Button type="button" variant="secondary" disabled={busy || !!editor?.unknown} onClick={() => updateLines(old => [...old, blankCartonLine()])}><Plus size={16} />新增品項</Button></div>}
        </CartonDialog>
        <CartonDialog open={!!detail && !editor && !labels && reopenReason === null} title={record ? idOf(record, detail.kind) : '箱號明細'} onClose={() => { if (!busy) { detailRequest.current++; setDetail(null); } }} footer={<>{canManage && record?.status === 'draft' && <><Button variant="secondary" disabled={busy} onClick={() => edit(record, detail.kind)}>編輯</Button><Button disabled={busy} onClick={sealDetail}>{detail.kind === 'spec' ? '啟用箱規' : '確認箱內內容'}</Button></>}{canManage && detail?.kind === 'spec' && record?.status === 'active' && <Button variant="secondary" disabled={busy || !!creationRef.current} onClick={() => edit(record, 'spec')}>編輯箱規</Button>}{canManage && detail?.kind === 'physical' && record?.status === 'sealed' && !record?.allocations?.length && <Button variant="secondary" disabled={busy} onClick={() => setReopenReason('')}>重新編輯</Button>}{detail?.kind === 'physical' && <Button variant="secondary" disabled={busy || record?.status !== 'sealed'} onClick={() => showLabels([record])}><Printer size={16} />列印貼紙</Button>}</>}>
            {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
            {(record?.lines || []).map((line, index) => <div key={line.lineId || index} className="mb-3 rounded-lg border p-3"><strong>{line.productName || line.itemCode}</strong><p className="mt-1 text-sm">品號 {line.itemCode} · {detail?.kind === 'spec' ? `每箱 ${line.quantity} 件` : `剩餘 ${line.remainingQuantity}／${line.quantity} 件`}</p>{line.ean && <p className="text-xs break-all">國際條碼 {line.ean}</p>}{line.internalScanCode && <p className="text-xs break-all">內部碼 {line.internalScanCode}</p>}{!!line.actualSN?.length && <details className="mt-2 text-sm"><summary>箱內 SN（共 {line.actualSN.length} 個，可用 {line.remainingSN?.length || 0} 個）</summary><ul className="mt-2 space-y-1">{line.actualSN.map(sn => <li key={sn} className="flex items-start justify-between gap-3"><span className="min-w-0 break-all font-mono text-xs">{sn}</span><span className="shrink-0 text-xs text-slate-500">{line.remainingSN?.includes(sn) ? '可用' : '已分配'}</span></li>)}</ul></details>}</div>)}
            {canManage && detail?.kind === 'spec' && record?.status === 'active' && <section className="my-4 rounded-xl border border-blue-200 bg-blue-50 p-4"><h3 className="font-semibold">依箱規建立實體箱</h3><p className="mt-1 text-xs text-slate-600">每個箱號各有自己的 QR 與剩餘件數。</p><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3"><label className="text-sm">箱號前綴<input aria-label="箱號前綴" maxLength={25} value={prefix} disabled={busy || !!creationRef.current} onChange={event => { prefixRequest.current++; startTouched.current = false; setStartNumber(''); setPrefix(event.target.value); }} className={`${field} mt-1`} /></label><label className="text-sm">起始號碼<input aria-label="起始號碼" type="number" min="1" max="9999999" value={startNumber} disabled={busy || !!creationRef.current} onChange={event => { startTouched.current = true; setStartNumber(event.target.value); }} className={`${field} mt-1`} /></label><label className="text-sm">建立箱數<input aria-label="建立箱數" type="number" min="1" max="100" value={boxCount} disabled={busy || !!creationRef.current} onChange={event => setBoxCount(event.target.value)} className={`${field} mt-1`} /></label></div>{Number(startNumber) > 0 && Number(boxCount) > 0 && <p aria-live="polite" className="mt-3 text-sm font-semibold">{prefix}{startNumber}～{prefix}{Number(startNumber) + Number(boxCount) - 1} · 每箱 {creationRef.current?.quantityPerBox || record.lines.reduce((sum,line)=>sum+line.quantity,0)} 件 · 共 {(creationRef.current?.quantityPerBox || record.lines.reduce((sum,line)=>sum+line.quantity,0)) * Number(boxCount)} 件</p>}<Button className="mt-3" disabled={busy || !startNumber || (numberLoading && !startTouched.current)} onClick={createFromSpec}>{creationRef.current ? '重新確認建箱結果' : '建立實體箱並列印'}</Button></section>}
            {!!record?.history?.length && <details className="text-sm"><summary>異動紀錄</summary>{record.history.map((history, index) => <p key={history.id || index} className="mt-2">{({ created:'建立', sealed:'確認箱內內容', contents_revised:'修改內容', contents_reopened:'重新編輯', activated:'啟用', picked:'揀貨', packed:'裝箱', released:'解除分配' })[history.event_type] || history.event_type || history.action} · {new Date(history.createdAt || history.created_at).toLocaleString('zh-TW', { timeZone:'Asia/Taipei' })}</p>)}</details>}
        </CartonDialog>
        <CartonDialog open={reopenReason !== null} title="重新編輯箱內內容" onClose={() => { if (!busy) setReopenReason(null); }} footer={<><Button variant="secondary" disabled={busy} onClick={() => setReopenReason(null)}>取消</Button><Button disabled={busy || !reopenReason?.trim()} onClick={reopen}>重新編輯</Button></>}><label className="text-sm">重新編輯原因<input aria-label="重新編輯原因" data-carton-autofocus value={reopenReason || ''} onChange={event => setReopenReason(event.target.value)} maxLength={2000} className={`${field} mt-1`} /></label>{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}</CartonDialog>
        <CartonDialog open={!!labels} title="箱號貼紙" onClose={() => setLabels(null)} footer={<Button disabled={busy} onClick={print}><Printer size={16} />{labels?.length > 1 ? `列印 ${labels.length} 張` : '列印'}</Button>}>
            {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
            <div className="mb-4 flex flex-wrap gap-3"><label className="text-sm">貼紙寬度（mm）<input aria-label="貼紙寬度（mm）" type="number" min="30" max="150" value={width} onChange={event => setWidth(event.target.value)} className={`${field} mt-1 max-w-28`} /></label><label className="text-sm">貼紙高度（mm）<input aria-label="貼紙高度（mm）" type="number" min="40" max="200" value={height} onChange={event => setHeight(event.target.value)} className={`${field} mt-1 max-w-28`} /></label></div>
            {labels?.length > 1 && <div className="mb-3 flex items-center justify-between text-sm"><Button variant="secondary" disabled={labelIndex === 0} onClick={() => setLabelIndex(index => index - 1)}>上一箱</Button><span>第 {labelIndex + 1}／{labels.length} 箱</span><Button variant="secondary" disabled={labelIndex + 1 >= labels.length} onClick={() => setLabelIndex(index => index + 1)}>下一箱</Button></div>}
            <div className="overflow-x-auto rounded-lg bg-slate-50 p-3">{labels?.map((carton, index) => <div key={carton.cartonId} style={{ display: index === labelIndex ? 'block' : 'none' }}><QrLabel carton={carton} size={labelSize} /></div>)}</div><p className="mt-3 text-xs text-slate-500">此 QR 貼在對應實體箱，列印不代表已出貨。</p>
        </CartonDialog>
    </section>;
}
