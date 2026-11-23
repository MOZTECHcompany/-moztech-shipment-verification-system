// Both entry points run inside the caller's existing transaction. Batch size
// follows the Excel worksheet's 20,000 data rows (one or more rows per carton).
const { digest, fail, identity, assertCartonNotVoided } = require('./cartonContents');
const { lockCartonSerials } = require('./cartonGuards');

const MAX_ROWS = 20000;
const MAX_SERIALS = 10000;

async function lockHeaders(db, ids, { asCarton, retiredCartons }) {
    const { rows } = await db.query(`SELECT * FROM wms_cartons WHERE carton_id=ANY($1::text[])
        ORDER BY carton_id COLLATE "C" FOR UPDATE`, [ids]);
    const retired = retiredCartons ? await retiredCartons(db, ids) : new Set();
    return new Map(rows.map(row => {
        const carton = asCarton({ ...row, label_retired: retired.has(row.carton_id) });
        carton.lines = [];
        return [carton.cartonId, carton];
    }));
}

// Check the stored size before materializing the contents of existing boxes.
async function storedCounts(db, ids) {
    const { rows } = await db.query(`SELECT carton_id,COUNT(*)::int AS lines,
        SUM(jsonb_array_length(actual_sns))::int AS serials FROM wms_carton_lines
        WHERE carton_id=ANY($1::text[]) GROUP BY carton_id`, [ids]);
    return new Map(rows.map(row => [row.carton_id, row]));
}

async function loadLines(db, cartons) {
    const ids = Array.from(cartons.keys());
    if (!ids.length) return;
    const { rows } = await db.query(`SELECT * FROM wms_carton_lines
        WHERE carton_id=ANY($1::text[]) ORDER BY carton_id,position`, [ids]);
    const available = new Set();
    if (rows.some(line => line.actual_sns.length)) {
        const serials = await db.query(`SELECT s.serial_number FROM wms_carton_serials s
            JOIN wms_carton_lines l ON l.id=s.line_id WHERE l.carton_id=ANY($1::text[]) AND s.available`, [ids]);
        for (const row of serials.rows) available.add(row.serial_number);
    }
    for (const line of rows) {
        cartons.get(line.carton_id).lines.push({
            lineId: line.id, itemCode: line.item_code, productName: line.product_name,
            ean: line.international_barcode, internalScanCode: line.internal_scan_code, codeType: line.code_type,
            quantity: line.quantity, remainingQuantity: line.remaining_quantity, actualSN: line.actual_sns,
            remainingSN: line.actual_sns.filter(sn => available.has(sn)),
        });
    }
}

async function writeHistory(db, events, type, actorId, historyMeta) {
    if (!events.length) return;
    await db.query(`INSERT INTO wms_carton_history(carton_id,event_type,content_revision,state_revision,actor_id,details)
        SELECT c.carton_id,$2,c.content_revision,c.state_revision,$3,e.details || $4::jsonb
        FROM jsonb_to_recordset($1::jsonb) AS e(id text,details jsonb)
        JOIN wms_cartons c ON c.carton_id=e.id`, [JSON.stringify(events), type, actorId, JSON.stringify(historyMeta)]);
}

async function insertLines(db, fresh) {
    if (!fresh.length) return;
    const lines = fresh.flatMap(input => input.lines.map((line, position) => ({ ...line, id: input.cartonId, position })));
    await lockCartonSerials(db, lines.flatMap(line => line.actualSN));
    await db.query(`WITH inserted AS (
        INSERT INTO wms_carton_lines(carton_id,position,item_code,product_name,international_barcode,internal_scan_code,
            code_type,quantity,remaining_quantity,actual_sns)
        SELECT id,position,"itemCode","productName",ean,"internalScanCode","codeType",quantity,quantity,"actualSN"
        FROM jsonb_to_recordset($1::jsonb) AS line(id text,position int,"itemCode" text,"productName" text,
            ean text,"internalScanCode" text,"codeType" text,quantity int,"actualSN" jsonb)
        RETURNING id,actual_sns)
        INSERT INTO wms_carton_serials(line_id,serial_number)
        SELECT inserted.id,sn FROM inserted CROSS JOIN LATERAL jsonb_array_elements_text(actual_sns) AS serial(sn)`,
        [JSON.stringify(lines)]);
}

async function loadDetails(db, cartons, asAllocation) {
    const ids = Array.from(cartons.keys());
    const allocations = await db.query(`SELECT * FROM wms_carton_allocations
        WHERE carton_id=ANY($1::text[]) ORDER BY picked_at,id`, [ids]);
    const history = await db.query(`SELECT h.* FROM unnest($1::text[]) AS requested(id)
        CROSS JOIN LATERAL (SELECT * FROM wms_carton_history WHERE carton_id=requested.id ORDER BY id DESC LIMIT 100) h
        ORDER BY h.carton_id,h.id DESC`, [ids]);
    for (const carton of cartons.values()) {
        carton.allocations = [];
        carton.history = [];
    }
    for (const row of allocations.rows) cartons.get(row.carton_id).allocations.push(asAllocation(row));
    for (const row of history.rows) cartons.get(row.carton_id).history.push(row);
}

async function importBatch(db, inputs, user, options) {
    const ids = inputs.map(input => input.cartonId);
    // The primary key arbitrates concurrent imports, including new carton IDs.
    // Only the transaction which inserted the header may insert lines or history.
    const inserted = await db.query(`INSERT INTO wms_cartons(carton_id,source_system,source_reference,created_by,updated_by)
        SELECT id,system,reference,$4,$4 FROM unnest($1::text[],$2::text[],$3::text[]) AS input(id,system,reference)
        ORDER BY id COLLATE "C" ON CONFLICT (carton_id) DO NOTHING RETURNING carton_id`,
        [ids, inputs.map(input => input.sourceSystem), inputs.map(input => input.sourceReference), user.id]);
    const newIds = new Set(inserted.rows.map(row => row.carton_id));
    const cartons = await lockHeaders(db, ids, options);
    const fresh = inputs.filter(input => newIds.has(input.cartonId));
    const existing = inputs.filter(input => !newIds.has(input.cartonId));
    if (existing.length) {
        const counts = await storedCounts(db, existing.map(input => input.cartonId));
        for (const input of existing) {
            const stored = counts.get(input.cartonId);
            if (stored?.lines !== input.lines.length || stored.serials !== input.lines.reduce((n, line) => n + line.actualSN.length, 0)) {
                throw fail('CARTON_CONTENT_CONFLICT', `箱號 ${input.cartonId} 已有不同內容，整批未匯入`);
            }
        }
    }
    await insertLines(db, fresh);
    await loadLines(db, cartons);
    for (const input of existing) {
        if (digest(identity(cartons.get(input.cartonId))) !== digest(identity(input))) {
            throw fail('CARTON_CONTENT_CONFLICT', `箱號 ${input.cartonId} 已有不同內容，整批未匯入`);
        }
    }
    await writeHistory(db, fresh.map(input => ({ id: input.cartonId, details: input })), 'created', user.id, options.historyMeta);
    if (!options.summary) await loadDetails(db, cartons, options.asAllocation);
    const ordered = options.summary ? inputs : [...inputs].sort((a, b) => a.cartonId.localeCompare(b.cartonId));
    const items = ordered.map(input => {
        const carton = cartons.get(input.cartonId);
        const replayed = !newIds.has(input.cartonId);
        if (!options.summary) return { cartonId: carton.cartonId, replayed, carton };
        return { cartonId: carton.cartonId, replayed, status: carton.status, contentRevision: carton.contentRevision,
            quantity: carton.lines.reduce((n, line) => n + line.quantity, 0),
            serialCount: carton.lines.reduce((n, line) => n + line.actualSN.length, 0) };
    });
    return { format: 'corely-cartons-v1', items };
}

async function confirmBatch(db, requests, user, options) {
    const cartons = await lockHeaders(db, requests.map(entry => entry.cartonId), options);
    const drafts = new Map();
    for (const entry of requests) {
        const carton = cartons.get(entry.cartonId);
        if (!carton) throw fail('CARTON_NOT_FOUND', `整批未確認。找不到箱號 ${entry.cartonId}`, 404);
        if (carton.contentRevision !== entry.expectedContentRevision) {
            throw fail('CARTON_CONTENT_CHANGED', `整批未確認。箱號 ${entry.cartonId} 的內容已更新，請重新核對`);
        }
        try { assertCartonNotVoided(carton); }
        catch (error) { error.message = `整批未確認。${error.message}`; throw error; }
        if (carton.status === 'draft') drafts.set(carton.cartonId, carton);
    }
    if (drafts.size) {
        const ids = Array.from(drafts.keys());
        const counts = await storedCounts(db, ids);
        let lineCount = 0, serialCount = 0;
        for (const row of counts.values()) {
            lineCount += row.lines;
            serialCount += row.serials;
        }
        if (lineCount > MAX_ROWS || serialCount > MAX_SERIALS) {
            throw fail('CARTON_INVALID_INPUT', `每次確認最多 ${MAX_ROWS} 筆品項明細、${MAX_SERIALS} 個 SN，請分批確認`, 400);
        }
        await loadLines(db, drafts);
        const sns = Array.from(drafts.values()).flatMap(carton => carton.lines.flatMap(line => line.actualSN));
        await lockCartonSerials(db, sns);
        if (sns.length) {
            const occupied = await db.query(`SELECT serial_number FROM order_item_instances
                WHERE serial_number=ANY($1::text[]) AND status<>'pending' LIMIT 1`, [sns]);
            if (occupied.rows.length) {
                const sn = occupied.rows[0].serial_number;
                const source = Array.from(drafts.values()).find(carton => carton.lines.some(line => line.actualSN.includes(sn)));
                throw fail('CARTON_SN_OCCUPIED', `整批未確認。箱號 ${source.cartonId} 的 SN ${sn} 已揀貨或裝箱，請核對實物與原訂單`);
            }
        }
        const updated = await db.query(`UPDATE wms_cartons SET status='sealed',sealed_at=NOW(),state_revision=state_revision+1,
            updated_by=$2,updated_at=NOW() WHERE carton_id=ANY($1::text[]) AND status='draft' RETURNING *`, [ids, user.id]);
        if (updated.rows.length !== drafts.size) throw fail('CARTON_STATE_CHANGED', '箱狀態已更新，請重新核對後再確認');
        await writeHistory(db, Array.from(drafts.values(), carton => ({ id: carton.cartonId, details: { content: carton.lines } })),
            'sealed', user.id, options.historyMeta);
        for (const row of updated.rows) cartons.set(row.carton_id, options.asCarton(row));
    }
    return { items: requests.map(({ cartonId }) => {
        const carton = cartons.get(cartonId);
        return { cartonId, status: carton.status, contentRevision: carton.contentRevision,
            stateRevision: carton.stateRevision, sealedAt: carton.sealedAt, alreadyConfirmed: !drafts.has(cartonId) };
    }) };
}

module.exports = { MAX_ROWS, MAX_SERIALS, importBatch, confirmBatch };
