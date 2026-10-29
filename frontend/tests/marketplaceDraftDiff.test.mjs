import test from 'node:test';
import assert from 'node:assert/strict';
import { itemDifferences, liveDifferences, orderDifferences, completeComparison, uniqueBlockedReasons } from '../src/utils/marketplaceDraftDiff.mjs';
const item = (sku = 'A', quantity = 1, unitMinor = 10000, lineSubtotalMinor = quantity * unitMinor, name = `商品${sku}`) => ({ sku, name, quantity, unitMinor, lineSubtotalMinor });
const order = (before, after, extra = {}) => ({ changed: true, before: { quantity: 1, totalMinor: 10000, items: before, shipping: {} }, after: { quantity: 1, totalMinor: 10000, items: after, shipping: {} }, ...extra });

test('identical duplicate rows are consumed as a multiset; reordering invents no added or removed item', () => {
  const a=item(),b=item('A',2),c=item('B');
  assert.deepEqual(itemDifferences([a,a,b,c],[b,c,a,a]),[]);
  const changes=itemDifferences([a,a,b],[a,b]);
  assert.equal(changes.length,1);assert.equal(changes[0].kind,'removed');assert.equal(changes[0].before,a);
});
test('exact duplicate matches leave a provable single changed row without swallowing the other same SKU', () => {
  const unchanged=item('A',3),before=item('A',2),after=item('A',1);
  const changes=itemDifferences([before,unchanged],[unchanged,after]);
  assert.equal(changes.length,1);assert.equal(changes[0].kind,'changed');
  assert.deepEqual(changes[0].fields.map(field=>field.field),['quantity','lineSubtotalMinor']);
});
test('ambiguous same-SKU residual rows stay a full before/after group, never index paired', () => {
  for (const [before,after] of [[[item('A',1),item('A',2)],[item('A',3),item('A',4)]],[[item('A',1)],[item('A',2),item('A',3)]]]) {
    const changes=itemDifferences(before,after);assert.equal(changes.length,1);assert.equal(changes[0].kind,'group');
    assert.deepEqual(changes[0].before,before);assert.deepEqual(changes[0].after,after);assert.equal(changes[0].fields,undefined);
  }
});
test('every wholly added or removed duplicate SKU retains its own product name and row', () => {
  const rows=[item('A',1,10000,10000,'黑色'),item('A',2,10000,20000,'白色')];
  assert.deepEqual(itemDifferences([],rows).map(row=>[row.kind,row.name]),[['added','黑色'],['added','白色']]);
  assert.deepEqual(itemDifferences(rows,[]).map(row=>[row.kind,row.name]),[['removed','黑色'],['removed','白色']]);
});
test('quantity, name, unit price and subtotal are independent; unchanged totals do not hide line changes', () => {
  const before=item('A',2,10000,19000,'原名稱'),after=item('A',2,12000,19000,'新名稱');
  const diff=orderDifferences(order([before],[after]));
  assert.deepEqual(diff.items[0].fields.map(row=>row.field),['name','unitMinor']);assert.equal(diff.totalChanged,false);
  assert.equal(itemDifferences([item('A',2)],[item('A',1)])[0].fields[0].field,'quantity');
});
test('adding and removing different SKUs is explicit without showing unchanged products', () => {
  const fixed=item('UNCHANGED'),removed=item('STRAP'),added=item('NEW');
  assert.deepEqual(itemDifferences([fixed,removed],[fixed,added]).map(row=>[row.kind,row.sku]),[['removed','STRAP'],['added','NEW']]);
});
test('missing amounts differ from zero; string phone and postal codes retain leading zero and deletions', () => {
  const diff=orderDifferences(order([item('A',1,null,null)],[item('A',1,0,0)],{before:{quantity:1,totalMinor:null,items:[item('A',1,null,null)],shipping:{phone:'0012345',postalCode:'001',address:'舊址',custom:'其他資料'}},after:{quantity:1,totalMinor:0,items:[item('A',1,0,0)],shipping:{phone:'0012345',postalCode:'002',address:''}}}));
  assert.equal(diff.totalChanged,true);assert.deepEqual(diff.items[0].fields.map(row=>row.field),['unitMinor','lineSubtotalMinor']);
  assert.deepEqual(diff.shipping.map(row=>[row.label,row.before,row.after]),[['郵遞區號','001','002'],['地址','舊址',''],['其他配送資料','其他資料',undefined]]);
});
test('restoring unchanged items and unknown legacy changes stay visible without inventing known changes', () => {
  const before=[item()];const restored=orderDifferences(order(before,before,{restoring:true,changes:[]}));
  assert.equal(restored.restoring,true);assert.equal(restored.items.length,0);assert.equal(restored.otherChanged,false);
  const unknown=orderDifferences(order(before,before));assert.equal(unknown.otherChanged,true);
});
test('shipping-only changes do not repeat API money, but API/export money or quantity divergence remains available', () => {
  const value=order([item()],[item()],{before:{quantity:1,totalMinor:10000,items:[item()],shipping:{address:'甲'}},after:{quantity:1,totalMinor:10000,items:[item()],shipping:{address:'乙'}},live:{totalMinor:10000,quantity:1}});
  assert.equal(orderDifferences(value).showLiveAmounts,false);
  value.live.totalMinor=20000;assert.equal(orderDifferences(value).showLiveAmounts,true);
  value.live.quantity=2;assert.equal(orderDifferences(value).liveQuantityChanged,true);
});
test('only complete projected orders and accurate file sums can be presented or confirmed', () => {
  const after={quantity:1,totalMinor:0,items:[item('A',1,0,0)]};const data={summary:{totalOrderCount:1,quantity:1,totalMinor:0},newOrders:[{after}],affectedBatches:[]};
  assert.equal(completeComparison(data),true);
  for(const after of [{quantity:0,totalMinor:0,items:[]},{quantity:1,totalMinor:null,items:[item()]},{quantity:1,totalMinor:10000,items:[item()]}])assert.equal(completeComparison({...data,newOrders:[{after}]}),false);
  assert.equal(completeComparison(null),false);
});
test('block reasons deduplicate without assigning order numbers that were not supplied', () => {
  assert.deepEqual(uniqueBlockedReasons([' 已出貨 ','已出貨',{message:'已出貨'},{message:'待核對',orderNumber:'#KNOWN'}]),['已出貨','#KNOWN：待核對']);
});


test('API-only differences need actual numeric evidence; a flag, missing value or null never implies zero', () => {
  const value={after:{totalMinor:0,quantity:1},live:{totalMinor:0,quantity:2},diffAPI:true};
  assert.deepEqual(liveDifferences(value),{money:false,quantity:true});
  for(const live of [{},{totalMinor:null},{totalMinor:'1'},{totalMinor:undefined}])assert.deepEqual(liveDifferences({...value,live}),{money:false,quantity:false});
});
