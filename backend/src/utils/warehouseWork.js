const { isWarehouseAdmin } = require('./managementScope');
const stages = ['pick', 'pack'];
const failure = (status, message) => Object.assign(new Error(message), { status });

function workTypes(user) {
    const defaultAllowed = ['picker', 'packer', 'admin', 'superadmin'].includes(user?.role);
    return stages.filter(stage => {
        const override = user?.[stage === 'pick' ? 'can_pick' : 'can_pack'];
        if (typeof override === 'boolean') return override;
        if (Array.isArray(user?.work_types)) return user.work_types.includes(stage);
        return defaultAllowed;
    });
}
function parseWorkOverrides(body) {
    const result = {};
    for (const key of ['can_pick','can_pack']) {
        if (body[key] === undefined) continue;
        if (body[key] !== null && typeof body[key] !== 'boolean') throw failure(400, '作業權限必須為開啟、關閉或預設');
        result[key] = body[key];
    }
    return result;
}
function staffUser(user) {
    const { id, username, name, role, management_scope = 'all', can_pick = null, can_pack = null } = user;
    return { id, username, name, role, management_scope, can_pick, can_pack, work_types: workTypes(user) };
}
function actorSnapshot(user) {
    return { id: user.id, username: user.username || null, name: user.name || user.username || null,
        role: user.role, management_scope: user.management_scope || 'all' };
}
function assertStage(stage) {
    if (!stages.includes(stage)) throw failure(400, '請選擇揀貨或裝箱');
    return stage;
}
function assertWork(user, stage) {
    assertStage(stage);
    if (!workTypes(user).includes(stage)) throw failure(403, stage === 'pick' ? '沒有揀貨作業權限' : '沒有裝箱作業權限');
}
function requireWarehouseWorker(req, res, next) {
    if (!workTypes(req.user).length) return res.status(403).json({ message: '沒有倉儲作業權限' });
    next();
}
function ownerId(order, stage) { return order[stage === 'pick' ? 'picker_id' : 'packer_id']; }
function pauseField(stage) { assertStage(stage); return stage === 'pick' ? 'pick_paused_at' : 'pack_paused_at'; }
function phaseStatus(stage) { return stage === 'pick' ? 'picking' : 'packing'; }
function isAdmin(user) { return ['admin', 'superadmin'].includes(user?.role); }
function assertScanWork(user, order, stage) {
    assertWork(user, stage);
    if (order.status !== phaseStatus(stage)) throw failure(409, stage === 'pick' ? '請先認領揀貨任務，並確認訂單仍在揀貨中' : '請先認領裝箱任務，再進行装箱核對');
    if (order[pauseField(stage)]) throw failure(409, '此作業已暫停，請先繼續作業');
    if (Number(ownerId(order, stage)) !== Number(user.id) && !isAdmin(user)) throw failure(403, '您不是此任務的指定操作員，請先完成交接');
    return Number(ownerId(order, stage)) === Number(user.id) ? 'owner' : 'assistance';
}
function assertPauseWork(user, order, stage) {
    assertWork(user, stage);
    if (order.status !== phaseStatus(stage)) throw failure(409, '僅能暫停或繼續進行中的同階段作業');
    if (Number(ownerId(order, stage)) !== Number(user.id) && !isWarehouseAdmin(user)) throw failure(403, '僅作業負責人或倉儲主管可以暫停或繼續作業');
}
function taipeiWorkDate(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function defaultStage(user, assignment) {
    const allowed = workTypes(user);
    if (allowed.includes(assignment)) return assignment;
    const previous = user.role === 'packer' ? 'pack' : 'pick';
    return allowed.includes(previous) ? previous : allowed[0] || null;
}
module.exports = { parseWorkOverrides, workTypes, staffUser, actorSnapshot, assertStage, assertWork, requireWarehouseWorker,
    ownerId, pauseField, phaseStatus, isAdmin, assertScanWork, assertPauseWork, taipeiWorkDate, defaultStage, failure };
