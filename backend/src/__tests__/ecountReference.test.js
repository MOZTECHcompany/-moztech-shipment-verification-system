const { buildEcountManifest } = require('../services/ecountReferenceManifest');
const { createEcountReferenceService, confirmationInput, checkConfirmation, parseInput, canManage, normalizedVoucher } = require('../services/ecountReferenceService');
const copy = value => structuredClone(value);
const uuid = '00000000-0000-4000-8000-000000000001';
function shipment() {
    return { order: { id: 7, voucher_number: 'WMS-LOCAL-7', status: 'completed', document_type: 'shipment' },
        items: [{ id: 11, order_id: 7, product_code: 'SKU-001', product_name: 'Test item', quantity: 25, quantity_sign: 1,
            picked_quantity: 25, packed_quantity: 25, source_line_id: 'SOURCE-LINE', source_sku: '0001' }], instances: [], exceptions: [],
        allocations: [5, 10, 10].map((quantity, index) => ({ id: 'allocation-' + index, carton_id: 'N' + (index + 1),
            content_revision: 1, status: 'packed', packed_at: '2026-10-15T00:00:00.000Z', lines: [{ lineId: index + 1,
                orderItemId: 11, itemCode: 'SKU-001', quantity, quantitySign: 1, actualSN: [], sourceLineId: 'SOURCE-LINE', sourceSKU: '0001' }] })) };
}
const inputFor = state => ({ commandId: uuid, expectedRevision: 0, expectedFingerprint: buildEcountManifest(state).fingerprint,
    expectedActorId: 3, companyCode: '001234', voucherNumber: '2026/10/15-7', confirmation: null });
function fixture() {
    const h = { data: shipment(), user: { id: 3, username: 'local-clerk', name: 'Clerk', role: 'dispatcher', management_scope: 'all' },
        reference: null, otherReferences: [], history: [], commands: [], logs: [], failAudit: false, uncertainCommit: false, writes: [] };
    const persisted = () => copy({ reference: h.reference, history: h.history, commands: h.commands, logs: h.logs });
    h.client = { release: jest.fn(), query: jest.fn(async (sql, values = []) => {
        if (sql.startsWith('BEGIN')) { h.before = persisted(); h.committed = false; h.readOnly = sql.includes('READ ONLY'); return { rows: [] }; }
        if (sql.startsWith('SET LOCAL') || sql.includes('pg_advisory_xact_lock')) return { rows: [] };
        if (sql === 'ROLLBACK') { if (!h.committed) Object.assign(h, h.before); return { rows: [] }; }
        if (sql === 'COMMIT') { h.committed = true; if (h.uncertainCommit) { h.uncertainCommit = false; throw Error('Commit response lost'); } return { rows: [] }; }
        if (sql.startsWith('SELECT id,username,name,role,management_scope FROM users')) return { rows: h.user ? [copy(h.user)] : [] };
        if (sql.startsWith('SELECT * FROM orders')) return { rows: [copy(h.data.order)] };
        if (sql.startsWith('SELECT * FROM order_items')) return { rows: copy(h.data.items) };
        if (sql.startsWith('SELECT i.* FROM order_item_instances')) return { rows: copy(h.data.instances) };
        if (sql.startsWith('SELECT * FROM wms_carton_allocations')) return { rows: copy(h.data.allocations) };
        if (sql.startsWith('SELECT id,type,status,updated_at FROM order_exceptions')) return { rows: copy(h.data.exceptions) };
        if (sql.includes('to_regclass(')) return { rows: [{}] };
        if (sql.includes('FROM wms_ecount_order_references WHERE order_id=')) return { rows: h.reference ? [copy(h.reference)] : [] };
        if (sql.includes('FROM wms_ecount_reference_history WHERE order_id=')) return { rows: copy(h.history).reverse() };
        if (sql.startsWith('SELECT * FROM wms_ecount_reference_commands')) return { rows: copy(h.commands.filter(row => row.user_id === values[0] && row.command_id === values[1])) };
        if (sql.includes('SELECT order_id FROM wms_ecount_order_references')) return { rows: h.otherReferences.filter(row => row.company_code === values[0] && row.voucher_number === values[1] && row.order_id !== values[2] && row.confirmation_kind) };
        if (h.readOnly) throw Error('Attempted read-only mutation');
        h.writes.push(sql);
        if (sql.startsWith('INSERT INTO wms_ecount_order_references')) {
            h.reference = { order_id: values[0], company_code: values[1], voucher_number: values[2], revision: values[3], manifest_fingerprint: values[4],
                confirmed_fingerprint: values[5], confirmation_kind: values[6], confirmation_evidence: values[7] && JSON.parse(values[7]),
                confirmed_by: values[8], confirmed_actor_snapshot: values[9] && JSON.parse(values[9]),
                confirmed_at: values[6] ? '2026-10-15T01:00:00.000Z' : null, updated_by: values[10], updated_actor_snapshot: JSON.parse(values[11]), updated_at: '2026-10-15T01:00:00.000Z' };
            return { rows: [] };
        }
        if (sql.startsWith('INSERT INTO wms_ecount_reference_history')) {
            h.history.push({ id: h.history.length + 1, order_id: values[0], revision: values[1], event_type: values[2], actor_id: values[3], actor_snapshot: JSON.parse(values[4]),
                reason: values[5], before_state: values[6] && JSON.parse(values[6]), after_state: JSON.parse(values[7]), evidence: values[8] && JSON.parse(values[8]), created_at: '2026-10-15T01:00:00.000Z' });
            return { rows: [] };
        }
        if (sql.startsWith('INSERT INTO operation_logs')) { if (h.failAudit) throw Error('Audit unavailable'); h.logs.push(copy(values)); return { rows: [] }; }
        if (sql.startsWith('INSERT INTO wms_ecount_reference_commands')) {
            h.commands.push({ user_id: values[0], command_id: values[1], order_id: values[2], request_hash: values[3], reference_revision: values[4] }); return { rows: [] };
        }
        throw Error('Unexpected query');
    }) };
    h.pool = { connect: jest.fn(async () => h.client) }; h.service = createEcountReferenceService({ pool: h.pool }); return h;
}
const checked = lines => ({ kind: 'manual-line-check', lines, acknowledgeExistingSales: true, acknowledgeMetadataSaved: true });

test('25 actual packed units are N1=5 + N2=10 + N3=10; released history never contributes quantity', () => {
    const data = shipment(); data.allocations.push({ ...copy(data.allocations[0]), id: 'released-old', status: 'released' });
    const manifest = buildEcountManifest(data);
    expect(manifest.ready).toBe(true); expect(manifest.rows.map(row => row.quantity)).toEqual([5, 10, 10]);
    expect(manifest.totals[0]).toMatchObject({ quantity: 25, boxedQuantity: 25, looseQuantity: 0 });
    expect(manifest.cartonSummary).toEqual([{ cartonId: 'N1', quantity: 5 }, { cartonId: 'N2', quantity: 10 }, { cartonId: 'N3', quantity: 10 }]);
});
test('fingerprints ignore another order consuming carton remaining, but distinguish same-quantity physical boxes and source identities', () => {
    const original = shipment(), hash = buildEcountManifest(original).fingerprint;
    const otherOrder = copy(original); otherOrder.allocations[0].currentRemainingQuantity = 0;
    expect(buildEcountManifest(otherOrder).fingerprint).toBe(hash);
    for (const mutate of [data => { data.allocations[0].id = 'new-allocation'; }, data => { data.allocations[0].carton_id = 'N99'; },
        data => { data.allocations[0].content_revision++; }, data => { data.items[0].quantity_sign = -1; },
        data => { data.allocations[0].lines[0].sourceLineId = 'OTHER-SOURCE'; }, data => { data.items[0].packed_quantity--; }]) {
        const changed = copy(original); mutate(changed); expect(buildEcountManifest(changed).fingerprint).not.toBe(hash);
    }
});
test('mixed boxed SN, loose SN and unboxed ordinary goods retain every real unit without inventing boxes', () => {
    const data = shipment(); data.items[0].quantity = 3; data.items[0].picked_quantity = 0; data.items[0].packed_quantity = 0;
    data.instances = ['00Aa', '00Bb', '00Cc'].map((sn, index) => ({ id: index + 1, order_item_id: 11, serial_number: sn, status: 'packed' }));
    data.allocations = [{ ...data.allocations[0], lines: [{ ...data.allocations[0].lines[0], quantity: 2, actualSN: ['00Aa', '00Bb'] }] }];
    data.items.push({ id: 12, product_code: 'LOOSE', quantity: 4, quantity_sign: 1, picked_quantity: 4, packed_quantity: 4 });
    const manifest = buildEcountManifest(data);
    expect(manifest.ready).toBe(true);
    expect(manifest.looseRows).toEqual(expect.arrayContaining([expect.objectContaining({ itemCode: 'SKU-001', quantity: 1, actualSN: ['00Cc'] }), expect.objectContaining({ itemCode: 'LOOSE', quantity: 4, actualSN: [] })]));
    expect(manifest.totals.find(row => row.itemCode === 'SKU-001')).toMatchObject({ quantity: 3, boxedQuantity: 2, looseQuantity: 1, actualSN: ['00Aa', '00Bb', '00Cc'] });
});
test.each([
    ['not-completed', data => { data.order.status = 'packing'; }], ['signed', data => { data.order.document_type = 'reversal'; data.items[0].quantity_sign = -1; }],
    ['pending', data => { data.exceptions.push({ id: 1, type: 'order_change', status: 'open' }); }], ['voided', data => { data.order.status = 'voided'; }],
    ['incomplete', data => { data.items[0].packed_quantity = 24; }], ['unpacked-box', data => { data.allocations[0].status = 'picked'; }]
])('manual confirmation is blocked for %s even when the caller supplies matching quantities', (_name, mutate) => {
    const data = shipment(); mutate(data); const manifest = buildEcountManifest(data);
    expect(manifest.ready).toBe(false); expect(() => checkConfirmation(confirmationInput(checked([{ itemCode: 'SKU-001', quantity: 25 }])), manifest)).toThrow();
});
test('external SN rows aggregate exact SKU quantities but never ignore case, zeros, missing or duplicate serials', () => {
    const manifest = { ready: true, totals: [{ itemCode: 'SKU-001', quantity: 2, actualSN: ['00Aa', '00Bb'] }] };
    expect(() => checkConfirmation(confirmationInput(checked([{ itemCode: 'SKU-001', quantity: 1, actualSN: ['00Aa'] }, { itemCode: 'SKU-001', quantity: 1, actualSN: ['00Bb'] }])), manifest)).not.toThrow();
    for (const lines of [[{ itemCode: 'SKU-001', quantity: 2 }], [{ itemCode: 'SKU-001', quantity: 2, actualSN: ['00AA', '00Bb'] }],
        [{ itemCode: 'sku-001', quantity: 2, actualSN: ['00Aa', '00Bb'] }]]) expect(() => checkConfirmation(confirmationInput(checked(lines)), manifest)).toThrow();
    expect(() => confirmationInput(checked([{ itemCode: 'SKU-001', quantity: 2, actualSN: ['00Aa', '00Aa'] }]))).toThrow();
});
test('literal company code and leading zero SKU survive; incomplete acknowledgments and string counts cannot confirm', () => {
    expect(parseInput({ ...inputFor(shipment()), companyCode: '001234' }).companyCode).toBe('001234');
    expect(() => confirmationInput({ ...checked([{ itemCode: '00001', quantity: 1 }]), acknowledgeMetadataSaved: false })).toThrow();
    expect(() => confirmationInput(checked([{ itemCode: '00001', quantity: '1' }]))).toThrow();
    expect(confirmationInput(checked([{ itemCode: '00001', quantity: 1 }])).lines[0].itemCode).toBe('00001');
});
test('1040 external one-SN rows and the documented 10000-row/SN boundary remain exact', () => {
    const lines = Array.from({ length: 10000 }, (_, index) => ({ itemCode: 'SKU-001', quantity: 1, actualSN: ['SN-' + String(index).padStart(8, '0')] }));
    for (const size of [1040, 10000]) {
        const parsed = confirmationInput(checked(lines.slice(0, size)));
        expect(parsed.lines).toHaveLength(size);
        expect(() => checkConfirmation(parsed, { ready: true, totals: [{ itemCode: 'SKU-001', quantity: size, actualSN: lines.slice(0, size).map(line => line.actualSN[0]).sort() }] })).not.toThrow();
    }
    expect(() => confirmationInput(checked([...lines, { itemCode: 'SKU-001', quantity: 1, actualSN: ['SN-OVER-LIMIT'] }]))).toThrow();
    expect(() => confirmationInput(checked([{ itemCode: 'SKU-001', quantity: 10001, actualSN: Array.from({ length: 10001 }, (_, index) => 'SN-' + index) }]))).toThrow();
    expect(() => confirmationInput(checked([
        { itemCode: 'SKU-A', quantity: 6000, actualSN: lines.slice(0, 6000).map(line => line.actualSN[0]) },
        { itemCode: 'SKU-B', quantity: 4001, actualSN: [...lines.slice(6000).map(line => line.actualSN[0]), 'SN-OVER-LIMIT'] }
    ]))).toThrow();
});
test('external quantity aggregation rejects overflow across one SKU or distinct SKUs before comparing evidence', () => {
    expect(confirmationInput(checked([{ itemCode: 'SKU-A', quantity: Number.MAX_SAFE_INTEGER }])).lines[0].quantity).toBe(Number.MAX_SAFE_INTEGER);
    for (const itemCode of ['SKU-A', 'SKU-B']) {
        expect(() => confirmationInput(checked([{ itemCode: 'SKU-A', quantity: Number.MAX_SAFE_INTEGER }, { itemCode, quantity: 1 }]))).toThrow('整數範圍');
    }
});
test.each(['dispatcher', 'admin', 'superadmin'])('%s records only local metadata with immutable actor history and no shipment or stock changes', async role => {
    const h = fixture(); h.user.role = role; const original = copy(h.data);
    const result = await h.service.save(7, inputFor(h.data), { id: 3 });
    expect(result.status).toBe('reference_only'); expect(result.canManage).toBe(true); expect(result.reference.revision).toBe(1);
    expect(result.reference.confirmationKind).toBeNull(); expect(h.data).toEqual(original);
    expect(h.history[0].actor_snapshot.role).toBe(role); expect(h.commands).toHaveLength(1);
    expect(h.writes.every(sql => /^INSERT INTO (wms_ecount_|operation_logs)/.test(sql))).toBe(true);
});
test.each(['picker', 'packer'])('%s can read but forged management role cannot write', async role => {
    const h = fixture(); h.user.role = role;
    expect((await h.service.get(7, { id: 3 })).canManage).toBe(false);
    await expect(h.service.save(7, inputFor(h.data), { id: 3, role: 'superadmin' })).rejects.toMatchObject({ status: 403 });
    expect(h.reference).toBeNull(); expect(h.writes).toEqual([]);
});
test('same command retry is side-effect free and reports changed shipment rather than stale manual success', async () => {
    const h = fixture(), body = { ...inputFor(h.data), confirmation: checked([{ itemCode: 'SKU-001', quantity: 25 }]) };
    expect((await h.service.save(7, body, { id: 3 })).status).toBe('manual_checked');
    h.data.allocations[0].carton_id = 'N99';
    const retry = await h.service.save(7, body, { id: 3 });
    expect(retry.replayed).toBe(true); expect(retry.status).toBe('changed'); expect(h.history).toHaveLength(1); expect(h.logs).toHaveLength(1);
    await expect(h.service.save(7, { ...body, voucherNumber: '2026/10/15-8' }, { id: 3 })).rejects.toMatchObject({ code: 'ECOUNT_REFERENCE_COMMAND_CONFLICT' });
});
test('stale versions, stale shipment, changed actor and mismatched quantities leave no metadata or audit changes', async () => {
    for (const patch of [{ expectedRevision: 1 }, { expectedFingerprint: 'a'.repeat(64) }, { expectedActorId: 4 },
        { confirmation: checked([{ itemCode: 'SKU-001', quantity: 24 }]) }]) {
        const h = fixture(); await expect(h.service.save(7, { ...inputFor(h.data), ...patch }, { id: 3 })).rejects.toBeTruthy();
        expect(h.reference).toBeNull(); expect(h.history).toEqual([]); expect(h.commands).toEqual([]);
    }
});
test('changing a saved voucher requires a reason and all earlier references stay in history', async () => {
    const h = fixture(), body = inputFor(h.data); await h.service.save(7, body, { id: 3 });
    const next = { ...body, commandId: '00000000-0000-4000-8000-000000000002', expectedRevision: 1, voucherNumber: 'OTHER' };
    await expect(h.service.save(7, next, { id: 3 })).rejects.toMatchObject({ code: 'ECOUNT_REFERENCE_REASON_REQUIRED' });
    await h.service.save(7, { ...next, reason: 'Correcting reference only' }, { id: 3 });
    expect(h.reference.revision).toBe(2); expect(h.history[1].before_state.voucherNumber).toBe(body.voucherNumber);
});
test('audit failure rolls reference and receipt back; uncertain successful commit is safely confirmed with the original command', async () => {
    const failed = fixture(); failed.failAudit = true;
    await expect(failed.service.save(7, inputFor(failed.data), { id: 3 })).rejects.toThrow('Audit unavailable');
    expect(failed.reference).toBeNull(); expect(failed.history).toEqual([]); expect(failed.commands).toEqual([]);
    const uncertain = fixture(), body = inputFor(uncertain.data); uncertain.uncertainCommit = true;
    await expect(uncertain.service.save(7, body, { id: 3 })).rejects.toMatchObject({ code: 'ECOUNT_REFERENCE_RESULT_UNKNOWN', status: 503 });
    expect(uncertain.client.release).toHaveBeenCalledWith(expect.any(Error));
    expect((await uncertain.service.save(7, body, { id: 3 })).replayed).toBe(true); expect(uncertain.history).toHaveLength(1);
});
test('the management helper does not grant ordinary warehouse workers reference mutation', () => {
    expect(canManage({ role: 'dispatcher' })).toBe(true); expect(canManage({ role: 'picker', management_scope: 'all' })).toBe(false);
});
test.each(['2026/10/15 -1', '2026-10-15-01', '2026.10.15－0001'])('equivalent dated voucher %s uses the same company/document identity', value => {
    expect(normalizedVoucher(value)).toEqual({ value: '2026/10/15-1', dated: true });
});
test('non-date references are allowed as references but cannot masquerade as a checked saved document', () => {
    expect(parseInput({ ...inputFor(shipment()), voucherNumber: 'HUMAN-REFERENCE' }).voucherNumber).toBe('HUMAN-REFERENCE');
    expect(() => parseInput({ ...inputFor(shipment()), voucherNumber: '2026/02/30-1', confirmation: checked([{ itemCode: 'SKU-001', quantity: 25 }]) })).toThrow();
});
test('one company/document cannot confirm a second WMS order, including whitespace or date separator variants', async () => {
    const h = fixture(); h.otherReferences.push({ order_id: 99, company_code: '001234', voucher_number: '2026/10/15-7', confirmation_kind: 'manual-line-check' });
    const body = { ...inputFor(h.data), voucherNumber: '2026-10-15 -0007', confirmation: checked([{ itemCode: 'SKU-001', quantity: 25 }]) };
    await expect(h.service.save(7, body, { id: 3 })).rejects.toMatchObject({ code: 'ECOUNT_REFERENCE_DOCUMENT_CONFLICT' });
    expect(h.reference).toBeNull(); expect(h.history).toHaveLength(0);
    expect((await h.service.save(7, { ...body, confirmation: null }, { id: 3 })).status).toBe('reference_only');
});
test('ordinary item cannot be complete when packed and picked counters contradict; SN counters keep legacy meaning', () => {
    const data = shipment(); data.items[0].picked_quantity = 24;
    expect(buildEcountManifest(data).ready).toBe(false);
    data.items[0].quantity = 1; data.items[0].picked_quantity = 0; data.items[0].packed_quantity = 0;
    data.allocations = []; data.instances = [{ id: 1, order_item_id: 11, serial_number: '00SN', status: 'packed' }];
    expect(buildEcountManifest(data).ready).toBe(true);
});
test('stored evidence retains the actual shipment revision after later order or box changes', async () => {
    const h = fixture(), body = { ...inputFor(h.data), confirmation: checked([{ itemCode: 'SKU-001', quantity: 25 }]) };
    await h.service.save(7, body, { id: 3 });
    h.data.allocations[0].carton_id = 'N99'; h.data.items[0].quantity = 99;
    expect(h.history[0].evidence.shipmentSnapshot.rows[0].cartonId).toBe('N1');
    expect(h.history[0].evidence.shipmentSnapshot.totals[0].quantity).toBe(25);
    expect(h.reference.confirmation_evidence.shipmentSnapshot.fingerprint).toBe(body.expectedFingerprint);
    expect(h.reference.confirmation_evidence.lines).toEqual([{ itemCode: 'SKU-001', quantity: 25, actualSN: [] }]);
    const result = await h.service.get(7, { id: 3 });
    expect(result.history[0].evidenceFingerprint).toBe(body.expectedFingerprint);
    expect(result.history[0]).not.toHaveProperty('evidence');
    const readQueries = h.client.query.mock.calls.filter(([sql]) => /^SELECT/.test(sql) && /FROM wms_ecount_(?:reference_history|order_references) WHERE/.test(sql));
    for (const [sql] of readQueries) expect(sql.split(' FROM ')[0]).not.toMatch(/evidence|SELECT \*/);
});
test('reference-only canonical aliases cannot clear a checked document, its revision, evidence or reservation', async () => {
    const h = fixture(), original = { ...inputFor(h.data), confirmation: checked([{ itemCode: 'SKU-001', quantity: 25 }]) };
    await h.service.save(7, original, { id: 3 });
    const snapshot = copy({ reference: h.reference, history: h.history, logs: h.logs });
    for (const [index, voucherNumber] of ['2026-10-15-0007', '2026/10/15 -07'].entries()) {
        if (index) h.data.allocations[0].carton_id = 'N99';
        const body = { ...inputFor(h.data), commandId: `00000000-0000-4000-8000-00000000000${index + 2}`, expectedRevision: 1, voucherNumber };
        const result = await h.service.save(7, body, { id: 3 });
        expect(result).toMatchObject({ unchanged: true, replayed: false, status: index ? 'changed' : 'manual_checked' });
        expect({ reference: h.reference, history: h.history, logs: h.logs }).toEqual(snapshot);
        expect(h.commands.at(-1).reference_revision).toBe(1);
        const count = h.commands.length;
        expect(await h.service.save(7, body, { id: 3 })).toMatchObject({ unchanged: true, replayed: true, status: index ? 'changed' : 'manual_checked' });
        expect(h.commands).toHaveLength(count);
    }
    const another = fixture(); another.data.order.id = 8; another.otherReferences.push(copy(h.reference));
    await expect(another.service.save(8, { ...inputFor(another.data), confirmation: checked([{ itemCode: 'SKU-001', quantity: 25 }]) }, { id: 3 }))
        .rejects.toMatchObject({ code: 'ECOUNT_REFERENCE_DOCUMENT_CONFLICT' });
    expect(another.reference).toBeNull();
});
test('same reference-only document cannot refresh a changed manifest or bypass existing optimistic guards', async () => {
    const h = fixture(); await h.service.save(7, inputFor(h.data), { id: 3 });
    const originalReference = copy(h.reference); h.data.allocations[0].carton_id = 'N99';
    const body = { ...inputFor(h.data), commandId: '00000000-0000-4000-8000-000000000002', expectedRevision: 1 };
    for (const patch of [{ expectedRevision: 0 }, { expectedFingerprint: originalReference.manifest_fingerprint }, { expectedActorId: 4 }]) {
        await expect(h.service.save(7, { ...body, ...patch }, { id: 3 })).rejects.toBeTruthy();
    }
    expect(await h.service.save(7, body, { id: 3 })).toMatchObject({ unchanged: true, status: 'changed' });
    expect(h.reference).toEqual(originalReference); expect(h.history).toHaveLength(1); expect(h.logs).toHaveLength(1);
});
