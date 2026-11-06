import { parseMessageTimestamp } from './messageTimestamp.js';
import { workActorLabel, workTypeLabel } from './warehouseWork.js';

export const actions = {
    import: ['匯入訂單', 'info'], claim: ['認領任務', 'info'],
    pick: ['揀貨', 'warning'], pack: ['裝箱', 'success'],
    void: ['作廢訂單', 'danger'], complete: ['完成訂單', 'success'],
    set_urgent: ['變更急件', 'warning'], scan_error: ['掃描異常', 'danger'],
    defect_exchange: ['不良品換序號', 'warning'], transfer: ['任務交接', 'info'],
    work_mode_selected: ['選擇今日作業'], work_assigned: ['指派今日作業'],
    work_pause: ['暫停作業', 'warning'], work_resume: ['繼續作業'],
    exception_create: ['建立例外', 'warning'], exception_propose: ['提出異動', 'warning'],
    exception_ack: ['核可例外', 'success'], exception_reject: ['駁回例外', 'danger'],
    exception_resolve: ['結案例外', 'success'],
    order_change_ack: ['核可訂單異動', 'success'], order_change_reject: ['駁回訂單異動', 'danger'],
    order_delete_requested: ['申請刪除訂單', 'warning'], order_delete_rejected: ['駁回刪除訂單', 'danger'],
    picking_completion_reconcile: ['補正揀貨完成', 'success'],
    carton_release: ['解除箱號分配', 'warning'],
    ecount_reference_saved: ['保存銷貨對照'], ecount_reference_manually_checked: ['人工核對銷貨對照'],
    bootstrap_admin: ['建立初始管理員'],
};

export const actionLabel = type => Object.hasOwn(actions, type) ? actions[type][0] : type || '未知操作';
export const actionVariant = type => Object.hasOwn(actions, type) ? actions[type][1] || 'neutral' : 'neutral';
export const logActor = log => log.actor_snapshot?.name || log.user_name || '未知人員';
export const logRole = log => log.actor_snapshot ? workActorLabel(log) : '歷史身分未記錄';
export const logStage = log => workTypeLabel(log.work_type || log.action_type) || '—';

export function parseLogDetails(value) {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); }
    catch { return value; }
}

export function logSummary(log) {
    const d = parseLogDetails(log.details);
    const text = value => typeof value === 'string' ? value.trim() : '';
    if (!d || typeof d !== 'object') return text(d);
    if (log.action_type === 'import' && Number.isInteger(d.itemCount)) return `匯入 ${d.itemCount} 個品項`;
    if (log.action_type === 'scan_error') return [text(d.scanValue), text(d.reason)].filter(Boolean).join(' · ');
    if (log.action_type === 'defect_exchange') return text(d.product);
    if (d.cartonId != null) {
        const lines = Array.isArray(d.lines) ? d.lines : [];
        const quantity = lines.length && lines.every(line => Number.isSafeInteger(line?.quantity))
            ? lines.reduce((sum, line) => sum + line.quantity, 0) : null;
        return `箱號 ${d.cartonId}${quantity != null ? ` · 本次 ${quantity} 件` : ''}`;
    }
    if (d.serialNumber) return `序號 ${d.serialNumber}`;
    if (Number.isFinite(d.amount)) return `數量異動 ${d.amount > 0 ? '+' : ''}${d.amount}`;
    return text(d.reason) || text(d.note);
}

const detailLabels = {
    reason: '原因', note: '備註', product: '商品', productName: '商品',
    scanValue: '掃描值', barcode: '條碼', serialNumber: '序號', oldSn: '原序號', newSn: '新序號',
    amount: '數量異動', cartonId: '箱號', itemCount: '品項數', serialCount: '序號數',
    exceptionId: '例外編號', voucherNumber: '憑證號碼', work_date: '作業日期',
};

export function logDetailFields(details) {
    if (!details || typeof details !== 'object' || Array.isArray(details)) return [];
    return Object.entries(detailLabels)
        .filter(([key]) => ['string', 'number'].includes(typeof details[key]) && details[key] !== '')
        .map(([key, label]) => ({ key, label, value: details[key] }));
}

const timestamp = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
export function logTime(value) {
    const date = parseMessageTimestamp(value);
    if (!date) return { day: '日期未知', time: '—' };
    const parts = Object.fromEntries(timestamp.formatToParts(date).map(p => [p.type, p.value]));
    return { day: `${parts.year}/${parts.month}/${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
}

export function taipeiDay(offset = 0, now = new Date()) {
    return new Date(now.getTime() + (8 + offset * 24) * 3600000).toISOString().slice(0, 10);
}

const filterKeys = ['q', 'orderId', 'userId', 'actionType', 'workType', 'startDate', 'endDate', 'limit'];
export function readLogFilters(params) {
    return Object.fromEntries(filterKeys.map(key => [key, params.get(key) || (key === 'limit' ? '50' : '')]));
}
export function logFilterParams(filters) {
    const params = new URLSearchParams();
    for (const key of filterKeys) {
        const value = filters[key]?.trim();
        if (value && !(key === 'limit' && value === '50')) params.set(key, value);
    }
    return params;
}
export function smartLogSearchFilters(draft) {
    // The main search starts a fresh order lookup. An explicit order filter
    // can still be combined with keywords via the advanced Apply button.
    return draft.q.trim() ? { ...draft, orderId: '' } : draft;
}
export function keywordOnlyLogFilters({ q, limit }) {
    return { ...readLogFilters(new URLSearchParams()), q, limit };
}
export function logFilterError({ q, startDate, endDate }) {
    if (q.trim().length > 200 || q.trim().split(/\s+/u).length > 8) return '請將關鍵字縮短至 200 字以內、最多 8 個詞。';
    if (startDate && endDate && startDate > endDate) return '開始日期不能晚於結束日期。';
    return '';
}

export function operationLogsCSV(logs) {
    const cell = value => {
        let text = String(value ?? '');
        if (/^[\s\u0000-\u001f]*[=+\-@＝＋－＠]|^[\t\r\n]/u.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
    };
    return [
        ['台灣時間', '訂單編號', '客戶名稱', '操作類型', '實際操作人員', '當時帳號身分', '當下工序', '詳細資訊'],
        ...logs.map(log => {
            const { day, time } = logTime(log.created_at);
            return [`${day} ${time}`, log.voucher_number || (log.order_id ? `#${log.order_id}` : '—'),
                log.customer_name, actionLabel(log.action_type), logActor(log), logRole(log), logStage(log),
                typeof log.details === 'string' ? log.details : JSON.stringify(log.details)];
        }),
    ].map(row => row.map(cell).join(',')).join('\r\n');
}
