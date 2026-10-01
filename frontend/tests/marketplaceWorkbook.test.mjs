import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { marketplaceOrderSheets, parseMarketplaceWorksheet } from '../src/utils/marketplaceWorkbook.mjs';

const header = ['Name','Lineitem quantity','Lineitem sku','Lineitem name','Lineitem price','Financial Status','Fulfillment Status','Currency','Subtotal','Shipping','Taxes','Total','Discount Amount','Refunded Amount'];
const rows = [header,['#W1',2,'000123','Product',50,'paid','unfulfilled','TWD',100,0,0,100,0,0]];
const workbook = sheets => {
  const book = XLSX.utils.book_new();
  for (const [name,data] of sheets) XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(data),name);
  // Read the file through the same SheetJS options as the upload path.
  return XLSX.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{type:'array',raw:true,sheetRows:5001});
};

test('unique order sheet is detected after blank and instructions pages and retains source identifiers',()=>{
  for (const sheets of [[['空白',[]],['說明',[['下載步驟']]],['訂單',rows]],[['訂單',rows],['空白',[]]]]) {
    const book=workbook(sheets);
    assert.deepEqual(marketplaceOrderSheets(XLSX,book),['訂單']);
    const result=parseMarketplaceWorksheet(XLSX,book,'訂單');
    assert.equal(result.parsed.summary.totalQuantity,2);
    assert.equal(result.parsed.items[0].sku,'000123');
    assert.equal(result.parsed.orders[0].sourceOrderNumber,'#W1');
  }
});

test('order header discovery includes hidden tabs and all three platforms',()=>{
  const book=workbook([
    ['Shopify',rows],
    ['1Shop',[['訂單編號','產品SKU','產品數量'],['ONE','123',1]]],
    ['SHOPLINE',[['訂單號碼','商品貨號','商品名稱'],['SL','123','Product']]],
  ]);
  book.Workbook.Sheets[1].Hidden=1;
  assert.deepEqual(marketplaceOrderSheets(XLSX,book),['Shopify','1Shop','SHOPLINE']);
});

test('header discovery does not conceal invalid SKUs or missing financial fields',()=>{
  const damaged=rows.map(r=>[...r]);damaged[1][2]='4.71E+12';
  const book=workbook([['正常',rows],['損毀',damaged],['缺欄',[['訂單號碼','商品貨號','商品名稱'],['SL','123','Product']]]]);
  assert.deepEqual(marketplaceOrderSheets(XLSX,book),['正常','損毀','缺欄']);
  assert.throws(()=>parseMarketplaceWorksheet(XLSX,book,'損毀'),/科學記號/);
  assert.throws(()=>parseMarketplaceWorksheet(XLSX,book,'缺欄'),/缺少/);
  assert.throws(()=>parseMarketplaceWorksheet(XLSX,book,'不存在'),/請選擇/);
});

test('ECOUNT output and WMS audit sheets are not accepted as marketplace orders',()=>{
  const book=workbook([
    ['銷貨匯入',[['日期','品項編碼','數量'],['2026/10/01','123',2]]],
    ['來源商品對照',[['平台','商城訂單','來源SKU','商品名稱'],['Shopify','#W1','123','Product']]],
    ['預揀總表',[['已確認國際條碼','商品名稱','實體數量'],['123','Product',2]]],
  ]);
  assert.deepEqual(marketplaceOrderSheets(XLSX,book),[]);
});

test('worksheet selection keeps original limits and checks multiple platform headers',()=>{
  const many=Array.from({length:5001},()=>[]);many[0]=header;
  const book=workbook([['超量',many],['多表頭',[...rows,...rows]]]);
  // Empty rows may not extend SheetJS ranges; an explicit full range reproduces
  // sheetRows truncation metadata instead of relying on blank cell serialization.
  book.Sheets['超量']['!fullref']='A1:N5001';
  assert.throws(()=>parseMarketplaceWorksheet(XLSX,book,'超量'),/5,000/);
  assert.throws(()=>parseMarketplaceWorksheet(XLSX,book,'多表頭'),/多組平台表頭/);
});
