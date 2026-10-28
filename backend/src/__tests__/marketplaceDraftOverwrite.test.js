const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {createMarketplaceDraftOverwriteService}=require('../services/marketplaceDraftOverwrite');
const actor={id:1,role:'dispatcher'},sku='4711299273094';
const settings={store:'測試店',customerCode:'00063',customerName:'測試店',warehouseCode:'003',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,date:'2026-10-28',batchSequence:'1',salesExportMode:'product-200-v1',skuMappings:{[sku]:{erpSku:sku,erpName:'測試商品',barcode:sku,confirmed:true,barcodeConfirmed:true}}};
const row=(number,extra={})=>({Name:number,Id:number==='#A'?'1001':number==='#B'?'1002':number==='#C'?'1003':'1004','Financial Status':'paid','Fulfillment Status':'unfulfilled',Currency:'TWD',Subtotal:'200',Shipping:'0',Taxes:'0',Total:'200','Discount Amount':'0','Refunded Amount':'0','Outstanding Balance':'0','Payment Method':'credit_card','Lineitem quantity':'2','Lineitem name':'測試商品','Lineitem price':'100','Lineitem sku':sku,'Lineitem discount':'0','Lineitem id':`gid://shopify/LineItem/${number.slice(1).charCodeAt(0)}`,...extra});
const table=records=>{const headers=[...new Set(records.flatMap(Object.keys))];return[headers,...records.map(record=>headers.map(key=>record[key]??''))];};
const changed=()=>row('#A',{'Lineitem quantity':'1',Subtotal:'100',Total:'100'});

async function setup(){
 const db=new PGlite();
 await db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2);
 CREATE TABLE marketplace_intakes(id SERIAL PRIMARY KEY,batch_number TEXT UNIQUE,source_platform TEXT,source_store TEXT,fingerprint TEXT UNIQUE,created_by INTEGER REFERENCES users(id),created_at TIMESTAMPTZ DEFAULT NOW(),snapshot JSONB,archived_at TIMESTAMPTZ);
 CREATE TABLE marketplace_intake_orders(id SERIAL PRIMARY KEY,intake_id INTEGER REFERENCES marketplace_intakes(id),source_platform TEXT,source_store TEXT,source_order_number TEXT,expected_items JSONB,nonstock_items JSONB DEFAULT '[]',financial JSONB,work_barcode TEXT UNIQUE,UNIQUE(source_platform,source_store,source_order_number));
 CREATE TABLE marketplace_warehouse_flows(intake_id INTEGER PRIMARY KEY REFERENCES marketplace_intakes(id),enabled_by INTEGER,enabled_at TIMESTAMPTZ DEFAULT NOW(),erp_receipt JSONB,erp_confirmed_by INTEGER,erp_confirmed_at TIMESTAMPTZ,import_batch_id INTEGER,print_owner_id INTEGER,printed_at TIMESTAMPTZ,prepick_owner_id INTEGER,prepick_completed_at TIMESTAMPTZ,prepick_counts JSONB DEFAULT '{}');
 CREATE TABLE marketplace_work_order_links(intake_order_id INTEGER PRIMARY KEY,order_id INTEGER);
 CREATE TABLE orders(id SERIAL PRIMARY KEY,source_platform TEXT,source_store TEXT,source_order_number TEXT);
 CREATE TABLE warehouse_import_batches(id SERIAL PRIMARY KEY,voucher_number TEXT);
 CREATE TABLE marketplace_warehouse_events(id SERIAL PRIMARY KEY,intake_id INTEGER,action TEXT);`);
 await db.exec(fs.readFileSync(require.resolve('../../migrations/041_marketplace_draft_revisions.sql'),'utf8'));
 const h={db,calls:[],prepareCalls:0,commitAckLost:false,failUpdate:false,beforeConnect:null,live:{},failOmitted:false};
 const query=async(sql,args)=>{
  h.calls.push([sql,args]);
  if(sql.includes('pg_advisory_xact_lock'))return{rows:[{}],rowCount:1};
  if(h.failUpdate&&sql.startsWith('UPDATE marketplace_intake_orders')&&(h.failUpdate===true||h.failUpdate===args[0]))throw Error('injected update failure');
  if(h.failAuditBatch===args?.[0]&&sql.startsWith('INSERT INTO marketplace_draft_revisions'))throw Error('injected audit failure');
  const result=await db.query(sql,args);
  if(h.commitAckLost&&sql==='COMMIT'){h.commitAckLost=false;throw Error('COMMIT acknowledgement lost');}
  return result;
 };
 h.pool={query,connect:async()=>{if(h.beforeConnect){const hook=h.beforeConnect;h.beforeConnect=null;await hook();}return{query,release:()=>{}};}};
 const unified=await import('../services/unifiedMarketplace.mjs');
 h.convert=async(records,batchNumber='WMS-DRAFT-001')=>{
  const rows=table(records),{parsed:raw,source}=unified.parseUnifiedMarketplace(rows);require('../services/marketplacePreparation').deliveryForOrders(source,raw);
  const prepared=unified.prepareUnifiedMarketplace(raw,{...settings,batchNumber});
  const orders=raw.orders.map(order=>{
   const items=prepared.parsed.items.filter(i=>i.sourceOrderNumber===order.sourceOrderNumber),quantity=items.reduce((n,i)=>n+i.quantity,0),financial=order.financial;
   return{number:order.sourceOrderNumber,id:records.find(r=>r.Name===order.sourceOrderNumber).Id,cancelled:false,cancelledAt:null,currency:'TWD',fulfillmentStatus:'unfulfilled',paymentStatus:'paid',currentQuantity:quantity,remainingQuantity:quantity,subtotalMinor:financial.subtotalMinor,shippingMinor:financial.shippingMinor,discountMinor:financial.discountMinor,productDiscountMinor:financial.discountMinor,shippingGrossMinor:financial.shippingMinor,shippingDiscountMinor:0,shippingCancellationMinor:0,shippingLines:financial.shippingMinor?[{id:'shipping',removed:false,originalMinor:financial.shippingMinor,currentMinor:financial.shippingMinor}]:[],removedLineIds:[],totalMinor:financial.totalMinor,receivedMinor:financial.totalMinor,outstandingMinor:0,items:items.map(i=>({id:i.sourceLineId,sku:i.sku,barcode:sku,variantId:'gid://shopify/ProductVariant/1',quantity:i.quantity,unfulfilledQuantity:i.quantity,netMinor:i.lineSubtotalMinor})),...h.live[order.sourceOrderNumber]};
  });
  const verification={mode:'api',platform:'Shopify',shop:'test.myshopify.com',version:'shopify-current-v2',orders,checkedAt:new Date().toISOString()};
  return{source:{platform:'Shopify',rows},raw,...prepared,settings:prepared.effectiveSettings,verification,sourceEvidence:{rows,verification,draftSourceReview:{mode:'operator-reviewed-csv-v1',fingerprint:'CSV-REVIEW'}},barcodeReviews:[],profileId:'1'};
 };
 h.prepare=jest.fn(async(body,options)=>{h.prepareCalls++;if(h.failOmitted&&!body.records)throw Error('synthetic API unavailable');return h.convert(body.records||body.rows.slice(1).map(values=>Object.fromEntries(body.rows[0].map((key,index)=>[key,values[index]]))));});
 h.service=createMarketplaceDraftOverwriteService({pool:h.pool,prepareMarketplace:h.prepare,validateSnapshot:async snapshot=>{const {prepareEcountFinancials}=await import('../services/marketplaceIntake.mjs');prepareEcountFinancials(snapshot);}});
 h.addBatch=async(records,batchNumber='WMS-DRAFT-001')=>{
  const c=await h.convert(records,batchNumber),snapshot={platform:'Shopify',handler:{id:2,name:'原建立者'},settings:c.settings,sourceEvidence:c.sourceEvidence,barcodeReviews:[],summary:c.output.summary,headers:c.output.headers,rows:c.output.rows,reportHeaders:c.output.reportHeaders,reportRows:c.output.reportRows,orders:c.parsed.orders.map(order=>({...order,sourceFinancial:c.raw.orders.find(o=>o.sourceOrderNumber===order.sourceOrderNumber).financial})),items:c.parsed.items,prepick:c.prepick,...(c.output.salesLayout?{salesLayout:c.output.salesLayout}:{}),...(c.output.rounding?{rounding:c.output.rounding}:{})};
  const batch=(await db.query('INSERT INTO marketplace_intakes(batch_number,source_platform,source_store,fingerprint,created_by,snapshot) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[batchNumber,'Shopify',settings.store,batchNumber,2,snapshot])).rows[0];
  for(const order of snapshot.orders)await db.query('INSERT INTO marketplace_intake_orders(intake_id,source_platform,source_store,source_order_number,expected_items,financial,work_barcode) VALUES($1,$2,$3,$4,$5,$6,$7)',[batch.id,'Shopify',settings.store,order.sourceOrderNumber,snapshot.items.filter(i=>i.sourceOrderNumber===order.sourceOrderNumber).map(i=>({sourceLineId:i.sourceLineId,sourceSku:i.sku,productCode:sku,productName:i.productName,quantity:i.quantity,barcode:sku})),{source:order.sourceFinancial,ecount:order.financial},'WT-'+order.sourceOrderNumber.slice(1)]);
  await db.query('INSERT INTO marketplace_warehouse_flows(intake_id,enabled_by) VALUES($1,2)',[batch.id]);return batch;
 };
 h.batch=await h.addBatch([row('#A'),row('#B',{'Lineitem quantity':'1','Lineitem price':'50',Subtotal:'50',Total:'50'})]);
 h.body=async(records=[changed()],decisions={'#B':'exclude'})=>{const body={rows:table(records),records,settings,profileId:'1'},preview=await h.service.preview(body,actor);return{...body,commandId:randomUUID(),previewFingerprint:preview.previewFingerprint,confirmed:true,notImportedConfirmed:true,decisions};};
 return h;
}

describe('draft overwrite transaction with real PGlite SQL (advisory locks stubbed, no native concurrency claim)',()=>{
 let h;
 beforeEach(async()=>{h=await setup();});afterEach(async()=>{await h?.db.close();});
 test('migration keeps source ownership active by default and preview exposes omitted orders without mutation',async()=>{
  const result=await h.service.preview({rows:table([changed()]),records:[changed()],settings},actor);
  expect(result.affectedBatches[0]).toMatchObject({canOverwrite:true,uploadedOrders:[{orderNumber:'#A',changed:true}],omittedOrders:[{orderNumber:'#B',decisionKey:'#B'}]});
  expect((await h.db.query('SELECT draft_active FROM marketplace_intake_orders')).rows).toEqual([{draft_active:true},{draft_active:true}]);
  expect((await h.db.query('SELECT * FROM marketplace_draft_revisions')).rows).toEqual([]);
 });
 test('every omitted order requires an explicit answer and financial inconsistencies cannot be acknowledged away',async()=>{
  const body=await h.body();delete body.decisions['#B'];
  await expect(h.service.apply(body,actor)).rejects.toMatchObject({code:'MARKETPLACE_DRAFT_DECISIONS_REQUIRED'});
  const invalid=await h.body([row('#A',{'Lineitem quantity':'1'})]);
  await expect(h.service.apply(invalid,actor)).rejects.toMatchObject({code:'MARKETPLACE_DRAFT_NOT_READY'});
  expect((await h.db.query('SELECT * FROM marketplace_draft_revisions')).rows).toEqual([]);
 });
 test('exclude preserves source IDs, ownership and work barcodes, rebuilds a complete snapshot, and audits before state',async()=>{
  const before=(await h.db.query('SELECT * FROM marketplace_intake_orders ORDER BY id')).rows,body=await h.body();
  const response=await h.service.apply(body,actor),batch=(await h.db.query('SELECT * FROM marketplace_intakes WHERE id=$1',[h.batch.id])).rows[0];
  expect(response.batches[0]).toMatchObject({id:h.batch.id,batchNumber:h.batch.batch_number,draftRevision:1,activeOrderCount:1,excludedOrderNumbers:['#B']});
  expect(batch).toMatchObject({created_by:2,fingerprint:h.batch.fingerprint,batch_number:h.batch.batch_number});
  expect(batch.snapshot).toMatchObject({handler:{id:2,name:'原建立者'},draftRevision:1,draftExcludedOrderNumbers:['#B'],draftUpdatedBy:1});
  expect(batch.snapshot.orders.map(o=>o.sourceOrderNumber)).toEqual(['#A']);expect(batch.snapshot.items[0].quantity).toBe(1);expect(batch.snapshot.summary.ecountTotalMinor).toBe(10000);
  const after=(await h.db.query('SELECT * FROM marketplace_intake_orders ORDER BY id')).rows;
  expect(after.map(r=>[r.id,r.intake_id,r.source_order_number,r.work_barcode])).toEqual(before.map(r=>[r.id,r.intake_id,r.source_order_number,r.work_barcode]));
  expect(after.map(r=>r.draft_active)).toEqual([true,false]);
  const audit=(await h.db.query('SELECT * FROM marketplace_draft_revisions')).rows[0];expect(audit.before_snapshot).toEqual(h.batch.snapshot);expect(audit.before_sources.map(source=>source.id)).toEqual(before.map(source=>source.id));expect(audit.actor_id).toBe(1);expect(audit.after_hash).toMatch(/^[a-f0-9]{64}$/);
  expect((await h.db.query('SELECT * FROM orders')).rows).toEqual([]);
 });
 test('retry reads the committed command before API; the same UUID cannot change its request',async()=>{
  const body=await h.body(),first=await h.service.apply(body,actor),calls=h.prepareCalls;
  expect(await h.service.apply(body,actor)).toEqual({...first,replayed:true});expect(h.prepareCalls).toBe(calls);
  await expect(h.service.apply({...body,reason:'different'},actor)).rejects.toMatchObject({code:'MARKETPLACE_DRAFT_COMMAND_CHANGED'});
  expect((await h.db.query('SELECT * FROM marketplace_draft_revisions')).rows).toHaveLength(1);
 });
 test('a later upload restores an excluded original source without inserting or moving its identity',async()=>{
  await h.service.apply(await h.body(),actor);
  const body=await h.body([row('#B',{'Lineitem quantity':'1','Lineitem price':'50',Subtotal:'50',Total:'50'})],{'#A':'keep'});
  await h.service.apply(body,actor);
  expect((await h.db.query('SELECT draft_active,work_barcode FROM marketplace_intake_orders ORDER BY id')).rows).toEqual([{draft_active:true,work_barcode:'WT-A'},{draft_active:true,work_barcode:'WT-B'}]);
  const batch=(await h.db.query('SELECT snapshot FROM marketplace_intakes')).rows[0];expect(batch.snapshot.draftRevision).toBe(2);expect(batch.snapshot.orders).toHaveLength(2);expect(batch.snapshot.summary.ecountTotalMinor).toBe(15000);
 });
 test('keeping a discounted omitted order restores preallocation amounts instead of subtracting its discount twice',async()=>{
  await h.db.exec('DELETE FROM marketplace_intake_orders;DELETE FROM marketplace_warehouse_flows;DELETE FROM marketplace_intakes;');
  h.batch=await h.addBatch([row('#A'),row('#B',{Subtotal:'170',Total:'170','Discount Amount':'30','Lineitem discount':'20'})]);
  await h.service.apply(await h.body([changed()],{'#B':'keep'}),actor);
  const snapshot=(await h.db.query('SELECT snapshot FROM marketplace_intakes')).rows[0].snapshot;
  expect(snapshot.orders.find(o=>o.sourceOrderNumber==='#B').financial.totalMinor).toBe(17000);expect(snapshot.summary.ecountTotalMinor).toBe(27000);
 });
 test('a failed source update rolls back snapshot, active flags, history and command together',async()=>{
  const body=await h.body();h.failUpdate=true;
  await expect(h.service.apply(body,actor)).rejects.toThrow('injected update failure');
  expect((await h.db.query('SELECT snapshot FROM marketplace_intakes')).rows[0].snapshot).toEqual(h.batch.snapshot);
  expect((await h.db.query('SELECT * FROM marketplace_draft_revisions')).rows).toEqual([]);expect((await h.db.query('SELECT * FROM marketplace_draft_commands')).rows).toEqual([]);
  expect((await h.db.query('SELECT draft_active FROM marketplace_intake_orders')).rows.every(row=>row.draft_active)).toBe(true);
 });
 test('a lost COMMIT acknowledgement returns unknown and a same-command retry reads the saved result',async()=>{
  const body=await h.body();h.commitAckLost=true;
  await expect(h.service.apply(body,actor)).rejects.toMatchObject({code:'MARKETPLACE_DRAFT_RESULT_UNKNOWN',status:503});
  const calls=h.prepareCalls;expect((await h.service.apply(body,actor)).replayed).toBe(true);expect(h.prepareCalls).toBe(calls);
 });
 test.each([['receipt',"UPDATE marketplace_warehouse_flows SET erp_receipt='{}'"],['print','UPDATE marketplace_warehouse_flows SET printed_at=NOW()'],['assignment','UPDATE marketplace_warehouse_flows SET prepick_owner_id=1'],['counts',`UPDATE marketplace_warehouse_flows SET prepick_counts='{"x":0}'`],['task',"INSERT INTO orders(source_platform,source_store,source_order_number) VALUES('Shopify','測試店','#B')"],['link','INSERT INTO marketplace_work_order_links(intake_order_id,order_id) VALUES(1,NULL)'],['event',"INSERT INTO marketplace_warehouse_events(intake_id,action) VALUES(1,'scan')"]])('%s blocks the entire affected batch',async(label,sql)=>{
  await h.db.exec(sql);const body=await h.body();
  await expect(h.service.apply(body,actor)).rejects.toMatchObject({code:'MARKETPLACE_DRAFT_ALREADY_STARTED'});
  expect((await h.db.query('SELECT * FROM marketplace_draft_revisions')).rows).toEqual([]);
 });
 test('activity appearing after preparation is rechecked after source and row locks',async()=>{
  const body=await h.body();h.beforeConnect=()=>h.db.exec('UPDATE marketplace_warehouse_flows SET printed_at=NOW()');
  await expect(h.service.apply(body,actor)).rejects.toMatchObject({code:'MARKETPLACE_DRAFT_CHANGED'});
  expect((await h.db.query('SELECT * FROM marketplace_draft_revisions')).rows).toEqual([]);
  const locks=h.calls.filter(([sql])=>sql.includes('pg_advisory_xact_lock')&&sql.includes('wms-marketplace-source')).map(([,args])=>args[0]);expect(locks).toEqual([...locks].sort());
 });
 test('live receipt values remain distinct from a lower reviewed CSV shipment amount',async()=>{
  h.live['#A']={currentQuantity:2,totalMinor:20000,receivedMinor:20000,outstandingMinor:0};
  const preview=await h.service.preview({rows:table([changed()]),records:[changed()],settings},actor),order=preview.affectedBatches[0].uploadedOrders[0];
  expect(order).toMatchObject({after:{quantity:1,totalMinor:10000},live:{quantity:2,totalMinor:20000,receivedMinor:20000},diffAPI:true});
 });
 test.each([
  ['fulfilled',{fulfillmentStatus:'fulfilled',remainingQuantity:0}],
  ['cancelled',{cancelled:true,cancelledAt:'2026-10-28T02:00:00Z'}],
  ['partial',{currentQuantity:2,remainingQuantity:1}],
  ['changed amount',{totalMinor:6000}],
  ['changed barcode',{items:[{id:'gid://shopify/LineItem/66',sku,quantity:1,unfulfilledQuantity:1,netMinor:5000,variantId:'gid://shopify/ProductVariant/1',barcode:'4711299273100'}]}]
 ])('omitted %s orders require explicit exclusion, never silent keep',async(label,live)=>{
  h.live['#B']=live;
  const body=await h.body([changed()],{'#B':'keep'}),preview=await h.service.preview(body,actor);
  expect(preview.affectedBatches[0].omittedOrders[0]).toMatchObject({orderNumber:'#B',canKeep:false,keepBlockedReason:expect.any(String)});
  await expect(h.service.apply(body,actor)).rejects.toMatchObject({code:'MARKETPLACE_DRAFT_KEEP_NOT_AVAILABLE'});
  expect((await h.db.query('SELECT * FROM marketplace_draft_revisions')).rows).toHaveLength(0);
  expect((await h.service.apply({...body,decisions:{'#B':'exclude'}},actor)).applied).toBe(true);
 });
 test('omitted API failure permits explicit exclusion but cannot preserve stale order',async()=>{
  h.failOmitted=true;const body=await h.body([changed()],{'#B':'keep'});
  await expect(h.service.apply(body,actor)).rejects.toMatchObject({code:'MARKETPLACE_DRAFT_KEEP_NOT_AVAILABLE'});
  expect((await h.service.apply({...body,decisions:{'#B':'exclude'}},actor)).applied).toBe(true);
 });
 test('omitted API change after preview requires a fresh preview',async()=>{
  const body=await h.body([changed()],{'#B':'keep'});h.live['#B']={fulfillmentStatus:'fulfilled',remainingQuantity:0};
  await expect(h.service.apply(body,actor)).rejects.toMatchObject({code:'MARKETPLACE_DRAFT_CHANGED'});
  expect((await h.db.query('SELECT * FROM marketplace_draft_revisions')).rows).toHaveLength(0);
 });
 test('preview includes shipping differences instead of treating contact-only edits as unchanged',async()=>{
  const records=[{...row('#A'),'Shipping Name':'Synthetic recipient','Shipping Phone':'0000000000','Shipping Address1':'Synthetic address'}],preview=await h.service.preview({rows:table(records),records,settings},actor);
  expect(preview.affectedBatches[0].uploadedOrders[0].changes.some(change=>change.field==='shipping')).toBe(true);
 });
 test('multi-batch changes preserve both owners and record a revision per affected snapshot',async()=>{
  const second=await h.addBatch([row('#C'),row('#D')],'WMS-DRAFT-002'),records=[changed(),row('#C')];
  const body=await h.body(records,{'#B':'exclude','#D':'keep'}),response=await h.service.apply(body,actor);
  expect(response.batches).toHaveLength(2);expect((await h.db.query('SELECT * FROM marketplace_draft_revisions')).rows).toHaveLength(2);
  expect((await h.db.query('SELECT id,created_by FROM marketplace_intakes ORDER BY id')).rows).toEqual([{id:h.batch.id,created_by:2},{id:second.id,created_by:2}]);
 });
 test('a blocked second batch prevents all first-batch changes',async()=>{
  const second=await h.addBatch([row('#C'),row('#D')],'WMS-DRAFT-002'),records=[changed(),row('#C')],body=await h.body(records,{'#B':'exclude','#D':'keep'});
  await h.db.query('UPDATE marketplace_warehouse_flows SET printed_at=NOW() WHERE intake_id=$1',[second.id]);
  await expect(h.service.apply(body,actor)).rejects.toMatchObject({code:'MARKETPLACE_DRAFT_CHANGED'});
  expect((await h.db.query('SELECT * FROM marketplace_draft_revisions')).rows).toHaveLength(0);
  expect((await h.db.query('SELECT snapshot FROM marketplace_intakes WHERE id=$1',[h.batch.id])).rows[0].snapshot).toEqual(h.batch.snapshot);
 });
 test.each(['source','audit'])('a second-batch %s failure rolls back all affected batches',async(failure)=>{
  const second=await h.addBatch([row('#C'),row('#D')],'WMS-DRAFT-002'),records=[changed(),row('#C')],body=await h.body(records,{'#B':'exclude','#D':'keep'}),before=(await h.db.query('SELECT id,snapshot FROM marketplace_intakes ORDER BY id')).rows;
  if(failure==='source')h.failUpdate=(await h.db.query('SELECT id FROM marketplace_intake_orders WHERE intake_id=$1 ORDER BY id',[second.id])).rows[0].id;
  else h.failAuditBatch=second.id;
  await expect(h.service.apply(body,actor)).rejects.toThrow(`injected ${failure==='source'?'update':'audit'} failure`);
  expect((await h.db.query('SELECT id,snapshot FROM marketplace_intakes ORDER BY id')).rows).toEqual(before);
  expect((await h.db.query('SELECT draft_active FROM marketplace_intake_orders')).rows.every(source=>source.draft_active)).toBe(true);
  expect((await h.db.query('SELECT * FROM marketplace_draft_revisions')).rows).toHaveLength(0);
  expect((await h.db.query('SELECT * FROM marketplace_draft_commands')).rows).toHaveLength(0);
 });
});
