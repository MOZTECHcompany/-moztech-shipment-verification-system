import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { parseCartonExcel } from '../src/utils/cartonExcel.js';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const header = ['箱號', '品號', '數量', 'SN'];
const readOptions = { type: 'buffer', cellNF: true, cellText: true };
function workbook(rows, configure, { name = '箱號明細', dense = false } = {}) {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    configure?.(sheet);
    XLSX.utils.book_append_sheet(book, sheet, name);
    return XLSX.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), { ...readOptions, dense });
}
const parse = book => parseCartonExcel(book, XLSX);
const simple = (...rows) => workbook([header, ...rows]);
const snList = (prefix, count) => Array.from({ length: count }, (_, index) => `${prefix}-${index}`).join(',');

test('real XLSX roundtrip groups nonadjacent carton lines and preserves explicit identities', () => {
    const book = workbook([
        ['內部掃描碼', 'SN', '數量', '品名', '品號', '國際條碼', '箱號', '備註'],
        ['', '0001,Vendor-a02，Vendor-A02、Vendor-03\r\nVendor-04', 5, '測試商品', '000P01', 123, 2, 2],
        [],
        ['ITM-P02', '', '10', '', 'P02', '', 'BOX-A'],
        ['', '', 3, '', 'P03', '0004710000001', 2],
    ], sheet => {
        sheet.F2.z = '0000000000000';
        sheet.G2.z = sheet.G5.z = '0000';
        sheet.H2.f = '1+1'; // Unused column formulas do not affect carton import.
    });
    const before = structuredClone(book);
    assert.deepEqual(parse(book), { format: 'corely-cartons-v1', cartons: [
        { cartonId: '0002', lines: [
            { itemCode: '000P01', quantity: 5, actualSN: ['0001','Vendor-a02','Vendor-A02','Vendor-03','Vendor-04'], productName: '測試商品', ean: '0000000000123', internalScanCode: null },
            { itemCode: 'P03', quantity: 3, actualSN: [], productName: null, ean: '0004710000001', internalScanCode: null },
        ] },
        { cartonId: 'BOX-A', lines: [{ itemCode: 'P02', quantity: 10, actualSN: [], productName: null, ean: null, internalScanCode: 'ITM-P02' }] },
    ] });
    assert.deepEqual(book, before);
});

test('dense cells and formatted number SN are supported', () => {
    const book = workbook([header, ['BOX', 7, 1, 3]], sheet => { sheet.B2.z = '0000'; sheet.D2.z = '000000'; }, { dense: true });
    const [line] = parse(book).cartons[0].lines;
    assert.equal(line.itemCode, '0007');
    assert.deepEqual(line.actualSN, ['000003']);
});

test('reads leading zeroes from the format without caching into a source cell', () => {
    const book = workbook([header, ['BOX', 7, 1, '']], sheet => { sheet.B2.z = '0000'; });
    delete book.Sheets.箱號明細.B2.w;
    assert.equal(parse(book).cartons[0].lines[0].itemCode, '0007');
    assert.equal(book.Sheets.箱號明細.B2.w, undefined);
});

test('rejects wrong sheet, missing required headers, duplicates, and no rows', () => {
    assert.throws(() => parse(workbook([header], undefined, { name: '箱號明細1' })), /找不到「箱號明細」/);
    assert.throws(() => parse(workbook([['箱號', '品號', '數量', '序號']])), /第 1 列.*缺少欄位：SN/);
    assert.throws(() => parse(workbook([[...header, '國際條碼', '國際條碼']])), /第 1 列.*國際條碼欄重複/);
    assert.throws(() => parse(simple([])), /第 2 列.*沒有可匯入/);
});

test('reports real Excel row after blanks and rejects invalid quantities and serial lists', () => {
    assert.throws(() => parse(simple([], ['BOX', '', 1, ''])), /第 3 列.*箱號、品號必填/);
    for (const qty of [0, -1, 1.5, '1.5', '1e1', 1000001, null]) {
        assert.throws(() => parse(simple(['BOX', 'SKU', qty, ''])), /第 2 列.*正整數/);
    }
    for (const format of ['yyyy-mm-dd','[h]:mm:ss']) {
        assert.throws(() => parse(workbook([header,['BOX','SKU',45000,'']], sheet => { sheet.C2.z = format; })), /第 2 列.*日期或時間格式/);
    }
    for (const sn of ['Vendor-01', '，、', 'Vendor-01,Vendor-01']) {
        assert.throws(() => parse(simple(['BOX','SKU',2,sn])), /第 2 列.*(SN 筆數|重複)/);
    }
    for (const sn of ['Vendor 01', 'CTN-S01', '超過ASCII']) {
        assert.throws(() => parse(simple(['BOX','SKU',1,sn])), /第 2 列.*ASCII/);
    }
    assert.throws(() => parse(simple(['BOX-1','SKU',1,'S-001'],[],['BOX-2','SKU',1,'S-001'])), /第 4 列.*第 2 列/);
});

test('refuses formulas even if a cached string or number appears valid', () => {
    const cols = [...header, '品名', '國際條碼', '內部掃描碼'];
    for (const [col, label] of cols.entries()) {
        const book = workbook([cols, ['BOX','SKU',1,'S-001','Name','00001234','ITM-SKU']], sheet => {
            sheet[XLSX.utils.encode_cell({ r: 1, c: col })].f = '1+1';
        });
        assert.throws(() => parse(book), new RegExp(`第 2 列.*${label}不能使用公式`));
    }
});

test('numeric identifier precision and representation fail closed; long text stays exact', () => {
    const exactText = '00012345678901234567890';
    assert.equal(parse(simple(['BOX',exactText,1,''])).cartons[0].lines[0].itemCode, exactText);
    for (const value of [1000000000000000, 1234567890123456, 123.25, -1]) {
        assert.throws(() => parse(simple(['BOX',value,1,''])), /第 2 列.*精度/);
    }
    for (const format of ['0.00E+00','#,##0','yyyy-mm-dd','0.00']) {
        assert.throws(() => parse(workbook([header,['BOX',123456,1,'']], sheet => { sheet.B2.z = format; })), /第 2 列.*顯示不明確/);
    }
});

test('bounds cartons, lines, SN totals and worksheet range', () => {
    assert.throws(() => parse(simple(...Array.from({length:101},(_,i)=>[`BOX${i}`,'SKU',1,'']))), /第 102 列.*100 箱/);
    assert.throws(() => parse(simple(...Array.from({length:101},()=>['BOX','SKU',1,'']))), /第 102 列.*100 筆品項/);
    assert.throws(() => parse(simple(['BOX','SKU',1000,snList('S',1000)],['BOX','SKU',1,'LAST'])), /第 3 列.*1000 筆 SN/);
    const cartons = Array.from({length:10},(_,i)=>[`BOX${i}`,'SKU',1000,snList(`S${i}`,1000)]);
    assert.equal(parse(simple(...cartons)).cartons.length, 10);
    assert.throws(() => parse(simple(...cartons,['BOX10','SKU',1,'LAST'])), /第 12 列.*10000 筆 SN/);
    const tooLarge = simple(['BOX','SKU',1,'']);
    tooLarge.Sheets.箱號明細['!ref'] = 'A1:XFD1048576';
    assert.throws(() => parse(tooLarge), /第 1 列.*工作表不得超過/);
});
