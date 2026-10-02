const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes,randomUUID}=require('node:crypto');
const {Client}=require('pg');
const jwt=require('jsonwebtoken');
test('sales receipt to prepick to independent pick and pack', {skip:process.env.WMS_MARKETPLACE_PG_TEST!=='1',timeout:120000},async t=>{
 const database='wms_release_'+randomBytes(6).toString('hex');
 const cfg={host:'127.0.0.1',port:55441,user:'wms_replay',password:'wms_replay_local_only',database:'postgres'};
 const control=new Client(cfg);await control.connect();await control.query('CREATE DATABASE "'+database+'"');
 Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:'',PGHOST:cfg.host,PGPORT:String(cfg.port),PGUSER:cfg.user,PGPASSWORD:cfg.password,PGDATABASE:database,PGOPTIONS:'',JWT_SECRET:'local-release-only',DB_POOL_MAX:'5',DB_SSL_MODE:'disable',STORAGE_BACKEND:'local',CORS_ORIGINS:'http://127.0.0.1',WMS_ECPAY_ACCOUNTS_JSON:'[]',WMS_ECPAY_CALLBACKS_ENABLED:'false',ECOUNT_REFERENCE_OBJECT:''});
 const {pool}=require('../src/config/database');let io;
 t.after(async()=>{if(io)await new Promise(resolve=>io.close(resolve));await pool.end();await control.query('DROP DATABASE "'+database+'"');await control.end();});
 await require('../src/maintenance/migrationRunner').runMigrations({pool,targetDatabase:database});
 // Fixture API evidence only: this disposable workflow never contacts Shopify.
 const preparation=require('../src/services/marketplacePreparation'),createPreparation=preparation.createMarketplacePreparation;
 preparation.createMarketplacePreparation=options=>createPreparation({...options,verifyShopify:async rows=>({rows,verification:{shop:'fixture-workflow.myshopify.com',orders:[]}})});
 const {server,io:socket}=require('../src/app');io=socket;await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const socketEvents=[],emit=io.emit.bind(io);io.emit=(name,payload)=>{socketEvents.push({name,payload});return emit(name,payload);};
 const users={},tokens={};for(const role of ['admin','ordersAdmin','dispatcher','picker','packer']){users[role]=(await pool.query('INSERT INTO users(username,password,name,role,management_scope) VALUES($1,$2,$1,$3,$4) RETURNING id',[role,'unused',role==='ordersAdmin'?'admin':role,role==='ordersAdmin'?'orders':'all'])).rows[0].id;tokens[role]=jwt.sign({id:users[role]},process.env.JWT_SECRET,{expiresIn:600});}
 async function api(role,method,path,body){
  if(method==='POST'&&path==='/api/marketplace-intakes'&&!body?.previewFingerprint){const preview=await api(role,'POST',path+'/preview',body);if(preview.status!==200)return preview;body={...body,previewFingerprint:preview.data.verification?.currentFingerprint};}
  const r=await fetch(`http://127.0.0.1:${server.address().port}`+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens[role]},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};
 }
 const ok=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
 const headers=['Name','Financial Status','Fulfillment Status','Currency','Subtotal','Shipping','Taxes','Total','Discount Amount','Refunded Amount','Lineitem quantity','Lineitem name','Lineitem price','Lineitem sku','Lineitem discount','Payment Method'];
 const rows=[headers,['TEST-A','paid','unfulfilled','TWD','105','0','0','105','0','0','1','商城品項 A（無貼膜神器）','105','0001','0','card'],['TEST-B','paid','unfulfilled','TWD','210','0','0','210','0','0','2','商城品項 A（無貼膜神器）','105','0001','0','card']];
 const settings={store:'本機隔離',customerCode:'CUST',customerName:'客戶',warehouseCode:'003',date:'2026-09-17',batchSequence:'1',batchNumber:'TEST-RELEASE-0917',salesExportMode:'order-lines-v1',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,discountAllocationConfirmed:true,skuMappings:{'0001':{erpSku:'ERP-0001',erpName:'品項 A',spec:'MODEL-PRO',barcode:'4711299273087',confirmed:true,barcodeConfirmed:true}},shippingSku:{}};
 const saved=ok(await api('dispatcher','POST','/api/marketplace-intakes',{rows,settings}),201);
 await t.test('save commits one private supervisor notice while staff and order-only admins cannot read it',async()=>{
  const inbox=ok(await api('admin','GET','/api/marketplace-batch-notices'));assert.equal(inbox.total,1);assert.equal(inbox.notices[0].stage,'prepared');assert.equal(inbox.notices[0].intakeId,saved.id);
  for(const role of ['picker','packer','dispatcher','ordersAdmin'])assert.equal((await api(role,'GET','/api/marketplace-batch-notices')).status,403);
  const duplicate=ok(await api('dispatcher','POST','/api/marketplace-intakes',{rows,settings}));assert.equal(duplicate.reused,true);
  assert.equal((await pool.query('SELECT COUNT(*)::int n FROM marketplace_batch_notices WHERE intake_id=$1',[saved.id])).rows[0].n,1);
  assert.equal((await pool.query('SELECT COUNT(*)::int n FROM orders')).rows[0].n,0);
  assert.ok(socketEvents.filter(e=>e.name==='marketplace_batch_notice').every(e=>Object.keys(e.payload).length===0));
 });
 await t.test('a notification persistence failure rolls back the whole saved batch and publishes no notice',async()=>{
  await pool.query("CREATE FUNCTION fail_batch_notice_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF (SELECT batch_number FROM marketplace_intakes WHERE id=NEW.intake_id)='TEST-NOTICE-FAIL' THEN RAISE EXCEPTION 'isolated notice persistence failure'; END IF; RETURN NEW; END $$");
  await pool.query('CREATE TRIGGER reject_batch_notice_test BEFORE INSERT ON marketplace_batch_notices FOR EACH ROW EXECUTE FUNCTION fail_batch_notice_test()');
  const count=(await pool.query('SELECT COUNT(*)::int n FROM marketplace_intakes')).rows[0].n,noticeEvents=socketEvents.filter(e=>e.name==='marketplace_batch_notice').length;
  try{
   const failureRows=[headers,...rows.slice(1).map((r,n)=>{const line=[...r];line[0]='FAIL-NOTICE-'+n;return line;})];
   assert.equal((await api('dispatcher','POST','/api/marketplace-intakes',{rows:failureRows,settings:{...settings,batchNumber:'TEST-NOTICE-FAIL'}})).status,500);
   assert.equal((await pool.query('SELECT COUNT(*)::int n FROM marketplace_intakes')).rows[0].n,count);
   assert.equal(socketEvents.filter(e=>e.name==='marketplace_batch_notice').length,noticeEvents);
  }finally{await pool.query('DROP TRIGGER reject_batch_notice_test ON marketplace_batch_notices');await pool.query('DROP FUNCTION fail_batch_notice_test()');}
 });
 await t.test('old batch grouped download uses real file endpoint, preserves source and accepts its grouped receipt',async()=>{
  const before=(await pool.query('SELECT snapshot FROM marketplace_intakes WHERE id=$1',[saved.id])).rows[0].snapshot;
  assert.equal((await api('picker','POST',`/api/marketplace-intakes/${saved.id}/download-link`,{kind:'ecount-grouped'})).status,403);
  const base=`http://127.0.0.1:${server.address().port}`;
  const dl=await fetch(`${base}/api/marketplace-intakes/${saved.id}/download-link`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens.dispatcher},body:JSON.stringify({kind:'ecount-grouped'})});
  assert.equal(dl.status,200);const link=await dl.json(),cookie=dl.headers.getSetCookie().map(c=>c.split(';')[0]).join(';');
  const file=await fetch(base+link.url,{headers:{Cookie:cookie}});assert.equal(file.status,200);
  const XLSX=require('xlsx'),book=XLSX.read(Buffer.from(await file.arrayBuffer())),table=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1});
  assert.equal(table.length,2);assert.equal(table[0].length,27);assert.equal(table[1][table[0].indexOf('數量')],3);
  const {groupedSalesRecord,prepareEcountFinancials}=await import('../src/services/marketplaceIntake.mjs');
  const {HEADERS,reconcileSales}=require('../src/services/erpSalesReceipt');
  const view=prepareEcountFinancials(groupedSalesRecord(before));
  const receipt=[HEADERS,...view.rows.map(r=>['20260917-199',saved.batchNumber,r[2],r[6],r[7],r[13],r[14],r[12],r[15],r[11],r[19],r[23],r[24],r[23]+r[24],'4711299273087','',''])];
  const orders=(await pool.query('SELECT * FROM marketplace_intake_orders WHERE intake_id=$1',[saved.id])).rows;
  assert.equal((await reconcileSales(receipt,{snapshot:before,batch_number:saved.batchNumber,orders})).parsed.workOrders.length,2);
  assert.deepEqual((await pool.query('SELECT snapshot FROM marketplace_intakes WHERE id=$1',[saved.id])).rows[0].snapshot,before);
 });
 const path='/api/warehouse-intakes/'+saved.id;
 assert.equal(ok(await api('picker','GET','/api/warehouse-intakes')).batches.length,0);
 assert.equal(ok(await api('admin','GET','/api/warehouse-intakes')).batches.length,1);
 const command=(role,extra={})=>({commandId:randomUUID(),expectedActorId:users[role],...extra});
 const action=(role,a,extra={})=>api(role,'POST',path+'/'+a,command(role,extra));
 assert.equal((await api('picker','GET',path)).status,403);
 let data=ok(await api('admin','GET',path));assert.equal(data.orders.length,2);assert.ok(data.orders.every(o=>/^WT[0-9A-F]{18}$/.test(o.work_barcode)));assert.equal(data.flow.erp_confirmed_at,null);assert.equal(data.batch.snapshot,undefined);
 assert.equal((await action('picker','print')).status,403);assert.equal((await action('admin','print')).status,409);
 const H=require('../src/services/erpSalesReceipt').HEADERS;
 const receipt=[H,...saved.rows.map(r=>['2026/09/17 - 100',saved.batchNumber,r[2],r[6],r[7],r[13],r[14],r[12],r[15],r[11],r[19],r[23],r[24],Number(r[23])+Number(r[24]),'4711299273087','',''])];
 // First order carries legacy summary SN; native column remains blank.
 receipt[1][16]='ABCD12345678';
 await t.test('identity, tax, completeness and role errors never create work',async()=>{
  const bad=structuredClone(receipt);bad[1][12]=0;assert.equal((await action('dispatcher','confirm-sales',{rows:bad,savedSalesConfirmed:true})).status,400);
  const duplicate=structuredClone(receipt);duplicate.push(receipt[1]);assert.equal((await action('dispatcher','confirm-sales',{rows:duplicate,savedSalesConfirmed:true})).status,400);
  const wrong=structuredClone(receipt);wrong[1][4]='00';assert.equal((await action('dispatcher','confirm-sales',{rows:wrong,savedSalesConfirmed:true})).status,400);
  assert.equal((await action('dispatcher','confirm-sales',{rows:receipt.slice(0,2),savedSalesConfirmed:true})).status,400);
  assert.equal((await action('picker','confirm-sales',{rows:receipt,savedSalesConfirmed:true})).status,403);
  assert.equal((await pool.query('SELECT COUNT(*)::int n FROM orders')).rows[0].n,0);
  assert.equal((await action('picker','confirm-barcode',{productCode:'ERP-0001',barcode:'4711299273087',confirmed:true})).status,403);
  assert.equal((await action('dispatcher','confirm-barcode',{productCode:'ERP-0001',barcode:'4711299273087',confirmed:false})).status,400);
  ok(await action('dispatcher','confirm-barcode',{productCode:'ERP-0001',barcode:'4711299273087',confirmed:true}));
  assert.equal((await pool.query("SELECT COUNT(*)::int n FROM marketplace_batch_notices WHERE intake_id=$1 AND stage='ready_for_print'",[saved.id])).rows[0].n,0);
 });
 if(process.env.WMS_RELEASE_BROWSER==='1')await t.test('browser upload, print ownership, complete barcode papers and mobile layout',async()=>{
  await require('./warehouse-release-browser.cjs')({base:'http://127.0.0.1:'+server.address().port,id:saved.id,user:{id:users.admin,username:'admin',name:'admin',role:'admin'},token:tokens.admin,picker:{user:{id:users.picker,username:'picker',name:'picker',role:'picker'},token:tokens.picker},receipt,output:require('node:path').resolve(__dirname,'../../../artifacts/warehouse-release-20260917')});
 });
 await t.test('concurrent receipt retry creates one batch and fixed child work codes',async()=>{
  const results=await Promise.all([action('dispatcher','confirm-sales',{rows:receipt,savedSalesConfirmed:true}),action('dispatcher','confirm-sales',{rows:receipt,savedSalesConfirmed:true})]);results.forEach(r=>ok(r));
  data=ok(await api('admin','GET',path));assert.equal(data.orders.length,2);assert.ok(data.orders.every(o=>o.order_id));assert.equal((await pool.query('SELECT COUNT(*)::int n FROM orders')).rows[0].n,2);
  assert.equal(data.orders[0].expected_items[0].snCount,1);
  assert.equal((await pool.query("SELECT COUNT(*)::int n FROM marketplace_batch_notices WHERE intake_id=$1 AND stage='ready_for_print'",[saved.id])).rows[0].n,1);
  const notice=ok(await api('admin','GET','/api/marketplace-batch-notices')).notices.find(n=>n.intakeId===saved.id);assert.equal(notice.stage,'ready_for_print');
  assert.equal((await api('ordersAdmin','POST',`/api/marketplace-batch-notices/${notice.noticeId}/seen`,{})).status,403);
  ok(await api('admin','POST',`/api/marketplace-batch-notices/${notice.noticeId}/seen`,{}));
  assert.equal((await pool.query('SELECT COUNT(*)::int n FROM orders WHERE warehouse_hold')).rows[0].n,2);
  assert.equal((await api('picker','POST','/api/orders/'+data.orders[0].order_id+'/claim')).status,409);
  const claim={commandId:randomUUID(),expectedActorId:users.picker,barcode:data.orders[0].work_barcode,stage:'pick'};assert.equal((await api('picker','POST','/api/orders/claim-by-barcode',claim)).status,409);
  const heldId=data.orders[0].order_id;
  await pool.query("UPDATE orders SET status='picking',picker_id=$2 WHERE id=$1",[heldId,users.picker]);
  const heldScan=await api('picker','POST','/api/orders/update_item',{orderId:heldId,scanValue:'ABCD12345678',type:'pick'});
  assert.equal(heldScan.status,409);assert.match(heldScan.data.message,/預揀/);
  await pool.query("UPDATE orders SET status='pending',picker_id=NULL WHERE id=$1",[heldId]);
 });
 await t.test('marketplace work items retain the complete source name and ERP specification while sales and receipts stay unchanged',async()=>{
  const items=(await pool.query('SELECT product_code,product_name,quantity,barcode FROM order_items WHERE order_id=ANY($1::int[]) ORDER BY order_id',[data.orders.map(o=>o.order_id)])).rows;
  assert.deepEqual(items.map(i=>i.product_name),Array(2).fill('商城品項 A（無貼膜神器） · MODEL-PRO'));
  assert.deepEqual(items.map(i=>i.quantity),[1,2]);
  assert.ok(items.every(i=>i.product_code==='ERP-0001'&&i.barcode==='4711299273087'));
  const snapshot=(await pool.query('SELECT snapshot FROM marketplace_intakes WHERE id=$1',[saved.id])).rows[0].snapshot;
  assert.ok(snapshot.rows.every(r=>r[16]==='品項 A'&&r[18]==='MODEL-PRO'));
  const trace=(await pool.query("SELECT details::jsonb AS details FROM operation_logs WHERE order_id=ANY($1::int[]) AND action_type='import' ORDER BY order_id",[data.orders.map(o=>o.order_id)])).rows;
  assert.ok(trace.every(r=>r.details.sourceDetails[0].erpProductName==='品項 A'&&r.details.sourceDetails[0].spec==='MODEL-PRO'));
  const savedReceipt=(await pool.query('SELECT erp_receipt FROM marketplace_warehouse_flows WHERE intake_id=$1',[saved.id])).rows[0].erp_receipt;
  assert.equal(savedReceipt.financials.grossMinor,31500);
  assert.deepEqual(savedReceipt.lines.map(l=>l.quantity),[1,2]);
 });
 await t.test('assigned warehouse admin loses prepick permission when scope changes to orders',async()=>{
  await pool.query("UPDATE users SET management_scope='warehouse' WHERE id=$1",[users.admin]);
  try{
   ok(await action('admin','print',{kind:'all'}));
   ok(await action('admin','assign',{assigneeId:users.admin}));
   const before=ok(await api('admin','GET',path)).flow;
   await pool.query("UPDATE users SET management_scope='orders' WHERE id=$1",[users.admin]);
   const p=data.products[0];
   assert.equal((await action('admin','scan',{productKey:p.key,barcode:p.barcode,quantity:1})).status,403);
   assert.equal((await action('admin','complete')).status,403);
   const after=ok(await api('admin','GET',path)).flow;
   assert.equal(after.prepick_owner_id,users.admin);
   assert.deepEqual(after.prepick_counts,before.prepick_counts);
   assert.equal(after.prepick_completed_at,null);
   assert.equal((await pool.query('SELECT COUNT(*)::int n FROM orders WHERE warehouse_hold')).rows[0].n,2);
  }finally{await pool.query("UPDATE users SET management_scope='all' WHERE id=$1",[users.admin]);}
 });
 await t.test('print ownership, assignment and scan receipt are persistent',async()=>{
  assert.equal((await action('dispatcher','print',{kind:'orders'})).status,403);assert.equal((await action('ordersAdmin','print',{kind:'all'})).status,403);
  await action('admin','print',{kind:'prepick'}).then(ok);await action('admin','print',{kind:'orders'}).then(ok);
  data=ok(await api('admin','GET',path));assert.equal(data.flow.print_owner_id,users.admin);
  await action('admin','assign',{assigneeId:users.picker}).then(ok);
  assert.equal(ok(await api('picker','GET','/api/warehouse-intakes')).batches.length,1);
  assert.equal(ok(await api('packer','GET','/api/warehouse-intakes')).batches.length,0);
  const p=data.products[0];assert.equal(p.quantity,3);
  assert.equal((await action('packer','scan',{productKey:p.key,barcode:p.barcode,quantity:3})).status,403);
  assert.equal((await action('picker','scan',{productKey:p.key,barcode:'WRONG',quantity:3})).status,400);
  assert.equal((await action('picker','complete')).status,409);
  const scan=command('picker',{productKey:p.key,barcode:p.barcode,quantity:3});
  const results=await Promise.all([api('picker','POST',path+'/scan',scan),api('picker','POST',path+'/scan',scan)]);results.forEach(r=>ok(r));
  data=ok(await api('picker','GET',path));assert.equal(data.flow.prepick_counts[p.key],3);
  assert.equal((await action('picker','scan',{productKey:p.key,barcode:p.barcode,quantity:1})).status,409);
  await action('admin','reset-product',{productKey:p.key,reason:'重新清點測試'}).then(ok);
  assert.equal((await action('picker','complete')).status,409);
  await action('picker','scan',{productKey:p.key,barcode:p.barcode,quantity:3}).then(ok);
  await action('picker','complete').then(ok);
  assert.equal(ok(await api('picker','GET','/api/warehouse-intakes')).batches.length,0);
  assert.equal((await pool.query('SELECT COUNT(*)::int n FROM orders WHERE warehouse_hold')).rows[0].n,0);
 });
 await t.test('picker and packer claim separately; SN and quantity checked twice',async()=>{
  data=ok(await api('picker','GET',path));
  for(const o of data.orders){
   const claim=(role,stage)=>api(role,'POST','/api/orders/claim-by-barcode',command(role,{barcode:o.work_barcode,stage}));
   await claim('picker','pick').then(ok);
   assert.equal((await claim('packer','pack')).status,409);
   const scanValue=o.source_order_number==='TEST-A'?'ABCD12345678':'4711299273087';
   const quantity=o.expected_items[0].quantity;
   for(let n=0;n<quantity;n++)ok(await api('picker','POST','/api/orders/update_item',{orderId:o.order_id,scanValue,type:'pick'}));
   assert.equal((await pool.query('SELECT status FROM orders WHERE id=$1',[o.order_id])).rows[0].status,'picked');
   const tasks=ok(await api('packer','GET','/api/tasks'));assert.ok(tasks.some(t=>t.id===o.order_id&&t.task_type==='pack'));
   await claim('packer','pack').then(ok);
   for(let n=0;n<quantity;n++)ok(await api('packer','POST','/api/orders/update_item',{orderId:o.order_id,scanValue,type:'pack'}));
   const end=(await pool.query('SELECT status,picker_id,packer_id FROM orders WHERE id=$1',[o.order_id])).rows[0];assert.deepEqual(end,{status:'completed',picker_id:users.picker,packer_id:users.packer});
  }
 });
 await t.test('grouped 450-unit sale persists source orders, downloads three segments, and restores SN work orders once',async()=>{
  const groupSettings={...settings,salesExportMode:'product-200-v1',batchNumber:'TEST-GROUP-0917'};
  const groupRows=[headers,...Array.from({length:10},(_,n)=>[`GROUP-${n}`,'paid','unfulfilled','TWD','4725','0','0','4725','0','0','45','品項 A','105','0001','0','card'])];
  const batch=ok(await api('dispatcher','POST','/api/marketplace-intakes',{rows:groupRows,settings:groupSettings}),201);
  assert.equal(batch.orders.length,10);assert.equal(batch.rows.length,10);assert.equal(batch.salesLayout.lines.length,3);
  assert.deepEqual(batch.salesLayout.lines.map(l=>l.quantity),[200,200,50]);
  if(process.env.WMS_RELEASE_BROWSER==='1')await require('./grouped-sales-browser.cjs')({base:'http://127.0.0.1:'+server.address().port,id:batch.id,user:{id:users.admin,username:'admin',name:'admin',role:'admin'},token:tokens.admin,output:require('node:path').resolve(__dirname,'../../../artifacts/warehouse-grouped-20260917')});
  const duplicate=ok(await api('dispatcher','POST','/api/marketplace-intakes',{rows:groupRows,settings:groupSettings}));assert.equal(duplicate.id,batch.id);assert.equal(duplicate.reused,true);
  const dl=await fetch(`http://127.0.0.1:${server.address().port}/api/marketplace-intakes/${batch.id}/download-link`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens.dispatcher},body:JSON.stringify({kind:'ecount'})});
  assert.equal(dl.status,200);const link=await dl.json();const cookie=dl.headers.getSetCookie().map(c=>c.split(';')[0]).join(';');
  const file=await fetch(`http://127.0.0.1:${server.address().port}`+link.url,{headers:{Cookie:cookie}});assert.equal(file.status,200);
  const XLSX=require('xlsx'),book=XLSX.read(Buffer.from(await file.arrayBuffer())),table=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1});
  assert.equal(book.SheetNames.length,1);assert.equal(table[0].length,27);assert.deepEqual(table.slice(1).map(r=>r[table[0].indexOf('數量')]),[200,200,50]);
  const {prepareEcountFinancials}=await import('../src/services/marketplaceIntake.mjs');let serial=0;
  const groupedReceipt=[H,...prepareEcountFinancials(batch).rows.map(r=>['20260917-101',batch.batchNumber,r[2],r[6],r[7],r[13],r[14],r[12],r[15],r[11],r[19],r[23],r[24],Math.round((r[23]+r[24])*100)/100,'4711299273087',Array.from({length:r[19]},()=>`GP${String(++serial).padStart(10,'0')}`).join(' '),''])];
  const groupPath='/api/warehouse-intakes/'+batch.id;
  const extra={rows:groupedReceipt,savedSalesConfirmed:true};
  const results=await Promise.all([api('dispatcher','POST',groupPath+'/confirm-sales',command('dispatcher',extra)),api('dispatcher','POST',groupPath+'/confirm-sales',command('dispatcher',extra))]);results.forEach(r=>ok(r));
  const flow=ok(await api('admin','GET',groupPath));assert.equal(flow.orders.length,10);assert.equal(flow.flow.erp_receipt.salesLayout.lines.length,3);
  for(const o of flow.orders){assert.ok(o.order_id);assert.equal(o.expected_items[0].quantity,45);assert.equal(o.expected_items[0].snCount,45);}
  assert.equal((await pool.query('SELECT COUNT(*)::int n FROM order_item_instances s JOIN order_items i ON i.id=s.order_item_id WHERE i.order_id=ANY($1::int[])',[flow.orders.map(o=>o.order_id)])).rows[0].n,450);
  ok(await api('admin','POST',groupPath+'/print',command('admin',{kind:'orders'})));
  const changed=structuredClone(groupedReceipt);changed[1][10]++;
  assert.equal((await api('admin','POST',groupPath+'/confirm-sales',command('admin',{rows:changed,savedSalesConfirmed:true}))).status,400);
 });
 await t.test('original import entrance reconciles grouped delivery file into one held batch, retries reuse and prints all',async()=>{
  const batch=ok(await api('dispatcher','POST','/api/marketplace-intakes',{rows:[headers,...rows.slice(1).map((r,n)=>{const x=[...r];x[0]='RETURN-'+n;return x;})],settings:{...settings,batchNumber:'TEST-RETURN-0923',salesExportMode:'product-200-v1'}}),201);
  const {prepareEcountFinancials,groupedSalesRecord}=await import('../src/services/marketplaceIntake.mjs');
  const lines=prepareEcountFinancials(groupedSalesRecord(batch)).rows;
  const returned=[['出貨單號','平台','店鋪','商城訂單編號','來源明細號','品項編碼','數量','國際條碼','序號/批號'],...lines.map(r=>['DELIVERY-0923',r[13],r[14],r[12],r[15],r[11],r[19],'4711299273087','SN0000000001 SN0000000002 SN0000000003'])];
  async function upload(table,role='dispatcher'){
   const XLSX=require('xlsx'),book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(table),'理貨單');
   const form=new FormData();form.append('orderFile',new Blob([XLSX.write(book,{type:'buffer',bookType:'xlsx'})]),'return.xlsx');
   const r=await fetch(`http://127.0.0.1:${server.address().port}/api/orders/import`,{method:'POST',headers:{Authorization:'Bearer '+tokens[role]},body:form});return {status:r.status,data:await r.json()};
  }
  const before=(await pool.query('SELECT COUNT(*)::int n FROM orders')).rows[0].n;
  assert.equal((await upload(returned,'picker')).status,403);
  const wrong=structuredClone(returned);wrong[1][6]=4;assert.equal((await upload(wrong)).status,400);
  const doubled=[...returned,returned[1]];assert.equal((await upload(doubled)).status,400);
  const wrongBarcode=structuredClone(returned);wrongBarcode[1][7]='WRONG';assert.equal((await upload(wrongBarcode)).status,400);
  assert.equal((await pool.query('SELECT COUNT(*)::int n FROM orders')).rows[0].n,before);
  const results=await Promise.all([upload(returned),upload(returned)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);
  for(const r of results){assert.equal(r.data.warehouseIntakeId,batch.id);assert.equal(r.data.workOrderCount,2);assert.equal(r.data.totalQuantity,3);assert.equal(r.data.serialCount,3);assert.equal(r.data.orders.length,2);}
  const flow=ok(await api('admin','GET','/api/warehouse-intakes/'+batch.id));
  const active=ok(await api('admin','GET','/api/tasks'));assert.ok(!active.some(t=>flow.orders.some(o=>o.order_id===t.id)));
  const paged=ok(await api('admin','GET','/api/tasks?pagination=cursor'));assert.ok(!paged.items.some(t=>flow.orders.some(o=>o.order_id===t.id)));
  assert.equal(flow.flow.erp_receipt.verificationKind,'warehouse-return');assert.equal(flow.flow.erp_receipt.financialVerified,false);assert.equal(flow.flow.erp_receipt.financials,null);
  assert.equal((await pool.query('SELECT COUNT(*)::int n FROM orders')).rows[0].n,before+2);
  assert.deepEqual(flow.orders.map(o=>o.expected_items[0].snCount),[1,2]);
  const pending=ok(await api('admin','GET','/api/warehouse-intakes?ready=1')).batches;const task=pending.find(b=>b.id===batch.id);assert.equal(task.order_count,2);assert.equal(task.total_quantity,3);
  assert.equal(ok(await api('picker','GET','/api/warehouse-intakes?ready=1')).batches.length,0);
  ok(await api('admin','POST',`/api/warehouse-intakes/${batch.id}/print`,command('admin',{kind:'all'})));
  const event=(await pool.query("SELECT details FROM marketplace_warehouse_events WHERE intake_id=$1 AND action='print' ORDER BY id DESC LIMIT 1",[batch.id])).rows[0];assert.equal(event.details.kind,'all');
  assert.equal((await api('picker','POST','/api/orders/'+flow.orders[0].order_id+'/claim')).status,409);
  ok(await api('admin','POST',`/api/warehouse-intakes/${batch.id}/assign`,command('admin',{assigneeId:users.picker})));
  assert.ok(ok(await api('picker','GET','/api/warehouse-intakes?ready=1')).batches.some(b=>b.id===batch.id));
 });

 // Real source files are never checked into Git. Customer/code/barcode mappings
 // and the ERP return below are isolated fixtures, not actual ERP acceptance.
 if(process.env.WMS_REAL_MARKETPLACE_FILES==='1')for(const fixture of [
  {platform:'SHOPLINE',file:process.env.WMS_REAL_SHOPLINE_FILE,orders:16,quantity:44,gross:30766},
  {platform:'1Shop',file:process.env.WMS_REAL_1SHOP_FILE,orders:2,quantity:4,gross:1427},
 ])await t.test(`${fixture.platform} real-file path preserves source, money and independent pick/pack through an isolated ERP-return fixture`,async()=>{
  assert.ok(fixture.file,`${fixture.platform} file path must be supplied explicitly`);
  const XLSX=require('xlsx'),book=XLSX.readFile(fixture.file,{raw:true});
  const {marketplaceOrderSheets,parseMarketplaceWorksheet}=await import('../../frontend/src/utils/marketplaceWorkbook.mjs');
  const sheets=marketplaceOrderSheets(XLSX,book);assert.equal(sheets.length,1);
  const parsed=parseMarketplaceWorksheet(XLSX,book,sheets[0]);assert.equal(parsed.source.platform,fixture.platform);
  const localSettings={...settings,store:'LOCAL-'+fixture.platform,customerCode:'LOCAL-CUSTOMER',customerName:'隔離檔案核對',batchNumber:'TEST-REAL-'+(fixture.platform==='SHOPLINE'?'SL':'ONE'),salesExportMode:'product-200-v1',includeTestOrders:true,
   shippingSku:{erpSku:'LOCAL-SHIPPING',name:'運費',confirmed:true,nonStock:true},skuMappings:Object.fromEntries(parsed.parsed.items.map(i=>[i.sku,{erpSku:i.sku,erpName:i.productName,barcode:'LOCAL-'+i.sku,confirmed:true,barcodeConfirmed:true}]))};
  if(fixture.platform==='1Shop'){
   const blocked=ok(await api('dispatcher','POST','/api/marketplace-intakes/preview',{rows:parsed.source.rows,settings:localSettings}));
   assert.ok(blocked.output.issues.some(i=>i.code==='BUNDLE_ALLOCATION_REQUIRED'));
   // Explicit fixture confirmation: the bundle anchor carries its price.
   localSettings.bundleZeroConfirmed=true;
  }
  const batch=ok(await api('dispatcher','POST','/api/marketplace-intakes',{rows:parsed.source.rows,settings:localSettings}),201);
  assert.equal(batch.orders.length,fixture.orders);assert.equal(batch.summary.totalQuantity,fixture.quantity);assert.equal(batch.summary.totalMinor,fixture.gross*100);
  const {prepareEcountFinancials}=await import('../src/services/marketplaceIntake.mjs');const exportView=prepareEcountFinancials(batch);
  assert.equal(exportView.financials.grossMinor,fixture.gross*100);
  for(const row of exportView.rows){assert.equal(typeof row[11],'string');assert.ok(Number.isInteger(row[23])&&Number.isInteger(row[24]));assert.ok(row[19]<=200);}
  const physical=new Map(batch.items.map(i=>[localSettings.skuMappings[i.sku].erpSku,localSettings.skuMappings[i.sku].barcode]));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const linkResponse=await fetch(`${origin}/api/marketplace-intakes/${batch.id}/download-link`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens.dispatcher},body:JSON.stringify({kind:'ecount'})});
  assert.equal(linkResponse.status,200);const link=await linkResponse.json(),cookie=linkResponse.headers.getSetCookie().map(c=>c.split(';')[0]).join(';');
  const downloaded=await fetch(origin+link.url,{headers:{Cookie:cookie}});assert.equal(downloaded.status,200);
  const resultBook=XLSX.read(Buffer.from(await downloaded.arrayBuffer())),sheet=resultBook.Sheets[resultBook.SheetNames[0]],downloadRows=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true});
  assert.equal(resultBook.SheetNames.length,1);assert.equal(downloadRows[0].length,27);
  const codeIndex=downloadRows[0].indexOf('品項編碼'),quantityIndex=downloadRows[0].indexOf('數量');assert.equal(codeIndex,11);
  assert.equal(downloadRows.slice(1).filter(r=>physical.has(r[codeIndex])).reduce((n,r)=>n+r[quantityIndex],0),fixture.quantity);
  for(let n=1;n<downloadRows.length;n++){const cell=sheet['L'+(n+1)];assert.equal(cell.t,'s');assert.equal(typeof cell.v,'string');assert.ok(!/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(cell.v));}
  const receipt=[H,...exportView.rows.filter(r=>physical.has(r[11])).map(r=>['LOCAL-ERP-'+fixture.platform,batch.batchNumber,r[2],r[6],r[7],r[13],r[14],r[12],r[15],r[11],r[19],r[23],r[24],r[23]+r[24],physical.get(r[11]),'',''])];
  const route='/api/warehouse-intakes/'+batch.id;
  const act=(role,a,extra={})=>api(role,'POST',route+'/'+a,command(role,extra));
  const bad=structuredClone(receipt);bad[1][10]++;assert.equal((await act('dispatcher','confirm-return',{rows:bad})).status,400);
  assert.equal((await pool.query("SELECT COUNT(*)::int n FROM marketplace_batch_notices WHERE intake_id=$1 AND stage='ready_for_print'",[batch.id])).rows[0].n,0);
  ok(await act('dispatcher','confirm-return',{rows:receipt}));ok(await act('dispatcher','confirm-return',{rows:receipt}));
  let warehouse=ok(await api('admin','GET',route));assert.equal(warehouse.orders.length,fixture.orders);assert.equal(warehouse.products.reduce((n,p)=>n+p.quantity,0),fixture.quantity);
  assert.equal((await pool.query('SELECT COUNT(*)::int n FROM orders WHERE id=ANY($1::int[]) AND warehouse_hold',[warehouse.orders.map(o=>o.order_id)])).rows[0].n,fixture.orders);
  assert.equal((await pool.query("SELECT COUNT(*)::int n FROM marketplace_batch_notices WHERE intake_id=$1 AND stage='ready_for_print'",[batch.id])).rows[0].n,1);
  ok(await act('admin','print',{kind:'all'}));ok(await act('admin','assign',{assigneeId:users.picker}));
  for(const p of warehouse.products)ok(await act('picker','scan',{productKey:p.key,barcode:p.barcode,quantity:p.quantity}));
  ok(await act('picker','complete'));
  warehouse=ok(await api('admin','GET',route));assert.equal(new Set(warehouse.orders.map(o=>o.work_barcode)).size,fixture.orders);
  for(const order of warehouse.orders){
   const claim=(role,stage)=>api(role,'POST','/api/orders/claim-by-barcode',command(role,{barcode:order.work_barcode,stage}));
   ok(await claim('picker','pick'));assert.equal((await claim('packer','pack')).status,409);
   const items=(await pool.query('SELECT id,barcode,quantity FROM order_items WHERE order_id=$1 ORDER BY id',[order.order_id])).rows;
   for(const item of items)for(let n=0;n<item.quantity;n++)ok(await api('picker','POST','/api/orders/update_item',{orderId:order.order_id,orderItemId:item.id,scanValue:item.barcode,type:'pick'}));
   assert.equal((await pool.query('SELECT status FROM orders WHERE id=$1',[order.order_id])).rows[0].status,'picked');
   ok(await claim('packer','pack'));
   for(const item of items)for(let n=0;n<item.quantity;n++)ok(await api('packer','POST','/api/orders/update_item',{orderId:order.order_id,orderItemId:item.id,scanValue:item.barcode,type:'pack'}));
   assert.equal((await pool.query('SELECT status FROM orders WHERE id=$1',[order.order_id])).rows[0].status,'completed');
  }
 });

});
