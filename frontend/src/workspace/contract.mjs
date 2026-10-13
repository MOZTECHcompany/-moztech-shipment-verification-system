const pages = new Set(['/tasks', '/admin', '/admin/marketplace-converter', '/admin/users', '/admin/operation-logs', '/admin/analytics', '/admin/scan-errors', '/admin/defects', '/admin/exceptions', '/team', '/cartons', '/settings', '/settings/logistics', '/warehouse-intakes']);

export function workspacePath(value) {
    if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) throw new TypeError('Invalid workspace path');
    const url = new URL(value, 'https://workspace.invalid');
    if (url.origin !== 'https://workspace.invalid' || (!pages.has(url.pathname) && !/^\/(?:order|batches|warehouse-intakes|team)\/[A-Za-z0-9_-]+$/.test(url.pathname))) throw new TypeError('Unknown workspace page');
    for (const key of url.searchParams.keys()) if (/token|ticket|nonce|secret|authorization/i.test(key)) throw new TypeError('Credentials must not appear in workspace paths');
    return url.pathname + url.search + url.hash;
}

export function exactWorkspaceOrigin(value) {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== value || url.username || url.password) throw new TypeError('Workspace origin must be an exact HTTP(S) origin');
    return url.origin;
}

export function validateWorkspaceManifest(manifest, sourceCommit) {
    const css = value => Array.isArray(value) && value.length > 0 && value.every(path => /^\/assets\/[A-Za-z0-9_.-]+\.css$/.test(path));
    if (manifest?.version !== 1 || !/^\/assets\/workspace-[A-Za-z0-9_-]+\.js$/.test(manifest.entry || '') || !css(manifest.styles) || !css(manifest.portalStyles)
        || manifest.sourceCommit !== sourceCommit) throw new TypeError('Workspace manifest does not match this SDK release');
    return manifest;
}

export function createWorkspaceSession(storage, session) {
    const user = session?.user, token = session?.accessToken;
    if (!Number.isSafeInteger(user?.id) || user.id < 1 || !['picker', 'packer', 'dispatcher', 'admin', 'viewer'].includes(user.role)
        || typeof user.erpSubject !== 'string' || !user.erpSubject || typeof user.entityId !== 'string' || !user.entityId
        || typeof token !== 'string' || !token) throw new TypeError('A verified ERP warehouse session is required');
    const tokenValue = JSON.stringify(token);
    storage.setItem('wms_token', tokenValue);
    storage.setItem('wms_user', JSON.stringify(user));
    let active = true;
    const sameActor = () => {
        try {
            const actor = JSON.parse(storage.getItem('wms_user'));
            return actor?.id === user.id && actor?.role === user.role && actor?.erpSubject === user.erpSubject && actor?.entityId === user.entityId;
        } catch { return false; }
    };
    const isCurrentSession = () => active && storage.getItem('wms_token') === tokenValue && sameActor();
    return { isCurrentSession, dispose() {
        const empty = value => value === null || value === 'null';
        if ((storage.getItem('wms_token') === tokenValue && sameActor()) || (empty(storage.getItem('wms_token')) && empty(storage.getItem('wms_user')))) {
            storage.removeItem('wms_token'); storage.removeItem('wms_user');
        }
        active = false;
    } };
}
