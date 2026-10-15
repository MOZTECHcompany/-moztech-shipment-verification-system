// Synthetic loopback PostgreSQL only. Batch lookup and label data must be reads.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const request = require('supertest');
const { createCartonFixture } = require('./cartonFixture.cjs');
const { loadMigrationManifest } = require('../src/config/migrationManifest');
const { runMigrations } = require('../src/maintenance/migrationRunner');
const { assertSchemaReady } = require('../src/config/schemaReadiness');

async function snapshot(db) {
    const names = (await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name<>'wms_schema_migrations' ORDER BY table_name")).rows.map(r => r.table_name);
    const tables = {};
    for (const name of names) {
        assert.match(name, /^[a-z0-9_]+$/);
        tables[name] = (await db.query(`SELECT to_jsonb(t) row FROM "${name}" t ORDER BY to_jsonb(t)::text`)).rows;
    }
    return { tables, sequences: (await db.query("SELECT sequencename,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows };
}

test('saved original box-spec batches on real isolated PostgreSQL', {
    skip: process.env.WMS_PARITY_PG_TEST !== '1', timeout: 120000
}, async t => {
    const f = await createCartonFixture({ postgres: true });
    t.after(() => f.close());
    const api = (actor, method, url, body) => {
        const call = request(f.app)[method](url);
        if (actor) call.set('x-fixture-user', String(actor));
        return body === undefined ? call : call.send({ ...body, expectedActorId: actor });
    };
    const ok = (response, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.body)); return response.body; };
    const spec = async id => ok(await api(1, 'post', '/api/box-specs', { specId: id, activate: true, lines: [{ itemCode: 'BATCH-SKU', productName: 'Original ten', internalScanCode: 'ITM-BATCH', quantity: 10 }] }), 201);
    const first = await spec('BATCH-HISTORY'), other = await spec('BATCH-OTHER');
    const sharedId = randomUUID();
    const create = async (actor, current, prefix, creationId = randomUUID(), count = 1) => {
        const body = { prefix, startNumber: 1, count, creationId, expectedContentRevision: current.contentRevision };
        return { body, result: ok(await api(actor, 'post', `/api/box-specs/${current.specId}/cartons`, body), 201) };
    };
    const original = await create(1, first, 'N', sharedId, 20);
    await create(5, first, 'OTHERCREATOR', sharedId, 2);
    const detailUrl = (creator = 1, id = sharedId, specId = first.specId) => `/api/box-specs/${specId}/batches/${creator}/${id}`;
    const batchesUrl = `/api/box-specs/${first.specId}/batches`;

    await t.test('same UUID for two creators resolves separate original memberships; wrong composite identity does not fall back', async () => {
        const a = ok(await api(2, 'get', detailUrl())), b = ok(await api(3, 'get', detailUrl(5)));
        assert.equal(a.creatorId, 1); assert.equal(b.creatorId, 5); assert.equal(a.creationId, b.creationId);
        assert.deepEqual(a.cartonIds, Array.from({ length: 20 }, (_, i) => `N${i + 1}`));
        assert.deepEqual(a.cartons.map(c => c.cartonId), a.cartonIds);
        assert.deepEqual(b.cartonIds, ['OTHERCREATOR1', 'OTHERCREATOR2']);
        assert.ok(!b.cartons.some(c => a.cartonIds.includes(c.cartonId)));
        assert.equal(ok(await api(2, 'get', '/api/box-specs/next-number?prefix=N')).nextNumber, 21);
        for (const url of [detailUrl(7), detailUrl(1, sharedId, other.specId)]) {
            const response = await api(1, 'get', url); assert.equal(response.status, 404); assert.equal(response.body.code, 'BOX_SPEC_BATCH_NOT_FOUND');
        }
    });
    await t.test('every existing staff role can read and all read endpoints preserve every business row and sequence', async () => {
        const before = await snapshot(f.db);
        for (const actor of [1,2,3,4,5,6,7,8]) {
            const list = ok(await api(actor, 'get', batchesUrl)); assert.equal(list.items.length, 2);
            const value = ok(await api(actor, 'get', detailUrl()));
            assert.equal(value.cartons.length, 20); assert.equal(value.cartons[0].lines[0].remainingQuantity, 10);
            assert.deepEqual(value.cartons[0].lines[0].actualSN, []);
        }
        assert.deepEqual(await snapshot(f.db), before);
        for (const url of [batchesUrl, detailUrl()]) assert.equal((await api(null, 'get', url)).status, 401);
        await assert.rejects(f.service.specBatches(first.specId, {}, { id: 999999, role: 'superadmin' }), error => error.status === 401);
        for (const actor of [2,3,4,6]) assert.equal((await api(actor, 'post', `/api/box-specs/${first.specId}/cartons`, { ...original.body, creationId: randomUUID(), prefix: 'UNAUTHORIZED' })).status, 403);
        assert.deepEqual(await snapshot(f.db), before);
    });
    await t.test('historical reads retain original quantity/revision after a spec correction and cannot reset partial balances or exact SN availability', async () => {
        const edited = ok(await api(1, 'patch', `/api/box-specs/${first.specId}`, { expectedContentRevision: first.contentRevision, reason: 'New future packing rule', lines: [{ itemCode: 'BATCH-SKU', productName: 'Future twelve', internalScanCode: 'ITM-BATCH', quantity: 12 }] }));
        assert.equal(edited.contentRevision, first.contentRevision + 1);
        // Represent an already used box without invoking any external inventory system.
        const sns = ['000Case/01','000case+02',...Array.from({length:8}, (_,i)=>'Exact-'+i)];
        await f.db.query("UPDATE wms_carton_lines SET remaining_quantity=5,actual_sns=$1 WHERE carton_id='N1'", [JSON.stringify(sns)]);
        const line = (await f.db.query("SELECT id FROM wms_carton_lines WHERE carton_id='N1'")).rows[0].id;
        for (const [i,sn] of sns.entries()) await f.db.query('INSERT INTO wms_carton_serials(serial_number,line_id,available) VALUES($1,$2,$3)', [sn,line,i % 2 === 1]);
        const before = await snapshot(f.db), read = ok(await api(4, 'get', detailUrl()));
        assert.equal(read.contentRevision, 1); assert.equal(read.cartons[0].contentRevision, 1);
        assert.equal(read.cartons[0].lines[0].quantity, 10); assert.equal(read.cartons[0].lines[0].remainingQuantity, 5);
        assert.deepEqual(read.cartons[0].lines[0].actualSN, sns);
        assert.deepEqual(read.cartons[0].lines[0].remainingSN, sns.filter((_,i)=>i % 2 === 1));
        assert.equal(read.cartons[1].lines[0].productName, 'Original ten');
        assert.deepEqual(await snapshot(f.db), before);
    });
    await t.test('cursor pagination uses full microseconds, creator and UUID ties without repeats and binds to its spec', async () => {
        const keys = [
            [1, '00000000-0000-4000-8000-000000000001', '2026-10-15T01:00:00.123457Z'],
            [1, '00000000-0000-4000-8000-000000000003', '2026-10-15T01:00:00.123456Z'],
            [5, '00000000-0000-4000-8000-000000000001', '2026-10-15T01:00:00.123456Z'],
            [5, '00000000-0000-4000-8000-000000000002', '2026-10-15T01:00:00.123456Z']
        ];
        for (const [actor,id,at] of keys) {
            await create(actor, other, `PAGE${actor}${id.at(-1)}`, id);
            await f.db.query('UPDATE wms_box_spec_batch_commands SET created_at=$1 WHERE user_id=$2 AND command_id=$3', [at, actor, id]);
        }
        const expected = [keys[0],keys[3],keys[2],keys[1]].map(([actor,id]) => `${actor}:${id}`), seen = [];
        let cursor;
        do {
            const page = ok(await api(2, 'get', `/api/box-specs/${other.specId}/batches?limit=1${cursor ? '&cursor=' + cursor : ''}`));
            assert.equal(page.items.length, 1); assert.match(page.items[0].createdAt, /\.\d{6}Z$/);
            seen.push(`${page.items[0].creatorId}:${page.items[0].creationId}`);
            if (!cursor) assert.equal((await api(2, 'get', batchesUrl + '?cursor=' + page.nextCursor)).status, 400);
            cursor = page.nextCursor; assert.equal(page.hasMore, !!cursor);
        } while (cursor);
        assert.deepEqual(seen, expected); assert.equal(new Set(seen).size, keys.length);
        for (const query of ['limit=0','limit=21','limit=1.5','limit=abc','cursor=bad']) assert.equal((await api(1, 'get', batchesUrl + '?' + query)).status, 400);
        const badDate = Buffer.from(JSON.stringify([1,first.specId,'2026-02-30T01:00:00.123456Z',1,sharedId])).toString('base64url');
        assert.equal((await api(1, 'get', batchesUrl + '?cursor=' + badDate)).status, 400);
        assert.equal((await api(1, 'get', '/api/box-specs/ABSENT/batches')).status, 404);
        for (const url of [detailUrl('01'),detailUrl('2147483648'),detailUrl(1,'invalid-uuid')]) assert.equal((await api(1, 'get', url)).status, 400);
    });
    await t.test('large original batch returns all ten thousand exact SN values and remaining availability within the read deadline', async () => {
        const large = ok(await api(1, 'post', '/api/box-specs', { specId: 'BATCH-LARGE-SN', activate: true, lines: [{ itemCode: 'LARGE-SKU', quantity: 200 }] }), 201);
        const made = await create(1, large, 'LARGE', randomUUID(), 50);
        await f.db.query(`UPDATE wms_carton_lines l SET actual_sns=(SELECT jsonb_agg(l.carton_id||'/000Case-'||n ORDER BY n) FROM generate_series(1,200) n),remaining_quantity=100 WHERE carton_id=ANY($1::text[])`, [made.result.cartons.map(c=>c.cartonId)]);
        await f.db.query(`INSERT INTO wms_carton_serials(serial_number,line_id,available) SELECT sn.value,l.id,(sn.ordinality%2=0) FROM wms_carton_lines l CROSS JOIN LATERAL jsonb_array_elements_text(l.actual_sns) WITH ORDINALITY sn(value,ordinality) WHERE carton_id=ANY($1::text[])`, [made.result.cartons.map(c=>c.cartonId)]);
        const checksum = async () => (await f.db.query(`SELECT (SELECT md5(string_agg(to_jsonb(l)::text,'' ORDER BY id)) FROM wms_carton_lines l) AS contents,(SELECT md5(string_agg(to_jsonb(s)::text,'' ORDER BY serial_number)) FROM wms_carton_serials s) AS serials`)).rows[0];
        const before = await checksum(), started = performance.now();
        const value = ok(await api(2, 'get', `/api/box-specs/${large.specId}/batches/1/${made.result.creationId}`));
        const elapsed = performance.now()-started;
        assert.ok(elapsed<8000, `Complete batch read elapsed ${elapsed.toFixed(1)}ms`);
        assert.equal(value.cartons.length,50);assert.equal(value.cartons.flatMap(c=>c.lines[0].actualSN).length,10000);
        for (const carton of value.cartons) {assert.equal(carton.lines[0].remainingSN.length,100);assert.equal(carton.lines[0].remainingSN[0],carton.cartonId+'/000Case-2');assert.equal(carton.lines[0].remainingQuantity,100);}
        assert.deepEqual(await checksum(),before);t.diagnostic(JSON.stringify({largeBatchCartons:50,exactSNs:10000,readMs:Number(elapsed.toFixed(1))}));
    });
    await t.test('an incomplete, duplicated, foreign or unsealed original batch rejects the whole reprint without mutation', async () => {
        const damage = await spec('BATCH-DAMAGE');
        const created = await create(1, damage, 'DAMAGE', randomUUID(), 2), id = created.result.creationId;
        const url = `/api/box-specs/${damage.specId}/batches/1/${id}`;
        const expectReadFailure = async code => { const before = await snapshot(f.db); const response = await api(1, 'get', url); assert.equal(response.status, 409); assert.equal(response.body.code, code); assert.deepEqual(await snapshot(f.db), before); };
        for (const ids of [['DAMAGE1','MISSING'],['DAMAGE1','DAMAGE1'],['DAMAGE1','N1']]) {
            await f.db.query('UPDATE wms_box_spec_batch_commands SET carton_ids=$1 WHERE user_id=1 AND command_id=$2', [JSON.stringify(ids),id]);
            await expectReadFailure('BOX_SPEC_BATCH_INCOMPLETE');
        }
        await f.db.query('UPDATE wms_box_spec_batch_commands SET carton_ids=$1 WHERE user_id=1 AND command_id=$2', [JSON.stringify(['DAMAGE1','DAMAGE2']),id]);
        for (const status of ['draft','void']) {
            await f.db.query("UPDATE wms_cartons SET status=$1 WHERE carton_id='DAMAGE2'", [status]);
            await expectReadFailure('BOX_SPEC_BATCH_NOT_SEALED');
        }
        await f.db.query("UPDATE wms_cartons SET status='sealed',source_reference=$1 WHERE carton_id='DAMAGE2'", [JSON.stringify({specId:damage.specId,contentRevision:99})]);
        await expectReadFailure('BOX_SPEC_BATCH_INCOMPLETE');
    });
});

test('043 adds only its batch-history index and preserves historical rows, credentials, exact SN, sequence values and memberships', {
    skip: process.env.WMS_PARITY_PG_TEST !== '1', timeout: 30000
}, async t => {
    const { Client, Pool } = require('pg'), config = require('./local-pg-config.cjs')();
    const database = 'wms_batch_index_' + randomBytes(6).toString('hex'), control = new Client(config);
    await control.connect(); await control.query(`CREATE DATABASE "${database}"`);
    const pool = new Pool({ ...config, database, max: 1 });
    t.after(async () => { await pool.end(); await control.query(`DROP DATABASE "${database}"`); await control.end(); });
    const manifest = loadMigrationManifest();
    await runMigrations({ pool, targetDatabase: database, manifest: manifest.filter(row => row.name < '043_') });
    await pool.query("INSERT INTO users(id,username,password,name,role) VALUES(1,'historic-user','preserve-password-hash','Historical owner','admin')");
    await pool.query("INSERT INTO wms_box_specs(spec_id,lines,created_by) VALUES('OLD-SPEC','[{\"itemCode\":\"OLD-SKU\",\"quantity\":10}]',1)");
    await pool.query("INSERT INTO wms_cartons(carton_id,status,created_by) VALUES('OLD-N1','sealed',1)");
    const line = (await pool.query("INSERT INTO wms_carton_lines(carton_id,position,item_code,code_type,quantity,remaining_quantity,actual_sns) VALUES('OLD-N1',1,'OLD-SKU','legacy',2,1,'[\"000Case/01\",\"000case+02\"]') RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO wms_carton_serials(serial_number,line_id,available) VALUES('000Case/01',$1,FALSE),('000case+02',$1,TRUE)", [line]);
    await pool.query("INSERT INTO wms_box_spec_batch_commands(user_id,command_id,spec_id,request_hash,content_revision,carton_ids) VALUES(1,$1,'OLD-SPEC','historic-request',1,'[\"OLD-N1\"]')", [randomUUID()]);
    const before = await snapshot(pool), oldIndexes = (await pool.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY indexname")).rows;
    assert.deepEqual((await runMigrations({ pool, targetDatabase: database, manifest })).applied, ['043_box_spec_batch_history_index.sql']);
    await assertSchemaReady(pool); assert.deepEqual(await snapshot(pool), before);
    const indexes = (await pool.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY indexname")).rows;
    assert.deepEqual(indexes.filter(i => i.indexname !== 'idx_wms_box_spec_batch_history'), oldIndexes);
    assert.match(indexes.find(i => i.indexname === 'idx_wms_box_spec_batch_history').indexdef, /spec_id, created_at DESC, user_id DESC, command_id DESC/);
    assert.deepEqual((await runMigrations({ pool, targetDatabase: database, manifest })).applied, []);
    assert.deepEqual(await snapshot(pool), before);
});
