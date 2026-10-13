import React from 'react';
import { Box, Package, Loader2 } from 'lucide-react';
import { useWorkMode } from '../contexts/WorkModeContext';
import { workStageLabel } from '../utils/workCapabilities';

export function WorkModeControls({ disabled = false, onSelect, prompt = false }) {
    const { stage, selectStage, workTypes, loading, choosing, error, assignment, recommendedStage, reload } = useWorkMode();
    if (!workTypes.length) return null;
    const select = async next => {
        if (disabled || loading || choosing || next === stage) return;
        if (onSelect) await onSelect(next);
        else await selectStage(next);
    };
    return <section aria-label="目前作業" className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="font-semibold text-slate-900">{prompt ? '今天做什麼？' : `目前作業：${workStageLabel(stage)}`}</p>
                {assignment && <p className="mt-1 text-xs text-slate-500">主管安排：{workStageLabel(assignment.stage)}{assignment.assigned_by_name ? ` · ${assignment.assigned_by_name}` : ''}</p>}
            </div>
            <div className="flex gap-2">{workTypes.map(type => {
                const Icon = type === 'pick' ? Package : Box;
                const active = type === stage;
                const color = type === 'pick' ? 'border-orange-200 bg-orange-50 text-orange-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800';
                return <button key={type} type="button" aria-pressed={active} disabled={disabled || loading || choosing || !!error} onClick={() => select(type)} className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-semibold disabled:opacity-50 ${active ? color : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
                    {choosing ? <Loader2 size={17} className="animate-spin" /> : <Icon size={17} />}{prompt ? `開始${workStageLabel(type)}` : workStageLabel(type)}{prompt && type === recommendedStage ? ' ✓' : ''}
                </button>;
            })}</div>
        </div>
        {error && <div role="alert" className="mt-3 flex items-center justify-between gap-3 text-sm text-red-700"><span>{error}</span><button type="button" className="min-h-11 shrink-0 underline" disabled={loading || choosing} onClick={() => reload()}>重新確認</button></div>}
        {loading && <p role="status" className="mt-2 text-sm text-slate-500">確認今日作業…</p>}
    </section>;
}
