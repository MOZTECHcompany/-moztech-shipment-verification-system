const { performance } = require('node:perf_hooks');
function requestPerformance(pool) {
    let count = 0;
    return (req, res, next) => {
        const start = performance.now();
        req.performanceStartedAt = start;
        res.once('finish', () => {
            if (!req.path.startsWith('/api/')) return;
            const ms = Math.round(performance.now() - start);
            if (ms < 1000 && ++count % 100 !== 0) return;
            // Never include URLs with query strings, request bodies, users or SNs.
            const metric = { event: 'wms_request_perf', route: req.route?.path || req.path.replace(/\/[0-9]+(?=\/|$)/g, '/:id'), method: req.method,
                requestId: req.requestId, status: res.statusCode, durationMs: ms, poolWaiting: pool.waitingCount,
                poolTotal: pool.totalCount, rssBytes: process.memoryUsage().rss };
            console.info(JSON.stringify(metric));
        });
        next();
    };
}
module.exports = { requestPerformance };
