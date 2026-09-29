const { randomBytes } = require('node:crypto');
const { sourceIdentityValues } = require('./orderSourceIdentity');

const createWorkBarcode = () => `WT${randomBytes(9).toString('hex').toUpperCase()}`;

function groupSourceWorkOrders(parsed) {
    const groups = new Map();
    for (const item of parsed.items) {
        const key = JSON.stringify(sourceIdentityValues(item).slice(0, 3));
        if (!groups.has(key)) groups.set(key, {
            sourceOrderNumber: item.sourceOrderNumber, sourcePlatform: item.sourcePlatform,
            sourceStore: item.sourceStore, customerName: null, items: [], totalQuantity: 0, serialCount: 0
        });
        const group = groups.get(key);
        if (item.customerName) {
            if (group.customerName && group.customerName !== item.customerName) {
                throw Object.assign(new Error(`第 ${item.sourceRow} 列：同一商城訂單的客戶名稱不一致，請核對平台、店鋪與訂單編號`), { status: 400, code: 'IMPORT_NOT_APPLIED' });
            }
            group.customerName = item.customerName;
        }
        group.items.push(item);
        group.totalQuantity += item.quantity;
        group.serialCount += item.serials.length;
    }
    return [...groups.values()];
}

module.exports = { createWorkBarcode, groupSourceWorkOrders };
