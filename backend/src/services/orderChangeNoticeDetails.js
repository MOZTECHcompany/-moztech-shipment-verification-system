const statusLabels = {pending:'待揀貨',picking:'揀貨中',picked:'待裝箱',packing:'裝箱中',completed:'已完成',voided:'已作廢'};
const actionLabels = {short_ship:'短出',restock:'補貨',exchange:'換貨',void:'作廢',other:'其他'};
const typeLabels = {stockout:'缺貨',damage:'破損',over_scan:'多掃',under_scan:'少掃',sn_replace:'SN 更換',order_change:'訂單異動',other:'其他例外'};

// Persist the event-time evidence. Never reconstruct an old notice from today's
// order quantities, which may already include this change or later changes.
function orderChangeNoticeDetails({exception,phase,deletion=false,previousStatus,previousProposal}) {
    const snapshot=exception?.snapshot || {}, proposal=snapshot.proposal || {};
    const applied=snapshot.applyResult?.changesApplied;
    const heading=phase==='requested'?'申請內容（待審核）':phase==='rejected'?'申請內容（已駁回）':
        exception?.type==='order_change'&&applied?'已套用的異動':phase==='sn_replaced'||phase==='voided'?'已完成的異動':'處理內容';
    const lines=[];
    if(deletion||phase==='voided') {
        const before=snapshot.previousStatus || previousStatus;
        lines.push(`${before ? (statusLabels[before] || before)+' → ' : ''}已作廢${phase==='requested'?'（核准後生效）':phase==='rejected'?'（未執行）':''}`);
    } else if(exception?.type==='order_change') {
        const totals=new Map();
        const itemBaselines=new Map();
        for(const item of snapshot.baselineItems || []) {
            totals.set(item.barcode,(totals.get(item.barcode)||0)+Number(item.quantity));
            if(Number.isSafeInteger(item.orderItemId))itemBaselines.set(item.orderItemId,{...item,quantity:Number(item.quantity)});
        }
        for(const [index,item] of (proposal.items || []).entries()) {
            const scoped=Number.isSafeInteger(item.orderItemId), baseline=scoped?itemBaselines.get(item.orderItemId):null;
            const result=applied?.[index]?.barcode===item.barcode&&(!scoped||applied[index].orderItemId===item.orderItemId) ? applied[index] : null;
            const before=result ? result.previousTotalQuantity : scoped?baseline?.quantity:totals.get(item.barcode);
            const after=result ? result.newTotalQuantity : Number.isFinite(before) ? before+Number(item.quantityChange) : undefined;
            // A captured baseline also proves a newly added barcode started at 0.
            const from=before ?? (!scoped&&Array.isArray(snapshot.baselineItems)?0:undefined);
            const to=after ?? (Number.isFinite(from)?from+Number(item.quantityChange):undefined);
            if(scoped){
                if(baseline)itemBaselines.set(item.orderItemId,{...baseline,quantity:to});
                if(totals.has(item.barcode))totals.set(item.barcode,totals.get(item.barcode)+Number(item.quantityChange));
            }else totals.set(item.barcode,to);
            lines.push(`${item.productName || item.barcode} · ${item.barcode} · ${Number.isFinite(from)&&Number.isFinite(to)?`${from} → ${to} 件`:`數量 ${Number(item.quantityChange)>0?'+':''}${item.quantityChange}`}`);
            const removed=result?.removedSerialNumbers ?? item.removedSnList ?? [];
            const added=result?.addedSerialNumbers ?? item.snList ?? [];
            if(removed.length)lines.push(`移除 SN：${removed.join('、')}`);
            if(added.length)lines.push(`新增 SN：${added.join('、')}`);
        }
    } else if(phase==='sn_replaced') {
        lines.push(`${snapshot.product?.name || ''} · ${snapshot.product?.barcode || ''}`);
        lines.push(`SN：${snapshot.oldSn} → ${snapshot.newSn}`);
    } else if(exception) {
        lines.push(`例外類型：${typeLabels[exception.type] || exception.type}`);
        const action=phase==='resolved'?exception.resolution_action:proposal.resolutionAction;
        if(action)lines.push(`處理方式：${previousProposal?.resolutionAction && previousProposal.resolutionAction!==action ? (actionLabels[previousProposal.resolutionAction] || previousProposal.resolutionAction)+' → ' : ''}${actionLabels[action] || action}`);
        const note=phase==='resolved'?exception.resolution_note:proposal.note;
        if(note)lines.push(`處理說明：${note}`);
        if(previousProposal?.note && previousProposal.note!==note)lines.push(`原處理說明：${previousProposal.note}`);
        if(proposal.newSn)lines.push(`擬更換 SN：${snapshot.oldSn ? snapshot.oldSn+' → ' : ''}${proposal.newSn}`);
        if(proposal.correctBarcode)lines.push(`擬更正條碼：${proposal.correctBarcode}`);
    }
    return {heading,lines};
}
module.exports={orderChangeNoticeDetails};
