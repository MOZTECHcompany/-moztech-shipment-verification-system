// Disposable native PostgreSQL only; no production environment is consulted.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { Client, Pool } = require('pg');
const { loadMigrationManifest } = require('../src/config/migrationManifest');
const { runMigrations } = require('../src/maintenance/migrationRunner');
const { assertSchemaReady } = require('../src/config/schemaReadiness');

test('044 creates only empty local assistant bookkeeping and preserves every historical row, exact identity and sequence', {
    skip: process.env.WMS_PARITY_PG_TEST !== '1', timeout: 30000
}, async t => {
    const config = require('./local-pg-config.cjs')();
    const database = 'wms_browser_preservation_' + randomBytes(6).toString('hex');
    const control = new Client(config); await control.connect();
    await control.query(`CREATE DATABASE "${database}"`);
    const pool = new Pool({ ...config, database, max: 1 });
    t.after(async () => { await pool.end(); await control.query(`DROP DATABASE "${database}"`); await control.end(); });
    const manifest = loadMigrationManifest();
    assert.ok(manifest.some(m => m.name === '044_ecount_browser_assistant.sql'));
    await runMigrations({ pool, targetDatabase: database, manifest: manifest.filter(m => m.name < '044_') });
    const actor = (await pool.query("INSERT INTO users(username,password,name,role,management_scope) VALUES('historic-browser-owner','$2b$04$preserve-exact-historical-hash','Historical owner','admin','warehouse') RETURNING id")).rows[0].id;
    const order = (await pool.query("INSERT INTO orders(voucher_number,customer_name,status,picker_id,packer_id) VALUES('HISTORICAL-044','Historical customer','packing',$1,$1) RETURNING id", [actor])).rows[0].id;
    const item = (await pool.query("INSERT INTO order_items(order_id,product_code,product_name,barcode,quantity,picked_quantity,packed_quantity,serial_identity_mode) VALUES($1,'HistoricCase','Historical product','000012345',2,2,1,'exact') RETURNING id", [order])).rows[0].id;
    await pool.query("INSERT INTO order_item_instances(order_item_id,serial_number,status) VALUES($1,'000Case/01','packed'),($1,'000case+02','picked')", [item]);
    await pool.query("INSERT INTO task_comments(order_id,user_id,content,priority) VALUES($1,$2,'Historical pinned note','urgent')", [order,actor]);
    await pool.query("INSERT INTO operation_logs(order_id,user_id,action_type,work_type,actor_snapshot,details) VALUES($1,$2,'pack','pack','{\"id\":999,\"name\":\"Historic immutable actor\"}','{\"quantity\":1}')", [order,actor]);
    await pool.query("INSERT INTO wms_cartons(carton_id,status,created_by) VALUES('HIST-N1','sealed',$1)", [actor]);
    const cartonLine = (await pool.query("INSERT INTO wms_carton_lines(carton_id,position,item_code,code_type,quantity,remaining_quantity,actual_sns) VALUES('HIST-N1',1,'HistoricCase','legacy',2,1,'[\"000Case/01\",\"000case+02\"]') RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO wms_carton_serials(serial_number,line_id,available) VALUES('000Case/01',$1,FALSE),('000case+02',$1,TRUE)", [cartonLine]);
    await pool.query("INSERT INTO wms_box_specs(spec_id,lines,created_by) VALUES('HIST-SPEC','[{\"itemCode\":\"HistoricCase\",\"quantity\":2}]',$1)", [actor]);
    await pool.query("INSERT INTO wms_box_spec_batch_commands(user_id,command_id,spec_id,request_hash,content_revision,carton_ids) VALUES($1,$2,'HIST-SPEC','historic-batch',1,'[\"HIST-N1\"]')", [actor,randomUUID()]);
    await pool.query("INSERT INTO wms_ecount_order_references(order_id,company_code,voucher_number,revision,manifest_fingerprint,updated_actor_snapshot) VALUES($1,'HIST-CO','2026/10/15-1',1,$2,'{\"id\":999}')", [order,'a'.repeat(64)]);
    await pool.query("INSERT INTO wms_ecount_reference_commands(user_id,command_id,order_id,request_hash,reference_revision) VALUES($1,$2,$3,'historic-command',1)", [actor,randomUUID(),order]);
    const tables = (await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name<>'wms_schema_migrations' ORDER BY table_name")).rows.map(r=>r.table_name);
    const snapshot = async () => {
        const state = {};
        for (const table of tables) {
            assert.match(table,/^[a-z0-9_]+$/);
            state[table] = (await pool.query(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`)).rows;
        }
        return state;
    };
    const before = await snapshot();
    const sequences = (await pool.query("SELECT sequencename,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows;
    const columns = (await pool.query("SELECT table_name,column_name,data_type,column_default,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[]) ORDER BY table_name,ordinal_position",[tables])).rows;
    assert.deepEqual((await runMigrations({ pool, targetDatabase: database, manifest })).applied,['044_ecount_browser_assistant.sql']);
    await assertSchemaReady(pool);
    assert.deepEqual(await snapshot(),before);
    assert.deepEqual((await pool.query("SELECT table_name,column_name,data_type,column_default,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[]) ORDER BY table_name,ordinal_position",[tables])).rows,columns);
    for (const original of sequences) assert.deepEqual((await pool.query("SELECT sequencename,last_value FROM pg_sequences WHERE schemaname='public' AND sequencename=$1",[original.sequencename])).rows[0],original);
    for (const table of ['wms_ecount_browser_jobs','wms_ecount_browser_commands','wms_ecount_browser_events']) assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,0);
    assert.deepEqual((await runMigrations({ pool, targetDatabase: database, manifest })).applied,[]);
    assert.deepEqual(await snapshot(),before);
});
