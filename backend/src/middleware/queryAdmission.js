// Leave a transaction slot available to warehouse commands. Bound both the
// number and duration of queued, expensive read requests (not scan commands).
function createQueryAdmission({ maxQueued = 16, waitMs = 1500 } = {}) {
    let active = false;
    const waiting = [];
    const busy = res => { if (!res.destroyed) res.set('Retry-After', '1').status(503).json({ code: 'QUERY_BUSY', message: '查詢忙碌中，請稍後重新整理。' }); };
    function admit(entry) {
        active = true;
        clearTimeout(entry.timer);
        if (entry.cancel) entry.res.off('close', entry.cancel);
        let released = false;
        const originalEnd = entry.res.end;
        const release = () => {
            if (released) return; released = true;
            entry.res.off('finish', release);
            entry.res.end = originalEnd;
            active = false;
            while (waiting.length) {
                const next = waiting.shift();
                if (!next.res.destroyed) { admit(next); break; }
            }
        };
        // A disconnected client does not cancel its SQL. Keep the slot until
        // the handler actually completes, even if the response cannot be sent.
        entry.res.end = function (...args) { try { return originalEnd.apply(this, args); } finally { release(); } };
        entry.res.once('finish', release);
        entry.next();
    }
    return (req, res, next) => {
        if (req.method !== 'GET' || !/^\/api\/(tasks(?:\/completed)?|analytics|operation-logs(?:\/stats)?|scan-errors)$/.test(req.path)) return next();
        const entry = { res, next };
        if (!active) return admit(entry);
        if (waiting.length >= maxQueued) return busy(res);
        entry.cancel = () => { clearTimeout(entry.timer); const i = waiting.indexOf(entry); if (i >= 0) waiting.splice(i, 1); res.off('close', entry.cancel); };
        entry.timer = setTimeout(() => { entry.cancel(); busy(res); }, waitMs);
        res.once('close', entry.cancel); waiting.push(entry);
    };
}
module.exports = { createQueryAdmission };
