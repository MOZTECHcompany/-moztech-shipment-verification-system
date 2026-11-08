const { IMPORT_LIMITS, ecountSerialTokens } = require('./orderImportParser');

async function readEcountPickingIdentities(db, rows, columns) {
    const productCodes = new Set();
    const cartonCandidates = new Set();
    for (const row of rows) {
        const cell = field => String(row[columns[field]] ?? '').trim();
        const sku = cell('productCode');
        if (!sku) continue;
        if (!cell('barcode') && !cell('internalScanCode')) productCodes.add(sku);
        const serials = cell('serials');
        for (const candidate of [serials, ...ecountSerialTokens(serials)]) {
            if (candidate.length && candidate.length <= 128) cartonCandidates.add(candidate);
        }
        if (cartonCandidates.size > IMPORT_LIMITS.serials + IMPORT_LIMITS.items) {
            throw Object.assign(new Error('理貨明細的序號或箱批號超過匯入上限'), { status: 413 });
        }
    }

    const [codes, cartonRows] = await Promise.all([
        productCodes.size ? db.query(`SELECT product_code, internal_scan_code FROM marketplace_internal_scan_codes
            WHERE product_code = ANY($1::text[])`, [[...productCodes]]) : { rows: [] },
        cartonCandidates.size ? db.query(`SELECT c.carton_id, c.status, l.item_code, l.international_barcode, l.internal_scan_code, l.actual_sns,
            EXISTS (SELECT 1 FROM wms_carton_serials s WHERE s.serial_number = c.carton_id) AS serial_collision
            FROM wms_cartons c LEFT JOIN wms_carton_lines l USING (carton_id)
            WHERE c.carton_id = ANY($1::text[])`, [[...cartonCandidates]]) : { rows: [] }
    ]);
    const scanCodes = new Map();
    for (const { product_code, internal_scan_code } of codes.rows) {
        if (!scanCodes.has(product_code)) scanCodes.set(product_code, []);
        scanCodes.get(product_code).push(internal_scan_code);
    }
    const cartons = new Map();
    for (const row of cartonRows.rows) {
        if (!cartons.has(row.carton_id)) cartons.set(row.carton_id, { status: row.status, serialCollision: row.serial_collision, lines: [] });
        cartons.get(row.carton_id).lines.push(row);
    }
    return { scanCodes, cartons };
}

module.exports = { readEcountPickingIdentities };
