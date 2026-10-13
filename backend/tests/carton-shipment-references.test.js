const {readCartonShipmentReferences}=require('../src/services/cartonShipmentReferences');
function fixture(){
 const h={schema:{batches:'warehouse_import_batches',links:'marketplace_work_order_links',sources:'marketplace_intake_orders',flows:'marketplace_warehouse_flows'},batches:[{id:2,voucher_number:'AUDIT-PICK-BATCH'}],links:[{orderId:7,intake_id:9,erp_receipt:{fingerprint:'a'.repeat(64),verificationKind:'sales-receipt',vouchers:['AUDIT-ERP-SAVED-2','AUDIT-ERP-SAVED-1']}}]};
 h.db={query:jest.fn(async(sql,args=[])=>{
  if(sql.includes('to_regclass('))return {rows:[h.schema]};
  if(sql.includes('SELECT voucher_number FROM warehouse_import_batches WHERE id=$1'))return {rows:h.batches.filter(b=>b.id===args[0])};
  if(sql.includes('WHERE l.order_id=$1'))return {rows:h.links.filter(l=>l.orderId===args[0])};
  throw Error('Unexpected or mutating query');
 })};return h;
}
test('formal schema without marketplace tables leaves original refs blank without inventing WT refs',async()=>{
 const h=fixture();h.schema={};expect(await readCartonShipmentReferences(h.db,{id:7,voucher_number:'WT-AUDIT',import_batch_id:2})).toEqual({batchNumber:null,ecountVouchers:[],ecountVerificationKind:null});expect(h.db.query).toHaveBeenCalledTimes(1);
});
test('exact order/intake JOIN and original import batch provide only saved receipt refs',async()=>{
 const h=fixture();expect(await readCartonShipmentReferences(h.db,{id:7,import_batch_id:2})).toEqual({batchNumber:'AUDIT-PICK-BATCH',ecountVouchers:['AUDIT-ERP-SAVED-1','AUDIT-ERP-SAVED-2'],ecountVerificationKind:'sales-receipt'});
 const query=h.db.query.mock.calls.find(([sql])=>sql.includes('WHERE l.order_id=$1'));expect(query[0]).toContain('s.id=l.intake_order_id');expect(query[0]).toContain('f.intake_id=s.intake_id');expect(query[1]).toEqual([7]);
 expect(h.db.query.mock.calls.every(([sql])=>sql.trim().startsWith('SELECT'))).toBe(true);
 expect((await readCartonShipmentReferences(h.db,{id:8,import_batch_id:999})).ecountVouchers).toEqual([]);
});
test('ambiguous unrelated intake, missing or malformed receipt and internal batch code all leave ERP refs blank',async()=>{
 const h=fixture();h.links.push({orderId:7,intake_id:10,erp_receipt:null});expect((await readCartonShipmentReferences(h.db,{id:7,import_batch_id:2})).ecountVouchers).toEqual([]);
 h.links.pop();h.links[0].erp_receipt.vouchers=['AUDIT-PICK-BATCH'];expect((await readCartonShipmentReferences(h.db,{id:7,import_batch_id:2})).ecountVouchers).toEqual([]);
 h.links[0].erp_receipt=null;expect((await readCartonShipmentReferences(h.db,{id:7,import_batch_id:2})).ecountVouchers).toEqual([]);
});
