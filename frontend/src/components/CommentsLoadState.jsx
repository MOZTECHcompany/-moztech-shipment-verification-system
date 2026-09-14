export function CommentsLoadState({ isError, error, isFetching, retry, hasNewMessages, jumpToLatest }) {
    return <div className="shrink-0 px-3 pt-2 sm:px-4">
        {isError && <div role="alert" className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <span className="min-w-0 flex-1">{error?.message || '留言載入失敗'}，已載入的內容仍保留。</span>
            <button type="button" disabled={isFetching} onClick={() => retry()} className="shrink-0 rounded-lg bg-white px-3 py-2 font-medium disabled:opacity-50">重試載入</button>
        </div>}
        <div className="flex items-center justify-between gap-2 py-1 text-xs text-gray-500" role="status" aria-live="polite">
            <span>{isFetching ? '正在更新留言…' : '依時間排序・可載入較早對話'}</span>
            <button type="button" onClick={jumpToLatest} className="rounded-full px-3 py-1.5 text-blue-700 hover:bg-blue-50">
                {hasNewMessages ? '有新留言・回到最新' : '回到最新'}
            </button>
        </div>
    </div>;
}
