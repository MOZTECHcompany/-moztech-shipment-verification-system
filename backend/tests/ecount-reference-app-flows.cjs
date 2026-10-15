// Real mounted app, real JWT and PostgreSQL. Verifies the route-specific parser,
// not the lightweight fixture's intentionally larger JSON parser.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
module.exports = async ({ t, api, ok, pool, users }) => {
    let target, item, view, saved, command;
    const sns = Array.from({length:1040},(_,i)=>`000Vendor-${String(i).padStart(4,'0')}-case/${'X'.repeat(50)}`);
    const path = () => `/api/orders/${target}/ecount-reference`;
    const warehouseRows = async () => ({
        order:(await pool.query('SELECT * FROM orders WHERE id=$1',[target])).rows[0],
        item:(await pool.query('SELECT * FROM order_items WHERE id=$1',[item])).rows[0],
        instances:(await pool.query('SELECT * FROM order_item_instances WHERE order_item_id=$1 ORDER BY id',[item])).rows
    });
    await t.test('real app accepts 1040 exact SN evidence above 100KB only on ECOUNT reference POST and keeps legacy counters untouched', async () => {
        target=(await pool.query("INSERT INTO orders(voucher_number,customer_name,status,picker_id,packer_id) VALUES('ECOUNT-LARGE-1040','Synthetic large-order customer','completed',$1,$2) RETURNING id",[users.picker,users.packer])).rows[0].id;
        item=(await pool.query("INSERT INTO order_items(order_id,product_code,barcode,product_name,quantity,picked_quantity,packed_quantity,serial_identity_mode) VALUES($1,'BIG-SN-SKU','BIG-SN-CODE','Synthetic large SN verification',1040,0,0,'exact') RETURNING id",[target])).rows[0].id;
        await pool.query("INSERT INTO order_item_instances(order_item_id,serial_number,status) SELECT $1,unnest($2::text[]),'packed'",[item,sns]);
        view=ok(await api('dispatcher','GET',path()));assert.equal(view.ready,true);assert.equal(view.totals[0].quantity,1040);assert.equal(view.looseRows[0].actualSN.length,1040);
        const before=await warehouseRows();
        command={commandId:randomUUID(),expectedRevision:0,expectedFingerprint:view.fingerprint,expectedActorId:users.dispatcher,
            companyCode:'SYNTHETIC-LARGE-SN',voucherNumber:'2026/10/15-1040',confirmation:{kind:'manual-line-check',acknowledgeExistingSales:true,acknowledgeMetadataSaved:true,
                lines:sns.map(sn=>({itemCode:'BIG-SN-SKU',quantity:1,actualSN:[sn]}))}};
        const bytes=Buffer.byteLength(JSON.stringify(command));assert.ok(bytes>100*1024&&bytes<2*1024*1024,`actual UTF8 body=${bytes}`);
        saved=ok(await api('dispatcher','POST',path(),command));assert.equal(saved.status,'manual_checked');assert.equal(saved.reference.confirmedBy.id,users.dispatcher);
        assert.deepEqual(await warehouseRows(),before);assert.equal(before.item.picked_quantity,0);assert.equal(before.item.packed_quantity,0);
        const evidence=(await pool.query('SELECT evidence FROM wms_ecount_reference_history WHERE order_id=$1',[target])).rows[0].evidence;
        assert.equal(evidence.lines.length,1040);assert.equal(evidence.lines.at(-1).actualSN[0],sns.at(-1));
    });
    await t.test('10001 manual rows and more than10000 total actual SNs are rejected before any reference revision or warehouse mutation', async () => {
        const before=await warehouseRows(),revision=saved.reference.revision;
        const base={...command,expectedRevision:revision,commandId:randomUUID()};
        const tooManyLines={...base,confirmation:{...command.confirmation,lines:Array.from({length:10001},(_,i)=>({itemCode:'BIG-SN-SKU',quantity:1,actualSN:[`BOUND-L${i}`]}))}};
        assert.ok(Buffer.byteLength(JSON.stringify(tooManyLines))<2*1024*1024);
        assert.equal((await api('dispatcher','POST',path(),tooManyLines)).status,400);
        const tooManySNs={...base,commandId:randomUUID(),confirmation:{...command.confirmation,lines:Array.from({length:1000},(_,i)=>({itemCode:'BIG-SN-SKU',quantity:11,actualSN:Array.from({length:11},(_,j)=>`BOUND-S${i}-${j}`)}))}};
        assert.equal((await api('dispatcher','POST',path(),tooManySNs)).status,400);
        const after=ok(await api('dispatcher','GET',path()));assert.equal(after.reference.revision,revision);assert.equal(after.history.length,1);assert.deepEqual(await warehouseRows(),before);
    });
    await t.test('unrelated auth route retains its original100KB JSON limit and no saved evidence is automatically sent to ECOUNT', async () => {
        assert.equal((await api(null,'POST','/api/auth/login',{username:'fixture-only',password:'fixture-only',padding:'x'.repeat(110*1024)})).status,413);
        const audit=(await pool.query("SELECT details::jsonb AS details FROM operation_logs WHERE order_id=$1 AND action_type='ecount_reference_manually_checked'",[target])).rows;
        assert.equal(audit.length,1);assert.equal(audit[0].details.externalSystemWritten,false);assert.equal(audit[0].details.inventoryPosted,false);
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM wms_ecount_reference_commands WHERE order_id=$1',[target])).rows[0].n,1);
    });
};
