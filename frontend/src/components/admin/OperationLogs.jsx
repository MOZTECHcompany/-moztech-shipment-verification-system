import React, { useEffect, useId, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Download, RefreshCw, Search, X } from 'lucide-react';
import apiClient from '@/api/api.js';
import { socket } from '@/api/socket.js';
import { Badge, Button, Card, EmptyState, PageHeader, Skeleton } from '../../ui';
import {
    actions, actionLabel, actionVariant, logActor, logDetailFields, logFilterError, logFilterParams, logRole,
    keywordOnlyLogFilters, logStage, logSummary, logTime, operationLogsCSV, parseLogDetails, readLogFilters,
    smartLogSearchFilters, taipeiDay,
} from '../../utils/operationLogs';

const field = 'w-full min-w-0 min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
const label = 'grid min-w-0 gap-1.5 text-sm font-medium text-slate-700';
const pageSizes = ['25', '50', '100', '200', '500'];

function useLogRequest(path, search, enabled = true, refresh = 0) {
    const [result, setResult] = useState(null);
    const session = apiClient.getSessionIdentity();
    useEffect(() => {
        if (!enabled) return;
        const request = new AbortController();
        const current = () => !request.signal.aborted && session === apiClient.getSessionIdentity();
        apiClient.get(path, { params: new URLSearchParams(search), signal: request.signal, skipErrorReporting: true })
            .then(({ data }) => {
                if (current()) setResult({ search, refresh, session, data });
            })
            .catch(error => {
                if (current()) setResult({ search, refresh, session, error: error.message || '無法載入，請再試一次。' });
            });
        return () => request.abort();
    }, [path, search, enabled, refresh, session]);
    return enabled && result?.search === search && result.refresh === refresh && result.session === session ? result : null;
}

function downloadCSV(logs) {
    const url = URL.createObjectURL(new Blob(['\uFEFF', operationLogsCSV(logs)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `操作日誌_${taipeiDay()}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function LogDetail({ log, onClose }) {
    const dialog = useRef(null);
    const titleId = useId();
    useEffect(() => {
        const el = dialog.current;
        el.showModal();
        return () => { if (el.open) el.close(); };
    }, []);
    const { day, time } = logTime(log.created_at);
    const details = parseLogDetails(log.details);
    const fields = logDetailFields(details);
    return (
        <dialog ref={dialog} aria-labelledby={titleId}
            onCancel={event => { event.preventDefault(); onClose(); }}
            className="m-auto w-[calc(100%-2rem)] max-w-xl rounded-2xl border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40">
            <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 p-4 sm:px-6">
                    <div>
                        <h2 id={titleId} className="font-semibold text-slate-950">操作詳情</h2>
                        <p className="mt-1 text-xs text-slate-500">日誌 #{log.id} · {day} {time}（台灣）</p>
                    </div>
                    <Button type="button" variant="secondary" size="sm" aria-label="關閉詳情" onClick={onClose}><X size={18} /></Button>
                </div>
                <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain p-4 sm:px-6">
                    <dl className="grid grid-cols-2 gap-3 text-sm">
                        {[
                            ['操作', actionLabel(log.action_type)], ['工序', logStage(log)],
                            ['操作人員', logActor(log)], ['當時帳號身分', logRole(log)],
                            ['訂單', log.order_id ? <Link to={`/order/${log.order_id}`} className="text-blue-700 underline underline-offset-2">{log.voucher_number || `#${log.order_id}`}</Link> : log.voucher_number || '—'],
                            ['客戶', log.customer_name || '—'],
                        ].map(([key, value]) => <div key={key} className="min-w-0 break-words"><dt className="text-xs text-slate-500">{key}</dt><dd className="mt-1 font-medium text-slate-900">{value}</dd></div>)}
                    </dl>
                    <div>
                        <h3 className="mb-2 text-sm font-semibold text-slate-800">詳細記錄</h3>
                        {fields.length > 0 && (
                            <dl className="mb-2 divide-y divide-slate-100 rounded-xl bg-slate-50 px-3 text-sm">
                                {fields.map(({ key, label, value }) => <div key={key} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 py-2">
                                    <dt className="text-slate-600">{label}</dt><dd className="whitespace-pre-wrap break-words text-slate-900">{value}</dd>
                                </div>)}
                            </dl>
                        )}
                        {details == null || details === '' ? <p className="text-sm text-slate-600">這筆記錄沒有附加明細。</p>
                            : typeof details === 'string' ? <p className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{details}</p>
                            : <details className="rounded-xl border border-slate-200">
                                <summary className="cursor-pointer px-3 py-2 text-sm text-slate-700">原始記錄</summary>
                                <pre className="whitespace-pre-wrap break-words px-3 pb-3 text-xs leading-relaxed text-slate-700">{JSON.stringify(details, null, 2)}</pre>
                            </details>}
                    </div>
                </div>
            </div>
        </dialog>
    );
}

function LogResults({ applied, onKeywordOnly }) {
    const [cursors, setCursors] = useState([null]);
    const [refresh, setRefresh] = useState(0);
    const [hasUpdates, setHasUpdates] = useState(false);
    const [showStats, setShowStats] = useState(false);
    const [detail, setDetail] = useState(null);
    const resultsTitle = useRef(null);
    const filters = logFilterParams(applied);
    const statsQuery = new URLSearchParams(filters);
    statsQuery.delete('limit');
    const page = cursors.length;
    filters.set('limit', applied.limit);
    if (cursors[page - 1]) filters.set('cursor', cursors[page - 1]);

    const result = useLogRequest('/api/operation-logs', filters.toString(), true, refresh);
    const stats = useLogRequest('/api/operation-logs/stats', statsQuery.toString(), showStats, refresh);
    const logs = result?.data?.logs || [];
    useEffect(() => {
        const notify = () => setHasUpdates(true);
        socket.on('new_operation_log', notify);
        return () => socket.off('new_operation_log', notify);
    }, []);

    const refreshResults = () => {
        setCursors([null]);
        setHasUpdates(false);
        setRefresh(n => n + 1);
    };

    return (
        <Card aria-labelledby="operation-log-results" aria-busy={!result}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
                <div>
                    <h2 ref={resultsTitle} tabIndex={-1} id="operation-log-results" className="font-semibold text-slate-900">查詢結果</h2>
                    <p className="mt-1 text-xs text-slate-500" role="status">
                        {!result ? '正在查詢…' : result.error ? '查詢失敗' : `第 ${page} 頁 · 本頁 ${logs.length} 筆 · 最新操作在前`}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" size="sm" leadingIcon={RefreshCw} onClick={refreshResults}>重新整理</Button>
                    <Button type="button" variant="secondary" size="sm" leadingIcon={Download} onClick={() => downloadCSV(logs)} disabled={!logs.length}>匯出本頁 CSV</Button>
                </div>
            </div>
            {hasUpdates && (
                <div className="flex flex-wrap items-center justify-between gap-2 bg-blue-50 px-4 py-2.5 text-sm text-blue-900">
                    <span>有新操作記錄</span>
                    <button type="button" onClick={refreshResults} className="font-semibold underline underline-offset-2">更新查詢</button>
                </div>
            )}
            {!result ? <div className="space-y-4 p-5">{[1, 2, 3].map(n => <Skeleton key={n} className="h-10 w-full" />)}</div>
                : result.error ? <div role="alert" className="p-5 text-sm text-red-700">{result.error}</div>
                : logs.length === 0 ? <div className="p-5"><EmptyState
                    title="找不到符合的操作" description="搜尋會同時套用上方顯示的條件。試試只查關鍵字，或放寬操作日期。"
                    action={onKeywordOnly ? '只查關鍵字' : undefined} onAction={onKeywordOnly} /></div>
                : (
                    <>
                    <div aria-hidden="true" className="hidden grid-cols-[7rem_minmax(0,1.25fr)_minmax(0,1.25fr)_minmax(0,1fr)_auto] gap-x-3 bg-slate-50 px-5 py-2 text-xs font-semibold text-slate-600 lg:grid">
                        <span>時間（台灣）</span><span>訂單／客戶</span><span>操作</span><span>操作人員</span><span className="w-12">明細</span>
                    </div>
                    <ul className="divide-y divide-slate-100" aria-label="操作記錄">
                        {logs.map(log => {
                            const { day, time } = logTime(log.created_at);
                            const summary = logSummary(log);
                            const order = log.voucher_number || (log.order_id ? `#${log.order_id}` : '—');
                            return (
                                <li key={log.id} className="grid min-w-0 grid-cols-[1fr_auto] items-start gap-x-3 gap-y-2 px-4 py-3 text-sm hover:bg-slate-50/70 sm:px-5 lg:grid-cols-[7rem_minmax(0,1.25fr)_minmax(0,1.25fr)_minmax(0,1fr)_auto] lg:items-center">
                                    <div className="col-start-1 row-start-1 text-xs tabular-nums text-slate-600">
                                        {day} <span className="lg:block lg:mt-0.5">{time}</span>
                                    </div>
                                    <div className="col-start-1 row-start-2 min-w-0 lg:col-start-2 lg:row-start-1">
                                        {log.order_id ? <Link to={`/order/${log.order_id}`} className="break-words font-semibold text-blue-700 hover:underline">{order}</Link> : <span className="font-medium text-slate-800">{order}</span>}
                                        {log.customer_name && <div className="mt-0.5 break-words text-xs text-slate-600">{log.customer_name}</div>}
                                    </div>
                                    <div className="col-start-1 row-start-3 min-w-0 lg:col-start-3 lg:row-start-1">
                                        <Badge variant={actionVariant(log.action_type)} className="max-w-full break-all">{actionLabel(log.action_type)}</Badge>
                                        {summary && <p className="mt-1 truncate text-xs text-slate-600">{summary}</p>}
                                    </div>
                                    <div className="col-start-1 row-start-4 min-w-0 lg:col-start-4 lg:row-start-1">
                                        <span className="break-words font-medium text-slate-900">{logActor(log)}</span>
                                        <p className="mt-0.5 break-words text-xs text-slate-500">
                                            {logRole(log)}{logStage(log) !== '—' && ` · ${logStage(log)}`}
                                            {parseLogDetails(log.details)?.operation_context === 'assistance' && ' · 協助'}
                                        </p>
                                    </div>
                                    <Button type="button" variant="secondary" size="sm" className="col-start-2 row-start-2 lg:col-start-5 lg:row-start-1"
                                        aria-label={`查看詳情，日誌 ${log.id}`} onClick={() => setDetail(log)}>詳情</Button>
                                </li>
                            );
                        })}
                    </ul>
                    </>
                )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 sm:px-5">
                <Button type="button" variant="secondary" size="sm" aria-expanded={showStats} onClick={() => setShowStats(v => !v)} trailingIcon={ChevronDown}>條件統計</Button>
                <nav aria-label="操作日誌分頁" className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="secondary" size="sm" leadingIcon={ChevronLeft} disabled={page <= 1 || !result} onClick={() => { setCursors(items => items.slice(0, -1)); resultsTitle.current?.focus(); }}>上一頁</Button>
                    <Button type="button" variant="secondary" size="sm" trailingIcon={ChevronRight} disabled={!result?.data?.nextCursor} onClick={() => { setCursors(items => [...items, result.data.nextCursor]); resultsTitle.current?.focus(); }}>下一頁</Button>
                </nav>
            </div>
            {showStats && (
                <div className="border-t border-slate-100 px-4 py-4 text-sm sm:px-5" aria-live="polite">
                    {!stats ? '正在統計符合條件的記錄…' : stats.error ? <p role="alert" className="text-red-700">{stats.error}</p> : (
                        <>
                            <p className="font-semibold text-slate-900">符合目前條件共 {stats.data.total} 筆</p>
                            <ul className="mt-2 flex flex-wrap gap-2">
                                {stats.data.byActionType.map(item => <li key={item.action_type}><Badge variant={actionVariant(item.action_type)}>{actionLabel(item.action_type)} · {item.count}</Badge></li>)}
                            </ul>
                        </>
                    )}
                </div>
            )}
            {detail && <LogDetail log={detail} onClose={() => setDetail(null)} />}
        </Card>
    );
}

export function OperationLogs() {
    const [params, setParams] = useSearchParams();
    const appliedKey = params.toString();
    const applied = readLogFilters(params);
    const [draft, setDraft] = useState(applied);
    const [filterError, setFilterError] = useState('');
    const [run, setRun] = useState(0);
    useEffect(() => {
        setDraft(readLogFilters(new URLSearchParams(appliedKey)));
        setFilterError('');
    }, [appliedKey]);

    const change = event => {
        const { name, value } = event.target;
        setDraft(current => ({ ...current, [name]: value }));
        setFilterError('');
    };
    const apply = next => {
        const error = logFilterError(next);
        setFilterError(error);
        if (error) return;
        const query = logFilterParams(next);
        setDraft(readLogFilters(query));
        if (query.toString() === appliedKey) setRun(value => value + 1);
        else setParams(query);
    };
    const quickSearch = draft.q.trim() === applied.q.trim() ? draft : smartLogSearchFilters(draft);
    const preset = (from, to) => apply({ ...quickSearch, startDate: taipeiDay(from), endDate: taipeiDay(to) });
    const chips = [
        ['q', applied.q, '關鍵字'], ['orderId', applied.orderId, '訂單'],
        ['userId', applied.userId, '人員 ID'], ['actionType', applied.actionType && actionLabel(applied.actionType), '操作'],
        ['workType', applied.workType && (applied.workType === 'pick' ? '揀貨' : applied.workType === 'pack' ? '裝箱' : applied.workType), '工序'],
        ['dates', (applied.startDate || applied.endDate) && `${applied.startDate || '不限'} ～ ${applied.endDate || '不限'}`, '操作日期'],
        ['limit', applied.limit !== '50' && applied.limit, '每頁筆數'],
    ].filter(([, value]) => value);
    const reset = () => apply(readLogFilters(new URLSearchParams()));

    return (
        <div className="mx-auto w-full max-w-[1480px] min-w-0 space-y-4 p-3 sm:p-6">
            <PageHeader title="操作日誌" description="查詢誰在什麼時候做了哪些操作"
                actions={<Button as={Link} to="/settings" variant="secondary" size="sm" leadingIcon={ArrowLeft}>返回設定</Button>} />
            <Card className="p-4 sm:p-5">
                <form onSubmit={event => { event.preventDefault(); apply(smartLogSearchFilters(draft)); }} className="space-y-3">
                    <label className={label} htmlFor="operation-log-search">智慧搜尋</label>
                    <div className="flex min-w-0 gap-2">
                        <div className="relative min-w-0 flex-1">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                            <input id="operation-log-search" name="q" value={draft.q} onChange={change} className={field + ' pl-9'}
                                placeholder="搜尋單號、人員、客戶、操作、條碼或 SN" autoComplete="off" maxLength={200} aria-describedby="operation-log-search-help" />
                        </div>
                        <Button type="submit" className="shrink-0">搜尋</Button>
                    </div>
                    <p id="operation-log-search-help" className="text-xs text-slate-600">
                        例如：20261022 出貨、2026/10/22 -22。日期可比對單號日期或實際操作日；「出貨」查裝箱操作。
                    </p>
                    {draft.q.trim() && draft.orderId && (
                        <p className="text-xs text-slate-600">按「搜尋」會取代舊單號條件；要同時套用請用「進階篩選」。</p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" variant={applied.actionType === 'pack' ? 'primary' : 'secondary'} size="sm"
                            aria-pressed={applied.actionType === 'pack'}
                            onClick={() => apply({ ...quickSearch, workType: '', actionType: applied.actionType === 'pack' ? '' : 'pack' })}>
                            只看裝箱
                        </Button>
                        <span className="text-xs font-medium text-slate-600">操作日期（台灣）</span>
                        {[[0, 0, '今天'], [-1, -1, '昨天'], [-6, 0, '近 7 天'], [-29, 0, '近 30 天']].map(([from, to, text]) => (
                            <Button key={text} type="button" variant="secondary" size="sm" aria-pressed={applied.startDate === taipeiDay(from) && applied.endDate === taipeiDay(to)}
                                onClick={() => preset(from, to)}>{text}</Button>
                        ))}
                    </div>
                    <details className="rounded-xl border border-slate-200">
                        <summary className="cursor-pointer rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700">進階篩選</summary>
                        <div className="grid grid-cols-1 gap-3 px-3 pb-3 sm:grid-cols-2 xl:grid-cols-4">
                            <label className={label}>訂單編號或 ID<input name="orderId" value={draft.orderId} onChange={change} className={field} /></label>
                            <label className={label}>使用者 ID<input name="userId" value={draft.userId} onChange={change} inputMode="numeric" className={field} /></label>
                            <label className={label}>操作類型<select name="actionType" value={draft.actionType} onChange={change} className={field}>
                                <option value="">所有操作</option>
                                {draft.actionType && !Object.hasOwn(actions, draft.actionType) && <option value={draft.actionType}>{draft.actionType}</option>}
                                {Object.keys(actions).map(type => <option key={type} value={type}>{actionLabel(type)}</option>)}
                            </select></label>
                            <label className={label}>工序<select name="workType" value={draft.workType} onChange={change} className={field}>
                                <option value="">所有工序</option><option value="pick">揀貨</option><option value="pack">裝箱</option>
                            </select></label>
                            <label className={label}>操作起日<input type="date" name="startDate" value={draft.startDate} onChange={change} className={field} /></label>
                            <label className={label}>操作迄日<input type="date" name="endDate" value={draft.endDate} onChange={change} className={field} /></label>
                            <label className={label}>每頁筆數<select name="limit" value={draft.limit} onChange={change} className={field}>
                                {!pageSizes.includes(draft.limit) && <option value={draft.limit}>{draft.limit} 筆</option>}
                                {pageSizes.map(size => <option key={size} value={size}>{size} 筆</option>)}
                            </select></label>
                            <div className="flex items-end"><Button type="button" variant="secondary" size="sm" onClick={() => apply(draft)}>套用篩選</Button></div>
                        </div>
                    </details>
                    {filterError && <p role="alert" className="text-sm text-red-700">{filterError}</p>}
                </form>
                {!!chips.length && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3" aria-label="已套用條件">
                        {chips.map(([key, value, name]) => (
                            <button key={key} type="button" aria-label={`移除${name}條件`}
                                onClick={() => apply(key === 'dates' ? { ...applied, startDate: '', endDate: '' } : { ...applied, [key]: '' })}
                                className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-blue-50 px-3 py-1.5 text-left text-xs font-medium text-blue-800 hover:bg-blue-100">
                                <span className="break-all">{name}：{value}</span><X size={13} className="shrink-0" aria-hidden="true" />
                            </button>
                        ))}
                        <button type="button" className="px-2 py-1.5 text-xs font-semibold text-slate-700 underline underline-offset-2" onClick={reset}>清除條件</button>
                    </div>
                )}
            </Card>
            <LogResults key={JSON.stringify([appliedKey, run, apiClient.getSessionIdentity()])} applied={applied}
                onKeywordOnly={applied.q && chips.some(([key]) => !['q', 'limit'].includes(key))
                    ? () => apply(keywordOnlyLogFilters(applied)) : undefined} />
        </div>
    );
}
