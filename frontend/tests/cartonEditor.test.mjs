import test from 'node:test';
import assert from 'node:assert/strict';
import { appendCartonSerial, blankCartonLine, canManageCartons, cartonLabelSize, editorLinePayload, pendingBoxCreationKey, uniqueExactCartonItem } from '../src/utils/cartonEditor.js';
import { isCartonScan } from '../src/utils/cartonScan.js';

test('new carton quantities require an explicit physical count, and every administrator scope can manage cartons', () => {
    const line=blankCartonLine();assert.equal(line.quantity,'');assert.equal(line.hasSerials,false);
    assert.throws(()=>editorLinePayload([{...line,itemCode:'SKU'}]),/實際數量/);
    for(const role of ['admin','superadmin']) for(const management_scope of ['orders','warehouse','all']) assert.equal(canManageCartons({role,management_scope}),true);
    for(const role of ['picker','packer','dispatcher']) assert.equal(canManageCartons({role}),false);
});
test('only one exact barcode or item match can be selected by scanner Enter; names or partial guesses never resolve ambiguity',()=>{
    const a={itemCode:'A01',productName:'商品A',importedBarcode:'0012345'},b={itemCode:'A02',productName:'商品B',importedBarcode:'0012345'};
    assert.strictEqual(uniqueExactCartonItem([a],'0012345'),a);
    assert.equal(uniqueExactCartonItem([a,b],'0012345'),null);
    assert.equal(uniqueExactCartonItem([a],'12345'),null);
    assert.equal(uniqueExactCartonItem([a],'商品'),null);
});
test('SN scans preserve exact case and leading zeroes, and duplicate or oversized attempts never alter the accepted list',()=>{
    let lines=[{...blankCartonLine(),itemCode:'A',quantity:2},{...blankCartonLine(),itemCode:'B',quantity:1}];
    lines=appendCartonSerial(lines,0,'000Vendor-a');lines=appendCartonSerial(lines,0,'000Vendor-A');
    assert.deepEqual(editorLinePayload(lines.slice(0,1))[0].actualSN,['000Vendor-a','000Vendor-A']);
    const before=structuredClone(lines);
    assert.throws(()=>appendCartonSerial(lines,1,'000Vendor-a'),/品項 1/);
    assert.throws(()=>appendCartonSerial(lines,0,'ThirdSN'),/掃滿/);
    assert.throws(()=>appendCartonSerial(lines,1,'CARTON:N1'),/實際 SN/);
    assert.deepEqual(lines,before);
});
test('pasted duplicate SN, cross-line duplicates, hidden SN and incomplete counts are explicit review errors',()=>{
    const line={...blankCartonLine(),itemCode:'A',quantity:2,hasSerials:true,serialInput:'S1\nS1'};
    assert.throws(()=>editorLinePayload([line]),/重複/);
    assert.throws(()=>editorLinePayload([{...line,serialInput:'S1'}]),/已掃 1／2/);
    assert.throws(()=>editorLinePayload([{...line,hasSerials:false}]),/已有 SN/);
    assert.throws(()=>editorLinePayload([{...line,quantity:1,serialInput:'S1'},{...line,itemCode:'B',quantity:1,serialInput:'S1'}]),/重複/);
});
test('box specifications omit SN entirely and preserve confirmed barcode identities; spec QR never looks like a product SN',()=>{
    const line={...blankCartonLine(),itemCode:'A',quantity:10,ean:'0012345',internalScanCode:''};
    const saved=editorLinePayload([line],'spec')[0];assert.equal(saved.ean,'0012345');assert.equal('actualSN' in saved,false);
    assert.throws(()=>editorLinePayload([{...line,hasSerials:true}],'spec'),/序號箱/);
    assert.equal(isCartonScan('BOX-SPEC:BSP-1'),true);
    assert.notEqual(pendingBoxCreationKey(7,'BSP-1'),pendingBoxCreationKey(8,'BSP-1'));
});
test('thermal paper sizes are numeric and bounded, with a scalable QR retaining a usable physical size',()=>{
    assert.deepEqual(cartonLabelSize(60,75),{width:60,height:75,qr:50});
    assert.deepEqual(cartonLabelSize(70,100),{width:70,height:100,qr:62});
    assert.throws(()=>cartonLabelSize('60;bad',75));assert.throws(()=>cartonLabelSize(20,75));assert.throws(()=>cartonLabelSize(60,1000));
});
