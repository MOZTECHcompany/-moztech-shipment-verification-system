// Fresh disposable loopback database. No cloud credentials or external logistics.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,randomBytes}=require('node:crypto');
const {Client}=require('pg');
const jwt=require('jsonwebtoken');
const Papa=require('papaparse');

test('scan receipts, pure snapshots and bounded reports on PostgreSQL', {timeout:120000},async t=>{
    const database='wms_perf_test_'+randomBytes(5).toString('hex');
    const cfg={host:'127.0.0.1',port:55441,user:'wms_replay',password:'wms_replay_local_only',database:'postgres'};
    const control=new Client(cfg);await control.connect();await control.query(`CREATE DATABASE "${database}"`);
    Object.assign(process.env,{NODE_ENV:'test',DATABASE_URL:'',PGHOST:cfg.host,PGPORT:String(cfg.port),PGUSER:cfg.user,PGPASSWORD:cfg.password,PGDATABASE:database,PGOPTIONS:'',JWT_SECRET:'isolated-performance-test-only',DB_POOL_MAX:'3',DB_SSL_MODE:'disable',STORAGE_BACKEND:'local',CORS_ORIGINS:'http://127.0.0.1',WMS_ECPAY_ACCOUNTS_JSON:'[]',WMS_ECPAY_CALLBACKS_ENABLED:'false'});
    const {pool,reportPool,closePool}=require('../src/config/database');
    const {runMigrations}=require('../src/maintenance/migrationRunner');
    await runMigrations({pool,targetDatabase:database});
    const user=(await pool.query("INSERT INTO users(username,password,name,role) VALUES('performance-user','unused','Performance User','admin') RETURNING id")).rows[0].id;
    const token=jwt.sign({id:user},process.env.JWT_SECRET,{expiresIn:'5m'});
    const {server,io}=require('../src/app');await new Promise(r=>server.listen(0,'127.0.0.1',r));
    t.after(async()=>{await new Promise(r=>io.close(r));await closePool();await control.query(`DROP DATABASE "${database}"`);await control.end()});
    const base='http://127.0.0.1:'+server.address().port;
    async function api(path,body,authenticated=true){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(authenticated?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});const text=await response.text();let data;try{data=JSON.parse(text)}catch{}return{status:response.status,data,text,headers:response.headers}}
    async function order(quantity=10){const id=(await pool.query("INSERT INTO orders(voucher_number,customer_name,status,picker_id,packer_id) VALUES($1,'Synthetic performance','picking',$2,$2) RETURNING id",[randomUUID(),user])).rows[0].id;await pool.query("INSERT INTO order_items(order_id,product_code,product_name,barcode,quantity) VALUES($1,'PERF','Synthetic item','PERF',$2)",[id,quantity]);return id}
    const snapshot=async id=>{const r=await api(`/api/orders/${id}/work-snapshot`);assert.equal(r.status,200);return r.data};
    const command=(id,state,more={})=>({orderId:id,scanValue:'PERF',type:'pick',amount:1,responseMode:'delta-v1',commandId:randomUUID(),expectedState:state.stateToken,...more});
    let id=await order();
    await t.test('pure snapshot does not lock or repair order state and requires login',async()=>{
        assert.equal((await api(`/api/orders/${id}/work-snapshot`,null,false)).status,401);
        const db=new Client({...cfg,database});await db.connect();await db.query('BEGIN');await db.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE',[id]);
        try{await snapshot(id)}finally{await db.query('ROLLBACK');await db.end()}
        await pool.query('UPDATE order_items SET picked_quantity=quantity,packed_quantity=quantity WHERE order_id=$1',[id]);
        assert.equal((await snapshot(id)).order.status,'picking');
        assert.equal((await pool.query('SELECT status FROM orders WHERE id=$1',[id])).rows[0].status,'picking');
        await pool.query('UPDATE order_items SET picked_quantity=0,packed_quantity=0 WHERE order_id=$1',[id]);
    });
    await t.test('concurrent identical command commits once and replays the exact receipt',async()=>{
        const body=command(id,await snapshot(id));
        const responses=await Promise.all([api('/api/orders/update_item',body),api('/api/orders/update_item',body)]);
        responses.forEach(r=>assert.equal(r.status,200));assert.deepEqual(responses[0].data,responses[1].data);
        assert.equal(responses[0].data.format,'delta-v1');assert.equal(responses[0].data.item.picked_quantity,1);assert.equal(responses[0].data.instances,undefined);
        assert.equal((await pool.query('SELECT picked_quantity FROM order_items WHERE order_id=$1',[id])).rows[0].picked_quantity,1);
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM operation_logs WHERE order_id=$1 AND action_type='pick'",[id])).rows[0].n,1);
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM wms_scan_commands WHERE order_id=$1',[id])).rows[0].n,1);
        assert.equal((await api('/api/orders/update_item',{...body,amount:2})).status,409);
    });
    await t.test('stale base state refuses mutation and does not store a receipt',async()=>{
        const stale=await snapshot(id),a=command(id,stale),b=command(id,stale);
        assert.equal((await api('/api/orders/update_item',a)).status,200);
        const rejected=await api('/api/orders/update_item',b);assert.equal(rejected.status,409);assert.equal(rejected.data.code,'SCAN_NOT_APPLIED');assert.equal(rejected.data.reason,'STATE_CHANGED');
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM wms_scan_commands WHERE command_id=$1',[b.commandId])).rows[0].n,0);
    });
    await t.test('failed audit rolls back mutation and receipt; a corrected retry commits exactly once',async()=>{
        const isolated=await order(),body=command(isolated,await snapshot(isolated));
        await pool.query(`CREATE FUNCTION fail_perf_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.order_id=${isolated} AND NEW.action_type='pick' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_perf BEFORE INSERT ON operation_logs FOR EACH ROW EXECUTE FUNCTION fail_perf_audit();`);
        try{const r=await api('/api/orders/update_item',body);assert.equal(r.data.code,'SCAN_NOT_APPLIED');assert.equal((await pool.query('SELECT picked_quantity FROM order_items WHERE order_id=$1',[isolated])).rows[0].picked_quantity,0);assert.equal((await pool.query('SELECT count(*)::int n FROM wms_scan_commands WHERE command_id=$1',[body.commandId])).rows[0].n,0)}finally{await pool.query('DROP TRIGGER fail_perf ON operation_logs; DROP FUNCTION fail_perf_audit()')}
        assert.equal((await api('/api/orders/update_item',body)).status,200);assert.equal((await api('/api/orders/update_item',body)).status,200);
        assert.equal((await pool.query('SELECT picked_quantity FROM order_items WHERE order_id=$1',[isolated])).rows[0].picked_quantity,1);
    });
    await t.test('60 picks and packs retain exact totals with delta receipts after scan 50',async()=>{
        const oid=await order(60);
        for(const type of ['pick','pack'])for(let n=1;n<=60;n++){
            const before=await snapshot(oid),r=await api('/api/orders/update_item',command(oid,before,{type}));
            assert.equal(r.status,200);assert.equal(r.data.item[type==='pick'?'picked_quantity':'packed_quantity'],n);
            if(n===60)assert.equal(r.data.order.status,type==='pick'?'picked':'completed');
        }
        assert.equal((await pool.query("SELECT count(*)::int n FROM operation_logs WHERE order_id=$1 AND action_type IN('pick','pack')",[oid])).rows[0].n,120);
    });
    await t.test('report preserves quantities, users and Taiwan end-of-day fractional seconds',async()=>{
        const included=await order(7),excluded=await order(9);
        await pool.query("UPDATE orders SET status='completed',completed_at='2026-09-13T23:59:59.500+08' WHERE id=$1",[included]);
        await pool.query("UPDATE orders SET status='completed',completed_at='2026-09-14T00:00:00+08' WHERE id=$1",[excluded]);
        await pool.query("INSERT INTO operation_logs(user_id,order_id,action_type) VALUES($1,$2,'pick'),($1,$2,'pack')",[user,included]);
        const r=await api('/api/reports/export?startDate=2026-09-13&endDate=2026-09-13');assert.equal(r.status,200);
        const parsed=Papa.parse(r.text.replace(/^\uFEFF/,''),{header:true,skipEmptyLines:true}).data;
        const rows=(await pool.query('SELECT id,voucher_number FROM orders WHERE id=ANY($1::int[])',[[included,excluded]])).rows;
        const row=parsed.find(r=>r['訂單編號']===rows.find(r=>r.id===included).voucher_number);
        assert.equal(row['出貨總件數'],'7');assert.equal(row['揀貨人員'],'Performance User');assert.equal(row['裝箱人員'],'Performance User');
        assert.ok(!parsed.some(r=>r['訂單編號']===rows.find(r=>r.id===excluded).voucher_number));
        assert.equal((await api('/api/reports/export?startDate=2026-02-30&endDate=2026-09-13')).status,400);
        assert.equal((await api('/api/operation-logs?limit=-1')).status,400);
    });
    await t.test('report advisory lock is explicit busy; released slot recovers for the next download',async()=>{
        assert.notEqual(pool,reportPool);assert.equal(pool.options.max+reportPool.options.max,3);
        const other=new Client({...cfg,database});await other.connect();await other.query('BEGIN');await other.query("SELECT pg_advisory_xact_lock(hashtext('wms-report-export'),hashtext(current_database()))");
        try{const r=await api('/api/reports/export?startDate=2026-01-01&endDate=2026-12-31');assert.equal(r.status,429);assert.equal(r.data.code,'REPORT_BUSY');assert.equal(r.headers.get('retry-after'),'3');await snapshot(id)}finally{await other.query('ROLLBACK');await other.end()}
        assert.equal((await api('/api/reports/export?startDate=2026-01-01&endDate=2026-12-31')).status,200);
    });
});
