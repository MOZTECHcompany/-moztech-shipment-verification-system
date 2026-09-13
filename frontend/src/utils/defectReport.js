export function defectRows(stats) {
    return (stats || []).flatMap(item => (item.details || []).map(detail => ({
        product_name: item.product_name, product_barcode: item.product_barcode, ...detail,
    }))).sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || Number(b.id || 0) - Number(a.id || 0));
}

function csvCell(value) {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
}

export function defectCsv(rows) {
    const headers = ['產品名稱', '條碼', '不良次數', '訂單號', '原SN', '新SN', '原因', '更換人', '時間'];
    const cells = rows.map(row => [row.product_name, row.product_barcode, 1, row.voucher_number || row.order_id,
        row.original_sn, row.new_sn, row.reason, row.reporter, new Date(row.created_at).toLocaleString('zh-TW')]);
    return '\uFEFF' + [headers, ...cells].map(row => row.map(csvCell).join(',')).join('\r\n');
}
