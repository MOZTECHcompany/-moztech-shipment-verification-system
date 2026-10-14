// Carton/spec maintenance is separate from warehouse review authority.
// Always call with the current DB account, never client-supplied role claims.
const denied = message => Object.assign(new Error(message), { code: 'CARTON_FORBIDDEN', status: 403 });
function isCartonManager(user) { return ['admin', 'superadmin'].includes(user?.role); }
function assertCartonManager(user) {
    if (!isCartonManager(user)) throw denied('箱號／箱規管理需管理員權限');
}
function assertAllocationManager(user) {
    if (!(user?.role === 'superadmin' || (user?.role === 'admin' && user.management_scope !== 'orders'))) {
        throw denied('退回箱分配需倉儲管理員權限');
    }
}
module.exports = { isCartonManager, assertCartonManager, assertAllocationManager };
