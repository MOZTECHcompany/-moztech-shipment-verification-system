export function isDevDeployment(value) {
    return value === 'dev';
}

export function applyDeploymentTitle(document, isDev) {
    if (!isDev || !document) return () => {};
    const original = document.title;
    const title = original.startsWith('[DEV] ') ? original : `[DEV] ${original}`;
    document.title = title;
    return () => { if (document.title === title) document.title = original; };
}
