export const WORK_STAGES = ['pick', 'pack'];
export const workStageLabel = stage => stage === 'pick' ? '揀貨' : stage === 'pack' ? '裝箱' : '未選擇';

export function workTypesFor(user) {
    if (Array.isArray(user?.work_types)) return WORK_STAGES.filter(stage => user.work_types.includes(stage));
    // Older snapshots and fixtures keep their original single-stage behavior.
    if (user?.role === 'picker') return ['pick'];
    if (user?.role === 'packer') return ['pack'];
    if (user?.role === 'superadmin' || (user?.role === 'admin' && user.management_scope !== 'orders')) return [...WORK_STAGES];
    return [];
}
export const canWork = (user, stage) => workTypesFor(user).includes(stage);
export const workTypesForUser = workTypesFor;

export function taiwanWorkDate(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}
export const workModeStorageKey = (userId, date) => `corely:wms:work-mode:v1:${userId}:${date}`;
export const orderWorkUrl = (orderId, stage) => `/order/${orderId}${WORK_STAGES.includes(stage) ? `?stage=${stage}` : ''}`;
