const { IMPORT_LIMITS } = require('./orderImportParser');

const badRequest = message => Object.assign(new Error(message), { status: 400, code: 'INVALID_BATCH_QUERY' });
const positiveId = value => typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value) && Number(value) <= 2147483647;

function parseBatchPage(params, query = {}) {
    if (!positiveId(params.batchId)) throw badRequest('匯入批次識別無效');
    if (Object.keys(query).some(key => !['limit', 'cursor'].includes(key))) throw badRequest('批次查詢參數無效');
    const batchId = Number(params.batchId);
    if (query.limit !== undefined && (typeof query.limit !== 'string' || !/^[1-9]\d{0,2}$/.test(query.limit) || Number(query.limit) > 100)) throw badRequest('每頁工作單數須為 1 至 100');
    let afterId = 0;
    if (query.cursor !== undefined) {
        try {
            if (typeof query.cursor !== 'string' || query.cursor.length > 160 || !/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error();
            const cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString());
            if (cursor.v !== 1 || cursor.batchId !== batchId || !Number.isSafeInteger(cursor.afterId) || cursor.afterId <= 0 || cursor.afterId > 2147483647) throw new Error();
            afterId = cursor.afterId;
        } catch { throw badRequest('批次分頁已失效，請重新載入'); }
    }
    return { batchId, limit: Number(query.limit || 30), afterId };
}

// Aggregate instances before joining to items: quantities must never be
// multiplied by the number of serials. Tracked progress uses instance states.
const lineStats = `WITH batch_items AS (
    SELECT oi.* FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.import_batch_id=$1
), serial_stats AS (
    SELECT i.order_item_id, COUNT(*)::int AS serial_count,
        COUNT(*) FILTER (WHERE i.status IN ('picked','packed'))::int AS picked_count,
        COUNT(*) FILTER (WHERE i.status='packed')::int AS packed_count
    FROM order_item_instances i JOIN batch_items bi ON bi.id=i.order_item_id GROUP BY i.order_item_id
), line_stats AS (
    SELECT bi.*, COALESCE(s.serial_count,0)::int AS serial_count,
        CASE WHEN s.serial_count>0 THEN s.picked_count ELSE COALESCE(bi.picked_quantity,0) END AS effective_picked,
        CASE WHEN s.serial_count>0 THEN s.packed_count ELSE COALESCE(bi.packed_quantity,0) END AS effective_packed,
        CASE WHEN s.serial_count>0 AND s.serial_count<>bi.quantity THEN 1 ELSE 0 END AS serial_mismatch_count
    FROM batch_items bi LEFT JOIN serial_stats s ON s.order_item_id=bi.id
)`;

const childSQL = `${lineStats}, order_stats AS (
    SELECT order_id,COUNT(*)::int AS item_count,SUM(quantity)::int AS total_quantity,
        SUM(effective_picked)::int AS picked_quantity,SUM(effective_packed)::int AS packed_quantity,
        SUM(serial_count)::int AS serial_count,SUM(serial_mismatch_count)::int AS serial_mismatch_count
    FROM line_stats GROUP BY order_id
)
SELECT o.id,o.voucher_number,o.import_batch_id,b.voucher_number AS batch_number,
    o.source_order_number,o.source_platform,o.source_store,o.work_barcode,o.customer_name,o.status,
    o.picker_id,o.packer_id,p.name AS picker_name,pk.name AS packer_name,
    COALESCE(s.item_count,0) AS item_count,COALESCE(s.total_quantity,0) AS total_quantity,
    COALESCE(s.picked_quantity,0) AS picked_quantity,COALESCE(s.packed_quantity,0) AS packed_quantity,
    COALESCE(s.serial_count,0) AS serial_count,COALESCE(s.serial_mismatch_count,0) AS serial_mismatch_count
FROM orders o JOIN warehouse_import_batches b ON b.id=o.import_batch_id
LEFT JOIN order_stats s ON s.order_id=o.id LEFT JOIN users p ON p.id=o.picker_id LEFT JOIN users pk ON pk.id=o.packer_id
WHERE o.import_batch_id=$1 ORDER BY o.id LIMIT $2`;

const productSQL = `${lineStats}
SELECT ls.product_code,ls.barcode,ARRAY_AGG(DISTINCT ls.product_name ORDER BY ls.product_name) AS product_names,
    COUNT(*)::int AS item_count,COUNT(DISTINCT ls.order_id)::int AS work_order_count,SUM(ls.quantity)::int AS total_quantity,
    SUM(ls.effective_picked)::int AS picked_quantity,SUM(ls.effective_packed)::int AS packed_quantity,
    SUM(ls.serial_count)::int AS serial_count,SUM(ls.serial_mismatch_count)::int AS serial_mismatch_count
FROM line_stats ls JOIN orders o ON o.id=ls.order_id
WHERE o.status<>'voided' GROUP BY ls.product_code,ls.barcode ORDER BY ls.product_code,ls.barcode`;

const counts = () => ({ workOrderCount: 0, itemCount: 0, totalQuantity: 0, pickedQuantity: 0, packedQuantity: 0, serialCount: 0, serialMismatchCount: 0 });
function summarizeChildren(children) {
    const active = counts(), voidedTotals = counts();
    const statusCounts = { pending: 0, picking: 0, picked: 0, packing: 0, completed: 0, voided: 0 };
    for (const child of children) {
        statusCounts[child.status] = (statusCounts[child.status] || 0) + 1;
        const totals = child.status === 'voided' ? voidedTotals : active;
        totals.workOrderCount++;
        for (const [target,source] of [['itemCount','item_count'],['totalQuantity','total_quantity'],['pickedQuantity','picked_quantity'],['packedQuantity','packed_quantity'],['serialCount','serial_count'],['serialMismatchCount','serial_mismatch_count']]) totals[target] += Number(child[source] || 0);
    }
    return { ...active, workOrderCount: children.length, activeWorkOrderCount: active.workOrderCount, statusCounts, voidedTotals };
}

function createImportBatchSnapshot(pool) {
    return async (req,res,next) => {
        let page;
        try { page = parseBatchPage(req.params,req.query); }
        catch (error) { return res.status(error.status).json({ code:error.code,message:error.message }); }
        let db,open=false,releaseError;
        try {
            db=await pool.connect();
            await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');open=true;
            await db.query("SET LOCAL statement_timeout='5000ms'");
            const batch=(await db.query(`SELECT b.id,b.voucher_number AS batch_number,b.created_at,b.created_by,u.name AS created_by_name
                FROM warehouse_import_batches b LEFT JOIN users u ON u.id=b.created_by WHERE b.id=$1`,[page.batchId])).rows[0];
            if (!batch) { await db.query('ROLLBACK');open=false;return res.status(404).json({code:'BATCH_NOT_FOUND',message:'找不到匯入批次'}); }
            const allChildren=(await db.query(childSQL,[page.batchId,IMPORT_LIMITS.items+1])).rows;
            if (allChildren.length>IMPORT_LIMITS.items) throw Object.assign(new Error('批次工作單數超過匯入上限，請由管理員核對資料'),{status:413,code:'BATCH_TOO_LARGE'});
            const productTotals=(await db.query(productSQL,[page.batchId])).rows;
            const remaining=allChildren.filter(child=>child.id>page.afterId);
            const children=remaining.slice(0,page.limit);
            const nextCursor=remaining.length>page.limit ? Buffer.from(JSON.stringify({v:1,batchId:page.batchId,afterId:children.at(-1).id})).toString('base64url') : null;
            const response={batch,children,summary:summarizeChildren(allChildren),productTotals,
                pagination:{limit:page.limit,nextCursor,totalWorkOrders:allChildren.length},
                workOrderIds:allChildren.map(child=>child.id),printableWorkOrderIds:allChildren.filter(child=>child.status!=='voided').map(child=>child.id)};
            await db.query('COMMIT');open=false;
            res.set('Cache-Control','private, no-store').json(response);
        } catch(error) { next(error); }
        finally { if(open)try{await db.query('ROLLBACK');}catch(error){releaseError=error;}db?.release(releaseError); }
    };
}

module.exports={parseBatchPage,summarizeChildren,createImportBatchSnapshot};
