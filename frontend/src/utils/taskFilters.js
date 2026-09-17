const normalize = (value) => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase();
const compact = (value) => normalize(value).replace(/[^\p{L}\p{N}]/gu, '');

// The list API supplies order numbers and customers, not product barcodes.
export function matchesTaskSearch(task, search) {
    const query = normalize(search);
    if (!query) return true;
    const fields = [task.voucher_number, task.customer_name].map(normalize);
    const compactQuery = compact(query);
    if (compactQuery && fields.some((field) => compact(field).includes(compactQuery))) return true;
    return query.split(/\s+/).every((term) => fields.some((field) =>
        field.includes(term) || (compact(term) && compact(field).includes(compact(term)))
    ));
}

export function filterTasks(tasks, { search = '', status = 'all', urgentOnly = false, group = 'all', user, view = 'active' } = {}) {
    return tasks.filter((task) =>
        matchesTaskSearch(task, search) &&
        (status === 'all' || task.status === status) &&
        (!urgentOnly || task.is_urgent) &&
        (group === 'all' ||
            (group === 'pick' && ['pending', 'picking'].includes(task.status)) ||
            (['pack', 'picked'].includes(group) && ['picked', 'packing'].includes(task.status)) ||
            (group === 'done' && task.status === 'completed') ||
            (group === 'inProgress' && ['picking', 'packing'].includes(task.status)) ||
            (group === 'mine' && (user?.role === 'dispatcher' ? Number(task.imported_by_user_id) === Number(user.id)
                : view === 'completed' ? true
                : user?.role === 'picker' ? task.status === 'picking' && Number(task.picker_id) === Number(user.id)
                : user?.role === 'packer' ? task.status === 'packing' && Number(task.packer_id) === Number(user.id) : false)))
    );
}

// /api/orders/batch-claim accepts picking work only.
export function canBatchPick(task) {
    return task.task_type === 'pick' &&
        (task.status === 'pending' || (task.status === 'picking' && !task.picker_id && !task.current_user));
}

export function batchStagesForRole(user) {
    if (['admin', 'superadmin'].includes(user?.role)) return ['pick', 'pack'];
    if (user?.role === 'picker') return ['pick'];
    if (user?.role === 'packer') return ['pack'];
    return [];
}

export function canBatchClaim(task, user, stage) {
    if (!batchStagesForRole(user).includes(stage)) return false;
    return stage === 'pick' ? canBatchPick(task)
        : task.task_type === 'pack' && task.status === 'picked';
}

export function isActiveTaskForRole(task, user) {
    if (['admin', 'superadmin', 'dispatcher'].includes(user?.role)) {
        return ['pending', 'picking', 'picked', 'packing'].includes(task.status);
    }
    if (user?.role === 'picker') {
        return task.status === 'pending' || (task.status === 'picking' &&
            (task.picker_id == null || Number(task.picker_id) === Number(user.id)));
    }
    if (user?.role === 'packer') {
        return task.status === 'picked' || (task.status === 'packing' &&
            (task.packer_id == null || Number(task.packer_id) === Number(user.id)));
    }
    return false;
}
