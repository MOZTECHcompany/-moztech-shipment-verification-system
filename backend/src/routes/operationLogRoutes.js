const express = require('express');
const { authorizeAdmin } = require('../middleware/auth');
const { searchOperationLogs, operationLogStats } = require('../services/operationLogSearch');
const logger = require('../utils/logger');

function createOperationLogRouter({ pool, reportPool = pool }) {
    const router = express.Router();
    for (const [path, search, database, failure] of [
        ['/operation-logs', searchOperationLogs, pool, '查詢操作日誌失敗'],
        ['/operation-logs/stats', operationLogStats, reportPool, '查詢統計資料失敗'],
    ]) {
        router.get(path, authorizeAdmin, async (req, res) => {
            res.set('Cache-Control', 'private, no-store');
            try { res.json(await search(database, req.query)); }
            catch (error) {
                if (error.status === 400) return res.status(400).json({ message: error.message });
                if (error.code === '57014') return res.status(503).json({
                    code: 'OPERATION_LOG_QUERY_TIMEOUT', message: '查詢逾時，請縮短日期範圍或增加關鍵字後重試',
                });
                // Search text can include employee/customer names or serials.
                // Do not log SQL parameters, query strings, or DB error details.
                logger.error(`[operation-logs] ${failure}`);
                res.status(500).json({ message: failure });
            }
        });
    }
    return router;
}

module.exports = { createOperationLogRouter };
