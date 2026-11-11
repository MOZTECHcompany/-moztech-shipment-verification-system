import { getWorkspaceRoot } from '../workspace/nativeRuntime.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeWriter, BarcodeFormat } from '@zxing/library';
import { Box, Plus, Printer, Upload } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/api/api';
import { Button } from '@/ui';
import { isWarehouseAdmin } from '@/utils/managementScope';
import { parseSerialInput, cartonSessionKey } from '@/utils/cartonScan';
import { CartonDialog } from './CartonDialog';
import { parseCartonExcel, resolveCartonExcelItems } from '@/utils/cartonExcel';
import templateHref from './cartonImportTemplate.xlsx?url';

const cartonStatus = { draft: '待確認', sealed: '已確認', void: '已作廢' };
const blankLine = () => ({ itemCode: '', productName: '', ean: '', internalScanCode: '', quantity: 10, serialInput: '' });
const newId = () => `CTN-${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date()).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8)}`;
const errText = error => error.response?.data?.message || error.message || '操作失敗';
const inputClass = 'w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-blue-500';

function QrLabel({ carton }) {
    const matrix = new QRCodeWriter().encode(`CARTON:${carton.cartonId}`, BarcodeFormat.QR_CODE, 0, 0);
    let path = '';
    for (let y = 0; y < matrix.getHeight(); y++) for (let x = 0; x < matrix.getWidth(); x++) if (matrix.get(x, y)) path += `M${x},${y}h1v1h-1z`;
    return <div data-carton-label className="mx-auto w-[60mm] border border-slate-200 bg-white p-3 text-black">
        <div className="font-bold break-all">{carton.cartonId}</div>
        <div className="text-sm">建箱 {(carton.lines || []).reduce((s, l) => s + l.quantity, 0)} 件</div>
        <svg aria-label={`箱號 QR Code ${carton.cartonId}`} viewBox={`0 0 ${matrix.getWidth()} ${matrix.getHeight()}`} width="150" height="150" className="mx-auto my-2" shapeRendering="crispEdges"><rect width="100%" height="100%" fill="white" /><path d={path} fill="black" /></svg>
        {(carton.lines || []).slice(0, 3).map(line => <div key={line.lineId} className="break-all text-xs">{String(line.productName || line.itemCode).slice(0, 32)} × {line.quantity}</div>)}{carton.lines?.length > 3 && <div className="text-xs">共 {carton.lines.length} 個品項，掃 QR 查看完整內容</div>}
    </div>;
}

export function CartonsPage({ user }) {
    const canManage = isWarehouseAdmin(user);
    const [query, setQuery] = useState(''), [cartons, setCartons] = useState([]), [detail, setDetail] = useState(null);
    const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [editor, setEditor] = useState(null), [lines, setLines] = useState([blankLine()]), [label, setLabel] = useState(null);
    const [voidReason, setVoidReason] = useState(null);
    const [importedBatch, setImportedBatch] = useState(null), [checkedCartons, setCheckedCartons] = useState(new Set());
    const importRef = useRef(null), mutationRef = useRef(false), listRequest = useRef(0), detailRequest = useRef(0);
    const alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; listRequest.current++; detailRequest.current++; }; }, []);
    const load = useCallback(async () => {
        const request = ++listRequest.current, session = cartonSessionKey(api, user);
        setLoading(true); setError('');
        try { const { data } = await api.get('/api/cartons', { params: { q: query, limit: 100 } }); if (alive.current && session === cartonSessionKey(api, user) && request === listRequest.current) setCartons(data.cartons || data.items || (Array.isArray(data) ? data : [])); }
        catch (err) { if (request === listRequest.current) setError(errText(err)); }
        finally { if (request === listRequest.current) setLoading(false); }
    }, [query, user]);
    useEffect(() => { const timeout = setTimeout(load, 200); return () => clearTimeout(timeout); }, [load]);
    const mutate = async action => {
        if (mutationRef.current) return;
        mutationRef.current = true; setBusy(true); setError('');
        const session = cartonSessionKey(api, user);
        const ensureCurrent = () => { if (!alive.current || session !== cartonSessionKey(api, user)) throw new Error('登入已更新，請重新載入'); };
        try { await action(ensureCurrent); ensureCurrent(); await load(); }
        catch (err) { if (alive.current) setError(errText(err)); }
        finally { mutationRef.current = false; if (alive.current) setBusy(false); }
    };
    const open = async id => { const request = ++detailRequest.current, session = cartonSessionKey(api, user); try { const { data } = await api.get(`/api/cartons/${encodeURIComponent(id)}`); if (alive.current && request === detailRequest.current && session === cartonSessionKey(api, user)) { setDetail(data.carton || data); setVoidReason(null); } } catch (err) { if (alive.current && request === detailRequest.current) setError(errText(err)); } };
    const edit = carton => {
        setEditor(carton ? { cartonId: carton.cartonId, expectedContentRevision: carton.contentRevision, editing: true } : { cartonId: newId() });
        setLines(carton ? carton.lines.map(l => ({ ...l, serialInput: l.actualSN.join('\n') })) : [blankLine()]); setError('');
    };
    const save = () => mutate(async ensureCurrent => {
        const body = { ...editor, expectedActorId: user.id, lines: lines.map(l => ({ itemCode: l.itemCode.trim(), productName: l.productName?.trim() || null, ean: l.ean?.trim() || null, internalScanCode: l.internalScanCode?.trim() || null, quantity: Number(l.quantity), actualSN: parseSerialInput(l.serialInput) })) };
        ensureCurrent();
        const response = editor.editing ? await api.patch(`/api/cartons/${encodeURIComponent(editor.cartonId)}`, body) : await api.post('/api/cartons', body);
        ensureCurrent();
        setDetail(response.data.carton || response.data); setEditor(null); toast.success('箱號已儲存');
    });
    const importFile = event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file) return;
        void mutate(async ensureCurrent => {
            if (file.size > 2 * 1024 * 1024) throw new Error('箱號檔案不可超過 2 MB');
            let body;
            if (/\.xlsx$/i.test(file.name)) {
                const XLSX = await import('xlsx');
                let workbook;
                try {
                    workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellText: true, cellNF: true });
                } catch {
                    throw new Error('無法讀取 Excel，請使用下載的 .xlsx 範本。');
                }
                body = await resolveCartonExcelItems(parseCartonExcel(workbook, XLSX), async skus => {
                    ensureCurrent();
                    const { data } = await api.post('/api/marketplace-products/resolve', { skus });
                    ensureCurrent();
                    return data;
                });
            } else {
                try {
                    body = JSON.parse(await file.text());
                } catch {
                    throw new Error('請選擇 Excel 範本或有效的箱號 JSON 檔。');
                }
                if (body?.format !== 'corely-cartons-v1' || !Array.isArray(body.cartons)) {
                    throw new Error('請選擇 Excel 範本或有效的箱號 JSON 檔。');
                }
            }
            ensureCurrent();
            const { data } = await api.post('/api/cartons/import', { ...body, expectedActorId: user.id });
            ensureCurrent();
            if (!Array.isArray(data?.items) || data.items.length !== body.cartons.length || data.items.some(item =>
                !item?.carton || item.carton.cartonId !== item.cartonId || !Number.isSafeInteger(item.carton.contentRevision) || !Array.isArray(item.carton.lines))) {
                throw new Error('匯入結果不完整，請重新查詢箱號。');
            }
            setCheckedCartons(new Set());
            setImportedBatch({ session: cartonSessionKey(api, user), items: data.items.map(({ carton }) => ({
                cartonId: carton.cartonId, status: carton.status, contentRevision: carton.contentRevision,
                quantity: carton.lines.reduce((sum, line) => sum + line.quantity, 0),
                serialCount: carton.lines.reduce((sum, line) => sum + line.actualSN.length, 0),
            })) });
        });
    };
    const visibleBatch = canManage && importedBatch?.session === cartonSessionKey(api, user) ? importedBatch : null;
    const drafts = visibleBatch?.items.filter(carton => carton.status === 'draft') || [];
    const selectedCartons = drafts.filter(carton => checkedCartons.has(carton.cartonId));
    const confirmBatch = () => {
        if (!selectedCartons.length) return;
        void mutate(async ensureCurrent => {
            const cartons = selectedCartons.map(({ cartonId, contentRevision }) => ({ cartonId, expectedContentRevision: contentRevision }));
            ensureCurrent();
            const { data } = await api.post('/api/cartons/seal-batch', { cartons, expectedActorId: user.id }, { timeout: 30000 });
            ensureCurrent();
            const results = new Map(Array.isArray(data?.items) ? data.items.map(item => [item?.cartonId, item]) : []);
            if (results.size !== cartons.length || cartons.some(item => results.get(item.cartonId)?.status !== 'sealed'
                || results.get(item.cartonId)?.contentRevision !== item.expectedContentRevision)) {
                throw new Error('尚未收到完整確認結果，可再次確認同一批箱號。');
            }
            setImportedBatch(batch => batch === visibleBatch ? { ...batch, items: batch.items.map(item =>
                results.has(item.cartonId) ? { ...item, status: 'sealed' } : item) } : batch);
            setCheckedCartons(new Set());
            toast.success(`所選 ${cartons.length} 箱均已確認`);
        });
    };
    const seal = () => mutate(async ensureCurrent => {
        ensureCurrent(); const { data } = await api.post(`/api/cartons/${encodeURIComponent(detail.cartonId)}/seal`, { expectedContentRevision: detail.contentRevision, expectedActorId: user.id }); ensureCurrent(); setDetail(data.carton || data); toast.success('已確認箱內內容');
    });
    const voidDraft = () => mutate(async ensureCurrent => {
        ensureCurrent();
        const { data } = await api.post(`/api/cartons/${encodeURIComponent(detail.cartonId)}/void`, {
            reason: voidReason.trim(), expectedContentRevision: detail.contentRevision, expectedActorId: user.id,
        });
        ensureCurrent();
        if (data?.cartonId !== detail.cartonId || data.status !== 'void' || data.contentRevision !== detail.contentRevision) {
            throw new Error('尚未收到完整作廢結果，請重新查詢或使用同一原因再試一次。');
        }
        setDetail(data);
        setVoidReason(null);
        toast.success('草稿箱已作廢');
    });
    const canVoidDraft = canManage && detail?.status === 'draft' && !detail.allocations?.length;
    const voidingDraft = canVoidDraft && voidReason !== null;
    const voidEvent = detail?.history?.find(event => event.event_type === 'voided');
    const print = () => {
        const markup = getWorkspaceRoot()?.querySelector('[data-carton-label]')?.outerHTML;
        const win = markup && window.open('', '_blank');
        if (!win) { toast.error('請允許列印視窗'); return; }
        win.document.open(); win.document.write(`<html><head><title>箱號貼紙</title><style>@page{size:60mm 75mm;margin:0}body{margin:0;font-family:sans-serif} [data-carton-label]{width:54mm;padding:3mm;border:0;font-size:12px;overflow-wrap:anywhere}svg{display:block;margin:2mm auto}</style></head><body>${markup}</body></html>`); win.document.close(); win.focus(); win.print();
    };
    return <section className="space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-xl font-semibold flex items-center gap-2"><Box size={22} />箱號管理</h1>
            {canManage && <div className="flex flex-wrap gap-2">
                <Button as="a" variant="secondary" href={templateHref} download="WMS-箱號匯入範本.xlsx">下載 Excel 範本</Button>
                <Button variant="secondary" onClick={() => importRef.current.click()} disabled={busy}><Upload size={16} />匯入箱號</Button>
                <Button onClick={() => edit(null)} disabled={busy}><Plus size={16} />新增箱號</Button>
                <input ref={importRef} type="file" accept=".xlsx,.json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/json" onChange={importFile} className="hidden" aria-label="匯入箱號檔案" />
            </div>}
        </header>
        <input aria-label="搜尋箱號或品號" placeholder="搜尋箱號或品號" value={query} onChange={e => setQuery(e.target.value)} className={`${inputClass} max-w-sm`} />
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-3">箱號</th><th>狀態</th><th>品項</th><th>剩餘／總件數</th></tr></thead><tbody>{cartons.map(c => <tr key={c.cartonId} className="border-t"><td className="p-3"><button className="text-blue-700 underline break-all" onClick={() => open(c.cartonId)}>{c.cartonId}</button></td><td>{cartonStatus[c.status] || '—'}</td><td>{c.lines?.length ?? c.lineCount ?? '—'}</td><td>{c.lines ? `${c.lines.reduce((s,l)=>s+l.remainingQuantity,0)}／${c.lines.reduce((s,l)=>s+l.quantity,0)}` : `${c.remainingQuantity ?? '—'}／${c.quantity ?? '—'}`}</td></tr>)}</tbody></table>{loading && <p role="status" className="p-4">載入中…</p>}{!loading && !cartons.length && <p className="p-6 text-slate-500">尚無符合的箱號</p>}</div>
        <CartonDialog open={!!visibleBatch} title="匯入箱號結果" onClose={() => { if (!busy) setImportedBatch(null); }}
            footer={<><Button variant="secondary" disabled={busy} onClick={() => setImportedBatch(null)}>關閉</Button>
                {!!drafts.length && <Button disabled={busy || !selectedCartons.length} onClick={confirmBatch}>確認所選 {selectedCartons.length} 箱</Button>}</>}>
            {visibleBatch && <>
                <p className="font-medium" role="status">本次匯入檔案共 {visibleBatch.items.length} 箱，{drafts.length} 箱待確認。</p>
                {!!drafts.length && <p className="mt-1 text-sm text-slate-600">請先核對箱內實物，再勾選要確認的箱號。未勾選的箱子仍會保留待確認。</p>}
                {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
                {!!drafts.length && <Button variant="secondary" className="my-3" disabled={busy} onClick={() =>
                    setCheckedCartons(new Set(selectedCartons.length === drafts.length ? [] : drafts.map(item => item.cartonId)))}>
                    {selectedCartons.length === drafts.length ? '取消全選' : '全選待確認箱'}
                </Button>}
                <ul className="max-h-72 divide-y overflow-y-auto border-y">
                    {visibleBatch.items.map(item => <li key={item.cartonId} className="flex items-center justify-between gap-3 px-2 py-2 text-sm">
                        {item.status === 'draft' ? <label className="flex min-w-0 items-center gap-2">
                            <input type="checkbox" disabled={busy} checked={checkedCartons.has(item.cartonId)} onChange={event => {
                                const checked = event.target.checked;
                                setCheckedCartons(old => { const next = new Set(old); if (checked) next.add(item.cartonId); else next.delete(item.cartonId); return next; });
                            }} /><span className="break-all">{item.cartonId}</span>
                        </label> : <span className="min-w-0 break-all">{item.cartonId}</span>}
                        <span className="shrink-0 text-right text-xs text-slate-600">{item.quantity} 件 · {item.serialCount ? `${item.serialCount} 個 SN` : '無 SN'} · {cartonStatus[item.status] || '不可確認'}</span>
                    </li>)}
                </ul>
            </>}
        </CartonDialog>
        <CartonDialog open={!!editor} title={editor?.editing ? '編輯箱內內容' : '新增箱號'} onClose={() => !busy && setEditor(null)} footer={<><Button variant="secondary" disabled={busy} onClick={() => setEditor(null)}>取消</Button><Button disabled={busy} onClick={save}>儲存</Button></>}>
            {error && <p role="alert" className="mb-3 text-red-700">{error}</p>}
            <label className="block mb-3 text-sm">箱號<input autoFocus value={editor?.cartonId || ''} readOnly={editor?.editing} onChange={e => setEditor({ ...editor, cartonId: e.target.value })} className={inputClass} /></label>
            {lines.map((line, index) => <fieldset key={index} className="mb-3 rounded-lg border p-3"><legend className="px-1 text-sm">品項 {index + 1}</legend><div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{[['itemCode','WMS／ECOUNT 品號'],['productName','品名'],['ean','國際條碼'],['internalScanCode','內部掃描碼'],['quantity','數量']].map(([key, caption]) => <label key={key} className="text-sm">{caption}<input type={key === 'quantity' ? 'number' : 'text'} min={key === 'quantity' ? 1 : undefined} step={key === 'quantity' ? 1 : undefined} value={line[key] ?? ''} onChange={e => setLines(old => old.map((l,i) => i === index ? { ...l, [key]: e.target.value } : l))} className={inputClass} /></label>)}<label className="sm:col-span-2 text-sm">箱內 SN<textarea value={line.serialInput} onChange={e => setLines(old => old.map((l,i) => i === index ? { ...l, serialInput: e.target.value } : l))} rows={3} className={inputClass} /></label></div>{lines.length > 1 && <button onClick={() => setLines(old => old.filter((_,i)=>i!==index))} className="mt-2 text-sm text-red-700">移除此品項</button>}</fieldset>)}
            <Button variant="secondary" onClick={() => setLines(old => [...old, blankLine()])}>新增品項</Button>
        </CartonDialog>
        <CartonDialog open={!!detail && !editor} title={detail?.cartonId || '箱號明細'} onClose={() => {
            if (!busy) { detailRequest.current++; setDetail(null); setVoidReason(null); }
        }} footer={voidingDraft ? <>
            <Button variant="secondary" disabled={busy} onClick={() => { setVoidReason(null); setError(''); }}>取消</Button>
            <Button variant="destructive" disabled={busy || !voidReason.trim()} onClick={voidDraft}>確認作廢</Button>
        </> : <>
            {canVoidDraft && <Button variant="secondary" disabled={busy} onClick={() => { setVoidReason(''); setError(''); }}>作廢草稿箱</Button>}
            {canManage && detail?.status === 'draft' && <><Button variant="secondary" onClick={() => edit(detail)} disabled={busy}>編輯</Button><Button onClick={seal} disabled={busy}>確認箱內內容</Button></>}
            {detail?.status !== 'void' && <Button variant="secondary" onClick={() => setLabel(detail)}><Printer size={16} />列印貼紙</Button>}
        </>}>
            {error && <p role="alert" className="mb-3 text-red-700">{error}</p>}
            {detail?.status === 'void' && <p className="mb-3 text-sm text-red-700">已作廢{voidEvent?.details?.reason ? ` · ${voidEvent.details.reason}` : ''}</p>}
            {voidingDraft && <div className="mb-3 rounded-lg border border-red-200 p-3">
                <p className="mb-2 text-sm">作廢後無法掃箱出貨，系統會保留箱號、原始 SN 和作廢紀錄。</p>
                <label className="block text-sm">作廢原因<input className={inputClass} value={voidReason} disabled={busy} maxLength={1000} onChange={event => setVoidReason(event.target.value)} /></label>
            </div>}
            {(detail?.lines || []).map(l => <div key={l.lineId} className="mb-3 rounded-lg border p-3"><strong>{l.productName || l.itemCode}</strong><p className="text-sm">品號 {l.itemCode} · 剩餘 {l.remainingQuantity}／{l.quantity}</p>{l.ean && <p className="text-sm">國條 {l.ean}</p>}{l.internalScanCode && <p className="text-sm">內碼 {l.internalScanCode}</p>}{!!l.actualSN.length && <details className="mt-2 text-sm"><summary>箱內 SN（共 {l.actualSN.length} 個，可用 {l.remainingSN.length} 個）</summary><ul className="mt-2 space-y-1">{l.actualSN.map(sn => <li key={sn} className="flex items-start justify-between gap-3"><span className="min-w-0 break-all">{sn}</span><span className="shrink-0 text-slate-500">{detail.status === 'void' ? '已作廢' : l.remainingSN.includes(sn) ? '可用' : '已分配'}</span></li>)}</ul></details>}</div>)}
            {!!detail?.history?.length && <details className="text-sm"><summary>異動紀錄</summary>{detail.history.map((h,i) => <p key={h.id || i} className="mt-2">{({ created: '建立', sealed: '確認箱內內容', contents_revised: '修改內容', voided: '作廢草稿箱', picked: '揀貨', packed: '裝箱', released: '解除分配' })[h.event_type] || h.event_type || h.action} · {new Date(h.createdAt || h.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}</p>)}</details>}
        </CartonDialog>
        <CartonDialog open={!!label} title="箱號貼紙" onClose={() => setLabel(null)} footer={<Button onClick={print}><Printer size={16} />列印</Button>}>{label && <QrLabel carton={label} />}</CartonDialog>
    </section>;
}
