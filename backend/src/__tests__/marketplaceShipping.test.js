const {randomUUID}=require('node:crypto');
const express=require('express'),request=require('supertest');
const {createMarketplaceShippingService,sourceRows}=require('../services/marketplaceShipping');
const {createMarketplaceRouter}=require('../routes/marketplaceRoutes');
const actor={id:7,role:'dispatcher',name:'Dispatcher'};
const number='#154319',shop='www-omfuture.myshopify.com',store='墨子科技 官網';
const table=records=>{const headers=[...new Set(records.flatMap(Object.keys))];return [headers,...records.map(record=>headers.map(key=>record[key]??''))];};
const record=(extra={})=>({Name:number,Id:'7624215101596','Financial Status':'paid','Fulfillment Status':'unfulfilled',Currency:'TWD',Subtotal:'943',Shipping:'0',Taxes:'0',Total:'943','Discount Amount':'0','Refunded Amount':'0','Outstanding Balance':'0','Payment Method':'card',
 'Lineitem quantity':'1','Lineitem name':'來源商品','Lineitem price':'943','Lineitem sku':'4711299274237','Lineitem discount':'0','Lineitem id':'gid://shopify/LineItem/100',
 'Shipping Name':'收件人','Shipping Phone':'0900000000','Shipping Address1':'配送地址','Shipping City':'台北市','Shipping Province':'TPE','Shipping Country':'TW','Shipping Zip':'100','Shipping Method':'宅配',...extra});
function evidence(){return {number,id:'7624215101596',updatedAt:'2026-10-05T08:00:00Z',fingerprint:'api-before',currency:'TWD',cancelled:false,cancelledAt:null,paymentStatus:'paid',fulfillmentStatus:'unfulfilled',currentQuantity:1,remainingQuantity:1,
 subtotalMinor:94300,shippingMinor:0,discountMinor:0,productDiscountMinor:0,shippingGrossMinor:0,shippingDiscountMinor:0,shippingCancellationMinor:0,totalMinor:94300,outstandingMinor:0,receivedMinor:94300,
 items:[{id:'gid://shopify/LineItem/100',sku:'4711299274237',quantity:1,unfulfilledQuantity:1,netMinor:94300,variantId:'gid://shopify/ProductVariant/123',barcode:'4711299274237'}],removedLineIds:[],
 shippingLines:[{id:'gid://shopify/ShippingLine/1',removed:false,originalMinor:0,currentMinor:0,title:'宅配'}],shippingSource:'shopify-current'};}
async function harness(){
 const {parseUnifiedMarketplace,prepareUnifiedMarketplace}=await import('../services/unifiedMarketplace.mjs');
 const settings={store,shopifyShop:shop,customerCode:'00063',customerName:store,warehouseCode:'003',date:'2026-10-05',batchSequence:'1',batchNumber:'WMS-20261005-C1C3',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,discountAllocationConfirmed:true,
  skuMappings:{'4711299274237':{erpSku:'4711299274237',erpName:'ERP商品',barcode:'4711299274237',barcodeConfirmed:true,confirmed:true}},shippingSku:{erpSku:'00001',name:'運費',nonStock:true,confirmed:true}};
 const prepared=prepareUnifiedMarketplace(parseUnifiedMarketplace(table([record()])).parsed,settings);
 const savedOrder={...prepared.parsed.orders[0],shipping:{recipient:'收件人',phone:'0900000000',address:'配送地址 台北市 TPE TW',postalCode:'100',method:'宅配'},sourceFinancial:structuredClone(prepared.parsed.orders[0].financial)};
 const snapshot={settings,summary:prepared.output.summary,headers:prepared.output.headers,rows:prepared.output.rows,reportRows:prepared.output.reportRows,
  salesLayout:{version:'unchanged-layout'},orders:[savedOrder,{sourceOrderNumber:'#OTHER',sourcePlatform:'Shopify',shipping:{phone:'OTHER'},financial:{totalMinor:100}}],items:prepared.parsed.items,
  sourceEvidence:{rows:table([record(),record({Name:'#OTHER',Id:'7624215101597','Lineitem id':'gid://shopify/LineItem/101'})]),verification:{shop,platform:'Shopify',orders:[evidence()]}},barcodeReviews:[],prepick:{headers:prepared.prepick.headers,rows:prepared.prepick.rows}};
 const state={batch:{id:19,batch_number:settings.batchNumber,source_platform:'Shopify',source_store:store,fingerprint:'original-batch-fingerprint',snapshot,archived_at:null},
  source:{id:101,intake_id:19,source_platform:'Shopify',source_store:store,source_order_number:number,expected_items:[{sourceLineId:'gid://shopify/LineItem/100',sourceSku:'4711299274237',productCode:'4711299274237',quantity:1,barcode:'4711299274237'}],financial:{source:{totalMinor:94300},ecount:{totalMinor:94300}}},
  profile:{id:2,platform:'Shopify',store,settings:structuredClone(settings)},flow:{intake_id:19,enabled_at:'2026-10-05',erp_confirmed_at:null,import_batch_id:null,printed_at:null,prepick_completed_at:null,prepick_owner_id:null,prepick_counts:{}},
  link:null,tasks:[],activity:{progress:false,history:false,labels:false,changes:false},commands:[],events:[],pending:[],lockedHook:null,commitError:false,auditError:false,
  current:{rows:table([record({'Shipping Phone':'0901111111'})]),verification:{shop,orders:[{...evidence(),updatedAt:'2026-10-05T09:00:00Z',fingerprint:'api-after'}]}}};
 async function query(sql,params=[]){
  if(sql==='BEGIN'){state.pending=[];return {rows:[]};}
  if(sql==='ROLLBACK'){state.pending=[];return {rows:[]};}
  if(sql==='COMMIT'){
   if(state.commitError)throw Error('uncertain commit');
   for(const operation of state.pending){if(operation.type==='shipping')state.batch.snapshot.orders[Number(operation.path[1])].shipping=operation.value;else state[operation.type].push(operation.value);}
   state.pending=[];return {rows:[]};
  }
  if(sql.startsWith('SET LOCAL')||sql.startsWith('SELECT pg_advisory_xact_lock'))return {rows:[]};
  if(sql.startsWith('SELECT * FROM marketplace_warehouse_commands'))return {rows:structuredClone(state.commands.filter(command=>command.actor_id===params[0]&&command.command_id===params[1]))};
  if(sql.startsWith('SELECT * FROM marketplace_intakes WHERE id=')){
   if(sql.endsWith('FOR UPDATE')&&state.lockedHook){const hook=state.lockedHook;state.lockedHook=null;hook(state);}
   return {rows:params[0]===19?[structuredClone(state.batch)]:[]};
  }
  if(sql.startsWith('SELECT * FROM marketplace_intake_orders'))return {rows:params[1]===number?[structuredClone(state.source)]:[]};
  if(sql.startsWith('SELECT id,platform,store,settings FROM marketplace_store_profiles'))return {rows:state.profile?[structuredClone(state.profile)]:[]};
  if(sql.startsWith('SELECT * FROM marketplace_warehouse_flows'))return {rows:state.flow?[structuredClone(state.flow)]:[]};
  if(sql.startsWith('SELECT * FROM marketplace_work_order_links'))return {rows:state.link?[structuredClone(state.link)]:[]};
  if(sql.startsWith('SELECT id,status,picker_id,packer_id,completed_at FROM orders'))return {rows:structuredClone(state.tasks)};
  if(sql.includes('AS progress'))return {rows:[structuredClone(state.activity)]};
  if(sql.startsWith('UPDATE marketplace_intakes SET snapshot=jsonb_set')){state.pending.push({type:'shipping',path:params[1],value:JSON.parse(params[2])});return {rows:[],rowCount:1};}
  if(sql.startsWith('INSERT INTO marketplace_warehouse_events')){if(state.auditError)throw Error('audit unavailable');state.pending.push({type:'events',value:{intake_id:params[0],actor_id:params[1],action:params[2],details:JSON.parse(params[3])}});return {rows:[]};}
  if(sql.startsWith('INSERT INTO marketplace_warehouse_commands')){state.pending.push({type:'commands',value:{actor_id:params[0],command_id:params[1],request_hash:params[2],response:JSON.parse(params[3])}});return {rows:[]};}
  throw Error('Unexpected SQL: '+sql);
 }
 const db={query:jest.fn(query),release:jest.fn()},pool={query:jest.fn(query),connect:jest.fn(async()=>db)},verify=jest.fn(async()=>structuredClone(state.current));
 const service=createMarketplaceShippingService({pool,verifyShopify:verify});
 const applyBody=preview=>({orderNumber:number,previewFingerprint:preview.previewFingerprint,commandId:randomUUID(),expectedActorId:actor.id});
 return {state,db,pool,verify,service,applyBody};
}
const beforeSale=state=>{const value=structuredClone(state.batch);delete value.snapshot.orders[0].shipping;return value;};
test('source filtering preserves blank continuation rows and never sends another saved order to Shopify',()=>{
 const source=[['Name','Id','Lineitem sku'],[number,'123','SKU1'],['','','SKU2'],['#OTHER','124','OTHER'],['','','OTHER2']];
 expect(sourceRows(source,number)).toEqual(source.slice(0,3));expect(source[1][0]).toBe(number);
});
test('shipping preview reads the current API contact with no writes, preserving every saved sales field',async()=>{
 const h=await harness(),before=structuredClone(h.state);
 const preview=await h.service.preview(19,{orderNumber:number},actor);
 expect(preview).toMatchObject({intakeId:19,orderNumber:number,changed:true,changedFields:['phone'],previousShipping:{phone:'0900000000'},currentShipping:{phone:'0901111111'}});
 expect(preview.previewFingerprint).toMatch(/^[a-f0-9]{64}$/);expect(preview.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
 expect(h.verify.mock.calls[0][0].slice(1).every(row=>row[0]===number)).toBe(true);expect(h.pool.connect).not.toHaveBeenCalled();expect(h.state).toEqual(before);
});
test('apply rechecks API and only changes the target shipping path, retaining stock, amount, source and fingerprint',async()=>{
 const h=await harness(),before=beforeSale(h.state),source=structuredClone(h.state.source);
 const preview=await h.service.preview(19,{orderNumber:number},actor),body=h.applyBody(preview);
 expect(await h.service.apply(19,body,actor)).toMatchObject({ok:true,updated:true,intakeId:19,orderNumber:number,changedFields:['phone']});
 expect(h.verify).toHaveBeenCalledTimes(2);expect(h.state.batch.snapshot.orders[0].shipping.phone).toBe('0901111111');expect(beforeSale(h.state)).toEqual(before);expect(h.state.source).toEqual(source);
 expect(h.state.events).toHaveLength(1);expect(h.state.events[0]).toMatchObject({actor_id:7,action:'shipping-update',details:{orderNumber:number,before:{phone:'0900000000'},after:{phone:'0901111111'}}});
 const statements=h.db.query.mock.calls.map(([sql])=>sql);
 expect(statements.filter(sql=>sql.startsWith('UPDATE'))).toEqual(['UPDATE marketplace_intakes SET snapshot=jsonb_set(snapshot,$2::text[],$3::jsonb,true) WHERE id=$1']);
 expect(statements.some(sql=>/^(?:INSERT INTO orders|UPDATE orders|INSERT INTO marketplace_intakes|DELETE)/.test(sql))).toBe(false);
 const sourceLock=statements.findIndex(sql=>sql.includes("'wms-marketplace-source'")),batchLock=statements.findIndex(sql=>sql.endsWith('FOR UPDATE')&&sql.includes('marketplace_intakes'));
 expect(sourceLock).toBeLessThan(batchLock);expect(h.state.commands).toHaveLength(1);
 const again=await h.service.apply(19,body,actor);expect(again.reused).toBe(true);expect(h.state.events).toHaveLength(1);expect(h.verify).toHaveBeenCalledTimes(2);
});
test.each([
 ['order identity',e=>{e.id='7624215101597';}],['SKU',e=>{e.items[0].sku='OTHER';}],['line identity',e=>{e.items[0].id='OTHER';}],
 ['quantity',e=>{e.items[0].quantity=2;}],['net amount',e=>{e.items[0].netMinor++;}],['barcode',e=>{e.items[0].barcode='NEW4711299274237';}],
 ['variant',e=>{e.items[0].variantId='gid://shopify/ProductVariant/124';}],['subtotal',e=>{e.subtotalMinor++;}],['total',e=>{e.totalMinor++;}],
 ['outstanding',e=>{e.outstandingMinor++;}],['received',e=>{e.receivedMinor++;}],['discount',e=>{e.discountMinor++;}],['currency',e=>{e.currency='USD';}],
 ['shipping charge',e=>{e.shippingLines[0].currentMinor++;}],['cancelled',e=>{e.cancelled=true;}],['fulfilled',e=>{e.fulfillmentStatus='fulfilled';}],
 ['partial fulfillment',e=>{e.remainingQuantity=0;}],['payment status',e=>{e.paymentStatus='refunded';}],
])('a changed %s blocks a shipping-only correction without sales or warehouse writes',async(_label,change)=>{
 const h=await harness(),before=structuredClone(h.state.batch);change(h.state.current.verification.orders[0]);
 await expect(h.service.preview(19,{orderNumber:number},actor)).rejects.toMatchObject({code:'MARKETPLACE_SHIPPING_BUSINESS_CHANGED',status:409});
 expect(h.state.batch).toEqual(before);expect(h.pool.connect).not.toHaveBeenCalled();
});
test.each(['recipient','phone','address'])('missing API %s cannot borrow the saved CSV value',async(field)=>{
 const h=await harness(),headers=h.state.current.rows[0];
 const names=field==='recipient'?['Shipping Name']:field==='phone'?['Shipping Phone']:['Shipping Address1','Shipping City','Shipping Province','Shipping Country'];
 for(const name of names)h.state.current.rows[1][headers.indexOf(name)]='';
 await expect(h.service.preview(19,{orderNumber:number},actor)).rejects.toMatchObject({code:'MARKETPLACE_SHIPPING_NOT_AVAILABLE'});expect(h.pool.connect).not.toHaveBeenCalled();
});
test('missing current shippingAddress fails closed without using source CSV',async()=>{
 const h=await harness();h.state.current.verification.orders[0].shippingSource='source-csv';
 await expect(h.service.preview(19,{orderNumber:number},actor)).rejects.toMatchObject({code:'MARKETPLACE_SHIPPING_NOT_AVAILABLE'});expect(h.pool.connect).not.toHaveBeenCalled();
});
test.each(['picking','picked','packing','completed','voided'])('existing %s work is never silently reactivated',async(status)=>{
 const h=await harness();h.state.link={intake_order_id:101,order_id:41};h.state.tasks=[{id:41,status,picker_id:null,packer_id:null,completed_at:null}];
 await expect(h.service.preview(19,{orderNumber:number},actor)).rejects.toMatchObject({code:'MARKETPLACE_SHIPPING_BUSY'});expect(h.verify).not.toHaveBeenCalled();
});
test.each(['progress','history','labels','changes'])('existing %s evidence blocks even a pending unclaimed order',async(field)=>{
 const h=await harness();h.state.link={intake_order_id:101,order_id:41};h.state.tasks=[{id:41,status:'pending',picker_id:null,packer_id:null,completed_at:null}];h.state.activity[field]=true;
 await expect(h.service.preview(19,{orderNumber:number},actor)).rejects.toMatchObject({code:'MARKETPLACE_SHIPPING_BUSY'});expect(h.verify).not.toHaveBeenCalled();
});
test.each(['printed_at','prepick_completed_at','prepick_owner_id'])('batch %s blocks replacing already-issued shipping papers',async(field)=>{
 const h=await harness();h.state.flow[field]=1;
 await expect(h.service.preview(19,{orderNumber:number},actor)).rejects.toMatchObject({code:'MARKETPLACE_SHIPPING_BUSY'});
});
test('a deleted linked task and a claimed pending task both fail closed',async()=>{
 const deleted=await harness();deleted.state.link={intake_order_id:101,order_id:null};await expect(deleted.service.preview(19,{orderNumber:number},actor)).rejects.toMatchObject({code:'MARKETPLACE_SHIPPING_BUSY'});
 const claimed=await harness();claimed.state.link={intake_order_id:101,order_id:41};claimed.state.tasks=[{id:41,status:'pending',picker_id:7}];await expect(claimed.service.preview(19,{orderNumber:number},actor)).rejects.toMatchObject({code:'MARKETPLACE_SHIPPING_BUSY'});
});
test.each(['shop','profile','source','snapshotTotal','expectedQuantity'])('wrong saved %s cannot be used to authorize current shipping',async(field)=>{
 const h=await harness();
 if(field==='shop')h.state.batch.snapshot.settings.shopifyShop='different.myshopify.com';
 if(field==='profile')h.state.profile.settings.shopifyShop='different.myshopify.com';
 if(field==='source')h.state.batch.snapshot.sourceEvidence.verification.orders=[];
 if(field==='snapshotTotal')h.state.batch.snapshot.orders[0].financial.totalMinor++;
 if(field==='expectedQuantity')h.state.source.expected_items[0].quantity++;
 await expect(h.service.preview(19,{orderNumber:number},actor)).rejects.toMatchObject({status:409});expect(h.verify).not.toHaveBeenCalled();
});
test('changed API contact after preview requires another preview and leaves all saved data untouched',async()=>{
 const h=await harness(),preview=await h.service.preview(19,{orderNumber:number},actor),before=structuredClone(h.state.batch);
 h.state.current.rows[1][h.state.current.rows[0].indexOf('Shipping Phone')]='0902222222';
 await expect(h.service.apply(19,h.applyBody(preview),actor)).rejects.toMatchObject({code:'MARKETPLACE_SHIPPING_CHANGED'});
 expect(h.state.batch).toEqual(before);expect(h.state.events).toEqual([]);expect(h.state.commands).toEqual([]);
});
test.each(['phone','work','profile'])('a concurrent saved %s change is checked again under source and batch locks',async(field)=>{
 const h=await harness(),preview=await h.service.preview(19,{orderNumber:number},actor);
 h.state.lockedHook=state=>{
  if(field==='phone')state.batch.snapshot.orders[0].shipping.phone='0903333333';
  if(field==='work')state.flow.printed_at='now';
  if(field==='profile')state.profile.settings.shopifyShop='different.myshopify.com';
 };
 await expect(h.service.apply(19,h.applyBody(preview),actor)).rejects.toMatchObject({status:409});
 expect(h.state.events).toEqual([]);expect(h.state.commands).toEqual([]);expect(h.db.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);
});
test('unchanged contact creates an idempotent receipt without changing the batch or adding a correction event',async()=>{
 const h=await harness();h.state.current.rows=table([record()]);const before=structuredClone(h.state.batch);
 const preview=await h.service.preview(19,{orderNumber:number},actor);expect(preview.changed).toBe(false);
 const response=await h.service.apply(19,h.applyBody(preview),actor);expect(response.updated).toBe(false);expect(h.state.batch).toEqual(before);expect(h.state.events).toEqual([]);
});
test('audit failure rolls back the shipping update, and uncertain commit reports an unknown result',async()=>{
 const h=await harness(),preview=await h.service.preview(19,{orderNumber:number},actor),before=structuredClone(h.state.batch);h.state.auditError=true;
 await expect(h.service.apply(19,h.applyBody(preview),actor)).rejects.toThrow('audit unavailable');expect(h.state.batch).toEqual(before);expect(h.state.commands).toEqual([]);
 h.state.auditError=false;h.state.commitError=true;
 await expect(h.service.apply(19,h.applyBody(preview),actor)).rejects.toMatchObject({code:'MARKETPLACE_SHIPPING_RESULT_UNKNOWN',status:503});expect(h.state.batch).toEqual(before);
});
test('clients cannot submit contact values, impersonate an actor, or reuse an operation for a different request',async()=>{
 const h=await harness();await expect(h.service.preview(19,{orderNumber:number,currentShipping:{phone:'FORGED'}},actor)).rejects.toMatchObject({status:400});expect(h.verify).not.toHaveBeenCalled();
 const preview=await h.service.preview(19,{orderNumber:number},actor),body=h.applyBody(preview);
 await expect(h.service.apply(19,{...body,expectedActorId:8},actor)).rejects.toMatchObject({status:400});
 await h.service.apply(19,body,actor);await expect(h.service.apply(19,{...body,previewFingerprint:'f'.repeat(64)},actor)).rejects.toMatchObject({code:'MARKETPLACE_SHIPPING_CHANGED'});expect(h.state.events).toHaveLength(1);
});
test('a committed command retry returns its receipt under the command lock despite later work and an API outage',async()=>{
 const h=await harness(),preview=await h.service.preview(19,{orderNumber:number},actor),body=h.applyBody(preview);
 const committed=await h.service.apply(19,body,actor);h.state.batch.archived_at='later';h.state.flow.printed_at='later';
 h.state.link={intake_order_id:101,order_id:41};h.state.tasks=[{id:41,status:'completed',picker_id:7,packer_id:8}];
 h.verify.mockRejectedValue(new Error('API unavailable'));
 const calls=h.verify.mock.calls.length,queries=h.db.query.mock.calls.length;
 expect(await h.service.apply(19,body,actor)).toEqual({...committed,reused:true});expect(h.verify).toHaveBeenCalledTimes(calls);expect(h.state.events).toHaveLength(1);
 const retryQueries=h.db.query.mock.calls.slice(queries).map(([sql])=>sql);
 expect(retryQueries).toContain('BEGIN');expect(retryQueries).toContain('ROLLBACK');expect(retryQueries.some(sql=>sql.includes("'wms-warehouse-command'"))).toBe(true);
 expect(retryQueries.some(sql=>sql.startsWith('UPDATE')||sql.includes('marketplace_intakes'))).toBe(false);
});
test('HTTP preview/update are dispatcher-only, return private no-store data, and preserve structured errors',async()=>{
 const h=await harness();let user={...actor};const app=express();app.use(express.json());app.use((req,res,next)=>{req.user=user;next();});
 app.use('/api/marketplace-intakes',createMarketplaceRouter({pool:h.pool,prepareMarketplace:jest.fn(),shippingService:h.service}));
 const path='/api/marketplace-intakes/19/orders/';
 user={...actor,role:'picker'};expect((await request(app).post(path+'shipping-preview').send({orderNumber:number})).status).toBe(403);expect(h.verify).not.toHaveBeenCalled();
 user={...actor};const preview=await request(app).post(path+'shipping-preview').send({orderNumber:number});expect(preview.status).toBe(200);expect(preview.headers['cache-control']).toBe('private, no-store');
 const applied=await request(app).post(path+'shipping-update').send(h.applyBody(preview.body));expect(applied.status).toBe(200);expect(applied.body.updated).toBe(true);
 h.state.flow.printed_at='now';const busy=await request(app).post(path+'shipping-preview').send({orderNumber:number});expect(busy.status).toBe(409);expect(busy.body.code).toBe('MARKETPLACE_SHIPPING_BUSY');expect(busy.headers['cache-control']).toBe('private, no-store');
});
