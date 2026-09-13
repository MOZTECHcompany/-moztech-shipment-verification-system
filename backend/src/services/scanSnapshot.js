const { createHash } = require('node:crypto');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sorted = rows => [...rows].sort((a,b) => Number(a.id)-Number(b.id));
// Opaque optimistic concurrency token. Only warehouse-relevant fields, so
// joined user names and SQL column order do not create false mismatches.
function stateToken(order, items, instances) {
    return digest([
        [order.id,order.status,order.picker_id,order.packer_id,order.voucher_number,order.customer_name,order.is_urgent,order.void_reason],
        sorted(items).map(i=>[i.id,i.order_id,i.product_code,i.product_name,i.barcode,i.quantity,i.picked_quantity,i.packed_quantity]),
        sorted(instances).map(i=>[i.id,i.order_item_id,i.serial_number,i.status])
    ]);
}
async function readLines(db, orderId) {
    const items = (await db.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId])).rows;
    const instances = (await db.query('SELECT i.* FROM order_item_instances i JOIN order_items oi ON i.order_item_id = oi.id WHERE oi.order_id = $1 ORDER BY i.id',[orderId])).rows;
    return {items,instances};
}
function parseCommand(body, userId) {
    if (body.responseMode === undefined) return null;
    if (body.responseMode !== 'delta-v1' || typeof body.commandId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.commandId) || typeof body.expectedState !== 'string' || !/^[0-9a-f]{64}$/.test(body.expectedState)) {
        throw Object.assign(new Error('掃碼識別無效，請重新載入訂單'),{status:400});
    }
    return {id:body.commandId.toLowerCase(),userId,hash:digest([Number(body.orderId),String(body.scanValue).trim(),body.type,Number(body.amount??1),body.orderItemId==null?null:Number(body.orderItemId),body.expectedState])};
}
function createWorkSnapshot(pool) {
    return async (req,res,next) => {
        if (!/^[1-9]\d{0,9}$/.test(req.params.orderId)) return res.status(400).json({message:'訂單識別無效'});
        let db,open=false,releaseError;
        try {
            db=await pool.connect();
            await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');open=true;
            await db.query("SET LOCAL statement_timeout='5000ms'");
            const order=(await db.query('SELECT o.*,p.name AS picker_name,pk.name AS packer_name FROM orders o LEFT JOIN users p ON p.id=o.picker_id LEFT JOIN users pk ON pk.id=o.packer_id WHERE o.id=$1',[req.params.orderId])).rows[0];
            if(!order){await db.query('ROLLBACK');open=false;return res.status(404).json({message:'找不到訂單'});}
            const {items,instances}=await readLines(db,order.id);
            await db.query('COMMIT');open=false;
            res.set('Cache-Control','private, no-store').json({order,items,instances,stateToken:stateToken(order,items,instances)});
        }catch(error){next(error)}finally{if(open)try{await db.query('ROLLBACK')}catch(e){releaseError=e}db?.release(releaseError)}
    };
}
module.exports={stateToken,readLines,parseCommand,createWorkSnapshot};
