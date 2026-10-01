const assert = require('node:assert/strict');

module.exports = async ({t,api,ok,pool,users,tokens,observedEvents}) => {
    const jwt = require('jsonwebtoken');
    // Seed additional regression records directly in this disposable DB so the
    // established import tests still exercise the real production rate limit.
    async function importOrder(voucher,quantity,serials=[]) {
        const id=(await pool.query("INSERT INTO orders(voucher_number,customer_name,status) VALUES($1,'Review fixture','pending') RETURNING id",[voucher])).rows[0].id;
        const item=(await pool.query("INSERT INTO order_items(order_id,product_code,barcode,product_name,quantity) VALUES($1,'FIXTURE-BARCODE','FIXTURE-BARCODE','Fixture',$2) RETURNING id",[id,quantity])).rows[0].id;
        for(const sn of serials) await pool.query("INSERT INTO order_item_instances(order_item_id,serial_number,status) VALUES($1,$2,'pending')",[item,sn]);
        await pool.query("INSERT INTO operation_logs(order_id,user_id,action_type,details) VALUES($1,$2,'import','{}')",[id,users.dispatcher]);
        return {status:201,data:{orderId:id}};
    }

    for (const [key,scope] of [['orderManager','orders'],['warehouseManager','warehouse']]) {
        users[key] = (await pool.query("INSERT INTO users(username,password,name,role,management_scope) VALUES($1,'unused',$1,'admin',$2) RETURNING id",[key,scope])).rows[0].id;
        // Deliberately stale elevated token: effective scope must come from DB.
        tokens[key] = jwt.sign({id:users[key],role:'superadmin'},process.env.JWT_SECRET,{expiresIn:'10m'});
    }
    users.unrelatedPicker=(await pool.query("INSERT INTO users(username,password,name,role) VALUES('unrelatedPicker','unused','Unrelated','picker') RETURNING id")).rows[0].id;
    tokens.unrelatedPicker=jwt.sign({id:users.unrelatedPicker,role:'picker'},process.env.JWT_SECRET,{expiresIn:'10m'});
    const change = (delta,extra={}) => ({barcode:'FIXTURE-BARCODE',productName:'Fixture',quantityChange:delta,noSn:true,...extra});
    const propose = (role,id,items) => api(role,'POST',`/api/orders/${id}/exceptions`,{type:'order_change',reasonText:'Fixture change',snapshot:{proposal:{note:'Fixture change',items}}});
    const review = (role,id,ex,decision='ack') => api(role,'PATCH',`/api/orders/${id}/exceptions/${ex}/${decision}`,{note:'Reviewed fixture'});
    const state = async id => (await pool.query('SELECT status FROM orders WHERE id=$1',[id])).rows[0].status;
    const count = async (table,id) => (await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE order_id=$1`,[id])).rows[0].n;
    const id = ok(await importOrder('REVIEW-DELETE',3),201).orderId;
    await pool.query("UPDATE orders SET status='picking',picker_id=$2,packer_id=$3 WHERE id=$1",[id,users.picker,users.packer]);
    await t.test('management scope is current, editable only by superadmin, and blocks warehouse bypasses',async()=>{
        assert.equal(ok(await api('orderManager','GET','/api/auth/me')).user.management_scope,'orders');
        for(const [method,path,body] of [
            ['POST',`/api/orders/${id}/claim`],['POST','/api/orders/batch/claim',{orderIds:[id],stage:'pick'}],
            ['POST','/api/orders/update_item',{orderId:id,scanValue:'FIXTURE-BARCODE',type:'pick'}],
            ['PATCH',`/api/orders/${id}/void`,{reason:'bypass'}],['POST',`/api/orders/${id}/reconcile-picking`],
            ['GET','/api/admin/users'],['PUT',`/api/admin/users/${users.orderManager}`,{management_scope:'all'}],
        ]) assert.equal((await api('orderManager',method,path,body)).status,403,path);
        assert.equal((await api('warehouseManager','PUT',`/api/admin/users/${users.orderManager}`,{role:'picker'})).status,403);
        const updated=ok(await api('superadmin','PUT',`/api/admin/users/${users.orderManager}`,{role:'admin',management_scope:'orders'}));
        assert.equal(updated.user.management_scope,'orders');
        assert.equal(await state(id),'picking');
    });
    let ex;
    await t.test('concurrent deletion requests retain data, notify responsible staff and pause scans',async()=>{
        assert.equal((await api('dispatcher','DELETE',`/api/orders/${id}`,{})).status,400);
        const responses=await Promise.all([1,2].map(()=>api('dispatcher','DELETE',`/api/orders/${id}`,{reason:'Fixture delete'})));
        assert.deepEqual(responses.map(r=>r.status).sort(),[202,409]);ex=responses.find(r=>r.status===202).data.id;
        assert.equal(await state(id),'picking');assert.equal(await count('order_items',id),1);
        const recipients=(await pool.query('SELECT DISTINCT m.mentioned_user_id AS id FROM task_mentions m JOIN task_comments c ON c.id=m.comment_id WHERE c.order_id=$1',[id])).rows.map(r=>r.id);
        for(const name of ['superadmin','admin','warehouseManager','orderManager','dispatcher','picker','packer']) assert.ok(recipients.includes(users[name]),name);
        assert.ok(!recipients.includes(users.unrelatedPicker));
        for(const name of ['warehouseManager','picker','packer','dispatcher']) assert.ok(ok(await api(name,'GET','/api/order-reviews')).items.some(r=>r.id===ex));
        assert.equal(ok(await api('orderManager','GET','/api/order-reviews')).canReview,false);
        const task=ok(await api('picker','GET','/api/tasks?pagination=cursor')).items.find(r=>r.id===id);
        assert.equal(task.change_pending,true);assert.equal(task.deletion_pending,true);
        assert.equal((await api('picker','POST','/api/orders/update_item',{orderId:id,scanValue:'FIXTURE-BARCODE',type:'pick'})).status,409);
        assert.equal((await api('warehouseManager','PATCH',`/api/orders/${id}/void`,{reason:'bypass'})).status,409);
        assert.equal((await review('orderManager',id,ex)).status,403);
        assert.equal((await review('picker',id,ex)).status,403);
        const comments=(await pool.query('SELECT id FROM task_comments WHERE order_id=$1',[id])).rows.map(r=>r.id);
        ok(await api('picker','POST',`/api/tasks/${id}/comments/mark-read`,{commentIds:comments}));
        assert.ok(ok(await api('picker','GET','/api/order-reviews')).items.some(r=>r.id===ex),'reading a comment does not dismiss pending work');
    });
    await t.test('durable order alarms are recipient-only and explicit receipt never approves a request',async()=>{
        const inbox=ok(await api('picker','GET','/api/order-change-notices'));
        const notice=inbox.items.find(row=>row.order_id===id&&row.payload.phase==='requested');
        assert.ok(notice);assert.equal(notice.payload.deletion,true);
        assert.match(notice.created_at,/Z$/);
        assert.ok(ok(await api('orderManager','GET','/api/order-change-notices')).items.some(row=>row.id===notice.id));
        assert.ok(!ok(await api('unrelatedPicker','GET','/api/order-change-notices')).items.some(row=>row.id===notice.id));
        assert.equal((await api('unrelatedPicker','POST',`/api/order-change-notices/${notice.id}/acknowledge`)).status,404);
        // Chat read receipts cannot clear an operational alarm.
        assert.ok(ok(await api('picker','GET','/api/order-change-notices')).items.some(row=>row.id===notice.id));
        for(let retry=0;retry<2;retry++)ok(await api('picker','POST',`/api/order-change-notices/${notice.id}/acknowledge`));
        assert.ok(!ok(await api('picker','GET','/api/order-change-notices')).items.some(row=>row.id===notice.id));
        assert.ok(ok(await api('packer','GET','/api/order-change-notices')).items.some(row=>row.id===notice.id));
        assert.equal((await pool.query('SELECT status FROM order_exceptions WHERE id=$1',[ex])).rows[0].status,'open');
        assert.equal(await state(id),'picking');
    });
    await t.test('rejection resumes existing progress; approval voids while retaining all records and unread notice',async()=>{
        ok(await review('warehouseManager',id,ex,'reject'));
        ok(await api('picker','POST','/api/orders/update_item',{orderId:id,scanValue:'FIXTURE-BARCODE',type:'pick'}));
        const requested=ok(await api('orderManager','POST',`/api/orders/${id}/deletion-requests`,{reason:'Order manager requests deletion'}),202);
        const rowsBefore=await count('order_items',id);
        ok(await review('warehouseManager',id,requested.id));
        assert.equal(await state(id),'voided');assert.equal(await count('order_items',id),rowsBefore);
        const offline=ok(await api('packer','GET','/api/order-change-notices')).items.filter(row=>row.order_id===id);
        for(const phase of ['requested','rejected','approved'])assert.ok(offline.some(row=>row.payload.phase===phase),'Reconnect must recover '+phase);
        assert.ok(offline.find(row=>row.payload.phase==='approved').payload.message.includes('停止出貨'));
        assert.equal(offline.find(row=>row.payload.phase==='approved').is_current,true);
        assert.ok(offline.filter(row=>row.payload.phase!=='approved').every(row=>row.is_current===false),'Earlier stop-work instructions must be identified as history');
        assert.equal((await pool.query('SELECT picked_quantity FROM order_items WHERE order_id=$1',[id])).rows[0].picked_quantity,1);
        assert.equal((await review('warehouseManager',id,requested.id)).status,409);
        assert.ok(!ok(await api('warehouseManager','GET','/api/order-reviews')).items.some(r=>r.order_id===id));
        assert.ok(observedEvents.some(e=>e.event==='order_change_notice' && e.body.orderId===id));
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM operation_logs WHERE order_id=$1 AND action_type='void' AND details::jsonb->>'source'='approved_deletion'",[id])).rows[0].n,1);
    });
    await t.test('notification failure rolls back request and publishes no success event',async()=>{
        const rollbackId=ok(await importOrder('REVIEW-ROLLBACK',1),201).orderId;
        await pool.query(`CREATE FUNCTION fail_review_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.order_id=${rollbackId} THEN RAISE EXCEPTION 'fixture notice unavailable'; END IF; RETURN NEW; END $$;
            CREATE TRIGGER fail_review_notice BEFORE INSERT ON task_comments FOR EACH ROW EXECUTE FUNCTION fail_review_notice()`);
        try {
            assert.equal((await api('dispatcher','DELETE',`/api/orders/${rollbackId}`,{reason:'Fixture rollback'})).status,500);
            assert.equal(await count('order_exceptions',rollbackId),0);
            assert.equal(await count('order_change_notices',rollbackId),0);
            assert.equal((await pool.query("SELECT count(*)::int AS n FROM operation_logs WHERE order_id=$1 AND action_type='order_delete_requested'",[rollbackId])).rows[0].n,0);
            assert.ok(!observedEvents.some(e=>e.event==='order_change_notice'&&e.body.orderId===rollbackId));
        } finally {await pool.query('DROP TRIGGER fail_review_notice ON task_comments; DROP FUNCTION fail_review_notice()');}
    });
    await t.test('admin own imports require explicit review, and SN replacement reduces its actual parent row',async()=>{
        const sn=ok(await importOrder('REVIEW-SN',1,['REVIEWSN00001']),201).orderId;
        await pool.query("UPDATE operation_logs SET user_id=$2 WHERE order_id=$1 AND action_type='import'",[sn,users.warehouseManager]);
        const other=(await pool.query("INSERT INTO order_items(order_id,barcode,product_code,product_name,quantity) VALUES($1,'FIXTURE-BARCODE','FIXTURE-BARCODE','Second row',1) RETURNING id",[sn])).rows[0].id;
        await pool.query("INSERT INTO order_item_instances(order_item_id,serial_number,status) VALUES($1,'REVIEWSN00002','pending')",[other]);
        const request=ok(await propose('warehouseManager',sn,[change(-1,{noSn:false,removedSnList:['REVIEWSN00001']}),change(1,{noSn:false,snList:['REVIEWSN00003']})]),201);
        assert.equal(request.item.status,'open');
        const notice=ok(await api('orderManager','GET','/api/order-change-notices')).items.find(row=>row.payload.exceptionId===request.id);
        assert.equal(notice.payload.actorName,'warehouseManager');
        assert.equal(notice.payload.actorRole,'倉儲管理員');
        assert.deepEqual(notice.payload.details.lines,['Fixture · FIXTURE-BARCODE · 2 → 1 件','移除 SN：REVIEWSN00001','Fixture · FIXTURE-BARCODE · 1 → 2 件','新增 SN：REVIEWSN00003']);
        assert.ok(!ok(await api('warehouseManager','GET','/api/order-change-notices')).items.some(row=>row.id===notice.id),'Actors do not alarm themselves');
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM order_item_instances WHERE serial_number='REVIEWSN00001'")).rows[0].n,1);
        ok(await review('warehouseManager',sn,request.id));
        const lines=(await pool.query('SELECT oi.id,oi.quantity,count(i.id)::int AS serials FROM order_items oi LEFT JOIN order_item_instances i ON i.order_item_id=oi.id WHERE oi.order_id=$1 GROUP BY oi.id ORDER BY oi.id',[sn])).rows;
        assert.equal(lines.reduce((n,r)=>n+r.quantity,0),2);
        for(const row of lines) assert.equal(row.quantity,row.serials,'SN must remain on a row with matching quantity');
        const applied=(await pool.query('SELECT snapshot FROM order_exceptions WHERE id=$1',[request.id])).rows[0].snapshot.applyResult;
        assert.deepEqual(applied.changesApplied.map(r=>[r.previousTotalQuantity,r.newTotalQuantity]),[[2,1],[1,2]]);
        ok(await api('picker','POST',`/api/orders/${sn}/claim`));
        for(const serial of ['REVIEWSN00002','REVIEWSN00003']) ok(await api('picker','POST','/api/orders/update_item',{orderId:sn,scanValue:serial,type:'pick'}));
        assert.equal(await state(sn),'picked');
        assert.deepEqual(ok(await api('orderManager','GET','/api/order-change-notices')).items.find(row=>row.id===notice.id).payload,notice.payload,'Historic notice stays immutable after approval and scans');
    });
    await t.test('both manager duties can propose handling; opposite team receives changes and approval remains warehouse-only',async()=>{
        const id=ok(await importOrder('REVIEW-HANDLING',1),201).orderId;
        const ex=ok(await api('picker','POST',`/api/orders/${id}/exceptions`,{type:'other',reasonText:'包材確認'}),201).id;
        const path=`/api/orders/${id}/exceptions/${ex}`;
        ok(await api('orderManager','PATCH',path+'/propose',{resolutionAction:'other',note:'使用厚紙箱'}));
        let notice=ok(await api('warehouseManager','GET','/api/order-change-notices')).items.find(row=>row.payload.exceptionId===ex);
        assert.equal(notice.payload.actorRole,'訂單管理員');assert.ok(notice.payload.details.lines.includes('處理說明：使用厚紙箱'));
        ok(await api('warehouseManager','PATCH',path+'/propose',{resolutionAction:'exchange',note:'改用防撞包材'}));
        notice=ok(await api('orderManager','GET','/api/order-change-notices')).items.find(row=>row.payload.exceptionId===ex);
        assert.ok(notice.payload.details.lines.includes('處理方式：其他 → 換貨'));
        assert.ok(notice.payload.details.lines.includes('原處理說明：使用厚紙箱'));
        assert.equal((await review('orderManager',id,ex)).status,403);
        ok(await review('warehouseManager',id,ex));
        assert.ok(ok(await api('orderManager','GET','/api/order-change-notices')).items.some(row=>row.payload.exceptionId===ex&&row.payload.phase==='approved'));
        assert.equal((await pool.query('SELECT quantity FROM order_items WHERE order_id=$1',[id])).rows[0].quantity,1);
    });
};
