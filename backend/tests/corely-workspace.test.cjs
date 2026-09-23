'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { generateKeyPairSync } = require('node:crypto');
const { createCorelyWorkspaceReadRouter, createCorelyWorkspaceCommandRouter } = require('../src/routes/corelyWorkspaceRoutes');
const { hash } = require('../src/services/corelyNativeIntake');
const { stateToken } = require('../src/services/scanSnapshot');

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const env = { ERP_WORKSPACE_READ_ENABLED:'true', ERP_WORKSPACE_COMMANDS_ENABLED:'true',
    ERP_WORKSPACE_PUBLIC_KEY:keys.publicKey.export({type:'spki',format:'pem'}).toString(),
    ERP_WORKSPACE_ISSUER:'erp-test', ERP_WORKSPACE_AUDIENCE:'wms-test' };
const sign = (scope='wms.workspace.read', station='pick', extra={}, actor='erp-7', entity='company') => jwt.sign(
    { entityId:entity, station, scope, ...extra }, keys.privateKey, { algorithm:'RS256', issuer:'erp-test', audience:'wms-test', subject:actor, expiresIn:45 });
const auth = token => ({ Authorization:`Bearer ${token}` });

function fixture() {
    const order = { id:8,voucher_number:'WT0123456789ABCDEF01',work_barcode:'WT0123456789ABCDEF01',
        status:'pending',warehouse_hold:false,picker_id:null,packer_id:null,updated_at:new Date('2026-09-24T00:00:00Z') };
    const item = { id:11,order_id:8,source_line_id:'line-1',product_code:'SKU',product_name:'Item',barcode:'1234',
        quantity:1,picked_quantity:0,packed_quantity:0 };
    const source = { id:2,entity_id:'company',erp_order_id:'sale-1',order_id:8,import_batch_id:3,
        reservation_accepted:true,payload:{orderNumber:'SO-1',brand:'MOZTECH',items:[]} };
    const calls=[];
    const state={order,item,source,user:{id:7,name:'Picker',role:'picker'},calls,claimReceipt:null,scanReceipt:null};
    const pool={ async query(sql,params=[]) {
        calls.push({sql,params});
        if(sql.includes('FROM erp_staff_identities e JOIN users u')) return {rows:params[0]==='erp-7'&&params[1]==='company'?[state.user]:[]};
        if(sql.includes('SELECT i.* FROM corely_native_intakes i WHERE')) return {rows:params[0]==='company'&&params[1]==='sale-1'?[source]:[]};
        if(sql.startsWith('SELECT * FROM orders WHERE')) return {rows:[{...order}]};
        if(sql.startsWith('SELECT * FROM order_items WHERE')) return {rows:[{...item}]};
        if(sql.startsWith('SELECT s.* FROM order_item_instances') || sql.startsWith('SELECT i.* FROM order_item_instances')) return {rows:[]};
        if(sql.includes('SELECT o.*,p.name AS picker_name')) return {rows:[{...order,picker_name:order.picker_id===7?'Picker':null,packer_name:order.packer_id===7?'Picker':null}]};
        if(sql.startsWith('SELECT type FROM order_exceptions')) return {rows:[]};
        if(sql.startsWith('SELECT 1 FROM corely_dispatch_grants')) return {rows:[]};
        if(sql.startsWith('SELECT 1 FROM wms_scan_commands')) return {rows:[]};
        if(sql.startsWith('SELECT 1 FROM wms_claim_commands')) return {rows:[]};
        if(sql.includes('SELECT order_id,response FROM wms_claim_commands')) return {rows:state.claimReceipt?[state.claimReceipt]:[]};
        if(sql.includes('SELECT order_id,response FROM wms_scan_commands')) return {rows:state.scanReceipt?[state.scanReceipt]:[]};
        if(sql.startsWith('SELECT work_barcode FROM orders')) return {rows:[{work_barcode:order.work_barcode}]};
        if(sql.includes('count(*)::int AS total')) {
            const station=params[2],view=params[4];
            return {rows:[{total:view==='all'&&station==='pick'&&order.status==='picked'?0:1}]};
        }
        if(sql.includes('SELECT i.erp_order_id,i.payload,o.status')) {
            const station=params[2];
            return {rows:station==='pick'&&order.status==='picked'?[]:[{erp_order_id:'sale-1',payload:source.payload,status:order.status,
                warehouse_hold:order.warehouse_hold,updated_at:order.updated_at,picker_name:null,packer_name:null,
                required:1,picked:item.picked_quantity,packed:item.packed_quantity}]};
        }
        if(sql.includes('SELECT i.erp_order_id FROM corely_native_intakes')) return {rows:params[1]==='pick'&&order.status==='picked'?[]:[{erp_order_id:'sale-1'}]};
        throw Error('Unexpected SQL: '+sql);
    }};
    return {state,pool};
}
function appFor(pool, handlers={}) {
    const app=express(); app.use(express.json());
    app.use('/api/integrations/erp/v1',createCorelyWorkspaceReadRouter({pool,env}));
    const unused=async(_req,res)=>res.status(503).json({code:'UNEXPECTED_NATIVE_HANDLER'});
    app.use('/api/integrations/erp/workflow/v1',createCorelyWorkspaceCommandRouter({pool,env,scanHandler:unused,claimHandler:unused,...handlers}));
    return app;
}
const readPath='/api/integrations/erp/v1/orders';
const workflow='/api/integrations/erp/workflow/v1/orders/sale-1';
const detailToken = () => sign('wms.workspace.command','pick',
    {method:'GET',path:'/orders/sale-1',bodyHash:hash({})});

test('signed read is scoped to the mapped ERP actor and returns a whole-queue ready key', async()=>{
    const {pool,state}=fixture(),app=appFor(pool);
    assert.equal((await request(app).get(readPath)).status,401);
    assert.equal((await request(app).get(readPath).set(auth(sign('wms.workspace.read','pick',{},'other')))).status,403);
    const page=await request(app).get(readPath+'?view=all&page=1&pageSize=25').set(auth(sign()));
    assert.equal(page.status,200,JSON.stringify({body:page.body,calls:state.calls}));
    assert.equal(page.body.contractVersion,'wms.workspace-read.v1');
    assert.equal(page.body.total,1);
    assert.deepEqual(page.body.readyKeys,['sale-1']);
    assert.equal(page.body.items[0].id,'sale-1');
    assert.equal((await request(app).get(readPath+'/sale-1').set(auth(sign('wms.workspace.read','pick',{},'erp-7','other-company')))).status,403);
});

test('command detail only accepts the command scope and limits actions to the native owner', async()=>{
    const {pool,state}=fixture(),app=appFor(pool);
    assert.equal((await request(app).get(workflow).set(auth(sign()))).status,401);
    const detail=await request(app).get(workflow).set(auth(detailToken()));
    assert.equal(detail.status,200);
    assert.equal(detail.body.contractVersion,'wms.workspace-command.v1');
    assert.deepEqual(detail.body.allowedActions,['pick:claim']);
    assert.ok(Number.isSafeInteger(detail.body.revision) && detail.body.revision>0);
    state.order.picker_id=9;state.order.status='picking';
    const owned=await request(app).get(workflow).set(auth(detailToken()));
    assert.deepEqual(owned.body.allowedActions,[]);
    assert.ok(owned.body.blockers.includes('已由其他人員認領'));
});

test('signed claim and scan use the native handlers, revision checks, and stage-specific routes', async()=>{
    const {pool,state}=fixture();
    let claims=0,scans=0;
    const claimHandler=async(req,res)=>{
        claims++;
        assert.equal(req.user.id,7);
        assert.equal(req.body.stage,'pick');
        assert.equal(req.body.barcode,state.order.work_barcode);
        assert.match(req.body.commandId,/^[0-9a-f-]{36}$/);
        await req.workspaceGuard(pool,8);
        state.order.status='picking';state.order.picker_id=7;state.order.updated_at=new Date('2026-09-24T00:01:00Z');
        res.json({outcome:'claimed'});
    };
    const scanHandler=async(req,res)=>{
        scans++;
        assert.equal(req.user.id,7);
        assert.equal(req.body.type,'pick');
        assert.equal(req.body.orderId,8);
        assert.equal(req.body.scanValue,'1234');
        assert.equal(req.body.expectedState,stateToken(state.order,[state.item],[]));
        await req.workspaceGuard(pool,8);
        state.item.picked_quantity=1;state.order.status='picked';state.order.updated_at=new Date('2026-09-24T00:02:00Z');
        res.json({format:'delta-v1'});
    };
    const app=appFor(pool,{claimHandler,scanHandler});
    const start=(await request(app).get(workflow).set(auth(detailToken()))).body;
    const body={entityId:'company',expectedRevision:start.revision,requestId:'request-1'};
    const path='/orders/sale-1/pick/claim';
    const wrong=await request(app).post(workflow+'/pick/claim').set(auth(sign('wms.workspace.command','pick',
        {method:'POST',path,bodyHash:'0'.repeat(64)}))).send(body);
    assert.equal(wrong.status,401);assert.equal(claims,0);
    const stale=await request(app).post(workflow+'/pick/claim').set(auth(sign('wms.workspace.command','pick',
        {method:'POST',path,bodyHash:hash({...body,expectedRevision:1})}))).send({...body,expectedRevision:1});
    assert.equal(stale.status,409);assert.equal(claims,0);
    const claimed=await request(app).post(workflow+'/pick/claim').set(auth(sign('wms.workspace.command','pick',
        {method:'POST',path,bodyHash:hash(body)}))).send(body);
    assert.equal(claimed.status,200,JSON.stringify({body:claimed.body,calls:state.calls}));assert.equal(claims,1);
    assert.deepEqual(claimed.body.allowedActions,['pick:claim','pick:scan']);
    const scanBody={entityId:'company',expectedRevision:claimed.body.revision,requestId:'request-2',scanValue:'1234'};
    const scanPath='/orders/sale-1/pick/scan';
    const scanned=await request(app).post(workflow+'/pick/scan').set(auth(sign('wms.workspace.command','pick',
        {method:'POST',path:scanPath,bodyHash:hash(scanBody)}))).send(scanBody);
    assert.equal(scanned.status,200);assert.equal(scans,1);
    assert.equal(scanned.body.state,'picked');assert.equal(scanned.body.picked,1);
    const queue=await request(app).get(readPath+'?view=all').set(auth(sign()));
    assert.equal(queue.body.total,0);assert.deepEqual(queue.body.readyKeys,[]);
});
