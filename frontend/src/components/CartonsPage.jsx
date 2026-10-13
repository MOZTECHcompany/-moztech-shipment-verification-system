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
    const open = async id => { const request = ++detailRequest.current, session = cartonSessionKey(api, user); try { const { data } = await api.get(`/api/cartons/${encodeURIComponent(id)}`); if (alive.current && request === detailRequest.current && session === cartonSessionKey(api, user)) setDetail(data.carton || data); } catch (err) { if (alive.current && request === detailRequest.current) setError(errText(err)); } };
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
            const body = JSON.parse(await file.text());
            if (body.format !== 'corely-cartons-v1' || !Array.isArray(body.cartons)) throw new Error('請選擇 ERP 匯出的箱號檔案');
            ensureCurrent(); await api.post('/api/cartons/import', { ...body, expectedActorId: user.id }); ensureCurrent(); toast.success(`已匯入 ${body.cartons.length} 箱`);
        });
    };
    const seal = () => mutate(async ensureCurrent => {
        ensureCurrent(); const { data } = await api.post(`/api/cartons/${encodeURIComponent(detail.cartonId)}/seal`, { expectedContentRevision: detail.contentRevision, expectedActorId: user.id }); ensureCurrent(); setDetail(data.carton || data); toast.success('已確認箱內內容');
    });
    const print = () => {
        const markup = getWorkspaceRoot()?.querySelector('[data-carton-label]')?.outerHTML;
        const win = markup && window.open('', '_blank');
        if (!win) { toast.error('請允許列印視窗'); return; }
        win.document.open(); win.document.write(`<html><head><title>箱號貼紙</title><style>@page{size:60mm 75mm;margin:0}body{margin:0;font-family:sans-serif} [data-carton-label]{width:54mm;padding:3mm;border:0;font-size:12px;overflow-wrap:anywhere}svg{display:block;margin:2mm auto}</style></head><body>${markup}</body></html>`); win.document.close(); win.focus(); win.print();
    };
    return <section className="space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-xl font-semibold flex items-center gap-2"><Box size={22} />箱號管理</h1>{canManage && <div className="flex gap-2"><Button variant="secondary" onClick={() => importRef.current.click()} disabled={busy}><Upload size={16} />匯入箱號</Button><Button onClick={() => edit(null)} disabled={busy}><Plus size={16} />新增箱號</Button><input ref={importRef} type="file" accept=".json,application/json" onChange={importFile} className="hidden" aria-label="匯入箱號檔案" /></div>}</header>
        <input aria-label="搜尋箱號或品號" placeholder="搜尋箱號或品號" value={query} onChange={e => setQuery(e.target.value)} className={`${inputClass} max-w-sm`} />
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-3">箱號</th><th>狀態</th><th>品項</th><th>剩餘／總件數</th></tr></thead><tbody>{cartons.map(c => <tr key={c.cartonId} className="border-t"><td className="p-3"><button className="text-blue-700 underline break-all" onClick={() => open(c.cartonId)}>{c.cartonId}</button></td><td>{c.status === 'sealed' ? '已確認' : '待確認'}</td><td>{c.lines?.length ?? c.lineCount ?? '—'}</td><td>{c.lines ? `${c.lines.reduce((s,l)=>s+l.remainingQuantity,0)}／${c.lines.reduce((s,l)=>s+l.quantity,0)}` : `${c.remainingQuantity ?? '—'}／${c.quantity ?? '—'}`}</td></tr>)}</tbody></table>{loading && <p role="status" className="p-4">載入中…</p>}{!loading && !cartons.length && <p className="p-6 text-slate-500">尚無符合的箱號</p>}</div>
        <CartonDialog open={!!editor} title={editor?.editing ? '編輯箱內內容' : '新增箱號'} onClose={() => !busy && setEditor(null)} footer={<><Button variant="secondary" disabled={busy} onClick={() => setEditor(null)}>取消</Button><Button disabled={busy} onClick={save}>儲存</Button></>}>
            {error && <p role="alert" className="mb-3 text-red-700">{error}</p>}
            <label className="block mb-3 text-sm">箱號<input autoFocus value={editor?.cartonId || ''} readOnly={editor?.editing} onChange={e => setEditor({ ...editor, cartonId: e.target.value })} className={inputClass} /></label>
            {lines.map((line, index) => <fieldset key={index} className="mb-3 rounded-lg border p-3"><legend className="px-1 text-sm">品項 {index + 1}</legend><div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{[['itemCode','WMS／ECOUNT 品號'],['productName','品名'],['ean','國際條碼'],['internalScanCode','內部掃描碼'],['quantity','數量']].map(([key, caption]) => <label key={key} className="text-sm">{caption}<input type={key === 'quantity' ? 'number' : 'text'} min={key === 'quantity' ? 1 : undefined} step={key === 'quantity' ? 1 : undefined} value={line[key] ?? ''} onChange={e => setLines(old => old.map((l,i) => i === index ? { ...l, [key]: e.target.value } : l))} className={inputClass} /></label>)}<label className="sm:col-span-2 text-sm">箱內 SN<textarea value={line.serialInput} onChange={e => setLines(old => old.map((l,i) => i === index ? { ...l, serialInput: e.target.value } : l))} rows={3} className={inputClass} /></label></div>{lines.length > 1 && <button onClick={() => setLines(old => old.filter((_,i)=>i!==index))} className="mt-2 text-sm text-red-700">移除此品項</button>}</fieldset>)}
            <Button variant="secondary" onClick={() => setLines(old => [...old, blankLine()])}>新增品項</Button>
        </CartonDialog>
        <CartonDialog open={!!detail && !editor} title={detail?.cartonId || '箱號明細'} onClose={() => { if (!busy) { detailRequest.current++; setDetail(null); } }} footer={<>{canManage && detail?.status === 'draft' && <><Button variant="secondary" onClick={() => edit(detail)} disabled={busy}>編輯</Button><Button onClick={seal} disabled={busy}>確認箱內內容</Button></>}<Button variant="secondary" onClick={() => setLabel(detail)}><Printer size={16} />列印貼紙</Button></>}>
            {error && <p role="alert" className="mb-3 text-red-700">{error}</p>}
            {(detail?.lines || []).map(l => <div key={l.lineId} className="mb-3 rounded-lg border p-3"><strong>{l.productName || l.itemCode}</strong><p className="text-sm">品號 {l.itemCode} · 剩餘 {l.remainingQuantity}／{l.quantity}</p>{l.ean && <p className="text-sm">國條 {l.ean}</p>}{l.internalScanCode && <p className="text-sm">內碼 {l.internalScanCode}</p>}{!!l.actualSN.length && <details className="mt-2 text-sm"><summary>箱內 SN（共 {l.actualSN.length} 個，可用 {l.remainingSN.length} 個）</summary><ul className="mt-2 space-y-1">{l.actualSN.map(sn => <li key={sn} className="flex items-start justify-between gap-3"><span className="min-w-0 break-all">{sn}</span><span className="shrink-0 text-slate-500">{l.remainingSN.includes(sn) ? '可用' : '已分配'}</span></li>)}</ul></details>}</div>)}
            {!!detail?.history?.length && <details className="text-sm"><summary>異動紀錄</summary>{detail.history.map((h,i) => <p key={h.id || i} className="mt-2">{({ created: '建立', sealed: '確認箱內內容', contents_revised: '修改內容', picked: '揀貨', packed: '裝箱', released: '解除分配' })[h.event_type] || h.event_type || h.action} · {new Date(h.createdAt || h.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}</p>)}</details>}
        </CartonDialog>
        <CartonDialog open={!!label} title="箱號貼紙" onClose={() => setLabel(null)} footer={<Button onClick={print}><Printer size={16} />列印</Button>}>{label && <QrLabel carton={label} />}</CartonDialog>
    </section>;
}
