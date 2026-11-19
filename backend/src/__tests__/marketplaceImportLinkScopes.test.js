const {PGlite}=require('@electric-sql/pglite');
const xlsx=require('xlsx');
const {matchMarketplaceWorkOrders,parseMarketplaceLinkedImport}=require('../services/marketplaceImportLink');

describe('legacy import cannot bypass an uploaded-file scope (local SQL)',()=>{
 let db,query;
 const group={sourcePlatform:'Shopify',sourceStore:'test-store',sourceOrderNumber:'#A',items:[{sourceLineId:'LINE-A',productCode:'SKU-A',barcode:'4711299274572',quantity:1}]};
 beforeEach(async()=>{
  db=new PGlite();
  await db.exec(`CREATE TABLE marketplace_intake_orders(id INTEGER PRIMARY KEY,intake_id INTEGER,source_platform TEXT,source_store TEXT,source_order_number TEXT,draft_active BOOLEAN,expected_items JSONB,nonstock_items JSONB NOT NULL DEFAULT '[]');
   CREATE TABLE marketplace_intake_scope_orders(intake_id INTEGER,intake_order_id INTEGER,source_version INTEGER);
   CREATE TABLE marketplace_warehouse_flows(intake_id INTEGER);
   CREATE TABLE marketplace_work_order_links(intake_order_id INTEGER,order_id INTEGER);
   INSERT INTO marketplace_intake_orders(id,intake_id,source_platform,source_store,source_order_number,draft_active,expected_items) VALUES(1,10,'Shopify','test-store','#A',TRUE,'[{"sourceLineId":"LINE-A","productCode":"SKU-A","barcode":"4711299274572","quantity":1}]');`);
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

describe('saved nonstock freight in source-detailed logistics imports',()=>{
 const headers=['理貨單號','商城訂單編號','平台','店鋪','來源明細號','品項編碼','品項名稱','國際條碼','數量','摘要','內部掃描碼','序號/批號','實際SN','箱號'];
 const stock=['PICK-01','#A','Shopify','test-store','LINE-A','SKU-A','商品','4711299274572','1'];
 const fee=['PICK-01','#A','Shopify','test-store','FEE-A','00001','運費','00001','36','雙十一活動運費'];
 const source={id:1,intake_id:10,source_platform:'Shopify',source_store:'test-store',source_order_number:'#A',
  draft_active:true,nonstock_items:[{sourceLineId:'FEE-A',productCode:'00001',quantity:36}],
  expected_items:[{sourceLineId:'LINE-A',productCode:'SKU-A',barcode:'4711299274572',quantity:1}]};
 const group={sourcePlatform:'Shopify',sourceStore:'test-store',sourceOrderNumber:'#A',items:source.expected_items};
 function bytes(rows){
  const book=xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet([headers,...rows]),'理貨單');
  return xlsx.write(book,{type:'buffer',bookType:'xlsx'});
 }
 const fixtureDb=()=>({query:jest.fn(async(sql)=>{
  if(sql.includes('JOIN unnest')||sql.startsWith('SELECT * FROM marketplace_intake_orders'))return {rows:[structuredClone(source)],rowCount:1};
  if(sql.startsWith('SELECT COUNT(*)'))return {rows:[{count:1}]};
  return {rows:[],rowCount:0};
 })});
 test('saved freight with placeholder barcode and ordinary ECOUNT memo is omitted before scan parsing',async()=>{
  const db=fixtureDb();
  const parsed=await parseMarketplaceLinkedImport(bytes([fee,stock]),db);
  expect(parsed).toMatchObject({totalQuantity:1,freightExemptQuantity:36,items:[{productCode:'SKU-A',sourceRow:3}],omittedNonStock:[
   {voucherNumber:'PICK-01',sourcePlatform:'Shopify',sourceStore:'test-store',sourceOrderNumber:'#A',sourceLineId:'FEE-A',productCode:'00001',quantity:36,sourceRow:2}
  ]});
  expect(db.query).toHaveBeenCalledTimes(1);
  const [[,lookupKeys]]=db.query.mock.calls;
  expect(lookupKeys).toEqual([['Shopify'],['test-store'],['#A']]);
  await expect(matchMarketplaceWorkOrders(db,parsed.workOrders,10,parsed.omittedNonStock)).resolves.toHaveProperty('size',1);
 });
 test('batch lookup uses exact platform, store and order even when another store reuses the same identifiers',async()=>{
  const db=new PGlite();
  try{
   await db.exec(`CREATE TABLE marketplace_intake_orders(source_platform TEXT,source_store TEXT,source_order_number TEXT,intake_id INTEGER,draft_active BOOLEAN,nonstock_items JSONB);
    INSERT INTO marketplace_intake_orders VALUES('Shopify','other-store','#A',10,TRUE,'[{"sourceLineId":"FEE-A","productCode":"00001","quantity":36}]')`);
   const parsed=await parseMarketplaceLinkedImport(bytes([fee,stock]),db);
   expect(parsed.totalQuantity).toBe(37);
   expect(parsed.items.map(item=>item.productCode)).toEqual(['00001','SKU-A']);
   expect(parsed.omittedNonStock).toEqual([]);
   await db.exec("UPDATE marketplace_intake_orders SET source_store='test-store'");
   const matched=await parseMarketplaceLinkedImport(bytes([fee,stock]),db);
   expect(matched.totalQuantity).toBe(1);
   expect(matched.freightExemptQuantity).toBe(36);
  }finally{await db.close();}
 });
 test('changing the original snapshot fee after preflight rejects linking under source locks',async()=>{
  const db=fixtureDb();
  const parsed=await parseMarketplaceLinkedImport(bytes([fee,stock]),db);
  db.query.mockImplementation(async(sql)=>sql.startsWith('SELECT * FROM marketplace_intake_orders')?
   {rows:[{...source,nonstock_items:[{...source.nonstock_items[0],quantity:37}]}]}:{rows:[],rowCount:0});
  await expect(matchMarketplaceWorkOrders(db,[group],10,parsed.omittedNonStock)).rejects.toMatchObject({status:409,message:expect.stringContaining('已變更')});
  expect(db.query.mock.calls.some(([sql])=>sql.includes('pg_advisory_xact_lock'))).toBe(true);
 });
 test.each([
  ['different scan identity',7,'4711299274572'],
  ['declared SN in summary',9,'SN:TESTSN000001'],
  ['internal scan code',10,'ITM-OTHER'],
  ['carton or batch evidence',11,'CARTON-OTHER'],
  ['actual SN',12,'TESTSN000001'],
  ['a dedicated carton number',13,'CARTON-OTHER'],
  ['changed quantity',8,'37'],
 ])('saved freight with %s has to be reconciled instead of omitted',async(_,column,value)=>{
  const row=[...fee];row[column]=value;
  await expect(parseMarketplaceLinkedImport(bytes([row,stock]),fixtureDb())).rejects.toMatchObject({status:409,code:'MARKETPLACE_IMPORT_MISMATCH',message:expect.stringContaining('非庫存運費')});
 });
 test('omitted fees still participate in voucher and duplicate checks',async()=>{
  await expect(parseMarketplaceLinkedImport(bytes([fee,fee,stock]),fixtureDb())).rejects.toMatchObject({message:expect.stringContaining('運費來源明細重複')});
  const other=[...fee];other[0]='PICK-02';
  await expect(parseMarketplaceLinkedImport(bytes([other,stock]),fixtureDb())).rejects.toMatchObject({message:expect.stringContaining('同一檔案只能包含一張理貨單')});
 });
});
