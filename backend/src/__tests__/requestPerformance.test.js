const express = require('express');
const request = require('supertest');
const { requestPerformance } = require('../middleware/requestPerformance');

test('sampled metrics survive nested Express mounts without recording query or record IDs', async () => {
    const log = jest.spyOn(console, 'info').mockImplementation(() => {});
    try {
        const app = express();
        app.use(requestPerformance({ waitingCount: 0, totalCount: 2 }));
        const router = express.Router();
        router.get('/orders/:id', (req, res) => res.json({ ok: true }));
        app.use('/api', router);
        for (let i = 0; i < 100; i++) await request(app).get('/api/orders/12345?customer=DO_NOT_LOG').expect(200);
        expect(log).toHaveBeenCalledTimes(1);
        const metric = JSON.parse(log.mock.calls[0][0]);
        expect(metric).toMatchObject({ event: 'wms_request_perf', route: '/orders/:id', status: 200, poolTotal: 2 });
        expect(JSON.stringify(metric)).not.toMatch(/12345|DO_NOT_LOG|customer/);
    } finally { log.mockRestore(); }
});
