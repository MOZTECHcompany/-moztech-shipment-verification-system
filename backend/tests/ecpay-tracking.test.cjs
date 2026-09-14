const {test}=require('node:test');const assert=require('node:assert/strict');const {readFileSync}=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');const express=require('express');const request=require('supertest');
const {mac}=require('../src/services/ecpay/protocol');const {saveQuery,recordCallback}=require('../src/services/ecpay/tracking');const {createLogisticsRouter,createLogisticsCallbackRouter}=require('../src/routes/logisticsRoutes');
const a={id:'a',label:'測試 A',merchantId:'2000132',environment:'stage',hashKey:'5294y06JbISpM5x9',hashIv:'v77hoKGq4kWxNNIS',enabled:true,verified:true,services:['UNIMART']};
const b={...a,id:'b',merchantId:'2000933',hashKey:'XBERn1YOvpM9nfZc',hashIv:'h1ONHk4P4yqbl5LK'};
const snapshot=(account=a,extra={})=>({accountId:account.id,environment:account.environment,merchantId:account.merchantId,logisticsId:'123',merchantTradeNo:'O1',shipmentNo:'456',service:'UNIMART',statusCode:'2074',status:'uncollected',needsReturnTracking:true,checkedAt:'2026-09-10T08:00:00.000Z',...extra});
const callback=(extra={})=>{const d={MerchantID:a.merchantId,AllPayLogisticsID:'123',MerchantTradeNo:'O1',RtnCode:'2067',LogisticsSubType:'UNIMART',UpdateStatusDate:'2026/09/09 12:00:00',...extra};return {...d,CheckMacValue:mac(d,a)};};
async function setup(){const db=new PGlite();await db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY, role TEXT); CREATE TABLE orders(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1,\'admin\'),(2,\'picker\'); INSERT INTO orders VALUES(1),(2);');await db.exec(readFileSync(require.resolve('../migrations/020_ecpay_tracking.sql'),'utf8'));return {db,pool:{query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})}};}
test('return-center receipt creates one expected return, never warehouse receipt or an order',async()=>{const {db,pool}=await setup();try{
 const result=snapshot(a,{merchantTradeNo:'#152940',statusCode:'2076',status:'returned_to_center'});
 await saveQuery(pool,a,result,1);await saveQuery(pool,a,result,1);
 const rows=(await db.query('SELECT r.status,s.order_id,s.merchant_trade_no FROM wms_logistics_expected_returns r JOIN wms_logistics_shipments s ON s.id=r.shipment_id')).rows;
 assert.equal(rows.length,1);assert.equal(rows[0].status,'expected');assert.equal(rows[0].order_id,null);assert.equal(rows[0].merchant_trade_no,'#152940');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n,2);
 }finally{await db.close();}});
test('PostgreSQL migration, duplicate import, account isolation, stale query and conflicting order',async()=>{const {db,pool}=await setup();try{
 const first=await saveQuery(pool,a,snapshot(),1,1);assert.equal(first.created,true);
 const twice=await saveQuery(pool,a,snapshot(),1,1);assert.equal(twice.created,false);assert.equal(first.id,twice.id);
 await saveQuery(pool,b,snapshot(b),1,2);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM wms_logistics_shipments')).rows[0].n,2);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM wms_logistics_events')).rows[0].n,2);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM wms_logistics_expected_returns')).rows[0].n,2);
 await assert.rejects(saveQuery(pool,a,snapshot(),1,2),e=>e.code==='SHIPMENT_CONFLICT');
 await saveQuery(pool,a,snapshot(a,{checkedAt:'2026-09-09T08:00:00Z',status:'collected',needsReturnTracking:false,statusCode:'2067'}),1,1);
 assert.equal((await db.query('SELECT status FROM wms_logistics_shipments WHERE id=$1',[first.id])).rows[0].status,'uncollected');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n,2);
 }finally{await db.close();}});
test('callbacks persist once, never regress a snapshot, and reject merchant/order/signature mismatches',async()=>{const {db,pool}=await setup();try{
 const {id}=await saveQuery(pool,a,snapshot(),1);
 assert.equal((await recordCallback(pool,a,callback())).duplicate,false);
 assert.equal((await recordCallback(pool,a,callback())).duplicate,true);
 const saved=(await db.query('SELECT * FROM wms_logistics_shipments WHERE id=$1',[id])).rows[0];assert.equal(saved.status,'uncollected');assert.equal(saved.sync_requested,true);
 await assert.rejects(recordCallback(pool,a,callback({MerchantTradeNo:'OTHER'})),e=>e.code==='CALLBACK_CONFLICT');
 await assert.rejects(recordCallback(pool,b,callback()),e=>e.code==='INVALID_CALLBACK');
 await assert.rejects(recordCallback(pool,a,{...callback(),RtnCode:'9999'}),e=>e.code==='INVALID_CALLBACK');
 }finally{await db.close();}});
test('unknown shipment callback is retained and later attached without fabricating an order',async()=>{const {db,pool}=await setup();try{
 assert.equal((await recordCallback(pool,a,callback())).matched,false);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM wms_logistics_shipments')).rows[0].n,0);
 const {id}=await saveQuery(pool,a,snapshot(),1);
 assert.equal((await db.query("SELECT shipment_id FROM wms_logistics_events WHERE source='callback'")).rows[0].shipment_id,id);
 }finally{await db.close();}});
test('HTTP uses current DB role, strips credentials, validates references, imports and lists',async()=>{const {db,pool}=await setup();try{
 const env={WMS_ECPAY_ACCOUNTS_JSON:JSON.stringify([a,b])};let calls=0;
 const app=express();app.use(express.json());app.use((req,res,next)=>{if(req.headers['x-test-user'])req.user={id:Number(req.headers['x-test-user']),role:'superadmin'};next();});app.use('/logistics',createLogisticsRouter({pool,env,query:async(account,q)=>{calls++;assert.equal(q.logisticsId,'123');return snapshot(account);}}));
 await request(app).get('/logistics/accounts').expect(401);await request(app).get('/logistics/accounts').set('x-test-user','2').expect(403);
 const out=await request(app).get('/logistics/accounts').set('x-test-user','1').expect(200);assert.equal(JSON.stringify(out.body).includes(a.hashKey),false);
 await request(app).post('/logistics/accounts/a/import').set('x-test-user','1').send({query:{logisticsId:'123'},orderId:1}).expect(200);
 const list=await request(app).get('/logistics/shipments').set('x-test-user','1').expect(200);assert.equal(list.body.items.length,1);assert.equal(list.body.items[0].return_status,'expected');assert.equal(calls,1);
 await db.query("UPDATE users SET role='picker' WHERE id=1");await request(app).get('/logistics/accounts').set('x-test-user','1').expect(403);
 }finally{await db.close();}});
test('callback HTTP default disabled; enabled accepts only verified form and persists before ACK',async()=>{const {db,pool}=await setup();try{
 const env={WMS_ECPAY_ACCOUNTS_JSON:JSON.stringify([a])};const app=express();app.use('/callback',createLogisticsCallbackRouter({pool,env}));
 await request(app).post('/callback/a').type('form').send(callback()).expect(503);
 env.WMS_ECPAY_CALLBACKS_ENABLED='true';const ok=await request(app).post('/callback/a').type('form').send(callback()).expect(200);assert.equal(ok.text,'1|OK');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM wms_logistics_events')).rows[0].n,1);
 await request(app).post('/callback/a').type('form').send({...callback(),RtnCode:'999'}).expect(403);
 await request(app).post('/callback/a').type('form').send('MerchantID=1&MerchantID=2').expect(502);
 }finally{await db.close();}});
