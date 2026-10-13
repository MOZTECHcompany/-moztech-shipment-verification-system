export const validWorkStage = value => value === 'pick' || value === 'pack';
export const stageForOrder = status => ['pending', 'picking'].includes(status) ? 'pick' : 'pack';
export const stageStatus = stage => stage === 'pick' ? 'picking' : 'packing';
export const stageOwner = (order, stage) => stage === 'pick' ? order?.picker_id : order?.packer_id;
export const stagePaused = (order, stage) => Boolean(stage === 'pick' ? order?.pick_paused_at : order?.pack_paused_at);
export function stageCanScan(order, stage, user, permitted) {
    return Boolean(permitted && order?.status === stageStatus(stage) && !stagePaused(order, stage)
        && (Number(stageOwner(order, stage)) === Number(user?.id) || ['admin', 'superadmin'].includes(user?.role)));
}

export function workActorLabel(log) {
    const snapshot = log.actor_snapshot;
    const role = snapshot?.role || log.user_role;
    const scope = snapshot?.management_scope;
    const labels = {picker:'作業人員',packer:'作業人員',dispatcher:'拋單員',superadmin:'系統管理員',admin:'管理員'};
    return role === 'admin' && scope === 'orders' ? '訂單管理員'
        : role === 'admin' && scope === 'warehouse' ? '倉儲管理員' : labels[role] || role || '歷史身分未記錄';
}
export const workTypeLabel = type => type === 'pick' ? '揀貨' : type === 'pack' ? '裝箱' : '';
