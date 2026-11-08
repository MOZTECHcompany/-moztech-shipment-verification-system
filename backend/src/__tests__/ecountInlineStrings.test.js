const xlsx = require('xlsx');
const { parseOrderImport, readOrderImportRows } = require('../services/orderImportParser');

function ecountWorkbook({ quantity = 2, exact = false, formulaBarcode = false } = {}) {
    const book = xlsx.utils.book_new();
    const sheet = xlsx.utils.aoa_to_sheet([
        ['理貨單號', '商城訂單編號', '品項編碼', '品項名稱', '國際條碼', '數量', exact ? '實際SN' : '序號/批號'],
        ['TEST-35', 'TEST-SN', 'SKU-TEST', '測試品項', '0012345678905', quantity, 'PLACEHOLDER']
    ]);
    if (formulaBarcode) sheet.E2 = { t: 's', f: '"0012345678905"', v: '0012345678905' };
    xlsx.utils.book_append_sheet(book, sheet, '理貨單明細內容');
    const zip = xlsx.CFB.read(xlsx.write(book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
    const part = xlsx.CFB.find(zip, '/xl/worksheets/sheet1.xml');
    const original = part.content.toString('utf8');
    // ECOUNT places xml:space on <is> as well as <t>. The 0.18.5
    // worksheet reader matches only a literal <is>, dropping the entire cell.
    const serial = exact ? 'Vendor-a&amp;01\n000000000002' : 'TWC261106001\nTWC261106002';
    const modified = original.replace(/<c r="G2"[^>]*>[\s\S]*?<\/c>/,
        `<c r="G2" t="inlineStr" xml:space="preserve"><is xml:space="preserve"><t xml:space="preserve">${serial}</t></is></c>`);
    if (modified === original) throw new Error('Could not build the ECOUNT XML fixture');
    part.content = Buffer.from(modified, 'utf8');
    part.size = part.content.length;
    return xlsx.CFB.write(zip, { type: 'buffer', fileType: 'zip', compression: true });
}

test('reads both original multiline serials from an attributed ECOUNT inline string', () => {
    const file = ecountWorkbook();
    const parsed = readOrderImportRows(file);
    expect(parsed[1][6]).toBe('TWC261106001\nTWC261106002');
    expect(parseOrderImport(file).items[0]).toMatchObject({
        barcode: '0012345678905', productCode: 'SKU-TEST', productName: '測試品項',
        quantity: 2, serials: ['TWC261106001', 'TWC261106002']
    });
});

test('recovers XML entities, exact case and leading zeroes through the usual XLSX parser', () => {
    expect(parseOrderImport(ecountWorkbook({ exact: true })).items[0]).toMatchObject({
        serialMode: 'exact', serials: ['Vendor-a&01', '000000000002']
    });
});

test('still rejects a serial count mismatch after recovering the cell', () => {
    expect(() => parseOrderImport(ecountWorkbook({ quantity: 3 }))).toThrow(/需求數量 3 與 SN 數量 2 不符/);
});

test('does not bypass the original formula barcode validation on a recovered worksheet', () => {
    expect(() => parseOrderImport(ecountWorkbook({ formulaBarcode: true }))).toThrow(/條碼為公式/);
});
