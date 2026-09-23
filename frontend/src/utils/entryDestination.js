// Accept only WMS application pages, never an external URL or an API endpoint.
const pages = new Set(['/tasks', '/admin', '/admin/marketplace-converter', '/admin/users', '/admin/operation-logs', '/admin/analytics', '/admin/scan-errors', '/admin/defects', '/admin/exceptions', '/team', '/settings', '/settings/logistics', '/warehouse-intakes', '/corely-intakes']);
export function safeEntryDestination(value) {
    if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return '/tasks';
    try {
        const url = new URL(value, 'https://wms.invalid');
        if (url.origin !== 'https://wms.invalid' || (!pages.has(url.pathname) && !/^\/(?:order|batches|warehouse-intakes|team)\/[A-Za-z0-9_-]+$/.test(url.pathname) && !/^\/corely-intakes\/[1-9]\d{0,8}$/.test(url.pathname))) return '/tasks';
        const query = new URLSearchParams();
        if (url.pathname === '/tasks') {
            const { view, group } = taskEntryFilters(url.search);
            if (view === 'completed') query.set('view', view);
            if (group !== 'all') query.set('group', group);
        }
        return url.pathname + (query.size ? '?' + query : '');
    } catch { return '/tasks'; }
}

export function taskEntryFilters(search = '') {
    const params = new URLSearchParams(search);
    return {
        view: params.get('view') === 'completed' ? 'completed' : 'active',
        group: ['pick', 'pack', 'mine', 'inProgress'].includes(params.get('group')) ? params.get('group') : 'all',
    };
}

export function loginEntryUrl(destination) {
    return '/login?next=' + encodeURIComponent(safeEntryDestination(destination));
}
