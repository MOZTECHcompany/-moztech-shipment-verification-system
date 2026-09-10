import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { format } from 'date-fns';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { AlertTriangle, ArrowRight, CheckCircle2, Database, FileDown, FileSpreadsheet, LayoutGrid, Loader2, TrendingUp, UploadCloud } from 'lucide-react';
import { PageHeader, Button } from '../../ui';

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const idleImport = { phase: 'idle' };
const managementLinks = [
    { to: '/admin/exceptions', title: '例外總覽', description: '檢視待處理、已確認與已解決的例外', icon: AlertTriangle },
    { to: '/admin/defects', title: '新品不良', description: '查詢不良品與 SN 更換紀錄', icon: AlertTriangle },
    { to: '/admin/scan-errors', title: '刷錯分析', description: '追蹤掃描錯誤與改善機會', icon: FileSpreadsheet },
];

function readRecovery(key) {
    try {
        const saved = JSON.parse(sessionStorage.getItem(key));
        if (saved?.fileName) return { phase: 'unknown', fileName: saved.fileName, voucherNumber: saved.voucherNumber };
    } catch { /* The current page still protects an import when storage is unavailable. */ }
    return idleImport;
}

function saveRecovery(key, value) {
    try {
        if (value) sessionStorage.setItem(key, JSON.stringify({ fileName: value.fileName, voucherNumber: value.voucherNumber }));
        else sessionStorage.removeItem(key);
    } catch { /* No file contents or customer information are persisted here. */ }
}

export function AdminDashboard({ user }) {
    const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
    const recoveryKey = `wms_import_recovery:${user?.id ?? 'current'}`;
    const [dateRange, setDateRange] = useState([null, null]);
    const [startDate, endDate] = dateRange;
    const [importState, setImportState] = useState(() => readRecovery(recoveryKey));
    const [exporting, setExporting] = useState(false);
    const [cleaning, setCleaning] = useState(false);
    const fileInputRef = useRef(null);
    const importInFlight = useRef(false);
    const unknownImport = useRef(importState.phase === 'unknown');
    const exportInFlight = useRef(false);
    const cleanupInFlight = useRef(false);
    const mounted = useRef(true);
    const importBlocked = importState.phase === 'uploading' || importState.phase === 'unknown';

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    useEffect(() => {
        if (!importBlocked) return undefined;
        const handleBeforeUnload = event => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [importBlocked]);

    const importFiles = async files => {
        if (importInFlight.current || unknownImport.current || !files?.length) return;
        const file = files[0];
        const fileName = file.name;
        if (files.length !== 1 || !/\.(xlsx|xls|csv)$/i.test(fileName) || file.size > MAX_IMPORT_BYTES || file.size === 0) {
            const message = files.length !== 1 ? '請一次選擇一個訂單檔案。'
                : file.size > MAX_IMPORT_BYTES ? '檔案不可超過 10 MiB，請縮小後重新選擇。'
                    : file.size === 0 ? '檔案是空的，請確認內容後重新選擇。'
                        : '請選擇 .xlsx、.xls 或 .csv 訂單檔案。';
            setImportState({ phase: 'error', fileName, message });
            return;
        }
        importInFlight.current = true;
        setImportState({ phase: 'uploading', fileName });
        // A reload or navigation during the request must not turn into a silent retry.
        saveRecovery(recoveryKey, { fileName });
        try {
            const body = new FormData();
            body.append('orderFile', file);
            const response = await apiClient.post('/api/orders/import', body, {
                headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000,
            });
            const data = response.data;
            if (response.status !== 201 || !data?.voucherNumber || !Number.isSafeInteger(data.orderId) || data.orderId <= 0) {
                throw new Error('匯入回應不完整，請先核對作業看板。');
            }
            saveRecovery(recoveryKey, null);
            if (mounted.current) {
                setImportState({ ...data, phase: 'success', fileName });
                toast.success(`訂單「${data.voucherNumber}」已成功匯入`);
            }
        } catch (error) {
            const data = error.response?.data || {};
            const status = error.response?.status;
            let result;
            if (data.code === 'IMPORT_ALREADY_EXISTS') {
                result = { phase: 'duplicate', fileName, voucherNumber: data.voucherNumber, orderId: data.orderId };
                saveRecovery(recoveryKey, null);
            } else if (data.code === 'IMPORT_NOT_APPLIED' || [401, 403, 413, 429].includes(status)) {
                result = { phase: 'error', fileName, message: data.message || '未建立訂單，請確認檔案或登入狀態後再試。' };
                saveRecovery(recoveryKey, null);
            } else {
                unknownImport.current = true;
                result = { phase: 'unknown', fileName, voucherNumber: data.voucherNumber };
                saveRecovery(recoveryKey, result);
            }
            if (mounted.current) setImportState(result);
        } finally {
            importInFlight.current = false;
        }
    };

    const handleExcelImport = event => {
        const files = Array.from(event.target.files || []);
        event.target.value = '';
        return importFiles(files);
    };

    const handleDrop = event => {
        event.preventDefault();
        event.stopPropagation();
        return importFiles(Array.from(event.dataTransfer.files || []));
    };

    const resetUnknownImport = () => {
        if (importInFlight.current) return;
        unknownImport.current = false;
        saveRecovery(recoveryKey, null);
        setImportState(idleImport);
    };

    const handleExportAdminReport = async () => {
        if (exportInFlight.current) return;
        if (!startDate || !endDate) { toast.error('請選擇完整的日期範圍'); return; }
        exportInFlight.current = true;
        setExporting(true);
        const from = format(startDate, 'yyyy-MM-dd');
        const to = format(endDate, 'yyyy-MM-dd');
        try {
            const response = await apiClient.get('/api/reports/export', { params: { startDate: from, endDate: to }, responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            try {
                link.href = url;
                link.download = `營運報告_${from}_至_${to}.csv`;
                document.body.appendChild(link);
                link.click();
            } finally { link.remove(); window.URL.revokeObjectURL(url); }
            if (mounted.current) toast.success('營運報告已下載');
        } catch {
            if (mounted.current) toast.error('報告產生失敗，請確認連線與權限後重試。');
        } finally {
            exportInFlight.current = false;
            if (mounted.current) setExporting(false);
        }
    };

    const handleRetention = async () => {
        if (!import.meta.env.DEV || cleanupInFlight.current) return;
        cleanupInFlight.current = true;
        setCleaning(true);
        try {
            await apiClient.post('/api/admin/maintenance/retention/run', {});
            if (mounted.current) toast.success('資料清理完成');
        } catch {
            if (mounted.current) toast.error('未能確認資料清理結果，請查核後再操作。');
        } finally {
            cleanupInFlight.current = false;
            if (mounted.current) setCleaning(false);
        }
    };

    const resultColor = importState.phase === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
        : ['unknown', 'duplicate'].includes(importState.phase) ? 'border-amber-200 bg-amber-50 text-amber-950'
            : importState.phase === 'error' ? 'border-red-200 bg-red-50 text-red-950' : 'border-blue-200 bg-blue-50 text-blue-950';

    return (
        <div className="bg-transparent pb-8">
            <div className="w-full">
                <PageHeader title="出貨管理" actions={
                    <Button as={Link} to="/tasks" className="gap-2"><LayoutGrid size={18} />前往作業看板</Button>
                } />

                <div className="grid gap-5 lg:grid-cols-3">
                    <section aria-labelledby="import-title" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-7 lg:col-span-2">
                        <div className="flex items-start gap-3">
                            <div className="rounded-xl bg-blue-50 p-3 text-blue-600"><UploadCloud size={22} /></div>
                            <div><h2 id="import-title" className="text-xl font-semibold text-slate-900">匯入出貨單</h2><p className="mt-1 text-sm text-slate-500">建立新的揀貨與裝箱核對任務</p></div>
                        </div>
                        <div data-testid="import-dropzone" onDrop={handleDrop} onDragOver={event => { event.preventDefault(); event.stopPropagation(); }} aria-busy={importState.phase === 'uploading'}
                            className={`mt-5 rounded-xl border-2 border-dashed p-6 text-center ${importBlocked ? 'border-slate-200 bg-slate-50' : 'border-blue-200 bg-blue-50/40'}`}>
                            <FileSpreadsheet size={30} className="mx-auto mb-3 text-blue-600" />
                            <p className="text-sm font-medium text-slate-700">將一個出貨單檔案拖放至此</p>
                            <Button type="button" disabled={importBlocked} onClick={() => fileInputRef.current?.click()} className="mt-4 gap-2" variant="secondary">
                                {importState.phase === 'uploading' && <Loader2 size={16} className="animate-spin" />}
                                {importState.phase === 'uploading' ? '正在處理訂單' : '選擇訂單檔案'}
                            </Button>
                            <input data-testid="import-file" type="file" ref={fileInputRef} onChange={handleExcelImport} disabled={importBlocked} accept=".xlsx,.xls,.csv" className="hidden" aria-label="訂單檔案" />
                            <details className="mt-3 text-xs leading-5 text-slate-500"><summary className="cursor-pointer py-2">檔案格式與限制</summary><p>支援 .xlsx、.xls、.csv，最大 10 MiB<br />每單最多 5,000 列、1,000 個品項、10,000 筆 SN，總數量 50,000</p></details>
                        </div>

                        {importState.phase !== 'idle' && <div data-testid="import-result" role={['error', 'unknown'].includes(importState.phase) ? 'alert' : 'status'} aria-live="polite" className={`mt-4 rounded-xl border p-4 text-sm ${resultColor}`}>
                            <p className="mb-2 break-all text-xs opacity-80">{importState.fileName}</p>
                            {importState.phase === 'uploading' && <><p className="flex items-center gap-2 font-semibold"><Loader2 size={17} className="animate-spin" />正在驗證檔案並建立訂單</p><p className="mt-2 leading-6">請保持此頁開啟，完成前請勿重複上傳。</p></>}
                            {importState.phase === 'success' && <><p className="flex items-center gap-2 font-semibold"><CheckCircle2 size={17} />訂單 {importState.voucherNumber} 已成功匯入</p><p className="mt-2">{importState.itemCount} 個品項 · 總數量 {importState.totalQuantity} · {importState.serialCount} 筆 SN</p></>}
                            {importState.phase === 'duplicate' && <><p className="font-semibold">訂單 {importState.voucherNumber} 已存在，未重複建立</p><p className="mt-2 leading-6">請開啟既有訂單核對內容。若需修正訂單，請依現有管理流程處理。</p></>}
                            {importState.phase === 'error' && <><p className="font-semibold">匯入未完成，未建立訂單</p><p className="mt-2 whitespace-pre-wrap leading-6">{importState.message}</p><p className="mt-2">修正後可重新選擇檔案。</p></>}
                            {importState.phase === 'unknown' && <><p className="flex items-center gap-2 font-semibold"><AlertTriangle size={17} />尚未確認匯入結果</p><p className="mt-2 leading-6">{importState.voucherNumber && `訂單 ${importState.voucherNumber}：`}請先到作業看板核對訂單是否已建立。連線中斷或等候逾時不代表匯入失敗，請勿直接重送。</p><p className="mt-2 leading-6">若訂單已存在，請繼續使用該訂單；確認沒有建立後，才重新選擇檔案。</p></>}
                            <div className="mt-3 flex flex-wrap items-center gap-3">
                                {['success', 'duplicate'].includes(importState.phase) && Number.isSafeInteger(importState.orderId) && importState.orderId > 0 && <Link to={`/order/${importState.orderId}`} className="font-semibold underline underline-offset-4">開啟訂單</Link>}
                                {importState.phase === 'unknown' && <><Link to="/tasks" className="font-semibold underline underline-offset-4">前往作業看板核對</Link><button type="button" data-testid="import-reset-unknown" onClick={resetUnknownImport} className="rounded-lg border border-amber-300 bg-white px-3 py-2 font-medium hover:bg-amber-50">已核對，重新選擇檔案</button></>}
                            </div>
                        </div>}
                    </section>

                    <aside className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 md:p-7">
                        <h2 className="text-base font-semibold text-slate-900">出貨作業</h2>
                        <p className="mt-2 text-sm text-slate-500">認領任務、揀貨與裝箱核對</p>
                        <Button as={Link} to="/tasks" variant="secondary" className="mt-5 justify-between">開啟工作台<ArrowRight size={17} /></Button>
                        <Button as={Link} to="/team" variant="ghost" className="mt-2 justify-between">團隊公告<ArrowRight size={17} /></Button>
                    </aside>
                </div>

                {isAdmin && <>
                    <h2 className="mb-4 mt-8 text-base font-semibold text-slate-900">常用工具</h2>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{managementLinks.map(({ to, title, description, icon }) => <Link key={to} to={to} className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-blue-300 hover:bg-blue-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                        {React.createElement(icon, { size: 20, className: 'mt-0.5 shrink-0 text-slate-500 group-hover:text-blue-600' })}<div className="min-w-0 flex-1"><h3 className="font-semibold text-slate-800">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div><ArrowRight size={16} className="mt-1 text-slate-400" />
                    </Link>)}</div>

                    <div className="mt-5 grid gap-5 lg:grid-cols-3">
                        <section aria-labelledby="report-title" className={`rounded-2xl border border-slate-200 bg-white p-5 md:p-7 ${import.meta.env.DEV ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
                            <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="report-title" className="flex items-center gap-2 text-base font-semibold text-slate-900"><FileDown size={19} className="text-slate-500" />報表與分析</h2><Link to="/admin/analytics" className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-blue-700 hover:bg-blue-50"><TrendingUp size={17} />數據分析<ArrowRight size={15} /></Link></div>
                            <p className="mt-2 text-sm text-slate-500">依日期範圍下載 CSV 報表。</p>
                            <div className="mt-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-end"><div className="flex-1"><label htmlFor="report-dates" className="mb-2 block text-xs font-medium text-slate-600">日期範圍</label><DatePicker id="report-dates" selectsRange startDate={startDate} endDate={endDate} onChange={setDateRange} isClearable dateFormat="yyyy/MM/dd" disabled={exporting} className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100" placeholderText="選擇起訖日期" /></div><Button type="button" onClick={handleExportAdminReport} disabled={!startDate || !endDate || exporting} variant="secondary" className="gap-2 whitespace-nowrap">{exporting && <Loader2 size={16} className="animate-spin" />}{exporting ? '正在產生報告' : '下載報告'}</Button></div>
                        </section>
                        {import.meta.env.DEV && <section aria-labelledby="retention-title" className="rounded-2xl border border-slate-200 bg-white p-5 md:p-7"><h2 id="retention-title" className="flex items-center gap-2 text-base font-semibold text-slate-900"><Database size={19} className="text-slate-500" />資料清理</h2><p className="mb-4 mt-2 text-sm leading-6 text-slate-500">依既有資料保留設定清理過期資料。</p><Button type="button" onClick={handleRetention} disabled={cleaning} variant="ghost" className="gap-2">{cleaning && <Loader2 size={16} className="animate-spin" />}{cleaning ? '正在清理資料' : '執行資料清理'}</Button></section>}
                    </div>
                </>}
                <p className="mt-10 text-center text-xs text-slate-400">© {new Date().getFullYear()} Corely AI</p>
            </div>
        </div>
    );
}
