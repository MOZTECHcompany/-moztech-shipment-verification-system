// Source order identity belongs to an item, not the warehouse document.
// Keep this contract independent of ECOUNT / any future ERP column labels.
const SOURCE_FIELDS = Object.freeze({
    sourceOrderNumber: 'source_order_number',
    sourcePlatform: 'source_platform',
    sourceStore: 'source_store',
    sourceLineId: 'source_line_id'
});

function normalizeSourceIdentity(input = {}) {
    const source = {};
    for (const key of Object.keys(SOURCE_FIELDS)) {
        const raw = input[key];
        if (raw !== undefined && raw !== null && typeof raw !== 'string') throw new Error(`${key} 必須為文字`);
        const value = raw == null ? '' : raw.trim();
        if (value.length > 255 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${key} 不可超過 255 字或包含控制字元`);
        source[key] = value || null;
    }
    if (!source.sourceOrderNumber && Object.values(source).some(Boolean)) throw new Error('來源資料必須包含商城訂單編號');
    return source;
}

function sourceIdentityFromRow(row = {}) {
    return Object.fromEntries(Object.entries(SOURCE_FIELDS).map(([key, column]) => [key, row[column] || null]));
}

function sourceIdentityValues(source = {}) {
    return Object.keys(SOURCE_FIELDS).map(key => source[key] || null);
}

module.exports = { SOURCE_FIELDS, normalizeSourceIdentity, sourceIdentityFromRow, sourceIdentityValues };
