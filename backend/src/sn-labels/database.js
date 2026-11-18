const { randomUUID } = require('node:crypto');
const { BadRequestException, ConflictException, NotFoundException } = require('./errors');

const productFields = "id, sku, name, COALESCE(barcode,internal_scan_code) AS barcode, model_number AS \"modelNumber\", attributes";
function bind(db, parts, values) {
    const sql = parts.reduce((query, part, index) => query + (index ? '$' + index : '') + part, '');
    return db.query(sql, values);
}
function labelDatabase(pool) {
    function session(db) {
        return {
            $queryRaw: async (parts, ...values) => (await bind(db, parts, values)).rows,
            $executeRaw: async (parts, ...values) => {
                const result = await bind(db, parts, values);
                return result.rowCount ?? result.affectedRows;
            },
            productById: async id => (await db.query('SELECT ' + productFields + ' FROM wms_sn_products WHERE id=$1', [id])).rows[0]
        };
    }
    return { ...session(pool), async $transaction(action, options = {}) {
        const db = await pool.connect();
        try {
            await db.query(options.isolationLevel === 'RepeatableRead' ? 'BEGIN ISOLATION LEVEL REPEATABLE READ' : 'BEGIN');
            const value = await action(session(db));
            await db.query('COMMIT');
            return value;
        } catch (error) {
            await db.query('ROLLBACK');
            throw error;
        } finally { db.release(); }
    }};
}
function profile(body) {
    const text = (key, max = 50) => {
        const value = body?.[key] ?? '';
        if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f]/.test(value)) throw new BadRequestException('品項欄位格式錯誤');
        return value.trim();
    };
    const scanCode = text('barcode', 84);
    const barcode = /^\d{8,14}$/.test(scanCode) ? scanCode : null;
    const internal = /^ITM-[A-Za-z0-9_-]{1,80}$/.test(scanCode) ? scanCode : null;
    if (!barcode && !internal) throw new BadRequestException('請填寫國際條碼或 ITM- 開頭的內部掃描碼');
    const snLabels = Object.fromEntries(['style','color','modelCode','styleCode','colorCode'].map(k => [k,text(k,k.endsWith('Code') ? 6 : 50)]));
    return { sku:text('sku', 120), name:text('name', 200), barcode, internal, model:text('modelNumber', 40), attributes:JSON.stringify({ snLabels }) };
}
async function saveProduct(db, id, body) {
    const p = profile(body), values = [p.barcode,p.internal,p.model,p.attributes];
    if (!id && (!p.sku || !p.name)) throw new BadRequestException('請填寫 ECOUNT 品號和品名');
    const sql = id ? 'UPDATE wms_sn_products SET barcode=$1,internal_scan_code=$2,model_number=$3,attributes=$4::jsonb WHERE id=$5' :
        'INSERT INTO wms_sn_products (barcode,internal_scan_code,model_number,attributes,id,sku,name) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7) ON CONFLICT (sku) DO NOTHING';
    const result = await db.query(sql + ' RETURNING ' + productFields, id ? [...values,id] : [...values,randomUUID(),p.sku,p.name]);
    if (!result.rows.length) {
        if (id) throw new NotFoundException('找不到品項');
        throw new ConflictException('這個品號已建檔，請選取既有品項');
    }
    return result.rows[0];
}
async function resolveProducts(db, keys) {
    if (!Array.isArray(keys) || keys.length > 1000 || keys.some(k => typeof k !== 'string' || !/^\d{8,14}$/.test(k))) throw new BadRequestException('國際條碼清單格式錯誤');
    const result = await db.query('SELECT DISTINCT barcode,sku FROM (SELECT barcode,sku FROM wms_sn_products UNION ALL SELECT l.international_barcode,l.item_code FROM wms_carton_lines l JOIN wms_cartons c USING(carton_id) WHERE c.status=\'sealed\') p WHERE barcode=ANY($1::text[])', [keys]);
    const matches = new Map(keys.map(k => [k,[]]));
    for (const row of result.rows) matches.get(row.barcode).push({ active:true, erp_sku:row.sku, barcode:row.barcode });
    return { products:Object.fromEntries([...matches].map(([key,list]) => [key,{status:list.length === 1 ? 'matched' : 'unresolved', matches:list}])) };
}
module.exports = { labelDatabase, saveProduct, resolveProducts, productFields };
