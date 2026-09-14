const { stateToken } = require('../services/scanSnapshot');
const { normalizeSourceIdentity } = require('../services/orderSourceIdentity');
const { validateOrderChangeProposal } = require('../services/orderChangeService');

test('source identity normalizes missing fields but never truncates identifiers or accepts metadata without an order', () => {
    expect(normalizeSourceIdentity({ sourceOrderNumber: ' 000001 ', sourcePlatform: 'Shopify' })).toEqual({ sourceOrderNumber: '000001', sourcePlatform: 'Shopify', sourceStore: null, sourceLineId: null });
    expect(() => normalizeSourceIdentity({ sourceOrderNumber: 'x'.repeat(256) })).toThrow();
    expect(() => normalizeSourceIdentity({ sourceOrderNumber: 'ORDER\nOTHER' })).toThrow();
    expect(() => normalizeSourceIdentity({ sourceStore: 'Store' })).toThrow();
});

test.each(['source_order_number', 'source_platform', 'source_store', 'source_line_id'])('a change to %s invalidates a previously loaded scan snapshot', field => {
    const item = { id: 1, order_id: 2, barcode: 'BAR', quantity: 1, source_order_number: 'ORDER', source_platform: 'Shopify', source_store: 'Store', source_line_id: 'Line' };
    const order = { id: 2, status: 'picking' };
    expect(stateToken(order, [{ ...item, [field]: 'Changed' }], [])).not.toBe(stateToken(order, [item], []));
});

test('approval proposals retain exact item identity and source fields instead of collapsing them by barcode', () => {
    const result = validateOrderChangeProposal({ note: 'Synthetic change', items: [{ orderItemId: 12, barcode: 'BAR', productName: 'Item', quantityChange: 1, noSn: true,
        sourceOrderNumber: 'ORDER', sourcePlatform: 'Shopify', sourceStore: 'Store', sourceLineId: 'Line' }] });
    expect(result.ok).toBe(true);
    expect(result.value.items[0]).toMatchObject({ orderItemId: 12, sourceOrderNumber: 'ORDER', sourcePlatform: 'Shopify', sourceStore: 'Store', sourceLineId: 'Line' });
    expect(validateOrderChangeProposal({ note: 'Synthetic change', items: [{ orderItemId: -1, barcode: 'BAR', productName: 'Item', quantityChange: 1, noSn: true }] }).ok).toBe(false);
});
