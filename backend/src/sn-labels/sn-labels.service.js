const { BadRequestException, ConflictException, NotFoundException, } = require('./errors');
const { lockSnLabelAllocation } = require('./sn-label-batch-review');
const { createHash, randomUUID } = require('crypto');
const { isDeepStrictEqual } = require('util');
const { allocationRule, cartonId, isNoSerial, serial, validateDraft, } = require('./sn-labels.rules');
class SnLabelsService {
    constructor(db, exporter, reviews) {
        this.db = db;
        this.exporter = exporter;
        this.reviews = reviews;
    }
    async event(tx, entity, actor, action, data, batch = null) {
        await tx.$executeRaw `INSERT INTO sn_label_events(id,entity_id,batch_id,actor_id,action,data) VALUES(${randomUUID()},${entity},${batch},${actor},${action},${JSON.stringify(data)}::jsonb)`;
    }
    async save(entity, actor, id, body) {
        if (!/^[a-zA-Z0-9-]{1,100}$/.test(id) ||
            !Number.isInteger(body?.revision) ||
            body.revision < 0)
            throw new BadRequestException('草稿版本錯誤，請重新讀取');
        const data = validateDraft(body.data);
        if (data.productId &&
            !(await this.db.productById(data.productId)))
            throw new NotFoundException('找不到此公司的產品');
        return this.db.$transaction(async (tx) => {
            if (body.revision === 0) {
                const count = await tx.$executeRaw `INSERT INTO sn_label_drafts(id,entity_id,data,created_by) VALUES(${id},${entity},${JSON.stringify(data)}::jsonb,${actor}) ON CONFLICT(id) DO NOTHING`;
                if (!count)
                    throw new ConflictException('草稿已存在，請重新載入');
            }
            else {
                const count = await tx.$executeRaw `UPDATE sn_label_drafts SET data=${JSON.stringify(data)}::jsonb,revision=revision+1,updated_at=now() WHERE id=${id} AND entity_id=${entity} AND revision=${body.revision} AND batch_id IS NULL`;
                if (!count)
                    throw new ConflictException('草稿已被更新或啟用，請重新載入');
            }
            await this.event(tx, entity, actor, 'SAVE_DRAFT', {
                draftId: id,
                revision: body.revision + 1,
            });
            return { id, revision: body.revision + 1, data };
        });
    }
    async remove(entity, actor, id, revision) {
        if (!Number.isInteger(revision) || revision < 1)
            throw new BadRequestException('草稿版本錯誤');
        return this.db.$transaction(async (tx) => {
            const [draft] = await tx.$queryRaw `SELECT * FROM sn_label_drafts WHERE id=${id} AND entity_id=${entity} FOR UPDATE`;
            if (!draft)
                throw new NotFoundException('找不到草稿');
            if (draft.batch_id || draft.revision !== revision)
                throw new ConflictException('草稿已更新或啟用，請重新載入；已啟用批次不可刪除');
            await this.event(tx, entity, actor, 'DELETE_DRAFT', {
                draftId: id,
                revision,
                data: draft.data,
            });
            await tx.$executeRaw `DELETE FROM sn_label_drafts WHERE id=${id} AND entity_id=${entity}`;
            return { deleted: true };
        });
    }
    // Shared by the read-only preview and locked allocation so both use the same rules.
    async plan(tx, entity, d) {
        const r = allocationRule(entity, d);
        const product = await tx.productById(d.productId);
        if (!product || product.barcode !== d.barcode || product.sku !== d.sku)
            throw new ConflictException('產品資料已異動或停用，請重新選取產品');
        const [counter] = r.noSerial
            ? []
            : await tx.$queryRaw `SELECT * FROM sn_label_counters WHERE prefix=${r.prefix}`;
        if (counter && counter.scope !== r.scope)
            throw new ConflictException('這組代碼與既有 SN 前綴相同，請使用不會重複的代碼');
        const first = r.noSerial ? null : (counter?.last_value || 0) + 1;
        const last = r.noSerial ? null : first + d.quantity - 1;
        if (!r.noSerial)
            serial(r.prefix, last);
        const [batch] = await tx.$queryRaw `SELECT b.*, EXISTS (
        SELECT 1 FROM sn_label_batch_reversions r WHERE r.batch_id=b.id AND r.state='pending'
      ) AS pending_review FROM sn_label_batches b WHERE b.merge_key=${r.mergeKey} AND b.retired_at IS NULL`;
        if (batch?.pending_review) {
            throw new ConflictException('同批箱號正在退回覆核，暫停追加');
        }
        if (batch &&
            (batch.data.capacity !== d.capacity ||
                batch.data.manufactureDate !== d.manufactureDate ||
                !isDeepStrictEqual(batch.data.label, d.label) ||
                batch.data.cartonWidth !== d.cartonWidth ||
                batch.data.cartonHeight !== d.cartonHeight))
            throw new ConflictException('同日追加需沿用原批次的製造日期、箱容量及標籤設定；請從原批次按「追加數量」');
        const [cc] = await tx.$queryRaw `SELECT last_value FROM sn_label_carton_counters WHERE scope=${r.cartonScope}`;
        const [bc] = batch
            ? await tx.$queryRaw `SELECT count(*)::int AS n FROM sn_label_cartons WHERE batch_id=${batch.id}`
            : [{ n: 0 }];
        const cartonStart = (cc?.last_value || 0) + 1, ordinalStart = bc.n + 1;
        const token = createHash('sha256')
            .update(JSON.stringify([
            d,
            first,
            last,
            cartonStart,
            ordinalStart,
            batch?.id || null,
            batch?.quantity || 0,
        ]))
            .digest('hex');
        return { r, first, last, batch, cartonStart, ordinalStart, token };
    }
    async preview(entity, input, page = 1) {
        const d = validateDraft({ ...input, name: input?.name || '裝箱預覽' });
        if (!Number.isInteger(page) || page < 1)
            throw new BadRequestException('分頁參數無效');
        return this.db.$transaction(async (tx) => {
            const p = await this.plan(tx, entity, d);
            const total = Math.ceil(d.quantity / d.capacity), rows = [];
            for (let index = (page - 1) * 10; index < Math.min(total, page * 10); index++) {
                const quantity = Math.min(d.capacity, d.quantity - index * d.capacity);
                const serials = p.r.noSerial
                    ? []
                    : Array.from({ length: quantity }, (_, i) => serial(p.r.prefix, p.first + index * d.capacity + i));
                rows.push({
                    id: cartonId(d, p.cartonStart + index),
                    ordinal: p.ordinalStart + index,
                    quantity,
                    serials,
                });
            }
            return {
                first: p.first,
                last: p.last,
                noSerial: p.r.noSerial,
                token: p.token,
                total,
                rows,
                checkedAt: new Date().toISOString(),
            };
        }, { isolationLevel: 'RepeatableRead' });
    }
    async list(entity, q) {
        const term = String(q.search || '')
            .trim()
            .slice(0, 100), start = String(q.start || ''), end = String(q.end || ''), manufactureStart = String(q.manufactureStart || ''), manufactureEnd = String(q.manufactureEnd || '');
        const pendingReviewOnly = q.status === 'pending-review';
        const status = pendingReviewOnly
            ? 'active'
            : ['draft', 'active', 'retired'].includes(q.status) ? q.status : '';
        const page = Math.max(1, Math.min(100000, Number(q.page) || 1));
        const rows = await this.db.$queryRaw `
   SELECT *,count(*) OVER()::int AS total FROM (
    SELECT id,'draft' AS status,revision,data,updated_at,NULL::text AS pending_review_requested_by
    FROM sn_label_drafts WHERE entity_id=${entity} AND batch_id IS NULL
    UNION ALL
    SELECT b.id,CASE WHEN b.retired_at IS NULL THEN 'active' ELSE 'retired' END AS status,0 AS revision,
      b.data || jsonb_build_object('quantity',b.quantity),b.updated_at,r.requested_by
    FROM sn_label_batches b
    LEFT JOIN sn_label_batch_reversions r ON r.batch_id=b.id AND r.state='pending' AND b.retired_at IS NULL
    WHERE b.entity_id=${entity}
   ) entries WHERE (${status}='' OR status=${status})
    AND (NOT ${pendingReviewOnly} OR pending_review_requested_by IS NOT NULL)
    AND (${term}='' OR strpos(lower(data->>'name'),lower(${term}))>0 OR strpos(lower(data->>'productName'),lower(${term}))>0 OR strpos(data->>'barcode',${term})>0 OR strpos(lower(data->>'model'),lower(${term}))>0)
    AND (${start}='' OR data->>'orderDate'>=${start}) AND (${end}='' OR data->>'orderDate'<=${end})
    AND (${manufactureStart}='' OR data->>'manufactureDate'>=${manufactureStart}) AND (${manufactureEnd}='' OR data->>'manufactureDate'<=${manufactureEnd})
   ORDER BY CASE WHEN ${q.sort === 'asc'} THEN data->>'orderDate' END ASC,
    CASE WHEN ${q.sort !== 'asc'} THEN data->>'orderDate' END DESC,updated_at DESC LIMIT 30 OFFSET ${(page - 1) * 30}`;
        const receivingStates = await this.reviews.receivingStates(entity, rows.filter((row) => row.status !== 'draft').map((row) => row.id));
        return {
            rows: rows.map((row) => ({
                ...row,
                ...(row.status !== 'draft' ? { receivingStatus: receivingStates.get(row.id) || 'unconfirmed' } : {}),
            })),
            total: rows[0]?.total || 0,
            page,
        };
    }
    async activate(entity, actor, id, revision, previewToken) {
        if (!Number.isInteger(revision) || revision < 1)
            throw new BadRequestException('請先儲存草稿');
        return this.db.$transaction(async (tx) => {
            // All allocations share this database lock, across processes and companies.
            // It also serializes printable-prefix registration and global carton numbering.
            await lockSnLabelAllocation(tx);
            const [draft] = await tx.$queryRaw `SELECT * FROM sn_label_drafts WHERE id=${id} AND entity_id=${entity} FOR UPDATE`;
            if (!draft)
                throw new NotFoundException('找不到草稿');
            if (draft.batch_id)
                return { batchId: draft.batch_id, replayed: true };
            if (draft.revision !== revision)
                throw new ConflictException('草稿已被其他人更新，請重新核對');
            const d = validateDraft(draft.data);
            const plan = await this.plan(tx, entity, d);
            const { r, first, last, cartonStart, ordinalStart } = plan;
            let { batch } = plan;
            if (previewToken !== undefined && previewToken !== plan.token)
                throw new ConflictException('可配號碼或裝箱內容已變更，請重新查看裝箱規劃後再確認');
            // Validate printability before reserving any numbers.
            if (!r.noSerial)
                await this.exporter.pdf('labels', d, [{ sn: serial(r.prefix, last) }], []);
            await this.exporter.pdf(r.noSerial ? 'cartons-no-sn' : 'cartons', d, [], [
                {
                    id: cartonId(d, cartonStart + Math.ceil(d.quantity / d.capacity) - 1),
                    quantity: Math.min(d.quantity, d.capacity),
                    serials: r.noSerial
                        ? []
                        : Array.from({ length: Math.min(d.quantity, d.capacity) }, (_, i) => serial(r.prefix, first + i)),
                },
            ]);
            if (!batch) {
                batch = { id: randomUUID() };
                await tx.$executeRaw `INSERT INTO sn_label_batches(id,entity_id,merge_key,data,created_by) VALUES(${batch.id},${entity},${r.mergeKey},${JSON.stringify(d)}::jsonb,${actor})`;
                await this.event(tx, entity, actor, 'INBOUND_STATUS_RECORDED', {
                    status: 'not-received', source: 'activation',
                }, batch.id);
            }
            await tx.$executeRaw `INSERT INTO sn_label_carton_counters(scope) VALUES(${r.cartonScope}) ON CONFLICT(scope) DO NOTHING`;
            const boxes = [], items = [];
            for (let offset = 0; offset < d.quantity; offset += d.capacity) {
                const boxIndex = boxes.length, quantity = Math.min(d.capacity, d.quantity - offset), box = cartonId(d, cartonStart + boxIndex);
                boxes.push({
                    id: box,
                    batch_id: batch.id,
                    source_id: id,
                    ordinal: ordinalStart + boxIndex,
                    quantity,
                });
                for (let i = 0; !r.noSerial && i < quantity; i++)
                    items.push({
                        sn: serial(r.prefix, first + offset + i),
                        batch_id: batch.id,
                        source_id: id,
                        carton_id: box,
                        sequence: first + offset + i,
                        position: i + 1,
                    });
            }
            await tx.$executeRaw `INSERT INTO sn_label_cartons SELECT * FROM jsonb_to_recordset(${JSON.stringify(boxes)}::jsonb) AS x(id text,batch_id text,source_id text,ordinal int,quantity int)`;
            await tx.$executeRaw `INSERT INTO sn_label_serials SELECT * FROM jsonb_to_recordset(${JSON.stringify(items)}::jsonb) AS x(sn text,batch_id text,source_id text,carton_id text,sequence int,position int)`;
            if (!r.noSerial)
                await tx.$executeRaw `INSERT INTO sn_label_counters(scope,prefix,last_value) VALUES(${r.scope},${r.prefix},${last}) ON CONFLICT(scope) DO UPDATE SET last_value=EXCLUDED.last_value`;
            await tx.$executeRaw `UPDATE sn_label_carton_counters SET last_value=last_value+${boxes.length} WHERE scope=${r.cartonScope}`;
            await tx.$executeRaw `UPDATE sn_label_batches SET quantity=quantity+${d.quantity},updated_at=now() WHERE id=${batch.id}`;
            await tx.$executeRaw `UPDATE sn_label_drafts SET batch_id=${batch.id},updated_at=now() WHERE id=${id}`;
            await this.event(tx, entity, actor, 'ALLOCATE', {
                draftId: id,
                revision,
                first,
                last,
                quantity: d.quantity,
                cartons: boxes.map((b) => b.id),
            }, batch.id);
            return { batchId: batch.id, first, last, replayed: false };
        }, { timeout: 60000, maxWait: 30000 });
    }
    async detail(entity, id, page = 1) {
        const [b] = await this.db.$queryRaw `SELECT *, updated_at::text AS batch_revision FROM sn_label_batches WHERE id=${id} AND entity_id=${entity}`;
        if (!b)
            throw new NotFoundException('找不到已啟用批次');
        const [counts] = await this.db.$queryRaw `SELECT (SELECT min(sequence)::int FROM sn_label_serials WHERE batch_id=${id}) AS first,(SELECT max(sequence)::int FROM sn_label_serials WHERE batch_id=${id}) AS last,count(*)::int AS cartons FROM sn_label_cartons WHERE batch_id=${id}`;
        const boxes = await this.db.$queryRaw `SELECT c.*, COALESCE((SELECT jsonb_agg(s.sn ORDER BY s.position) FROM sn_label_serials s WHERE s.carton_id=c.id),'[]'::jsonb) AS serials FROM sn_label_cartons c WHERE batch_id=${id} ORDER BY ordinal LIMIT 20 OFFSET ${(Math.max(1, Number(page) || 1) - 1) * 20}`;
        const events = await this.db.$queryRaw `SELECT actor_id,action,data,created_at FROM sn_label_events WHERE batch_id=${id} ORDER BY created_at DESC LIMIT 100`;
        const review = await this.reviews.read(id);
        const receivingStatus = (await this.reviews.receivingStates(entity, [id])).get(id) || 'unconfirmed';
        return {
            id: b.id,
            status: b.retired_at ? 'retired' : 'active',
            batchRevision: b.batch_revision,
            review,
            receivingStatus,
            data: { ...b.data, quantity: b.quantity },
            ...counts,
            boxes,
            events,
        };
    }
    async exportData(entity, id, from, to, kind) {
        const [b] = await this.db.$queryRaw `SELECT * FROM sn_label_batches WHERE id=${id} AND entity_id=${entity}`;
        if (!b)
            throw new NotFoundException('找不到已啟用批次');
        if (!Number.isInteger(from) ||
            !Number.isInteger(to) ||
            from < 1 ||
            to < from ||
            to > 999999 ||
            to - from > 9999)
            throw new BadRequestException('請選擇有效的流水號範圍，每次最多 10,000 個');
        if (kind === 'warehouse-cartons') {
            if (to - from >= 100)
                throw new BadRequestException('每次最多匯出 100 箱，請縮小箱序範圍');
            const boxes = await this.db.$queryRaw `SELECT c.id,c.quantity,COALESCE((SELECT jsonb_agg(s.sn ORDER BY s.position) FROM sn_label_serials s WHERE s.carton_id=c.id),'[]'::jsonb) AS serials FROM sn_label_cartons c WHERE c.batch_id=${id} AND c.ordinal BETWEEN ${from} AND ${to} ORDER BY c.ordinal`;
            if (boxes.length !== to - from + 1)
                throw new BadRequestException('箱序範圍包含不存在的箱號');
            if (boxes.some((box) => box.serials.length !== (isNoSerial(b.data) ? 0 : box.quantity)))
                throw new ConflictException('箱內 SN 與數量不符，請先核對批次');
            return { data: b.data, items: [], boxes };
        }
        if (isNoSerial(b.data)) {
            if (kind !== 'cartons-no-sn')
                throw new BadRequestException('NSI 無 SN 產品僅提供無 SN 規格箱標籤');
            const boxes = await this.db.$queryRaw `SELECT *, '[]'::jsonb AS serials FROM sn_label_cartons WHERE batch_id=${id} AND ordinal>=${from} AND ordinal<=${to} ORDER BY ordinal`;
            if (!boxes.length)
                throw new BadRequestException('所選範圍沒有箱號');
            return { data: b.data, items: [], boxes };
        }
        const items = await this.db.$queryRaw `SELECT * FROM sn_label_serials WHERE batch_id=${id} AND sequence>=${from} AND sequence<=${to} ORDER BY sequence`;
        if (!items.length)
            throw new BadRequestException('所選範圍沒有已配發 SN');
        if (kind.startsWith('carton')) {
            const selected = items.map((i) => i.carton_id);
            const boxes = await this.db.$queryRaw `SELECT c.*, COALESCE((SELECT jsonb_agg(s.sn ORDER BY s.position) FROM sn_label_serials s WHERE s.carton_id=c.id),'[]'::jsonb) AS serials FROM sn_label_cartons c WHERE c.batch_id=${id} AND c.id IN (SELECT jsonb_array_elements_text(${JSON.stringify(selected)}::jsonb)) ORDER BY c.ordinal`;
            return { data: b.data, items, boxes }; // Carton exports always retain full box contents.
        }
        return { data: b.data, items, boxes: [] };
    }
}

module.exports = { SnLabelsService };
