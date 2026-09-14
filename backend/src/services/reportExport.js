const Papa = require('papaparse');
const { dateRange } = require('../utils/queryLimits');
const formatter = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
const time = date => date ? formatter.format(new Date(date)) : '';
const fields = ['訂單編號', '訂單狀態', '出貨總件數', '揀貨人員', '裝箱人員', '出貨完成時間', '作廢人員', '作廢時間'];

const reportSQL = `SELECT o.id, o.voucher_number, o.status, o.completed_at, o.updated_at,
    COALESCE((SELECT SUM(quantity) FROM order_items WHERE order_id=o.id),0) AS total_quantity,
    activity.pickers, activity.packers, activity.void_user, activity.void_at
FROM orders o
LEFT JOIN LATERAL (
    SELECT string_agg(DISTINCT u.name, ', ' ORDER BY u.name) FILTER (WHERE ol.action_type='pick') AS pickers,
        string_agg(DISTINCT u.name, ', ' ORDER BY u.name) FILTER (WHERE ol.action_type='pack') AS packers,
        (array_agg(u.name ORDER BY ol.created_at,ol.id) FILTER (WHERE ol.action_type='void'))[1] AS void_user,
        (array_agg(ol.created_at ORDER BY ol.created_at,ol.id) FILTER (WHERE ol.action_type='void'))[1] AS void_at
    FROM operation_logs ol JOIN users u ON u.id=ol.user_id
    WHERE ol.order_id=o.id AND ol.action_type IN ('pick','pack','void')
) activity ON TRUE
WHERE (o.status='completed' AND o.completed_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Taipei')
    AND o.completed_at < (($2::date+1)::timestamp AT TIME ZONE 'Asia/Taipei'))
 OR (o.status='voided' AND o.updated_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Taipei')
    AND o.updated_at < (($2::date+1)::timestamp AT TIME ZONE 'Asia/Taipei'))
ORDER BY o.updated_at DESC, o.completed_at DESC, o.id DESC`;

function rowValues(o) {
    return [o.voucher_number, o.status === 'completed' ? '已完成' : '已作廢', o.total_quantity,
        o.pickers || '無紀錄', o.packers || '無紀錄', o.status === 'completed' ? time(o.completed_at) : '',
        o.void_user || '', o.status === 'voided' ? time(o.void_at) : ''];
}
function write(res, chunk) {
    if (res.destroyed) return Promise.reject(new Error('EXPORT_DISCONNECTED'));
    if (res.write(chunk)) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const cleanup = () => { res.off('drain', drained); res.off('close', closed); res.off('error', failed); };
        const drained = () => { cleanup(); resolve(); };
        const closed = () => { cleanup(); reject(new Error('EXPORT_DISCONNECTED')); };
        const failed = error => { cleanup(); reject(error); };
        res.once('drain', drained); res.once('close', closed); res.once('error', failed);
    });
}

function createReportExporter(reportPool) {
    let exporting = false;
    return async (req, res, next) => {
        let range;
        try { range = dateRange(req.query.startDate, req.query.endDate, true); }
        catch (error) { return res.status(400).json({ message: error.message }); }
        const busy = () => res.set('Retry-After', '3').status(429).json({ code: 'REPORT_BUSY', message: '已有報表產生中，請稍後再下載。' });
        if (exporting) return busy();
        exporting = true;
        let client, open = false, releaseError, aborted = false;
        const close = () => { if (!res.writableEnded) aborted = true; };
        res.on('close', close);
        const deadline = Date.now() + 120000;
        try {
            client = await reportPool.connect();
            await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); open = true;
            await client.query("SET LOCAL statement_timeout='8000ms'");
            // Covers overlapping revisions as well as requests in this process.
            const lock = await client.query("SELECT pg_try_advisory_xact_lock(hashtext('wms-report-export'),hashtext(current_database())) AS acquired");
            if (!lock.rows[0].acquired) { await client.query('ROLLBACK'); open = false; return busy(); }
            await client.query('DECLARE wms_report_cursor NO SCROLL CURSOR FOR ' + reportSQL, [range.start, range.end]);
            let page = await client.query('FETCH FORWARD 200 FROM wms_report_cursor');
            if (!page.rowCount) { await client.query('ROLLBACK'); open = false; return res.status(404).json({ message: '此日期範圍沒有已完成或作廢的訂單。' }); }
            if (aborted) return;
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Cache-Control', 'private, no-store');
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(`營運報告_${range.start}_至_${range.end}.csv`)}"`);
            await write(res, '\uFEFF' + Papa.unparse([fields]) + '\r\n');
            while (page.rowCount) {
                if (aborted || Date.now() > deadline) throw new Error('EXPORT_STOPPED');
                await write(res, Papa.unparse(page.rows.map(rowValues)) + '\r\n');
                // Yield between bounded chunks; never format every scan log in JS.
                await new Promise(resolve => setImmediate(resolve));
                page = await client.query('FETCH FORWARD 200 FROM wms_report_cursor');
            }
            await client.query('COMMIT'); open = false;
            res.end();
        } catch (error) {
            // Destroy a partial CSV rather than marking a truncated report successful.
            if (res.headersSent || aborted) res.destroy();
            else if (error.code === '57014' || /timeout/i.test(error.message)) res.status(503).json({ code: 'REPORT_TIMEOUT', message: '報表處理逾時，請縮小日期範圍後重試。' });
            else next(error);
        } finally {
            if (open) try { await client.query('ROLLBACK'); } catch (error) { releaseError = error; }
            client?.release(releaseError);
            res.off('close', close); exporting = false;
        }
    };
}
module.exports = { createReportExporter, reportSQL, rowValues };
