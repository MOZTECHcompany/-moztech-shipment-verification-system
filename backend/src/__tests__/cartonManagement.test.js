const { createCartonService } = require('../services/cartonService');
const { assertCartonManager, assertAllocationManager } = require('../utils/cartonAccess');
const { isWarehouseAdmin } = require('../utils/managementScope');

const actor = { id: 1, username: 'fixture-orders', name: '訂單管理員', role: 'admin', management_scope: 'orders' };
const line = { itemCode: 'SKU', productName: '商品', ean: '4710000000001', quantity: 10, actualSN: [] };
function fixture({ user = actor, allocations = [], actualSN = [], failOnInsert = 0, commitThenFail = false } = {}) {
    const cartonId = 'CTN-FIXTURE';
    let committed = { cartons: new Map([[cartonId, { carton_id: cartonId, status: 'sealed', content_revision: 3, state_revision: 8,
        sealed_at: '2026-10-15T00:00:00Z', created_at: '2026-10-15T00:00:00Z', updated_at: '2026-10-15T00:00:00Z' }]]),
    lines: new Map([[cartonId, [{ id: 1, carton_id: cartonId, position: 0, item_code: 'SKU', product_name: '商品',
        quantity: actualSN.length || 10, remaining_quantity: actualSN.length || 10, actual_sns: actualSN }]]]),
    serials: actualSN.map(sn => ({ serial_number: sn, line_id: 1, available: true })), allocations,
    history: [], specs: new Map([['SPEC-10', { spec_id: 'SPEC-10', status: 'active', content_revision: 2, lines: [structuredClone(line)] }]]), commands: new Map(), nextLineId: 2 };
    let current, inserts = 0, failOnce = commitThenFail;
    const result = rows => ({ rows: structuredClone(rows), rowCount: rows.length });
    const db = { query: jest.fn(async (sql, args = []) => {
        const q = sql.replace(/\s+/g, ' ').trim();
        if (q.startsWith('BEGIN')) { current = structuredClone(committed); return result([]); }
        if (q.startsWith('SET LOCAL') || q.includes('pg_advisory_xact_lock')) return result([]);
        if (q === 'ROLLBACK') { current = null; return result([]); }
        if (q === 'COMMIT') { committed = current; current = null; if (failOnce) { failOnce = false; throw new Error('lost commit response'); } return result([]); }
        const state = current || committed;
        if (q.startsWith('SELECT id,username,name,role')) return result([user]);
        if (q.startsWith('SELECT * FROM wms_box_spec_batch_commands')) return result(state.commands.has(args.join(':')) ? [state.commands.get(args.join(':'))] : []);
        if (q.startsWith('SELECT * FROM wms_box_specs')) return result(state.specs.has(args[0]) ? [state.specs.get(args[0])] : []);
        if (q.startsWith('SELECT carton_id FROM wms_cartons WHERE carton_id=ANY')) return result(args[0].filter(id=>state.cartons.has(id)).map(carton_id=>({carton_id})));
        if (q.startsWith('SELECT * FROM wms_cartons')) return result(state.cartons.has(args[0]) ? [state.cartons.get(args[0])] : []);
        if (q.startsWith('SELECT * FROM wms_carton_lines')) return result(state.lines.get(args[0]) || []);
        if (q.startsWith('SELECT s.*')) {
            const ids = new Set((state.lines.get(args[0]) || []).map(row => row.id));
            return result(state.serials.filter(row => ids.has(row.line_id)));
        }
        if (q.startsWith('SELECT * FROM wms_carton_allocations')) return result(state.allocations.filter(row => row.carton_id === args[0]));
        if (q.startsWith('SELECT * FROM wms_carton_history')) return result(state.history.filter(row => row.carton_id === args[0]).reverse());
        if (q.startsWith('SELECT s.serial_number')) {
            const rows = state.serials.flatMap(sn => [...state.lines.values()].flat().filter(row => row.id === sn.line_id).map(row => {
                const carton = state.cartons.get(row.carton_id);
                return { ...sn, ...row, status: carton.status, content_revision: carton.content_revision, state_revision: carton.state_revision };
            })).filter(row => q.includes('POSITION(') ? row.serial_number.includes(args[0]) : row.serial_number === args[0]);
            return result(rows.slice(0, args[1]));
        }
        if (q.startsWith('INSERT INTO wms_cartons')) {
            if (++inserts === failOnInsert) throw new Error('synthetic second box failure');
            state.cartons.set(args[0], { carton_id: args[0], source_system: args[1], source_reference: args[2], status: 'draft',
                content_revision: 1, state_revision: 1, sealed_at: null }); state.lines.set(args[0], []); return result([]);
        }
        if (q.startsWith('INSERT INTO wms_carton_lines')) {
            const row = { id: state.nextLineId++, carton_id: args[0], position: args[1], item_code: args[2], product_name: args[3],
                international_barcode: args[4], internal_scan_code: args[5], code_type: args[6], quantity: args[7], remaining_quantity: args[7], actual_sns: JSON.parse(args[8]) };
            state.lines.get(args[0]).push(row); return result([{ id: row.id }]);
        }
        if (q.startsWith('UPDATE wms_cartons SET status=')) {
            const carton = state.cartons.get(args[0]); carton.status = q.includes("status='draft'") ? 'draft' : 'sealed';
            carton.sealed_at = carton.status === 'sealed' ? '2026-10-15T00:00:00Z' : null; carton.state_revision++; return result([]);
        }
        if (q.startsWith('INSERT INTO wms_carton_history')) {
            const carton = state.cartons.get(args[0]);
            state.history.push({ id: state.history.length + 1, carton_id: args[0], event_type: args[1], actor_id: args[2],
                details: JSON.parse(args[3]), content_revision: carton.content_revision, state_revision: carton.state_revision }); return result([]);
        }
        if (q.startsWith('INSERT INTO wms_box_spec_batch_commands')) {
            state.commands.set(`${args[0]}:${args[1]}`, { user_id: args[0], command_id: args[1], spec_id: args[2], request_hash: args[3],
                content_revision: args[4], carton_ids: JSON.parse(args[5]) }); return result([]);
        }
        throw new Error(`Unexpected transport: ${q}`);
    }), release: jest.fn() };
    const pool = { connect: jest.fn(async () => db) };
    return { service: createCartonService({ pool }), db, pool, state: () => committed, cartonId };
}
const reopenBody = { reason: '更正入箱內容', expectedContentRevision: 3, expectedStateRevision: 8, expectedActorId: 1 };
const snapshot = value => JSON.stringify(value, (_key, entry) => Object.prototype.toString.call(entry) === '[object Map]' ? [...entry] : entry);
const creationBody = { count: 3, creationId: '12345678-1234-4123-8123-123456789abc', expectedContentRevision: 2, expectedActorId: 1 };

test.each(['orders','warehouse','all'])('all admin scopes can maintain boxes while scope %s keeps its original warehouse review authority', scope => {
    const manager = { ...actor, management_scope: scope };
    expect(() => assertCartonManager(manager)).not.toThrow();
    expect(isWarehouseAdmin(manager)).toBe(scope !== 'orders');
    if (scope === 'orders') expect(() => assertAllocationManager(manager)).toThrow('倉儲管理員');
});
test.each(['dispatcher','picker','packer'])('box maintenance does not elevate %s or trust a forged request role', async role => {
    const f = fixture({ user: { ...actor, role } });
    await expect(f.service.create({ cartonId: 'NEW', lines: [line] }, { ...actor, role: 'superadmin' })).rejects.toMatchObject({ status: 403 });
    expect(f.state().cartons.size).toBe(1);
    expect(f.db.query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
});
test('reopening only an unused sealed physical box preserves exact SN, quantity, identity and source contents', async () => {
    const f = fixture({ actualSN: ['Aa-100', 'Bb-200'] });
    const beforeLines = snapshot(f.state().lines), beforeSN = structuredClone(f.state().serials);
    const reopened = await f.service.reopen(f.cartonId, reopenBody, actor);
    expect(reopened).toMatchObject({ cartonId: f.cartonId, status: 'draft', contentRevision: 3, stateRevision: 9, sealedAt: null });
    expect(snapshot(f.state().lines)).toBe(beforeLines); expect(f.state().serials).toEqual(beforeSN);
    expect(reopened.history[0]).toMatchObject({ event_type: 'contents_reopened', details: { reason: reopenBody.reason,
        actor_snapshot: actor, before: { status: 'sealed', stateRevision: 8 }, after: { status: 'draft', stateRevision: 9 }, contents_unchanged: true } });
    expect(f.db.query.mock.calls.some(([sql]) => sql.includes('wms_cartons') && sql.includes('FOR UPDATE'))).toBe(true);
});
test.each(['picked','packed','released'])('even historical %s allocation prevents rewriting the physical box', async status => {
    const f = fixture({ allocations: [{ carton_id: 'CTN-FIXTURE', status, lines: [] }] });
    const before = snapshot(f.state());
    await expect(f.service.reopen(f.cartonId, reopenBody, actor)).rejects.toMatchObject({ code: 'CARTON_CONTENT_LOCKED', status: 409 });
    expect(snapshot(f.state())).toBe(before);
});
test.each([{ expectedContentRevision: 2 }, { expectedStateRevision: 7 }])('stale reopen versions cannot mutate box or history: %j', async patch => {
    const f = fixture(), before = snapshot(f.state());
    await expect(f.service.reopen(f.cartonId, { ...reopenBody, ...patch }, actor)).rejects.toMatchObject({ status: 409 });
    expect(snapshot(f.state())).toBe(before);
});
test('reopen needs a reason and immutable carton identifiers cannot be edited', async () => {
    const f = fixture();
    await expect(f.service.reopen(f.cartonId, { ...reopenBody, reason: ' ' }, actor)).rejects.toMatchObject({ status: 400 });
    await expect(f.service.edit(f.cartonId, { cartonId: 'RENAMED', lines: [line], expectedContentRevision: 3 }, actor)).rejects.toMatchObject({ code: 'CARTON_ID_IMMUTABLE' });
    expect(f.pool.connect).not.toHaveBeenCalled();
});
test('SN query reads the registered literal case-sensitive identity and never guesses or applies SQL wildcards', async () => {
    const f = fixture({ actualSN: ['Ab%_001', 'AB-002'] }), before = snapshot(f.state());
    expect((await f.service.searchSerials({ q: 'ab%_001' }, actor)).items).toEqual([]);
    const found = await f.service.searchSerials({ q: '%_', match: 'contains', limit: 1 }, actor);
    expect(found.items).toEqual([expect.objectContaining({ serialNumber: 'Ab%_001', cartonId: f.cartonId, available: true, readyForPicking: true })]);
    expect(f.db.query.mock.calls.find(([sql]) => sql.includes('POSITION('))[1]).toEqual(['%_', 2]);
    expect(f.db.query.mock.calls.filter(([sql]) => sql.includes('s.serial_number')).every(([sql]) => !/LIKE|UPPER|LOWER/.test(sql))).toBe(true);
    expect(snapshot(f.state())).toBe(before);
    expect(f.db.query.mock.calls.filter(([sql]) => sql.startsWith('BEGIN')).every(([sql]) => sql.includes('READ ONLY'))).toBe(true);
});
test('a template generates separate sealed boxes atomically and an identical creation retry never creates more boxes', async () => {
    const f = fixture();
    const created = await f.service.createFromSpec('SPEC-10', creationBody, actor);
    expect(created.replayed).toBe(false); expect(created.cartons).toHaveLength(3);
    expect(new Set(created.cartons.map(box => box.cartonId)).size).toBe(3);
    for (const [index, box] of created.cartons.entries()) {
        expect(box).toMatchObject({ status: 'sealed', sourceSystem: 'corely-box-spec', contentRevision: 1 });
        expect(box.lines[0]).toMatchObject({ quantity: 10, remainingQuantity: 10, actualSN: [] });
        expect(JSON.parse(box.sourceReference)).toEqual({ specId: 'SPEC-10', contentRevision: 2, batchNumber: index + 1 });
    }
    f.state().specs.get('SPEC-10').content_revision = 3;
    f.state().specs.get('SPEC-10').lines[0].quantity = 20;
    const replay = await f.service.createFromSpec('SPEC-10', creationBody, actor);
    expect(replay.replayed).toBe(true); expect(replay.boxSpec.contentRevision).toBe(2);
    expect(replay.cartons.map(box => box.cartonId)).toEqual(created.cartons.map(box => box.cartonId));
    expect(replay.cartons.every(box => box.lines[0].quantity === 10)).toBe(true);
    expect(f.state().cartons.size).toBe(4); expect(f.state().commands.size).toBe(1);
    await expect(f.service.createFromSpec('SPEC-10', { ...creationBody, count: 2 }, actor)).rejects.toMatchObject({ code: 'BOX_SPEC_COMMAND_CONFLICT' });
});
test('a second box creation failure rolls back every newly created box, seal history and batch receipt', async () => {
    const f = fixture({ failOnInsert: 2 }), before = snapshot(f.state());
    await expect(f.service.createFromSpec('SPEC-10', creationBody, actor)).rejects.toThrow('synthetic second box failure');
    expect(snapshot(f.state())).toBe(before); expect(f.db.query).toHaveBeenCalledWith('ROLLBACK');
});
test('an unknown committed batch outcome keeps the receipt and is confirmed by retrying the same creation ID', async () => {
    const f = fixture({ commitThenFail: true });
    await expect(f.service.createFromSpec('SPEC-10', creationBody, actor)).rejects.toMatchObject({ status: 503, code: 'CARTON_CREATION_RESULT_UNKNOWN' });
    expect(f.db.release.mock.calls[0][0]).toBeInstanceOf(Error);
    const replay = await f.service.createFromSpec('SPEC-10', creationBody, actor);
    expect(replay.replayed).toBe(true); expect(replay.cartons).toHaveLength(3); expect(f.state().cartons.size).toBe(4);
});
test('a template containing any actual SN cannot clone that serial into multiple physical boxes', async () => {
    const f = fixture(); f.state().specs.get('SPEC-10').lines = [{ ...line, quantity: 1, actualSN: ['ACTUAL-SN'] }];
    const before = snapshot(f.state());
    await expect(f.service.createFromSpec('SPEC-10', creationBody, actor)).rejects.toMatchObject({ code: 'BOX_SPEC_SN_NOT_ALLOWED' });
    expect(snapshot(f.state())).toBe(before);
});
test('a box-spec prefix cannot be mistaken for a shippable physical box', async () => {
    const f = fixture();
    await expect(f.service.lookup('BOX-SPEC:SPEC-10', actor)).rejects.toMatchObject({ code: 'BOX_SPEC_NOT_PHYSICAL_CARTON', status: 400 });
    expect(f.db.query.mock.calls.some(([sql]) => sql.startsWith('SELECT carton_id'))).toBe(false);
});


test('numbered box batches create exactly N1 through N20, with independent ten-unit contents and stable retry IDs',async()=>{
    const f=fixture(), body={...creationBody,prefix:'N',startNumber:1,count:20};
    const created=await f.service.createFromSpec('SPEC-10',body,actor);
    expect(created.cartons.map(box=>box.cartonId)).toEqual(Array.from({length:20},(_,i)=>'N'+(i+1)));
    expect(created.cartons.reduce((sum,box)=>sum+box.lines[0].quantity,0)).toBe(200);
    expect(created.cartons.every(box=>box.status==='sealed'&&box.lines[0].remainingQuantity===10)).toBe(true);
    expect(created.cartons.map(box=>JSON.parse(box.sourceReference).batchNumber)).toEqual(Array.from({length:20},(_,i)=>i+1));
    const replay=await f.service.createFromSpec('SPEC-10',body,actor);
    expect(replay.replayed).toBe(true); expect(replay.cartons.map(box=>box.cartonId)).toEqual(created.cartons.map(box=>box.cartonId));
    await expect(f.service.createFromSpec('SPEC-10',{...body,startNumber:2},actor)).rejects.toMatchObject({code:'BOX_SPEC_COMMAND_CONFLICT'});
});
test('an occupied numbered slot fails the entire batch without skipping or overwriting the old box',async()=>{
    const f=fixture();
    f.state().cartons.set('N2',{...f.state().cartons.get(f.cartonId),carton_id:'N2'});
    const before=snapshot(f.state());
    await expect(f.service.createFromSpec('SPEC-10',{...creationBody,prefix:'N',startNumber:1},actor)).rejects.toMatchObject({code:'BOX_SPEC_NUMBER_EXISTS',message:expect.stringContaining('N2')});
    expect(snapshot(f.state())).toBe(before);
    expect(f.state().cartons.has('N1')).toBe(false);
});
test.each([{count:'20'},{prefix:'N',startNumber:'1'},{prefix:'N',startNumber:0},{prefix:'N',startNumber:9999999,count:2},{prefix:'n',startNumber:1},{prefix:'N'},{startNumber:1},{count:101}])('numbered batch count and identifiers require real bounded integers: %j',async patch=>{
    const f=fixture();
    await expect(f.service.createFromSpec('SPEC-10',{...creationBody,...patch},actor)).rejects.toMatchObject({status:400});
    expect(f.pool.connect).not.toHaveBeenCalled();
});
test('batch creation bounds total copied content rows before creating any carton',async()=>{
    const f=fixture();f.state().specs.get('SPEC-10').lines=Array.from({length:11},(_,i)=>({...line,itemCode:'SKU'+i}));
    const before=snapshot(f.state());
    await expect(f.service.createFromSpec('SPEC-10',{...creationBody,count:100,prefix:'N',startNumber:1},actor)).rejects.toMatchObject({status:400});
    expect(snapshot(f.state())).toBe(before);
});
