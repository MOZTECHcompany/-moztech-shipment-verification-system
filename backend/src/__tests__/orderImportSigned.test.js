const xlsx = require('xlsx');
const { parseOrderRows, parseOrderImport } = require('../services/orderImportParser');
const rows = (lines=[['4711299274640','Fixture iPhone 6.9 [SKU-1]',-1,''],['4711299274633','Fixture iPhone 6.3 [SKU-2]',1,'']]) => [
    ['理貨單'],['憑證號碼：2026/10/02 -27'],['接收-客戶/供應商：墨子科技 官網'],['出庫倉庫：工業店'],
    ['品項編碼','品項名稱(規格)','數量','摘要'],...lines,['總計'],['2026/10/02 (五) 15:57:31']
];
const workbook = (data,bookType) => {const wb=xlsx.utils.book_new();xlsx.utils.book_append_sheet(wb,xlsx.utils.aoa_to_sheet(data),'理貨單');return xlsx.write(wb,{type:'buffer',bookType});};
test.each(['xlsx','biff8','csv'])('mixed signed %s sample imports without original-order reference and retains both lines',type=>{
    expect(parseOrderImport(workbook(rows(),type))).toMatchObject({documentType:'adjustment',voucherNumber:'2026/10/02 -27',customerName:'墨子科技 官網',signedTotalQuantity:0,totalQuantity:2,positiveQuantity:1,negativeQuantity:1,items:[{quantity:-1,productCode:'SKU-1'},{quantity:1,productCode:'SKU-2'}]});
});
test('all-negative is an independent reversal document; positive format remains shipment',()=>{
    expect(parseOrderRows(rows([['BAR','Product',-2,'']]))).toMatchObject({documentType:'reversal',signedTotalQuantity:-2,totalQuantity:2,positiveQuantity:0,negativeQuantity:2});
    expect(parseOrderRows(rows([['BAR','Product',3,'']]))).toMatchObject({documentType:'shipment',signedTotalQuantity:3,totalQuantity:3,negativeQuantity:0});
});
test('negative serial list validates against absolute quantity and signed thousands separators',()=>{
    expect(parseOrderRows(rows([['BAR','Product',-2,'SN:B19B52004735 SN:B19B52004736']])).items[0].serials).toEqual(['B19B52004735','B19B52004736']);
    expect(parseOrderRows(rows([['BAR','Product','-1,000','']])).totalQuantity).toBe(1000);
    expect(()=>parseOrderRows(rows([['BAR','Product',-2,'SN:B19B52004735']]))).toThrow(/SN 數量/);
});
test('rejects zero, fractional, excess absolute quantity and remains strict about malformed barcode',()=>{
    for(const qty of [0,-1.5,-50001]) expect(()=>parseOrderRows(rows([['BAR','Product',qty,'']]))).toThrow();
    expect(()=>parseOrderRows(rows([['4.7113E+12','Product',-1,'']]))).toThrow(/科學記號/);
    expect(()=>parseOrderRows(rows([['BAR','Product',-25001,''],['OTHER','Product',25000,'']]))).toThrow(/50000/);
});
test('existing original-reference text does not rewrite or select another order',()=>{
    const input=rows();input.splice(2,0,['原單號：OLD-DOCUMENT']);
    const parsed=parseOrderRows(input);expect(parsed.voucherNumber).toBe('2026/10/02 -27');expect(parsed.documentType).toBe('adjustment');expect(parsed).not.toHaveProperty('originalVoucherNumber');
});
test('an original reference never substitutes a missing new document number',()=>{
    const input=rows();input[1]=['原單號：OLD-DOCUMENT'];
    expect(()=>parseOrderRows(input)).toThrow(/找不到訂單號碼/);
});
