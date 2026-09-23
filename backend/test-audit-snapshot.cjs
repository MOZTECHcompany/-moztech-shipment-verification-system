const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite();await db.exec("CREATE TABLE users(id int primary key,name text,role text CONSTRAINT users_role_check CHECK(role IN ('picker','packer')));CREATE TABLE erp_staff_identities(erp_user_id text,entity_id text,wms_user_id int);CREATE TABLE operation_logs(id serial primary key,user_id int,details jsonb);INSERT INTO users VALUES(1,'Staff','picker');INSERT INTO erp_staff_identities VALUES('erp-staff','company',1);INSERT INTO operation_logs(user_id) VALUES(1);");
await db.exec(fs.readFileSync(__dirname+'/migrations/035_erp_portal_audit.sql','utf8'));
await db.exec("INSERT INTO operation_logs(user_id) VALUES(1);UPDATE users SET role='packer',name='Renamed' WHERE id=1;INSERT INTO operation_logs(user_id) VALUES(1)");
const rows=(await db.query('SELECT * FROM operation_logs ORDER BY id')).rows;
assert.equal(rows[0].actor_role,null);assert.equal(rows[1].actor_role,'picker');assert.equal(rows[1].actor_name,'Staff');assert.equal(rows[2].actor_role,'packer');assert.equal(rows[2].actor_erp_user_id,'erp-staff');assert.equal(rows[2].entity_id,'company');
await db.exec('BEGIN;INSERT INTO operation_logs(user_id) VALUES(1);ROLLBACK;');assert.equal((await db.query('SELECT count(*)::int AS n FROM operation_logs')).rows[0].n,3);
await db.close();console.log('7 PostgreSQL audit snapshot and rollback assertions passed');})().catch(e=>{console.error(e);process.exitCode=1;});
