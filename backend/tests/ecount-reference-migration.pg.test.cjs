const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { Client, Pool } = require('pg');
const { loadMigrationManifest } = require('../src/config/migrationManifest');
const { runMigrations } = require('../src/maintenance/migrationRunner');
const { assertSchemaReady } = require('../src/config/schemaReadiness');

test('042 adds empty reference metadata without altering any historical table, credential, quantity, exact SN or sequence', {
    skip: process.env.WMS_PARITY_PG_TEST !== '1', timeout: 30000
}, async t => {
    const database = 'wms_ecount_preservation_' + randomBytes(6).toString('hex');
    const config = require('./local-pg-config.cjs')();
    const control = new Client(config); await control.connect();
    await control.query(`CREATE DATABASE "${database}"`);
    const pool = new Pool({ ...config, database, max: 1 });
    t.after(async () => { await pool.end(); await control.query(`DROP DATABASE "${database}"`); await control.end(); });
    const manifest = loadMigrationManifest();
    assert.ok(manifest.some(row => row.name === '042_ecount_carton_references.sql'));
    await runMigrations({ pool, targetDatabase: database, manifest: manifest.filter(row => row.name < '042_') });
    const user = (await pool.query("INSERT INTO users(username,password,name,role,management_scope) VALUES('preserved-ecount-user','synthetic-historic-hash-do-not-rehash','Historical owner','admin','orders') RETURNING id")).rows[0].id;
    const order = (await pool.query("INSERT INTO orders(voucher_number,customer_name,status,picker_id) VALUES('LEGACY-BEFORE-042','Historical customer','picking',$1) RETURNING id", [user])).rows[0].id;
    const item = (await pool.query("INSERT INTO order_items(order_id,product_code,barcode,product_name,quantity,picked_quantity,packed_quantity,serial_identity_mode) VALUES($1,'LEGACY-SKU','LEGACY-CODE','Historical item',10,4,0,'exact') RETURNING id", [order])).rows[0].id;
    await pool.query("INSERT INTO order_item_instances(order_item_id,serial_number,status) VALUES($1,'000Case/01','picked')", [item]);
    await pool.query("INSERT INTO operation_logs(user_id,order_id,action_type,details,actor_snapshot,work_type) VALUES($1,$2,'pick','{\"quantity\":4}','{\"id\":77,\"name\":\"Old immutable actor\"}','pick')", [user, order]);
    await pool.query("INSERT INTO task_comments(user_id,order_id,content) VALUES($1,$2,'Historical pinned discussion')", [user, order]);
    await pool.query("INSERT INTO wms_cartons(carton_id,status,content_revision,state_revision,created_by,updated_by,sealed_at) VALUES('LEGACY-N5','sealed',3,4,$1,$1,NOW())", [user]);
    const line = (await pool.query("INSERT INTO wms_carton_lines(carton_id,position,item_code,code_type,quantity,remaining_quantity,actual_sns) VALUES('LEGACY-N5',1,'LEGACY-SKU','legacy',2,1,'[\"000Case/01\",\"000case+02\"]') RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO wms_carton_serials(serial_number,line_id,available) VALUES('000Case/01',$1,FALSE),('000case+02',$1,TRUE)", [line]);
    await pool.query("INSERT INTO wms_carton_history(carton_id,event_type,content_revision,state_revision,actor_id,details) VALUES('LEGACY-N5','picked',3,4,$1,'{\"historical\":true}')", [user]);
    await pool.query("INSERT INTO wms_box_specs(spec_id,status,lines,created_by,updated_by) VALUES('LEGACY-TEMPLATE','active','[{\"itemCode\":\"LEGACY-SKU\",\"quantity\":10}]',$1,$1)", [user]);
    const tables = (await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name<>'wms_schema_migrations' ORDER BY table_name")).rows.map(row => row.table_name);
    const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async table => {
        assert.match(table, /^[a-z0-9_]+$/);
        return [table, (await pool.query(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`)).rows.map(row => row.row)];
    })));
    const before = await snapshot();
    const sequences = (await pool.query("SELECT sequencename,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows;
    assert.deepEqual((await runMigrations({ pool, targetDatabase: database, manifest })).applied, ['042_ecount_carton_references.sql','043_box_spec_batch_history_index.sql','044_ecount_browser_assistant.sql']);
    await assertSchemaReady(pool);
    assert.deepEqual(await snapshot(), before);
    for (const old of sequences) assert.deepEqual((await pool.query("SELECT sequencename,last_value FROM pg_sequences WHERE schemaname='public' AND sequencename=$1", [old.sequencename])).rows[0], old);
    for (const table of ['wms_ecount_order_references','wms_ecount_reference_history','wms_ecount_reference_commands']) {
        assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0);
    }
    await assert.rejects(pool.query(`INSERT INTO wms_ecount_order_references(order_id,company_code,voucher_number,revision,manifest_fingerprint,
        confirmed_fingerprint,confirmed_at,confirmation_evidence,updated_actor_snapshot) VALUES($1,'SYNTHETIC','INVALID-PARTIAL',1,$2,$2,NOW(),'{}','{}')`,[order,'a'.repeat(64)]),{code:'23514'});
    assert.deepEqual((await runMigrations({ pool, targetDatabase: database, manifest })).applied, []);
    assert.deepEqual(await snapshot(), before);
});
