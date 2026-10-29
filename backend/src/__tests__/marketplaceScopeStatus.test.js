const {PGlite}=require('@electric-sql/pglite');
const {currentScopePredicate}=require('../services/marketplaceScopeStatus');
describe('current upload scope display and warehouse queue filtering',()=>{
 let db;
 beforeAll(async()=>{db=new PGlite();await db.exec(`
 CREATE TABLE marketplace_intakes(id INT PRIMARY KEY,snapshot JSONB,archived_at TIMESTAMPTZ);
 CREATE TABLE marketplace_intake_orders(id INT PRIMARY KEY,intake_id INT,draft_version INT,draft_active BOOLEAN);
 CREATE TABLE marketplace_intake_scope_orders(intake_id INT,intake_order_id INT,source_version INT);
 `);});
 afterAll(async()=>db.close());
 beforeEach(async()=>{await db.exec(`TRUNCATE marketplace_intake_scope_orders,marketplace_intake_orders,marketplace_intakes;
 INSERT INTO marketplace_intakes VALUES(1,'{}',NULL),(2,'{"uploadScope":{"sourceManifest":[{"id":1},{"id":2}]}}',NULL),(3,'{}',NULL);
 INSERT INTO marketplace_intake_orders VALUES(1,1,1,TRUE),(2,2,0,TRUE),(3,1,0,TRUE);
 INSERT INTO marketplace_intake_scope_orders VALUES(2,1,1),(2,2,0);`);});
 const current=async()=>Object.fromEntries((await db.query(`SELECT i.id,COALESCE(${currentScopePredicate('i')},FALSE) AS current FROM marketplace_intakes i ORDER BY id`)).rows.map(row=>[row.id,row.current]));
 test('marks the borrowed legacy owner as superseded, with current run and unrelated owner usable',async()=>expect(await current()).toEqual({1:false,2:true,3:true}));
 test('stale canonical versions remove the run from the active queue',async()=>{await db.exec('UPDATE marketplace_intake_orders SET draft_version=2 WHERE id=1');expect((await current())[2]).toBe(false);});
 test('inactive sources and archived owners remove run from queue',async()=>{await db.exec('UPDATE marketplace_intake_orders SET draft_active=FALSE WHERE id=1');expect((await current())[2]).toBe(false);await db.exec('UPDATE marketplace_intake_orders SET draft_active=TRUE;UPDATE marketplace_intakes SET archived_at=NOW() WHERE id=1');expect((await current())[2]).toBe(false);});
 test('missing source or incomplete membership cannot appear current',async()=>{await db.exec('DELETE FROM marketplace_intake_orders WHERE id=1');expect((await current())[2]).toBe(false);await db.exec('DELETE FROM marketplace_intake_scope_orders WHERE intake_id=2');expect((await current())[2]).toBe(false);});
 test('malformed or missing manifests fail closed without a SQL cast failure',async()=>{await db.exec(`UPDATE marketplace_intakes SET snapshot='{"uploadScope":{"sourceManifest":{}}}' WHERE id=2`);expect((await current())[2]).toBe(false);await db.exec(`UPDATE marketplace_intakes SET snapshot='{"uploadScope":{}}' WHERE id=2`);expect((await current())[2]).toBe(false);});
 test('rejects non-identifier SQL interpolation',()=>expect(()=>currentScopePredicate('i);DROP TABLE users;--')).toThrow(TypeError));
});
