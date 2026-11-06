export const TASK_PAGE_SIZE = 50;
// null is the automatic default; an explicit empty value means all dates.
export const taskCompletedDate = (selection, search, today) => selection ?? (search.trim() ? '' : today);
export const taskQueryScope = ({ view, date, dateType, search, status, urgent, group = 'all', stage, exact = false }) => JSON.stringify([view, view === 'completed' ? date || '' : '', view === 'completed' && date && dateType === 'completed' ? 'completed' : '', search.trim(), Boolean(search.trim() && exact), status, urgent, group, view === 'completed' ? '' : stage || '']);

export function taskPageUrl({ view, date, dateType, search, status, urgent, cursor, group = 'all', stage, exact = false }) {
    const params = new URLSearchParams({ pagination: 'cursor', limit: String(TASK_PAGE_SIZE) });
    if (search.trim()) {
        params.set('q', search.trim());
        if (exact) params.set('match', 'exact');
    }
    if (status !== 'all') params.set('status', status);
    if (group !== 'all') params.set('group', group);
    if (urgent) params.set('urgent', 'true');
    if (view === 'completed' && date) {
        params.set('date', date);
        if (dateType === 'completed') params.set('dateType', 'completed');
    }
    if (view !== 'completed' && ['pick', 'pack'].includes(stage)) params.set('stage', stage);
    if (cursor) params.set('cursor', cursor);
    return `/api/tasks${view === 'completed' ? '/completed' : ''}?${params}`;
}

export function readTaskPage(data) {
    if (!data || !Array.isArray(data.items) || typeof data.hasMore !== 'boolean' || (data.hasMore && typeof data.nextCursor !== 'string')) {
        throw new Error('任務分頁格式不正確，請重新整理後再試。');
    }
    const summary = data.countScope === 'filtered' && data.summary && ['total', 'pick', 'pack', 'inProgress', 'mine', 'picked', 'done'].every(key => Number.isSafeInteger(data.summary[key]) && data.summary[key] >= 0) ? data.summary : null;
    return { summary, items: data.items, nextCursor: data.hasMore ? data.nextCursor : null, hasMore: data.hasMore };
}
