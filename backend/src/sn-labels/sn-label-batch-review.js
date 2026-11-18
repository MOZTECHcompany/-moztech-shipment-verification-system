const { BadRequestException, ConflictException, NotFoundException, } = require('./errors');
const { randomUUID } = require('node:crypto');
const getRecord = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new BadRequestException('請填寫完整覆核資料');
    }
    return value;
};
const field = (value, name, max = 200) => {
    if (typeof value !== 'string' ||
        !value.trim() ||
        value.trim().length > max ||
        /[\u0000-\u001f\u007f]/.test(value)) {
        throw new BadRequestException(`請填寫有效的${name}`);
    }
    return value.trim();
};
async function lockSnLabelAllocation(tx) {
    await tx.$executeRaw `SELECT pg_advisory_xact_lock(726220926)`;
}
async function batchFor(tx, entity, id) {
    const [batch] = await tx.$queryRaw `
    SELECT id, quantity, data, retired_at, updated_at::text AS revision
    FROM sn_label_batches WHERE id=${id} AND entity_id=${entity} FOR UPDATE`;
    if (!batch)
        throw new NotFoundException('找不到已啟用批次');
    return batch;
}
function requireActive(batch) {
    if (batch.retired_at)
        throw new ConflictException('此批次已退回，原序號與箱號保留作查核');
}
async function latestReview(tx, id) {
    const [review] = await tx.$queryRaw `
    SELECT * FROM sn_label_batch_reversions WHERE batch_id=${id}
    ORDER BY requested_at DESC, id DESC LIMIT 1`;
    return review;
}
function summarize(review) {
    return review
        ? {
            id: review.id,
            state: review.state,
            requestedBy: review.requested_by,
            reason: review.request_reason,
            requestedAt: review.requested_at,
            reviewedBy: review.reviewed_by,
            reviewedAt: review.reviewed_at,
            blocker: review.evidence?.blocker || null,
            replacementDraftIds: review.replacement_draft_ids,
        }
        : null;
}
async function event(tx, entity, actor, batch, action, data) {
    await tx.$executeRaw `
    INSERT INTO sn_label_events (id,entity_id,batch_id,actor_id,action,data)
    VALUES (${randomUUID()},${entity},${batch},${actor},${action},${JSON.stringify(data)}::jsonb)`;
}
async function replacementDrafts(tx, entity, actor, batchId, reviewId) {
    const sources = await tx.$queryRaw `
    SELECT id, data FROM sn_label_drafts WHERE entity_id=${entity} AND batch_id=${batchId}
    ORDER BY updated_at, id FOR UPDATE`;
    if (!sources.length)
        throw new ConflictException('找不到原始草稿，請人工核對批次');
    const draftIds = [];
    for (const source of sources) {
        const newDraftId = randomUUID();
        await tx.$executeRaw `
      INSERT INTO sn_label_drafts (id,entity_id,data,created_by)
      VALUES (${newDraftId},${entity},${JSON.stringify(source.data)}::jsonb,${actor})`;
        draftIds.push(newDraftId);
        await event(tx, entity, actor, batchId, 'REVERT_DRAFT_CREATED', {
            reviewId,
            sourceDraftId: source.id,
            newDraftId,
        });
    }
    await tx.$executeRaw `UPDATE sn_label_batches SET retired_at=now(),updated_at=now() WHERE id=${batchId}`;
    return draftIds;
}
class SnLabelBatchReviewService {
    constructor(db) {
        this.db = db;
    }
    async read(id) {
        return summarize(await latestReview(this.db, id));
    }
    async receivingStates(entity, ids, db = this.db) {
        if (!ids.length)
            return new Map();
        const rows = await db.$queryRaw `
      SELECT b.id, CASE
        WHEN sn_label_has_receipt(b.entity_id, b.id, b.data->>'productId') THEN 'received'
        WHEN EXISTS (
          SELECT 1 FROM sn_label_events e WHERE e.batch_id=b.id AND e.entity_id=b.entity_id
            AND e.action='INBOUND_STATUS_RECORDED' AND e.data->>'status'='not-received'
        ) THEN 'not-received'
        ELSE 'unconfirmed'
      END AS status
      FROM sn_label_batches b WHERE b.entity_id=${entity} AND b.id=ANY(${ids}::text[])`;
        return new Map(rows.map((row) => [row.id, row.status]));
    }
    async markReceived(entity, actor, id, body) {
        const revision = field(getRecord(body).batchRevision, '批次版本', 100);
        return this.db.$transaction(async (tx) => {
            await lockSnLabelAllocation(tx);
            const batch = await batchFor(tx, entity, id);
            requireActive(batch);
            if (revision !== batch.revision)
                throw new ConflictException('批次已更新，請重新載入');
            const [manual] = await tx.$queryRaw `
        SELECT EXISTS (SELECT 1 FROM sn_label_events WHERE entity_id=${entity} AND batch_id=${id}
          AND action='INBOUND_STATUS_RECORDED' AND data->>'status'='received'
          AND data->>'source'='manual') AS recorded`;
            if (!manual.recorded) {
                await event(tx, entity, actor, id, 'INBOUND_STATUS_RECORDED', {
                    status: 'received', source: 'manual', batchRevision: revision,
                });
            }
            const pending = await latestReview(tx, id);
            if (pending?.state === 'pending') {
                const evidence = { method: 'manual-receipt-confirmed', blocker: 'BATCH_RECEIVED' };
                await tx.$executeRaw `
          UPDATE sn_label_batch_reversions SET state='blocked',reviewed_by=${actor},
            reviewed_at=now(),evidence=${JSON.stringify(evidence)}::jsonb
          WHERE id=${pending.id} AND state='pending'`;
                await event(tx, entity, actor, id, 'REVERT_REVIEWED', {
                    reviewId: pending.id, state: 'blocked', ...evidence,
                });
            }
            return { batchId: id, receivingStatus: 'received' };
        });
    }
    async returnToDraft(entity, actor, id, body) {
        const input = getRecord(body);
        const reason = field(input.reason, '退回原因', 400);
        const revision = field(input.batchRevision, '批次版本', 100);
        return this.db.$transaction(async (tx) => {
            await lockSnLabelAllocation(tx);
            const batch = await batchFor(tx, entity, id);
            const current = await latestReview(tx, id);
            if (batch.retired_at && current?.state === 'approved' &&
                current.evidence?.method === 'direct-return-before-receipt' &&
                current.requested_by === actor && current.request_reason === reason &&
                current.batch_snapshot.revision === revision)
                return summarize(current);
            requireActive(batch);
            if (revision !== batch.revision)
                throw new ConflictException('批次已更新，請重新載入');
            const status = (await this.receivingStates(entity, [id], tx)).get(id);
            if (status === 'received')
                throw new ConflictException('此批次已入庫，不可退回');
            if (status === 'unconfirmed' && input.confirmNotReceived === true) {
                await event(tx, entity, actor, id, 'INBOUND_STATUS_RECORDED', {
                    status: 'not-received', source: 'manual', batchRevision: revision,
                });
            }
            else if (status !== 'not-received') {
                throw new ConflictException('請先確認此批次的入庫狀態');
            }
            const reviewId = randomUUID();
            if (current?.state === 'pending') {
                const superseded = { method: 'superseded-by-direct-return', directReturnId: reviewId };
                await tx.$executeRaw `
          UPDATE sn_label_batch_reversions SET state='rejected',reviewed_by=${actor},
            reviewed_at=now(),evidence=${JSON.stringify(superseded)}::jsonb
          WHERE id=${current.id} AND state='pending'`;
            }
            const draftIds = await replacementDrafts(tx, entity, actor, id, reviewId);
            const evidence = {
                method: 'direct-return-before-receipt',
                receivingStatus: 'not-received',
                ...(current?.state === 'pending' ? { supersededReviewId: current.id } : {}),
            };
            const snapshot = { revision, quantity: batch.quantity, data: batch.data };
            const [result] = await tx.$queryRaw `
        INSERT INTO sn_label_batch_reversions
          (id,batch_id,requested_by,request_reason,batch_snapshot,state,reviewed_by,reviewed_at,evidence,replacement_draft_ids)
        VALUES (${reviewId},${id},${actor},${reason},${JSON.stringify(snapshot)}::jsonb,'approved',${actor},
          now(),${JSON.stringify(evidence)}::jsonb,${JSON.stringify(draftIds)}::jsonb) RETURNING *`;
            await event(tx, entity, actor, id, 'REVERT_RETURNED_TO_DRAFT', {
                reviewId, reason, receivingStatus: 'not-received', replacementDraftIds: draftIds,
                ...(current?.state === 'pending' ? { supersededReviewId: current.id } : {}),
            });
            return summarize(result);
        });
    }
    async recordOutput(entity, actor, id, data) {
        return this.db.$transaction(async (tx) => {
            await lockSnLabelAllocation(tx);
            const batch = await batchFor(tx, entity, id);
            requireActive(batch);
            if ((await latestReview(tx, id))?.state === 'pending') {
                throw new ConflictException('批次退回覆核中，暫停輸出');
            }
            await event(tx, entity, actor, id, 'EXPORT', data);
        });
    }
}

module.exports = { lockSnLabelAllocation, SnLabelBatchReviewService };
