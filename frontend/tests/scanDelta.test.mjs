import test from 'node:test';
import assert from 'node:assert/strict';
import { makeScanCommand, applyScanResponse, sendScanCommand } from '../src/utils/scanDelta.js';
const snapshot = () => ({order:{id:1,picker_name:'Picker'},items:[{id:11,order_id:1,picked_quantity:0},{id:12,order_id:1}],instances:[{id:21,order_item_id:11,status:'pending'},{id:22,order_item_id:11,status:'pending'}],stateToken:'a'.repeat(64)});
const delta = () => ({format:'delta-v1',order:{id:1,status:'picking'},baseState:'a'.repeat(64),stateToken:'b'.repeat(64),item:null,instance:{id:21,order_item_id:11,status:'picked'}});
test('delta replaces only the changed serial and preserves other object identities',()=>{
    const before=snapshot(),after=applyScanResponse(before,delta());
    assert.equal(after.order.picker_name,'Picker');assert.equal(after.items,before.items);assert.equal(after.instances[1],before.instances[1]);assert.equal(after.instances[0].status,'picked');assert.equal(before.instances[0].status,'pending');
});
test('stale or foreign deltas cannot overwrite a newer order',()=>{
    assert.throws(()=>applyScanResponse({...snapshot(),stateToken:'c'.repeat(64)},delta()));
    assert.throws(()=>applyScanResponse(snapshot(),{...delta(),order:{id:2}}));
    assert.throws(()=>applyScanResponse(snapshot(),{...delta(),instance:{id:99,order_item_id:11}}));
});
test('lost response retries the exact same durable command once',async()=>{
    const command=makeScanCommand(snapshot(),{orderId:1,scanValue:'S',type:'pick'}),calls=[];
    const api={post:async(url,body)=>{calls.push(body);if(calls.length===1)throw Error('lost response');return{data:delta()}}};
    await sendScanCommand(api,command);assert.equal(calls.length,2);assert.equal(calls[0],calls[1]);assert.equal(calls[0].commandId,calls[1].commandId);
});
test('legacy, confirmed rejection and conflicting commands are never automatically retried',async()=>{
    for(const [body,error] of [[{orderId:1},Error('lost')],[{commandId:'x'},{response:{status:503,data:{code:'SCAN_NOT_APPLIED'}}}],[{commandId:'x'},{response:{status:409,data:{}}}]]){
        let n=0;await assert.rejects(sendScanCommand({post:async()=>{n++;throw error}},body));assert.equal(n,1);
    }
});
