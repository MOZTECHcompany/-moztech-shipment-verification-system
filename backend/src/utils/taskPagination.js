const { createHash } = require('node:crypto');

const badRequest = message => Object.assign(new Error(message), { status: 400 });
const compact = value => value.replace(/[^\p{L}\p{N}]/gu, '');
const like = value => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
const roles = new Set(['admin', 'dispatcher', 'picker', 'packer']);

function parseTaskPage(user, query, view) {
    const role = user.role === 'superadmin' ? 'admin' : user.role;
    if (!roles.has(role)) throw Object.assign(new Error('使用者角色無效'), { status: 403 });
    for (const key of ['q', 'status', 'date', 'urgent', 'limit', 'cursor', 'group']) {
        if (query[key] !== undefined && typeof query[key] !== 'string') throw badRequest('查詢參數格式不正確');
    }
    const search = (query.q || '').normalize('NFKC').trim().toLocaleLowerCase();
    if (search.length > 120) throw badRequest('搜尋文字最多 120 個字');
    const status = query.status || 'all';
    if (!['all', 'pending', 'picking', 'picked', 'packing', 'completed'].includes(status)) throw badRequest('作業狀態無效');
    const group = query.group || 'all';
    if (!['all', 'pick', 'pack', 'inProgress', 'mine', 'picked', 'done'].includes(group)) throw badRequest('任務分類無效');
    const date = query.date || '';
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) throw badRequest('日期格式無效');
    if (query.urgent && !['true', 'false', '1', '0'].includes(query.urgent)) throw badRequest('緊急篩選格式無效');
    if (query.limit && !/^\d+$/.test(query.limit)) throw badRequest('分頁大小無效');
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 100);
    const urgent = ['true', '1'].includes(query.urgent);
    const scope = createHash('sha256').update(JSON.stringify([String(user.id), role, view, search, status, date, urgent, limit, group])).digest('hex').slice(0, 24);
    let cursor = null;
    if (query.cursor) {
        try {
            if (query.cursor.length > 800 || !/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error();
            cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString());
            if (cursor.v !== 1 || cursor.scope !== scope || ![cursor.mine, cursor.pin, cursor.urgent].every(v => v === 0 || v === 1) || !/^-?\d+(\.\d{1,6})?$/.test(String(cursor.at)) || !/^[1-9]\d{0,14}$/.test(String(cursor.id))) throw new Error();
        } catch { throw badRequest('分頁已失效，請重新整理清單'); }
    }
    return { userId: user.id, role, view, search, status, date, urgent, limit, scope, cursor, group };
}

// Opt-in page contract. The legacy array routes remain unchanged.
async function getTaskPage(pool, user, query, view) {
    const page = parseTaskPage(user, query, view);
    const params = [page.userId, page.role];
    const param = value => { params.push(value); return `$${params.length}`; };
    const conditions = [];
    if (view === 'active') {
        conditions.push(`(($2 IN ('admin', 'dispatcher') AND o.status IN ('pending','picking','picked','packing'))
            OR ($2 = 'picker' AND (o.status = 'pending' OR (o.status = 'picking' AND (o.picker_id = $1 OR o.picker_id IS NULL))))
            OR ($2 = 'packer' AND (o.status = 'picked' OR (o.status = 'packing' AND o.packer_id = $1))))`);
    } else {
        conditions.push(`(($2 IN ('admin','dispatcher') AND o.status IN ('picked','packing','completed'))
            OR ($2 = 'picker' AND o.picker_id = $1 AND o.status IN ('picked','packing','completed'))
            OR ($2 = 'packer' AND o.packer_id = $1 AND o.status = 'completed'))`);
    }
    if (page.status !== 'all') conditions.push(`o.status = ${param(page.status)}`);
    if (page.urgent) conditions.push('COALESCE(o.is_urgent, FALSE) = TRUE');
    const timeColumn = view === 'completed' ? 'updated_at' : 'created_at';
    if (page.date) {
        const date = param(page.date);
        conditions.push(`o.${timeColumn} >= ((${date}::date)::timestamp AT TIME ZONE 'Asia/Taipei') AND o.${timeColumn} < ((${date}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Taipei')`);
    }
    if (page.search) {
        const fields = ['o.voucher_number', 'o.customer_name'];
        const normalized = field => `lower(normalize(COALESCE(${field}, ''), NFKC))`;
        const stripped = field => `regexp_replace(${normalized(field)}, '[^[:alnum:]]', '', 'g')`;
        const terms = page.search.split(/\s+/).map(term => {
            const literal = param(like(term));
            const simple = compact(term);
            const simpleParam = simple ? param(like(simple)) : null;
            return `(${fields.map(field => `(${normalized(field)} LIKE ${literal} ESCAPE '\\'${simpleParam ? ` OR ${stripped(field)} LIKE ${simpleParam} ESCAPE '\\'` : ''})`).join(' OR ')})`;
        });
        const whole = compact(page.search);
        const wholeParam = whole ? param(like(whole)) : null;
        conditions.push(`((${terms.join(' AND ')})${wholeParam ? ` OR ${fields.map(field => `${stripped(field)} LIKE ${wholeParam} ESCAPE '\\'`).join(' OR ')}` : ''})`);
    }
    // Older installations create the shared pins relation on its first use.
    // Do not migrate or write while serving a task query.
    const pins = await pool.query("SELECT to_regclass('task_pins') IS NOT NULL AS available");
    const pinExpression = pins.rows[0]?.available ? 'EXISTS (SELECT 1 FROM task_pins pin WHERE pin.order_id = o.id)' : 'FALSE';
    // Counts and items share one statement snapshot and the same authorization/filter scope.
    const mine = page.role === 'dispatcher' ? 'imported_by_user_id = $1'
        : view === 'completed' ? 'TRUE'
        : page.role === 'picker' ? "status = 'picking' AND picker_id = $1"
        : page.role === 'packer' ? "status = 'packing' AND packer_id = $1" : 'FALSE';
    const groups = {
        all: 'TRUE', pick: "status IN ('pending','picking')", pack: "status IN ('picked','packing')",
        inProgress: "status IN ('picking','packing')", mine,
        picked: "status IN ('picked','packing')", done: "status = 'completed'",
    };
    let after = '';
    if (page.cursor) {
        const c = page.cursor;
        after = `WHERE (-_mine, -_pin, -_urgent, _at, id) > (${param(-c.mine)}::int, ${param(-c.pin)}::int, ${param(-c.urgent)}::int, ${param(c.at)}::numeric, ${param(c.id)}::bigint)`;
    }
    const limit = param(page.limit + 1);
    const result = await pool.query(`
        WITH eligible AS (
            SELECT o.id, o.voucher_number, o.customer_name, o.status, o.picker_id, o.packer_id,
                COALESCE(o.is_urgent, FALSE) AS is_urgent, o.updated_at AS completed_at,
                import_log.user_id AS imported_by_user_id,
                CASE WHEN $2 = 'dispatcher' AND import_log.user_id = $1 THEN 1 ELSE 0 END AS _mine,
                CASE WHEN ${pinExpression} THEN 1 ELSE 0 END AS _pin,
                CASE WHEN COALESCE(o.is_urgent, FALSE) THEN 1 ELSE 0 END AS _urgent,
                ${view === 'completed' ? '-' : ''}EXTRACT(EPOCH FROM COALESCE(o.${timeColumn}, o.created_at)) AS _at
            FROM orders o
            LEFT JOIN LATERAL (SELECT user_id FROM operation_logs WHERE $2 = 'dispatcher' AND order_id = o.id AND action_type = 'import' ORDER BY created_at DESC, id DESC LIMIT 1) import_log ON TRUE
            WHERE ${conditions.join(' AND ')}
        ), selected AS (
            SELECT * FROM eligible WHERE ${groups[page.group]}
        ), page AS (
            SELECT * FROM selected ${after}
            ORDER BY _mine DESC, _pin DESC, _urgent DESC, _at ASC, id ASC LIMIT ${limit}
        ), enriched AS (
        SELECT page.*, COALESCE(page.imported_by_user_id, page_import.user_id) AS _imported_by_user_id, picker.name AS picker_name, packer.name AS packer_name,
            CASE WHEN page.status = 'picking' THEN picker.name WHEN page.status = 'packing' THEN packer.name ELSE NULL END AS current_user,
            CASE WHEN page.status IN ('pending','picking') THEN 'pick' WHEN page.status IN ('picked','packing') THEN 'pack' ELSE 'done' END AS task_type,
            COALESCE(comments.total_comments, 0) AS total_comments, COALESCE(comments.urgent_comments, 0) AS urgent_comments,
            COALESCE(comments.unread_comments, 0) AS unread_comments,
            (SELECT json_build_object('content', c.content, 'user_name', u.name, 'priority', c.priority, 'created_at', c.created_at)
                FROM task_comments c LEFT JOIN users u ON c.user_id = u.id WHERE c.order_id = page.id ORDER BY c.created_at DESC, c.id DESC LIMIT 1) AS latest_comment
        FROM page
        LEFT JOIN LATERAL (SELECT user_id FROM operation_logs WHERE $2 != 'dispatcher' AND order_id = page.id AND action_type = 'import' ORDER BY created_at DESC, id DESC LIMIT 1) page_import ON TRUE
        LEFT JOIN users picker ON picker.id = page.picker_id LEFT JOIN users packer ON packer.id = page.packer_id
        LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS total_comments, COUNT(*) FILTER (WHERE c.priority = 'urgent')::int AS urgent_comments,
                COUNT(*) FILTER (WHERE c.user_id != $1 AND NOT EXISTS (SELECT 1 FROM task_comment_reads r WHERE r.comment_id = c.id AND r.user_id = $1))::int AS unread_comments
            FROM task_comments c WHERE c.order_id = page.id
        ) comments ON TRUE
        ORDER BY _mine DESC, _pin DESC, _urgent DESC, _at ASC, page.id ASC
        )
        SELECT COALESCE((SELECT json_agg(to_jsonb(enriched) || jsonb_build_object('_at', enriched._at::text) ORDER BY _mine DESC, _pin DESC, _urgent DESC, _at ASC, id ASC) FROM enriched), '[]'::json) AS items,
            (SELECT json_build_object(
                'total', COUNT(*),
                'pick', COUNT(*) FILTER (WHERE ${groups.pick}),
                'pack', COUNT(*) FILTER (WHERE ${groups.pack}),
                'inProgress', COUNT(*) FILTER (WHERE ${groups.inProgress}),
                'mine', COUNT(*) FILTER (WHERE ${groups.mine}),
                'picked', COUNT(*) FILTER (WHERE ${groups.picked}),
                'done', COUNT(*) FILTER (WHERE ${groups.done})
            ) FROM eligible) AS summary`, params);
    const allRows = result.rows[0].items;
    const hasMore = allRows.length > page.limit;
    const rows = allRows.slice(0, page.limit);
    const last = rows[rows.length - 1];
    const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ v: 1, scope: page.scope, mine: last._mine, pin: last._pin, urgent: last._urgent, at: String(last._at), id: last.id })).toString('base64url') : null;
    const items = rows.map(({ _mine, _pin, _urgent, _at, _imported_by_user_id, ...item }) => ({ ...item, imported_by_user_id: _imported_by_user_id }));
    return { items, hasMore, nextCursor, limit: page.limit, countScope: 'filtered', summary: result.rows[0].summary };
}

module.exports = { getTaskPage, parseTaskPage };
