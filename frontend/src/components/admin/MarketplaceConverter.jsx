import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft, Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button, PageHeader } from '../../ui';
import { batchSessionMatches } from '../../utils/importBatches';
import { parseMarketplaceRows, validateMarketplaceExport, buildEcountRows, buildPrepickRows, buildMarketplaceAuditRows, formatMinor } from '../../utils/marketplaceIntake.mjs';

const TEST_ORDERS = ['TST6091550133', 'TST6091550109'];
const MAX_BYTES = 10 * 1024 * 1024;
const knownMappings = {
    '4711299270024': { erpSku: '4711299270024', barcode: '4711299270024', erpName: 'bonson-奈米纖維拖把布(兩入)', spec: 'BO-A02' },
    '4711299270000': { erpSku: '4711299270000', barcode: '4711299270000', erpName: 'bonson-極省水平板拖把組二代', spec: 'BO-A03' },
    '4711299271137': { erpSku: '4711299271137', barcode: '', erpName: 'bonson-拖把配件-拖把桿', spec: 'BO-A17' },
};
const inputClass = 'mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 disabled:bg-slate-100';
const sectionClass = 'rounded-xl border border-slate-200 bg-white p-4 sm:p-6';
const cellClass = 'px-3 py-3 text-left align-top';
const money = value => value === null || value === undefined ? '原檔未提供' : formatMinor(value);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const newTestNumber = () => `TEST-${today().replaceAll('-', '')}-${Array.from(crypto.getRandomValues(new Uint8Array(2)), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
const initialSettings = () => ({
    store: '萬魔未來工學院', customerCode: '', customerName: '', warehouseCode: '003', date: today(),
    batchSequence: '1', batchNumber: newTestNumber(), currency: 'TWD', taxMode: 'erp_inclusive', taxType: '11', taxConfirmed: false,
    pendingTestAcknowledged: false, bundleZeroConfirmed: false, skuMappings: {},
    shippingSku: { erpSku: '00001', name: '運費', confirmed: false, nonStock: false },
});

function Field({ label, help, children, ...props }) {
    return <label className="block min-w-0 text-sm font-medium text-slate-800">{label}{children || <input className={inputClass} {...props} />}{help && <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">{help}</span>}</label>;
}

function Check({ children, checked, onChange }) {
    return <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6 text-slate-800"><input type="checkbox" checked={!!checked} onChange={event => onChange(event.target.checked)} className="mt-1 h-4 w-4 shrink-0" /><span>{children}</span></label>;
}

export function MarketplaceConverter({ user }) {
    if (import.meta.env?.VITE_DEPLOY_ENV !== 'dev' || !['admin', 'superadmin', 'dispatcher'].includes(user?.role)) return <Navigate to="/tasks" replace />;
    return <MarketplaceConverterPage user={user} />;
}

function MarketplaceConverterPage({ user }) {
    const [parsed, setParsed] = useState(null);
    const [settings, setSettings] = useState(initialSettings);
    const [fileName, setFileName] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [sessionChanged, setSessionChanged] = useState(false);
    const inputRef = useRef(null);
    const request = useRef(0);
    const mounted = useRef(true);
    const token = useRef(null);
    const actor = useRef({ id: user.id, role: user.role });
    const locked = busy || sessionChanged;

    useEffect(() => {
        mounted.current = true;
        try { token.current = JSON.parse(localStorage.getItem('wms_token')); } catch { token.current = null; }
        const check = () => {
            if (batchSessionMatches(localStorage, actor.current, token.current)) return;
            request.current++;
            setParsed(null); setFileName(''); setSettings(initialSettings()); setBusy(false); setSessionChanged(true);
            setMessage('登入人員已變更，請重新登入後再轉檔。');
        };
        window.addEventListener('storage', check);
        return () => { mounted.current = false; request.current++; window.removeEventListener('storage', check); };
    }, []);

    const currentSession = () => batchSessionMatches(localStorage, actor.current, token.current);
    const update = (key, value) => setSettings(previous => ({ ...previous, [key]: value, ...(key === 'currency' ? { taxConfirmed: false } : {}) }));
    const mapping = (sku, key, value) => setSettings(previous => ({ ...previous, skuMappings: { ...previous.skuMappings, [sku]: { ...previous.skuMappings[sku], [key]: value, ...(['erpSku', 'erpName', 'spec'].includes(key) ? { confirmed: false } : {}), ...(key === 'barcode' ? { barcodeConfirmed: false } : {}) } } }));
    const products = useMemo(() => [...new Map((parsed?.items || []).map(item => [item.sku, item])).values()], [parsed]);
    const validation = useMemo(() => {
        if (!parsed) return { ok: false, issues: [] };
        try { return validateMarketplaceExport(parsed, settings); }
        catch { return { ok: false, issues: [{ code: 'VALIDATION_FAILED', severity: 'error', message: '無法完成欄位核對，請重新選擇檔案。' }] }; }
    }, [parsed, settings]);
    const auditReady = !!parsed?.items?.length && !(parsed.issues || []).some(issue => issue.severity === 'error');

    const selectFile = async event => {
        const files = Array.from(event.target.files || []);
        event.target.value = '';
        if (!files.length || locked) return;
        setMessage(''); setParsed(null); setFileName('');
        if (!currentSession()) { setSessionChanged(true); setMessage('登入人員已變更，請重新登入後再轉檔。'); return; }
        const file = files[0];
        if (files.length !== 1 || !/\.(xlsx|xls|csv)$/i.test(file.name) || file.size === 0 || file.size > MAX_BYTES) {
            setMessage('請選擇一個非空白的 Excel 或 CSV，檔案上限 10 MiB。'); return;
        }
        const sequence = ++request.current;
        setBusy(true);
        try {
            const XLSX = await import('xlsx');
            const buffer = await file.arrayBuffer();
            const csv = /\.csv$/i.test(file.name);
            let source = buffer;
            if (csv) {
                try { source = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
                catch { throw new Error('CSV 請使用 UTF-8 編碼重新匯出，或改選 Excel 原始檔。'); }
            }
            const workbook = XLSX.read(source, { type: csv ? 'string' : 'array', raw: true, cellFormula: false, cellHTML: false });
            if (workbook.SheetNames.length !== 1) throw new Error('請只保留一張 1Shop 訂單明細工作表，再重新選擇檔案。');
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
            if (range.e.r >= 5000 || range.e.c >= 200) throw new Error('檔案超過 5,000 列或 200 欄，請使用這兩筆訂單的精簡原始匯出。');
            const result = parseMarketplaceRows(XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', blankrows: true }), { platform: '1Shop', allowedOrderNumbers: TEST_ORDERS });
            if (!mounted.current || sequence !== request.current) return;
            if (!currentSession()) { setSessionChanged(true); throw new Error('登入人員已變更，請重新登入後再轉檔。'); }
            const skuMappings = Object.fromEntries([...new Set(result.items.map(item => item.sku))].map(sku => [sku, { ...(knownMappings[sku] || { erpSku: '', barcode: '' }), confirmed: false, barcodeConfirmed: false, category: '' }]));
            setParsed(result); setFileName(file.name);
            setSettings(previous => ({ ...previous, batchNumber: newTestNumber(), skuMappings, pendingTestAcknowledged: false, bundleZeroConfirmed: false, taxConfirmed: false, shippingSku: { ...previous.shippingSku, confirmed: false, nonStock: false } }));
        } catch (error) {
            if (mounted.current && sequence === request.current) setMessage(error.message || '無法讀取這個檔案，請確認是否為 1Shop 原始訂單匯出。');
        } finally { if (mounted.current && sequence === request.current) setBusy(false); }
    };

    const download = async kind => {
        if (locked || !parsed || (kind === 'ecount' ? !validation.ok : !auditReady)) return;
        if (!currentSession()) { setParsed(null); setSessionChanged(true); setMessage('登入人員已變更，請重新登入後再轉檔。'); return; }
        setBusy(true); setMessage('');
        try {
            const result = kind === 'ecount' ? buildEcountRows(parsed, settings) : buildMarketplaceAuditRows(parsed, settings);
            const prepick = kind === 'audit' ? buildPrepickRows(parsed, { ...settings, preview: true }) : null;
            if (!result.ok || (prepick && !prepick.ok)) throw new Error('來源資料仍有錯誤，請先完成下方核對。');
            const XLSX = await import('xlsx');
            if (!mounted.current || !currentSession()) throw new Error('登入人員已變更，尚未產生下載檔案。');
            const workbook = XLSX.utils.book_new();
            const addSheet = (name, rows) => {
                const sheet = XLSX.utils.aoa_to_sheet(rows);
                sheet['!cols'] = (rows[0] || []).map(() => ({ wch: 22 }));
                XLSX.utils.book_append_sheet(workbook, sheet, name);
            };
            if (kind === 'ecount') addSheet('銷貨匯入', [result.headers, ...result.rows]);
            else {
                addSheet('預揀總表', [prepick.headers, ...prepick.rows]);
                addSheet('訂單金額核對', [result.headers, ...result.rows]);
                addSheet('來源商品對照', [
                    ['平台', '店鋪', '商城訂單編號', '來源明細號', '原檔列號', '來源組合名稱', '來源 SKU', 'ECOUNT SKU（供核對）', '商品條碼（供核對）', '條碼核對狀態', '商品名稱', '數量', '原始單價', '原始列小計', '商品分類'],
                    ...parsed.items.map(item => [parsed.platform, settings.store, item.sourceOrderNumber, item.sourceLineId, item.sourceRow, item.groupName || '', item.sku, settings.skuMappings[item.sku]?.erpSku || '', settings.skuMappings[item.sku]?.barcode || '', settings.skuMappings[item.sku]?.barcodeConfirmed ? '已核對實物' : '待實物核對', item.productName, item.quantity, item.unitPriceMinor === null ? '原檔未分價' : Number(formatMinor(item.unitPriceMinor)), item.lineSubtotalMinor === null ? '原檔未分價' : Number(formatMinor(item.lineSubtotalMinor)), settings.skuMappings[item.sku]?.category || '']),
                ]);
                addSheet('本次轉檔設定', [['項目', '值'], ['原始檔案', fileName], ['允許測試單號', TEST_ORDERS.join(' / ')], ['店鋪', settings.store], ['ECOUNT 客戶', settings.customerCode], ['發貨倉庫', settings.warehouseCode], ['日期', settings.date], ['銷貨追蹤單號', settings.batchNumber], ['來源金額幣別', settings.currency], ['ECOUNT 交易類型', settings.taxType], ['計稅方式', '含稅單價，由 ECOUNT 依設定計稅'], ['ERP 幣別代碼', '留空，使用 ERP 設定'], ['ERP 已建立', '否，下載檔案不代表已儲存銷貨'], ['WMS 已匯入', '否，待核對 ECOUNT 理貨匯出後另行匯入']]);
            }
            const suffix = (settings.batchNumber || settings.date).replace(/[^\p{L}\p{N}_-]/gu, '_').slice(0, 80);
            XLSX.writeFile(workbook, `${kind === 'ecount' ? 'ECOUNT銷貨匯入' : '預揀與金額核對'}_${suffix}.xlsx`);
            setMessage(kind === 'ecount' ? '銷貨檔已下載。請到 ECOUNT 上傳預覽，核對商品、運費與金額後再儲存。' : '核對表已下載，包含預揀總表、訂單金額、來源商品及本次設定。');
        } catch (error) { if (mounted.current) setMessage(error.message || '下載未完成，請重新核對後再試。'); }
        finally { if (mounted.current) setBusy(false); }
    };

    return <main className="mx-auto max-w-7xl space-y-5 pb-8 text-slate-900" data-testid="marketplace-converter">
        <Link to="/admin" className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-blue-700"><ArrowLeft size={16} />返回出貨管理</Link>
        <PageHeader title="1Shop 測試訂單轉檔" />
        <p className="text-sm leading-6 text-slate-600">本次只處理 {TEST_ORDERS.join('、')}。選檔後先預覽，資料留在這個瀏覽器頁面；不會上傳、建立 WMS 工作單或送出 ECOUNT 銷貨。</p>
        <section className={sectionClass}>
            <h2 className="font-semibold text-slate-950">1. 選擇 1Shop 原始訂單檔</h2>
            <p className="mt-2 text-sm text-slate-600">保留原始表頭與金額欄，不要先轉成 ECOUNT 27 欄或 WMS 理貨檔。離開或重新整理此頁會清除未下載的內容。</p>
            <Button type="button" variant="secondary" className="mt-4" disabled={locked} onClick={() => inputRef.current?.click()}>{busy ? <Loader2 className="mr-2 animate-spin" size={18} /> : <FileSpreadsheet className="mr-2" size={18} />}選擇原始訂單檔</Button>
            <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={locked} onChange={selectFile} aria-label="1Shop 原始訂單檔" />
            {fileName && <p className="mt-3 break-all text-sm text-slate-600">已讀取：{fileName}</p>}
        </section>
        {message && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">{message}</p>}
        {parsed && <>
            <section className={sectionClass}>
                <h2 className="font-semibold text-slate-950">2. 核對來源與金額</h2>
                <p className="mt-2 text-sm text-slate-600">本次 {parsed.summary.orderCount} 筆訂單、{parsed.summary.itemCount} 個商品列、{parsed.summary.totalQuantity} 件；其他訂單已排除 {parsed.summary.excludedOrderCount || 0} 筆。金額為訂單資料，不代表已收到款項。</p>
                <div className="mt-4 overflow-x-auto"><table className="w-full text-sm" aria-label="來源訂單與金額"><thead className="bg-slate-50"><tr>{['商城訂單', '付款狀態', '商品小計', '運費', '手續費', '訂單總額', '退款'].map(label => <th key={label} className={cellClass}>{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{parsed.orders.map(order => <tr key={order.sourceOrderNumber}>
                    <td className={cellClass}><p className="font-medium">{order.sourceOrderNumber}</p><p className="mt-1 text-xs text-slate-500">{order.salesPageName || '來源銷售頁未提供'}</p></td>
                    <td className={cellClass}><p>{order.rawPaymentStatus || order.paymentStatus || '原檔未提供'}</p>{order.paymentNote && <p className="mt-1 text-xs text-amber-800">{order.paymentNote}</p>}</td>
                    {[order.financial.subtotalMinor, order.financial.shippingMinor, order.financial.feeMinor, order.financial.totalMinor, order.financial.refundedMinor].map((value, index) => <td key={index} className={`${cellClass} whitespace-nowrap tabular-nums`}>{money(value)}</td>)}</tr>)}</tbody></table></div>
                <div className="mt-4 overflow-x-auto"><table className="w-full text-sm" aria-label="來源商品明細"><thead className="bg-slate-50"><tr>{['商城訂單／來源明細', '商品與來源組合名稱', '來源 SKU', '數量', '原單價', '原列小計'].map(label => <th key={label} className={cellClass}>{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{parsed.items.map(item => <tr key={item.id}>
                    <td className={`${cellClass} text-xs`}>{item.sourceOrderNumber}<br />{item.sourceLineId}<br />原檔第 {item.sourceRow} 列</td><td className={cellClass}><p>{item.productName}</p>{item.groupName && <p className="mt-1 text-xs text-slate-500">來源組合：{item.groupName}</p>}{item.kind === 'bundle_component' && <p className="mt-1 text-xs text-amber-800">組合元件，原檔未分價</p>}</td><td className={`${cellClass} font-mono text-xs`}>{item.sku || '缺少 SKU'}</td><td className={cellClass}>{item.quantity}</td><td className={cellClass}>{money(item.unitPriceMinor)}</td><td className={cellClass}>{money(item.lineSubtotalMinor)}</td></tr>)}</tbody></table></div>
            </section>
            <fieldset disabled={locked} className={sectionClass}>
                <legend className="sr-only">商品與 ECOUNT 設定</legend>
                <h2 className="font-semibold text-slate-950">3. 確認商品對照</h2>
                <p className="mt-2 text-sm text-slate-600">已查到的測試主檔先帶入供核對。ECOUNT 銷貨檔使用品項編碼；商品條碼留待實物核對，不影響銷貨轉檔。原檔組合名稱已另行保留。</p>
                <div className="mt-4 space-y-4">{products.map(item => { const value = settings.skuMappings[item.sku] || {}; return <div key={item.sku} className="rounded-lg border border-slate-200 p-4">
                    <p className="font-medium text-slate-900">{item.productName}</p><p className="mt-1 text-xs text-slate-500">來源 SKU：{item.sku || '未提供'}</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Field label="ECOUNT 品項編碼" value={value.erpSku || ''} onChange={event => mapping(item.sku, 'erpSku', event.target.value)} /><Field label="國際條碼" value={value.barcode || ''} placeholder="核對商品包裝後填入" onChange={event => mapping(item.sku, 'barcode', event.target.value)} /><Field label="ECOUNT 品項名稱" value={value.erpName || ''} placeholder={item.productName} onChange={event => mapping(item.sku, 'erpName', event.target.value)} /><Field label="商品分類（選填）" value={value.category || ''} placeholder="依公司主檔填寫" onChange={event => mapping(item.sku, 'category', event.target.value)} /></div>
                    <Check checked={value.confirmed} onChange={checked => mapping(item.sku, 'confirmed', checked)}>已核對此商品的 ECOUNT 品項編碼與名稱。</Check>
                    {value.barcode ? <Check checked={value.barcodeConfirmed} onChange={checked => mapping(item.sku, 'barcodeConfirmed', checked)}>已核對實物商品條碼（選填，僅供預揀核對表標示）。</Check> : <p className="mt-1 text-xs text-amber-800">商品條碼待實物核對。</p>}
                </div>; })}</div>
                {parsed.summary.bundleComponentCount > 0 && <div className="mt-4 rounded-lg bg-amber-50 px-4 py-2"><Check checked={settings.bundleZeroConfirmed} onChange={checked => update('bundleZeroConfirmed', checked)}>確認本檔組合商品由主商品保留原組合價，其餘原檔未分價元件以 0 元入帳；元件仍依原數量出貨。這項確認不會把元件改成未出貨。</Check></div>}
                <h2 className="mt-6 font-semibold text-slate-950">4. 確認這次 ECOUNT 銷貨設定</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="商城店鋪" value={settings.store} onChange={event => update('store', event.target.value)} />
                    <Field label="ECOUNT 客戶／供應商編碼" help="請確認本次 1Shop 應使用哪個公司客戶帳。"><select className={inputClass} value={settings.customerCode} onChange={event => { const code = event.target.value; setSettings(previous => ({ ...previous, customerCode: code, customerName: code === '00095' ? '團購-萬魔未來工學院' : code === '00027' ? '萬魔 一頁式' : '' })); }}><option value="">請選擇已確認的客戶</option><option value="00095">00095 團購-萬魔未來工學院</option><option value="00027">00027 萬魔 一頁式</option></select></Field>
                    <Field label="發貨倉庫編碼" value={settings.warehouseCode} help="003 為工業店，請核對本次實際倉庫。" onChange={event => update('warehouseCode', event.target.value)} />
                    <Field label="銷貨日期" type="date" value={settings.date} onChange={event => update('date', event.target.value)} />
                    <Field label="銷貨追蹤單號（K 欄）" value={settings.batchNumber} maxLength={20} help="本頁產生 TEST 測試號；ERP 匯入前請確認未使用，重送前先查原單。" onChange={event => update('batchNumber', event.target.value)} />
                    <Field label="銷貨分組序號（B 欄）" value={settings.batchSequence} maxLength={4} help="同批商品列同一值，這不是商品 SN。" onChange={event => update('batchSequence', event.target.value)} />
                    <Field label="來源金額幣別" value={settings.currency} help="TWD 僅供核對金額；ERP 貨幣與匯率欄留空，使用 ERP 設定。" onChange={event => update('currency', event.target.value)} />
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-600">本次使用營業稅 11，商品與運費填入含稅單價；稅前金額與營業稅由 ECOUNT 依設定計算。</p>
                <Check checked={settings.taxConfirmed} onChange={checked => update('taxConfirmed', checked)}>已確認本次金額為 TWD，使用 ECOUNT 營業稅 11 及含稅單價，由 ERP 依設定計稅。</Check>
                {parsed.summary.shippingMinor > 0 && <div className="mt-4 rounded-lg border border-slate-200 p-4"><h3 className="text-sm font-semibold">運費另列，不進預揀商品表</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="ECOUNT 運費品項編碼" value={settings.shippingSku.erpSku} onChange={event => update('shippingSku', { ...settings.shippingSku, erpSku: event.target.value, confirmed: false, nonStock: false })} /><Field label="運費品項名稱" value={settings.shippingSku.name} onChange={event => update('shippingSku', { ...settings.shippingSku, name: event.target.value, confirmed: false, nonStock: false })} /></div><Check checked={settings.shippingSku.confirmed && settings.shippingSku.nonStock} onChange={checked => update('shippingSku', { ...settings.shippingSku, confirmed: checked, nonStock: checked })}>已確認此運費品項是無形商品／不管理庫存數量，沿用原訂單運費金額。</Check></div>}
                {parsed.summary.pendingOrderCount > 0 && <div className="mt-4 rounded-lg bg-amber-50 px-4 py-2"><Check checked={settings.pendingTestAcknowledged} onChange={checked => update('pendingTestAcknowledged', checked)}>已確認這兩筆未付款訂單僅用於本次核准測試。來源付款狀態保持不變，不標記為已付款或實收。</Check></div>}
            </fieldset>
            <section className={sectionClass}>
                <h2 className="font-semibold text-slate-950">5. 下載轉檔結果</h2>
                <p className="mt-2 text-sm text-slate-600">預揀與金額核對表可先下載，未確認欄位會標示待核對；ECOUNT 銷貨檔需完成下列必要設定。</p>
                {!!validation.issues?.length && <ul className="mt-3 space-y-2 text-sm" aria-label="轉檔檢查結果">{validation.issues.map((issue, index) => <li key={`${issue.code}:${index}`} className={issue.severity === 'warning' ? 'text-slate-600' : 'text-amber-900'}>{issue.orderNumber && <span className="font-medium">{issue.orderNumber}：</span>}{issue.message}</li>)}</ul>}
                {validation.ok && <p className="mt-3 text-sm text-emerald-800">所需欄位已確認，可以下載後核對 ECOUNT 上傳預覽。</p>}
                <div className="mt-4 flex flex-wrap gap-3"><Button disabled={locked || !validation.ok} onClick={() => download('ecount')}><Download size={16} className="mr-2" />下載 ECOUNT 銷貨檔（27 欄）</Button><Button variant="secondary" disabled={locked || !auditReady} onClick={() => download('audit')}><Download size={16} className="mr-2" />下載預揀與金額核對表</Button></div>
                <p className="mt-4 text-xs leading-6 text-slate-500">下載不代表 ERP 已建立或已扣庫。ECOUNT 儲存結果不明時先查原單；取得本次理貨明細並逐列核對後，再使用既有匯入入口載入 DEV WMS。請保存來源檔與核對表，這個頁面不保存轉檔紀錄。</p>
            </section>
        </>}
    </main>;
}
