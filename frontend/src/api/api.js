// src/api/api.js
import axios from 'axios';
import { API_ORIGIN } from './origin';
import { toast } from 'sonner';
import * as Sentry from '@sentry/react';
import { getNativeRuntime } from '../workspace/nativeRuntime';

// 1. 建立一個自訂的 axios 實例
const apiClient = axios.create({
    baseURL: API_ORIGIN,
    headers: {
        'Content-Type': 'application/json',
    },
});

// The native workspace uses the ERP's authenticated, same-origin transport.
// Keep the existing Axios request/response behavior and every business body.
export function configureWorkspaceTransport(transport, { isCurrentSession = () => true, onAuthRequired } = {}) {
    if (typeof transport !== 'function') throw new TypeError('Workspace transport is required');
    const previous = apiClient.defaults.adapter;
    const requests = new Set();
    let active = true;
    const adapter = async config => {
        if (!active || !isCurrentSession()) throw new axios.CanceledError('Workspace session changed', config);
        if (typeof config.url !== 'string' || !/^\/api\/[A-Za-z0-9]/.test(config.url) || /[\\\u0000-\u0020]/.test(config.url)) {
            throw new TypeError('Workspace requests must use a WMS API path');
        }
        const controller = new AbortController();
        const abort = () => controller.abort();
        config.signal?.addEventListener('abort', abort, { once: true });
        if (config.signal?.aborted) controller.abort();
        requests.add(controller);
        try {
            const response = await transport({ ...config, signal: controller.signal });
            if (!active || !isCurrentSession()) throw new axios.CanceledError('Workspace session changed', config);
            const result = { ...response, config, headers: response?.headers || {}, statusText: response?.statusText || '' };
            if (!Number.isInteger(result.status)) throw new TypeError('Workspace transport returned no HTTP status');
            if (!(config.validateStatus || (status => status >= 200 && status < 300))(result.status)) {
                throw new axios.AxiosError(result.data?.message || `Request failed with status ${result.status}`, undefined, config, undefined, result);
            }
            return result;
        } catch (error) {
            const data = error.response?.data || {};
            const expired = error.response?.status === 401 || (error.response?.status === 403 && (
                /(?:AUTH_REQUIRED|WMS_SESSION_INVALID|WMS_SESSION_EXPIRED|AUTH_SESSION_INVALID)/.test(data.code || '')
                || /Token 無效或已過期|帳號或登入已失效|作業身分已失效/.test(data.message || '')
            ));
            if (active && isCurrentSession() && expired) onAuthRequired?.(data);
            throw error;
        } finally {
            requests.delete(controller);
            config.signal?.removeEventListener('abort', abort);
        }
    };
    apiClient.defaults.adapter = adapter;
    return () => {
        active = false;
        for (const request of requests) request.abort();
        requests.clear();
        if (apiClient.defaults.adapter === adapter) apiClient.defaults.adapter = previous;
    };
}

// 2. 新增一個「請求攔截器 (Request Interceptor)」
// 這會在【每一次】請求發送前，自動執行這個函數
apiClient.interceptors.request.use(
    (config) => {
        // 從 localStorage 獲取 token（使用正確的 key: 'wms_token'）
        const tokenData = sessionStorage.getItem('wms_token');
        if (tokenData) {
            try {
                // useWarehouseSession 會將資料以 JSON 格式儲存，所以需要 parse
                const token = JSON.parse(tokenData);
                if (token) {
                    // 如果 token 存在，就把它加到 Authorization 標頭裡
                    config.headers['Authorization'] = `Bearer ${token}`;
                }
            } catch (e) {
                console.error('解析 token 失敗:', e);
            }
        }
        return config;
    },
    (error) => {
        // 對請求錯誤做些什麼
        return Promise.reject(error);
    }
);

apiClient.getSessionIdentity = () => {
    let actor;
    try { const user = JSON.parse(sessionStorage.getItem('wms_user')); actor = [user?.id, user?.role, user?.management_scope]; }
    catch { actor = null; }
    return JSON.stringify([actor, sessionStorage.getItem('wms_token')]);
};
export default apiClient;

// 3. 全域回應攔截器：標準化錯誤並提示
apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        const { response } = error || {};
        const requestId = response?.headers?.['x-request-id'] || response?.headers?.['X-Request-Id'];
        const status = response?.status;
        const data = response?.data || {};
        const code = data.code || (status === 401 ? 'AUTH_REQUIRED' : status === 403 ? 'FORBIDDEN' : undefined);
        const message = data.message || error.message || '發生未知錯誤';

        // 視情況提示（避免對某些頁面重複彈出可在呼叫端關閉）
        if (status >= 500 || status === 401 || status === 403) {
            toast.error(message, {
                description: !getNativeRuntime() && requestId ? `Request ID: ${requestId}` : undefined,
            });
        }

        // Sentry 上報，附加 Request ID 與後端錯誤碼
        try {
            Sentry.captureException(error, {
                tags: { requestId, status, code },
                extra: { url: response?.config?.url, method: response?.config?.method, data }
            });
        } catch { /* Error reporting must not interrupt the original API error. */ }

        // 將標準欄位附加回錯誤物件，給呼叫端使用
        error.requestId = requestId;
        error.code = code;
        error.message = message;
        return Promise.reject(error);
    }
);
