import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ScanLine, Trash2 } from 'lucide-react';
import api from '@/api/api';
import { Button } from '@/ui';
import { cartonSessionKey, parseSerialInput } from '@/utils/cartonScan';
import { uniqueExactCartonItem } from '@/utils/cartonEditor';

export const cartonFieldClass = 'w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:outline-blue-500 disabled:bg-slate-50';
const errorText = error => error.response?.data?.message || error.message;

function ImportedItemPicker({ user, disabled, onSelect, focus }) {
    const [search, setSearch] = useState(''), [results, setResults] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
    const request = useRef(0), alive = useRef(true), input = useRef(null), timer = useRef(null);
    useEffect(() => { alive.current = true; if (focus) input.current?.focus(); return () => { alive.current = false; request.current++; clearTimeout(timer.current); }; }, [focus]);
    const select = item => { if (disabled) return; onSelect(item); setSearch(''); setResults(null); request.current++; clearTimeout(timer.current); };
    const query = useCallback(async (text, exactOnly = false) => {
        clearTimeout(timer.current);
        const id = ++request.current, q = text.trim(), session = cartonSessionKey(api, user);
        const current = () => alive.current && id === request.current && session === cartonSessionKey(api, user);
        setResults(null); setError('');
        if (!q || disabled) { setLoading(false); return; }
        setLoading(true);
        try {
            const { data } = await api.get('/api/carton-items', { params: { q }, timeout: 10000 });
            if (!current()) return;
            const items = data.items || [];
            const exact = exactOnly ? uniqueExactCartonItem(items, q) : null;
            if (exact) select(exact);
            else { setResults({ items, session }); if (exactOnly && items.length) setError('請從下方選擇正確商品。'); }
        } catch (err) { if (current()) setError(errorText(err)); }
        finally { if (current()) setLoading(false); else if (alive.current && id + 1 === request.current && !search) setLoading(false); }
    }, [disabled, user]);
    useEffect(() => {
        clearTimeout(timer.current); request.current++; setResults(null); setError(''); setLoading(false);
        if (search.trim() && !disabled) timer.current = setTimeout(() => query(search), 250);
        return () => clearTimeout(timer.current);
    }, [search, disabled, query]);
    return <div className="space-y-2">
        <label className="block text-sm font-medium">掃描或搜尋商品<input ref={input} data-carton-autofocus={focus || undefined} aria-label="掃描或搜尋商品" placeholder="掃商品條碼，或輸入品號／品名" value={search} disabled={disabled} maxLength={128}
            onChange={event => { request.current++; setResults(null); setSearch(event.target.value); }}
            onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent?.isComposing) { event.preventDefault(); event.currentTarget.select?.(); void query(event.currentTarget.value, true); } }} className={`${cartonFieldClass} mt-1`} /></label>
        <p className="text-xs text-slate-500">搜尋曾匯入 WMS 的理貨單品項。</p>
        {loading && <p role="status" className="text-sm text-slate-500">查詢中…</p>}
        {error && <p role="alert" className="text-sm text-amber-800">{error}</p>}
        {results?.items.length === 0 && <p className="text-sm text-slate-500">找不到商品，可使用「手動新增商品」。</p>}
        {!!results?.items.length && <ul className="max-h-48 overflow-y-auto rounded-lg border divide-y">{results.items.map(item => <li key={JSON.stringify([item.itemCode, item.productName, item.importedBarcode])}><button type="button" disabled={disabled} onClick={() => { if (results.session === cartonSessionKey(api, user)) select(item); }} className="block min-h-12 w-full p-3 text-left text-sm hover:bg-blue-50"><strong className="break-all">{item.itemCode}</strong> · {item.productName || '未填品名'}<span className="block text-xs text-slate-500 break-all">理貨單掃描碼：{item.importedBarcode || '未填'}</span></button></li>)}</ul>}
    </div>;
}

export function CartonItemEditor({ user, line, index, disabled, template, onChange, onSelect, onScan, onRemove, focus }) {
    const [snValue, setSnValue] = useState(''), [snError, setSnError] = useState('');
    const snRef = useRef(null);
    const serials = parseSerialInput(line.serialInput), total = Number(line.quantity) || 0;
    useEffect(() => { if (line.hasSerials) snRef.current?.focus(); }, [line.hasSerials]);
    const addSN = raw => {
        const value = String(raw ?? snValue);
        setSnValue(''); setSnError('');
        try { onScan(value); } catch (error) { setSnError(error.message); }
        snRef.current?.focus();
    };
    return <fieldset className="rounded-xl border border-slate-200 p-4 space-y-4">
        <legend className="px-1 text-sm font-semibold text-slate-700">品項 {index + 1}</legend>
        <ImportedItemPicker user={user} disabled={disabled} onSelect={onSelect} focus={focus && !line.itemCode} />
        {line.itemCode && <div className="flex items-start gap-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-950"><Check size={17} className="mt-0.5 shrink-0" /><div className="min-w-0"><strong className="break-words">{line.productName || line.itemCode}</strong><p className="break-all text-xs text-blue-700">品號 {line.itemCode}</p></div></div>}
        <details className="text-sm"><summary className="min-h-9 cursor-pointer text-blue-700">{line.itemCode ? '手動編輯商品' : '手動新增商品'}</summary><div className="mt-2 grid gap-3 sm:grid-cols-2">{[['itemCode','WMS 品號／型號'],['productName','品名']].map(([key, caption]) => <label key={key}>{caption}<input value={line[key] || ''} disabled={disabled} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} onChange={event => onChange({ [key]: event.target.value, ...(key === 'itemCode' ? { importedBarcode: null, ean: '', internalScanCode: '' } : {}) })} className={`${cartonFieldClass} mt-1`} /></label>)}</div></details>
        <div className="border-t border-slate-100 pt-4"><label className="block text-sm font-semibold">每箱數量<input type="number" min="1" max="1000000" step="1" aria-label="每箱數量" value={line.quantity ?? ''} disabled={disabled} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (line.hasSerials) snRef.current?.focus(); } }} onChange={event => onChange({ quantity: event.target.value })} placeholder="輸入實際件數" className={`${cartonFieldClass} mt-1 max-w-40`} /></label></div>
        {!template && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" aria-label="此商品有 SN" checked={!!line.hasSerials} disabled={disabled} onChange={event => onChange({ hasSerials: event.target.checked })} className="h-4 w-4 accent-blue-600" />此商品有 SN</label>}
        {!template && line.hasSerials && <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
            <div className="flex items-center justify-between gap-2"><label htmlFor={`sn-scan-${line.editorLineId}`} className="text-sm font-semibold">掃描 SN</label><span aria-live="polite" className={`text-sm font-semibold ${total > 0 && serials.length === total ? 'text-emerald-700' : 'text-slate-600'}`}>已掃 {serials.length}／{total || '—'} 件</span></div>
            <div className="flex gap-2"><input ref={snRef} id={`sn-scan-${line.editorLineId}`} aria-label="掃描 SN" value={snValue} disabled={disabled} onChange={event => setSnValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent?.isComposing) { event.preventDefault(); addSN(event.currentTarget.value); } }} placeholder="逐支掃描，按 Enter 加入" className={cartonFieldClass} /><Button type="button" variant="secondary" disabled={disabled || !snValue.trim()} onClick={() => addSN(snValue)}><ScanLine size={16} /><span className="sr-only">加入 SN</span></Button></div>
            {snError && <p role="alert" className="text-sm text-red-700">{snError}</p>}
            {!!serials.length && <ul className="max-h-40 overflow-y-auto divide-y divide-slate-200">{serials.map((sn, serialIndex) => <li key={`${sn}:${serialIndex}`} className="flex items-center justify-between gap-2 py-2 text-xs"><span className="min-w-0 break-all font-mono">{sn}</span><button type="button" disabled={disabled} aria-label={`移除 SN ${sn}`} onClick={() => onChange({ serialInput: serials.filter((_, i) => i !== serialIndex).join('\n') })} className="min-h-9 rounded px-2 text-slate-500 hover:bg-red-50 hover:text-red-700"><Trash2 size={15} /></button></li>)}</ul>}
            <details className="text-sm"><summary className="min-h-9 cursor-pointer text-blue-700">貼上多筆 SN</summary><label className="mt-2 block text-xs text-slate-600">箱內 SN<textarea aria-label="箱內 SN" value={line.serialInput} disabled={disabled} onChange={event => onChange({ serialInput: event.target.value })} rows={3} placeholder="每行一個，保留原大小寫與前面的 0" className={`${cartonFieldClass} mt-1 font-mono`} /></label></details>
        </div>}
        {!line.hasSerials && serials.length > 0 && <p role="alert" className="text-sm text-red-700">已輸入 {serials.length} 個 SN，請勾選「此商品有 SN」核對，內容尚未移除。</p>}
        <details className="text-sm"><summary className="min-h-9 cursor-pointer text-slate-600">商品掃描碼（選填）</summary><div className="mt-2 space-y-3">
            {line.importedBarcode && <><p className="break-all text-xs text-slate-600">理貨單原碼：{line.importedBarcode}。與實物核對後選用途。</p><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => onChange({ ean: line.importedBarcode, internalScanCode: '' })}>確認為國際條碼</Button>{/^ITM-[A-Za-z0-9._-]{1,96}$/.test(line.importedBarcode) && <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => onChange({ ean: '', internalScanCode: line.importedBarcode })}>使用此內部掃描碼</Button>}<Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => onChange({ ean: '', internalScanCode: '' })}>只使用品號</Button></div></>}
            <div className="grid gap-3 sm:grid-cols-2">{[['ean','國際條碼'],['internalScanCode','內部掃描碼']].map(([key, caption]) => <label key={key}>{caption}<input value={line[key] || ''} disabled={disabled} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} onChange={event => onChange({ [key]: event.target.value })} className={`${cartonFieldClass} mt-1`} /></label>)}</div>
        </div></details>
        {onRemove && <button type="button" disabled={disabled} onClick={onRemove} className="min-h-9 text-sm text-red-700">移除此品項</button>}
    </fieldset>;
}
