const { workTypes, staffUser, actorSnapshot, assertScanWork, assertPauseWork, assertWork,
    taipeiWorkDate, defaultStage, parseWorkOverrides } = require('../utils/warehouseWork');
const { stateToken } = require('../services/scanSnapshot');
const { parseTaskPage } = require('../utils/taskPagination');

const worker = { id: 1, username: 'fixture', name: '測試人員', role: 'picker', management_scope: 'all' };
const order = { id: 5, status: 'picking', picker_id: 1, packer_id: null };

test.each(['picker','packer','admin','superadmin'])('legacy %s keeps its identity and can perform both stages without updating a user row', role => {
    const original = { ...worker, role }, user = staffUser(original);
    expect(user.work_types).toEqual(['pick','pack']);
    expect(original).toEqual({ ...worker, role });
    expect(user.id).toBe(1);
    expect(user.role).toBe(role);
});
test('dispatcher remains read/import-only unless an explicit work capability is granted', () => {
    expect(workTypes({ ...worker, role: 'dispatcher' })).toEqual([]);
    expect(workTypes({ ...worker, role: 'dispatcher', can_pack: true })).toEqual(['pack']);
});
test('explicit false capability cannot be overridden by a UI work_types list or an administrator role', () => {
    const user = { ...worker, role: 'superadmin', can_pick: false, can_pack: true, work_types: ['pick','pack'] };
    expect(workTypes(user)).toEqual(['pack']);
    expect(() => assertWork(user, 'pick')).toThrow('沒有揀貨');
});
test('order administration scope stays separate from actual scan stage permissions', () => {
    const manager = { ...worker, role: 'admin', management_scope: 'orders' };
    expect(assertScanWork(manager, { ...order, picker_id: 2 }, 'pick')).toBe('assistance');
    expect(actorSnapshot(manager)).toMatchObject({ role: 'admin', management_scope: 'orders' });
    expect(() => assertPauseWork(manager, { ...order, picker_id: 2 }, 'pick')).toThrow('僅作業負責人');
});
test('scan belongs to the locked order stage, not a selected mode or another tab', () => {
    expect(assertScanWork(worker, order, 'pick')).toBe('owner');
    expect(() => assertScanWork(worker, order, 'pack')).toThrow('先認領裝箱');
    expect(() => assertScanWork(worker, { ...order, status: 'picked' }, 'pack')).toThrow('先認領裝箱');
    expect(() => assertScanWork(worker, { ...order, picker_id: 2 }, 'pick')).toThrow('交接');
    expect(() => assertScanWork(worker, { ...order, pick_paused_at: new Date() }, 'pick')).toThrow('已暫停');
});
test('warehouse supervisor can pause another worker while a regular worker cannot', () => {
    expect(() => assertPauseWork({ ...worker, role: 'admin', management_scope: 'warehouse' }, { ...order, picker_id: 2 }, 'pick')).not.toThrow();
    expect(() => assertPauseWork(worker, { ...order, picker_id: 2 }, 'pick')).toThrow('僅作業負責人');
});
test('daily mode and assignment use the Taiwan calendar day and only permitted defaults', () => {
    expect(taipeiWorkDate(new Date('2026-10-13T16:01:00Z'))).toBe('2026-10-14');
    expect(defaultStage(worker, 'pack')).toBe('pack');
    expect(defaultStage({ ...worker, can_pack: false }, 'pack')).toBe('pick');
    expect(defaultStage({ ...worker, can_pick: false, can_pack: false }, 'pick')).toBeNull();
});
test('pause changes invalidate scan state, null additive columns preserve existing state tokens', () => {
    const initial = stateToken(order, [], []);
    expect(stateToken({ ...order, pick_paused_at: null, pack_paused_at: null }, [], [])).toBe(initial);
    expect(stateToken({ ...order, pick_paused_at: '2026-10-13T01:00:00Z' }, [], [])).not.toBe(initial);
});
test('task cursor scopes stage and capability while completed history ignores current stage', () => {
    const pick = parseTaskPage(worker, { stage: 'pick' }, 'active');
    const pack = parseTaskPage(worker, { stage: 'pack' }, 'active');
    expect(pick.scope).not.toBe(pack.scope);
    expect(parseTaskPage({ ...worker, can_pack: false }, { stage: 'pick' }, 'active').scope).not.toBe(pick.scope);
    expect(parseTaskPage(worker, { stage: 'pick' }, 'completed').stage).toBe('');
    expect(() => parseTaskPage(worker, { stage: 'invalid' }, 'active')).toThrow('作業階段');
});
test('capability updates accept booleans/null and never accept text as authorization', () => {
    expect(parseWorkOverrides({ can_pick: false, can_pack: null })).toEqual({ can_pick: false, can_pack: null });
    expect(parseWorkOverrides({ role: 'admin' })).toEqual({});
    expect(() => parseWorkOverrides({ can_pick: 'true' })).toThrow('作業權限');
});
