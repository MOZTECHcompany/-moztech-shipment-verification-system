import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { transform } from 'esbuild';
const require = createRequire(import.meta.url);
const {code} = await transform(await readFile(new URL('../src/components/CorelyHandover.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs'});
const module = {exports:{}};
vm.runInNewContext(code,{module,exports:module.exports,require:name=>name==='@/api/api.js'?{}:name==='@/ui'?{}:require(name)});
const {selectedHandoverLines,deliveryLabel}=module.exports;
test('partial shipment uses original line identity even for repeated SKU and accounts for handed over quantity',()=>{
    const rows=[{salesOrderLineId:'line-1',sku:'0001',availableQuantity:40},{salesOrderLineId:'line-2',sku:'0001',availableQuantity:2}];
    const out=selectedHandoverLines(rows,{'line-1':{quantity:'40',packageId:'BOX-2'},'line-2':{quantity:''}});
    assert.equal(out.length,1);assert.equal(out[0].salesOrderLineId,'line-1');assert.equal(out[0].quantity,40);assert.equal(out[0].packages[0].packageId,'BOX-2');
    assert.throws(()=>selectedHandoverLines(rows,{'line-1':{quantity:41,packageId:'BOX'}}));
    assert.throws(()=>selectedHandoverLines(rows,{'line-1':{quantity:1,packageId:' '}}));
});
test('ERP receipt and local handover do not claim inventory posting',()=>{
    assert.match(deliveryLabel('acknowledged'),/待核銷/);
    assert.match(deliveryLabel('retry'),/交運已記錄.*重試/);
    for(const s of ['acknowledged','retry','pending','rejected'])assert.doesNotMatch(deliveryLabel(s),/已扣庫|已核銷|已過帳/);
});
