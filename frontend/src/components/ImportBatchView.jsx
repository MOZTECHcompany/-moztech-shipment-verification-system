import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react';
import apiClient from '@/api/api.js';
import { Button } from '@/ui';
import { BatchPrintLabels } from './LabelPrinter';
import { sourceOrderLabel } from '../utils/sourceOrders';
import { batchSessionMatches, createBatchReader, importBatchId } from '../utils/importBatches';

const statuses = { pending: '待揀貨', picking: '揀貨中', picked: '待裝箱', packing: '裝箱中', completed: '核對完成', voided: '已作廢' };
const number = value => Number(value ?? 0).toLocaleString('zh-TW');
const timestamp = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-TW', { hour12: false });
};
const cell = 'px-4 py-3 text-left align-top';

export function ImportBatchView({ user }) {
    const { batchId } = useParams();
    const id = importBatchId(batchId);
    return <BatchDetail key={`${user.id}:${user.role}:${batchId}`} user={user} batchId={id} />;
}

function BatchDetail({ user, batchId }) {
    const [state, setState] = useState({ phase: 'idle', data: null, cursor: null });
    const [cursors, setCursors] = useState([null]);
    const [pageIndex, setPageIndex] = useState(0);
    const reader = useRef(null);
    const session = useRef(null);
    if (!session.current) {
        let token;
        try { token = JSON.parse(localStorage.getItem('wms_token')); } catch { /* Invalid sessions cannot load data. */ }
        session.current = () => batchSessionMatches(localStorage, user, token);
    }

    useEffect(() => {
        if (!batchId) return undefined;
        const current = createBatchReader({ api: apiClient, batchId, onState: setState, isCurrentSession: session.current });
        reader.current = current;
        current.load();
        const onStorage = event => {
            if ((!event.key || ['wms_user', 'wms_token'].includes(event.key)) && !session.current()) current.sessionChanged();
        };
        window.addEventListener('storage', onStorage);
        return () => { current.dispose(); window.removeEventListener('storage', onStorage); };
    }, [batchId]);

    const movePage = async (cursor, index) => {
        if (!await reader.current?.load(cursor)) return;
        setCursors(previous => [...previous.slice(0, index), cursor]);
        setPageIndex(index);
    };
    const data = state.data;
    const busy = state.phase === 'loading' || state.phase === 'idle';
    const summary = data?.summary;
    const printable = data?.printableWorkOrderIds.map(id => ({ id })) || [];

    return <main data-testid="batch-overview" className="mx-auto max-w-7xl space-y-5 pb-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
                <Link to="/tasks" className="mb-3 inline-flex min-h-10 items-center gap-2 text-sm font-medium text-blue-700"><ArrowLeft size={16} />返回作業看板</Link>
                <p className="text-sm font-medium text-slate-500">理貨批次</p>
                <h1 className="mt-1 break-all text-2xl font-semibold text-slate-950">{data?.batch.batch_number || (batchId ? '載入理貨批次' : '批次編號無效')}</h1>
                {data && <p className="mt-2 text-sm text-slate-500">{timestamp(data.batch.created_at)} 匯入 · {data.batch.created_by_name || '未記錄匯入人員'}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
                <Button variant="secondary" data-testid="batch-refresh" disabled={!batchId || busy || state.phase === 'sessionChanged'} onClick={() => reader.current?.load(state.cursor)}><RefreshCw size={16} className={`mr-2 ${busy ? 'animate-spin' : ''}`} />更新批次進度</Button>
                {state.phase === 'ready' && <BatchPrintLabels orders={printable} isCurrentSession={session.current} expectedBatchId={batchId} />}
            </div>
        </div>
        {!batchId && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">請從匯入結果或商城工作單開啟有效的理貨批次。</p>}
        {batchId && busy && <p role="status" className="text-sm text-slate-600">{data ? '正在更新批次進度…' : '正在載入批次與工作單…'}</p>}
        {state.message && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p>{state.message}</p>{data && <p className="mt-1">以下保留上次載入的資料，請更新後再列印。</p>}</div>}
        {data && <>
            <section aria-label="批次數量與進度" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                <dl className="grid grid-cols-2 gap-5 lg:grid-cols-4">
                    <Metric label="商城工作單" value={number(summary.workOrderCount)} detail={`未作廢 ${number(summary.activeWorkOrderCount)} 張 · 已作廢 ${number(summary.voidedTotals.workOrderCount)} 張`} />
                    <Metric label="品項明細" value={number(summary.itemCount)} detail="未作廢工作單的商品列數" />
                    <Metric label="商品總件數" value={number(summary.totalQuantity)} detail="未作廢工作單的應核對件數" />
                    <Metric label="SN 總數" value={number(summary.serialCount)} detail={Number(summary.serialMismatchCount) ? `${number(summary.serialMismatchCount)} 列 SN 數量待核對` : '依匯入的商品序號計算'} />
                </dl>
                <dl className="mt-5 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-3">
                    <Metric label="已揀貨" value={`${number(summary.pickedQuantity)} / ${number(summary.totalQuantity)}`} />
                    <Metric label="已裝箱" value={`${number(summary.packedQuantity)} / ${number(summary.totalQuantity)}`} />
                    <Metric label="核對完成工作單" value={`${number(summary.statusCounts.completed)} / ${number(summary.activeWorkOrderCount)}`} />
                </dl>
                <div className="mt-4 flex flex-wrap gap-2" aria-label="工作單狀態分布">{Object.entries(statuses).map(([key, label]) => <span key={key} className={`rounded-lg px-2.5 py-1 text-xs font-medium ${key === 'voided' ? 'bg-slate-100 text-slate-500' : 'bg-blue-50 text-blue-800'}`}>{label} {number(summary.statusCounts[key])}</span>)}</div>
                {Number(summary.voidedTotals.workOrderCount) > 0 && <p className="mt-3 text-sm text-slate-600" data-testid="batch-voided-summary">已作廢 {number(summary.voidedTotals.workOrderCount)} 張、{number(summary.voidedTotals.itemCount)} 個品項、{number(summary.voidedTotals.totalQuantity)} 件；未納入商品總表、核對進度與批量列印。</p>}
                <p className="mt-3 text-xs text-slate-500">進度更新於 {timestamp(state.loadedAt)}。請在作業看板掃描各張工作單認領揀貨或裝箱。</p>
            </section>

            <section aria-labelledby="batch-products-title" className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="p-4 sm:p-5"><h2 id="batch-products-title" className="font-semibold text-slate-900">商品總表</h2><p className="mt-1 text-sm text-slate-500">整批未作廢工作單，依品項編碼與國際條碼分別加總。</p></div>
                <div className="overflow-x-auto"><table aria-label="批次商品總表" className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-600"><tr>{['品項編碼', '商品名稱', '國際條碼', '工作單數', '總數量', '已揀貨', '已裝箱'].map(label => <th key={label} className={`${cell} whitespace-nowrap font-medium`}>{label}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-100">{data.productTotals.map(product => <tr key={JSON.stringify([product.product_code, product.barcode])}>
                        <td className={`${cell} font-medium text-slate-900`}>{product.product_code || '未提供'}</td>
                        <td className={`${cell} min-w-40`}>{product.product_names.join(' / ') || '未提供名稱'}</td>
                        <td className={`${cell} whitespace-nowrap font-mono text-xs`}>{product.barcode || '未提供'}</td>
                        <td className={cell}>{number(product.work_order_count)}</td><td className={`${cell} font-semibold`}>{number(product.total_quantity)}</td><td className={cell}>{number(product.picked_quantity)}</td><td className={cell}>{number(product.packed_quantity)}</td>
                    </tr>)}</tbody>
                </table></div>
                {!data.productTotals.length && <p className="p-5 text-sm text-slate-500">此批次目前沒有未作廢商品。</p>}
            </section>

            <section aria-labelledby="batch-children-title" className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5"><div><h2 id="batch-children-title" className="font-semibold text-slate-900">商城工作單</h2><p className="mt-1 text-sm text-slate-500">每張工作單各自認領、核對；作廢單保留查閱。</p></div><Link to="/tasks" className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-blue-700">前往作業看板認領<ArrowRight size={16} /></Link></div>
                <div className="overflow-x-auto"><table aria-label="商城工作單列表" className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-600"><tr>{['商城訂單 / 工作單', '狀態', '揀貨負責人', '裝箱負責人', '揀貨件數', '裝箱件數', ''].map(label => <th key={label} className={`${cell} whitespace-nowrap font-medium`}>{label}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-100">{data.children.map(order => <tr key={order.id} className={order.status === 'voided' ? 'bg-slate-50 text-slate-500' : ''}>
                        <td className={`${cell} min-w-56`}><p className="break-all font-medium">{sourceOrderLabel(order) || order.voucher_number}</p><p className="mt-1 break-all font-mono text-xs text-slate-500">{order.work_barcode || order.voucher_number}</p></td>
                        <td className={`${cell} whitespace-nowrap`}>{statuses[order.status] || '狀態待確認'}</td><td className={cell}>{order.picker_name || '尚未認領'}</td><td className={cell}>{order.packer_name || '尚未認領'}</td>
                        <td className={`${cell} whitespace-nowrap tabular-nums`}>{number(order.picked_quantity)} / {number(order.total_quantity)}</td><td className={`${cell} whitespace-nowrap tabular-nums`}>{number(order.packed_quantity)} / {number(order.total_quantity)}</td>
                        <td className={cell}><Link data-testid={`batch-order-${order.id}`} to={`/order/${order.id}`} className="inline-flex min-h-10 items-center whitespace-nowrap font-semibold text-blue-700 underline underline-offset-4">開啟工作單</Link></td>
                    </tr>)}</tbody>
                </table></div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 p-4 text-sm"><span className="text-slate-500">第 {pageIndex + 1} 頁 · 本頁 {data.children.length} 張 / 全批 {number(data.pagination.totalWorkOrders)} 張</span><div className="flex gap-2"><Button variant="secondary" disabled={busy || pageIndex === 0} onClick={() => movePage(cursors[pageIndex - 1], pageIndex - 1)}>上一頁</Button><Button variant="secondary" disabled={busy || !data.pagination.nextCursor} onClick={() => movePage(data.pagination.nextCursor, pageIndex + 1)}>下一頁</Button></div></div>
            </section>
        </>}
    </main>;
}

function Metric({ label, value, detail }) {
    return <div><dt className="text-xs font-medium text-slate-500">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</dd>{detail && <dd className="mt-1 text-xs text-slate-500">{detail}</dd>}</div>;
}
