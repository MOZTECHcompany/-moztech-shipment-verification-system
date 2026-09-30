export const isDeletionRequest = row => row?.type === 'order_change' && row?.snapshot?.proposal?.action === 'delete_order';
export function changeQuantityRange(exception, index, currentItems = []) {
    const changes = exception?.snapshot?.proposal?.items || [];
    const change = changes[index];
    if (!change) return null;
    const applied = exception.snapshot?.applyResult?.changesApplied?.[index];
    if (applied?.barcode === change.barcode) return {before:applied.previousTotalQuantity,after:applied.newTotalQuantity};
    // Never apply an old delta to today's quantity when displaying history.
    if (exception.status !== 'open') return null;
    const baseline = exception.snapshot?.baselineItems || currentItems;
    let before = baseline.filter(item => item.barcode === change.barcode).reduce((n,item)=>n+Number(item.quantity || 0),0);
    for (const earlier of changes.slice(0,index)) if (earlier.barcode === change.barcode) before += Number(earlier.quantityChange);
    return {before,after:before+Number(change.quantityChange)};
}
