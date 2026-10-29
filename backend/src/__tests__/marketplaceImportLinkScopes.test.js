const {PGlite}=require('@electric-sql/pglite');
const {matchMarketplaceWorkOrders}=require('../services/marketplaceImportLink');

describe('legacy import cannot bypass an uploaded-file scope (local SQL)',()=>{
 let db,query;
 const group={sourcePlatform:'Shopify',sourceStore:'test-store',sourceOrderNumber:'#A',items:[{sourceLineId:'LINE-A',productCode:'SKU-A',barcode:'4711299274572',quantity:1}]};
 beforeEach(async()=>{
  db=new PGlite();
  await db.exec(`CREATE TABLE marketplace_intake_orders(id INTEGER PRIMARY KEY,intake_id INTEGER,source_platform TEXT,source_store TEXT,source_order_number TEXT,draft_active BOOLEAN,expected_items JSONB);
   CREATE TABLE marketplace_intake_scope_orders(intake_id INTEGER,intake_order_id INTEGER,source_version INTEGER);
   CREATE TABLE marketplace_warehouse_flows(intake_id INTEGER);
   CREATE TABLE marketplace_work_order_links(intake_order_id INTEGER,order_id INTEGER);
   INSERT INTO marketplace_intake_orders VALUES(1,10,'Shopify','test-store','#A',TRUE,'[{"sourceLineId":"LINE-A","productCode":"SKU-A","barcode":"4711299274572","quantity":1}]');`);
  query=jest.fn(async(sql,args)=>sql.includes('pg_advisory_xact_lock')?{rows:[{}],rowCount:1}:db.query(sql,args));
 });
 afterEach(async()=>{await db.close();});
 test('borrowed source is blocked even if its historical canonical owner has no warehouse flow',async()=>{
  await db.exec('INSERT INTO marketplace_intake_scope_orders VALUES(20,1,0); INSERT INTO marketplace_warehouse_flows VALUES(20)');
  await expect(matchMarketplaceWorkOrders({query},[group])).rejects.toMatchObject({status:409,code:'MARKETPLACE_IMPORT_MISMATCH',message:expect.stringContaining('最新轉檔批次')});
  expect(query.mock.calls.some(([sql])=>sql.includes('FOR UPDATE'))).toBe(false);
 });
 test('scope-owned source cannot use the old endpoint with a required canonical intake',async()=>{
  await db.exec('INSERT INTO marketplace_intake_scope_orders VALUES(10,1,0); INSERT INTO marketplace_warehouse_flows VALUES(10)');
  await expect(matchMarketplaceWorkOrders({query},[group],10)).rejects.toMatchObject({status:409,message:expect.stringContaining('最新轉檔批次')});
 });
 test('ordinary legacy owner flow keeps its original guarded return path',async()=>{
  await db.exec('INSERT INTO marketplace_warehouse_flows VALUES(10)');
  await expect(matchMarketplaceWorkOrders({query},[group])).rejects.toMatchObject({status:409,message:expect.stringContaining('不可用舊理貨入口繞過核對')});
 });
 test('independent legacy sources without any scope or flow retain the original import contract',async()=>{
  const result=await matchMarketplaceWorkOrders({query},[group],10);
  expect(result.size).toBe(1);expect([...result.values()][0]).toMatchObject({id:1,intake_id:10});
  expect(query.mock.calls.some(([sql])=>/^(?:INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
 });
});
