import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from '../App';
import api, { configureWorkspaceTransport } from '../api/api';
import { initializeSocketOrigin, setSocketSession } from '../api/socket';
import { queryClient } from '../api/queryClient';
import soundNotification from '../utils/soundNotification';
import { installNativeRuntime } from './nativeRuntime';
import { createWorkspaceSession, exactWorkspaceOrigin, validateWorkspaceManifest, workspacePath } from './contract.mjs';
import '../index.css';
import 'sonner/dist/styles.css';
import './nativeTheme.css';

export const sourceCommit = import.meta.env.VITE_SOURCE_COMMIT || 'development';
let activeMount = null;

function stylesheet(parent, origin, path) {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = origin + path;
    let timer, rejectReady;
    const ready = new Promise((resolve, reject) => {
        rejectReady = reject;
        timer = setTimeout(() => reject(new Error('Workspace stylesheet did not load')), 15000);
        link.onload = () => { clearTimeout(timer); resolve(); };
        link.onerror = () => { clearTimeout(timer); reject(new Error('Workspace stylesheet did not load')); };
    });
    parent.appendChild(link);
    return { link, ready, cancel() { clearTimeout(timer); link.onload = null; link.onerror = null; rejectReady(new DOMException('Workspace disposed', 'AbortError')); } };
}

// A second React root keeps the existing React 18 workflow components intact
// when the ERP host uses another React version. The host never renders WMS JSX.
export async function mountWorkspace(container, options) {
    if (!container?.attachShadow || activeMount) throw new Error('Only one native workspace may be mounted');
    if (options?.signal?.aborted) throw new DOMException('Workspace bootstrap aborted', 'AbortError');
    const assetOrigin = exactWorkspaceOrigin(options?.assetOrigin);
    const socketOrigin = exactWorkspaceOrigin(options?.socketOrigin || assetOrigin);
    validateWorkspaceManifest(options?.manifest, sourceCommit);
    if (typeof options.transport !== 'function') throw new TypeError('Workspace transport is required');
    const initialPath = workspacePath(options.initialPath || options.session?.destination || '/tasks');
    const shadow = container.shadowRoot || container.attachShadow({ mode: 'open' });
    if (shadow.childNodes.length) throw new Error('Workspace container must be empty');
    const mount = document.createElement('div');
    const portal = document.createElement('div'); portal.className = 'wms-native-portal';
    const portalTarget = document.createElement('div'); portalTarget.className = 'wms-workspace'; portal.appendChild(portalTarget);
    const lease = {};
    activeMount = lease;
    let disposed = false, root, session, restoreTransport, restoreRuntime, navigate, renderWorkspace, renderKey = 0, pendingPath = initialPath, pendingOptions = { replace: true }, externalPath = null, currentPath = initialPath, authReported = false;
    const styleLinks = [];
    let rejectBootstrap;
    const bootstrapCancelled = new Promise((_resolve, reject) => { rejectBootstrap = reject; });
    bootstrapCancelled.catch(() => {});
    const onAuthRequired = reason => {
        if (disposed || authReported || activeMount !== lease) return;
        authReported = true; setSocketSession(null); session?.dispose(); options.onAuthRequired?.(reason);
    };
    const handle = {
        navigate(path, navigationOptions = { replace: true }) {
            if (disposed) return;
            pendingPath = workspacePath(path);
            pendingOptions = { replace: navigationOptions.replace !== false };
            if (pendingPath === currentPath) return;
            externalPath = pendingPath;
            navigate?.(pendingPath, pendingOptions);
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            options.signal?.removeEventListener('abort', onAbort);
            root?.unmount();
            setSocketSession(null); soundNotification.setUser(null);
            restoreTransport?.(); restoreRuntime?.(); session?.dispose();
            delete api.defaults.headers.common.Authorization;
            queryClient.clear();
            for (const style of styleLinks) { style.cancel(); style.link.remove(); }
            mount.remove(); portal.remove();
            if (activeMount === lease) activeMount = null;
        },
    };
    const onAbort = () => { handle.dispose(); rejectBootstrap(new DOMException('Workspace bootstrap aborted', 'AbortError')); };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
        if (options.signal?.aborted) onAbort();
        if (disposed) throw new DOMException('Workspace bootstrap aborted', 'AbortError');
        const ready = [];
        for (const path of options.manifest.styles) { const style = stylesheet(shadow, assetOrigin, path); styleLinks.push(style); ready.push(style.ready); }
        for (const path of options.manifest.portalStyles) { const style = stylesheet(document.head, assetOrigin, path); styleLinks.push(style); ready.push(style.ready); }
        await Promise.race([Promise.all(ready), bootstrapCancelled]);
        if (disposed || options.signal?.aborted) throw new DOMException('Workspace bootstrap aborted', 'AbortError');
        shadow.appendChild(mount); document.body.appendChild(portal);
        session = createWorkspaceSession(sessionStorage, options.session);
        restoreRuntime = installNativeRuntime({ workspaceRoot: shadow, portalTarget, assetOrigin, download: options.download,
            navigate: path => { if (!disposed) { pendingPath = workspacePath(path); pendingOptions = { replace: false }; externalPath = null; navigate?.(pendingPath, pendingOptions); } }, getPath: () => currentPath, isSessionCurrent: session.isCurrentSession,
            reload: () => {
                if (disposed || !session.isCurrentSession()) return;
                if (options.onReload) { options.onReload(); return; }
                queryClient.clear(); renderKey++; renderWorkspace?.();
            } });
        restoreTransport = configureWorkspaceTransport(options.transport, { isCurrentSession: session.isCurrentSession, onAuthRequired });
        initializeSocketOrigin(socketOrigin);
        const host = {
            initialPath,
            onAuthRequired,
            registerNavigate(value) { navigate = value; if (pendingPath !== currentPath) navigate(pendingPath, pendingOptions); return () => { if (navigate === value) navigate = null; }; },
            onNavigate(path, navigationOptions) {
                if (disposed || path === currentPath) return;
                currentPath = path; pendingPath = path;
                if (externalPath === path) { externalPath = null; return; }
                externalPath = null; options.navigate?.(path, navigationOptions);
            },
        };
        root = createRoot(mount);
        renderWorkspace = () => root.render(<QueryClientProvider client={queryClient}><App key={renderKey} host={{ ...host, initialPath: currentPath }} /></QueryClientProvider>);
        renderWorkspace();
        return handle;
    } catch (error) { handle.dispose(); throw error; }
}
