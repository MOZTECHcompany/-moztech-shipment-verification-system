import React from 'react';
import { MessageSquare, Pin, ScanLine } from 'lucide-react';
import { usePinnedComments } from '@/api/usePinnedComments';

export function WorkstationBar({ orderId, user, voucher, stageLabel, remainingQty, onScan, onDiscussion }) {
    const { pinnedComments, isError, isPending, refetch } = usePinnedComments(orderId, user);
    return <section aria-label="作業快捷列" className="wms-workstation-bar mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1 text-sm">
                <span className="block truncate font-semibold text-slate-900">{voucher}</span>
                <span className="text-slate-600">{stageLabel}尚餘 <strong className="tabular-nums text-slate-900">{remainingQty}</strong> 件</span>
            </div>
            <button type="button" onClick={onDiscussion} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-slate-700 hover:bg-slate-100"><MessageSquare size={16} />訂單備註</button>
            <button type="button" onClick={onScan} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700"><ScanLine size={16} />回到掃碼輸入</button>
        </div>
        {isError ? <button type="button" onClick={() => refetch()} className="mt-2 text-sm text-amber-800">釘選留言載入失敗，點此重試</button> : isPending ? <p className="mt-2 text-xs text-slate-500">載入釘選留言…</p> : pinnedComments.length > 0 && (
            <button type="button" onClick={onDiscussion} className="mt-2 flex w-full min-w-0 items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-left text-sm text-amber-950">
                <Pin size={15} className="mt-0.5 shrink-0" /><span className="shrink-0 font-medium">我的釘選 {pinnedComments.length}</span>
                <span className="min-w-0 break-words line-clamp-2">{pinnedComments.map(comment => comment.content).join(' · ')}</span>
            </button>
        )}
    </section>;
}
