// Real HTTP and PostgreSQL; only a random disposable loopback database.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes,randomUUID}=require('node:crypto');
const {Client}=require('pg');
const bcrypt=require('bcryptjs');
const xlsx=require('xlsx');

test('saved conversion links exact ERP details to barcode work orders', {skip:process.env.WMS_MARKETPLACE_PG_TEST!=='1',timeout:60000}, async t=>{
 const database='wms_market_'+randomBytes(6).toString('hex');
 const config={host:'127.0.0.1',port:55441,user:'wms_replay',password:'wms_replay_local_only',database:'postgres'};
 const control=new Client(config);await control.connect();await control.query('CREATE DATABASE "'+database+'"');
 Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:'',PGHOST:config.host,PGPORT:String(config.port),PGUSER:config.user,PGPASSWORD:config.password,PGDATABASE:database,PGOPTIONS:'',JWT_SECRET:'local-marketplace-test-only',DB_POOL_MAX:'3',DB_SSL_MODE:'disable',STORAGE_BACKEND:'local',CORS_ORIGINS:'http://127.0.0.1',WMS_ECPAY_ACCOUNTS_JSON:'[]',WMS_ECPAY_CALLBACKS_ENABLED:'false'});
 const {pool}=require('../src/config/database');
 let io;
 t.after(async()=>{if(io)await new Promise(resolve=>io.close(resolve));await pool.end();try{await control.query('DROP DATABASE "'+database+'"');}finally{await control.end();}});
 const {runMigrations}=require('../src/maintenance/migrationRunner');
 const {loadMigrationManifest}=require('../src/config/migrationManifest');
 await runMigrations({pool,targetDatabase:database,manifest:loadMigrationManifest().filter(m=>m.name<'030')});
 const legacy=(await pool.query("INSERT INTO orders(voucher_number) VALUES('MKT-LEGACY') RETURNING id")).rows[0].id;
 assert.deepEqual((await runMigrations({pool,targetDatabase:database})).applied,['030_marketplace_intakes.sql','031_marketplace_batch_management.sql','032_marketplace_store_profiles.sql']);
 assert.equal((await pool.query('SELECT id FROM orders WHERE id=$1',[legacy])).rows.length,1);
 await require('../src/config/schemaReadiness').assertSchemaReady(pool);
 const {server,io:socket}=require('../src/app');io=socket;
 const roles=['superadmin','admin','dispatcher','picker','packer'],tokens={},users={};
 for(const role of roles)users[role]=(await pool.query('INSERT INTO users(username,password,name,role) VALUES($1,$2,$3,$4) RETURNING id',['mkt_'+role,await bcrypt.hash('synthetic-test-only',4),'Synthetic '+role,role])).rows[0].id;
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 async function api(role,method,path,body){
  const headers=tokens[role]?{Authorization:'Bearer '+tokens[role]}:{};
  if(body&&!(body instanceof FormData))headers['Content-Type']='application/json';
  const response=await fetch(base+path,{method,headers,body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:response.status,data};
 }
 const ok=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
 for(const role of roles)tokens[role]=ok(await api(null,'POST','/api/auth/login',{username:'mkt_'+role,password:'synthetic-test-only'})).accessToken;
 const table=rows=>{const h=[...new Set(rows.flatMap(Object.keys))];return [h,...rows.map(r=>h.map(k=>r[k]??''))];};
 const item=(Name,more={})=>({Name,'Financial Status':'paid','Fulfillment Status':'unfulfilled',Currency:'TWD',Subtotal:'100',Shipping:'10',Taxes:'0',Total:'110','Discount Amount':'0','Refunded Amount':'0','Payment Method':'card','Lineitem quantity':'1','Lineitem name':'合成商品','Lineitem price':'100','Lineitem sku':'0001','Lineitem discount':'0',...more});
 const source=table([item('SYN-MKT-A',{Email:'PRIVATE-NOT-PERSISTED'}),item('SYN-MKT-B',{'Financial Status':'pending','Payment Method':'custom'})]);
 const settings={store:'合成商店',customerCode:'CUST',customerName:'合成客戶',warehouseCode:'003',date:'2026-09-15',batchSequence:'1',batchNumber:'TEST-SYN-MKT',currency:'TWD',taxMode:'erp_inclusive',taxType:'11',taxConfirmed:true,discountAllocationConfirmed:true,skuMappings:{'0001':{erpSku:'ERP-0001',erpName:'合成商品',barcode:'SYN-BAR-001',confirmed:true,barcodeConfirmed:true}},shippingSku:{erpSku:'FREIGHT',name:'運費',confirmed:true,nonStock:true}};
 const body=()=>({rows:structuredClone(source),settings:structuredClone(settings),rowsPreview:[['IGNORED']]});
 const post=(b=body(),role='dispatcher')=>api(role,'POST','/api/marketplace-intakes',b);
 let saved,imported;
 const erpHeader=['理貨單號','品項編碼','品項名稱','序號/批號','商城訂單編號','平台','店鋪','來源明細號','國際條碼','品項名稱(規格)','數量','倉庫/工廠名稱','客戶/供應商名稱','聯繫方式','摘要'];
 function erpRows(voucher='MKT-PICK-1'){
  return [['公司名稱 : 合成公司 / 2026/09/15 ~ 2026/09/15'],erpHeader,...saved.rows.map(r=>[voucher,r[11],r[16],'',r[12],r[13],r[14],r[15],r[11]==='FREIGHT'?'':'SYN-BAR-001',r[16],r[19],'合成倉庫','合成客戶','','']),['2026/09/15 (二) 12:00:00']];
 }
 async function upload(rows=erpRows(),id=saved.id,role='dispatcher'){
  const book=xlsx.utils.book_new();xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet(rows),'理貨明細');
  const form=new FormData();form.set('orderFile',new Blob([xlsx.write(book,{type:'buffer',bookType:'xlsx'})]),'synthetic.xlsx');
  if(id!==null)form.set('marketplaceIntakeId',String(id));
  return api(role,'POST','/api/orders/import',form);
 }
 const state=async()=>(await pool.query('SELECT (SELECT count(*)::int FROM orders) orders,(SELECT count(*)::int FROM warehouse_import_batches) batches,(SELECT count(*)::int FROM marketplace_work_order_links) links')).rows[0];
 await t.test('live role gates deny anonymous and warehouse users; settings types fail before saving',async()=>{
  for(const role of [null,...roles]){
   const allowed=['admin','dispatcher','superadmin'].includes(role),status=allowed?200:role?403:401;
   assert.equal((await api(role,'GET','/api/marketplace-intakes')).status,status);
   if(!allowed)assert.equal((await post(body(),role)).status,status);
  }
  const bad=body();bad.settings.taxConfirmed='true';assert.equal((await post(bad)).status,400);
  assert.equal((await api('admin','GET','/api/marketplace-intakes/9999999999')).status,400);
 });
 await t.test('server recalculates 27 columns, stores no contacts and retries reuse the persisted batch',async()=>{
  const forged=body();forged.handler={userId:users.admin,name:'FORGED'};forged.settings.handler='FORGED';
  saved=ok(await post(forged),201);assert.deepEqual(saved.handler,{userId:users.dispatcher,name:'Synthetic dispatcher',username:'mkt_dispatcher'});assert.equal(saved.headers.length,27);assert.equal(saved.rows.length,4);assert.equal(saved.summary.physicalQuantity,2);assert.equal(saved.summary.ecountTotalMinor,22000);
  assert.doesNotMatch(JSON.stringify(saved),/PRIVATE-NOT-PERSISTED|IGNORED/);
  const retry=body();retry.settings.batchNumber='TEST-RETRY';const again=ok(await post(retry,'admin'));assert.deepEqual(again.handler,saved.handler);assert.equal(again.id,saved.id);assert.equal(again.reused,true);
  assert.deepEqual(ok(await api('superadmin','GET','/api/marketplace-intakes/'+saved.id)).rows,saved.rows);
  const changed=body();changed.settings.customerCode='DIFFERENT';assert.equal((await post(changed)).status,409);
  assert.equal((await state()).orders,1);
 });
 await t.test('shared store profiles keep only reusable settings and enforce current roles',async()=>{
  const path='/api/marketplace-intakes/store-profiles';
  for(const role of [null,'picker','packer']){
   assert.equal((await api(role,'GET',path)).status,role?403:401);
   assert.equal((await api(role,'POST',path,{platform:'Shopify',settings})).status,role?403:401);
  }
  const profile=ok(await api('dispatcher','POST',path,{platform:'Shopify',settings}));
  assert.equal(profile.settings.customerCode,'CUST');
  for(const key of ['skuMappings','date','batchNumber','includeTestOrders','handler','discountAllocationConfirmed'])assert.equal(profile.settings[key],undefined);
  assert.equal(ok(await api('admin','GET',path)).profiles[0].id,profile.id);
  const updated=ok(await api('admin','POST',path,{platform:'Shopify',settings:{...settings,customerCode:'OTHER'}}));assert.equal(updated.id,profile.id);
  const other=ok(await api('admin','POST',path,{platform:'SHOPLINE',settings}));assert.notEqual(other.id,profile.id);
  assert.equal((await api('admin','POST',path,{platform:'Unknown',settings})).status,400);
  assert.equal((await api('admin','POST',path,{platform:'Shopify',settings:{...settings,taxConfirmed:'true'}})).status,400);
  assert.equal((await api('admin','POST',path,{platform:'Shopify',settings:{...settings,store:''}})).status,400);
 });
 await t.test('saved handler survives account rename and another staff download',async()=>{
  await pool.query("UPDATE users SET name='Renamed dispatcher' WHERE id=$1",[users.dispatcher]);
  const detail=ok(await api('admin','GET','/api/marketplace-intakes/'+saved.id));assert.deepEqual(detail.handler,saved.handler);
  const response=await fetch(base+'/api/marketplace-intakes/'+saved.id+'/download-link',{method:'POST',headers:{Authorization:'Bearer '+tokens.admin,'Content-Type':'application/json'},body:JSON.stringify({kind:'prepick'})});
  const cookie=response.headers.get('set-cookie').split(';')[0],link=await response.json();
  const download=await fetch(base+link.url,{headers:{Cookie:cookie}});assert.equal(download.status,200);
  const book=xlsx.read(Buffer.from(await download.arrayBuffer()));
  for(const sheet of ['批次說明','預揀總表','訂單商品明細']){
   const rows=xlsx.utils.sheet_to_json(book.Sheets[sheet],{header:1,defval:''});assert.ok(rows.flat().includes('Synthetic dispatcher'));assert.ok(!rows.flat().includes('Synthetic admin'));
  }
 });
 await t.test('downloads require short-lived scoped cookies and preserve actual 27-column XLSX',async()=>{
  const path='/api/marketplace-intakes/'+saved.id+'/download-link';
  assert.equal((await api('picker','POST',path,{kind:'ecount'})).status,403);
  const response=await fetch(base+path,{method:'POST',headers:{Authorization:'Bearer '+tokens.admin,'Content-Type':'application/json'},body:JSON.stringify({kind:'ecount'})});
  assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0],link=await response.json();
  assert.match(response.headers.get('set-cookie'),/HttpOnly/);assert.match(response.headers.get('set-cookie'),/SameSite=Strict/);
  assert.equal((await fetch(base+link.url)).status,403);
  assert.equal((await fetch(base+link.url.replace('ecount','prepick'),{headers:{Cookie:cookie}})).status,403);
  const download=await fetch(base+link.url,{headers:{Cookie:cookie}});assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/^attachment;/);
  const book=xlsx.read(Buffer.from(await download.arrayBuffer()));const rows=xlsx.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,defval:''});
  assert.equal(rows[0].length,27);assert.equal(rows[1][23],'SYN-MKT-A');assert.equal(rows[1][15],1);assert.equal(rows[1][17],100);
  assert.equal((await fetch(base+'/api/marketplace-intakes',{headers:{Authorization:'Bearer '+cookie.split('=')[1]}})).status,403);
  await pool.query("UPDATE users SET role='picker' WHERE id=$1",[users.admin]);
  assert.equal((await fetch(base+link.url,{headers:{Cookie:cookie}})).status,403);
  await pool.query("UPDATE users SET role='admin' WHERE id=$1",[users.admin]);
 });
 await t.test('mismatched SKU, quantity, barcode, store, missing child and freight anomalies leave no work orders',async()=>{
  const original=await state();
  const edits=[
   rows=>{rows[2][1]='WRONG';},rows=>{rows[2][10]=2;},rows=>{rows[2][8]='WRONG';},rows=>{rows[2][6]='OTHER-STORE';},
   rows=>{rows.splice(4,2);},rows=>{rows[3][0]='OTHER-VOUCHER';},rows=>{rows.splice(4,0,[...rows[3]]);},rows=>{rows[3][10]=2;},
   rows=>{rows[2][7]='UNKNOWN-LINE';}
  ];
  for(const edit of edits){const rows=erpRows();edit(rows);const result=await upload(rows);assert.ok([400,409].includes(result.status),JSON.stringify(result));assert.equal(result.data.code,'IMPORT_NOT_APPLIED');assert.deepEqual(await state(),original);}
  assert.equal((await upload(erpRows(),saved.id,'picker')).status,403);
 });
 await t.test('archive retains snapshot, duplicate protection and ERP return matching',async()=>{
  const path='/api/marketplace-intakes/'+saved.id;
  for(const role of ['picker','packer'])for(const [method,suffix] of [['PATCH','/archive'],['PATCH','/restore'],['DELETE','']])assert.equal((await api(role,method,path+suffix,{confirmed:true,batchNumber:saved.batchNumber})).status,403);
  ok(await api('dispatcher','PATCH',path+'/archive'));
  assert.equal(ok(await api('dispatcher','GET','/api/marketplace-intakes')).total,0);
  assert.equal(ok(await api('dispatcher','GET','/api/marketplace-intakes?status=archived')).total,1);
  const archived=ok(await api('dispatcher','GET',path));assert.ok(archived.archivedAt);assert.deepEqual(archived.rows,saved.rows);
  assert.equal(ok(await post()).id,saved.id);
  const changed=body();changed.settings.customerCode='OTHER';assert.equal((await post(changed)).status,409);
 });
 await t.test('successful return creates two linked barcode work orders and one physical prepick group',async()=>{
  imported=ok(await upload(),201);assert.equal(imported.workOrderCount,2);assert.equal(imported.totalQuantity,2);assert.equal(imported.itemCount,2);
  assert.equal(new Set(imported.orders.map(o=>o.workBarcode)).size,2);assert.ok(imported.orders.every(o=>o.marketplaceIntakeId===saved.id));
  const list=ok(await api('dispatcher','GET','/api/marketplace-intakes?status=all'));assert.equal(list.intakes[0].linked_count,2);
  const detail=ok(await api('dispatcher','GET','/api/marketplace-intakes/'+saved.id));assert.equal(detail.links.length,2);assert.ok(detail.links.every(l=>l.import_batch_id===imported.batchId&&l.work_barcode));
  assert.equal((await api('admin','DELETE','/api/marketplace-intakes/'+saved.id,{confirmed:true,batchNumber:saved.batchNumber})).status,409);
  const batch=ok(await api('picker','GET','/api/order-import-batches/'+imported.batchId));
  assert.ok(JSON.stringify(batch).includes('SYN-MKT-A'));assert.ok(JSON.stringify(batch).includes('SYN-BAR-001'));assert.doesNotMatch(JSON.stringify(batch),/FREIGHT/);
  for(const o of imported.orders){const snap=ok(await api('picker','GET','/api/orders/'+o.orderId+'/work-snapshot'));assert.equal(snap.items.length,1);assert.equal(snap.items[0].source_order_number,o.sourceOrderNumber);}
  const before=await state();assert.equal((await upload(erpRows('MKT-PICK-DUPLICATE'),null)).status,409);assert.deepEqual(await state(),before);
 });
 await t.test('linked orders use existing barcode claim, product verification and separate packing ownership',async()=>{
  const o=imported.orders[0];
  const claim=(role,stage)=>api(role,'POST','/api/orders/claim-by-barcode',{expectedActorId:users[role],commandId:randomUUID(),barcode:o.workBarcode,stage});
  ok(await claim('picker','pick'));
  const scan=(role,type,code)=>api(role,'POST','/api/orders/update_item',{orderId:o.orderId,type,scanValue:code});
  assert.notEqual((await scan('picker','pick','WRONG')).status,200);
  assert.equal(ok(await scan('picker','pick','SYN-BAR-001')).order.status,'picked');
  ok(await claim('packer','pack'));assert.equal(ok(await scan('packer','pack','SYN-BAR-001')).order.status,'completed');
  const snap=ok(await api('admin','GET','/api/orders/'+o.orderId+'/work-snapshot'));assert.equal(snap.order.picker_id,users.picker);assert.equal(snap.order.packer_id,users.packer);
 });
 await t.test('a combined ERP batch links saved Shopify and SHOPLINE sources; unmatched extras fail',async()=>{
  const a=body();a.rows=table([item('SYN-MIX-A')]);a.settings.batchNumber='TEST-MIX-A';
  const b=body();b.rows=table([{'訂單編號':'SYN-MIX-B','商品貨號':'0001','商品名稱':'合成商品','數量':'1','單價':'100','付款狀態':'已付款','送貨狀態':'待出貨','付款方式':'信用卡','訂單狀態':'已確認','訂單小計':'100','運費':'10','優惠折扣':'0','訂單合計':'110'}]);b.settings.batchNumber='TEST-MIX-B';
  const mixed=[ok(await post(a),201),ok(await post(b),201)];
  const original=saved;
  const rows=[erpHeader,...mixed.flatMap(s=>{saved=s;return erpRows('SYN-MIXED').slice(2,-1);})];saved=original;
  const wrong=structuredClone(rows);wrong[3][6]='WRONG-STORE';
  assert.equal((await upload(wrong,null)).status,409);
  const result=ok(await upload(rows,null),201);
  assert.equal(result.workOrderCount,2);assert.deepEqual(result.orders.map(o=>o.marketplaceIntakeId).sort(),mixed.map(m=>m.id).sort());
 });
 await t.test('conversion accepts over 100 KB and rolls back a failed later child',async()=>{
  const big=body();big.rows=table(Array.from({length:260},(_,i)=>item('SYN-LARGE-'+i,{'Lineitem name':'合成商品'.repeat(70)})));big.settings.batchNumber='TEST-LARGE';
  assert.ok(Buffer.byteLength(JSON.stringify(big))>100000);
  const large=ok(await post(big),201);assert.equal(large.summary.orderCount,260);
  await pool.query("CREATE FUNCTION reject_market_child() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_order_number='SYN-ROLL-B' THEN RAISE EXCEPTION 'synthetic rollback'; END IF; RETURN NEW; END $$");
  await pool.query('CREATE TRIGGER reject_market_child BEFORE INSERT ON marketplace_intake_orders FOR EACH ROW EXECUTE FUNCTION reject_market_child()');
  const roll=body();roll.rows=table([item('SYN-ROLL-A'),item('SYN-ROLL-B')]);roll.settings.batchNumber='TEST-ROLL';
  assert.equal((await post(roll)).status,500);
  assert.equal((await pool.query("SELECT count(*)::int n FROM marketplace_intakes WHERE batch_number='TEST-ROLL'")).rows[0].n,0);
  assert.equal((await pool.query("SELECT count(*)::int n FROM marketplace_intake_orders WHERE source_order_number='SYN-ROLL-A'")).rows[0].n,0);
 });
 await t.test('native SHOPLINE allocations persist source money and link the unchanged canonical detail identifiers',async()=>{
  const b=body();b.settings.batchNumber='TEST-NATIVE-SL';
  b.rows=table([{'訂單號碼':'#SYN-NATIVE-SL','商品貨號':'0001','商品名稱':'合成商品','商品類型':'商品','數量':1,'商品結帳價':100,'付款狀態':'已付款','送貨狀態':'備貨中','付款方式':'信用卡','訂單狀態':'處理中','訂單小計':100,'運費':0,'優惠折扣':10,'訂單合計':85,'稅費':0,'貨幣':'TWD','已退款金額':0,'附加費':0,'自訂折扣合計':0,'折抵購物金':5,'點數折現':0,'商品折扣金額':10,'全單折扣金額':'','折抵購物金分攤':5,'點數折現分攤':''}]);
  const native=ok(await post(b),201);assert.equal(native.summary.ecountTotalMinor,8500);
  assert.equal(native.orders[0].sourceFinancial.subtotalMinor,10000);assert.equal(native.orders[0].financial.subtotalMinor,8500);
  assert.equal(native.items[0].sourceDiscounts.credit,500);
  assert.equal(ok(await post(b)).id,native.id);
  const {buildEcountUploadTable}=await import('../src/services/marketplaceIntake.mjs');
  const downloaded=buildEcountUploadTable(ok(await api('dispatcher','GET','/api/marketplace-intakes/'+native.id)));
  assert.equal(downloaded.rows[0][17],85);assert.equal(downloaded.rows[0][23],'#SYN-NATIVE-SL');
  const original=saved;saved=native;const rows=erpRows('SYN-NATIVE-PICK');saved=original;
  const result=ok(await upload(rows,native.id),201);assert.equal(result.workOrderCount,1);
  const snapshot=ok(await api('picker','GET','/api/orders/'+result.orders[0].orderId+'/work-snapshot'));
  assert.equal(snapshot.items[0].source_order_number,'#SYN-NATIVE-SL');assert.ok(result.orders[0].workBarcode.startsWith('WT'));
 });
 await t.test('permanent delete requires exact confirmation, retains audit, and releases only unlinked source orders',async()=>{
  const b=body();b.rows=table([item('SYN-DELETE')]);b.settings.batchNumber='TEST-DELETE';
  const r=ok(await post(b),201),path='/api/marketplace-intakes/'+r.id;
  for(const confirm of [{},{confirmed:true,batchNumber:'WRONG'},{confirmed:'true',batchNumber:r.batchNumber}])assert.equal((await api('admin','DELETE',path,confirm)).status,400);
  ok(await api('admin','PATCH',path+'/archive'));ok(await api('admin','PATCH',path+'/restore'));
  assert.equal(ok(await api('admin','GET',path)).archivedAt,null);
  const results=await Promise.all([api('admin','DELETE',path,{confirmed:true,batchNumber:r.batchNumber}),api('admin','DELETE',path,{confirmed:true,batchNumber:r.batchNumber})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,404]);
  assert.equal((await api('admin','GET',path)).status,404);
  assert.equal((await pool.query('SELECT count(*)::int n FROM marketplace_intake_orders WHERE intake_id=$1',[r.id])).rows[0].n,0);
  assert.deepEqual((await pool.query('SELECT action FROM marketplace_intake_events WHERE intake_id=$1 ORDER BY id',[r.id])).rows.map(x=>x.action),['archive','restore','delete']);
  assert.notEqual(ok(await post(b),201).id,r.id);
 });
 await t.test('filters use sales date and exact platform/store; pagination reaches beyond the old 100 batch cap',async()=>{
  const snapshot={...saved,settings:{...settings,date:'2026-09-10'},summary:{orderCount:2}};
  await pool.query(`INSERT INTO marketplace_intakes(batch_number,source_platform,source_store,fingerprint,snapshot)
   SELECT 'PAGE-'||n,'Shopify','分頁店鋪',md5(n::text)||md5(n::text),$1::jsonb FROM generate_series(1,105) n`,[JSON.stringify(snapshot)]);
  const query='/api/marketplace-intakes?platform=Shopify&store='+encodeURIComponent('分頁店鋪')+'&from=2026-09-10&to=2026-09-10';
  const first=ok(await api('admin','GET',query));assert.equal(first.total,105);assert.equal(first.orders,210);assert.equal(first.intakes.length,20);
  const last=ok(await api('admin','GET',query+'&page=6'));assert.equal(last.intakes.length,5);assert.ok(last.intakes.every(r=>r.sales_date==='2026-09-10'));
  assert.equal(ok(await api('admin','GET',query+'&q=PAGE-105')).total,1);
  assert.equal(ok(await api('admin','GET',query.replace('Shopify','SHOPLINE'))).total,0);
  for(const invalid of ['status=bad','page=0','from=2026-02-30','from=2026-10-10&to=2026-09-01'])assert.equal((await api('admin','GET','/api/marketplace-intakes?'+invalid)).status,400);
 });

});
