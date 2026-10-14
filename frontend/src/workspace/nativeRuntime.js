let activeRuntime = null;

// The SDK owns one host lease. A late cleanup can never unset a newer host.
export function installNativeRuntime(options) {
    if (activeRuntime) throw new Error('WMS workspace is already mounted');
    if (!options?.portalTarget) throw new Error('WMS native portal target is required');
    const cleanups = new Set();
    const runtime = { ...options, cleanups };
    activeRuntime = runtime;
    return () => {
        if (activeRuntime !== runtime) return;
        for (const cleanup of [...cleanups]) {
            try { cleanup(); } catch { /* Continue releasing the host lease. */ }
        }
        cleanups.clear();
        if (activeRuntime === runtime) activeRuntime = null;
    };
}

export const getNativeRuntime = () => activeRuntime;
// The delegated viewer entry permits task reads, not operational widgets.
// Standalone WMS roles keep their existing behavior.
export const isNativeViewer = user => Boolean(activeRuntime) && user?.role === 'viewer';
export const isNativeSessionCurrent = (runtime = activeRuntime) =>
    !runtime || (runtime === activeRuntime && runtime.isSessionCurrent?.() !== false);
export const getPortalTarget = () => activeRuntime?.portalTarget || (typeof document === 'undefined' ? null : document.body);
export const getWorkspaceRoot = () => activeRuntime?.workspaceRoot || activeRuntime?.portalTarget?.getRootNode?.() || (typeof document === 'undefined' ? null : document);
export const getEventTarget = event => event.composedPath?.()[0] || event.target;
export const registerNativeCleanup = (cleanup, runtime = activeRuntime) => {
    runtime?.cleanups.add(cleanup);
    return () => runtime?.cleanups.delete(cleanup);
};

export function assetUrl(path) {
    if (!activeRuntime?.assetOrigin || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(path)) return path;
    return new URL(String(path).replace(/^\/+/, ''), `${activeRuntime.assetOrigin.replace(/\/+$/, '')}/`).href;
}

export function getWorkspaceLocation() {
    const path = activeRuntime?.getPath?.();
    if (path != null) {
        const url = new URL(String(path), 'https://wms.invalid');
        return { pathname: url.pathname, search: url.search, hash: url.hash };
    }
    return typeof window === 'undefined' ? { pathname: '/', search: '', hash: '' } : window.location || { pathname: '/', search: '', hash: '' };
}

export function reloadWorkspace() {
    if (activeRuntime) {
        if (isNativeSessionCurrent()) return activeRuntime.reload?.();
        return;
    }
    return window.location.reload();
}

export function handleWorkspaceAnchor(event, id, { focus = false } = {}) {
    if (!activeRuntime) return;
    event.preventDefault();
    if (!isNativeSessionCurrent()) return;
    const node = getWorkspaceRoot()?.getElementById(id);
    node?.scrollIntoView({ block: 'start' });
    if (focus) node?.focus({ preventScroll: true });
}

export function getWorkspaceActiveElement() {
    const root = getWorkspaceRoot();
    return root?.activeElement || (typeof document === 'undefined' ? null : document.activeElement);
}

export function isWorkspaceFocusIdle() {
    const focused = getWorkspaceActiveElement();
    if (!activeRuntime) return !focused || focused === document.body;
    const root = getWorkspaceRoot();
    return !root?.activeElement && (!focused || focused === document.body || focused === root.host || focused === activeRuntime.portalTarget);
}
