jest.mock('../services/scanSnapshot', () => ({ readLines: jest.fn() }));
const { readLines } = require('../services/scanSnapshot');
const { applyOrderChangeProposal } = require('../services/orderChangeService');
const proposal = { note: '核對異動', items: [{ barcode: '4711299273087', productName: '商品', quantityChange: 1, noSn: true }] };

test('an approved change keeps a batch order held until the separate prepick completion', async () => {
    readLines.mockResolvedValue({ items: [{ id: 11, quantity: 3, picked_quantity: 3, packed_quantity: 0 }], instances: [] });
    const client = { query: jest.fn(async sql => {
        if (sql === 'SELECT * FROM orders WHERE id = $1 FOR UPDATE') return { rowCount: 1, rows: [{ id: 1, status: 'pending', import_batch_id: 9, warehouse_hold: true }] };
        if (sql.includes('FROM order_items\n         WHERE order_id = $1 AND barcode = $2')) return { rows: [{ id: 11, quantity: 2, picked_quantity: 0, packed_quantity: 0 }] };
        if (sql.includes('FROM order_item_instances')) return { rows: [] };
        if (sql.startsWith('SELECT id FROM warehouse_import_batches') || sql.startsWith('UPDATE order_items') || sql.startsWith('UPDATE orders')) return { rows: [], rowCount: 1 };
        throw new Error(`Unexpected query: ${sql}`);
    }) };
    const result = await applyOrderChangeProposal({ client, orderId: 1, proposal, actorUserId: 2 });
    expect(result.newStatus).toBe('pending');
    expect(client.query).toHaveBeenCalledWith('SELECT id FROM warehouse_import_batches WHERE id=$1 FOR UPDATE', [9]);
    expect(client.query).toHaveBeenCalledWith('UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', ['pending', 1]);
});

test('a voided order still cannot be changed after merge', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: 1, status: 'voided' }] }) };
    await expect(applyOrderChangeProposal({ client, orderId: 1, proposal, actorUserId: 2 })).rejects.toMatchObject({ status: 409 });
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(readLines).not.toHaveBeenCalled();
});
