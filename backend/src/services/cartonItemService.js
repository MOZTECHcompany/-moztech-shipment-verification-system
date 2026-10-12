const invalid = (code, message, status = 400) => Object.assign(new Error(message), { code, status });

function createCartonItemService({ pool }) {
    async function search(query, actor) {
        const user = (await pool.query('SELECT id,role,management_scope FROM users WHERE id=$1', [actor?.id])).rows[0];
        if (!user) throw invalid('AUTH_REQUIRED', '需要有效登入', 401);
        if (!(user.role === 'superadmin' || (user.role === 'admin' && user.management_scope !== 'orders'))) {
            throw invalid('CARTON_FORBIDDEN', '選取建箱品項需倉儲管理員權限', 403);
        }
        if (query?.q !== undefined && typeof query.q !== 'string') throw invalid('CARTON_ITEM_QUERY_INVALID', '搜尋文字無效');
        const q = (query?.q || '').trim();
        if (q.length > 128 || /[\u0000-\u001f\u007f]/.test(q)) throw invalid('CARTON_ITEM_QUERY_INVALID', '搜尋文字最多 128 字');
        if (!q) return { items: [], barcodeIdentity: 'unconfirmed' };
        const rows = (await pool.query({
            text: `SELECT DISTINCT product_code,product_name,barcode FROM order_items
                WHERE product_code IS NOT NULL AND product_code<>'' AND (
                    POSITION(lower($1) IN lower(product_code))>0
                    OR POSITION(lower($1) IN lower(COALESCE(product_name,'')))>0
                    OR POSITION(lower($1) IN lower(COALESCE(barcode,'')))>0)
                ORDER BY product_code,product_name,barcode LIMIT 30`,
            values: [q], query_timeout: 5000
        })).rows;
        // A legacy import key can be an EAN, SKU or internal label. Preserve its
        // exact bytes; its physical identity must be explicitly confirmed.
        return { items: rows.map(row => ({ itemCode: row.product_code, productName: row.product_name,
            importedBarcode: row.barcode, barcodeIdentity: 'unconfirmed' })), barcodeIdentity: 'unconfirmed' };
    }
    return { search };
}

module.exports = { createCartonItemService };
