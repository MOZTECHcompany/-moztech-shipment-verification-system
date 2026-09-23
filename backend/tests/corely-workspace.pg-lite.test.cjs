'use strict';
// Disposable in-process PostgreSQL exercises the signed bridge against the
// real WMS claim/scan transactions. It never opens a cloud database.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://127.0.0.1:1/workspace_unused';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { generateKeyPairSync } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { hash, dispatch } = require('../src/services/corelyNativeIntake');
const { createScanOrder } = require('../src/routes/orderRoutes');
const { createCorelyWorkspaceReadRouter,createCorelyWorkspaceCommandRouter } = require('../src/routes/corelyWorkspaceRoutes');

test('Corely signed workspace uses the native WMS queue, claim and scan receipts exactly once', {timeout:30000}, async t => {
    const db = new PGlite(); let server;
    t.after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));await db.close();});
    for (const name of readdirSync(join(__dirname,'../migrations')).filter(n=>/^\d{3}.*\.sql$/.test(n)&&!n.startsWith('027_')).sort())
        await db.exec(readFileSync(join(__dirname,'../migrations',name),'utf8'));
    let tail=Promise.resolve();
    const pool={ query:(...args)=>db.query(...args), connect:async()=>{
        const previous=tail;let release;tail=new Promise(r=>{release=r;});await previous;
        return {query:(...args)=>db.query(...args),release};
    }};
    const users={};
    for(const role of ['dispatcher','picker','packer']) users[role]=(await db.query('INSERT INTO users(username,password,name,role) VALUES($1,\'unused\',$1,$1) RETURNING id,name,role',[role])).rows[0];
    for(const role of ['picker','packer']) await db.query('INSERT INTO erp_staff_identities(erp_user_id,entity_id,wms_user_id) VALUES($1,\'company\',$2)',
        ['erp-'+role,users[role].id]);
    await db.query("INSERT INTO corely_dispatch_grants(entity_id,erp_actor_id,brand,wms_user_id) VALUES('company','erp-dispatcher','MOZTECH',$1)",[users.dispatcher.id]);
    const source={requestId:'dispatch-1',order:{orderNumber:'SO-1',brand:'MOZTECH',sourceHash:'a'.repeat(64),items:[
        {id:'line-1',productId:'product-1',sku:'SKU',name:'Product',barcode:'1234',quantity:1,tracked:false,serials:[]},
        {id:'line-2',productId:'product-1',sku:'SKU',name:'Product second source',barcode:'1234',quantity:1,tracked:false,serials:[]}
    ],reservationReference:{salesOrderId:'sale-1',warehouseId:'warehouse-1',quantitiesByProduct:[{productId:'product-1',quantity:2}]}}};
    const accepted=await dispatch(pool,{entityId:'company',actorId:'erp-dispatcher',station:'dispatch'},'sale-1',source);
    await db.query('UPDATE corely_native_intakes SET prepick_completed_at=NOW() WHERE id=$1',[accepted.nativeIntakeId]);
    await db.query('UPDATE orders SET warehouse_hold=FALSE WHERE id=$1',[accepted.wmsOrderId]);

    const keys=generateKeyPairSync('rsa',{modulusLength:2048});
    const env={ERP_WORKSPACE_READ_ENABLED:'true',ERP_WORKSPACE_COMMANDS_ENABLED:'true',
        ERP_WORKSPACE_PUBLIC_KEY:keys.publicKey.export({type:'spki',format:'pem'}).toString(),
        ERP_WORKSPACE_ISSUER:'erp-test',ERP_WORKSPACE_AUDIENCE:'wms-test'};
    const app=express();app.use(express.json());app.set('io',null);
    app.use('/api/integrations/erp/v1',createCorelyWorkspaceReadRouter({pool,env}));
    app.use('/api/integrations/erp/workflow/v1',createCorelyWorkspaceCommandRouter({pool,env,scanHandler:createScanOrder(pool)}));
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const sign=(actor,station,scope,extra={})=>jwt.sign({entityId:'company',station,scope,...extra},keys.privateKey,
        {algorithm:'RS256',issuer:'erp-test',audience:'wms-test',subject:actor,expiresIn:45});
    const paths={read:'/api/integrations/erp/v1/orders',detail:'/api/integrations/erp/workflow/v1/orders/sale-1'};
    const getList=station=>request(server).get(paths.read+'?view=all&page=1&pageSize=25').set('Authorization','Bearer '+sign('erp-'+(station==='pick'?'picker':'packer'),station,'wms.workspace.read'));
    const getDetail=station=>request(server).get(paths.detail).set('Authorization','Bearer '+sign('erp-'+(station==='pick'?'picker':'packer'),station,
        'wms.workspace.command',{method:'GET',path:'/orders/sale-1',bodyHash:hash({})}));
    const post=(station,kind,body)=>request(server).post(paths.detail+'/'+station+'/'+kind).set('Authorization','Bearer '+sign('erp-'+(station==='pick'?'picker':'packer'),station,
        'wms.workspace.command',{method:'POST',path:'/orders/sale-1/'+station+'/'+kind,bodyHash:hash(body)})).send(body);
    const ok=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.body));return r.body;};
    assert.deepEqual(ok(await getList('pick')).readyKeys,['sale-1']);
    assert.equal(ok(await getList('pack')).total,0);
    const initial=ok(await getDetail('pick'));
    assert.deepEqual(initial.allowedActions,['pick:claim']);
    const claimBody={entityId:'company',expectedRevision:initial.revision,requestId:'claim-1'};
    const claimed=ok(await post('pick','claim',claimBody));
    assert.equal(claimed.state,'picking');
    ok(await post('pick','claim',claimBody));
    assert.equal((await db.query('SELECT count(*)::int n FROM wms_claim_commands')).rows[0].n,1);
    const ambiguous={entityId:'company',expectedRevision:claimed.revision,requestId:'scan-ambiguous',scanValue:'1234'};
    ok(await post('pick','scan',ambiguous),409);
    assert.equal((await db.query('SELECT sum(picked_quantity)::int n FROM order_items WHERE order_id=$1',[accepted.wmsOrderId])).rows[0].n,0);
    const scanBody={entityId:'company',expectedRevision:claimed.revision,requestId:'scan-1',scanValue:'1234',itemId:'line-1'};
    const firstPick=ok(await post('pick','scan',scanBody));
    assert.equal(firstPick.state,'picking');assert.equal(firstPick.picked,1);
    ok(await post('pick','scan',scanBody));
    assert.equal((await db.query('SELECT count(*)::int n FROM wms_scan_commands')).rows[0].n,1);
    ok(await post('pick','scan',{...scanBody,itemId:'line-2'}),409);
    const picked=ok(await post('pick','scan',{entityId:'company',expectedRevision:firstPick.revision,
        requestId:'scan-2',scanValue:'1234',itemId:'line-2'}));
    assert.equal(picked.state,'picked');assert.equal(picked.picked,2);
    assert.equal(ok(await getList('pick')).total,0);
    assert.deepEqual(ok(await getList('pack')).readyKeys,['sale-1']);
    const pack=ok(await getDetail('pack'));
    assert.deepEqual(pack.allowedActions,['pack:claim']);
    const packClaim=ok(await post('pack','claim',{entityId:'company',expectedRevision:pack.revision,requestId:'claim-2'}));
    const firstPack=ok(await post('pack','scan',{entityId:'company',expectedRevision:packClaim.revision,
        requestId:'scan-3',scanValue:'1234',itemId:'line-1'}));
    assert.equal(firstPack.state,'packing');assert.equal(firstPack.packed,1);
    const packed=ok(await post('pack','scan',{entityId:'company',expectedRevision:firstPack.revision,
        requestId:'scan-4',scanValue:'1234',itemId:'line-2'}));
    assert.equal(packed.state,'completed');assert.equal(packed.packed,2);
    const quantities=(await db.query('SELECT source_line_id,picked_quantity,packed_quantity FROM order_items WHERE order_id=$1 ORDER BY source_line_id',[accepted.wmsOrderId])).rows;
    assert.deepEqual(quantities.map(row=>[row.source_line_id,row.picked_quantity,row.packed_quantity]),[['line-1',1,1],['line-2',1,1]]);
});
