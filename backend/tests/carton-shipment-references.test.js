const {PGlite}=require('@electric-sql/pglite');
const {readCartonShipmentReferences}=require('../src/services/cartonShipmentReferences');
let db,reads;
beforeEach(async()=>{db=new PGlite();reads=[];});
afterEach(async()=>{await db.close();});
const client=()=>({query:async(...args)=>{reads.push(args);return db.query(...args);}});
const seed=async()=>{
 await db.exec("CREATE TABLE warehouse_import_batches(id INTEGER,voucher_number TEXT); CREATE TABLE marketplace_work_order_links(order_id INTEGER,intake_order_id INTEGER); CREATE TABLE marketplace_intake_orders(id INTEGER,intake_id INTEGER); CREATE TABLE marketplace_warehouse_flows(intake_id INTEGER,erp_receipt JSONB); INSERT INTO warehouse_import_batches VALUES(2,'AUDIT-PICK-BATCH'); INSERT INTO marketplace_work_order_links VALUES(7,3); INSERT INTO marketplace_intake_orders VALUES(3,9);");
 await db.query('INSERT INTO marketplace_warehouse_flows VALUES(9,$1)',[{fingerprint:'a'.repeat(64),verificationKind:'sales-receipt',vouchers:['AUDIT-ERP-SAVED-2','AUDIT-ERP-SAVED-1']}]);
};
test('formal schema without marketplace tables returns blank refs without guessing WT or carton IDs',async()=>{
 expect(await readCartonShipmentReferences(client(),{id:7,voucher_number:'WT-AUDIT',import_batch_id:2})).toEqual({batchNumber:null,ecountVouchers:[],ecountVerificationKind:null});
 expect(reads).toHaveLength(1);
});
test('exact order and intake relationship return only the persisted original receipt',async()=>{
 await seed();
 expect(await readCartonShipmentReferences(client(),{id:7,import_batch_id:2})).toEqual({batchNumber:'AUDIT-PICK-BATCH',ecountVouchers:['AUDIT-ERP-SAVED-1','AUDIT-ERP-SAVED-2'],ecountVerificationKind:'sales-receipt'});
 expect(reads.every(([sql])=>sql.trim().startsWith('SELECT'))).toBe(true);
 expect((await readCartonShipmentReferences(client(),{id:8,voucher_number:'WT-AUDIT',import_batch_id:999})).ecountVouchers).toEqual([]);
});
test('missing or ambiguous source relationships and malformed receipt fail closed for export refs',async()=>{
 await seed();await db.exec('INSERT INTO marketplace_work_order_links VALUES(7,4); INSERT INTO marketplace_intake_orders VALUES(4,10); INSERT INTO marketplace_warehouse_flows VALUES(10,NULL);');
 const ambiguous=await readCartonShipmentReferences(client(),{id:7,import_batch_id:2});expect(ambiguous.ecountVouchers).toEqual([]);expect(ambiguous.referenceWarning).toMatch(/不唯一/);
 await db.exec('DELETE FROM marketplace_work_order_links WHERE intake_order_id=4');
 await db.query('UPDATE marketplace_warehouse_flows SET erp_receipt=$1 WHERE intake_id=9',[{fingerprint:'a'.repeat(64),verificationKind:'sales-receipt',vouchers:['AUDIT-PICK-BATCH']}]);
 expect((await readCartonShipmentReferences(client(),{id:7,import_batch_id:2})).ecountVouchers).toEqual([]);
});
