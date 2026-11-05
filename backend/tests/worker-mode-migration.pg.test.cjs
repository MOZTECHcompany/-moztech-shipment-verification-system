const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { Client, Pool } = require('pg');
const { loadMigrationManifest } = require('../src/config/migrationManifest');
const { runMigrations } = require('../src/maintenance/migrationRunner');
const { assertSchemaReady } = require('../src/config/schemaReadiness');

test('worker mode migration preserves identities, credentials, history and in-progress quantities', {
    skip: process.env.WMS_PARITY_PG_TEST !== '1', timeout: 30000
}, async t => {
    const database = `wms_worker_migration_${randomBytes(6).toString('hex')}`;
    const config = require('./local-pg-config.cjs')();
    const control = new Client(config); await control.connect();
    await control.query(`CREATE DATABASE "${database}"`);
    const pool = new Pool({ ...config, database, max: 1 });
    t.after(async () => { await pool.end(); await control.query(`DROP DATABASE "${database}"`); await control.end(); });
    const manifest = loadMigrationManifest();
    await runMigrations({ pool, targetDatabase: database, manifest: manifest.filter(row => row.name < '031_') });
    const people = [];
    for (const role of ['picker', 'packer', 'admin', 'superadmin', 'dispatcher']) {
        people.push((await pool.query('INSERT INTO users(username,password,name,role) VALUES($1,$2,$3,$4) RETURNING *',
            ['legacy-' + role, '$2b$04$historic-preserved-password-hash-' + role, 'Legacy ' + role, role])).rows[0]);
    }
    const order = (await pool.query("INSERT INTO orders(voucher_number,customer_name,status,picker_id,packer_id) VALUES('LEGACY-WORK-MODES','Legacy customer','packing',$1,$2) RETURNING *", [people[0].id, people[1].id])).rows[0];
    const item = (await pool.query("INSERT INTO order_items(order_id,product_code,barcode,product_name,quantity,picked_quantity,packed_quantity) VALUES($1,'CODE','CODE','Legacy goods',3,3,1) RETURNING *", [order.id])).rows[0];
    const instance = (await pool.query("INSERT INTO order_item_instances(order_item_id,serial_number,status) VALUES($1,'LEGACYWORKSN01','packed') RETURNING *", [item.id])).rows[0];
    const log = (await pool.query("INSERT INTO operation_logs(user_id,order_id,action_type,details) VALUES($1,$2,'pack','{\"quantity\":1}') RETURNING *", [people[1].id, order.id])).rows[0];
    const comment = (await pool.query("INSERT INTO task_comments(user_id,order_id,content) VALUES($1,$2,'Legacy pinned context') RETURNING *", [people[0].id, order.id])).rows[0];
    const handoff = (await pool.query("INSERT INTO task_assignments(order_id,from_user_id,to_user_id,task_type,reason) VALUES($1,$2,$3,'pack','Legacy transfer') RETURNING *", [order.id, people[0].id, people[1].id])).rows[0];
    assert.deepEqual((await runMigrations({ pool, targetDatabase: database, manifest })).applied, ['031_worker_modes.sql','040_wms_cartons.sql','041_box_specifications.sql','042_ecount_carton_references.sql','043_box_spec_batch_history_index.sql','044_ecount_browser_assistant.sql']);
    await assertSchemaReady(pool);
    for(const table of ['wms_box_specs','wms_box_spec_history','wms_box_spec_batch_commands']) assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,0,'041 adds empty tables without manufacturing historical cartons or specifications');
    for (const person of people) assert.deepEqual((await pool.query('SELECT * FROM users WHERE id=$1', [person.id])).rows[0], { ...person, can_pick: null, can_pack: null });
    assert.deepEqual((await pool.query('SELECT * FROM orders WHERE id=$1', [order.id])).rows[0], { ...order, pick_paused_at: null, pack_paused_at: null });
    for (const [table, row] of [['order_items', item], ['order_item_instances', instance], ['task_comments', comment]]) assert.deepEqual((await pool.query(`SELECT * FROM ${table} WHERE id=$1`, [row.id])).rows[0], table === 'order_items' ? { ...row, carton_serial_binding: false, serial_identity_mode: 'legacy' } : row);
    assert.deepEqual((await pool.query('SELECT * FROM operation_logs WHERE id=$1', [log.id])).rows[0], { ...log, actor_snapshot: null, work_type: null });
    assert.deepEqual((await pool.query('SELECT * FROM task_assignments WHERE id=$1', [handoff.id])).rows[0], { ...handoff, performed_by: null, actor_snapshot: null, from_snapshot: null, to_snapshot: null, progress_snapshot: null });
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM warehouse_daily_modes')).rows[0].n, 0);
    assert.deepEqual((await runMigrations({ pool, targetDatabase: database, manifest })).applied, []);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n, people.length);
    await assert.rejects(pool.query("UPDATE operation_logs SET work_type='shipping' WHERE id=$1", [log.id]), { code: '23514' });
    await assert.rejects(pool.query("INSERT INTO warehouse_daily_modes(user_id,work_date,choice_stage) VALUES($1,CURRENT_DATE,'shipping')", [people[0].id]), { code: '23514' });
    assert.deepEqual((await pool.query('SELECT * FROM order_items WHERE id=$1', [item.id])).rows[0], { ...item, carton_serial_binding: false, serial_identity_mode: 'legacy' });
});
