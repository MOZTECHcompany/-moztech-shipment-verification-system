// Synthetic files and disposable in-memory PostgreSQL only. Never reads DB env.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const xlsx = require('xlsx');
const request = require('supertest');
const { parseOrderRows, parseOrderImport, IMPORT_LIMITS } = require('../src/services/orderImportParser');
const { withShippingNotes } = require('../src/services/scanSnapshot');
const { createCartonFixture } = require('./cartonFixture.cjs');
const { assertSchemaReady } = require('../src/config/schemaReadiness');
const header = ['品項編碼','品項名稱','數量','品項型號','國際條碼','實際SN','摘要'];
const goods = ['4710000000010','Synthetic goods',1,'ITEM'];
const note = ['WMS-NOTE','請分兩箱，保留外盒\n客戶採購單號：PO-123',0];
const rows = (lines = [goods,note], voucher = 'NOTE-FIXTURE') => [['理貨單'],['憑證號碼：'+voucher],['客戶名稱：Synthetic customer'],[...header],...lines];
function file(data, bookType='xlsx') {
    const book=xlsx.utils.book_new();xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet(data),'理貨');
    return xlsx.write(book,{type:'buffer',bookType});
}
function rejects(input, pattern, status=400) {
    assert.throws(()=>parseOrderRows(input), error => error.code==='IMPORT_NOT_APPLIED' && error.status===status && pattern.test(error.message));
}
for (const format of ['xlsx','biff8','csv']) test(`${format}: notes remain separate from signed products and exact SN`,()=>{
    const parsed=parseOrderImport(file(rows([goods,note,['4710000000027','Negative goods',-1,'RETURN','','SN-exact-002'],[' WMS-NOTE ','第二段', '']]),format));
    assert.deepEqual(parsed.shippingNotes,[{sourceRow:6,text:note[1]},{sourceRow:8,text:'第二段'}]);
    assert.equal(parsed.documentType,'adjustment');assert.equal(parsed.items.length,2);
    assert.deepEqual(parsed.items.map(i=>i.quantity),[1,-1]);assert.equal(parsed.totalQuantity,2);assert.equal(parsed.signedTotalQuantity,0);
    assert.equal(parsed.serialCount,1);assert.deepEqual(parsed.items[1].serials,['SN-exact-002']);
});
test('physical barcode column before actual item code does not affect note classification',()=>{
    const input=[['憑證號碼：SPLIT'],['客戶名稱：Fixture'],['國際條碼','品項名稱','數量','品項編碼'],['4710000000010','Goods',1,'SKU'],['','Instructions',0,'WMS-NOTE']];
    assert.deepEqual(parseOrderRows(input).shippingNotes,[{sourceRow:5,text:'Instructions'}]);
});
test('legacy combined item-code header accepts marker; ordinary documents expose empty notes',()=>{
    const input=rows();input[3][0]='品項編碼／國際條碼';
    assert.equal(parseOrderRows(input).shippingNotes.length,1);
    assert.deepEqual(parseOrderRows(rows([goods])).shippingNotes,[]);
});
for(const value of [1,-1,'0.5','bad']) test(`invalid note quantity ${value} reports source row`,()=>rejects(rows([goods,[...note.slice(0,2),value]]),/第 6 列.*數量只能/));
test('missing name fails even if summary contains instructions',()=>rejects(rows([goods,['WMS-NOTE','',0,'','','','Instructions']]),/第 6 列.*品項名稱/));
for(const [column,value,label] of [[4,'4710000000010','physical barcode'],[5,'SN-1','actual SN'],[6,'SN:B19B52004735','prefixed summary SN'],[6,'B19B52004735','plain summary SN']]) test(`note rejects ${label}`,()=>{
    const line=[...note];line[column]=value;rejects(rows([goods,line]),/第 6 列.*(?:條碼|SN)/);
});
test('every dedicated serial column must be empty',()=>{const input=rows();input[3]=[...header,'SN列表'];input[5]=[...note,'','','','','SN-2'];rejects(input,/第 6 列.*SN/);});
for(const [code,model] of [['wms-note',''],['XWMS-NOTE',''],['REAL-SKU','WMS-NOTE'],['WMS-NOTE2','']]) test(`zero genuine item ${code}/${model} is not skipped`,()=>rejects(rows([goods,[code,'Real item',0,model]]),/第 6 列.*非零整數/));
test('standalone barcode marker is not an import instruction',()=>{
    const input=rows();input[3]=['國際條碼','品項名稱','數量','品項型號'];rejects(input,/第 6 列.*非零整數/);
});
test('notes-only document cannot create a shipment',()=>rejects(rows([note]),/沒有可匯入的品項/));
test('notes cannot supply document identity, including legacy fixed-row fallback',()=>{
    const missing=rows([goods,['WMS-NOTE','訂單編號：FAKE / 客戶名稱：FAKE',0]]);missing[1]=[];missing[2]=[];
    rejects(missing,/找不到訂單號碼/);
    missing[1]=['憑證號碼：REAL'];assert.equal(parseOrderRows(missing).customerName,null);
    rejects([header,['WMS-NOTE','訂單編號：FAKE',0],['WMS-NOTE','客戶名稱：FAKE',0],goods],/找不到訂單號碼/);
    const valid=parseOrderRows(rows([goods,['WMS-NOTE','訂單編號：FAKE / 客戶名稱：FAKE',0]]));
    assert.equal(valid.voucherNumber,'NOTE-FIXTURE');assert.equal(valid.customerName,'Synthetic customer');
});
test('note count and text bounds stop oversized snapshots with row-specific errors',()=>{
    rejects(rows([goods,['WMS-NOTE','字'.repeat(IMPORT_LIMITS.shippingNoteCharacters+1),0]]),/第 6 列.*最多/,413);
    rejects(rows([goods,...Array.from({length:101},()=>['WMS-NOTE','短備註',0])]),/第 106 列.*最多/,413);
    rejects(rows([goods,...Array.from({length:6},()=>['WMS-NOTE','字'.repeat(2000),0])]),/第 11 列.*最多/,413);
});
test('legacy receipt compatibility preserves stored token and does not mutate receipt',()=>{
    const old={order:{id:1},stateToken:'unchanged',commandId:'unchanged'};
    assert.deepEqual(withShippingNotes(old),{...old,order:{id:1,shipping_notes:[]}});assert.deepEqual(old.order,{id:1});
    const current={order:{id:1,shipping_notes:[{sourceRow:6,text:'Instructions'}]}};
    assert.equal(withShippingNotes(current),current);assert.equal(withShippingNotes(undefined),undefined);
});

test('real SQL import: atomic notes, signed quantities, readback, duplicate protection and rollback',async t=>{
    const f=await createCartonFixture();t.after(()=>f.close());f.attachLegacyRoutes();
    const api=(method,path,body)=>{
        const call=request(f.app)[method](path).set('x-fixture-user','1');return body===undefined?call:call.send(body);
    };
    const ok=(response,status=200)=>{assert.equal(response.status,status,JSON.stringify(response.body));return response.body;};
    const upload=input=>request(f.app).post('/api/orders/import').set('x-fixture-user','1').attach('orderFile',file(input),'fixture.xlsx');
    const expected=[{sourceRow:6,text:note[1]}];
    const events=[];f.app.set('io',{emit:(...args)=>events.push(args),to:()=>({emit:(...args)=>events.push(args)})});
    await assertSchemaReady(f.pool);
    const imported=ok(await upload(rows([goods,note,['4710000000027','Return',-1,'RETURN']])),201);
    assert.equal(imported.shippingNoteCount,1);assert.equal(imported.itemCount,2);assert.equal(imported.totalQuantity,2);assert.equal(imported.documentType,'adjustment');
    const orderId=imported.orderId;
    assert.deepEqual((await f.db.query('SELECT shipping_notes FROM orders WHERE id=$1',[orderId])).rows[0].shipping_notes,expected);
    assert.deepEqual((await f.db.query('SELECT quantity,quantity_sign FROM order_items WHERE order_id=$1 ORDER BY id',[orderId])).rows,[{quantity:1,quantity_sign:1},{quantity:1,quantity_sign:-1}]);
    assert.equal((await f.db.query('SELECT details::jsonb AS details FROM operation_logs WHERE order_id=$1',[orderId])).rows[0].details.shippingNoteCount,1);
    for(const path of [`/api/orders/${orderId}/work-snapshot`,`/api/orders/${orderId}`]) assert.deepEqual(ok(await api('get',path)).order.shipping_notes,expected);
    assert.deepEqual(ok(await api('patch',`/api/orders/${orderId}/urgent`,{isUrgent:true})).order.shipping_notes,expected);
    const priorCounts=(await f.db.query('SELECT (SELECT COUNT(*)::int FROM orders) AS orders,(SELECT COUNT(*)::int FROM order_items) AS items,(SELECT COUNT(*)::int FROM operation_logs) AS logs')).rows[0];
    const priorEvents=events.length;f.failNext(sql=>sql.startsWith('INSERT INTO operation_logs'));
    const failed=await upload(rows([goods,note],'NOTES-ROLLBACK'));assert.equal(failed.status,500);assert.equal(failed.body.code,'IMPORT_NOT_APPLIED');
    assert.equal((await f.db.query("SELECT COUNT(*)::int AS n FROM orders WHERE voucher_number='NOTES-ROLLBACK'")).rows[0].n,0);
    assert.deepEqual((await f.db.query('SELECT (SELECT COUNT(*)::int FROM orders) AS orders,(SELECT COUNT(*)::int FROM order_items) AS items,(SELECT COUNT(*)::int FROM operation_logs) AS logs')).rows[0],priorCounts);assert.equal(events.length,priorEvents);
    const duplicate=await upload(rows([goods,['WMS-NOTE','Replacement must not apply',0]]));assert.equal(duplicate.status,409);
    assert.deepEqual(ok(await api('get',`/api/orders/${orderId}/work-snapshot`)).order.shipping_notes,expected);
    await f.db.query('ALTER TABLE orders ALTER COLUMN shipping_notes TYPE text USING shipping_notes::text');
    await assert.rejects(assertSchemaReady(f.pool),error=>error.code==='SCHEMA_NOT_READY' && error.reason==='ORDER_SHIPPING_NOTES_SCHEMA_MISMATCH');
});
