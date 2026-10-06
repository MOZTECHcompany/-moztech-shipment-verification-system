const express=require('express'),request=require('supertest');
jest.mock('../services/marketplaceBarcodeReviews',()=>({readBarcodeReviews:jest.fn(async()=>[]),verifySavedBarcodeReviews:jest.fn(async()=>({}))}));
jest.mock('../services/warehouseRelease',()=>({enableFlow:jest.fn(async()=>{})}));
jest.mock('../services/marketplaceBatchNotifications',()=>({notifyMarketplaceBatch:jest.fn(async()=>{})}));
jest.mock('../services/marketplaceProductCatalog',()=>({verifyCatalogMappings:jest.fn(async()=>{})}));
const {createMarketplacePreparation}=require('../services/marketplacePreparation');
const {createMarketplaceRouter}=require('../routes/marketplaceRoutes');
const {classifyMarketplaceReimports}=require('../services/marketplaceReimports');
const shop='moztech.myshopify.com',store='墨子科技 官網',sku='4711299274237';
const table=records=>{const headers=[...new Set(records.flatMap(Object.keys))];return [headers,...records.map(record=>headers.map(key=>record[key]??''))];};
const record=(number='#OLD',extra={})=>({Name:number,Id:number==='#OLD'?'111':'222','Financial Status':'paid','Fulfillment Status':'unfulfilled',Currency:'TWD',Subtotal:'943',Shipping:'0',Taxes:'0',Total:'943','Discount Amount':'47','Refunded Amount':'0','Outstanding Balance':'0','Payment Method':'card',
 'Lineitem quantity':'1','Lineitem name':'來源商品','Lineitem price':'990','Lineitem sku':sku,'Lineitem discount':'47','Lineitem id':`gid://shopify/LineItem/${number==='#OLD'?'11':'22'}`,
 'Shipping Name':'收件人','Shipping Phone':'0901111111','Shipping Address1':'配送地址','Shipping City':'台北市','Shipping Country':'TW','Shipping Method':'宅配',...extra});
const evidence=(number='#OLD')=>({number,id:number==='#OLD'?'111':'222',currency:'TWD',cancelled:false,cancelledAt:null,paymentStatus:'paid',fulfillmentStatus:'unfulfilled',currentQuantity:1,remainingQuantity:1,
 subtotalMinor:94300,shippingMinor:0,discountMinor:4700,productDiscountMinor:4700,shippingGrossMinor:0,shippingDiscountMinor:0,shippingCancellationMinor:0,totalMinor:94300,outstandingMinor:0,receivedMinor:94300,
 items:[{id:`gid://shopify/LineItem/${number==='#OLD'?'11':'22'}`,sku,quantity:1,unfulfilledQuantity:1,netMinor:94300,variantId:'gid://shopify/ProductVariant/100',barcode:sku}],removedLineIds:[],shippingLines:[],shippingSource:'shopify-current'});
const settings={store,shopifyShop:shop,customerCode:'00063',customerName:store,warehouseCode:'003',date:'2026-10-06',batchSequence:'1',batchNumber:'TEST-REIMPORT',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,salesExportMode:'product-200-v1',
 skuMappings:{[sku]:{erpSku:sku,erpName:'ERP 商品',barcode:sku,confirmed:true,barcodeConfirmed:true}},shippingSku:{erpSku:'00001',name:'運費',nonStock:true,confirmed:true}};
async function owner(number='#OLD'){
 const {parseUnifiedMarketplace,prepareUnifiedMarketplace}=await import('../services/unifiedMarketplace.mjs');
 const raw=parseUnifiedMarketplace(table([record(number)])).parsed,prepared=prepareUnifiedMarketplace(raw,settings);
 const order={...prepared.parsed.orders[0],sourceFinancial:raw.orders[0].financial,shipping:{recipient:'收件人',phone:'0900000000',address:'配送地址 台北市 TW',method:'宅配'}};
 const snapshot={settings,orders:[order],items:prepared.parsed.items,sourceEvidence:{rows:table([record(number)]),verification:{version:'shopify-current-v2',platform:'Shopify',shop,orders:[evidence(number)]}}};
 return {id:number==='#OLD'?101:102,intake_id:number==='#OLD'?19:20,source_platform:'Shopify',source_store:store,source_order_number:number,
  expected_items:[{sourceLineId:evidence(number).items[0].id,sourceSku:sku,productCode:sku,quantity:1,barcode:sku}],financial:{source:raw.orders[0].financial,ecount:prepared.parsed.orders[0].financial},
  batch:{id:number==='#OLD'?19:20,source_platform:'Shopify',source_store:store,fingerprint:'old-fingerprint',archived_at:null,snapshot},flow:{intake_id:19,erp_confirmed_at:null,import_batch_id:null},link:null};
}
async function harness(){
 const profile={id:2,platform:'Shopify',store,settings},state={sources:[await owner()],tasks:[],pending:[],saved:[],lockHook:null,fingerprintRecord:null};
 async function query(sql,params=[]){
  if(sql==='BEGIN'){state.pending=[];return {rows:[]};}
  if(sql==='ROLLBACK'){state.pending=[];return {rows:[]};}
  if(sql==='COMMIT'){for(const action of state.pending)action();state.pending=[];return {rows:[]};}
  if(sql.startsWith('SET LOCAL'))return {rows:[]};
  if(sql.startsWith('SELECT pg_advisory_xact_lock')){if(state.lockHook){const hook=state.lockHook;state.lockHook=null;hook();}return {rows:[]};}
  if(sql.includes('marketplace_store_profiles'))return {rows:[structuredClone(profile)]};
  if(sql.includes('row_to_json(b) AS batch'))return {rows:structuredClone(state.sources.filter(source=>source.source_platform===params[0]&&source.source_store===params[1]&&params[2].includes(source.source_order_number)))};
  if(sql.includes('FROM orders o WHERE'))return {rows:structuredClone(state.tasks.filter(task=>params[2].includes(task.source_order_number)))};
  if(sql.startsWith('SELECT * FROM marketplace_intakes WHERE fingerprint='))return {rows:state.fingerprintRecord?[state.fingerprintRecord]:[]};
  if(sql.startsWith('SELECT intake_id FROM marketplace_intake_orders'))return {rows:state.sources.filter(source=>source.source_order_number===params[2]).map(source=>({intake_id:source.intake_id}))};
  if(sql.startsWith('SELECT id FROM orders WHERE source_platform='))return {rows:state.tasks.filter(task=>task.source_order_number===params[2])};
  if(sql.startsWith('INSERT INTO marketplace_intakes')){
   const saved={id:30,batch_number:params[0],source_platform:params[1],source_store:params[2],fingerprint:params[3],snapshot:JSON.parse(params[5])};
   state.pending.push(()=>state.saved.push(saved));return {rows:[saved]};
  }
  if(sql.startsWith('INSERT INTO marketplace_intake_orders')){state.pending.push(()=>state.sources.push({id:200,intake_id:params[0],source_platform:params[1],source_store:params[2],source_order_number:params[3]}));return {rows:[]};}
  throw Error('Unexpected SQL: '+sql);
 }
 const pool={query:jest.fn(query),connect:jest.fn(async()=>db)},db={query:jest.fn(query),release:jest.fn()};
 const verify=jest.fn(async rows=>({rows,verification:{version:'shopify-current-v2',platform:'Shopify',shop,orders:[...new Set(rows.slice(1).map(row=>row[rows[0].indexOf('Name')]))].map(evidence)}}));
 const resolve=jest.fn(async keys=>({products:Object.fromEntries(keys.map(key=>[key,{status:'matched',matches:[{erp_sku:key,product_name:'ERP 商品',barcode:key,active:true}]}]))}));
 const prepare=createMarketplacePreparation({pool,verifyShopify:verify,resolveProducts:resolve});
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:7,role:'dispatcher'};next();});app.use('/api/marketplace-intakes',createMarketplaceRouter({pool,prepareMarketplace:prepare}));
 return {state,pool,db,verify,resolve,prepare,app,profile};
}
const noWrites=db=>expect(db.query.mock.calls.some(([sql])=>/^(INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(false);
const task=(status='pending')=>({id:41,source_platform:'Shopify',source_store:store,source_order_number:'#OLD',status,picker_id:null,packer_id:null,completed_at:null,progress:false,history:false,labels:false,changes:false});

test('all saved unshipped orders return their original owner without resolving products or offering a new sales file',async()=>{
 const h=await harness(),body={rows:table([record()])},before=structuredClone(h.state.sources),preview=await h.prepare(body);
 expect(preview.reimports).toEqual([{orderNumber:'#OLD',intakeId:19,workOrderId:null,state:'pending',message:'可更新原訂單收件資料',canUpdateShipping:true}]);
 expect(preview.parsed.orders).toEqual([]);expect(preview.parsed.items).toEqual([]);expect(preview.output.ok).toBe(false);expect(preview.output.rows).toEqual([]);expect(preview.prepick.rows).toEqual([]);
 expect(preview.raw.orders).toHaveLength(1);expect(preview.sourceEvidence.rows).toEqual(body.rows);expect(preview.audit.rows).toHaveLength(1);expect(preview.choices).toEqual([expect.objectContaining({number:'#OLD',eligible:false,existing:true})]);
 expect(h.resolve).not.toHaveBeenCalled();
 const response=await request(h.app).post('/api/marketplace-intakes').send({...body,previewFingerprint:preview.verification.currentFingerprint,intakeId:999,reimports:[]});
 expect(response.status).toBe(200);expect(response.body).toMatchObject({newOrderCount:0,salesDownloadAllowed:false,reimports:preview.reimports});expect(response.body.id).toBeUndefined();
 expect(h.state.sources).toEqual(before);expect(h.state.saved).toEqual([]);noWrites(h.db);expect(h.db.query.mock.calls.map(([sql])=>sql)).toContain('ROLLBACK');
 const view=await request(h.app).post('/api/marketplace-intakes/preview').send(body);expect(view.body.sourceEvidence).toBeUndefined();expect(view.body.sourceClassification).toBeUndefined();
});

test('mixed uploads export and save only new orders while preserving the complete upload audit',async()=>{
 const mixed=await harness(),fresh=await harness(),rows=table([record(),record('#NEW')]);
 const preview=await mixed.prepare({rows}),newOnly=await fresh.prepare({rows:table([record('#NEW')])});
 expect(preview.parsed.orders.map(order=>order.sourceOrderNumber)).toEqual(['#NEW']);
 const businessItems=items=>items.map(({sourceRow,...item})=>item);expect(businessItems(preview.parsed.items)).toEqual(businessItems(newOnly.parsed.items));
 expect(preview.output.summary).toEqual(newOnly.output.summary);expect(preview.output.salesLayout.lines).toEqual(newOnly.output.salesLayout.lines);
 expect(preview.output.rows.map(row=>[row[11],row[19],row[23],row[24]])).toEqual(newOnly.output.rows.map(row=>[row[11],row[19],row[23],row[24]]));
 expect(preview.audit.rows).toHaveLength(2);expect(preview.raw.orders).toHaveLength(2);expect(preview.reimports).toHaveLength(1);
 const original=structuredClone(mixed.state.sources[0]);
 const response=await request(mixed.app).post('/api/marketplace-intakes').send({rows,previewFingerprint:preview.verification.currentFingerprint});
 expect(response.status).toBe(201);expect(response.body).toMatchObject({id:30,newOrderCount:1,salesDownloadAllowed:true,reimports:preview.reimports});
 expect(mixed.state.sources[0]).toEqual(original);expect(mixed.state.saved[0].snapshot.orders.map(order=>order.sourceOrderNumber)).toEqual(['#NEW']);
 expect(mixed.state.saved[0].snapshot.sourceEvidence.rows).toEqual(rows);expect(mixed.state.saved[0].snapshot.sourceEvidence.verification.orders).toHaveLength(2);
 expect(mixed.db.query.mock.calls.filter(([sql])=>sql.startsWith('INSERT INTO marketplace_intake_orders')).map(([,params])=>params[3])).toEqual(['#NEW']);
});

test('a saved order with conflicting current barcode cannot create a catalog conflict for a genuinely new order',async()=>{
 const h=await harness();h.verify.mockImplementation(async rows=>({rows,verification:{version:'shopify-current-v2',platform:'Shopify',shop,orders:[{...evidence(),items:[{...evidence().items[0],barcode:'NEW'+sku}]},evidence('#NEW')]}}));
 const result=await h.prepare({rows:table([record(),record('#NEW')])});
 expect(result.output.ok).toBe(true);expect(result.barcodeConflicts).toEqual([]);expect(result.reimports[0].canUpdateShipping).toBe(false);
 expect(result.settings.skuMappings[sku].barcode).toBe(sku);expect(result.output.summary.physicalQuantity).toBe(1);
});

test.each(['quantity','amount','SKU','variant','payment'])('changed saved %s remains an original-order review even when no ERP return exists',async(change)=>{
 const h=await harness();h.verify.mockImplementation(async rows=>{const current=evidence();
  if(change==='quantity')current.items[0].quantity++;
  if(change==='amount')current.totalMinor++;
  if(change==='SKU')current.items[0].sku='OTHER';
  if(change==='variant')current.items[0].variantId='gid://shopify/ProductVariant/200';
  if(change==='payment')current.paymentStatus='pending';
  return {rows,verification:{version:'shopify-current-v2',platform:'Shopify',shop,orders:[current]}};
 });
 const result=await h.prepare({rows:table([record()])});expect(result.reimports[0]).toMatchObject({intakeId:19,state:'pending',canUpdateShipping:false,message:'商品或金額已變更，請核對原銷貨單'});
 expect(result.parsed.orders).toEqual([]);expect(result.output.rows).toEqual([]);expect(h.pool.connect).not.toHaveBeenCalled();
});

test.each([['completed','warehouse_completed'],['voided','voided'],['picking','in_progress'],['packing','in_progress']])('existing %s work is routed to the original order and never re-created',async(status,state)=>{
 const h=await harness();h.state.sources[0].link={intake_order_id:101,order_id:41};h.state.tasks=[task(status)];
 const result=await h.prepare({rows:table([record()])});expect(result.reimports[0]).toMatchObject({intakeId:19,workOrderId:41,state,canUpdateShipping:false});expect(result.output.rows).toEqual([]);
});
test('packing completion and Shopify fulfillment remain separate facts on re-upload',async()=>{
 const h=await harness();h.state.sources[0].link={intake_order_id:101,order_id:41};h.state.tasks=[task('completed')];
 const packed=await h.prepare({rows:table([record()])});expect(packed.reimports[0]).toMatchObject({state:'warehouse_completed',message:'裝箱已完成，請處理原訂單',canUpdateShipping:false});
 h.verify.mockImplementation(async rows=>({rows,verification:{version:'shopify-current-v2',platform:'Shopify',shop,orders:[{...evidence(),fulfillmentStatus:'fulfilled',remainingQuantity:0}]}}));
 const shipped=await h.prepare({rows:table([record()])},{refresh:true});expect(shipped.reimports[0]).toMatchObject({state:'completed',message:'已出貨，請開啟原訂單',canUpdateShipping:false});
 expect(packed.output.rows).toEqual([]);expect(shipped.output.rows).toEqual([]);expect(h.state.tasks[0].status).toBe('completed');expect(h.pool.connect).not.toHaveBeenCalled();
});

test.each([['fulfilled','completed',false],['unfulfilled','cancelled',true],['partially_fulfilled','partial',false]])('current Shopify %s state (%s) is kept visible without another sale',async(fulfillmentStatus,state,cancelled)=>{
 const h=await harness();h.verify.mockImplementation(async rows=>({rows,verification:{version:'shopify-current-v2',platform:'Shopify',shop,orders:[{...evidence(),fulfillmentStatus,cancelled}]}}));
 const result=await h.prepare({rows:table([record()])});expect(result.reimports[0]).toMatchObject({state,canUpdateShipping:false});expect(result.output.rows).toEqual([]);
});

test.each(['picker_id','progress','history','labels','changes'])('pending target %s prevents the shipping update entry',async(field)=>{
 const h=await harness();h.state.sources[0].link={intake_order_id:101,order_id:41};h.state.tasks=[{...task(),[field]:field==='picker_id'?7:true}];
 const result=await h.prepare({rows:table([record()])});expect(result.reimports[0]).toMatchObject({state:'in_progress',canUpdateShipping:false});
});

test('linked pending target can update despite sibling batch print and prepick progress',async()=>{
 const h=await harness();h.state.sources[0].link={intake_order_id:101,order_id:41};h.state.tasks=[task()];
 h.state.sources[0].flow={...h.state.sources[0].flow,erp_confirmed_at:'now',import_batch_id:17,printed_at:'now',prepick_completed_at:'now',prepick_owner_id:8,prepick_counts:{OTHER:50}};
 const result=await h.prepare({rows:table([record()])});expect(result.reimports[0]).toMatchObject({state:'pending',canUpdateShipping:true});
});

test('legacy work owns the source permanently, and missing or foreign source references fail closed',async()=>{
 const h=await harness();h.state.sources=[];h.state.tasks=[task()];
 const result=await h.prepare({rows:table([record()])});expect(result.reimports[0]).toMatchObject({intakeId:null,workOrderId:41,canUpdateShipping:false});expect(result.parsed.orders).toEqual([]);
 h.state.tasks=[];h.state.sources=[await owner()];h.state.sources[0].batch.source_store='FOREIGN';
 await expect(h.prepare({rows:table([record()])},{refresh:true})).rejects.toMatchObject({code:'MARKETPLACE_REIMPORT_UNAVAILABLE'});
});

test('a missing API Address1 cannot advertise a shipping update even when city and country are present',async()=>{
 const h=await harness(),result=await h.prepare({rows:table([record('#OLD',{'Shipping Address1':''})])});
 expect(result.raw.orders[0].shipping.address).toBe('台北市 TW');expect(result.reimports[0].canUpdateShipping).toBe(false);
});

test('DB ownership is re-read despite the short API preview cache and invalidates the displayed new sales scope',async()=>{
 const h=await harness(),body={rows:table([record('#NEW')])},first=await h.prepare(body);expect(first.parsed.orders).toHaveLength(1);
 h.state.sources.push(await owner('#NEW'));const second=await h.prepare(body);
 expect(h.verify).toHaveBeenCalledTimes(1);expect(second.parsed.orders).toHaveLength(0);expect(second.reimports).toHaveLength(1);expect(second.verification.currentFingerprint).not.toBe(first.verification.currentFingerprint);
 const response=await request(h.app).post('/api/marketplace-intakes').send({...body,previewFingerprint:first.verification.currentFingerprint});expect(response.status).toBe(409);expect(response.body.code).toBe('SHOPIFY_PREVIEW_CHANGED');expect(h.pool.connect).not.toHaveBeenCalled();
});

test('new-to-existing ownership race is checked under source locks before exact-fingerprint reuse or writes',async()=>{
 const h=await harness(),body={rows:table([record(),record('#NEW')])},preview=await h.prepare(body),newOwner=await owner('#NEW');
 h.state.lockHook=()=>h.state.sources.push(newOwner);h.state.fingerprintRecord={id:999,snapshot:{orders:[{sourceOrderNumber:'#OLD'},{sourceOrderNumber:'#NEW'}]}};
 const response=await request(h.app).post('/api/marketplace-intakes').send({...body,previewFingerprint:preview.verification.currentFingerprint});
 expect(response.status).toBe(409);expect(response.body.code).toBe('SHOPIFY_PREVIEW_CHANGED');noWrites(h.db);expect(h.state.saved).toEqual([]);
 const statements=h.db.query.mock.calls.map(([sql])=>sql);expect(statements.filter(sql=>sql.includes('pg_advisory_xact_lock'))).toHaveLength(2);
 expect(statements.some(sql=>sql.startsWith('SELECT * FROM marketplace_intakes WHERE fingerprint='))).toBe(false);expect(statements).toContain('ROLLBACK');
});

test('source lookup errors never fall back to exporting the uploaded order',async()=>{
 const db={query:jest.fn(async()=>{throw Error('DB unavailable');})};
 await expect(classifyMarketplaceReimports({db,platform:'Shopify',store,raw:{orders:[{sourceOrderNumber:'#OLD'}]},verification:{orders:[evidence()]}})).rejects.toThrow('DB unavailable');
});
