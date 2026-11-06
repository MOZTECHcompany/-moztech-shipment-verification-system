const { createHash } = require('node:crypto');
const { boundedLimit, dateRange, isoDate } = require('../utils/queryLimits');
const { tokenizeErpSearch, parseErpDate, parseErpVoucher, voucherDatePattern, packingWords } = require('../utils/erpSearchTerms');

const badRequest = message => Object.assign(new Error(message), { status: 400 });
const normalize = value => value.normalize('NFKC').replace(/[‐‑‒–—−－]/g, '-').trim().toLowerCase();
const compactVoucher = value => value.replace(/[\s/\-]/g, '');
const isScanTerm = value => /^[a-z0-9][a-z0-9._:/#%+\\-]*$/i.test(value);
const like = value => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
const workType = "COALESCE(ol.work_type, CASE WHEN ol.action_type IN ('pick','pack') THEN ol.action_type END)";
const actionTerms = {
    '匯入': ['import'], '匯入訂單': ['import'], '認領': ['claim'], '認領任務': ['claim'],
    '揀貨': ['pick'], '揀貨操作': ['pick'],
    '作廢': ['void'], '作廢訂單': ['void'], '完成': ['complete'], '完成訂單': ['complete'],
    '交接': ['transfer'], '任務交接': ['transfer'], '暫停': ['work_pause'], '暫停作業': ['work_pause'],
    '繼續': ['work_resume'], '繼續作業': ['work_resume'], '恢復': ['work_resume'],
    '刷錯': ['scan_error'], '掃碼錯誤': ['scan_error'], '刷錯條碼': ['scan_error'], '掃描異常': ['scan_error'],
    '異常': ['exception_create', 'exception_propose', 'exception_ack', 'exception_reject'],
    '異常回報': ['exception_create'], '駁回': ['exception_reject', 'order_change_reject'],
    '換貨': ['defect_exchange'], '加急': ['set_urgent'],
    '選擇今日作業': ['work_mode_selected'], '指派今日作業': ['work_assigned'],
    '保存銷貨對照': ['ecount_reference_saved'], '人工核對銷貨對照': ['ecount_reference_manually_checked'],
    '變更急件': ['set_urgent'], '不良品換序號': ['defect_exchange'], '建立例外': ['exception_create'],
    '提出異動': ['exception_propose'], '核可例外': ['exception_ack'], '駁回例外': ['exception_reject'],
    '結案例外': ['exception_resolve'], '核可訂單異動': ['order_change_ack'], '駁回訂單異動': ['order_change_reject'],
    '申請刪除訂單': ['order_delete_requested'], '駁回刪除訂單': ['order_delete_rejected'],
    '補正揀貨完成': ['picking_completion_reconcile'], '解除箱號分配': ['carton_release'], '建立初始管理員': ['bootstrap_admin'],
};

function parseFilters(query, { statistics = false } = {}) {
    const keys = ['q', 'orderId', 'userId', 'actionType', 'workType', 'startDate', 'endDate'];
    if (!statistics) keys.push('limit', 'cursor');
    for (const key of keys) {
        if (query[key] !== undefined && typeof query[key] !== 'string') throw badRequest('查詢參數格式不正確');
    }
    const q = normalize(query.q || '');
    const terms = tokenizeErpSearch(q);
    if (q.length > 200 || terms.length > 8) throw badRequest('搜尋文字最多 200 個字、8 個以空白分隔的關鍵字');
    const orderId = normalize(query.orderId || '');
    if (orderId.length > 255) throw badRequest('訂單編號過長');
    const userId = query.userId || '';
    if (userId && (!/^[1-9]\d{0,9}$/.test(userId) || Number(userId) > 2147483647)) throw badRequest('使用者 ID 格式不正確');
    const actionType = query.actionType || '';
    if (actionType && !/^[a-z][a-z0-9_]{0,49}$/.test(actionType)) throw badRequest('操作類型格式不正確');
    if (query.workType && !['pick', 'pack'].includes(query.workType)) throw badRequest('作業階段格式不正確');
    const range = dateRange(query.startDate || undefined, query.endDate || undefined);
    const filters = { terms, orderId, userId, actionType, workType: query.workType || '', ...range };
    const scope = createHash('sha256').update('shipment-search-v2:' + JSON.stringify(filters)).digest('hex').slice(0, 24);
    if (statistics) return filters;
    return { ...filters, scope, limit: boundedLimit(query.limit, 100, 1000), cursor: decodeCursor(query.cursor, scope) };
}

function decodeCursor(value, scope) {
    if (!value) return null;
    try {
        if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
        const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
        if (cursor.v !== 1 || cursor.scope !== scope || !Number.isSafeInteger(cursor.id) || cursor.id < 1 || cursor.id > 2147483647 ||
            typeof cursor.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}Z$/.test(cursor.at)) throw new Error();
        isoDate(cursor.at.slice(0, 10));
        return cursor;
    } catch { throw badRequest('分頁已失效，請重新搜尋'); }
}

function encodeCursor(row, scope) {
    return Buffer.from(JSON.stringify({ v: 1, scope, at: row.cursor_created_at, id: row.id })).toString('base64url');
}

function buildFilter(filters) {
    const params = [], conditions = [];
    const param = value => { params.push(value); return `$${params.length}`; };
    const normalized = field => `lower(normalize(COALESCE(${field}, ''), NFKC))`;
    const datedVoucherMatch = (day, sequence) => `btrim(${normalized('o.voucher_number')}) ~ ${param(voucherDatePattern(day, sequence))}`;
    const dayStart = date => `(${date}::date::timestamp AT TIME ZONE 'Asia/Taipei')`;
    const dayEnd = date => `((${date}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Taipei')`;
    const voucher = `regexp_replace(${normalized('o.voucher_number')}, '[[:space:]/‐‑‒–—−－-]', '', 'g')`;
    const voucherMatch = term => {
        const simple = compactVoucher(term);
        return `${normalized('o.voucher_number')} LIKE ${param(like(term))} ESCAPE '\\'` +
            (simple ? ` OR ${voucher} LIKE ${param(like(simple))} ESCAPE '\\'` : '');
    };
    if (filters.orderId) {
        // Preserve the original numeric orderId contract. Numeric q additionally
        // searches the human voucher number, so operators need not know DB IDs.
        if (/^\d+$/.test(filters.orderId)) {
            conditions.push(Number(filters.orderId) <= 2147483647 ? `ol.order_id = ${param(Number(filters.orderId))}` : 'FALSE');
        } else {
            const full = parseErpVoucher(filters.orderId.replace(/\s/g, ''));
            const day = parseErpDate(filters.orderId);
            conditions.push(full ? datedVoucherMatch(full.day, full.sequence) : day ? datedVoucherMatch(day) : `(${voucherMatch(filters.orderId)})`);
        }
    }
    if (filters.userId) conditions.push(`ol.user_id = ${param(Number(filters.userId))}`);
    if (filters.actionType) conditions.push(`ol.action_type = ${param(filters.actionType)}`);
    if (filters.workType) conditions.push(`${workType} = ${param(filters.workType)}`);
    if (filters.start) conditions.push(`ol.created_at >= (${param(filters.start)}::date::timestamp AT TIME ZONE 'Asia/Taipei')`);
    if (filters.end) conditions.push(`ol.created_at < ((${param(filters.end)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Taipei')`);
    let scanTerms = false;
    for (const term of filters.terms) {
        // An operation word identifies a scan event, not a customer's name or
        // a claim/error that happened during the packing stage.
        if (packingWords.has(term)) {
            conditions.push("ol.action_type = 'pack'");
            continue;
        }
        const day = parseErpDate(term);
        if (day) {
            const date = param(day);
            conditions.push(`(${datedVoucherMatch(day)} OR (ol.created_at >= ${dayStart(date)} AND ol.created_at < ${dayEnd(date)}))`);
            continue;
        }
        const full = parseErpVoucher(term);
        if (full) {
            conditions.push(datedVoucherMatch(full.day, full.sequence));
            continue;
        }
        const literal = param(like(term));
        const matches = ['u.name', 'u.username', "ol.actor_snapshot->>'name'", "ol.actor_snapshot->>'username'", 'o.customer_name', 'ol.action_type']
            .map(field => `${normalized(field)} LIKE ${literal} ESCAPE '\\'`);
        matches.push(voucherMatch(term));
        if (/^\d+$/.test(term) && Number(term) > 0 && Number(term) <= 2147483647) matches.push(`ol.order_id = ${param(Number(term))}`);
        const actions = Object.hasOwn(actionTerms, term) ? actionTerms[term] : null;
        if (actions) matches.push(`ol.action_type = ANY(${param(actions)}::text[])`);
        if (term === '揀貨') matches.push(`${workType} = ${param('pick')}`);
        const scan = isScanTerm(term);
        scanTerms ||= scan;
        for (const key of scan ? ['serialNumber', 'scanRaw', 'barcode', 'scanValue', 'oldSn', 'newSn'] : []) {
            matches.push(`(jsonb_typeof(scan.data->'${key}') = 'string' AND ${normalized(`scan.data->>'${key}'`)} LIKE ${literal} ESCAPE '\\')`);
        }
        conditions.push(`(${matches.join(' OR ')})`);
    }
    // details is legacy TEXT, sometimes plain text or malformed JSON. PostgreSQL
    // 17 pg_input_is_valid also rejects invalid JSONB numbers/Unicode; IS JSON
    // alone would not make the cast safe. Never search arbitrary audit details.
    const scanJoin = scanTerms ? `LEFT JOIN LATERAL (
        SELECT CASE WHEN ol.action_type IN ('pick','pack','scan_error','defect_exchange') AND octet_length(ol.details) <= 65536
            THEN CASE WHEN pg_input_is_valid(ol.details, 'jsonb') THEN ol.details::jsonb END END AS data
    ) scan ON TRUE` : '';
    const from = `FROM operation_logs ol LEFT JOIN users u ON ol.user_id = u.id LEFT JOIN orders o ON ol.order_id = o.id ${scanJoin}`;
    return { params, param, conditions, from };
}

async function searchOperationLogs(pool, query) {
    const filters = parseFilters(query), built = buildFilter(filters);
    if (filters.cursor) built.conditions.push(`(ol.created_at, ol.id) < (${built.param(filters.cursor.at)}::timestamptz, ${built.param(filters.cursor.id)}::integer)`);
    const limit = built.param(filters.limit + 1);
    const result = await pool.query(`SELECT ol.id, ol.user_id, ol.order_id, ol.action_type, ol.details, ol.created_at,
        COALESCE(ol.actor_snapshot->>'name', u.name) AS user_name, ol.actor_snapshot->>'role' AS user_role,
        u.role AS current_user_role, ol.actor_snapshot, ol.work_type, ol.actor_snapshot IS NOT NULL AS has_actor_snapshot,
        o.voucher_number, o.customer_name, o.status AS order_status,
        to_char(ol.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
        ${built.from} WHERE ${built.conditions.join(' AND ') || 'TRUE'}
        ORDER BY ol.created_at DESC, ol.id DESC LIMIT ${limit}`, built.params);
    const rows = result.rows.slice(0, filters.limit);
    const nextCursor = result.rows.length > filters.limit ? encodeCursor(rows[rows.length - 1], filters.scope) : null;
    return { total: rows.length, logs: rows.map(({ cursor_created_at, ...row }) => row), nextCursor };
}

async function operationLogStats(pool, query) {
    const built = buildFilter(parseFilters(query, { statistics: true }));
    const { rows } = await pool.query(`SELECT ol.action_type, COUNT(*) AS count,
        COUNT(DISTINCT ol.user_id) AS unique_users, COUNT(DISTINCT ol.order_id) AS unique_orders
        ${built.from} WHERE ${built.conditions.join(' AND ') || 'TRUE'} GROUP BY ol.action_type ORDER BY count DESC, ol.action_type`, built.params);
    return { total: rows.reduce((total, row) => total + Number(row.count), 0), byActionType: rows };
}

module.exports = { searchOperationLogs, operationLogStats, parseFilters };
