const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createCartonFixture } = require('./cartonFixture.cjs');
const { guardUnitScan, assertNoCartonAllocations } = require('../src/services/cartonGuards');
const { applyOrderChangeProposal } = require('../src/services/orderChangeService');
const { choosePickLines, matchesItem } = require('../src/services/cartonContents');
const { assertSchemaReady } = require('../src/config/schemaReadiness');

async function suite(t, postgres) {
    const f = await createCartonFixture({ postgres });
    t.after(() => f.close());
    const server = await new Promise(resolve => { const http=f.app.listen(0, '127.0.0.1', () => resolve(http)); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const api = (user, method, path, body) => {
        const call = request(server)[method](path);
        if (user) call.set('x-fixture-user', String(user));
        const boundBody = body !== undefined && user ? { ...body, expectedActorId: body.expectedActorId ?? Number(user) } : body;
        return boundBody === undefined ? call : call.send(boundBody);
    };
    const ok = (response, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.body)); return response.body; };
    const box = (cartonId, quantity = 10, actualSN = [], extra = {}) => ({ cartonId, seal: true,
        lines: [{ itemCode: 'ITEM', ean: '4710000000010', quantity, actualSN, ...extra }] });
    const create = async body => ok(await api(1, 'post', '/api/cartons', body), 201);
    const preview = async (id, input, user = 2) => ok(await api(user, 'post', `/api/orders/${id}/carton-preview`, input));
    const scanBody = (data, input) => ({ ...input, commandId: randomUUID(), expectedState: data.expectedState, expectedCartonRevision: data.expectedCartonRevision, expectedActorId: data.expectedActorId });
    const claim = async (id, type, user) => {
        f.attachLegacyRoutes();
        return ok(await api(user, 'post', `/api/orders/${id}/claim`, { stage: type }));
    };
    const cartonUnit = (cartonId, type = 'pick', scanValue = '4710000000010', orderItemId) =>
        ({ cartonId, type, mode: 'unit', scanValue, ...(orderItemId === undefined ? {} : { orderItemId }) });
    const scan = async (id, input, user = 2) => {
        const current = (await f.db.query('SELECT status FROM orders WHERE id=$1', [id])).rows[0];
        if (input.type === 'pack' && current.status === 'picked') await claim(id, 'pack', user);
        const body = scanBody(await preview(id, input, user), input);
        return ok(await api(user, 'post', `/api/orders/${id}/carton-scan`, body));
    };

    await t.test('empty additive migration is ready and retains legacy foundations', async () => {
        await assertSchemaReady(f.pool);
        assert.equal((await f.db.query('SELECT COUNT(*)::int AS n FROM orders')).rows[0].n, 0);
    });
    await t.test('HTTP rechecks DB role: every manager scope can manage cartons and warehouse staff cannot', async () => {
        assert.equal((await api(null, 'get', '/api/cartons')).status, 401);
        assert.equal((await api(2, 'post', '/api/cartons', box('NO-PICKER'))).status, 403);
        for (const actor of [3,4]) assert.equal((await api(actor, 'post', '/api/cartons', box('NO-STAFF-'+actor))).status, 403);
        for (const actor of [1,5,7,8]) {
            const carton = ok(await api(actor, 'post', '/api/cartons', box('MANAGER-'+actor)),201);
            assert.equal(carton.status,'sealed');
            assert.equal(ok(await api(actor,'get','/api/carton-items?q=Fixture')).items.length,0);
        }
        await assert.rejects(f.service.create(box('FORGED-PICKER'), { id: 2, role: 'superadmin' }), error => error.status === 403);
        assert.equal((await f.db.query('SELECT COUNT(*)::int AS n FROM wms_cartons')).rows[0].n, 4);
    });
    await t.test('the same worker explicitly claims both stages, carton pack never auto-claims, and actor responsibility is immutable', async () => {
        const carton = await create(box('SAME-WORKER', 2));
        const { order } = await f.seedOrder({ quantity: 2, packerId: null });
        const picked = await scan(order.id, { scanValue: carton.cartonId, type: 'pick' }, 2);
        const input = { scanValue: carton.cartonId, type: 'pack', expectedActorId: 2 };
        const unclaimed = await api(2, 'post', `/api/orders/${order.id}/carton-preview`, input);
        assert.equal(unclaimed.status, 409); assert.match(unclaimed.body.message, /先認領裝箱/);
        const savedOrder = (await f.db.query('SELECT * FROM orders WHERE id=$1', [order.id])).rows[0];
        assert.equal(savedOrder.status, 'picked'); assert.equal(savedOrder.packer_id, null);
        assert.equal(ok(await api(2, 'get', `/api/cartons/${carton.cartonId}`)).stateRevision, picked.carton.stateRevision);
        await claim(order.id, 'pack', 2);
        const packed = await scan(order.id, input, 2);
        assert.equal(packed.order.status, 'completed'); assert.equal(packed.order.packer_id, 2);
        assert.equal(packed.carton.lines[0].remainingQuantity, 0);
        const logs = (await f.db.query("SELECT action_type,actor_snapshot,work_type,details::jsonb AS details FROM operation_logs WHERE order_id=$1 AND action_type IN ('pick','pack') ORDER BY id", [order.id])).rows;
        assert.deepEqual(logs.map(log => log.work_type), ['pick','pack']);
        assert.ok(logs.every(log => log.actor_snapshot.id === 2 && log.actor_snapshot.role === 'picker' && log.actor_snapshot.name === 'Fixture Picker' && log.details.operation_context === 'owner'));
        await f.db.query("UPDATE users SET name='Changed worker name' WHERE id=2");
        assert.equal((await f.db.query("SELECT actor_snapshot->>'name' AS name FROM operation_logs WHERE order_id=$1 AND action_type='pack'", [order.id])).rows[0].name, 'Fixture Picker');
        await f.db.query("UPDATE users SET name='Fixture Picker' WHERE id=2");
    });
    await t.test('fresh explicit work overrides and pauses block both preview and scan without changing carton contents or receipts', async () => {
        const carton = await create(box('WORK-GUARD', 1));
        const { order } = await f.seedOrder({ quantity: 1 });
        const input = { scanValue: carton.cartonId, type: 'pick', expectedActorId: 2 };
        const command = scanBody(await preview(order.id, input), input);
        await f.db.query('UPDATE users SET can_pick=FALSE WHERE id=2');
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-preview`, input)).status, 403);
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-scan`, command)).status, 403);
        await f.db.query('UPDATE users SET can_pick=NULL WHERE id=2');
        f.attachLegacyRoutes();
        ok(await api(2, 'post', `/api/orders/${order.id}/work-pause`, { stage: 'pick' }));
        const paused = await api(2, 'post', `/api/orders/${order.id}/carton-preview`, input);
        assert.equal(paused.status, 409); assert.match(paused.body.message, /已暫停/);
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-scan`, command)).body.code, 'STATE_CHANGED');
        assert.equal((await f.db.query('SELECT COUNT(*)::int AS n FROM wms_scan_commands WHERE command_id=$1', [command.commandId])).rows[0].n, 0);
        assert.equal(ok(await api(2, 'get', `/api/cartons/${carton.cartonId}`)).lines[0].remainingQuantity, 1);
        ok(await api(2, 'post', `/api/orders/${order.id}/work-resume`, { stage: 'pick' }));
        const picked = await scan(order.id, input);
        await claim(order.id, 'pack', 2);
        ok(await api(2, 'post', `/api/orders/${order.id}/work-pause`, { stage: 'pack' }));
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-preview`, { ...input, type: 'pack' })).status, 409);
        ok(await api(2, 'post', `/api/orders/${order.id}/work-resume`, { stage: 'pack' }));
        await f.db.query('UPDATE users SET can_pack=FALSE WHERE id=2');
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-preview`, { ...input, type: 'pack' })).status, 403);
        assert.equal(ok(await api(2, 'get', `/api/cartons/${carton.cartonId}`)).stateRevision, picked.carton.stateRevision);
        await f.db.query('UPDATE users SET can_pack=NULL WHERE id=2');
        await scan(order.id, { ...input, type: 'pack' });
    });
    await t.test('order administration scope can manage cartons while scan work capabilities and responsibility stay independent', async () => {
        const carton = await create(box('ORDER-ADMIN-WORK', 1));
        const { order } = await f.seedOrder({ quantity: 1 });
        await f.db.query('UPDATE users SET can_pick=TRUE,can_pack=FALSE WHERE id=5');
        const picked = await scan(order.id, { scanValue: carton.cartonId, type: 'pick' }, 5);
        assert.equal(picked.order.picker_id, 2); assert.equal(picked.allocation.pickedBy, 5);
        const log = (await f.db.query("SELECT actor_snapshot,work_type,details::jsonb AS details FROM operation_logs WHERE order_id=$1 AND action_type='pick'", [order.id])).rows[0];
        assert.equal(log.actor_snapshot.management_scope, 'orders'); assert.equal(log.work_type, 'pick');
        assert.equal(log.details.operation_context, 'assistance');
        assert.equal((await api(5, 'post', '/api/cartons', box('ORDER-ADMIN-CAN-EDIT'))).status, 201);
        assert.equal((await api(5, 'post', `/api/orders/${order.id}/carton-preview`, { scanValue: carton.cartonId, type: 'pack' })).status, 403);
        await f.db.query('UPDATE users SET can_pick=NULL,can_pack=NULL WHERE id=5');
    });
    await t.test('three unique physical boxes verify a five-unit tail plus two ten-unit boxes for a twenty-five-unit shipment without duplicate deduction', async () => {
        const cartons = [];
        for (const suffix of ['A','B','C']) cartons.push(await create(box('TAIL-25-'+suffix,10)));
        const first = await f.seedOrder({ quantity:5,packerId:null });
        let split;
        for (let i=0;i<5;i++) split=await scan(first.order.id,cartonUnit(cartons[0].cartonId));
        assert.equal(split.order.status,'picked');
        for (let i=0;i<5;i++) await scan(first.order.id,cartonUnit(cartons[0].cartonId,'pack'),2);
        assert.equal(ok(await api(1,'get','/api/cartons/'+cartons[0].cartonId)).lines[0].remainingQuantity,5);
        const second = await f.seedOrder({ quantity:25,packerId:null });
        for (const [index,carton] of cartons.entries()) {
            let picked;
            if (index===0) for (let i=0;i<5;i++) picked=await scan(second.order.id,cartonUnit(carton.cartonId));
            else picked=await scan(second.order.id,{scanValue:carton.cartonId,type:'pick'},2);
            assert.equal(picked.allocation.lines.reduce((sum,line)=>sum+line.quantity,0),index === 0 ? 5 : 10);
            assert.equal(picked.items[0].picked_quantity,[5,15,25][index]);
            if (index === 0) {
                const duplicate = await api(2,'post',`/api/orders/${second.order.id}/carton-preview`,{scanValue:carton.cartonId,type:'pick'});
                assert.equal(duplicate.status,409);
                const freshCarton = ok(await api(1,'get','/api/cartons/'+carton.cartonId));
                const retry = await api(2,'post',`/api/orders/${second.order.id}/carton-scan`,{scanValue:carton.cartonId,type:'pick',commandId:randomUUID(),expectedState:picked.stateToken,expectedCartonRevision:freshCarton.stateRevision});
                assert.equal(retry.status,409);
                assert.equal((await f.db.query('SELECT picked_quantity FROM order_items WHERE order_id=$1',[second.order.id])).rows[0].picked_quantity,5);
            }
        }
        for (const [index,carton] of cartons.entries()) {
            let packed;
            if (index===0) for(let i=0;i<5;i++) packed=await scan(second.order.id,cartonUnit(carton.cartonId,'pack'),2);
            else packed=await scan(second.order.id,{scanValue:carton.cartonId,type:'pack'},2);
            assert.equal(packed.items[0].packed_quantity,[5,15,25][index]);
            assert.equal(packed.order.status,index === 2 ? 'completed' : 'packing');
        }
        const references = ok(await api(1,'get',`/api/orders/${second.order.id}/carton-shipments`));
        assert.equal(references.allocations.length,3);assert.ok(references.allocations.every(row=>row.status==='packed'));
        for(const carton of cartons)assert.equal(ok(await api(1,'get','/api/cartons/'+carton.cartonId)).lines[0].remainingQuantity,0);
        assert.equal((await f.db.query("SELECT COUNT(*)::int AS n FROM wms_carton_allocations WHERE carton_id=$1 AND status='packed'",[cartons[0].cartonId])).rows[0].n,2,'The tail carton has two distinct real-order custody allocations');
        const logs=(await f.db.query("SELECT actor_snapshot,work_type,details::jsonb AS details FROM operation_logs WHERE order_id=$1 AND action_type IN ('pick','pack') ORDER BY id",[second.order.id])).rows;
        assert.deepEqual(logs.map(row=>row.work_type),[...Array(7).fill('pick'),...Array(7).fill('pack')]);assert.ok(logs.every(row=>row.actor_snapshot.id===2&&row.actor_snapshot.role==='picker'));
    });
    await t.test('an unused sealed box reopens only with a reason and current revisions without changing its identity or exact contents', async () => {
        const before=await create(box('REOPEN-UNUSED',2,['000Ab/01','000ab+02']));
        const input={expectedContentRevision:before.contentRevision,expectedStateRevision:before.stateRevision};
        assert.equal((await api(5,'post','/api/cartons/REOPEN-UNUSED/reopen',input)).status,400);
        assert.equal((await api(2,'post','/api/cartons/REOPEN-UNUSED/reopen',{...input,reason:'Unauthorized'})).status,403);
        assert.equal((await api(5,'post','/api/cartons/REOPEN-UNUSED/reopen',{...input,expectedStateRevision:before.stateRevision+1,reason:'Stale'})).status,409);
        assert.equal((await api(5,'patch','/api/cartons/REOPEN-UNUSED',{cartonId:'RENAMED',expectedContentRevision:before.contentRevision,lines:box('unused',2,['000Ab/01','000ab+02']).lines})).status,409);
        const reopened=ok(await api(5,'post','/api/cartons/REOPEN-UNUSED/reopen',{...input,reason:'Physical count corrected'}));
        assert.equal(reopened.cartonId,before.cartonId);assert.equal(reopened.status,'draft');assert.equal(reopened.contentRevision,before.contentRevision);assert.equal(reopened.stateRevision,before.stateRevision+1);assert.deepEqual(reopened.lines,before.lines);
        const history=reopened.history.find(row=>row.event_type==='contents_reopened');assert.ok(history);assert.equal(history.actor_id,5);assert.equal(history.details.reason,'Physical count corrected');
        ok(await api(5,'post','/api/cartons/REOPEN-UNUSED/seal',{expectedContentRevision:reopened.contentRevision}));
        const {order}=await f.seedOrder({quantity:2,packerId:null,actualSN:before.lines[0].actualSN,serialMode:'exact'});await scan(order.id,{scanValue:'REOPEN-UNUSED',type:'pick'});
        const current=ok(await api(5,'get','/api/cartons/REOPEN-UNUSED'));
        assert.equal((await api(5,'post','/api/cartons/REOPEN-UNUSED/reopen',{expectedContentRevision:current.contentRevision,expectedStateRevision:current.stateRevision,reason:'Cannot rewrite used custody'})).status,409);
        assert.deepEqual(ok(await api(5,'get','/api/cartons/REOPEN-UNUSED')),current);
    });
    await t.test('authorized staff can read exact SN case, zeros and punctuation while carton writes stay manager-only', async () => {
        const sns=['000Case/01','000case/01','Zero-0002+X'];
        await create(box('SN-LOOKUP-EXACT',3,sns));
        for(const actor of [1,5,7,8]) {
            const exact=ok(await api(actor,'get','/api/cartons/serials?q='+encodeURIComponent(sns[0])+'&match=exact'));
            assert.equal(exact.items.length,1);assert.equal(exact.items[0].serialNumber,sns[0]);assert.equal(exact.items[0].cartonId,'SN-LOOKUP-EXACT');assert.equal(exact.items[0].readyForPicking,true);
        }
        for(const actor of [2,3,4])assert.equal((await api(actor,'get','/api/cartons/serials?q=000Case&match=contains')).status,200);
        assert.equal(ok(await api(5,'get','/api/cartons/serials?q=000CASE%2F01&match=exact')).items.length,0);
        const partial=ok(await api(5,'get','/api/cartons/serials?q=000&match=contains'));assert.ok(partial.items.some(row=>row.serialNumber===sns[0]));assert.ok(partial.items.some(row=>row.serialNumber===sns[1]));
        assert.equal(ok(await api(5,'get','/api/cartons/serials?q=Zero-0002%2BX&match=exact')).items[0].serialNumber,sns[2]);
    });
    await t.test('box specifications create distinct sealed physical cartons atomically, replay the same batch and retain their original contents after a template edit', async () => {
        const spec=ok(await api(5,'post','/api/box-specs',{specId:'SPEC-TEN-PHYSICAL',activate:true,lines:box('ignored',10).lines}),201);
        assert.equal(spec.status,'active');assert.equal(spec.lines[0].quantity,10);assert.equal(Object.hasOwn(spec.lines[0],'actualSN'),false);
        const command={prefix:'N',startNumber:1,count:20,creationId:randomUUID(),expectedContentRevision:spec.contentRevision};
        const created=ok(await api(5,'post','/api/box-specs/'+spec.specId+'/cartons',command),201);
        assert.equal(created.cartons.length,20);assert.deepEqual(created.cartons.map(row=>row.cartonId),Array.from({length:20},(_,i)=>'N'+(i+1)));assert.equal(created.cartons.reduce((sum,row)=>sum+row.lines[0].quantity,0),200);
        for(const carton of created.cartons){assert.equal(carton.status,'sealed');assert.equal(carton.lines[0].quantity,10);assert.equal(carton.lines[0].remainingQuantity,10);assert.equal(carton.sourceSystem,'corely-box-spec');assert.equal(JSON.parse(carton.sourceReference).specId,spec.specId);}
        const replay=ok(await api(5,'post','/api/box-specs/'+spec.specId+'/cartons',command),201);assert.equal(replay.replayed,true);assert.deepEqual(replay.cartons,created.cartons);
        const originalBoxes=created.cartons.map(row=>row.cartonId);
        const next=ok(await api(2,'get','/api/box-specs/next-number?prefix=N'));assert.deepEqual(next,{prefix:'N',nextNumber:21});
        const collision=await api(5,'post','/api/box-specs/'+spec.specId+'/cartons',{...command,creationId:randomUUID()});assert.equal(collision.status,409);assert.equal(collision.body.code,'BOX_SPEC_NUMBER_EXISTS');
        const partlyOverlapping=await api(5,'post','/api/box-specs/'+spec.specId+'/cartons',{...command,startNumber:20,count:2,creationId:randomUUID()});assert.equal(partlyOverlapping.status,409);assert.equal((await api(5,'get','/api/cartons/N21')).status,404);
        const subsequent=ok(await api(5,'post','/api/box-specs/'+spec.specId+'/cartons',{...command,startNumber:21,count:2,creationId:randomUUID()}),201);assert.deepEqual(subsequent.cartons.map(row=>row.cartonId),['N21','N22']);
        assert.equal((await api(5,'post','/api/box-specs/'+spec.specId+'/cartons',{...command,count:2})).status,409);
        for(const count of [0,101,1.5])assert.equal((await api(5,'post','/api/box-specs/'+spec.specId+'/cartons',{...command,creationId:randomUUID(),count})).status,400);
        const {order}=await f.seedOrder({quantity:10,packerId:null});
        assert.equal((await api(2,'post',`/api/orders/${order.id}/carton-preview`,{scanValue:'BOX-SPEC:'+spec.specId,type:'pick'})).status,400);
        f.attachLegacyRoutes();
        const blocked=await api(2,'post','/api/orders/update_item',{orderId:order.id,scanValue:'BOX-SPEC:'+spec.specId,type:'pick'});assert.equal(blocked.status,400);assert.equal(blocked.body.code,'SCAN_NOT_APPLIED');assert.match(blocked.body.message,/箱規不能直接計入出貨數量/);
        await f.db.query('UPDATE order_items SET barcode=$1,product_code=$1 WHERE order_id=$2',['BOX-SPEC:'+spec.specId,order.id]);
        assert.equal((await api(2,'post','/api/orders/update_item',{orderId:order.id,scanValue:'BOX-SPEC:'+spec.specId,type:'pick',amount:10})).status,400);
        assert.equal((await f.db.query('SELECT picked_quantity FROM order_items WHERE order_id=$1',[order.id])).rows[0].picked_quantity,0);
        const renamed=await api(5,'patch','/api/box-specs/'+spec.specId,{specId:'RENAMED',expectedContentRevision:spec.contentRevision,reason:'No replacement ID',lines:box('ignored',12).lines});assert.equal(renamed.status,400);
        assert.equal((await api(5,'patch','/api/box-specs/'+spec.specId,{expectedContentRevision:spec.contentRevision,lines:box('ignored',12).lines})).status,400);
        const edited=ok(await api(5,'patch','/api/box-specs/'+spec.specId,{expectedContentRevision:spec.contentRevision,reason:'Packing specification corrected',lines:box('ignored',12).lines}));assert.equal(edited.specId,spec.specId);assert.equal(edited.status,'draft');assert.equal(edited.contentRevision,spec.contentRevision+1);
        assert.equal((await api(5,'post','/api/box-specs/'+spec.specId+'/cartons',{...command,creationId:randomUUID(),expectedContentRevision:edited.contentRevision})).status,409);
        const history=ok(await api(5,'get','/api/box-specs/'+spec.specId)).history.find(row=>row.event_type==='contents_revised');assert.equal(history.details.reason,'Packing specification corrected');assert.equal(history.details.before[0].quantity,10);assert.equal(history.details.after[0].quantity,12);
        for(const id of originalBoxes)assert.equal(ok(await api(5,'get','/api/cartons/'+id)).lines[0].quantity,10,'A specification correction does not rewrite an existing physical box');
    });
    await t.test('box specification reads remain staff-accessible but all writes recheck real manager identity and never accept actual SN templates', async () => {
        for(const actor of [1,5,7,8]) {
            const spec=ok(await api(actor,'post','/api/box-specs',{specId:'SPEC-MANAGER-'+actor,lines:box('ignored',10).lines}),201);assert.equal(spec.status,'draft');
            ok(await api(actor,'post','/api/box-specs/'+spec.specId+'/activate',{expectedContentRevision:spec.contentRevision}));
        }
        for(const actor of [2,3,4]){
            assert.equal((await api(actor,'get','/api/box-specs')).status,200);
            assert.equal((await api(actor,'get','/api/box-specs/SPEC-MANAGER-1')).status,200);
            assert.equal((await api(actor,'post','/api/box-specs',{specId:'SPEC-STAFF-'+actor,lines:box('ignored',10).lines})).status,403);
            assert.equal((await api(actor,'post','/api/box-specs/SPEC-MANAGER-1/cartons',{prefix:'STAFF',startNumber:1,creationId:randomUUID(),count:1,expectedContentRevision:1})).status,403);
        }
        assert.equal((await api(5,'post','/api/box-specs',{specId:'SPEC-SN-FORBIDDEN',lines:box('ignored',1,['Exact-SN-01']).lines})).status,400);
        await f.db.query("UPDATE users SET role='dispatcher' WHERE id=7");
        try { assert.equal((await api(7,'post','/api/box-specs',{specId:'SPEC-DEMOTED',lines:box('ignored',10).lines})).status,403);await assert.rejects(f.service.create(box('FALSE-ADMIN'),{id:7,role:'superadmin'}),error=>error.status===403); }
        finally { await f.db.query("UPDATE users SET role='admin' WHERE id=7"); }
    });
    await t.test('failed box-spec batch creation leaves no physical boxes or receipt and the original command safely retries', async () => {
        const spec=ok(await api(1,'post','/api/box-specs',{specId:'SPEC-BATCH-ROLLBACK',activate:true,lines:box('ignored',10).lines}),201);
        const before=(await f.db.query('SELECT COUNT(*)::int AS n FROM wms_cartons')).rows[0].n;
        const command={prefix:'R',startNumber:1,count:3,creationId:randomUUID(),expectedContentRevision:spec.contentRevision};let insertCount=0;
        f.failNext(sql=>sql.includes('INSERT INTO wms_carton_lines')&&++insertCount===2);
        assert.equal((await api(1,'post','/api/box-specs/'+spec.specId+'/cartons',command)).status,500);
        assert.equal((await f.db.query('SELECT COUNT(*)::int AS n FROM wms_cartons')).rows[0].n,before);
        assert.equal((await f.db.query('SELECT COUNT(*)::int AS n FROM wms_box_spec_batch_commands WHERE command_id=$1',[command.creationId])).rows[0].n,0);
        const retry=ok(await api(1,'post','/api/box-specs/'+spec.specId+'/cartons',command),201);assert.equal(retry.cartons.length,3);
        const replay=ok(await api(1,'post','/api/box-specs/'+spec.specId+'/cartons',command),201);assert.deepEqual(replay.cartons.map(row=>row.cartonId),retry.cartons.map(row=>row.cartonId));
        assert.equal((await f.db.query('SELECT COUNT(*)::int AS n FROM wms_cartons')).rows[0].n,before+3);
    });
    await t.test('manifest imports draft, inherits batch provenance, replays exact content and does not reset remaining', async () => {
        const manifest = { format: 'corely-cartons-v1', sourceSystem: 'ERP', sourceReference: 'BATCH-1', cartons: [box('MANIFEST')] };
        const first = ok(await api(1, 'post', '/api/cartons/import', manifest));
        assert.equal(first.items[0].carton.status, 'draft');
        assert.equal(first.items[0].carton.sourceSystem, 'ERP');
        assert.equal(first.items[0].carton.sourceReference, 'BATCH-1');
        const replay = ok(await api(1, 'post', '/api/cartons/import', manifest));
        assert.equal(replay.items[0].replayed, true);
        assert.equal(replay.items[0].carton.history.length, 1);
        ok(await api(1, 'post', '/api/cartons/MANIFEST/seal', { expectedContentRevision: 1 }));
        const { order } = await f.seedOrder({ quantity: 3 });
        for (let index = 0; index < 3; index++) await scan(order.id, cartonUnit('MANIFEST'));
        const again = ok(await api(1, 'post', '/api/cartons/import', manifest));
        assert.equal(again.items[0].carton.lines[0].remainingQuantity, 7);
        assert.equal(again.items[0].carton.status, 'sealed');
        const next = { ...manifest, cartons: [box('MANIFEST-2', 2)] };
        assert.equal(ok(await api(1, 'post', '/api/cartons/import', next)).items[0].replayed, false);
    });
    await t.test('batch conflict rolls back earlier new cartons and their history', async () => {
        await create(box('Z-CONFLICT'));
        const response = await api(1, 'post', '/api/cartons/import', { format: 'corely-cartons-v1', cartons: [box('A-ROLLED-BACK'), box('Z-CONFLICT', 9)] });
        assert.equal(response.status, 409);
        assert.equal(response.body.code, 'CARTON_CONTENT_CONFLICT');
        assert.equal((await f.db.query("SELECT COUNT(*)::int AS n FROM wms_cartons WHERE carton_id='A-ROLLED-BACK'")).rows[0].n, 0);
    });
    await t.test('draft revisions preserve history, reject stale edits and freeze sealed contents', async () => {
        await create({ ...box('REVISION'), seal: false });
        const draft = ok(await api(1, 'patch', '/api/cartons/REVISION', { expectedContentRevision: 1, lines: box('x', 2).lines }));
        assert.equal(draft.contentRevision, 2);
        assert.equal(draft.history.length, 2);
        assert.equal((await api(1, 'patch', '/api/cartons/REVISION', { expectedContentRevision: 1, lines: box('x', 3).lines })).status, 409);
        await api(1, 'post', '/api/cartons/REVISION/seal', { expectedContentRevision: 2 });
        assert.equal((await api(1, 'patch', '/api/cartons/REVISION', { expectedContentRevision: 2, lines: box('x', 3).lines })).body.code, 'CARTON_CONTENT_LOCKED');
        assert.ok(ok(await api(2, 'get', '/api/cartons?q=ITEM')).items.length);
    });
    await t.test('only a warehouse admin can void an unused draft, retaining original SN and rejecting all positive scan paths', async () => {
        const cartonId = 'CTN-SYN-VOID-DRAFT';
        const sns = ['Void-Exact-SN-01', 'Void-Exact-SN-02', 'Void-Exact-SN-03'];
        const manifest = { format: 'corely-cartons-v1', sourceSystem: 'ERP', sourceReference: 'VOID-SOURCE',
            cartons: [box(cartonId, sns.length, sns)] };
        const imported = ok(await api(1, 'post', '/api/cartons/import', manifest)).items[0].carton;
        const path = `/api/cartons/${cartonId}`;
        const request = { reason: 'ERP 退回草稿', expectedContentRevision: imported.contentRevision };
        assert.equal((await api(2, 'post', path + '/void', request)).status, 403);
        assert.equal((await api(5, 'post', path + '/void', request)).status, 403);
        assert.equal((await api(1, 'post', path + '/void', { ...request, reason: ' ' })).status, 400);
        assert.equal((await api(1, 'post', path + '/void', { ...request, expectedActorId: 2 })).body.code, 'CARTON_ACTOR_CHANGED');
        assert.equal((await api(1, 'post', path + '/void', { ...request, expectedContentRevision: 2 })).body.code, 'CARTON_CONTENT_CHANGED');

        f.failAfterNext(sql => sql === 'COMMIT');
        const unknown = await api(1, 'post', path + '/void', request);
        assert.equal(unknown.body.code, 'SCAN_RESULT_UNKNOWN');
        const voided = ok(await api(1, 'post', path + '/void', request));
        assert.equal(voided.status, 'void');
        assert.equal(voided.sourceReference, 'VOID-SOURCE');
        assert.equal(voided.contentRevision, imported.contentRevision);
        assert.equal(voided.stateRevision, imported.stateRevision + 1);
        assert.equal(voided.lines[0].quantity, sns.length);
        assert.equal(voided.lines[0].remainingQuantity, 0);
        assert.deepEqual(voided.lines[0].actualSN, sns);
        assert.deepEqual(voided.lines[0].remainingSN, []);
        assert.deepEqual(voided.history.filter(event => event.event_type === 'voided').map(event =>
            [event.actor_id, event.details.reason]), [[1, request.reason]]);
        assert.equal((await api(1, 'post', path + '/void', { ...request, reason: '另一次作廢' })).body.code, 'CARTON_ALREADY_VOID');
        assert.equal(ok(await api(1, 'post', '/api/cartons/import', manifest)).items[0].carton.status, 'void');
        assert.equal((await api(1, 'post', path + '/seal', request)).body.code, 'CARTON_VOID');
        assert.equal((await api(1, 'post', '/api/cartons', box('CTN-SYN-VOID-DUPLICATE', 1, sns.slice(0, 1)))).body.code, 'CARTON_ID_OR_SN_CONFLICT');

        const { order } = await f.seedOrder({ quantity: sns.length, actualSN: sns, serialMode: 'exact' });
        const orderPath = `/api/orders/${order.id}`;
        const snapshot = ok(await api(2, 'get', orderPath + '/work-snapshot'));
        const whole = { type: 'pick', scanValue: `CARTON:${cartonId}` };
        for (const scanValue of [whole.scanValue, sns.join(','), sns.slice(0, 2).join(',')]) {
            assert.equal((await api(2, 'post', orderPath + '/carton-preview', { ...whole, scanValue, matchSerialSubset: true })).body.code, 'CARTON_VOID');
        }
        assert.equal((await api(2, 'post', orderPath + '/carton-scan', scanBody({
            expectedState: snapshot.stateToken, expectedCartonRevision: voided.stateRevision
        }, whole))).body.code, 'CARTON_VOID');
        const unit = { orderId: order.id, scanValue: sns[0], type: 'pick' };
        assert.equal((await api(2, 'post', '/api/orders/update_item', unit)).body.code, 'CARTON_VOID');
        assert.equal((await api(2, 'post', '/api/orders/update_item', { ...unit, scanValue: sns.join(','),
            selectedSerials: sns.slice(0, 2), responseMode: 'delta-v1', commandId: randomUUID(),
            expectedState: snapshot.stateToken })).body.code, 'CARTON_VOID');
        assert.equal(ok(await api(2, 'get', orderPath + '/work-snapshot')).stateToken, snapshot.stateToken);
    });
    await t.test('a picked SN in a draft and a sealed carton cannot be voided', async () => {
        const draftId = 'CTN-SYN-VOID-USED-SN', sn = 'Used-While-Draft-Exact-SN';
        await create({ ...box(draftId, 1, [sn]), seal: false });
        const { order } = await f.seedOrder({ quantity: 1, actualSN: [sn], serialMode: 'exact' });
        ok(await api(2, 'post', '/api/orders/update_item', { orderId: order.id, scanValue: sn, type: 'pick' }));
        const request = { reason: 'ERP 退回草稿', expectedContentRevision: 1 };
        assert.equal((await api(1, 'post', `/api/cartons/${draftId}/void`, request)).body.code, 'CARTON_SN_OCCUPIED');
        assert.equal(ok(await api(1, 'get', `/api/cartons/${draftId}`)).status, 'draft');

        const sealed = await create(box('CTN-SYN-VOID-SEALED'));
        assert.equal((await api(1, 'post', `/api/cartons/${sealed.cartonId}/void`, request)).body.code, 'CARTON_VOID_DRAFT_ONLY');
    });
    await t.test('draft void and an individual scan contend for the same SN without both succeeding', { skip: !postgres }, async () => {
        const cartonId = 'CTN-SYN-VOID-RACE', sn = 'Racing-Void-SN';
        await create({ ...box(cartonId, 1, [sn]), seal: false });
        const { order } = await f.seedOrder({ quantity: 1, actualSN: [sn], serialMode: 'exact' });
        const [voided, picked] = await Promise.all([
            api(1, 'post', `/api/cartons/${cartonId}/void`, { reason: 'ERP 退回草稿', expectedContentRevision: 1 }),
            api(2, 'post', '/api/orders/update_item', { orderId: order.id, scanValue: sn, type: 'pick' }),
        ]);
        assert.deepEqual([voided.status, picked.status].sort(), [200, 409]);
        if (voided.status === 200) assert.equal(picked.body.code, 'CARTON_VOID');
        else assert.equal(voided.body.code, 'CARTON_SN_OCCUPIED');
        assert.equal(ok(await api(1, 'get', `/api/cartons/${cartonId}`)).status, voided.status === 200 ? 'void' : 'draft');
    });
    await t.test('selected imported drafts confirm together, preserve exact SN/quantity, and replay without duplicate history', async () => {
        const ids = ['BATCH-SEAL-SN', 'BATCH-SEAL-PLAIN', 'BATCH-SEAL-UNSELECTED'];
        const sn = 'Batch-Seal-Exact-SN';
        const imported = ok(await api(1, 'post', '/api/cartons/import', { format: 'corely-cartons-v1',
            cartons: [box(ids[0], 1, [sn]), box(ids[1], 10), box(ids[2], 2)] }));
        assert.equal(imported.items.length, 3);
        assert.ok(imported.items.every(item => item.carton.status === 'draft' && item.carton.contentRevision === 1));
        const command = { cartons: ids.slice(0, 2).map(cartonId => ({ cartonId, expectedContentRevision: 1 })) };
        assert.equal((await api(2, 'post', '/api/cartons/seal-batch', command)).status, 403);
        assert.equal((await api(5, 'post', '/api/cartons/seal-batch', command)).status, 403);
        assert.equal((await api(1, 'post', '/api/cartons/seal-batch', { ...command, expectedActorId: 5 })).body.code, 'CARTON_ACTOR_CHANGED');
        assert.equal((await api(1, 'post', '/api/cartons/seal-batch', { cartons: [command.cartons[0], command.cartons[0]] })).status, 400);
        const confirmed = ok(await api(1, 'post', '/api/cartons/seal-batch', command));
        assert.deepEqual(confirmed.items.map(item => [item.cartonId, item.status, item.stateRevision, item.alreadyConfirmed]),
            ids.slice(0, 2).map(id => [id, 'sealed', 2, false]));
        assert.equal(ok(await api(1, 'get', `/api/cartons/${ids[2]}`)).status, 'draft');
        const plain = ok(await api(1, 'get', `/api/cartons/${ids[1]}`));
        const serial = ok(await api(1, 'get', `/api/cartons/${ids[0]}`));
        assert.equal(plain.lines[0].remainingQuantity, 10);
        assert.deepEqual(serial.lines[0].remainingSN, [sn]);
        assert.equal(serial.history.filter(event => event.event_type === 'sealed' && event.actor_id === 1).length, 1);
        const replay = ok(await api(1, 'post', '/api/cartons/seal-batch', command));
        assert.deepEqual(replay.items, confirmed.items.map(item => ({ ...item, alreadyConfirmed: true })));
        assert.deepEqual(ok(await api(1, 'get', `/api/cartons/${ids[0]}`)), serial);
    });
    await t.test('a later occupied SN or stale revision leaves every selected draft and audit trail untouched', async () => {
        const clearId = 'BATCH-SEAL-A-CLEAR', conflictId = 'BATCH-SEAL-Z-CONFLICT', sn = 'Batch-Seal-Occupied-SN';
        await create({ ...box(clearId, 3), seal: false });
        await create({ ...box(conflictId, 1, [sn]), seal: false });
        const { item } = await f.seedOrder({ quantity: 1, actualSN: [sn] });
        await f.db.query("UPDATE order_item_instances SET status='picked' WHERE order_item_id=$1", [item.id]);
        const command = { cartons: [conflictId, clearId].map(cartonId => ({ cartonId, expectedContentRevision: 1 })) };
        const occupied = await api(1, 'post', '/api/cartons/seal-batch', command);
        assert.equal(occupied.status, 409);
        assert.equal(occupied.body.code, 'CARTON_SN_OCCUPIED');
        assert.match(occupied.body.message, new RegExp(conflictId));
        const assertClearDraft = async () => {
            const current = ok(await api(1, 'get', `/api/cartons/${clearId}`));
            assert.equal(current.status, 'draft');
            assert.equal(current.stateRevision, 1);
            assert.deepEqual(current.history.map(row => row.event_type), ['created']);
        };
        await assertClearDraft();
        ok(await api(1, 'patch', `/api/cartons/${conflictId}`, { expectedContentRevision: 1, lines: box('x', 2).lines }));
        const stale = await api(1, 'post', '/api/cartons/seal-batch', command);
        assert.equal(stale.status, 409);
        assert.equal(stale.body.code, 'CARTON_CONTENT_CHANGED');
        await assertClearDraft();
    });
    await t.test('batch confirmation with a lost commit response can be retried at the original revisions', async () => {
        const ids = ['BATCH-ACK-01', 'BATCH-ACK-02'];
        for (const id of ids) await create({ ...box(id, 1), seal: false });
        const body = { cartons: ids.map(cartonId => ({ cartonId, expectedContentRevision: 1 })) };
        f.failAfterNext(sql => sql === 'COMMIT');
        const unknown = await api(1, 'post', '/api/cartons/seal-batch', body);
        assert.equal(unknown.status, 503);
        assert.match(unknown.body.message, /再次確認同一批箱號/);
        const recovered = ok(await api(1, 'post', '/api/cartons/seal-batch', body));
        assert.ok(recovered.items.every(item => item.status === 'sealed' && item.alreadyConfirmed && item.stateRevision === 2));
        for (const id of ids) assert.equal(ok(await api(1, 'get', `/api/cartons/${id}`)).history.filter(row => row.event_type === 'sealed').length, 1);
    });
    await t.test('10 ordinary units pick once, pack same allocation without deducting remaining twice', async () => {
        await create(box('ORDINARY'));
        const { order } = await f.seedOrder();
        const picked = await scan(order.id, { scanValue: 'CARTON:ORDINARY', type: 'pick' });
        assert.equal(picked.order.status, 'picked'); assert.equal(picked.items[0].picked_quantity, 10);
        assert.equal(picked.carton.lines[0].remainingQuantity, 0);
        const packed = await scan(order.id, { scanValue: 'ORDINARY', type: 'pack' }, 3);
        assert.equal(packed.order.status, 'completed'); assert.equal(packed.items[0].packed_quantity, 10);
        assert.equal(packed.carton.lines[0].remainingQuantity, 0); assert.equal(packed.allocation.status, 'packed');
        assert.equal((await api(3, 'post', `/api/orders/${order.id}/carton-preview`, { scanValue: 'ORDINARY', type: 'pack' })).status, 409);
        await assert.rejects(f.db.query('DELETE FROM orders WHERE id=$1', [order.id]), error => ['23503','23001'].includes(error.code) && error.message.includes('wms_carton_allocations_order_id_fkey'));
        assert.equal(ok(await api(2, 'get', `/api/orders/${order.id}/carton-shipments`)).allocations[0].lines[0].quantity, 10);
    });
    await t.test('legacy freight stays unscanned while physical items complete both warehouse stages', async () => {
        const addFreight = async order => {
            await f.db.query(`INSERT INTO operation_logs(user_id,order_id,action_type,details)
                VALUES(1,$1,'import',$2)`, [order.id, JSON.stringify({ voucherNumber: order.voucher_number })]);
            return (await f.db.query(`INSERT INTO order_items(order_id,product_code,product_name,barcode,quantity)
                VALUES($1,'00001','運費','00001',36) RETURNING id`, [order.id])).rows[0].id;
        };
        const freightCounts = async id => (await f.db.query('SELECT quantity,picked_quantity,packed_quantity FROM order_items WHERE id=$1', [id])).rows[0];
        const snapshot = async (user, orderId) => ok(await api(user, 'get', `/api/orders/${orderId}/work-snapshot`));
        const unitScan = (user, orderId, state, body) => api(user, 'post', '/api/orders/update_item', {
            orderId, responseMode: 'delta-v1', commandId: randomUUID(), expectedState: state.stateToken, ...body
        });

        const { order, item } = await f.seedOrder({ quantity: 1, itemCode: 'FREIGHT-PHYSICAL', barcode: '4710000000040' });
        const freightId = await addFreight(order);
        const picking = await snapshot(2, order.id);
        assert.deepEqual(picking.items.map(row => row.id), [item.id]);
        for (const target of [{}, { orderItemId: freightId }]) {
            const rejected = await unitScan(2, order.id, picking, { scanValue: '00001', type: 'pick', ...target });
            assert.equal(rejected.status, 400);
            assert.match(rejected.body.message, /運費已自動放行/);
        }
        const picked = ok(await unitScan(2, order.id, picking, { scanValue: item.barcode, type: 'pick' }));
        assert.equal(picked.order.status, 'picked');
        assert.equal(picked.item.picked_quantity, 1);
        ok(await api(3, 'post', `/api/orders/${order.id}/claim`, { stage: 'pack' }));
        const packing = await snapshot(3, order.id);
        const packed = ok(await unitScan(3, order.id, packing, { scanValue: item.barcode, type: 'pack' }));
        assert.equal(packed.order.status, 'completed');
        assert.equal(packed.item.packed_quantity, 1);
        assert.deepEqual(await freightCounts(freightId), { quantity: 36, picked_quantity: 0, packed_quantity: 0 });

        const historical = await f.seedOrder({ quantity: 1, status: 'packing' });
        const historicalFreightId = await addFreight(historical.order);
        await f.db.query('UPDATE order_items SET picked_quantity=1,packed_quantity=1 WHERE id=$1', [historical.item.id]);
        const historicalSnapshot = await snapshot(3, historical.order.id);
        assert.equal(historicalSnapshot.freightReconciliationNeeded, true);
        assert.equal(historicalSnapshot.order.status, 'packing');
        assert.equal((await f.db.query('SELECT status FROM orders WHERE id=$1', [historical.order.id])).rows[0].status, 'packing');
        const reconciled = ok(await api(3, 'get', `/api/orders/${historical.order.id}`));
        assert.equal(reconciled.order.status, 'completed');
        assert.deepEqual(await freightCounts(historicalFreightId), { quantity: 36, picked_quantity: 0, packed_quantity: 0 });

        const xlsx = require('xlsx');
        const book = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet([
            ['憑證號碼：TEST-FREIGHT-EXPLICIT-BARCODE'],
            ['國際條碼', '品項名稱', '數量', '摘要'],
            ['00001', '運費', 1, '']
        ]), '理貨');
        const imported = ok(await request(server).post('/api/orders/import').set('x-fixture-user', '1')
            .attach('orderFile', xlsx.write(book, { type: 'buffer', bookType: 'xlsx' }), 'explicit-barcode.xlsx'), 201);
        const explicit = await snapshot(2, imported.orderId);
        assert.deepEqual(explicit.items.map(row => [row.barcode, row.quantity]), [['00001', 1]]);
        await f.db.query("DELETE FROM operation_logs WHERE order_id=$1 AND action_type='import'", [imported.orderId]);
        assert.deepEqual((await snapshot(2, imported.orderId)).items, explicit.items);
    });
    await t.test('no EAN and newly assigned ITM code use confirmed item identity, while wrong product/EAN never matches', async () => {
        const { order } = await f.seedOrder({ quantity: 2, itemCode: 'NO-EAN', barcode: null });
        await create(box('INTERNAL', 2, [], { itemCode: 'NO-EAN', ean: null, internalScanCode: 'ITM-SOURCE-SKU' }));
        assert.equal((await scan(order.id, { scanValue: 'INTERNAL', type: 'pick' })).items[0].picked_quantity, 2);
        const line = { itemCode: 'P', ean: null, internalScanCode: 'ITM-P' };
        assert.equal(matchesItem(line, { product_code: 'P', code_type: 'international', international_barcode: 'REAL' }), false);
        assert.equal(matchesItem(line, { product_code: 'P', code_type: 'internal', internal_scan_code: 'OTHER' }), false);
        assert.equal(matchesItem({ ...line, ean: 'WRONG' }, { product_code: 'P', barcode: 'REAL' }), false);
        assert.equal(matchesItem(line, { product_code: 'OTHER' }), false);
    });
    await t.test('a 6-of-40 legacy sticker is blocked, explicit repeats append, and each SN packs once', async () => {
        const sns = Array.from({ length: 40 }, (_, index) => `Source-SN-${String(index + 1).padStart(2, '0')}`);
        const selected = sns.slice(0, 6);
        const barcode = '4711299271052';
        const carton = await create(box('CTN-SYN-MOA11', 40, sns, { itemCode: 'MOA11', ean: barcode }));
        const other = await create(box('CTN-SYN-OTHER', 1, ['Other-Source-SN']));
        const { order, item } = await f.seedOrder({ quantity: 6, itemCode: '測試-不出貨', barcode, actualSN: selected, serialMode: 'exact' });
        const lookup = value => api(2, 'get', `/api/cartons/lookup?matchSerialSubset=true&scanValue=${encodeURIComponent(value)}`);
        const sticker = selected.join(',');
        const found = ok(await lookup(sticker));
        assert.equal(found.cartonId, carton.cartonId);
        assert.deepEqual(found.matchedSerials, selected);
        assert.equal(ok(await lookup(sns.join(','))).matchedSerials, undefined);
        assert.equal((await lookup([sns[0], 'Other-Source-SN'].join(','))).body.code, 'CARTON_SN_SOURCE_MIXED');
        assert.equal((await lookup([sns[0], 'Unknown-Source-SN'].join(','))).body.code, 'CARTON_SN_SOURCE_MIXED');
        assert.equal((await lookup('Loose-A,Loose-B')).body.code, 'CARTON_NOT_FOUND');

        const orderPath = `/api/orders/${order.id}`;
        const rejected = (user, input) => api(user, 'post', orderPath + '/carton-preview', input);
        assert.equal((await rejected(2, { type: 'pick', scanValue: sticker, matchSerialSubset: true })).body.code, 'CARTON_SPLIT_SERIAL_REQUIRED');
        const getSingle = (scanValue, type = 'pick') => ({ scanValue, type, mode: 'serial', orderItemId: item.id });
        assert.equal((await rejected(2, getSingle(sns[0].toLowerCase()))).body.code, 'CARTON_SERIAL_NOT_REGISTERED');

        const split = { scanValue: `CARTON:${carton.cartonId}`, type: 'pick', mode: 'split', serialPolicy: 'from-carton',
            selections: [{ lineId: carton.lines[0].lineId, quantity: 3, actualSN: selected.slice(0, 3) }] };
        await f.db.query('UPDATE order_items SET expected_carton_id=$1 WHERE id=$2', [other.cartonId, item.id]);
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-preview`, split)).body.code, 'CARTON_EXPECTED_MISMATCH');
        await f.db.query('UPDATE order_items SET expected_carton_id=$1 WHERE id=$2', [carton.cartonId, item.id]);
        const first = await scan(order.id, split);
        assert.equal(first.carton.lines[0].remainingQuantity, 37);
        assert.equal((await rejected(2, getSingle(sns[0]))).body.code, 'CARTON_SN_UNAVAILABLE');
        assert.equal((await rejected(2, { scanValue: carton.cartonId, type: 'pick' })).body.code, 'CARTON_ALREADY_ALLOCATED');
        const one = await scan(order.id, getSingle(sns[3]));
        assert.equal(one.allocation.allocationId, first.allocation.allocationId);
        assert.deepEqual(one.appliedSelection[0].actualSN, [sns[3]]);
        const picked = await scan(order.id, { ...split, selections: [{ ...split.selections[0], quantity: 2, actualSN: selected.slice(4) }] });
        assert.equal(picked.carton.lines[0].remainingQuantity, 34);
        assert.equal(picked.allocation.cartonId, carton.cartonId);
        assert.equal(picked.allocation.allocationId, first.allocation.allocationId);
        assert.deepEqual(picked.allocation.lines[0].actualSN, selected);
        assert.equal(picked.items[0].product_code, '測試-不出貨');
        ok(await api(3, 'post', orderPath + '/claim', { stage: 'pack' }));
        for (const scanValue of [carton.cartonId, sticker, sns.join(',')]) {
            assert.equal((await rejected(3, { scanValue, type: 'pack', matchSerialSubset: true })).body.code, 'CARTON_PACK_SERIAL_REQUIRED');
        }
        assert.equal((await rejected(3, getSingle(sns[6], 'pack'))).body.code, 'CARTON_SN_NOT_IN_ALLOCATION');
        const single = getSingle(sns[0], 'pack');
        const firstPackCommand = scanBody(await preview(order.id, single, 3), single);
        const sendPack = () => api(3, 'post', orderPath + '/carton-scan', firstPackCommand);
        const packedFirst = ok(await sendPack());
        assert.deepEqual(ok(await sendPack()), packedFirst);
        assert.equal(packedFirst.packMode, 'serial');
        assert.equal(packedFirst.packComplete, false);
        assert.equal(packedFirst.allocation.status, 'picked');
        assert.equal(packedFirst.instances.filter(row => row.status === 'packed').length, 1);
        assert.equal((await rejected(3, single)).body.code, 'CARTON_SN_ALREADY_PACKED');
        const release = await api(1, 'post', `/api/cartons/allocations/${first.allocation.allocationId}/release`, {
            reason: 'Already partially packed', commandId: randomUUID(),
            expectedState: packedFirst.stateToken, expectedCartonRevision: packedFirst.carton.stateRevision
        });
        assert.equal(release.body.code, 'CARTON_RELEASE_BLOCKED');
        let packed;
        for (const sn of selected.slice(1)) packed = await scan(order.id, getSingle(sn, 'pack'), 3);
        assert.equal(packed.packComplete, true);
        assert.equal(packed.order.status, 'completed');
        assert.equal((await rejected(3, getSingle(sns[5], 'pack'))).body.code, 'CARTON_SN_ALREADY_PACKED');
        assert.equal(packed.carton.lines[0].remainingQuantity, 34);
        assert.equal(packed.allocation.cartonId, carton.cartonId);
        assert.deepEqual(packed.allocation.lines[0].actualSN, selected);
    });
    await t.test('10 exact SNs expand atomically, legacy comma QR resolves only the entire exact set', async () => {
        const sns = Array.from({ length: 10 }, (_, index) => `Vendor-A-${String(index + 1).padStart(2, '0')}`);
        await create(box('SERIAL', 10, sns));
        assert.equal(ok(await api(2, 'get', `/api/cartons/lookup?scanValue=${encodeURIComponent([...sns].reverse().join(','))}`)).cartonId, 'SERIAL');
        assert.equal((await api(2, 'get', `/api/cartons/lookup?scanValue=${encodeURIComponent(sns.slice(0, 9).join(','))}`)).status, 404);
        const { order } = await f.seedOrder({ actualSN: sns });
        const picked = await scan(order.id, { scanValue: sns.join(','), type: 'pick' });
        assert.ok(picked.instances.every(unit => unit.status === 'picked'));
        const packed = await scan(order.id, { scanValue: 'CARTON:SERIAL', type: 'pack' }, 3);
        assert.ok(packed.instances.every(unit => unit.status === 'packed'));
        assert.equal(packed.order.status, 'completed'); assert.equal(packed.items[0].picked_quantity, 0);
    });
    await t.test('an original intact carton becomes serial-only once individual packing begins', async () => {
        const sns = ['Intact-SN-01', 'Intact-SN-02'];
        const carton = await create(box('CTN-INTACT-START-SERIAL', 2, sns));
        const { order } = await f.seedOrder({ quantity: 2, actualSN: sns });
        const picked = await scan(order.id, { scanValue: carton.cartonId, type: 'pick' });
        assert.equal(picked.allocation.lines[0].wholeCarton, true);
        const first = await scan(order.id, { scanValue: sns[0], mode: 'serial', type: 'pack' }, 3);
        assert.equal(first.packComplete, false);
        const bulk = await api(3, 'post', `/api/orders/${order.id}/carton-preview`, { scanValue: carton.cartonId, type: 'pack' });
        assert.equal(bulk.body.code, 'CARTON_PACK_SERIAL_REQUIRED');
        assert.equal((await scan(order.id, { scanValue: sns[1], mode: 'serial', type: 'pack' }, 3)).packComplete, true);
    });
    await t.test('all remaining units after an earlier split cannot use whole pack, even if all were picked in one scan', async () => {
        const sns = ['Leftovers-SN-01', 'Leftovers-SN-02', 'Leftovers-SN-03'];
        const carton = await create(box('CTN-LEFTOVERS', 3, sns));
        const first = await f.seedOrder({ quantity: 1, actualSN: sns.slice(0, 1) });
        const next = await f.seedOrder({ quantity: 2, actualSN: sns.slice(1) });
        await scan(first.order.id, { scanValue: sns[0], mode: 'serial', type: 'pick' });
        const picked = await scan(next.order.id, { scanValue: carton.cartonId, type: 'pick' });
        assert.equal(picked.carton.lines[0].remainingQuantity, 0);
        assert.equal(picked.allocation.lines[0].wholeCarton, false);
        ok(await api(3, 'post', `/api/orders/${next.order.id}/claim`, { stage: 'pack' }));
        assert.equal((await api(3, 'post', `/api/orders/${next.order.id}/carton-preview`, {
            scanValue: carton.cartonId, type: 'pack'
        })).body.code, 'CARTON_PACK_SERIAL_REQUIRED');
    });
    await t.test('explicit selections and old allocations without intact proof only permit individual SN packing', async () => {
        for (const legacy of [false, true]) {
            const sns = [`Full-Proof-${legacy}-01`, `Full-Proof-${legacy}-02`];
            const carton = await create(box(`CTN-FULL-PROOF-${legacy}`, 2, sns));
            const { order } = await f.seedOrder({ quantity: 2, actualSN: sns });
            const pick = { scanValue: carton.cartonId, type: 'pick', mode: 'whole',
                ...(legacy ? {} : { selections: [{ lineId: carton.lines[0].lineId, quantity: 2, actualSN: sns }] }) };
            const picked = await scan(order.id, pick);
            assert.equal(picked.allocation.lines[0].wholeCarton, legacy);
            if (legacy) {
                const lines = picked.allocation.lines.map(({ wholeCarton, ...line }) => line);
                await f.db.query('UPDATE wms_carton_allocations SET lines=$2 WHERE id=$1',
                    [picked.allocation.allocationId, JSON.stringify(lines)]);
            }
            const orderPath = `/api/orders/${order.id}`;
            ok(await api(3, 'post', orderPath + '/claim', { stage: 'pack' }));
            assert.equal((await api(3, 'post', orderPath + '/carton-preview', {
                scanValue: carton.cartonId, type: 'pack'
            })).body.code, 'CARTON_PACK_SERIAL_REQUIRED');
            const commands = await Promise.all(sns.map(async scanValue => {
                const input = { scanValue, type: 'pack', mode: 'serial' };
                return scanBody(await preview(order.id, input, 3), input);
            }));
            const results = await Promise.all(commands.map(command => api(3, 'post', orderPath + '/carton-scan', command)));
            const winner = results.findIndex(response => response.status === 200);
            assert.notEqual(winner, -1, JSON.stringify(results.map(r=>r.body)));
            const first = results[winner].body;
            assert.equal(first.instances.filter(row => row.status === 'packed').length, 1);
            assert.equal(results[1 - winner].body.code, 'STATE_CHANGED');
            assert.equal((await scan(order.id, { scanValue: sns[1 - winner], type: 'pack', mode: 'serial' }, 3)).packComplete, true);
        }
    });
    await t.test('partial mixed box needs both individual SN and quantity verifications before completion', async () => {
        const sns = ['Mixed-SN-01', 'Mixed-SN-02'];
        const plain = { itemCode: 'PLAIN', ean: '4710000000020', quantity: 3, actualSN: [] };
        const carton = await create({ ...box('CTN-MIXED-V6', 2, sns), lines: [...box('CTN-MIXED-V6', 2, sns).lines, plain] });
        const { order } = await f.seedOrder({ quantity: 1, actualSN: sns.slice(0, 1) });
        const plainOrderItem = (await f.db.query("INSERT INTO order_items(order_id,product_code,barcode,quantity) VALUES($1,'PLAIN',$2,2) RETURNING id",
            [order.id, plain.ean])).rows[0];
        await scan(order.id, { scanValue: sns[0], mode: 'serial', type: 'pick' });
        for (let index = 0; index < 2; index++) await scan(order.id, cartonUnit(carton.cartonId, 'pick', plain.ean, plainOrderItem.id));
        const pack = { scanValue: carton.cartonId, type: 'pack' };
        ok(await api(3, 'post', `/api/orders/${order.id}/claim`, { stage: 'pack' }));
        assert.equal((await api(3, 'post', `/api/orders/${order.id}/carton-preview`, pack)).body.code, 'CARTON_PACK_SERIAL_REQUIRED');
        const plainPack = cartonUnit(carton.cartonId, 'pack', plain.ean, plainOrderItem.id);
        const first = await scan(order.id, plainPack, 3);
        assert.equal(first.packComplete, false);
        assert.equal(first.items.find(item => item.id === plainOrderItem.id).packed_quantity, 1);
        const second = await scan(order.id, { scanValue: sns[0], mode: 'serial', type: 'pack' }, 3);
        assert.equal(second.packComplete, false);
        assert.equal((await api(3, 'post', `/api/orders/${order.id}/carton-preview`, pack)).body.code, 'CARTON_PACK_UNIT_REQUIRED');
        const packed = await scan(order.id, plainPack, 3);
        assert.equal(packed.packMode, 'unit');
        assert.equal(packed.packComplete, true);
        assert.deepEqual(packed.appliedSelection.map(line => [line.orderItemId, line.quantity]), [[plainOrderItem.id, 1]]);
        assert.equal(packed.order.status, 'completed');
        assert.deepEqual(packed.carton.lines.map(line => line.remainingQuantity), [1, 1]);
    });
    await t.test('an unregistered SN sticker verifies only selected order SNs and replays without a carton allocation', async () => {
        const orderSNs = ['Loose-01', 'Loose-02', 'Loose-03'];
        const { order } = await f.seedOrder({ quantity: 3, actualSN: orderSNs, serialMode: 'exact' });
        const submit = (user, body) => api(user, 'post', '/api/orders/update_item', { orderId: order.id, ...body });
        ok(await submit(2, { scanValue: orderSNs[0], type: 'pick' }));
        const path = `/api/orders/${order.id}/work-snapshot`;
        const snapshot = ok(await api(2, 'get', path));
        const qr = {
            scanValue: [...orderSNs, 'Other-01'].join(','), type: 'pick', responseMode: 'delta-v1',
            commandId: randomUUID(), expectedState: snapshot.stateToken, selectedSerials: orderSNs.slice(1)
        };
        const rejected = await submit(2, { ...qr, selectedSerials: [orderSNs[1], 'Other-01'] });
        assert.equal(rejected.status, 409);
        assert.deepEqual(ok(await api(2, 'get', path)).instances, snapshot.instances);
        const picked = ok(await submit(2, qr));
        assert.deepEqual(picked.confirmedSerials, orderSNs.slice(1));
        assert.equal(picked.order.status, 'picked');
        assert.deepEqual(ok(await submit(2, qr)), picked);
        ok(await api(3, 'post', `/api/orders/${order.id}/claim`, { stage: 'pack' }));
        const packing = ok(await api(3, 'get', path));
        const rejectedPack = await submit(3, {
            ...qr, type: 'pack', commandId: randomUUID(), expectedState: packing.stateToken, selectedSerials: orderSNs
        });
        assert.equal(rejectedPack.status, 409);
        assert.deepEqual(ok(await api(3, 'get', path)).instances, packing.instances);
        let packed;
        for (const scanValue of orderSNs) packed = ok(await submit(3, { scanValue, type: 'pack' }));
        assert.equal(packed.order.status, 'completed');
        assert.ok(packed.instances.every(instance => instance.status === 'packed'));
        assert.deepEqual(ok(await api(3, 'get', `/api/orders/${order.id}/carton-shipments`)).allocations, []);
    });
    await t.test('exact SN ownership rejects double registration and count mismatch without partial carton', async () => {
        const duplicate = await api(1, 'post', '/api/cartons', box('DUP-SN', 1, ['Vendor-A-01']));
        assert.equal(duplicate.status, 409);
        assert.equal((await api(1, 'get', '/api/cartons/DUP-SN')).status, 404);
        assert.equal((await api(1, 'post', '/api/cartons', box('BAD-SN-QTY', 2, ['Only-one']))).status, 400);
    });
    await t.test('picking two of ten leaves eight, and both the split and all remaining pieces require individual packing', async () => {
        const carton = await create(box('SPLIT'));
        const first = await f.seedOrder({ quantity: 2 }), second = await f.seedOrder({ quantity: 8 });
        const firstPath = `/api/orders/${first.order.id}`;
        const whole = { scanValue: carton.cartonId, type: 'pick' };
        assert.equal((await api(2, 'post', firstPath + '/carton-preview', whole)).body.code, 'CARTON_ORDER_QUANTITY_EXCEEDED');
        const bulk = { ...whole, mode: 'split', selections: [{ lineId: carton.lines[0].lineId, quantity: 2 }] };
        assert.equal((await api(2, 'post', firstPath + '/carton-preview', bulk)).body.code, 'CARTON_SPLIT_UNIT_REQUIRED');
        const input = cartonUnit(carton.cartonId);
        assert.equal((await api(2, 'post', firstPath + '/carton-preview', { ...input, scanValue: 'wrong' })).body.code, 'CARTON_UNIT_NOT_IN_CARTON');
        await scan(first.order.id, input);
        const picked = await scan(first.order.id, input);
        assert.equal(picked.carton.lines[0].remainingQuantity, 8);
        ok(await api(3, 'post', firstPath + '/claim', { stage: 'pack' }));
        assert.equal((await api(3, 'post', firstPath + '/carton-preview', { ...whole, type: 'pack' })).body.code, 'CARTON_PACK_UNIT_REQUIRED');
        const pack = cartonUnit(carton.cartonId, 'pack');
        const command = scanBody(await preview(first.order.id, pack, 3), pack);
        const competing = { ...command, commandId: randomUUID() };
        const results = await Promise.all([command, competing].map(body => api(3, 'post', firstPath + '/carton-scan', body)));
        const winner = results.findIndex(result => result.status === 200);
        assert.notEqual(winner, -1, JSON.stringify(results.map(r=>r.body)));
        assert.equal(results[1 - winner].body.code, 'STATE_CHANGED');
        const packedOnce = ok(results[winner]);
        assert.deepEqual(ok(await api(3, 'post', firstPath + '/carton-scan', [command, competing][winner])), packedOnce);
        assert.equal(packedOnce.items[0].packed_quantity, 1);
        assert.equal(packedOnce.allocation.lines[0].packedQuantity, 1);
        assert.equal(packedOnce.packComplete, false);
        assert.equal(packedOnce.carton.lines[0].remainingQuantity, 8);
        const release = await api(1, 'post', `/api/cartons/allocations/${picked.allocation.allocationId}/release`, {
            reason: 'Partial pack', commandId: randomUUID(), expectedState: packedOnce.stateToken,
            expectedCartonRevision: packedOnce.carton.stateRevision
        });
        assert.equal(release.body.code, 'CARTON_RELEASE_BLOCKED');
        const packed = await scan(first.order.id, pack, 3);
        assert.equal(packed.order.status, 'completed');
        assert.equal(packed.items[0].packed_quantity, 2);
        assert.equal(packed.carton.lines[0].remainingQuantity, 8);

        const secondPath = `/api/orders/${second.order.id}`;
        assert.equal((await api(2, 'post', secondPath + '/carton-preview', whole)).body.code, 'CARTON_SPLIT_UNIT_REQUIRED');
        for (let index = 0; index < 8; index++) await scan(second.order.id, input);
        ok(await api(3, 'post', secondPath + '/claim', { stage: 'pack' }));
        assert.equal((await api(3, 'post', secondPath + '/carton-preview', { ...whole, type: 'pack' })).body.code, 'CARTON_PACK_UNIT_REQUIRED');
        let packedRemainder;
        for (let index = 0; index < 8; index++) packedRemainder = await scan(second.order.id, pack, 3);
        assert.equal(packedRemainder.order.status, 'completed');
        assert.equal(packedRemainder.items[0].packed_quantity, 8);
        assert.equal(packedRemainder.carton.lines[0].remainingQuantity, 0);
    });
    await t.test('legacy allocation without original-carton proof requires its exact internal label and starts at zero verified pieces', async () => {
        const internalScanCode = 'ITM-LEGACY-UNIT';
        const carton = await create(box('OLD-UNIT-ALLOCATION', 2, [], { itemCode: 'LEGACY-UNIT', ean: null, internalScanCode }));
        const { order, item } = await f.seedOrder({ quantity: 2, itemCode: 'LEGACY-UNIT', barcode: internalScanCode });
        const picked = await scan(order.id, { scanValue: carton.cartonId, type: 'pick' });
        const oldLines = picked.allocation.lines.map(({ wholeCarton, ...line }) => line);
        await f.db.query('UPDATE wms_carton_allocations SET lines=$2 WHERE id=$1',
            [picked.allocation.allocationId, JSON.stringify(oldLines)]);
        const path = `/api/orders/${order.id}`;
        ok(await api(3, 'post', path + '/claim', { stage: 'pack' }));
        assert.equal((await api(3, 'post', path + '/carton-preview', { scanValue: carton.cartonId, type: 'pack' })).body.code, 'CARTON_PACK_UNIT_REQUIRED');
        assert.equal((await api(3, 'post', path + '/carton-preview', cartonUnit(carton.cartonId, 'pack', 'LEGACY-UNIT', item.id))).body.code,
            'CARTON_UNIT_NOT_IN_CARTON');
        const unit = cartonUnit(carton.cartonId, 'pack', internalScanCode, item.id);
        assert.equal((await scan(order.id, unit, 3)).allocation.lines[0].packedQuantity, 1);
        const packed = await scan(order.id, unit, 3);
        assert.equal(packed.allocation.lines[0].packedQuantity, 2);
        assert.equal(packed.carton.lines[0].remainingQuantity, 0);
        assert.equal(packed.order.status, 'completed');
    });
    await t.test('an older carton without any scan code accepts only the explicit internal scan code on its exact order SKU', async () => {
        const internalScanCode = 'ITM-MISSING-BOX-UNIT';
        const carton = await create(box('MISSING-BOX-UNIT', 2, [], { itemCode: 'MISSING-UNIT', ean: null }));
        const { order, item } = await f.seedOrder({ quantity: 1, itemCode: 'MISSING-UNIT', barcode: internalScanCode });
        const unit = cartonUnit(carton.cartonId, 'pick', internalScanCode, item.id);
        const path = `/api/orders/${order.id}`;
        assert.equal((await api(2, 'post', path + '/carton-preview', unit)).body.code, 'CARTON_UNIT_NOT_IN_CARTON');
        await f.db.query("UPDATE order_items SET internal_scan_code=$1,code_type='internal' WHERE id=$2", [internalScanCode, item.id]);
        assert.equal((await api(2, 'post', path + '/carton-preview', { ...unit, scanValue: 'ITM-OTHER' })).body.code, 'CARTON_UNIT_NOT_IN_CARTON');
        const picked = await scan(order.id, unit);
        assert.equal(picked.allocation.lines[0].internalScanCode, internalScanCode);
        assert.equal(picked.carton.lines[0].remainingQuantity, 1);
        const packed = await scan(order.id, { ...unit, type: 'pack' }, 3);
        assert.equal(packed.order.status, 'completed');
        assert.equal(packed.carton.lines[0].remainingQuantity, 1);
    });
    await t.test('ECOUNT expected carton rejects the wrong box and ordinary scan before applying a split', async () => {
        const expected = await create(box('EXPECTED-N1')), other = await create(box('EXPECTED-N2'));
        const { order, item } = await f.seedOrder({ quantity: 2 });
        const path = `/api/orders/${order.id}`;
        const split = carton => cartonUnit(carton.cartonId, 'pick', item.barcode, item.id);
        const unbound = await preview(order.id, split(expected));
        await f.db.query('UPDATE order_items SET expected_carton_id=$1 WHERE id=$2', [expected.cartonId, item.id]);
        const correct = await preview(order.id, split(expected));
        assert.notEqual(correct.expectedState, unbound.expectedState);
        assert.equal(correct.expectedCartonRevision, other.stateRevision);
        for (const [endpoint, payload] of [
            ['carton-preview', split(other)],
            ['carton-scan', scanBody(correct, split(other))]
        ]) {
            const response = await api(2, 'post', `${path}/${endpoint}`, payload);
            assert.equal(response.status, 409);
            assert.equal(response.body.code, 'CARTON_EXPECTED_MISMATCH');
        }
        for (const source of [{}, { scanSource: 'loose' }]) {
            const ordinary = await api(2, 'post', '/api/orders/update_item',
                { orderId: order.id, orderItemId: item.id, scanValue: item.barcode, type: 'pick', amount: 1, ...source });
            assert.equal(ordinary.status, 409);
            assert.match(ordinary.body.message, /EXPECTED-N1/);
        }
        const client = await f.pool.connect();
        try {
            await client.query('BEGIN');
            await assert.rejects(applyOrderChangeProposal({ client, orderId: order.id, actorUserId: 1,
                proposal: { note: 'Synthetic quantity edit', items: [{ barcode: item.barcode, orderItemId: item.id, productName: item.product_name,
                    quantityChange: -1, noSn: true }] } }), { code: 'CARTON_EXPECTED_REQUIRED' });
        } finally {
            await client.query('ROLLBACK');
            client.release();
        }
        assert.equal((await f.db.query('SELECT picked_quantity FROM order_items WHERE id=$1', [item.id])).rows[0].picked_quantity, 0);
        assert.equal(ok(await api(2, 'get', '/api/cartons/EXPECTED-N2')).lines[0].remainingQuantity, 10);
        ok(await api(2, 'post', `${path}/carton-scan`, scanBody(correct, split(expected))));
        const picked = await scan(order.id, split(expected));
        assert.equal(picked.items[0].picked_quantity, 2);
        assert.equal(picked.carton.lines[0].remainingQuantity, 8);
        await scan(order.id, cartonUnit(expected.cartonId, 'pack', item.barcode, item.id), 3);
        const packed = await scan(order.id, cartonUnit(expected.cartonId, 'pack', item.barcode, item.id), 3);
        assert.equal(packed.items[0].packed_quantity, 2);
        assert.equal(packed.carton.lines[0].remainingQuantity, 8);
    });
    await t.test('SN split requires selected real SNs and preserves unselected SN ownership', async () => {
        const sns = ['Split-SN-01', 'Split-SN-02', 'Split-SN-03'];
        const carton = await create(box('SN-SPLIT', 3, sns));
        const { order } = await f.seedOrder({ quantity: 2, actualSN: sns.slice(0, 2) });
        const input = { scanValue: 'SN-SPLIT', type: 'pick', mode: 'split', selections: [{ lineId: carton.lines[0].lineId, quantity: 2 }] };
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-preview`, input)).body.code, 'CARTON_EXACT_SN_REQUIRED');
        input.selections[0].actualSN = sns.slice(0, 2);
        const picked = await scan(order.id, input);
        assert.deepEqual(picked.carton.lines[0].remainingSN, ['Split-SN-03']);
    });
    await t.test('an SN carton spans source rows using exact owners, and no-SN scans require the matching order row', async () => {
        const sns = Array.from({ length: 10 }, (_, index) => `Multi-SN-${index}`);
        await create(box('MULTI-SN', 10, sns));
        const { order, item } = await f.seedOrder({ quantity: 5, actualSN: sns.slice(0, 5) });
        const second = (await f.db.query('INSERT INTO order_items(order_id,product_code,barcode,quantity) VALUES($1,$2,$3,5) RETURNING id', [order.id, item.product_code, item.barcode])).rows[0];
        await f.db.query('INSERT INTO order_item_instances(order_item_id,serial_number) SELECT $1,unnest($2::text[])', [second.id, sns.slice(5)]);
        const picked = await scan(order.id, { scanValue: 'MULTI-SN', type: 'pick' });
        assert.equal(picked.allocation.lines.length, 2); assert.ok(picked.allocation.lines.every(line => line.quantity === 5));
        assert.equal((await scan(order.id, { scanValue: 'MULTI-SN', type: 'pack' }, 3)).order.status, 'completed');
        const carton = await create(box('MULTI-QTY', 5)), quantityOrder = await f.seedOrder({ quantity: 3 });
        const other = (await f.db.query('INSERT INTO order_items(order_id,product_code,barcode,quantity) VALUES($1,$2,$3,2) RETURNING id', [quantityOrder.order.id, quantityOrder.item.product_code, quantityOrder.item.barcode])).rows[0];
        const quantityPath = `/api/orders/${quantityOrder.order.id}/carton-preview`;
        assert.equal((await api(2, 'post', quantityPath, cartonUnit(carton.cartonId))).body.code, 'CARTON_ORDER_LINE_REQUIRED');
        for (let index = 0; index < 3; index++) {
            await scan(quantityOrder.order.id, cartonUnit(carton.cartonId, 'pick', quantityOrder.item.barcode, quantityOrder.item.id));
        }
        const secondRow = cartonUnit(carton.cartonId, 'pick', quantityOrder.item.barcode, other.id);
        await scan(quantityOrder.order.id, secondRow);
        const result = await scan(quantityOrder.order.id, secondRow);
        assert.equal(result.carton.lines[0].remainingQuantity, 0); assert.equal(result.order.status, 'picked');
    });
    await t.test('explicit from-carton binds all 10 real SNs onto an untouched quantity-only order and completes normally', async () => {
        const sns = Array.from({ length: 10 }, (_, index) => `Bind-SN-${index}`);
        await create(box('BIND-10', 10, sns));
        const { order } = await f.seedOrder();
        const input = { scanValue: 'BIND-10', type: 'pick', serialPolicy: 'from-carton' };
        const picked = await scan(order.id, input);
        assert.equal(picked.order.status, 'picked'); assert.equal(picked.instances.length, 10);
        assert.ok(picked.instances.every(unit => unit.status === 'picked'));
        assert.equal(picked.items[0].carton_serial_binding, true);
        const packed = await scan(order.id, { ...input, type: 'pack' }, 3);
        assert.equal(packed.order.status, 'completed'); assert.equal(packed.carton.lines[0].remainingQuantity, 0);
    });
    await t.test('from-carton partial 6 plus another 4 binds only actual units and completes a demand of 10', async () => {
        const firstSN = Array.from({ length: 6 }, (_, index) => `Continue-A-${index}`), lastSN = Array.from({ length: 4 }, (_, index) => `Continue-B-${index}`);
        await create(box('BIND-6', 6, firstSN)); await create(box('BIND-4', 4, lastSN));
        const { order } = await f.seedOrder();
        const first = await scan(order.id, { scanValue: 'BIND-6', type: 'pick', serialPolicy: 'from-carton' });
        assert.equal(first.order.status, 'picking'); assert.equal(first.instances.length, 6);
        const second = await scan(order.id, { scanValue: 'BIND-4', type: 'pick', serialPolicy: 'from-carton' });
        assert.equal(second.order.status, 'picked'); assert.equal(second.instances.length, 10);
        await scan(order.id, { scanValue: 'BIND-6', type: 'pack', serialPolicy: 'from-carton' }, 3);
        assert.equal((await scan(order.id, { scanValue: 'BIND-4', type: 'pack', serialPolicy: 'from-carton' }, 3)).order.status, 'completed');
    });
    await t.test('from-carton cannot convert existing manual progress or take one SN occupied by another order; all 10 roll back', async () => {
        const sns = Array.from({ length: 10 }, (_, index) => `Occupied-SN-${index}`);
        await create(box('BIND-BLOCKED', 10, sns)); const { order, item } = await f.seedOrder();
        await f.db.query('UPDATE order_items SET picked_quantity=2 WHERE id=$1', [item.id]);
        const input = { scanValue: 'BIND-BLOCKED', type: 'pick', serialPolicy: 'from-carton' };
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-preview`, input)).body.code, 'CARTON_SERIAL_PROGRESS_CONFLICT');
        await f.db.query('UPDATE order_items SET picked_quantity=0 WHERE id=$1', [item.id]);
        const pending = await preview(order.id, input), body = scanBody(pending, input);
        await f.seedOrder({ quantity: 1, actualSN: [sns[9]] });
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-scan`, body)).body.code, 'CARTON_SN_OCCUPIED');
        assert.equal((await f.db.query('SELECT COUNT(*)::int AS n FROM order_item_instances WHERE order_item_id=$1', [item.id])).rows[0].n, 0);
        assert.equal((await f.db.query('SELECT carton_serial_binding FROM order_items WHERE id=$1', [item.id])).rows[0].carton_serial_binding, false);
        const carton = ok(await api(2, 'get', '/api/cartons/BIND-BLOCKED'));
        assert.equal(carton.lines[0].remainingQuantity, 10); assert.equal(carton.allocations.length, 0);
    });
    await t.test('releasing newly bound SN restores contents without making another carton own those serials', async () => {
        const sns = ['Unbind-SN-1', 'Unbind-SN-2']; await create(box('UNBIND', 2, sns));
        const { order, item } = await f.seedOrder({ quantity: 2 });
        const picked = await scan(order.id, { scanValue: 'UNBIND', type: 'pick', serialPolicy: 'from-carton' });
        await assert.rejects(guardUnitScan(f.pool, order.id, { instanceId: picked.instances[0].id, type: 'pack', amount: 1 }), { code: 'CARTON_ALLOCATION_GUARD' });
        const released = ok(await api(1, 'post', `/api/cartons/allocations/${picked.allocation.allocationId}/release`, {
            commandId: randomUUID(), expectedState: picked.stateToken, expectedCartonRevision: picked.carton.stateRevision, reason: 'Put actual units back'
        }));
        assert.equal(released.instances.length, 0); assert.equal(released.items.find(row => row.id === item.id).carton_serial_binding, false);
        assert.deepEqual(released.carton.lines[0].remainingSN, sns);
        assert.equal((await api(1, 'post', '/api/cartons', box('UNBIND-OTHER', 2, sns))).status, 409);
    });
    await t.test('actor identity is bound through preview, scan and release; a changed login cannot reuse the prior preview', async () => {
        await create(box('ACTOR', 1)); const { order } = await f.seedOrder({ quantity: 1 });
        const input = { scanValue: 'ACTOR', type: 'pick' }, body = scanBody(await preview(order.id, input), input);
        assert.equal((await api(6, 'post', `/api/orders/${order.id}/carton-scan`, body)).body.code, 'CARTON_ACTOR_CHANGED');
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-preview`, { ...input, expectedActorId: 6 })).body.code, 'CARTON_ACTOR_CHANGED');
        assert.equal((await api(1, 'post', '/api/cartons', { ...box('ACTOR-MANAGEMENT'), expectedActorId: 2 })).body.code, 'CARTON_ACTOR_CHANGED');
    });
    await t.test('request retries replay once, while only a new explicit split can add more quantity', async () => {
        const carton = await create(box('RETRY'));
        const { order } = await f.seedOrder();
        const input = cartonUnit(carton.cartonId);
        const body = scanBody(await preview(order.id, input), input);
        const results = await Promise.all([api(2, 'post', `/api/orders/${order.id}/carton-scan`, body), api(2, 'post', `/api/orders/${order.id}/carton-scan`, body)]);
        assert.deepEqual(ok(results[0]), ok(results[1]));
        const current = results[0].body;
        assert.equal(current.items[0].picked_quantity, 1); assert.equal(current.carton.lines[0].remainingQuantity, 9);
        const newBody = { ...body, commandId: randomUUID(), expectedState: current.stateToken, expectedCartonRevision: current.carton.stateRevision };
        const whole = { ...newBody, mode: 'whole', scanValue: carton.cartonId };
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-scan`, whole)).body.code, 'CARTON_ALREADY_ALLOCATED');
        const added = ok(await api(2, 'post', `/api/orders/${order.id}/carton-scan`, newBody));
        assert.equal(added.allocation.allocationId, current.allocation.allocationId);
        assert.equal(added.allocation.lines[0].quantity, 2);
        assert.equal(added.appliedSelection[0].quantity, 1);
        assert.equal(added.carton.lines[0].remainingQuantity, 8);
        assert.deepEqual(ok(await api(2, 'post', `/api/orders/${order.id}/carton-scan`, newBody)), added);
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-scan`, { ...body, cartonId: 'OTHER' })).body.code, 'CARTON_COMMAND_CONFLICT');
    });
    await t.test('two operators on different orders competing for one box produce one pick and one version conflict', async () => {
        await create(box('RACE'));
        const a = await f.seedOrder(), b = await f.seedOrder({ pickerId: 6 });
        const input = { scanValue: 'RACE', type: 'pick' };
        const bodyA = scanBody(await preview(a.order.id, input, 2), input), bodyB = scanBody(await preview(b.order.id, input, 6), input);
        const results = await Promise.all([api(2, 'post', `/api/orders/${a.order.id}/carton-scan`, bodyA), api(6, 'post', `/api/orders/${b.order.id}/carton-scan`, bodyB)]);
        assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
        assert.equal(results.find(result => result.status === 409).body.code, 'CARTON_STATE_CHANGED');
        assert.equal((await f.db.query('SELECT SUM(picked_quantity)::int AS n FROM order_items WHERE order_id=ANY($1::int[])', [[a.order.id, b.order.id]])).rows[0].n, 10);
        assert.equal(ok(await api(2, 'get', '/api/cartons/RACE')).lines[0].remainingQuantity, 0);
    });
    await t.test('snapshot or durable receipt failure rolls back quantity, SN, allocation, history and events together', async () => {
        const sns = ['Rollback-SN-1', 'Rollback-SN-2'];
        await create(box('ROLLBACK', 2, sns));
        const { order } = await f.seedOrder({ quantity: 2, actualSN: sns });
        const input = { scanValue: 'ROLLBACK', type: 'pick' }, body = scanBody(await preview(order.id, input), input);
        const io = { emitted: [], emit(...args) { this.emitted.push(args); } };
        f.app.set('io', io);
        f.failNext(sql => sql.startsWith('INSERT INTO wms_scan_commands'));
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-scan`, body)).status, 500);
        assert.equal((await f.db.query('SELECT COUNT(*)::int AS n FROM order_item_instances WHERE order_item_id=$1 AND status<>\'pending\'', [(await f.db.query('SELECT id FROM order_items WHERE order_id=$1', [order.id])).rows[0].id])).rows[0].n, 0);
        const carton = ok(await api(2, 'get', '/api/cartons/ROLLBACK'));
        assert.equal(carton.lines[0].remainingQuantity, 2); assert.equal(carton.allocations.length, 0); assert.equal(carton.history.length, 2);
        assert.equal(io.emitted.length, 0);
        ok(await api(2, 'post', `/api/orders/${order.id}/carton-scan`, body));
        assert.ok(io.emitted.length > 0); f.app.set('io', undefined);
    });
    await t.test('lost COMMIT response reports unknown, original command reconciles the durable result without double deduction', async () => {
        await create(box('UNKNOWN', 1)); const { order } = await f.seedOrder({ quantity: 1 });
        const input = { scanValue: 'UNKNOWN', type: 'pick' }, body = scanBody(await preview(order.id, input), input);
        f.failAfterNext(sql => sql === 'COMMIT');
        const first = await api(2, 'post', `/api/orders/${order.id}/carton-scan`, body);
        assert.equal(first.status, 503); assert.equal(first.body.code, 'SCAN_RESULT_UNKNOWN');
        const replay = ok(await api(2, 'post', `/api/orders/${order.id}/carton-scan`, body));
        assert.equal(replay.items[0].picked_quantity, 1); assert.equal(replay.carton.lines[0].remainingQuantity, 0);
        assert.equal(replay.carton.allocations.length, 1);
    });
    await t.test('changed state, wrong station, draft and open changes/exceptions reject without mutation', async () => {
        const carton = await create(box('BLOCKED', 1));
        const { order } = await f.seedOrder({ quantity: 1 });
        const input = { scanValue: 'BLOCKED', type: 'pick' }, body = scanBody(await preview(order.id, input), input);
        assert.equal((await api(6, 'post', `/api/orders/${order.id}/carton-preview`, input)).status, 403);
        await f.db.query("UPDATE orders SET customer_name='Changed' WHERE id=$1", [order.id]);
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-scan`, body)).body.code, 'STATE_CHANGED');
        await f.db.query("INSERT INTO order_exceptions(order_id,type,created_by) VALUES($1,'order_change',1)", [order.id]);
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-preview`, input)).body.code, 'CARTON_ORDER_EXCEPTION');
        assert.equal(ok(await api(2, 'get', '/api/cartons/BLOCKED')).stateRevision, carton.stateRevision);
        const draft = await create({ ...box('UNSEALED', 1), seal: false });
        const other = await f.seedOrder({ quantity: 1 });
        assert.equal((await api(2, 'post', `/api/orders/${other.order.id}/carton-preview`, { scanValue: draft.cartonId, type: 'pick' })).body.code, 'CARTON_NOT_SEALED');
    });
    await t.test('duplicate product rows require explicit line; negative documents never replenish cartons', async () => {
        const carton = await create(box('MULTI', 1)), { order, item } = await f.seedOrder({ quantity: 1 });
        await f.db.query('INSERT INTO order_items(order_id,product_code,barcode,quantity) VALUES($1,$2,$3,1)', [order.id, item.product_code, item.barcode]);
        const input = { scanValue: 'MULTI', type: 'pick' };
        assert.equal((await api(2, 'post', `/api/orders/${order.id}/carton-preview`, input)).body.code, 'CARTON_ORDER_LINE_REQUIRED');
        await scan(order.id, cartonUnit(carton.cartonId, 'pick', item.barcode, item.id));
                await create(box('NEGATIVE', 1));
        const reversed = await f.seedOrder({ quantity: 1, sign: -1 });
        assert.equal((await api(2, 'post', `/api/orders/${reversed.order.id}/carton-preview`, { scanValue: 'NEGATIVE', type: 'pick' })).body.code, 'SIGNED_CARTON_REVIEW_REQUIRED');
        assert.equal(ok(await api(2, 'get', '/api/cartons/NEGATIVE')).lines[0].remainingQuantity, 1);
    });
    await t.test('admin release restores once, preserves history, permits repick and rejects packed or operator releases', async () => {
        await create(box('RELEASE', 2));
        const { order } = await f.seedOrder({ quantity: 2 });
        const picked = await scan(order.id, { scanValue: 'RELEASE', type: 'pick' });
        const body = { commandId: randomUUID(), expectedState: picked.stateToken, expectedCartonRevision: picked.carton.stateRevision, reason: 'Synthetic physical put-back' };
        const path = `/api/cartons/allocations/${picked.allocation.allocationId}/release`;
        assert.equal((await api(2, 'post', path, body)).status, 403);
        const released = ok(await api(1, 'post', path, body));
        assert.equal(released.carton.lines[0].remainingQuantity, 2); assert.equal(released.items[0].picked_quantity, 0);
        assert.equal(released.order.status, 'picking'); assert.equal(released.carton.allocations[0].status, 'released');
        assert.deepEqual(ok(await api(1, 'post', path, body)), released);
        await scan(order.id, cartonUnit('RELEASE'));
        const repicked = await scan(order.id, cartonUnit('RELEASE'));
        await scan(order.id, cartonUnit('RELEASE', 'pack'), 3);
        const packed = await scan(order.id, cartonUnit('RELEASE', 'pack'), 3);
        assert.equal((await api(1, 'post', `/api/cartons/allocations/${repicked.allocation.allocationId}/release`, {
            ...body, commandId: randomUUID(), expectedState: packed.stateToken, expectedCartonRevision: packed.carton.stateRevision })).body.code, 'CARTON_RELEASE_BLOCKED');
    });
    await t.test('legacy unit mutations protect allocated contents but leave non-box units usable', async () => {
        const carton = await create(box('GUARD', 3)), { order, item } = await f.seedOrder({ quantity: 5 });
        await scan(order.id, { scanValue: 'GUARD', type: 'pick' });
        await assert.rejects(guardUnitScan(f.pool, order.id, { orderItemId: item.id, type: 'pick', amount: -1 }), { code: 'CARTON_ALLOCATION_GUARD' });
        await assert.rejects(guardUnitScan(f.pool, order.id, { orderItemId: item.id, type: 'pack', amount: 1 }), { code: 'CARTON_ALLOCATION_GUARD' });
        await assert.rejects(assertNoCartonAllocations(f.pool, order.id), { code: 'CARTON_ALLOCATION_GUARD' });
        await guardUnitScan(f.pool, order.id, { orderItemId: item.id, type: 'pick', amount: 1 });
        await f.db.query('UPDATE order_items SET picked_quantity=5 WHERE id=$1', [item.id]);
        await guardUnitScan(f.pool, order.id, { orderItemId: item.id, type: 'pack', amount: 2 });
        await assert.rejects(guardUnitScan(f.pool, order.id, { orderItemId: item.id, type: 'pack', amount: 3 }), { code: 'CARTON_ALLOCATION_GUARD' });
        assert.equal(carton.lines[0].quantity, 3);
        const other = await f.seedOrder({ quantity: 1 });
        await assertNoCartonAllocations(f.pool, other.order.id);
        await guardUnitScan(f.pool, other.order.id, { orderItemId: other.item.id, type: 'pick', amount: -1 });
    });
    await t.test('real legacy HTTP cannot consume reserved box units, replace SN or void; ordinary two units remain usable', async () => {
        f.attachLegacyRoutes();
        const { order } = await f.seedOrder(), carton = await create(box('LEGACY-MIX', 8));
        const unitInput = { orderId: order.id, scanValue: '4710000000010', type: 'pick', amount: 1 };
        const prompt = await api(2, 'post', '/api/orders/update_item', unitInput);
        assert.equal(prompt.status, 409);
        assert.equal(prompt.body.reason, 'CARTON_SOURCE_REQUIRED');
        assert.equal((await api(2, 'post', '/api/orders/update_item', { ...unitInput, amount: 2, scanSource: 'loose' })).status, 400);
        for (let index = 0; index < 2; index++) ok(await api(2, 'post', '/api/orders/update_item', { ...unitInput, scanSource: 'loose' }));
        assert.equal(ok(await api(2, 'get', '/api/cartons/LEGACY-MIX')).lines[0].remainingQuantity, 8);
        await scan(order.id, { scanValue: carton.cartonId, type: 'pick' });
        await claim(order.id, 'pack', 3);
        const unitPack = { ...unitInput, type: 'pack', amount: 2 };
        ok(await api(3, 'post', '/api/orders/update_item', unitPack));
        assert.equal((await api(3, 'post', '/api/orders/update_item', { ...unitPack, amount: 1 })).status, 409);
        assert.equal((await api(2, 'post', '/api/orders/update_item', { ...unitInput, amount: -1 })).status, 409);
        assert.equal((await api(1, 'patch', `/api/orders/${order.id}/void`, { reason: 'Fixture cancellation' })).status, 409);
        assert.equal((await scan(order.id, { scanValue: carton.cartonId, type: 'pack' }, 3)).order.status, 'completed');
        const sns = ['Legacy-Reserved-SN']; await create(box('LEGACY-SN', 1, sns));
        const serialOrder = await f.seedOrder({ quantity: 1, actualSN: sns });
        const pending = await api(2, 'post', '/api/orders/update_item', { orderId: serialOrder.order.id, scanValue: sns[0], type: 'pick' });
        assert.equal(pending.status, 409);
        assert.equal(ok(await api(2, 'get', '/api/cartons/LEGACY-SN')).lines[0].remainingQuantity, 1);
        await scan(serialOrder.order.id, { scanValue: 'LEGACY-SN', type: 'pick', mode: 'split', selections: [{ lineId: ok(await api(2, 'get', '/api/cartons/LEGACY-SN')).lines[0].lineId, actualSN: sns }] });
        await claim(serialOrder.order.id, 'pack', 3);
        assert.equal((await api(3, 'post', '/api/orders/update_item', { orderId: serialOrder.order.id, scanValue: sns[0], type: 'pack' })).status, 409);
        assert.equal((await api(1, 'post', `/api/orders/${serialOrder.order.id}/defect`, { oldSn: sns[0], newSn: 'New-SN', reason: 'Fixture exchange' })).status, 409);
    });
    await t.test('mixed loose corrections reopen the stage while preserving picked and packed carton reservations', async () => {
        f.attachLegacyRoutes();
        const { order } = await f.seedOrder(), carton = await create(box('LOOSE-UNDO', 8));
        const unit = async (type, amount, user) => {
            if (type === 'pack' && amount > 0 && (await f.db.query('SELECT status FROM orders WHERE id=$1',[order.id])).rows[0].status === 'picked') await claim(order.id, 'pack', user);
            const input = { orderId: order.id, scanValue: '4710000000010', type, amount };
            if (type === 'pick' && amount > 0) {
                const loose = { ...input, amount: 1, scanSource: 'loose' };
                for (let index = 1; index < amount; index++) ok(await api(user, 'post', '/api/orders/update_item', loose));
                return api(user, 'post', '/api/orders/update_item', loose);
            }
            return api(user, 'post', '/api/orders/update_item', input);
        };
        ok(await unit('pick', 2, 2));
        const picked = await scan(order.id, { scanValue: carton.cartonId, type: 'pick' });
        // Synthetic correction fixtures enter the actual work phase first;
        // latest worker permissions do not allow cross-phase unit mutations.
        await f.db.query("UPDATE orders SET status='picking' WHERE id=$1", [order.id]);
        const undoPick = ok(await unit('pick', -2, 2));
        assert.equal(undoPick.order.status, 'picking'); assert.equal(undoPick.items[0].picked_quantity, 8);
        assert.equal((await unit('pick', -1, 2)).status, 409);
        assert.equal((await unit('pack', 1, 3)).status, 409);
        ok(await unit('pick', 2, 2)); await claim(order.id, 'pack', 3); ok(await unit('pack', 2, 3));
        const packed = await scan(order.id, { scanValue: carton.cartonId, type: 'pack' }, 3);
        assert.equal(packed.order.status, 'completed'); assert.ok(packed.order.completed_at);
        await f.db.query("UPDATE orders SET status='packing' WHERE id=$1", [order.id]);
        const undoPack = ok(await unit('pack', -2, 3));
        assert.equal(undoPack.order.status, 'packing'); assert.equal(undoPack.order.completed_at, null);
        assert.equal(undoPack.items[0].packed_quantity, 8);
        assert.equal((await unit('pack', -1, 3)).status, 409);
        await f.db.query("UPDATE orders SET status='picking' WHERE id=$1", [order.id]);
        const undoLoose = ok(await unit('pick', -2, 2));
        assert.equal(undoLoose.order.status, 'picking'); assert.equal(undoLoose.items[0].picked_quantity, 8);
        assert.equal((await unit('pick', -1, 2)).status, 409);
        const current = ok(await api(2, 'get', `/api/cartons/${carton.cartonId}`));
        assert.equal(current.lines[0].remainingQuantity, 0);
        assert.equal(current.stateRevision, packed.carton.stateRevision);
        assert.equal(current.allocations[0].allocationId, picked.allocation.allocationId);
        assert.equal(current.allocations[0].status, 'packed');
        ok(await unit('pick', 2, 2)); await claim(order.id, 'pack', 3); assert.equal(ok(await unit('pack', 2, 3)).order.status, 'completed');
    });
    await t.test('actual SN CSV import and exact raw single scans preserve case; canonical collisions do not fall through', async () => {
        const csv = '\uFEFF憑證號碼：EXACT-CSV\n客戶名稱：Synthetic\n品項編碼,品項名稱,數量,實際SN\n4710000000010,Vendor,2,"Vendor-a02,Vendor-A02"\n';
        const imported = await request(f.app).post('/api/orders/import').set('x-fixture-user', '1').attach('orderFile', Buffer.from(csv), 'exact.csv');
        const result = ok(imported, 201), orderId = result.orderId ?? result.id;
        const actual = (await f.db.query('SELECT i.serial_number FROM order_item_instances i JOIN order_items oi ON oi.id=i.order_item_id WHERE oi.order_id=$1 ORDER BY i.id', [orderId])).rows.map(row => row.serial_number);
        assert.deepEqual(actual, ['Vendor-a02','Vendor-A02']);
        assert.equal((await f.db.query('SELECT serial_identity_mode FROM order_items WHERE order_id=$1', [orderId])).rows[0].serial_identity_mode, 'exact');
        await f.db.query("UPDATE orders SET status='picking',picker_id=2,packer_id=3 WHERE id=$1", [orderId]);
        const ambiguous = await api(2, 'post', '/api/orders/update_item', { orderId, scanValue: 'vendor-a02', type: 'pick' });
        assert.equal(ambiguous.status, 409);
        const first = ok(await api(2, 'post', '/api/orders/update_item', { orderId, scanValue: 'Vendor-a02', type: 'pick' }));
        assert.equal(first.instances.find(row => row.serial_number === 'Vendor-a02').status, 'picked');
        assert.equal(first.instances.find(row => row.serial_number === 'Vendor-A02').status, 'pending');
        ok(await api(2, 'post', '/api/orders/update_item', { orderId, scanValue: 'Vendor-A02', type: 'pick' }));
    });
    await t.test('negative unit SN verification remains usable for a registered carton without restocking or deduction', async () => {
        const sns = ['NEG000000001']; await create(box('NEGATIVE-UNIT', 1, sns));
        const { order } = await f.seedOrder({ quantity: 1, actualSN: sns, sign: -1 });
        ok(await api(2, 'post', '/api/orders/update_item', { orderId: order.id, scanValue: sns[0], type: 'pick' }));
        await claim(order.id, 'pack', 3);
        const packed = ok(await api(3, 'post', '/api/orders/update_item', { orderId: order.id, scanValue: sns[0], type: 'pack' }));
        assert.equal(packed.order.document_type, 'reversal'); assert.equal(packed.order.status, 'completed');
        assert.equal(ok(await api(2, 'get', '/api/cartons/NEGATIVE-UNIT')).lines[0].remainingQuantity, 1);
        assert.equal(ok(await api(2, 'get', '/api/cartons/NEGATIVE-UNIT')).allocations.length, 0);
    });
    await t.test('legacy SN import and new carton binding share custody locks and cannot assign one real SN to two orders', async () => {
        const sn = 'Race-Import-SN'; await create(box('IMPORT-RACE', 1, [sn])); const { order } = await f.seedOrder({ quantity: 1 });
        const input = { scanValue: 'IMPORT-RACE', type: 'pick', serialPolicy: 'from-carton' }, body = scanBody(await preview(order.id, input), input);
        const csv = `\uFEFF憑證號碼：IMPORT-RACE\n客戶名稱：Synthetic\n品項編碼,品項名稱,數量,實際SN\n4710000000010,Vendor,1,${sn}\n`;
        const results = await Promise.all([
            request(f.app).post('/api/orders/import').set('x-fixture-user', '1').attach('orderFile', Buffer.from(csv), 'race.csv'),
            api(2, 'post', `/api/orders/${order.id}/carton-scan`, body)
        ]);
        assert.equal(results.filter(result => [200,201].includes(result.status)).length, 1);
        assert.equal(results.filter(result => result.status === 409).length, 1);
        assert.equal((await f.db.query('SELECT COUNT(*)::int AS n FROM order_item_instances WHERE serial_number=$1', [sn])).rows[0].n, 1);
    });
    await t.test('actual SN CSV to sealed carton to pick and pack retains exact manufacturer case through real HTTP', async () => {
        const sns = ['Chain-v02','Chain-V02'];
        const csv = `\uFEFF憑證號碼：EXACT-CHAIN\n客戶名稱：Synthetic\n品項編碼,品項名稱,數量,實際SN\n4710000000010,Vendor,2,"${sns.join(',')}"\n`;
        const imported = ok(await request(f.app).post('/api/orders/import').set('x-fixture-user', '1').attach('orderFile', Buffer.from(csv), 'chain.csv'), 201);
        const orderId = imported.orderId;
        await f.db.query("UPDATE orders SET status='picking',picker_id=2,packer_id=3 WHERE id=$1", [orderId]);
        await create(box('EXACT-CHAIN', 2, sns, { itemCode: '4710000000010' }));
        await scan(orderId, { scanValue: 'EXACT-CHAIN', type: 'pick' });
        const packed = await scan(orderId, { scanValue: 'EXACT-CHAIN', type: 'pack' }, 3);
        assert.equal(packed.order.status, 'completed');
        assert.deepEqual(packed.instances.map(unit => unit.serial_number), sns);
    });
    await t.test('registered SNs stay protected after allocation release, and vendor exact SN cannot enter legacy editing', async () => {
        const sns = ['EDIT00000001']; await create(box('EDIT-GUARD', 1, sns));
        const { order } = await f.seedOrder({ quantity: 1, actualSN: sns });
        const picked = await scan(order.id, { scanValue: 'EDIT-GUARD', type: 'pick' });
        ok(await api(1, 'post', `/api/cartons/allocations/${picked.allocation.allocationId}/release`, {
            commandId: randomUUID(), expectedState: picked.stateToken, expectedCartonRevision: picked.carton.stateRevision, reason: 'Editing guard fixture'
        }));
        assert.equal((await api(1, 'post', `/api/orders/${order.id}/defect`, { oldSn: sns[0], newSn: 'EDIT00000002', reason: 'Blocked old editor' })).status, 409);
        const plain = await f.seedOrder({ quantity: 1 });
        await assert.rejects(require('../src/services/orderChangeService').applyOrderChangeProposal({
            client: f.pool, orderId: plain.order.id, actorUserId: 1,
            proposal: { note: 'Cannot add registered carton SN with old editor', items: [{ barcode: plain.item.barcode,
                productName: 'Synthetic', quantityChange: 1, noSn: false, snList: sns }] }
        }), { code: 'CARTON_SERIAL_EDIT_GUARD' });
        assert.equal((await f.db.query('SELECT quantity FROM order_items WHERE id=$1', [plain.item.id])).rows[0].quantity, 1);
        const vendor = await f.seedOrder({ quantity: 1, actualSN: ['Vendor-a/A'], serialMode: 'exact' });
        const edit = await api(1, 'post', `/api/orders/${vendor.order.id}/defect`, { oldSn: 'Vendor-a/A', newSn: 'VENDOR-a/B', reason: 'Unsupported legacy editor' });
        assert.equal(edit.status, 409); assert.ok(edit.body.message.includes('實際 SN'));
        assert.equal((await f.db.query('SELECT serial_number FROM order_item_instances WHERE order_item_id=$1', [vendor.item.id])).rows[0].serial_number, 'Vendor-a/A');
        const short = await f.seedOrder({ quantity: 1, actualSN: ['FIX-1'] });
        ok(await api(1, 'post', `/api/orders/${short.order.id}/defect`, { oldSn: 'FIX-1', newSn: 'SN: feature-final', reason: 'Existing short legacy workflow' }));
        assert.equal((await f.db.query('SELECT serial_number FROM order_item_instances WHERE order_item_id=$1', [short.item.id])).rows[0].serial_number, 'FEATURE-FINAL');
    });
    await t.test('unallocated exact or registered SN editing guards do not block unrelated loose order-line changes', async () => {
        const { order, item } = await f.seedOrder({ quantity: 1, actualSN: ['Vendor-c/C'], serialMode: 'exact' });
        const looseId = (await f.db.query("INSERT INTO order_items(order_id,product_code,product_name,barcode,quantity) VALUES($1,'LOOSE','Synthetic loose','LOOSE',2) RETURNING id", [order.id])).rows[0].id;
        const apply = async proposal => {
            const client = await f.pool.connect();
            try {
                await client.query('BEGIN');
                const result = await require('../src/services/orderChangeService').applyOrderChangeProposal({ client, orderId: order.id, actorUserId: 1, proposal });
                await client.query('COMMIT'); return result;
            } catch (error) { await client.query('ROLLBACK'); throw error; }
            finally { client.release(); }
        };
        const loose = { note: 'Ordinary loose line change', items: [{ barcode: 'LOOSE', productName: 'Synthetic loose', quantityChange: 1, noSn: true }] };
        await apply(loose);
        await assert.rejects(apply({ note: 'Do not normalize vendor identity', items: [{ barcode: item.barcode, productName: 'Vendor', quantityChange: -1, noSn: false, removedSnList: ['Vendor-c/C'] }] }), { code: 'EXACT_SN_LEGACY_EDIT_UNSUPPORTED' });
        await create(box('UNALLOCATED-EDITOR', 1, ['Vendor-c/C']));
        await apply(loose);
        await assert.rejects(apply({ note: 'Do not remove registered serial', items: [{ barcode: item.barcode, productName: 'Vendor', quantityChange: -1, noSn: false }] }), { code: 'CARTON_SERIAL_EDIT_GUARD' });
        assert.equal((await f.db.query('SELECT quantity FROM order_items WHERE id=$1', [looseId])).rows[0].quantity, 4);
        assert.equal((await f.db.query('SELECT serial_number FROM order_item_instances WHERE order_item_id=$1', [item.id])).rows[0].serial_number, 'Vendor-c/C');
    });
    await t.test('shipment source snapshots survive released order line edits and include current remainder separately', async () => {

        await create(box('TRACE', 1)); const { order, item } = await f.seedOrder({ quantity: 1 });
        await f.db.query("UPDATE order_items SET source_sku='Full-Campaign-SKU',source_platform='EC',source_store='Store',source_order_number='EC-001',source_line_id='L01' WHERE id=$1", [item.id]);
        const picked = await scan(order.id, { scanValue: 'TRACE', type: 'pick' });
        await api(1, 'post', `/api/cartons/allocations/${picked.allocation.allocationId}/release`, { commandId: randomUUID(), expectedState: picked.stateToken, expectedCartonRevision: picked.carton.stateRevision, reason: 'Trace fixture' });
        await f.db.query("UPDATE order_items SET source_sku='REPLACED',source_line_id='L99' WHERE id=$1", [item.id]);
        const trace = ok(await api(2, 'get', `/api/orders/${order.id}/carton-shipments`)).allocations[0].lines[0];
        assert.equal(trace.sourceSKU, 'Full-Campaign-SKU'); assert.equal(trace.sourceLineId, 'L01'); assert.equal(trace.sourcePlatform, 'EC');
        assert.equal(trace.currentRemainingQuantity, 1);
        await assert.rejects(f.db.query('DELETE FROM orders WHERE id=$1', [order.id]), error => ['23503','23001'].includes(error.code) && error.message.includes('wms_carton_allocations_order_id_fkey'));
    });
}
test('a barcode-only SKU mismatch cannot bind untracked, wrong, ambiguous, or signed units', () => {
    const barcode = '4711299271052';
    const line = { lineId: 1, itemCode: 'MOA11', ean: barcode, remainingQuantity: 2, actualSN: ['S1', 'S2'], remainingSN: ['S1', 'S2'] };
    const carton = { cartonId: 'BOX', lines: [line] };
    const item = { id: 7, product_code: 'ALIAS', international_barcode: barcode, barcode, code_type: 'international', quantity: 1 };
    const assigned = [{ order_item_id: item.id, serial_number: 'S1', status: 'pending' }];
    const body = { mode: 'split', serialPolicy: 'from-carton', selections: [{ lineId: 1, actualSN: ['S1'], quantity: 1 }] };
    assert.equal(choosePickLines(carton, body, [item], assigned)[0].orderItemId, item.id);
    const rejected = (box, orderItems, instances, request = body) => assert.throws(
        () => choosePickLines(box, request, orderItems, instances), { code: 'CARTON_ITEM_NOT_IN_ORDER' });
    rejected(carton, [item], []);
    rejected(carton, [item], [{ ...assigned[0], status: 'picked' }]);
    rejected(carton, [item], [{ ...assigned[0], serial_number: 'S2' }]);
    rejected(carton, [item, { ...item, id: 8, product_code: 'AMBIGUOUS' }], assigned);
    rejected(carton, [{ ...item, quantity_sign: -1 }], assigned);
    rejected(carton, [{ ...item, carton_serial_binding: true }], assigned);
    rejected(carton, [{ ...item, barcode: 'ITM-ALIAS', international_barcode: null, internal_scan_code: 'ITM-ALIAS', code_type: 'internal' }], assigned);
    rejected({ ...carton, lines: [{ ...line, actualSN: [], remainingSN: [] }] }, [item], [], {
        ...body, selections: [{ lineId: 1, quantity: 1 }]
    });
    rejected(carton, [item], assigned, { mode: 'whole', serialPolicy: 'from-carton' });
});

test('carton HTTP + PostgreSQL semantics on disposable PGlite (transactions serialized)', { timeout: 120000 }, t => suite(t, false));
test('carton HTTP + actual multi-connection PostgreSQL lock contention on disposable loopback database', {
    skip: process.env.WMS_CARTON_PG !== '1', timeout: 120000
}, t => suite(t, true));
