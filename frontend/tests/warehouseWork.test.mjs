import test from 'node:test';
import assert from 'node:assert/strict';
import {stageCanScan,stageOwner,stagePaused,stageForOrder,workActorLabel} from '../src/utils/warehouseWork.js';
test('phase is explicit and a picked order cannot silently accept a packing scan',()=>{
    const user={id:1,role:'picker'},order={status:'picked',picker_id:1,packer_id:null};
    assert.equal(stageCanScan(order,'pick',user,true),false);
    assert.equal(stageCanScan(order,'pack',user,true),false);
    assert.equal(stageCanScan({...order,status:'packing',packer_id:1},'pack',user,true),true);
    assert.equal(stageCanScan({...order,status:'packing',packer_id:1},'pack',user,false),false);
});
test('pause and handoff reject old work while preserving actor-aware admin assistance',()=>{
    const order={status:'picking',picker_id:2,pick_paused_at:null};
    assert.equal(stageOwner(order,'pick'),2);assert.equal(stagePaused(order,'pick'),false);
    assert.equal(stageCanScan(order,'pick',{id:1,role:'picker'},true),false);
    assert.equal(stageCanScan(order,'pick',{id:1,role:'admin'},true),true);
    assert.equal(stageCanScan({...order,pick_paused_at:'2026-10-13T01:00:00Z'},'pick',{id:1,role:'admin'},true),false);
});
test('historical actor role and manager division come from immutable snapshot',()=>{
    assert.equal(workActorLabel({user_role:'picker',actor_snapshot:{role:'admin',management_scope:'orders'}}),'訂單管理員');
    assert.equal(workActorLabel({actor_snapshot:{role:'admin',management_scope:'warehouse'}}),'倉儲管理員');
    assert.equal(workActorLabel({actor_snapshot:{role:'superadmin'}}),'系統管理員');
    assert.equal(stageForOrder('picking'),'pick');assert.equal(stageForOrder('picked'),'pack');
});
