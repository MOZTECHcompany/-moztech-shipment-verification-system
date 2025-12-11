// backend/src/config/erpAdapter.js
// ERP 系統適配器 - 用於橋接舊版出貨系統與新版 ERP 資料庫

const { pool } = require('./database');
const logger = require('../utils/logger');

// 預設常數 (從 ERP 查詢獲得)
const DEFAULT_ENTITY_ID = 'tw-entity-001';
const DEFAULT_CHANNEL_ID = '372c4415-cf81-44a5-84a0-87c4e91724cd';

/**
 * 將 ERP 的 SalesOrder 轉換為舊版 Order 格式
 */
const mapSalesOrderToOrder = (so) => {
    return {
        id: so.id,
        voucher_number: so.external_order_id || so.id.substring(0, 8), // 如果沒有外部單號，用 ID 前8碼
        customer_name: so.customer_name || 'Unknown Customer', // 需確認 ERP 是否有此欄位或需 Join
        status: so.status,
        picker_id: so.picker_id,
        packer_id: so.packer_id,
        created_at: so.created_at,
        updated_at: so.updated_at,
        completed_at: so.completed_at,
        is_urgent: false // ERP 暫無此欄位，預設 false
    };
};

/**
 * 執行查詢並自動轉換欄位
 */
const queryOrders = async (sql, params) => {
    // 這裡攔截舊版 SQL 並重寫為新版 SQL
    // 簡單的字串替換可能不夠，需針對特定查詢優化
    
    // 範例：SELECT * FROM orders WHERE id = $1
    if (sql.includes('FROM orders')) {
        const newSql = sql
            .replace('FROM orders', 'FROM sales_orders')
            .replace('voucher_number', 'external_order_id')
            .replace('picker_id', 'picker_id') // 欄位名相同
            .replace('packer_id', 'packer_id'); // 欄位名相同
            
        // 注意：這只是一個簡單的適配，複雜查詢可能需要手動重寫
        return pool.query(newSql, params);
    }
    
    return pool.query(sql, params);
};

module.exports = {
    DEFAULT_ENTITY_ID,
    DEFAULT_CHANNEL_ID,
    mapSalesOrderToOrder
};
