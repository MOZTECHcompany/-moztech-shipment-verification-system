import React from 'react';
import { Box, Camera, Check, CheckCheck, FileDown, Maximize2, Minimize2, Package, ScanLine, TriangleAlert, Users, XCircle } from 'lucide-react';
import { ShippingLabel, PickingList } from './LabelPrinter';

const stages = [
  { label: '待揀貨', icon: Package },
  { label: '揀貨核對', icon: ScanLine },
  { label: '裝箱驗證', icon: Box },
  { label: '核對完成', icon: CheckCheck },
];
const statusIndex = { pending: 0, picking: 1, picked: 2, packing: 2, completed: 3 };
const statusLabel = { pending: '待揀貨', picking: '揀貨中', picked: '待裝箱', packing: '裝箱中', completed: '核對完成', voided: '已作廢' };
const actionClass = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50';

export function WarehouseOrderHeader({ stats, onExport, onVoid, user, onOpenCamera, onOpenDefectModal, activeSessions = [], order, items, isFocusMode, toggleFocusMode }) {
  const stage = statusIndex[order.status];
  const canManageDefect = ['admin', 'superadmin'].includes(user?.role)
    || (user?.role === 'dispatcher' && Number(order.imported_by_user_id) === Number(user.id));
  const metrics = [
    { label: '品項完成度', value: stats.packedSkus, total: stats.totalSkus },
    { label: '應核對件數', value: stats.totalQuantity, total: null },
    { label: '已揀貨', value: stats.totalPickedQty, total: stats.totalQuantity },
    { label: '已裝箱', value: stats.totalPackedQty, total: stats.totalQuantity },
  ];
  return (
    <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" aria-label="訂單與作業進度">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-xs font-semibold tracking-wider text-slate-500">出貨核對</p>
          <h1 className="break-all text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">{order.voucher_number}</h1>
          <p className="mt-1 break-words text-sm text-slate-600">{order.customer_name || '未指定客戶'}</p>
        </div>
        <span className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${order.status === 'voided' ? 'bg-red-50 text-red-700' : order.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>{statusLabel[order.status] || '狀態待確認'}</span>
      </div>
      {stage !== undefined && !isFocusMode && (
        <ol className="my-4 grid grid-cols-4 gap-1 sm:gap-3" aria-label="倉庫核對流程">
          {stages.map(({ label, icon }, index) => { const Icon = icon; return (
            <li key={label} aria-current={index === stage ? 'step' : undefined} className={`flex min-w-0 flex-col gap-2 border-t-2 pt-2 sm:flex-row sm:items-center ${index <= stage ? 'border-blue-600' : 'border-slate-200'}`}>
              <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${index < stage || order.status === 'completed' ? 'bg-blue-600 text-white' : index === stage ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-400'}`}>{index < stage || order.status === 'completed' ? <Check size={13} /> : <Icon size={13} />}</span>
              <span className={`text-xs font-medium ${index <= stage ? 'text-slate-800' : 'text-slate-500'}`}>{label}</span>
            </li>
          ); })}
        </ol>
      )}
      {order.status === 'completed' && <p className="my-3 text-sm text-emerald-800">所有品項已完成揀貨與裝箱核對。</p>}
      {order.status === 'voided' && <p className="my-3 text-sm text-red-700">此作業單已作廢，請確認後續安排。</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <button type="button" aria-pressed={isFocusMode} onClick={toggleFocusMode} className={`${actionClass} ${isFocusMode ? '!border-blue-600 !bg-blue-600 !text-white' : ''}`}>
          {isFocusMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}{isFocusMode ? '退出專注' : '專注模式'}
        </button>
        <button type="button" onClick={onOpenCamera} className={actionClass}><Camera size={16} />相機掃描</button>
        {canManageDefect && order.status !== 'voided' && <button type="button" onClick={onOpenDefectModal} className={`${actionClass} !text-orange-700`}><TriangleAlert size={16} />新品不良異動</button>}
        <ShippingLabel order={order} items={items} className={actionClass} />
        <PickingList order={order} items={items} className={actionClass} />
        <button type="button" onClick={onExport} className={actionClass}><FileDown size={16} />匯出出貨明細</button>
        {['admin', 'superadmin'].includes(user.role) && <button type="button" onClick={onVoid} className={`${actionClass} !text-red-700`}><XCircle size={16} />作廢訂單</button>}
        {activeSessions.length > 0 && <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-slate-500"><Users size={14} />{activeSessions.length} 人正在查看</span>}
      </div>
      {!isFocusMode && <dl className="mt-4 grid grid-cols-2 gap-y-3 divide-x divide-slate-200 rounded-xl bg-slate-50 py-3 sm:grid-cols-4">
        {metrics.map(({ label, value, total }) => <div key={label} className="px-3 sm:px-4"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{value}<span className="ml-1 text-xs font-normal text-slate-500">{total !== null ? `/ ${total}` : '件'}</span></dd></div>)}
      </dl>}
    </section>
  );
}
