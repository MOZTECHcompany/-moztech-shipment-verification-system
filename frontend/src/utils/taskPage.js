export const TASK_PAGE_SIZE = 50;
export const taskQueryScope = ({ view, date, search, status, urgent, group = 'all' }) => JSON.stringify([view, view === 'completed' ? date : '', search.trim(), status, urgent, group]);

export function taskPageUrl({ view, date, search, status, urgent, cursor, group = 'all' }) {
    const params = new URLSearchParams({ pagination: 'cursor', limit: String(TASK_PAGE_SIZE) });
    if (search.trim()) params.set('q', search.trim());
    if (status !== 'all') params.set('status', status);
    if (group !== 'all') params.set('group', group);
    if (urgent) params.set('urgent', 'true');
    if (view === 'completed') params.set('date', date);
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
