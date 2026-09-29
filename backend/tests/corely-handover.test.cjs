const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { generateKeyPairSync, randomUUID, randomBytes, createHash } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const native = require('../src/services/corelyNativeIntake');
const service = require('../src/services/corelyHandover');
const { senderConfig, deliverOne } = require('../src/services/corelyHandoverOutbox');
const { createCorelyPrepickRouter } = require('../src/routes/corelyNativeIntakeRoutes');
async function setup() {
    let db, pool;
    if (process.env.CORELY_HANDOVER_PG_TEST === '1') {
        const { Client, Pool } = require('pg');
        const cfg = { host: '127.0.0.1', port: 55441, user: 'wms_replay', password: 'wms_replay_local_only' };
        const name = 'corely_handover_' + randomBytes(6).toString('hex');
        const control = new Client({ ...cfg, database: 'postgres' }); await control.connect(); await control.query('CREATE DATABASE "' + name + '"');
        const pg = new Pool({ ...cfg, database: name, max: 5 });
        pool = { query: (...a) => pg.query(...a), connect: async () => { const c = await pg.connect(); return { query: (...a) => c.query(...a), release: () => c.release() }; } };
        db = { query: (...a) => pg.query(...a), exec: sql => pg.query(sql), close: async () => { await pg.end(); await control.query('DROP DATABASE "' + name + '"'); await control.end(); } };
    } else db = new PGlite();
    for (const name of ['000_initial_schema.sql','028_order_item_source_identity.sql','029_warehouse_batches_and_claim_receipts.sql','030_marketplace_intakes.sql','033_warehouse_release.sql','036_corely_native_intakes.sql','037_corely_handover.sql']) await db.exec(readFileSync(join(__dirname,'../migrations',name),'utf8'));
    let tail = Promise.resolve();
    pool ||= { query: (...a) => db.query(...a), connect: async () => { const before = tail; let release; tail = new Promise(r => { release = r; }); await before; return { query: (...a) => db.query(...a), release }; } };
    const user = (await db.query("INSERT INTO users(username,password,name,role) VALUES('dispatcher','unused','交運人員','dispatcher') RETURNING id,role")).rows[0]; user.entityId = 'company';
    await db.query("INSERT INTO corely_dispatch_grants VALUES('company','erp-actor','MOZTECH',$1,NULL)",[user.id]);
    const create = async (id = 'sale-1', serial = false) => {
        const body = { requestId: 'request-' + id, order: { orderNumber: id, brand: 'MOZTECH', sourceHash: 'a'.repeat(64), items: [
            {id:'line-A',productId:'product',sku:'0001',name:'商品A',barcode:'000123',quantity:100,tracked:false,serials:[]},
            {id:'line-B',productId:'product',sku:'0001',name:'商品A第二來源',barcode:'000123',quantity:2,tracked:serial,serials:serial?['S1','S2']:[]}
        ], reservationReference:{salesOrderId:id,warehouseId:'warehouse',quantitiesByProduct:[{productId:'product',quantity:102}]}}};
        const r = await native.dispatch(pool,{actorId:'erp-actor',entityId:'company',station:'dispatch'},id,body);
        await db.query('UPDATE corely_native_intakes SET prepick_completed_at=NOW() WHERE id=$1',[r.nativeIntakeId]);
        await db.query("UPDATE orders SET warehouse_hold=FALSE,status='packing' WHERE id=$1",[r.wmsOrderId]);
        await db.query('UPDATE order_items SET picked_quantity=quantity,packed_quantity=quantity WHERE order_id=$1',[r.wmsOrderId]);
        return r;
    };
    const app = express(); app.use(express.json()); app.use('/api/corely-intakes',(req,_res,next)=>{req.user={...user,...(req.headers['test-role']?{role:req.headers['test-role']}:{}),...(req.headers['test-entity']?{entityId:req.headers['test-entity']}:{})};next();},createCorelyPrepickRouter({pool}));
    app.use((error,_req,res,_next)=>res.status(500).json({message:error.message}));
    // Keep one loopback server open; concurrent supertest(app) requests can
    // otherwise race their automatic server close when PGlite is CPU-bound.
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const closeDb = db.close; db.close = async () => { await new Promise(resolve => server.close(resolve)); await closeDb.call(db); };
    return {db,pool,user,create,app:server};
}
const command = (user,quantity=60,box='BOX-1',line='line-A') => ({commandId:randomUUID(),expectedActorId:user.id,confirmed:true,handover:{method:'carrier_collection',carrier:'TEST',manifestId:'MANIFEST'},lines:[{salesOrderLineId:line,quantity,packages:[{packageId:box,quantity}]}]});
test('physical partial handover preserves identity, packed bounds, immutable evidence and retry', {timeout:60000}, async t => {
    const f=await setup();t.after(()=>f.db.close());const r=await f.create();const id=r.nativeIntakeId;
    const post=b=>request(f.app).post(`/api/corely-intakes/${id}/shipments`).send(b);
    await t.test('permission, entity, evidence and package sums fail before persistence',async()=>{
        assert.equal((await request(f.app).post(`/api/corely-intakes/${id}/shipments`).set('test-role','picker').send(command(f.user))).status,403);
        assert.equal((await request(f.app).get(`/api/corely-intakes/${id}/shipments`).set('test-entity','other')).status,404);
        for(const mutate of [b=>b.confirmed=false,b=>delete b.handover.manifestId,b=>b.lines[0].packages[0].quantity=59,b=>b.lines.push(b.lines[0]),b=>b.expectedActorId=999]){const b=command(f.user);mutate(b);assert.equal((await post(b)).status,400);}
        assert.equal((await f.db.query('SELECT count(*)::int n FROM corely_shipments')).rows[0].n,0);
    });
    let first,firstCommand=command(f.user);
    await t.test('concurrent same command commits once with outbox and source lines',async()=>{
        const results=await Promise.all([post(firstCommand),post(firstCommand)]);for(const r of results)assert.equal(r.status,200,JSON.stringify(r.body));first=results[0].body;
        assert.equal(first.id,results[1].body.id);assert.equal(first.lines[0].salesOrderLineId,'line-A');assert.equal(first.lines[0].productId,'product');assert.equal(first.status,'handed_over');
        const out=(await f.db.query('SELECT * FROM corely_handover_outbox')).rows;assert.equal(out.length,1);assert.equal(out[0].status,'pending');
        const e=JSON.parse(out[0].body_text);assert.equal(e.contractVersion,'corely.wms.handover.v1');assert.equal(e.warehouseId,'warehouse');assert.equal(e.wmsOrderId,r.wmsOrderId);assert.equal(e.sourceHash,'a'.repeat(64));
    });
    await t.test('100 ships as 60 plus 40, same SKU second line remains independent',async()=>{
        const rows=await service.listShipments(f.pool,id,f.user);assert.equal(rows.lines[0].availableQuantity,40);assert.equal(rows.lines[1].handedOverQuantity,0);
        assert.equal((await post({...firstCommand,lines:command(f.user,61).lines})).status,409);
        assert.equal((await post(command(f.user,41,'BOX-2'))).status,409);
        assert.equal((await post(command(f.user,1,'BOX-1'))).status,409);
        assert.equal((await post(command(f.user,40,'BOX-2'))).status,200);
        assert.equal((await post(command(f.user,1,'BOX-3'))).status,409);
        assert.equal((await post(command(f.user,2,'BOX-3','line-B'))).status,200);
        assert.equal((await service.listShipments(f.pool,id,f.user)).lines[0].handedOverQuantity,100);
    });
    await t.test('old SQL undo, source edit, deletion and void cannot erase handed over goods',async()=>{
        for(const sql of ["UPDATE order_items SET packed_quantity=0 WHERE source_line_id='line-A'","UPDATE order_items SET picked_quantity=0 WHERE source_line_id='line-A'","UPDATE order_items SET quantity=101 WHERE source_line_id='line-A'","UPDATE order_items SET source_line_id='different' WHERE source_line_id='line-A'","DELETE FROM order_items WHERE source_line_id='line-A'","UPDATE orders SET status='voided'","UPDATE corely_shipments SET event='{}'","DELETE FROM corely_shipment_packages","UPDATE corely_handover_outbox SET body_text='{}'"]){await assert.rejects(f.db.query(sql),/constraint|IMMUTABLE|foreign key/i);}
    });
    await t.test('SN, changed source, pending reservation and uncompleted prepick cannot hand over',async()=>{
        const sn=await f.create('serial-order',true);await assert.rejects(service.handover(f.pool,sn.nativeIntakeId,command(f.user),f.user),/SN/);
        const pending=await f.create('pending');await f.db.query('UPDATE orders SET warehouse_hold=TRUE WHERE id=$1',[pending.wmsOrderId]);await assert.rejects(service.handover(f.pool,pending.nativeIntakeId,command(f.user),f.user),/預留/);
        const changed=await f.create('changed');await f.db.query("UPDATE order_items SET barcode='DIFFERENT' WHERE order_id=$1",[changed.wmsOrderId]);await assert.rejects(service.handover(f.pool,changed.nativeIntakeId,command(f.user),f.user),/異動/);
    });
    await t.test('different concurrent shipments cannot both consume the same packed units',async()=>{
        const order=await f.create('parallel');
        const results=await Promise.allSettled([service.handover(f.pool,order.nativeIntakeId,command(f.user,60,'PAR-A'),f.user),service.handover(f.pool,order.nativeIntakeId,command(f.user,60,'PAR-B'),f.user)]);
        assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
        assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.status===409).length,1);
        assert.equal((await f.db.query("SELECT handed_over_quantity FROM order_items WHERE order_id=$1 AND source_line_id='line-A'",[order.wmsOrderId])).rows[0].handed_over_quantity,60);
    });
    await t.test('failure writing outbox rolls back shipment and counter',async()=>{
        const order=await f.create('rollback');const original=f.pool.connect;
        f.pool.connect=async()=>{const c=await original();const q=c.query;c.query=(sql,...args)=>sql.startsWith('INSERT INTO corely_handover_outbox')?Promise.reject(Error('synthetic failure')):q(sql,...args);return c;};
        await assert.rejects(service.handover(f.pool,order.nativeIntakeId,command(f.user),f.user),/synthetic/);f.pool.connect=original;
        assert.equal((await f.db.query('SELECT count(*)::int n FROM corely_shipments WHERE intake_id=$1',[order.nativeIntakeId])).rows[0].n,0);
        assert.equal((await f.db.query('SELECT max(handed_over_quantity) n FROM order_items WHERE order_id=$1',[order.wmsOrderId])).rows[0].n,0);
    });
    await t.test('lost commit response preserves original shipment and no duplicate',async()=>{
        const order=await f.create('lost');const body=command(f.user);const original=f.pool.connect;let once=true;
        f.pool.connect=async()=>{const c=await original();const q=c.query;c.query=async(sql,...args)=>{const result=await q(sql,...args);if(sql==='COMMIT'&&once){once=false;throw Error('lost reply');}return result;};return c;};
        await assert.rejects(service.handover(f.pool,order.nativeIntakeId,body,f.user),e=>e.status===503);f.pool.connect=original;
        const replay=await service.handover(f.pool,order.nativeIntakeId,body,f.user);assert.equal(replay.reused,true);
    });
    await t.test('RS256, exact wire hash, timeout retry and malformed ACK retain pending facts',async()=>{
        const keys=generateKeyPairSync('rsa',{modulusLength:2048});const env={WMS_HANDOVER_ENABLED:'true',WMS_HANDOVER_ERP_URL:'https://erp.example/api/v1/integration/wms/events',WMS_HANDOVER_PRIVATE_KEY:keys.privateKey.export({type:'pkcs8',format:'pem'}),WMS_HANDOVER_JWT_ISSUER:'wms-test',WMS_HANDOVER_JWT_AUDIENCE:'erp-test'};const config=senderConfig(env);
        let wire,eventId;const verify=options=>{const e=JSON.parse(options.body);const c=jwt.verify(options.headers.Authorization.slice(7),keys.publicKey,{algorithms:['RS256'],issuer:'wms-test',audience:'erp-test'});assert.equal(c.scope,'wms.shipment.handover');assert.equal(c.entityId,e.entityId);assert.equal(c.path,'/api/v1/integration/wms/events');assert.equal(c.method,'POST');assert.equal(c.bodyHash,createHash('sha256').update(options.body).digest('hex'));return e;};
        const retry=await deliverOne(f.pool,config,async(_url,o)=>{const e=verify(o);wire=o.body;eventId=e.eventId;throw Error('timeout after receiving');});assert.equal(retry.status,'retry');
        await f.db.query("UPDATE corely_handover_outbox SET next_attempt_at=NOW()-INTERVAL '1 day' WHERE event_id=$1",[eventId]);
        const ok=await deliverOne(f.pool,config,async(_url,o)=>{const e=verify(o);assert.equal(o.body,wire);return {ok:true,status:200,text:async()=>JSON.stringify({accepted:true,eventId:e.eventId,inboxId:'inbox-1',duplicate:true})};});assert.equal(ok.status,'acknowledged');
        const invalid=await deliverOne(f.pool,config,async()=>({ok:true,status:200,text:async()=>JSON.stringify({accepted:true,eventId:'wrong',inboxId:'x',duplicate:false})}));assert.equal(invalid.status,'retry');
        const dbRow=(await f.db.query('SELECT * FROM corely_handover_outbox WHERE event_id=$1',[eventId])).rows[0];assert.equal(dbRow.acknowledgement.duplicate,true);assert.equal(dbRow.attempts,2);
        assert.equal(senderConfig({}),null);assert.throws(()=>senderConfig({...env,WMS_HANDOVER_ERP_URL:'http://other.example/events'}),/CONFIG/);
    });
    await t.test('a crashed sender lease is recoverable; 409 is visible and manually retryable',async()=>{
        await f.db.query("UPDATE corely_handover_outbox SET status='sending',locked_until=NOW()-INTERVAL '1 minute',next_attempt_at=NOW()-INTERVAL '1 day' WHERE event_id=$1",[first.eventId]);
        const keys=generateKeyPairSync('rsa',{modulusLength:2048});const config={url:'https://erp.example/api/v1/integration/wms/events',key:keys.privateKey,issuer:'wms',audience:'erp'};
        const result=await deliverOne(f.pool,config,async()=>({ok:false,status:409}));assert.equal(result.eventId,first.eventId);assert.equal(result.status,'rejected');
        assert.equal((await service.requestRetry(f.pool,id,first.id,f.user)).status,'retry');
    });
});
