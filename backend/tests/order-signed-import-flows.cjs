const assert = require('node:assert/strict');
const xlsx = require('xlsx');
const {randomUUID} = require('node:crypto');
const Papa = require('papaparse');

// Signed ERP documents are separate, independently verified tasks. The workflow
// harness supplies a disposable loopback database; no live orders are touched.
module.exports = async ({t,api,ok,pool,users,observedEvents}) => {
    const line = (barcode,quantity,serials=[]) => ({barcode,productName:'Signed '+barcode,quantity,serials});
    function file(voucher,lines,original) {
        const rows=[['理貨單'],['憑證號碼：'+voucher],['接收-客戶/供應商：Signed customer'],['出庫倉庫：Fixture']];
        if (original) rows.push(['原單號：'+original]);
        rows.push(['品項編碼','品項名稱(規格)','數量','SN']);
        for (const item of lines) rows.push([item.barcode,item.productName,item.quantity,item.serials.join('/')]);
        rows.push(['2026/10/02 (五) 12:34:56']);
        const book=xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet(rows),'理貨單');
        return xlsx.write(book,{type:'buffer',bookType:'xlsx'});
    }
    function upload(voucher,lines,{role='orderManager',original}={}) {
        const form=new FormData();
        form.set('orderFile',new Blob([file(voucher,lines,original)]),'signed-fixture.xlsx');
        return api(role,'POST','/api/orders/import',form);
    }
    const scan=(role,orderId,value,type)=>api(role,'POST','/api/orders/update_item',{orderId,scanValue:value,type});
    const state=async id=>(await pool.query('SELECT status FROM orders WHERE id=$1',[id])).rows[0].status;
    async function stored(id) {
        return {
            order:(await pool.query('SELECT * FROM orders WHERE id=$1',[id])).rows[0],
            items:(await pool.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY id',[id])).rows,
            instances:(await pool.query('SELECT i.* FROM order_item_instances i JOIN order_items oi ON oi.id=i.order_item_id WHERE oi.order_id=$1 ORDER BY i.id',[id])).rows,
            logs:(await pool.query('SELECT * FROM operation_logs WHERE order_id=$1 ORDER BY id',[id])).rows,
            comments:(await pool.query('SELECT * FROM task_comments WHERE order_id=$1 ORDER BY id',[id])).rows,
            exceptions:(await pool.query('SELECT * FROM order_exceptions WHERE order_id=$1 ORDER BY id',[id])).rows
        };
    }
    const totals=async()=>Object.fromEntries(await Promise.all(['orders','order_items','order_item_instances','operation_logs','task_comments'].map(async table=>[table,(await pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n])));
    let oldId,oldState,negativeId,mixedId,positiveId;
    const realNegativeBarcode='4711299274640',realPositiveBarcode='4711299274633';

    await t.test('migration defaults preserve ordinary legacy shipments and signed imports never look up or mutate a previous completed order',async()=>{
        oldId=(await pool.query("INSERT INTO orders(voucher_number,customer_name,status,picker_id,packer_id,completed_at) VALUES('SIGNED-OLD','Signed customer','completed',$1,$2,NOW()) RETURNING id",[users.picker,users.packer])).rows[0].id;
        await pool.query('INSERT INTO order_items(order_id,product_code,barcode,product_name,quantity,picked_quantity,packed_quantity) VALUES($1,$2,$2,$3,2,2,2)',[oldId,realNegativeBarcode,'Signed '+realNegativeBarcode]);
        await pool.query("INSERT INTO operation_logs(order_id,user_id,action_type,details) VALUES($1,$2,'import','{}')",[oldId,users.dispatcher]);
        ok(await api('picker','POST',`/api/tasks/${oldId}/comments`,{content:'Preserve old order history',priority:'important'}),201);
        oldState=await stored(oldId);
        assert.equal(oldState.order.document_type,'shipment');assert.equal(oldState.items[0].quantity_sign,1);
        const imported=ok(await upload('SIGNED-NEGATIVE',[line(realNegativeBarcode,-2)],{original:'SIGNED-OLD'}),201);
        negativeId=imported.orderId;
        assert.notEqual(negativeId,oldId);assert.equal(imported.documentType,'reversal');
        assert.equal(imported.totalQuantity,2);assert.equal(imported.signedTotalQuantity,-2);
        assert.equal(imported.positiveQuantity,0);assert.equal(imported.negativeQuantity,2);
        assert.deepEqual(await stored(oldId),oldState,'The previous order stays completed with exactly the same history');
        const negative=await stored(negativeId);
        assert.equal(negative.order.document_type,'reversal');assert.equal(negative.order.status,'pending');
        assert.deepEqual(negative.items.map(row=>[row.quantity,row.quantity_sign,row.picked_quantity,row.packed_quantity]),[[2,-1,0,0]]);
        assert.ok(observedEvents.some(event=>event.event==='new_task'&&event.body.id===negativeId));
        assert.ok(!observedEvents.some(event=>event.event==='order_change_notice'&&event.body.orderId===oldId));
    });
    await t.test('mixed minus one and plus one remains a two-unit fresh task even when its signed net is zero',async()=>{
        const imported=ok(await upload('SIGNED-MIXED',[line(realNegativeBarcode,-1),line(realPositiveBarcode,1)]),201);
        mixedId=imported.orderId;assert.equal(imported.documentType,'adjustment');
        assert.equal(imported.totalQuantity,2);assert.equal(imported.signedTotalQuantity,0);
        assert.equal(imported.positiveQuantity,1);assert.equal(imported.negativeQuantity,1);
        const view=ok(await api('picker','GET',`/api/orders/${mixedId}`));
        assert.equal(view.order.status,'pending');assert.equal(view.order.document_type,'adjustment');
        assert.deepEqual(view.items.map(item=>[item.barcode,item.quantity,item.quantity_sign,item.signed_quantity]),[[realNegativeBarcode,1,-1,-1],[realPositiveBarcode,1,1,1]]);
        const snapshot=ok(await api('picker','GET',`/api/orders/${mixedId}/work-snapshot`));
        assert.equal(snapshot.order.document_type,'adjustment');
        assert.deepEqual(snapshot.items.map(item=>item.signed_quantity),[-1,1]);
        const listed=ok(await api('warehouseManager','GET','/api/tasks?pagination=cursor&q=SIGNED-MIXED'));
        assert.equal(listed.items[0].document_type,'adjustment');
        assert.equal(await state(mixedId),'pending','Neither GET nor net-zero totals complete a task');
    });
    await t.test('signed tasks use regular batch claims and require absolute quantities in both picking and packing',async()=>{
        const claim=ok(await api('picker','POST','/api/orders/batch/claim',{orderIds:[negativeId,mixedId],stage:'pick'}));
        assert.deepEqual(claim.results.success,[negativeId,mixedId]);
        ok(await scan('picker',mixedId,realNegativeBarcode,'pick'));
        assert.equal(await state(mixedId),'picking','The positive replacement unit still requires picking');
        const afterFirst=ok(await api('picker','GET',`/api/orders/${mixedId}`));assert.equal(afterFirst.order.status,'picking');
        ok(await scan('picker',mixedId,realPositiveBarcode,'pick'));assert.equal(await state(mixedId),'picked');
        for(let index=0;index<2;index++)ok(await scan('picker',negativeId,realNegativeBarcode,'pick'));
        const pack=ok(await api('packer','POST','/api/orders/batch/claim',{orderIds:[negativeId,mixedId],stage:'pack'}));
        assert.deepEqual(pack.results.success,[negativeId,mixedId]);
        ok(await scan('packer',mixedId,realNegativeBarcode,'pack'));assert.equal(await state(mixedId),'packing');
        ok(await scan('packer',mixedId,realPositiveBarcode,'pack'));assert.equal(await state(mixedId),'completed');
        for(let index=0;index<2;index++)ok(await scan('packer',negativeId,realNegativeBarcode,'pack'));
        assert.equal(await state(negativeId),'completed');
        assert.deepEqual(await stored(oldId),oldState);
    });
    await t.test('positive shipment imports and duplicate voucher protection retain the existing contract',async()=>{
        const imported=ok(await upload('SIGNED-POSITIVE',[line('SIGNED-POSITIVE-BARCODE',2)]),201);
        positiveId=imported.orderId;assert.equal(imported.documentType,'shipment');
        assert.equal(imported.totalQuantity,2);assert.equal(imported.signedTotalQuantity,2);assert.equal(imported.negativeQuantity,0);
        const before=await totals(),original=await stored(mixedId);
        for(const lines of [[line(realNegativeBarcode,-1),line(realPositiveBarcode,1)],[line(realNegativeBarcode,-5)]]) {
            const duplicate=await upload('SIGNED-MIXED',lines);
            assert.equal(duplicate.status,409,JSON.stringify(duplicate.data));
        }
        assert.deepEqual(await totals(),before);assert.deepEqual(await stored(mixedId),original);
    });
    await t.test('completed signed CSV reports preserve negative and net-zero quantities separately from absolute verification work',async()=>{
        await pool.query("UPDATE orders SET completed_at='2026-10-02T04:00:00Z',updated_at='2026-10-02T04:00:00Z' WHERE id=ANY($1::int[])",[[negativeId,mixedId]]);
        const result=ok(await api('warehouseManager','GET','/api/reports/export?startDate=2026-10-02&endDate=2026-10-02'));
        const rows=Papa.parse(result.replace(/^\uFEFF/,''),{header:true,skipEmptyLines:true}).data;
        const negative=rows.find(row=>row['訂單編號']==='SIGNED-NEGATIVE');
        assert.ok(negative);assert.equal(negative['出貨總件數'],'-2');assert.equal(negative['核對總件數'],'2');
        assert.equal(negative['新增件數'],'0');assert.equal(negative['沖正件數'],'2');
        const mixed=rows.find(row=>row['訂單編號']==='SIGNED-MIXED');
        assert.ok(mixed);assert.equal(mixed['出貨總件數'],'0');assert.equal(mixed['核對總件數'],'2');
        assert.equal(mixed['新增件數'],'1');assert.equal(mixed['沖正件數'],'1');
        assert.ok(mixed['理貨單類型']);assert.notEqual(mixed['理貨單類型'],negative['理貨單類型']);
        assert.deepEqual(await stored(oldId),oldState);
    });
    await t.test('same barcode with opposite signs requires explicit direction and retains its sign in compact scan responses',async()=>{
        const result=ok(await upload('SIGNED-SAME-BARCODE',[line('SIGNED-SAME-CODE',-1),line('SIGNED-SAME-CODE',1)]),201);
        const id=result.orderId;
        ok(await api('picker','POST',`/api/orders/${id}/claim`));
        const before=await stored(id),ambiguous=await scan('picker',id,'SIGNED-SAME-CODE','pick');
        assert.equal(ambiguous.status,409,JSON.stringify(ambiguous.data));
        assert.deepEqual((await stored(id)).items,before.items);
        const itemIds=before.items.map(item=>item.id);
        async function directed(role,type,itemId) {
            const snapshot=ok(await api(role,'GET',`/api/orders/${id}/work-snapshot`));
            return ok(await api(role,'POST','/api/orders/update_item',{orderId:id,scanValue:'SIGNED-SAME-CODE',type,orderItemId:itemId,responseMode:'delta-v1',commandId:randomUUID(),expectedState:snapshot.stateToken}));
        }
        const negative=await directed('picker','pick',itemIds[0]);assert.equal(negative.item.quantity_sign,-1);assert.equal(negative.item.signed_quantity,-1);
        assert.equal(await state(id),'picking');
        await directed('picker','pick',itemIds[1]);assert.equal(await state(id),'picked');
        ok(await api('packer','POST',`/api/orders/${id}/claim`));
        const returned=await directed('packer','pack',itemIds[0]);assert.equal(returned.item.quantity_sign,-1);assert.equal(await state(id),'packing');
        await directed('packer','pack',itemIds[1]);assert.equal(await state(id),'completed');
        assert.deepEqual((await stored(id)).items.map(item=>item.quantity_sign),[-1,1]);
    });
    await t.test('a new negative document needs no original reference or existing order to create its independent task',async()=>{
        const result=ok(await upload('SIGNED-NO-REFERENCE',[line('SIGNED-NEW-NEGATIVE',-1)]),201);
        const view=ok(await api('warehouseManager','GET',`/api/orders/${result.orderId}/work-snapshot`));
        assert.equal(view.order.document_type,'reversal');assert.equal(view.order.status,'pending');assert.equal(view.order.picker_id,null);assert.equal(view.order.packer_id,null);
        assert.equal(view.items[0].quantity,1);assert.equal(view.items[0].quantity_sign,-1);
        assert.deepEqual(await stored(oldId),oldState);
    });
    await t.test('negative SN rows validate absolute counts and require each serial to be scanned anew',async()=>{
        const serials=['SIGNSN000001','SIGNSN000002'];
        const imported=ok(await upload('SIGNED-SERIAL',[line('SIGNED-SERIAL-BARCODE',-2,serials)]),201);
        const id=imported.orderId,snapshot=ok(await api('picker','GET',`/api/orders/${id}/work-snapshot`));
        assert.equal(snapshot.items[0].quantity,2);assert.equal(snapshot.items[0].signed_quantity,-2);
        assert.deepEqual(snapshot.instances.map(instance=>instance.status),['pending','pending']);
        ok(await api('picker','POST',`/api/orders/${id}/claim`));
        ok(await scan('picker',id,serials[0],'pick'));assert.equal(await state(id),'picking');
        ok(await scan('picker',id,serials[1],'pick'));assert.equal(await state(id),'picked');
        ok(await api('packer','POST',`/api/orders/${id}/claim`));
        ok(await scan('packer',id,serials[0],'pack'));assert.equal(await state(id),'packing');
        ok(await scan('packer',id,serials[1],'pack'));assert.equal(await state(id),'completed');
        const before=await totals();
        const bad=await upload('SIGNED-SERIAL-BAD',[line('SIGNED-SERIAL-BARCODE',-2,[serials[0]])]);
        assert.equal(bad.status,400);assert.match(bad.data.message,/SN/);assert.deepEqual(await totals(),before);
    });
    await t.test('zero, fractional and unsafe signed quantities reject the complete upload without partial tasks',async()=>{
        const before=await totals();
        for(const [index,quantity] of [0,-0,-0.5,1.5,'9007199254740993'].entries()) {
            const result=await upload('SIGNED-INVALID-'+index,[line('SIGNED-VALID',1),line('SIGNED-INVALID',quantity)]);
            assert.equal(result.status,400,JSON.stringify(result.data));assert.match(result.data.message,/數量/);
        }
        assert.deepEqual(await totals(),before);
    });
    await t.test('signed imports roll back all fresh items and scans on audit storage failure',async()=>{
        const before=await totals();
        await pool.query("CREATE FUNCTION fail_signed_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_type='import' AND NEW.details::jsonb->>'voucherNumber'='SIGNED-ROLLBACK' THEN RAISE EXCEPTION 'fixture signed audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_signed_import BEFORE INSERT ON operation_logs FOR EACH ROW EXECUTE FUNCTION fail_signed_import()");
        try {
            const result=await upload('SIGNED-ROLLBACK',[line('SIGNED-ROLLBACK-BARCODE',-1)]);
            assert.equal(result.status,500);assert.deepEqual(await totals(),before);
            assert.equal((await pool.query("SELECT count(*)::int n FROM orders WHERE voucher_number='SIGNED-ROLLBACK'")).rows[0].n,0);
        } finally {await pool.query('DROP TRIGGER fail_signed_import ON operation_logs; DROP FUNCTION fail_signed_import()');}
        assert.deepEqual(await stored(oldId),oldState);
    });
    await t.test('signed task changes cannot turn signed ERP quantities into an unsigned proposal while ordinary shipments still allow edits',async()=>{
        const body={type:'order_change',reasonText:'Signed correction',snapshot:{proposal:{note:'Signed correction',items:[{barcode:realNegativeBarcode,productName:'Signed '+realNegativeBarcode,quantityChange:1,noSn:true}]}}};
        const blocked=await api('orderManager','POST',`/api/orders/${mixedId}/exceptions`,body);
        assert.equal(blocked.status,409);assert.match(blocked.data.message,/ERP|理貨單/);
        const positiveBody={...body,snapshot:{proposal:{note:'Ordinary correction',items:[{barcode:'SIGNED-POSITIVE-BARCODE',productName:'Signed SIGNED-POSITIVE-BARCODE',quantityChange:1,noSn:true}]}}};
        const ordinary=ok(await api('orderManager','POST',`/api/orders/${positiveId}/exceptions`,positiveBody),201);
        assert.ok(ordinary.id);
    });
};
