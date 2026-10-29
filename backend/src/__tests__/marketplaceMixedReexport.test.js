const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {createMarketplaceDraftOverwriteService}=require('../services/marketplaceDraftOverwrite');
const {assertUploadScope}=require('../services/marketplaceUploadScopes');
const user={id:1,role:'dispatcher',name:'Synthetic operator'},sku='4711299273094';
const settings={store:'測試店',customerCode:'00063',customerName:'測試店',warehouseCode:'003',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,date:'2026-10-29',batchSequence:'1',salesExportMode:'product-200-v1',skuMappings:{[sku]:{erpSku:sku,erpName:'測試商品',barcode:sku,confirmed:true,barcodeConfirmed:true}}};
const row=(number,extra={})=>({Name:number,Id:String(1000+number.charCodeAt(1)),'Financial Status':'paid','Fulfillment Status':'unfulfilled',Currency:'TWD',Subtotal:'200',Shipping:'0',Taxes:'0',Total:'200','Discount Amount':'0','Refunded Amount':'0','Outstanding Balance':'0','Payment Method':'credit_card','Lineitem quantity':'2','Lineitem name':'測試商品','Lineitem price':'100','Lineitem sku':sku,'Lineitem discount':'0','Lineitem id':`gid://shopify/LineItem/${number.charCodeAt(1)}`,...extra});
const changed=number=>row(number,{'Lineitem quantity':'1',Subtotal:'100',Total:'100'});
const table=records=>{const headers=[...new Set(records.flatMap(Object.keys))];return [headers,...records.map(record=>headers.map(key=>record[key]??''))];};
const objects=rows=>rows.slice(1).map(values=>Object.fromEntries(rows[0].map((key,index)=>[key,values[index]])));
async function setup(){
 const db=new PGlite();
 await db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1),(2);
 CREATE TABLE marketplace_intakes(id SERIAL PRIMARY KEY,batch_number TEXT UNIQUE,source_platform TEXT,source_store TEXT,fingerprint TEXT UNIQUE,created_by INTEGER REFERENCES users(id),created_at TIMESTAMPTZ DEFAULT NOW(),snapshot JSONB,archived_at TIMESTAMPTZ);
 CREATE TABLE marketplace_intake_orders(id SERIAL PRIMARY KEY,intake_id INTEGER REFERENCES marketplace_intakes(id),source_platform TEXT,source_store TEXT,source_order_number TEXT,expected_items JSONB,nonstock_items JSONB DEFAULT '[]',financial JSONB,work_barcode TEXT UNIQUE,UNIQUE(source_platform,source_store,source_order_number));
 CREATE TABLE marketplace_warehouse_flows(intake_id INTEGER PRIMARY KEY REFERENCES marketplace_intakes(id),enabled_by INTEGER,enabled_at TIMESTAMPTZ DEFAULT NOW(),erp_receipt JSONB,erp_confirmed_by INTEGER,erp_confirmed_at TIMESTAMPTZ,import_batch_id INTEGER,print_owner_id INTEGER,printed_at TIMESTAMPTZ,prepick_owner_id INTEGER,prepick_completed_at TIMESTAMPTZ,prepick_counts JSONB DEFAULT '{}');
 CREATE TABLE marketplace_work_order_links(intake_order_id INTEGER PRIMARY KEY,order_id INTEGER);
 CREATE TABLE orders(id SERIAL PRIMARY KEY,source_platform TEXT,source_store TEXT,source_order_number TEXT);
 CREATE TABLE warehouse_import_batches(id SERIAL PRIMARY KEY,voucher_number TEXT);
 CREATE TABLE marketplace_warehouse_events(id SERIAL PRIMARY KEY,intake_id INTEGER,action TEXT);
 CREATE TABLE marketplace_store_profiles(id INTEGER PRIMARY KEY,platform TEXT,store TEXT,settings JSONB,updated_at TIMESTAMPTZ DEFAULT NOW());`);
 for(const migration of ['041_marketplace_draft_revisions.sql','042_marketplace_upload_scopes.sql'])await db.exec(fs.readFileSync(require.resolve('../../migrations/'+migration),'utf8'));
 await db.query('INSERT INTO marketplace_store_profiles(id,platform,store,settings) VALUES(1,$1,$2,$3)',['Shopify',settings.store,settings]);
 const h={db,calls:[],api:new Map(),live:{},enabled:true,beforeConnect:null,failSql:null,commitAckLost:false,prepareCount:0};
 const query=async(sql,args)=>{h.calls.push([sql,args]);if(sql.includes('pg_advisory_xact_lock'))return {rows:[{}],rowCount:1};if(h.failSql?.(sql,args))throw Error('synthetic SQL failure');const result=await db.query(sql,args);if(sql==='COMMIT'&&h.commitAckLost){h.commitAckLost=false;throw Error('synthetic commit acknowledgement lost');}return result;};
 h.pool={query,connect:async()=>{if(h.beforeConnect){const hook=h.beforeConnect;h.beforeConnect=null;await hook();}return {query,release:()=>{}};}};
 const unified=await import('../services/unifiedMarketplace.mjs');
 h.convert=async(records,{sourceRows=table(records),evidenceRecords=records,batchNumber='WMS-OLD-A'}={})=>{
  const {parsed:raw,source}=unified.parseUnifiedMarketplace(table(records));require('../services/marketplacePreparation').deliveryForOrders(source,raw);
  const prepared=unified.prepareUnifiedMarketplace(raw,{...settings,batchNumber});
  const evidenceRaw=unified.parseUnifiedMarketplace(table(evidenceRecords)).parsed;
  const orders=evidenceRaw.orders.map(order=>{const items=evidenceRaw.items.filter(item=>item.sourceOrderNumber===order.sourceOrderNumber),quantity=items.reduce((sum,item)=>sum+item.quantity,0),financial=order.financial;return {number:order.sourceOrderNumber,id:evidenceRecords.find(record=>record.Name===order.sourceOrderNumber).Id,cancelled:false,cancelledAt:null,currency:'TWD',fulfillmentStatus:'unfulfilled',paymentStatus:'paid',currentQuantity:quantity,remainingQuantity:quantity,subtotalMinor:financial.subtotalMinor,shippingMinor:financial.shippingMinor,discountMinor:financial.discountMinor,productDiscountMinor:financial.discountMinor,shippingGrossMinor:financial.shippingMinor,shippingDiscountMinor:0,shippingCancellationMinor:0,shippingLines:[],removedLineIds:[],totalMinor:financial.totalMinor,receivedMinor:financial.totalMinor,outstandingMinor:0,items:items.map(item=>({id:item.sourceLineId,sku:item.sku,barcode:sku,variantId:'gid://shopify/ProductVariant/1',quantity:item.quantity,unfulfilledQuantity:item.quantity,netMinor:item.lineSubtotalMinor})),...h.live[order.sourceOrderNumber]};});
  const verification={mode:'api',platform:'Shopify',shop:'synthetic.myshopify.com',version:'shopify-current-v2',orders,checkedAt:new Date().toISOString()};
  return {source:{platform:'Shopify',rows:sourceRows},raw,...prepared,settings:prepared.effectiveSettings,verification,sourceEvidence:{rows:sourceRows,verification},barcodeReviews:[],profileId:'1'};
 };
 h.prepare=jest.fn(async(body,options={})=>{
  h.prepareCount++;const uploaded=objects(body.rows);for(const record of uploaded)if(!h.api.has(record.Name))h.api.set(record.Name,record);
  const liveRecords=uploaded.map(record=>h.api.get(record.Name)),live=await h.convert(liveRecords,{sourceRows:body.rows});
  if(!options.overwriteOrderNumbers)return live;
  const projected=require('../services/marketplaceDraftSource').projectDraftSource(body.rows,table(liveRecords),live.verification,options.overwriteOrderNumbers);
  const result=await h.convert(objects(projected.rows),{sourceRows:body.rows,evidenceRecords:liveRecords});result.sourceEvidence.draftSourceReview=projected.review;return result;
 });
 h.service=createMarketplaceDraftOverwriteService({pool:h.pool,prepareMarketplace:h.prepare,enabled:()=>true,mixedEnabled:()=>h.enabled,validateSnapshot:async snapshot=>(await import('../services/marketplaceIntake.mjs')).prepareEcountFinancials(snapshot)});
 h.addBatch=async(records,batchNumber='WMS-OLD-A')=>{
  for(const record of records)h.api.set(record.Name,record);
  const conversion=await h.convert(records,{batchNumber}),snapshot={platform:'Shopify',handler:{userId:2,name:'Original author'},settings:conversion.settings,sourceEvidence:conversion.sourceEvidence,barcodeReviews:[],summary:conversion.output.summary,headers:conversion.output.headers,rows:conversion.output.rows,reportHeaders:conversion.output.reportHeaders,reportRows:conversion.output.reportRows,orders:conversion.parsed.orders.map(order=>({...order,sourceFinancial:conversion.raw.orders.find(raw=>raw.sourceOrderNumber===order.sourceOrderNumber).financial})),items:conversion.parsed.items,prepick:conversion.prepick,...(conversion.output.salesLayout?{salesLayout:conversion.output.salesLayout}:{}),...(conversion.output.rounding?{rounding:conversion.output.rounding}:{})};
  const batch=(await db.query('INSERT INTO marketplace_intakes(batch_number,source_platform,source_store,fingerprint,created_by,snapshot) VALUES($1,$2,$3,$4,2,$5) RETURNING *',[batchNumber,'Shopify',settings.store,batchNumber,snapshot])).rows[0];
  for(const order of snapshot.orders)await db.query('INSERT INTO marketplace_intake_orders(intake_id,source_platform,source_store,source_order_number,expected_items,financial,work_barcode) VALUES($1,$2,$3,$4,$5,$6,$7)',[batch.id,'Shopify',settings.store,order.sourceOrderNumber,snapshot.items.filter(item=>item.sourceOrderNumber===order.sourceOrderNumber).map(item=>({sourceLineId:item.sourceLineId,sourceSku:item.sku,productCode:sku,productName:item.productName,quantity:item.quantity,barcode:sku})),{source:order.sourceFinancial,ecount:order.financial},'WT-'+order.sourceOrderNumber.slice(1)]);
  await db.query('INSERT INTO marketplace_warehouse_flows(intake_id,enabled_by) VALUES($1,2)',[batch.id]);return batch;
 };
 h.batch=await h.addBatch([row('#A'),row('#B')]);
 h.body=async(records=[changed('#A'),row('#C')])=>{const body={scopeMode:'uploaded-file-v2',rows:table(records),settings,profileId:'1'},preview=await h.service.preview(body,user);return {...body,commandId:randomUUID(),previewFingerprint:preview.previewFingerprint,confirmed:true,notImportedConfirmed:true};};
 h.state=async()=>{const state={};for(const name of ['marketplace_intakes','marketplace_intake_orders','marketplace_warehouse_flows','marketplace_intake_scope_orders','marketplace_draft_revisions','marketplace_draft_commands','orders','marketplace_warehouse_events'])state[name]=(await db.query('SELECT * FROM '+name+' ORDER BY 1')).rows;return state;};
 return h;
}
describe('one reviewed mixed upload using real PGlite SQL, advisory locks stubbed (no native concurrency claim)',()=>{
 let h;beforeEach(async()=>{h=await setup();});afterEach(async()=>{await h?.db.close();});
 test('preview classifies the full file and retains omitted originals without decisions or writes',async()=>{
  const before=await h.state(),preview=await h.service.preview({scopeMode:'uploaded-file-v2',rows:table([changed('#A'),row('#C')]),settings,profileId:'1'},user);
  expect(preview).toMatchObject({canConfirm:true,summary:{totalOrderCount:2,newOrderCount:1,changedOrderCount:1,unchangedOrderCount:0,quantity:3,totalMinor:30000},newOrders:[{orderNumber:'#C',after:{quantity:2}}],affectedBatches:[{retainedOrderCount:1,uploadedOrders:[{orderNumber:'#A',changed:true}],omittedOrders:[{orderNumber:'#B',preserved:true}]}]});expect(await h.state()).toEqual(before);
 });
 test('one confirm creates a complete new scope, preserves owners/work barcodes, and leaves the omitted source byte-for-byte unchanged',async()=>{
  const before=await h.state(),response=await h.service.apply(await h.body(),user),after=await h.state(),batch=after.marketplace_intakes.find(batch=>batch.id===response.exportBatch.id);
  expect(response).toMatchObject({applied:true,newOrderCount:1,updatedOrderCount:1,exportBatch:{activeOrderCount:2,quantity:3,totalMinor:30000}});expect(response.batches).toEqual([response.exportBatch]);
  expect(batch.snapshot.orders.map(order=>order.sourceOrderNumber).sort()).toEqual(['#A','#C']);expect(batch.snapshot.items.reduce((sum,item)=>sum+item.quantity,0)).toBe(3);
  expect(after.marketplace_intake_orders.find(source=>source.source_order_number==='#B')).toEqual(before.marketplace_intake_orders.find(source=>source.source_order_number==='#B'));
  const original=after.marketplace_intake_orders.find(source=>source.source_order_number==='#A');expect(original).toMatchObject({id:1,intake_id:h.batch.id,work_barcode:'WT-A',draft_version:1,draft_active:true});
  expect(batch.snapshot.uploadScope.sourceManifest).toEqual([{id:1,ownerId:h.batch.id,version:1,orderNumber:'#A'},{id:3,ownerId:batch.id,version:0,orderNumber:'#C'}]);
  expect((await assertUploadScope(h.pool,batch)).map(source=>source.source_order_number)).toEqual(['#A','#C']);
  const {buildEcountUploadTable}=await import('../services/marketplaceIntake.mjs'),output=buildEcountUploadTable(batch.snapshot);expect(output.rows.reduce((sum,row)=>sum+row[output.headers.indexOf('數量')],0)).toBe(3);expect(new Set(output.rows.map(row=>row[10]))).toEqual(new Set([batch.batch_number]));
  expect(after.orders).toEqual([]);expect(after.marketplace_warehouse_events).toEqual([]);expect(after.marketplace_draft_revisions).toHaveLength(1);expect(after.marketplace_warehouse_flows).toHaveLength(2);
 });
 test('same old lines remain in the full output and all-new reviewed uploads also work',async()=>{
  const preview=await h.service.preview({scopeMode:'uploaded-file-v2',rows:table([row('#A'),row('#C')]),settings,profileId:'1'},user);expect(preview.summary).toMatchObject({newOrderCount:1,unchangedOrderCount:1,changedOrderCount:0});
  const response=await h.service.apply(await h.body([row('#C'),row('#D')]),user);expect(response).toMatchObject({newOrderCount:2,updatedOrderCount:0,exportBatch:{activeOrderCount:2}});
 });
 test('a pending non-COD line cannot silently disappear from an otherwise valid full upload',async()=>{
  h.api.set('#C',row('#C',{'Financial Status':'pending','Payment Method':'credit_card'}));h.live['#C']={paymentStatus:'pending'};
  const body=await h.body(),before=await h.state(),preview=await h.service.preview(body,user);expect(preview.canConfirm).toBe(false);
  await expect(h.service.apply(body,user)).rejects.toMatchObject({code:'MARKETPLACE_DRAFT_SOURCE_INVALID'});expect(await h.state()).toEqual(before);
 });
 test('verified pending COD remains eligible with its unpaid live balance preserved',async()=>{
  h.api.set('#C',row('#C',{'Financial Status':'pending','Payment Method':'custom','Outstanding Balance':'200'}));h.live['#C']={paymentStatus:'pending',receivedMinor:0,outstandingMinor:20000};
  const response=await h.service.apply(await h.body(),user),snapshot=(await h.db.query('SELECT snapshot FROM marketplace_intakes WHERE id=$1',[response.exportBatch.id])).rows[0].snapshot;
  expect(response.exportBatch.activeOrderCount).toBe(2);expect(snapshot.orders.find(order=>order.sourceOrderNumber==='#C')).toMatchObject({paymentStatus:'pending',sourceFinancial:{outstandingMinor:20000}});expect(snapshot.sourceEvidence.verification.orders.find(order=>order.number==='#C')).toMatchObject({receivedMinor:0,outstandingMinor:20000});
 });
 test('a mismatched CSV amount cannot be acknowledged away and never saves the valid new subset',async()=>{
  const records=[row('#A',{'Lineitem quantity':'1'}),row('#C')],body=await h.body(records),before=await h.state();
  const preview=await h.service.preview(body,user);expect(preview.canConfirm).toBe(false);await expect(h.service.apply(body,user)).rejects.toMatchObject({code:'MARKETPLACE_DRAFT_NOT_READY'});expect(await h.state()).toEqual(before);
 });
 test('the full export recalculates whole-dollar tax and weighted product segments capped at 200',async()=>{
  h.api.set('#A',row('#A',{'Lineitem quantity':'201',Subtotal:'20100',Total:'20100'}));
  const response=await h.service.apply(await h.body([row('#A',{'Lineitem quantity':'201',Subtotal:'20100',Total:'20100'}),row('#C')]),user),snapshot=(await h.db.query('SELECT snapshot FROM marketplace_intakes WHERE id=$1',[response.exportBatch.id])).rows[0].snapshot;
  const view=(await import('../services/marketplaceIntake.mjs')).prepareEcountFinancials(snapshot);expect(view.rows.map(row=>row[19])).toEqual([200,3]);expect(view.rows.every(row=>Number.isInteger(row[23])&&Number.isInteger(row[24]))).toBe(true);expect(view.financials.grossMinor).toBe(2030000);expect(view.salesLayout.lines.flatMap(line=>line.allocations).reduce((sum,allocation)=>sum+allocation.quantity,0)).toBe(203);
 });
 test('source cents and live receipts stay separate from the ERP whole-dollar output',async()=>{
  const records=[row('#A',{'Lineitem quantity':'1','Lineitem price':'99.90',Subtotal:'99.90',Total:'99.90'}),row('#C')],response=await h.service.apply(await h.body(records),user),snapshot=(await h.db.query('SELECT snapshot FROM marketplace_intakes WHERE id=$1',[response.exportBatch.id])).rows[0].snapshot;
  expect(snapshot.orders.find(order=>order.sourceOrderNumber==='#A').sourceFinancial.totalMinor).toBe(9990);expect(snapshot.sourceEvidence.verification.orders.find(order=>order.number==='#A').receivedMinor).toBe(20000);expect(snapshot.summary.ecountTotalMinor).toBe(30000);
  expect(snapshot.rows.every(row=>Number.isInteger(row[23])&&Number.isInteger(row[24]))).toBe(true);
 });
 test('multi-owner partial upload retains every unrelated original and creates one full output',async()=>{
  const second=await h.addBatch([row('#D'),row('#E')],'WMS-OLD-D'),before=(await h.db.query('SELECT * FROM marketplace_intake_orders ORDER BY id')).rows;
  const response=await h.service.apply(await h.body([changed('#A'),changed('#D'),row('#C')]),user);
  expect(response.exportBatch).toMatchObject({activeOrderCount:3,quantity:4,totalMinor:40000});
  const after=(await h.db.query('SELECT * FROM marketplace_intake_orders ORDER BY id')).rows;for(const number of ['#B','#E'])expect(after.find(source=>source.source_order_number===number)).toEqual(before.find(source=>source.source_order_number===number));
  expect((await h.db.query('SELECT intake_id FROM marketplace_draft_revisions ORDER BY intake_id')).rows).toEqual([{intake_id:h.batch.id},{intake_id:second.id}]);
 });
 test('a later upload patches a mixed run owner without deleting borrowed snapshot orders; old scope becomes stale',async()=>{
  const first=await h.service.apply(await h.body(),user),old=(await h.db.query('SELECT * FROM marketplace_intakes WHERE id=$1',[first.exportBatch.id])).rows[0];
  const second=await h.service.apply(await h.body([changed('#C'),row('#D')]),user),updated=(await h.db.query('SELECT * FROM marketplace_intakes WHERE id=$1',[old.id])).rows[0];
  expect(updated.snapshot.orders.map(order=>order.sourceOrderNumber).sort()).toEqual(['#A','#C']);expect(updated.snapshot.uploadScope).toEqual(old.snapshot.uploadScope);
  await expect(assertUploadScope(h.pool,updated)).rejects.toMatchObject({code:'MARKETPLACE_UPLOAD_SCOPE_STALE'});expect(second.exportBatch.activeOrderCount).toBe(2);
 });
 test('disabled confirmation does not call API or acquire a transaction; identical committed retry remains readable',async()=>{
  const body=await h.body();h.enabled=false;const count=h.prepareCount,calls=h.calls.length;
  await expect(h.service.apply({...body,enabled:true},user)).rejects.toMatchObject({code:'MARKETPLACE_MIXED_REEXPORT_DISABLED',status:423});expect(h.prepareCount).toBe(count);expect(h.calls.slice(calls).every(([sql])=>sql.startsWith('SELECT request_hash,response'))).toBe(true);
  h.enabled=true;const first=await h.service.apply(body,user);h.enabled=false;expect(await h.service.apply(body,user)).toEqual({...first,replayed:true});
 });
 test('same operation is exactly once, changed payload cannot reuse it, and lost commit acknowledgment reads back',async()=>{
  const body=await h.body();h.commitAckLost=true;await expect(h.service.apply(body,user)).rejects.toMatchObject({code:'MARKETPLACE_DRAFT_RESULT_UNKNOWN'});
  const count=h.prepareCount,replay=await h.service.apply(body,user);expect(replay.replayed).toBe(true);expect(h.prepareCount).toBe(count);
  await expect(h.service.apply({...body,reason:'different'},user)).rejects.toMatchObject({code:'MARKETPLACE_DRAFT_COMMAND_CHANGED'});expect((await h.db.query('SELECT * FROM marketplace_draft_commands')).rows).toHaveLength(1);
 });
 test.each(['UPDATE marketplace_intake_orders','INSERT INTO marketplace_intake_scope_orders','INSERT INTO marketplace_draft_commands'])('failure at %s rolls back new batch, old snapshots/versions, membership and audit together',async(prefix)=>{
  const body=await h.body(),before=await h.state();h.failSql=sql=>sql.startsWith(prefix);await expect(h.service.apply(body,user)).rejects.toThrow('synthetic SQL failure');expect(await h.state()).toEqual(before);
 });
 test('the second owner audit failure also rolls back the first owner',async()=>{
  const second=await h.addBatch([row('#D')],'WMS-OLD-D'),body=await h.body([changed('#A'),changed('#D'),row('#C')]),before=await h.state();
  h.failSql=(sql,args)=>sql.startsWith('INSERT INTO marketplace_draft_revisions')&&args[0]===second.id;await expect(h.service.apply(body,user)).rejects.toThrow('synthetic SQL failure');expect(await h.state()).toEqual(before);
 });
 test('a source claimed between preview and locking rejects the full file without an extra export',async()=>{
  const body=await h.body();h.beforeConnect=()=>h.addBatch([row('#C')],'WMS-RACE-C');await expect(h.service.apply(body,user)).rejects.toMatchObject({code:'MARKETPLACE_DRAFT_CHANGED'});
  expect((await h.db.query('SELECT * FROM marketplace_draft_revisions')).rows).toHaveLength(0);expect((await h.db.query('SELECT snapshot FROM marketplace_intakes WHERE id=$1',[h.batch.id])).rows[0].snapshot).toEqual(h.batch.snapshot);
 });
 test('profile and warehouse changes before locks invalidate the preview',async()=>{
  const body=await h.body();h.beforeConnect=()=>h.db.query('UPDATE marketplace_store_profiles SET updated_at=NOW() WHERE id=1');await expect(h.service.apply(body,user)).rejects.toMatchObject({code:'MARKETPLACE_DRAFT_CHANGED'});
  const fresh=await h.body();h.beforeConnect=()=>h.db.query('UPDATE marketplace_warehouse_flows SET printed_at=NOW() WHERE intake_id=$1',[h.batch.id]);await expect(h.service.apply(fresh,user)).rejects.toMatchObject({code:'MARKETPLACE_DRAFT_CHANGED'});
 });
 test('an already-started borrowing scope blocks a source even when its canonical owner never started',async()=>{
  const first=await h.service.apply(await h.body(),user);await h.db.query('UPDATE marketplace_warehouse_flows SET printed_at=NOW() WHERE intake_id=$1',[first.exportBatch.id]);
  const preview=await h.service.preview({scopeMode:'uploaded-file-v2',rows:table([changed('#A'),row('#D')]),settings,profileId:'1'},user);expect(preview.canConfirm).toBe(false);expect(preview.blockedReasons.join('')).toMatch(/列印|作業/);
  await expect(h.service.apply(await h.body([changed('#A'),row('#D')]),user)).rejects.toMatchObject({code:'MARKETPLACE_DRAFT_ALREADY_STARTED'});
 });
 test.each([['fulfilled',{fulfillmentStatus:'fulfilled',remainingQuantity:0}],['cancelled',{cancelled:true,cancelledAt:'2026-10-29T00:00:00Z'}],['partial',{remainingQuantity:1}]])('%s uploaded orders are visible as blocked and cannot revive the original',async(label,live)=>{
  h.live['#A']=live;const before=await h.state(),preview=await h.service.preview({scopeMode:'uploaded-file-v2',rows:table([changed('#A'),row('#C')]),settings,profileId:'1'},user);expect(preview.canConfirm).toBe(false);
  await expect(h.service.apply(await h.body(),user)).rejects.toMatchObject({code:'MARKETPLACE_DRAFT_SOURCE_INVALID'});expect(await h.state()).toEqual(before);
 });
 test('unrelated omitted live orders are neither re-read nor silently excluded',async()=>{
  h.live['#B']={fulfillmentStatus:'fulfilled',remainingQuantity:0};const before=(await h.db.query("SELECT * FROM marketplace_intake_orders WHERE source_order_number='#B'")).rows[0];await h.service.apply(await h.body(),user);
  expect(h.prepare.mock.calls.every(([body])=>!objects(body.rows).some(row=>row.Name==='#B'))).toBe(true);expect((await h.db.query("SELECT * FROM marketplace_intake_orders WHERE source_order_number='#B'")).rows[0]).toEqual(before);
 });
 test('v1 cannot overwrite an existing v2 member and the source lock set includes new and omitted owner identities',async()=>{
  await h.service.apply(await h.body(),user);const before=await h.state();await expect(h.service.preview({rows:table([changed('#A')]),settings,profileId:'1'},user)).rejects.toMatchObject({code:'MARKETPLACE_DRAFT_USE_UPLOAD_SCOPE'});expect(await h.state()).toEqual(before);
  const locks=h.calls.filter(([sql])=>sql.includes('wms-marketplace-source')).map(([,args])=>JSON.parse(args[0])[2]);expect(locks).toEqual(['#A','#B','#C']);
 });
});
