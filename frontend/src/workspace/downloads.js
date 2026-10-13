import { getNativeRuntime, getPortalTarget, isNativeSessionCurrent } from './nativeRuntime.js';

export function responseFilename(headers, fallback = 'download') {
    const disposition = headers?.get?.('content-disposition') || headers?.['content-disposition'] || headers?.['Content-Disposition'] || '';
    const encoded = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
    let name;
    try { if (encoded) name = decodeURIComponent(encoded.trim().replace(/^"|"$/g, '')); } catch { /* Use the ordinary filename when encoding is invalid. */ }
    name ||= disposition.match(/filename\s*=\s*"([^"]+)"/i)?.[1] || disposition.match(/filename\s*=\s*([^;]+)/i)?.[1]?.trim();
    return String(name || fallback).replace(/[\\/\u0000-\u001f\u007f]/g, '_');
}

export function saveBlobDownload(blob, filename, { runtime = getNativeRuntime(), isCurrent = () => true } = {}) {
    if (!isCurrent() || !isNativeSessionCurrent(runtime)) return false;
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    try {
        anchor.href = url;
        anchor.download = filename;
        (runtime?.portalTarget || getPortalTarget()).appendChild(anchor);
        if (!isCurrent() || !isNativeSessionCurrent(runtime)) return false;
        anchor.click();
        return true;
    } finally {
        anchor.remove();
        window.URL.revokeObjectURL(url);
    }
}

export async function downloadNativeMarketplaceFile({ id, kind }, { isCurrent = () => true } = {}) {
    const runtime = getNativeRuntime();
    if (!runtime) throw new Error('Native download requires a mounted WMS workspace');
    if (!isCurrent() || !isNativeSessionCurrent(runtime)) return false;
    if (typeof runtime.download !== 'function') throw new Error('Native download is unavailable');
    const response = await runtime.download({ id, kind });
    if (!isCurrent() || !isNativeSessionCurrent(runtime)) return false;
    if (!(response?.data instanceof Blob)) throw new Error('下載檔案未完成，請重試。');
    return saveBlobDownload(response.data, responseFilename(response.headers, `marketplace-${id}-${kind}.xlsx`), { runtime, isCurrent });
}
