const { normalizeLines, text, fail } = require('./cartonContents');
const { assertCartonManager } = require('../utils/cartonAccess');
const { actorSnapshot } = require('../utils/warehouseWork');

const view = row => ({ specId: row.spec_id, status: row.status, contentRevision: row.content_revision,
    lines: row.lines.map((line, index) => ({ ...line, lineId: index + 1 })),
    createdAt: row.created_at, updatedAt: row.updated_at });
function specId(value) {
    const id = text(value, '箱規編號', { max: 128 });
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) throw fail('BOX_SPEC_INVALID_INPUT', '箱規編號格式無效', 400);
    return id;
}
function linesForSpec(lines) {
    const result = normalizeLines(lines);
    if (result.some(line => line.actualSN.length)) throw fail('BOX_SPEC_HAS_SERIALS', '箱規只設定品項與每箱件數；實際 SN 請登記在各實體箱', 400);
    return result.map(({ actualSN, ...line }) => line);
}
function requireRevision(body) {
    if (!Number.isSafeInteger(body.expectedContentRevision) || body.expectedContentRevision < 1) throw fail('BOX_SPEC_INVALID_INPUT', '請重新載入箱規版本', 400);
}
function requireBody(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('BOX_SPEC_INVALID_INPUT', '箱規資料格式無效', 400);
}
function createBoxSpecService({ pool }) {
    async function tx(work, readOnly = false) {
        const db = await pool.connect(); let open = false, commitAttempted = false, releaseError;
        try {
            await db.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN'); open = true;
            await db.query("SET LOCAL lock_timeout='1500ms'"); await db.query("SET LOCAL statement_timeout='8000ms'");
            const result = await work(db); commitAttempted = true; await db.query('COMMIT'); open = false; return result;
        } catch (error) {
            if (open) try { await db.query('ROLLBACK'); } catch (cleanup) { releaseError = cleanup; }
            if (commitAttempted || releaseError) {
                releaseError ||= error;
                throw fail('BOX_SPEC_RESULT_UNKNOWN', '結果尚未確認，請重新查詢原箱規，不要另建編號', 503);
            }
            if (error.code === '23505') throw fail('BOX_SPEC_ID_CONFLICT', '此箱規編號已存在，請查詢原紀錄', 409);
            if (['55P03','57014'].includes(error.code)) throw fail('BOX_SPEC_BUSY', '箱規正在更新，請重新載入後重試', 409);
            throw error;
        } finally { db.release(releaseError); }
    }
    async function staff(db, actor, manage = false, body) {
        const user = (await db.query('SELECT id,username,name,role,management_scope FROM users WHERE id=$1', [actor?.id])).rows[0];
        if (!user || !['admin','superadmin','dispatcher','picker','packer'].includes(user.role)) throw fail('AUTH_REQUIRED', '需要有效登入', 401);
        if (manage) {
            assertCartonManager(user);
            if (!Number.isSafeInteger(body?.expectedActorId) || body.expectedActorId !== user.id) throw fail('BOX_SPEC_ACTOR_CHANGED', '登入人員已變更，請重新載入', 409);
        }
        return user;
    }
    async function read(db, id, lock = false) {
        const row = (await db.query(`SELECT * FROM wms_box_specs WHERE spec_id=$1${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0];
        if (!row) throw fail('BOX_SPEC_NOT_FOUND', '找不到箱規', 404);
        return row;
    }
    async function history(db, id, event, actor, details) {
        await db.query(`INSERT INTO wms_box_spec_history(spec_id,event_type,content_revision,actor_id,details)
            SELECT spec_id,$2,content_revision,$3,$4 FROM wms_box_specs WHERE spec_id=$1`,
        [id, event, actor.id, JSON.stringify({ ...details, actor_snapshot: actorSnapshot(actor) })]);
    }
    async function activateRow(db, row, actor) {
        if (row.status === 'active') return row;
        await db.query("UPDATE wms_box_specs SET status='active',updated_by=$2,updated_at=NOW() WHERE spec_id=$1", [row.spec_id, actor.id]);
        await history(db, row.spec_id, 'activated', actor, { lines: row.lines });
        return read(db, row.spec_id);
    }
    async function list(query, actor) {
        if (query.q !== undefined && typeof query.q !== 'string') throw fail('BOX_SPEC_INVALID_INPUT', '查詢文字無效', 400);
        const q = query.q ? text(query.q.replace(/^BOX-SPEC:/i, ''), '查詢文字', { max: 128 }) : '';
        const limit = query.limit === undefined ? 50 : Number(query.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw fail('BOX_SPEC_INVALID_INPUT', '查詢筆數需為 1–100', 400);
        return tx(async db => {
            await staff(db, actor);
            const rows = (await db.query(`SELECT *,count(*) OVER()::int total FROM wms_box_specs
                WHERE POSITION(lower($1) IN lower(spec_id))>0 OR EXISTS (
                    SELECT 1 FROM jsonb_array_elements(lines) AS line WHERE POSITION(lower($1) IN lower(line->>'itemCode'))>0
                    OR POSITION(lower($1) IN lower(COALESCE(line->>'productName','')))>0)
                ORDER BY updated_at DESC,spec_id LIMIT $2`, [q, limit])).rows;
            return { items: rows.map(view), total: rows[0]?.total ?? 0 };
        }, true);
    }
    async function get(id, actor) {
        id = specId(id);
        return tx(async db => {
            await staff(db, actor); const row = await read(db, id);
            const events = (await db.query('SELECT * FROM wms_box_spec_history WHERE spec_id=$1 ORDER BY id DESC LIMIT 100', [id])).rows;
            return { ...view(row), history: events };
        }, true);
    }
    async function nextNumber(query, actor) {
        const prefix = text(query.prefix, '箱號前綴', { max: 25 });
        if (!/^[A-Z][A-Z0-9_-]{0,24}$/.test(prefix)) throw fail('BOX_SPEC_INVALID_INPUT', '箱號前綴請使用大寫英文字母、數字、底線或連字號', 400);
        return tx(async db => {
            await staff(db, actor);
            const pattern = '^' + prefix + '([1-9][0-9]{0,6})$';
            const row = (await db.query(`SELECT COALESCE(MAX((regexp_match(carton_id,$1))[1]::integer),0)+1 AS next_number
                FROM wms_cartons WHERE carton_id ~ $1`, [pattern])).rows[0];
            if (row.next_number > 9999999) throw fail('BOX_SPEC_SEQUENCE_FULL', '此箱號前綴已用完，請換一個前綴', 409);
            return { prefix, nextNumber: row.next_number };
        }, true);
    }
    async function create(body, actor) {
        requireBody(body);
        const id = specId(body.specId), lines = linesForSpec(body.lines);
        return tx(async db => {
            const user = await staff(db, actor, true, body);
            await db.query('INSERT INTO wms_box_specs(spec_id,lines,created_by,updated_by) VALUES($1,$2,$3,$3)', [id, JSON.stringify(lines), user.id]);
            await history(db, id, 'created', user, { lines });
            let row = await read(db, id);
            if (body.activate === true) row = await activateRow(db, row, user);
            return view(row);
        });
    }
    async function edit(id, body, actor) {
        requireBody(body);
        id = specId(id); const lines = linesForSpec(body.lines); requireRevision(body);
        if (body.specId !== undefined && body.specId !== id) throw fail('BOX_SPEC_ID_IMMUTABLE', '箱規編號建立後固定，不能更名', 400);
        const reason = text(body.reason, '異動原因', { max: 1000 });
        return tx(async db => {
            const user = await staff(db, actor, true, body), before = await read(db, id, true);
            if (before.content_revision !== body.expectedContentRevision) throw fail('BOX_SPEC_CONTENT_CHANGED', '箱規已更新，請重新載入', 409);
            await db.query("UPDATE wms_box_specs SET lines=$2,status='draft',content_revision=content_revision+1,updated_by=$3,updated_at=NOW() WHERE spec_id=$1", [id, JSON.stringify(lines), user.id]);
            await history(db, id, 'contents_revised', user, { reason, before: before.lines, after: lines, beforeStatus: before.status });
            return view(await read(db, id));
        });
    }
    async function activate(id, body, actor) {
        requireBody(body);
        id = specId(id); requireRevision(body);
        return tx(async db => {
            const user = await staff(db, actor, true, body), row = await read(db, id, true);
            if (row.content_revision !== body.expectedContentRevision) throw fail('BOX_SPEC_CONTENT_CHANGED', '箱規已更新，請重新載入', 409);
            return view(await activateRow(db, row, user));
        });
    }
    return { list, get, create, edit, activate, nextNumber };
}
module.exports = { createBoxSpecService, linesForSpec };
