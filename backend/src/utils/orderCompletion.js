// A tracked item is verified by its SN instances; quantity counters belong only
// to untracked items. Missing or excess SNs require the order data to be reviewed.
function getOrderCompletion(items, instances) {
    const statsByItemId = new Map();
    for (const instance of instances) {
        const key = String(instance.order_item_id);
        const stats = statsByItemId.get(key) || { total: 0, picked: 0, packed: 0 };
        stats.total++;
        if (instance.status === 'picked' || instance.status === 'packed') stats.picked++;
        if (instance.status === 'packed') stats.packed++;
        statsByItemId.set(key, stats);
    }

    let hasRequiredItems = false;
    let allPicked = true;
    let allPacked = true;
    for (const item of items) {
        const quantity = Number(item.quantity ?? 0);
        if (!Number.isInteger(quantity) || quantity < 0) {
            allPicked = allPacked = false;
            continue;
        }
        if (quantity > 0) hasRequiredItems = true;
        const stats = statsByItemId.get(String(item.id));
        if (stats) {
            const completeSerialList = stats.total === quantity;
            if (!completeSerialList || stats.picked !== quantity) allPicked = false;
            if (!completeSerialList || stats.packed !== quantity) allPacked = false;
        } else {
            const picked = Number(item.picked_quantity ?? 0);
            const packed = Number(item.packed_quantity ?? 0);
            const pickedComplete = Number.isFinite(picked) && picked >= quantity;
            if (!pickedComplete) allPicked = false;
            if (!pickedComplete || !Number.isFinite(packed) || packed < quantity) allPacked = false;
        }
    }
    return {
        allPicked: hasRequiredItems && allPicked,
        allPacked: hasRequiredItems && allPicked && allPacked
    };
}

function canAutoComplete(status) {
    return ['pending', 'picking', 'picked', 'packing'].includes(status);
}

module.exports = { getOrderCompletion, canAutoComplete };
