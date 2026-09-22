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
 const {server,io:socket}=require('../src/app');io=socket;await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const users={},tokens={};for(const role of ['admin','dispatcher','picker','packer']){users[role]=(await pool.query('INSERT INTO users(username,password,name,role) VALUES($1,$2,$1,$1) RETURNING id',[role,'unused'])).rows[0].id;tokens[role]=jwt.sign({id:users[role]},process.env.JWT_SECRET,{expiresIn:600});}
 async function api(role,method,path,body){const r=await fetch(`http://127.0.0.1:${server.address().port}`+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens[role]},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
 const ok=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
 const headers=['Name','Financial Status','Fulfillment Status','Currency','Subtotal','Shipping','Taxes','Total','Discount Amount','Refunded Amount','Lineitem quantity','Lineitem name','Lineitem price','Lineitem sku','Lineitem discount','Payment Method'];
 const rows=[headers,['TEST-A','paid','unfulfilled','TWD','105','0','0','105','0','0','1','品項 A','105','0001','0','card'],['TEST-B','paid','unfulfilled','TWD','210','0','0','210','0','0','2','品項 A','105','0001','0','card']];
 const settings={store:'本機隔離',customerCode:'CUST',customerName:'客戶',warehouseCode:'003',date:'2026-09-17',batchSequence:'1',batchNumber:'TEST-RELEASE-0917',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,discountAllocationConfirmed:true,skuMappings:{'0001':{erpSku:'ERP-0001',erpName:'品項 A',barcode:'4711299273087',confirmed:true,barcodeConfirmed:true}},shippingSku:{}};
 const saved=ok(await api('dispatcher','POST','/api/marketplace-intakes',{rows,settings}),201);
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
 let data=ok(await api('picker','GET',path));assert.equal(data.orders.length,2);assert.ok(data.orders.every(o=>/^WT[0-9A-F]{18}$/.test(o.work_barcode)));assert.equal(data.flow.erp_confirmed_at,null);assert.equal(data.batch.snapshot,undefined);
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
 });
 if(process.env.WMS_RELEASE_BROWSER==='1')await t.test('browser upload, print ownership, complete barcode papers and mobile layout',async()=>{
  await require('./warehouse-release-browser.cjs')({base:'http://127.0.0.1:'+server.address().port,id:saved.id,user:{id:users.admin,username:'admin',name:'admin',role:'admin'},token:tokens.admin,picker:{user:{id:users.picker,username:'picker',name:'picker',role:'picker'},token:tokens.picker},receipt,output:require('node:path').resolve(__dirname,'../../../artifacts/warehouse-release-20260917')});
 });
 await t.test('concurrent receipt retry creates one batch and fixed child work codes',async()=>{
  const results=await Promise.all([action('dispatcher','confirm-sales',{rows:receipt,savedSalesConfirmed:true}),action('dispatcher','confirm-sales',{rows:receipt,savedSalesConfirmed:true})]);results.forEach(r=>ok(r));
  data=ok(await api('admin','GET',path));assert.equal(data.orders.length,2);assert.ok(data.orders.every(o=>o.order_id));assert.equal((await pool.query('SELECT COUNT(*)::int n FROM orders')).rows[0].n,2);
  assert.equal(data.orders[0].expected_items[0].snCount,1);
  assert.equal((await api('picker','POST','/api/orders/'+data.orders[0].order_id+'/claim')).status,409);
  const claim={commandId:randomUUID(),expectedActorId:users.picker,barcode:data.orders[0].work_barcode,stage:'pick'};assert.equal((await api('picker','POST','/api/orders/claim-by-barcode',claim)).status,409);
  const heldId=data.orders[0].order_id;
  await pool.query("UPDATE orders SET status='picking',picker_id=$2 WHERE id=$1",[heldId,users.picker]);
  const heldScan=await api('picker','POST','/api/orders/update_item',{orderId:heldId,scanValue:'ABCD12345678',type:'pick'});
  assert.equal(heldScan.status,409);assert.match(heldScan.data.message,/預揀/);
  await pool.query("UPDATE orders SET status='pending',picker_id=NULL WHERE id=$1",[heldId]);
 });
 await t.test('print ownership, assignment and scan receipt are persistent',async()=>{
  await action('admin','print',{kind:'prepick'}).then(ok);await action('dispatcher','print',{kind:'orders'}).then(ok);
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

});
