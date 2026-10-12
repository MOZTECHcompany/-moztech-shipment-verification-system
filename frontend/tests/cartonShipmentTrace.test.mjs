import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildCartonShipmentTrace} from '../src/utils/cartonShipmentTrace.mjs';
const fixture=()=>({order:{id:7,voucher_number:'WT-AUDIT-1',source_platform:'1Shop',source_store:'AUDIT-STORE',source_order_number:'AUDIT-ORDER'},batchNumber:'AUDIT-BATCH',ecountVouchers:['AUDIT-ERP-SAVED'],allocations:[{allocationId:1,cartonId:'AUDIT-CARTON-1',contentRevision:2,status:'packed',pickedAt:'2026-10-12T01:00:00Z',packedAt:'2026-10-12T01:05:00Z',lines:[{lineId:1,orderItemId:9,itemCode:'AUDIT-ITEM',ean:null,internalScanCode:'ITM-AUDIT',quantity:2,quantitySign:1,actualSN:['AUDITSN00001','AUDITSN00002'],sourceSKU:'0012345678905-團主-第01團',sourceLineId:'AUDIT-LINE'}]}]});
test('one row per actual SN preserves full SKU and original ECOUNT reference',()=>{
 const result=buildCartonShipmentTrace(fixture());assert.equal(result.rows.length,2);
 const value=(row,name)=>row[result.headers.indexOf(name)];
 assert.deepEqual(result.rows.map(r=>value(r,'實際SN')),['AUDITSN00001','AUDITSN00002']);
 assert.deepEqual(result.rows.map(r=>value(r,'數量')),[1,1]);
 assert.equal(value(result.rows[0],'國際條碼'),'');assert.equal(value(result.rows[0],'內部掃描碼'),'ITM-AUDIT');
 assert.equal(value(result.rows[0],'完整來源SKU'),'0012345678905-團主-第01團');
 assert.equal(value(result.rows[0],'ECOUNT已核對單號'),'AUDIT-ERP-SAVED');
 assert.match(result.purpose,/不可作為新的銷貨/);
});
test('no-SN cartons keep actual quantity and released history remains marked',()=>{
 const f=fixture();f.allocations[0].lines[0].actualSN=[];f.allocations[0].status='released';f.allocations[0].releaseReason='AUDIT correction';
 const result=buildCartonShipmentTrace(f);assert.equal(result.rows.length,1);assert.equal(result.rows[0][result.headers.indexOf('數量')],2);assert.equal(result.rows[0][result.headers.indexOf('作業狀態')],'已解除');
});
test('missing source identity remains blank rather than copying product or WMS identity',()=>{
 const f=fixture();delete f.order.source_order_number;delete f.allocations[0].lines[0].sourceSKU;delete f.ecountVouchers;
 const result=buildCartonShipmentTrace(f),row=result.rows[0];assert.equal(row[result.headers.indexOf('完整來源SKU')],'');assert.equal(row[result.headers.indexOf('商城訂單編號')],'');assert.equal(row[result.headers.indexOf('ECOUNT已核對單號')],'');
});
test('duplicate allocation rows, partial SN lists and signed reversal quantities reject',()=>{
 for(const mutate of [f=>f.allocations[0].lines.push({...f.allocations[0].lines[0]}),f=>f.allocations[0].lines[0].actualSN.pop(),f=>f.allocations[0].lines[0].quantitySign=-1]){
  const f=fixture();mutate(f);assert.throws(()=>buildCartonShipmentTrace(f));
 }
});
