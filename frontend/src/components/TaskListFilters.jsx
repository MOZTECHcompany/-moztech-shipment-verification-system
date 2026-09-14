import React from 'react';
import { Search, RefreshCw, X } from 'lucide-react';
import { Button } from '@/ui';

export default function TaskListFilters({ search, onSearch, status, onStatus, urgentOnly, onUrgentOnly, statusOptions, total, matched, onReset, onRefresh, loading, showUrgent = true, serverSearch = false, pageIndex = 0, hasMore = false }) {
    const hasFilters = Boolean(search.trim()) || status !== 'all' || urgentOnly;
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm mb-6 text-slate-800">
            <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1 basis-64">
                    <label htmlFor="task-search" className="block text-xs font-semibold text-slate-600 mb-2">查找任務</label>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} aria-hidden="true" />
                        <input
                            id="task-search"
                            type="search"
                            value={search}
                            onChange={(event) => onSearch(event.target.value)}
                            placeholder="輸入／掃描單號，或搜尋客戶"
                            aria-describedby="task-search-help"
                            autoComplete="off"
                            className="w-full h-11 pl-10 pr-10 rounded-xl border border-slate-200 bg-white text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                        />
                        {search && <button type="button" aria-label="清除搜尋" onClick={() => onSearch('')} className="absolute right-1 top-1 h-9 w-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"><X size={17} aria-hidden="true" /></button>}
                    </div>
                </div>
                <div>
                    <label htmlFor="task-status" className="block text-xs font-semibold text-slate-600 mb-2">作業狀態</label>
                    <select id="task-status" value={status} onChange={(event) => onStatus(event.target.value)} className="h-11 rounded-xl border border-slate-200 bg-white pl-3 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30">
                        <option value="all">全部狀態</option>
                        {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                </div>
                {showUrgent && <label className="flex items-center gap-2 min-h-11 px-3 text-sm cursor-pointer"><input type="checkbox" checked={urgentOnly} onChange={(event) => onUrgentOnly(event.target.checked)} className="h-4 w-4 accent-blue-600" />僅顯示緊急</label>}
                <Button type="button" variant="secondary" size="sm" onClick={onRefresh} disabled={loading} className="min-h-11">
                    <RefreshCw size={16} className={loading ? 'animate-spin mr-2' : 'mr-2'} aria-hidden="true" />{loading ? '更新中' : '重新整理'}
                </Button>
            </div>
            <div className="flex flex-wrap justify-between items-center gap-2 mt-3">
                <p id="task-search-help" className="sr-only">{serverSearch ? '搜尋所有符合條件的單號與客戶；商品條碼請進入訂單後核對。' : '搜尋目前清單的單號與客戶；商品條碼請進入訂單後核對。'}</p>
                <div className="flex items-center gap-3 text-xs">
                    <span role="status" className="text-slate-600">{loading ? '正在取得任務…' : serverSearch ? `第 ${pageIndex + 1} 頁 · 本頁 ${matched} 筆${hasMore ? ' · 尚有下一頁' : ''}` : `顯示 ${matched} / ${total} 筆`}</span>
                    {hasFilters && <button type="button" onClick={onReset} className="font-semibold text-blue-700 underline underline-offset-4 min-h-8">清除篩選</button>}
                </div>
            </div>
        </div>
    );
}
