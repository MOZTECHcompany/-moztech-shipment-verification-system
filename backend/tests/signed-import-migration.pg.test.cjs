const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {Client,Pool}=require('pg');
const {loadMigrationManifest}=require('../src/config/migrationManifest');
const {runMigrations}=require('../src/maintenance/migrationRunner');
const {assertSchemaReady}=require('../src/config/schemaReadiness');

test('signed import migration preserves preexisting warehouse rows on isolated PostgreSQL',{
    skip:process.env.WMS_PARITY_PG_TEST!=='1',timeout:30000
},async t=>{
    const database=`wms_signed_migration_${randomBytes(6).toString('hex')}`;
    // Fixed disposable loopback server; never read production connection env.
    const config={host:'127.0.0.1',port:55441,user:'wms_replay',password:'wms_replay_local_only',database:'postgres'};
    const control=new Client(config);await control.connect();
    await control.query(`CREATE DATABASE "${database}"`);
    const pool=new Pool({...config,database,max:1});
    t.after(async()=>{await pool.end();await control.query(`DROP DATABASE "${database}"`);await control.end()});
    const manifest=loadMigrationManifest();
    const legacy=manifest.filter(row=>row.name!=='030_signed_import_quantities.sql');
    await runMigrations({pool,targetDatabase:database,manifest:legacy});
    const user=(await pool.query("INSERT INTO users(username,password,name,role) VALUES('migration-fixture','unused','Fixture','dispatcher') RETURNING id")).rows[0].id;
    const order=(await pool.query("INSERT INTO orders(voucher_number,customer_name,status,picker_id) VALUES('LEGACY-SIGNED-MIGRATION','Fixture','picking',$1) RETURNING *",[user])).rows[0];
    const line=(await pool.query("INSERT INTO order_items(order_id,product_code,barcode,product_name,quantity,picked_quantity,packed_quantity) VALUES($1,'MODEL','CODE','Fixture',3,2,1) RETURNING *",[order.id])).rows[0];
    const instance=(await pool.query("INSERT INTO order_item_instances(order_item_id,serial_number,status) VALUES($1,'SN0000000001','packed') RETURNING *",[line.id])).rows[0];
    const comment=(await pool.query("INSERT INTO task_comments(order_id,user_id,content) VALUES($1,$2,'Legacy message') RETURNING *",[order.id,user])).rows[0];
    const log=(await pool.query("INSERT INTO operation_logs(order_id,user_id,action_type,details) VALUES($1,$2,'pick','{\"quantity\":2}') RETURNING *",[order.id,user])).rows[0];
    const result=await runMigrations({pool,targetDatabase:database,manifest});
    assert.deepEqual(result.applied,['030_signed_import_quantities.sql']);
    await assertSchemaReady(pool);
    const afterOrder=(await pool.query('SELECT * FROM orders WHERE id=$1',[order.id])).rows[0];
    const afterLine=(await pool.query('SELECT * FROM order_items WHERE id=$1',[line.id])).rows[0];
    assert.deepEqual(afterOrder,{...order,document_type:'shipment'});
    assert.deepEqual(afterLine,{...line,quantity_sign:1});
    for (const [table,before] of [['order_item_instances',instance],['task_comments',comment],['operation_logs',log]]) {
        assert.deepEqual((await pool.query(`SELECT * FROM ${table} WHERE id=$1`,[before.id])).rows[0],before);
    }
    assert.equal((await runMigrations({pool,targetDatabase:database,manifest})).applied.length,0);
    for(const query of [
        ()=>pool.query('UPDATE order_items SET quantity_sign=0 WHERE id=$1',[line.id]),
        ()=>pool.query("UPDATE orders SET document_type='unknown' WHERE id=$1",[order.id]),
        ()=>pool.query('UPDATE order_items SET quantity=-3 WHERE id=$1',[line.id])
    ]) await assert.rejects(query,{code:'23514'});
    assert.deepEqual((await pool.query('SELECT * FROM orders WHERE id=$1',[order.id])).rows[0],afterOrder);
    assert.deepEqual((await pool.query('SELECT * FROM order_items WHERE id=$1',[line.id])).rows[0],afterLine);
});
