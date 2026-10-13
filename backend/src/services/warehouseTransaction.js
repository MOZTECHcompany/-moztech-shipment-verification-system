const { deferredEvents } = require('../utils/transactionEvents');
// One client owns mutations, durable audit and response preparation. Never retry an uncertain COMMIT.
async function warehouseTransaction(pool, io, work) {
    let db, open = false, commitAttempted = false, releaseError;
    const events = deferredEvents(io);
    try {
        db = await pool.connect();
        await db.query('BEGIN'); open = true;
        await db.query("SET LOCAL lock_timeout='1500ms'");
        await db.query("SET LOCAL statement_timeout='8000ms'");
        const result = await work(db, events);
        commitAttempted = true;
        await db.query('COMMIT'); open = false;
        events.publish();
        return result;
    } catch (error) {
        if (open) try { await db.query('ROLLBACK'); } catch (cleanupError) { releaseError = cleanupError; }
        if (commitAttempted || releaseError) {
            releaseError ||= error;
            throw Object.assign(new Error('作業結果待確認，請重新整理核對，請勿重複送出'), { status: 503, code: 'WORK_RESULT_UNKNOWN' });
        }
        throw error;
    } finally { db?.release(releaseError); }
}
module.exports = { warehouseTransaction };
