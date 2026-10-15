const { readCartonShipmentReferences } = require('../src/services/cartonShipmentReferences');
function fixture() {
    const h = {
        schema: { batches:'warehouse_import_batches',links:'marketplace_work_order_links',sources:'marketplace_intake_orders',flows:'marketplace_warehouse_flows' },
        order: { id:7,import_batch_id:2,source_platform:'marketplace',source_store:'store-A',source_order_number:'SOURCE-A' },
        batches:[{id:2,voucher_number:'AUDIT-PICK-BATCH'}],
        items:[{order_id:7,source_line_id:'LINE-1',product_code:'SKU-1',quantity:2,quantity_sign:1}],
        links:[{orderId:7,intake_id:9,erp_receipt:{ fingerprint:'a'.repeat(64),verificationKind:'sales-receipt',vouchers:['AUDIT-ERP-SAVED-2','AUDIT-ERP-SAVED-1'],
            lines:[{identity:['marketplace','store-A','SOURCE-A','LINE-1'],productCode:'SKU-1',quantity:2,voucher:'AUDIT-ERP-SAVED-1'},
                {identity:['marketplace','store-A','SOURCE-B','LINE-2'],productCode:'SKU-2',quantity:9,voucher:'AUDIT-ERP-SAVED-2'}] }}]
    };
    h.db = { query: jest.fn(async (sql,args=[]) => {
        if(sql.includes('to_regclass('))return {rows:[h.schema]};
        if(sql.includes('SELECT voucher_number FROM warehouse_import_batches WHERE id=$1'))return {rows:h.batches.filter(b=>b.id===args[0])};
        if(sql.includes('WHERE l.order_id=$1'))return {rows:h.links.filter(l=>l.orderId===args[0])};
        if(sql.includes('SELECT * FROM order_items WHERE order_id=$1'))return {rows:h.items.filter(row=>row.order_id===args[0])};
        throw Error('Unexpected or mutating query');
    }) };
    return h;
}
test('formal schema without marketplace tables leaves original refs blank without inventing WT refs', async () => {
    const h=fixture();h.schema={};
    expect(await readCartonShipmentReferences(h.db,{id:7,voucher_number:'WT-AUDIT',import_batch_id:2})).toEqual({batchNumber:null,ecountVouchers:[],ecountVerificationKind:null});
    expect(h.db.query).toHaveBeenCalledTimes(1);
});
test('exact source-line identity provides only this order saved receipt refs, never every voucher in a shared batch', async () => {
    const h=fixture();
    expect(await readCartonShipmentReferences(h.db,h.order)).toEqual({batchNumber:'AUDIT-PICK-BATCH',ecountVouchers:['AUDIT-ERP-SAVED-1'],ecountVerificationKind:'sales-receipt'});
    const query=h.db.query.mock.calls.find(([sql])=>sql.includes('WHERE l.order_id=$1'));
    expect(query[0]).toContain('s.id=l.intake_order_id');expect(query[0]).toContain('f.intake_id=s.intake_id');expect(query[1]).toEqual([7]);
    expect(h.db.query.mock.calls.every(([sql])=>sql.trim().startsWith('SELECT'))).toBe(true);
    expect((await readCartonShipmentReferences(h.db,{id:8,import_batch_id:999})).ecountVouchers).toEqual([]);
});
test('ambiguous unrelated intake, missing or malformed receipt and internal batch code all leave ERP refs blank', async () => {
    const h=fixture();h.links.push({orderId:7,intake_id:10,erp_receipt:null});
    expect((await readCartonShipmentReferences(h.db,h.order)).ecountVouchers).toEqual([]);
    h.links.pop();h.links[0].erp_receipt.vouchers=['AUDIT-PICK-BATCH'];
    expect((await readCartonShipmentReferences(h.db,h.order)).ecountVouchers).toEqual([]);
    h.links[0].erp_receipt=null;expect((await readCartonShipmentReferences(h.db,h.order)).ecountVouchers).toEqual([]);
});
test('batch-only vouchers, missing source identities and mismatched receipt SKU or quantity cannot imply verified sales', async () => {
    for(const alter of [h=>delete h.links[0].erp_receipt.lines,h=>delete h.order.source_order_number,
        h=>h.items[0].source_line_id=null,h=>h.links[0].erp_receipt.lines[0].quantity=1,h=>h.links[0].erp_receipt.lines[0].productCode='OTHER']) {
        const h=fixture();alter(h);const result=await readCartonShipmentReferences(h.db,h.order);
        expect(result.ecountVouchers).toEqual([]);expect(result.referenceWarning).toBeTruthy();
    }
});
test('one source order may reference multiple vouchers only when their exact lines cover its actual quantity', async () => {
    const h=fixture();h.links[0].erp_receipt.lines=[
        {identity:['marketplace','store-A','SOURCE-A','LINE-1'],productCode:'SKU-1',quantity:1,voucher:'AUDIT-ERP-SAVED-1'},
        {identity:['marketplace','store-A','SOURCE-A','LINE-1'],productCode:'SKU-1',quantity:1,voucher:'AUDIT-ERP-SAVED-2'}
    ];
    expect((await readCartonShipmentReferences(h.db,h.order)).ecountVouchers).toEqual(['AUDIT-ERP-SAVED-1','AUDIT-ERP-SAVED-2']);
});
