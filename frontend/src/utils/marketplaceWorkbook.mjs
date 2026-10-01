import { detectMarketplaceHeaders, parseUnifiedMarketplace } from './unifiedMarketplace.mjs';

const rowOptions = { header: 1, raw: true, defval: '', blankrows: true, range: 0 };

export function marketplaceOrderSheets(XLSX, book) {
  return book.SheetNames.filter(name => {
    const sheet = book.Sheets[name];
    if (!sheet?.['!ref']) return false;
    // Header discovery only: keep the usual validation on the selected sheet.
    const headerRange = XLSX.utils.decode_range(sheet['!ref']);
    headerRange.s = { r: 0, c: 0 };
    headerRange.e.r = Math.min(headerRange.e.r, 9);
    headerRange.e.c = Math.min(headerRange.e.c, 199);
    const rows = XLSX.utils.sheet_to_json(sheet, { ...rowOptions, range: headerRange });
    return detectMarketplaceHeaders(rows).length > 0;
  });
}

export function parseMarketplaceWorksheet(XLSX, book, sheetName) {
  if (!book.SheetNames.includes(sheetName)) throw Error('請選擇訂單工作表。');
  const sheet = book.Sheets[sheetName];
  const range = XLSX.utils.decode_range(sheet?.['!fullref'] || sheet?.['!ref'] || 'A1');
  if (range.e.r >= 5000 || range.e.c >= 200) throw Error('原始檔最多 5,000 列或 200 欄，請分批匯出。');
  return parseUnifiedMarketplace(XLSX.utils.sheet_to_json(sheet, rowOptions));
}
