const { validateOrderChangeProposal, applyOrderChangeProposal } = require('../services/orderChangeService');

function makeFakeClient(script) {
  const calls = [];
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text: String(text), params });
      for (const step of script) {
        if (typeof step.match === 'function' ? step.match(text, params) : String(text).includes(step.match)) {
          return typeof step.result === 'function' ? step.result(text, params) : step.result;
        }
      }
      throw new Error(`Unexpected query: ${text}`);
    }
  };
}

describe('orderChangeService - untracked SN quantity decrease', () => {
  test('validate allows removedSnList <= removeCount', () => {
    const r = validateOrderChangeProposal({
      note: 'test',
      items: [
        {
          barcode: '4711',
          productName: 'P',
          quantityChange: -4,
          noSn: false,
          removedSnList: ['A', 'B']
        }
      ]
    });
    expect(r.ok).toBe(true);
  });

  test('apply decreases untracked qty without deleting instances', async () => {
    const orderId = 1;
    const proposal = {
      note: 'remove untracked',
      items: [
        {
          barcode: '4711299273087',
          productName: 'X',
          quantityChange: -4,
          noSn: false,
          removedSnList: []
        }
      ]
    };

    // existingTotalQty=11, instances=7 (all picked), so untrackedQty=4; removeCount=0
    const existingItems = [
      { id: 10, order_id: orderId, barcode: '4711299273087', quantity: 11, product_name: 'X', picked_quantity: 0, packed_quantity: 0 }
    ];
    const existingInstances = Array.from({ length: 7 }).map((_, i) => ({
      id: 100 + i,
      order_item_id: 10,
      serial_number: `SN${i + 1}`,
      status: 'picked'
    }));

    const script = [
      {
        match: 'SELECT * FROM orders WHERE id = $1 FOR UPDATE',
        result: { rowCount: 1, rows: [{ id: orderId, status: 'picking' }] }
      },
      {
        match: 'FROM order_items\n         WHERE order_id = $1 AND barcode = $2',
        result: { rowCount: existingItems.length, rows: existingItems }
      },
      {
        match: 'FROM order_item_instances',
        result: { rowCount: existingInstances.length, rows: existingInstances }
      },
      {
        match: 'UPDATE order_items SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        result: { rowCount: 1, rows: [] }
      },
      {
        match: 'DELETE FROM order_items oi',
        result: { rowCount: 0, rows: [] }
      },
      {
        match: 'UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        result: { rowCount: 1, rows: [] }
      }
    ];

    const client = makeFakeClient(script);
    const result = await applyOrderChangeProposal({ client, orderId, proposal, actorUserId: 99 });

    expect(result.newStatus).toBe('picking');

    const deleteInstancesCalls = client.calls.filter((c) => c.text.includes('DELETE FROM order_item_instances'));
    expect(deleteInstancesCalls.length).toBe(0);
  });
});
