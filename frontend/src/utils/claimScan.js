const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function claimStageForRole(role, selected = '') {
    return role === 'picker' ? 'pick' : role === 'packer' ? 'pack'
        : ['admin', 'superadmin'].includes(role) && ['pick', 'pack'].includes(selected) ? selected : '';
}
export function createClaimScanController({ api, userId, storage, newCommandId, onState, onSuccess, acquire = () => true, release = () => {}, isCurrentActor = () => true }) {
    const key = `wms_claim_recovery:${userId}`;
    let command = null, busy = false, state = { phase: 'idle' };
    try {
        const saved = JSON.parse(storage?.getItem(key));
        if (saved && UUID.test(saved.commandId) && typeof saved.barcode === 'string' && ['pick', 'pack'].includes(saved.stage)) {
            command = { barcode: saved.barcode, stage: saved.stage, commandId: saved.commandId, expectedActorId: userId }; state = { phase: 'unknown', command, message: '上次認領結果尚未確認，請先查詢結果。' };
        }
    } catch { /* In-memory exclusion still applies when storage is unavailable. */ }
    const publish = next => { state = next; onState?.(state); };
    const save = () => { try { command ? storage?.setItem(key, JSON.stringify(command)) : storage?.removeItem(key); } catch { /* No token or customer details are persisted. */ } };
    const finishRejected = result => {
        if (!result || result.outcome !== 'rejected' || result.definitive !== true || result.code !== 'CLAIM_NOT_APPLIED'
            || result.commandId !== command?.commandId || result.stage !== command.stage
            || Number(result.expectedActorId) !== Number(command.expectedActorId)) return false;
        command = null; save(); release();
        publish({ phase: 'error', message: result.message || '原認領已確認未套用，請核對工作單後重新作業。', result });
        return true;
    };
    const finish = result => {
        if (!result || result.commandId !== command?.commandId || result.stage !== command.stage
            || !Number.isSafeInteger(result.orderId) || result.orderId <= 0 || Number(result.owner?.id) !== Number(userId)
            || !['claimed', 'continued'].includes(result.outcome)) throw new Error('認領回應不完整，請查詢結果。');
        command = null; save(); release(); publish({ phase: 'success', result }); onSuccess?.(result);
    };
    async function send() {
        if (busy || !command) return;
        if (!isCurrentActor()) { publish({ phase: 'unknown', command, message: '登入帳號已變更，請重新登入原操作人員後查詢這筆認領。' }); return; }
        const wasUnknown = state.phase === 'unknown';
        busy = true; publish({ phase: 'submitting', command });
        try {
            const result = (await api.post('/api/orders/claim-by-barcode', command, { timeout: 15000 })).data;
            if (!finishRejected(result)) finish(result);
        }
        catch (error) {
            if (finishRejected(error.response?.data)) return;
            if (error.response?.data?.code === 'CLAIM_NOT_APPLIED' && !wasUnknown && error.response.data.definitive !== true) {
                const message = error.response.data.message || '此工作單未認領，請核對條碼、階段或權限。';
                command = null; save(); release(); publish({ phase: 'error', message });
            } else publish({ phase: 'unknown', command, message: `原認領結果仍待確認。${error.response?.data?.message || '請先查詢；不要改掃下一張。'}` });
        } finally { busy = false; }
    }
    return {
        getState: () => state,
        isLocked: () => !!command || busy,
        async submit(rawBarcode, stage) {
            if (busy || command) return false;
            const barcode = String(rawBarcode ?? '').trim();
            if (!barcode) return false;
            if (!isCurrentActor()) { publish({ phase: 'error', message: '登入帳號已變更，請重新整理並確認操作人員後再認領。' }); return false; }
            if (!['pick', 'pack'].includes(stage)) { publish({ phase: 'error', message: '請先選擇揀貨或裝箱階段。' }); return false; }
            const commandId = newCommandId();
            if (!UUID.test(commandId)) { publish({ phase: 'error', message: '無法建立認領識別碼，請重新開啟安全連線。' }); return false; }
            if (!acquire()) { publish({ phase: 'error', message: '其他認領操作尚未完成，請稍後重新掃描。' }); return false; }
            command = { barcode, stage, commandId, expectedActorId: userId }; save(); await send(); return true;
        },
        async recover() {
            if (busy || !command) return;
            if (!isCurrentActor()) { publish({ phase: 'unknown', command, message: '登入帳號已變更，請重新登入原操作人員後查詢這筆認領。' }); return; }
            busy = true; publish({ phase: 'checking', command });
            try {
                const result = (await api.get(`/api/orders/claim-commands/${command.commandId}?expectedActorId=${command.expectedActorId}`, { timeout: 15000 })).data;
                if (!finishRejected(result)) finish(result);
            }
            catch (error) {
                const notFound = error.response?.status === 404 && error.response?.data?.code === 'CLAIM_RECEIPT_NOT_FOUND';
                publish({ phase: 'unknown', command, canRetry: notFound,
                    message: notFound ? '尚未找到認領收據，原請求可能仍在處理。可再次查詢，或以同一識別碼安全重送原認領。' : '目前無法確認認領結果，請保持原工作單並再次查詢。' });
            } finally { busy = false; }
        },
        retrySame: () => state.phase === 'unknown' && state.canRetry ? send() : Promise.resolve(),
    };
}
