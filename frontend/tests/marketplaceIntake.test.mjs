import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarketplaceRows, parseMoneyMinor, formatMinor, validateMarketplaceExport, buildEcountRows, buildPrepickRows, buildMarketplaceAuditRows, ECOUNT_HEADERS } from '../src/utils/marketplaceIntake.mjs';

// Entirely synthetic: no customer details or real order/item identifiers.
const allow = ['TEST-A', 'TEST-B'];
function oneRows() {
  const row = (number, sku, name, price, subtotal, extra = {}) => ({ '訂單編號': number, '建立日期': '2026-01-02 12:00:00', '訂單狀態': '等待確認', '名稱': '一般品', '產品SKU': sku, '產品': name, '產品數量': '1', '數量(單品/組合/任選)': '1', '單價': price, '小計': subtotal, '訂單金額(不含金/物流手續費)': '', '訂單金流手續費': '', '訂單運費': '', '總計金額': '', '金流': 'ATM轉帳', '金流狀態': '等待付款', '金流備註': '交易逾時；DO-NOT-RETURN-CONTACT', '物流狀態': '等待出貨', '銷售頁名稱': '合成測試銷售頁', '銷售頁編號前綴': 'SYN', '顧客': 'DO-NOT-RETURN-CUSTOMER', '顧客電話': 'DO-NOT-RETURN-PHONE', '顧客信箱': 'DO-NOT-RETURN-EMAIL', ...extra });
  return [
    row('TEST-A', '0001-02', '合成配件甲', '129', '129', { '訂單金額(不含金/物流手續費)': '428', '訂單金流手續費': '0', '訂單運費': '100', '總計金額': '528' }),
    row('TEST-A', 'SAMPLE-B', '合成配件乙', '299', '299'),
    row('TEST-B', 'SAMPLE-C', '合成主商品', '899', '899', { '名稱': '合成組合商品', '訂單金額(不含金/物流手續費)': '899', '訂單金流手續費': '0', '訂單運費': '0', '總計金額': '899', '金流': '信用卡', '金流備註': '' }),
    row('TEST-B', '0001-02', '合成配件甲', '', '', { '名稱': '合成組合商品', '數量(單品/組合/任選)': '', '金流': '信用卡', '金流備註': '' }),
  ];
}
function settings() { return { store: '合成店鋪', customerCode: '00001', warehouseCode: '003', date: '2026-01-02', batchSequence: '1', batchNumber: 'TEST-20260102-ABCD', currency: 'TWD', taxMode: 'erp_inclusive', taxType: '11', taxConfirmed: true, pendingTestAcknowledged: true, bundleZeroConfirmed: true, skuMappings: Object.fromEntries(['0001-02', 'SAMPLE-B', 'SAMPLE-C'].map((sku, i) => [sku, { erpSku: sku, barcode: `SYNTHETIC-BARCODE-${i}`, confirmed: true, category: '合成分類' }])), shippingSku: { erpSku: 'FREIGHT-TEST', name: '合成運費', confirmed: true, nonStock: true } }; }
const parse = (rows = oneRows(), options = {}) => parseMarketplaceRows(rows, { platform: '1Shop', allowedOrderNumbers: allow, ...options });
const codes = (value) => value.issues.map((i) => i.code);
function aoa(rows) { const headers = [...new Set(rows.flatMap(Object.keys))]; return [headers, ...rows.map((row) => headers.map((key) => row[key] ?? ''))]; }
function shopRows() {
  return [{ Name: 'SHOP-TEST', Id: 'ID-TEST', 'Financial Status': 'pending', 'Fulfillment Status': 'unfulfilled', Currency: 'TWD', Subtotal: '428', Shipping: '100', Taxes: '0', Total: '528', 'Discount Amount': '0', 'Refunded Amount': '0', 'Outstanding Balance': '528', 'Lineitem quantity': '1', 'Lineitem name': '合成甲', 'Lineitem price': '129', 'Lineitem sku': '0001-02', 'Lineitem discount': '0', Email: 'DO-NOT-RETURN-EMAIL' }, { Name: 'SHOP-TEST', 'Lineitem quantity': '1', 'Lineitem name': '合成乙', 'Lineitem price': '299', 'Lineitem sku': 'SAMPLE-B', 'Lineitem discount': '0' }];
}
const parseShop = (rows = shopRows()) => parseMarketplaceRows(rows, { platform: 'Shopify', allowedOrderNumbers: ['SHOP-TEST'] });

test('1Shop preserves two orders, four physical items, one unknown bundle component and money once', () => {
  const p = parse();
  assert.equal(p.summary.orderCount, 2); assert.equal(p.summary.itemCount, 4); assert.equal(p.summary.totalQuantity, 4);
  assert.equal(p.summary.totalMinor, 142700); assert.equal(p.summary.subtotalMinor, 132700); assert.equal(p.summary.shippingMinor, 10000);
  assert.equal(p.summary.bundleComponentCount, 1); assert.equal(p.summary.pendingOrderCount, 2);
  assert.equal(p.items[3].lineSubtotalMinor, null); assert.equal(p.items[3].unitPriceMinor, null);
  assert.equal(p.items[2].kind, 'bundle_anchor'); assert.equal(p.items[3].kind, 'bundle_component');
  assert.equal(p.items[2].groupId, p.items[3].groupId); assert.equal(p.orders[0].financial.currency, null); assert.equal(p.orders[0].financial.taxMinor, null);
  assert.deepEqual(p.issues.filter((i) => i.severity === 'error'), []);
});
test('output excludes contact data and retains only safe payment expiry and sales page metadata', () => {
  const p = parse(); assert.equal(p.orders[0].paymentNote, '付款期限已過'); assert.equal(p.orders[0].paymentStatus, 'pending');
  assert.equal(p.orders[0].salesPagePrefix, 'SYN'); assert.equal(p.orders[0].salesPageName, '合成測試銷售頁');
  assert.doesNotMatch(JSON.stringify(p), /DO-NOT-RETURN/);
});
test('AoA and object parsing agree; exact terminal 1Shop footer is validated and excluded', () => {
  const rows = [...oneRows(), { '訂單編號': '總計\n2張訂單', '訂單金額(不含金/物流手續費)': '1327', '訂單運費': '100', '總計金額': '1427' }];
  const p = parse(aoa(rows)); assert.equal(p.summary.itemCount, 4); assert.equal(p.summary.totalMinor, 142700); assert.equal(p.issues.filter((i) => i.severity === 'error').length, 0);
});
test('footer in the middle, incorrect footer totals or count are rejected', () => {
  const rows = oneRows(); rows.splice(1, 0, { '訂單編號': '總計\n2張訂單' }); assert.ok(codes(parse(rows)).includes('INVALID_FOOTER'));
  assert.ok(codes(parse([...oneRows(), { '訂單編號': '總計\n3張訂單', '總計金額': '1426' }])).includes('FOOTER_COUNT_MISMATCH'));
  assert.ok(codes(parse([...oneRows(), { '訂單編號': '總計\n2張訂單', '總計金額': '1426' }])).includes('FOOTER_AMOUNT_MISMATCH'));
});
test('allowlist is mandatory; excluded order identities or values are not returned', () => {
  assert.ok(codes(parseMarketplaceRows(oneRows(), { platform: '1Shop' })).includes('ALLOWLIST_REQUIRED'));
  const other = { ...oneRows()[0], '訂單編號': 'PRIVATE-EXCLUDED', '产品': 'PRIVATE-EXCLUDED' };
  const p = parse([...oneRows(), other]); assert.equal(p.summary.excludedOrderCount, 1); assert.equal(p.summary.excludedRowCount, 1); assert.doesNotMatch(JSON.stringify(p), /PRIVATE-EXCLUDED/);
});
test('missing selected orders, headers, duplicate headers and invalid platform fail explicitly', () => {
  assert.ok(codes(parse(oneRows().slice(0, 2))).includes('ALLOWED_ORDER_MISSING'));
  assert.ok(codes(parse([{}])).includes('MISSING_HEADERS'));
  assert.ok(codes(parse([['訂單編號', '訂單編號'], ['TEST-A', 'TEST-A']])).includes('DUPLICATE_HEADERS'));
  assert.ok(codes(parse(oneRows(), { platform: 'guess' })).includes('UNSUPPORTED_PLATFORM'));
});
test('identifiers remain strings and generated source IDs are compact and stable after row reordering', () => {
  const original = parse(); const reordered = parse([...oneRows()].reverse());
  assert.equal(original.items[0].sku, '0001-02');
  for (const item of original.items) { assert.match(item.sourceLineId, /^L[0-9a-f]{32}$/); assert.equal(reordered.items.find((other) => other.sourceOrderNumber === item.sourceOrderNumber && other.sku === item.sku).sourceLineId, item.sourceLineId); }
  assert.notEqual(original.items[0].sourceLineId, original.items[3].sourceLineId);
});
test('identical source product rows without platform line ID fail rather than merging', () => {
  const rows = oneRows(); rows.push({ ...rows[0] });
  const p = parse(rows); assert.equal(p.items.length, 5); assert.ok(codes(p).includes('AMBIGUOUS_SOURCE_LINE'));
});
test('distinct explicit platform line IDs preserve repeated SKU rows', () => {
  const rows = oneRows(); rows[0]['來源明細號'] = 'LINE-001'; const duplicate = { ...rows[0], '來源明細號': 'LINE-002' }; rows.push(duplicate);
  const p = parse(rows); assert.equal(p.items.length, 5); assert.ok(!codes(p).includes('AMBIGUOUS_SOURCE_LINE')); assert.equal(p.items[0].sourceLineId, 'LINE-001');
});
test('per-order amounts repeated on item rows are counted once and conflicts fail', () => {
  const rows = oneRows(); rows[1]['總計金額'] = '528'; assert.equal(parse(rows).summary.totalMinor, 142700);
  rows[1]['總計金額'] = '529'; assert.ok(codes(parse(rows)).includes('ORDER_FIELD_CONFLICT'));
});
test('money parser uses exact decimal minor units, preserves unknown and rejects precision/overflow', () => {
  assert.equal(parseMoneyMinor('0.29'), 29); assert.equal(parseMoneyMinor('1,234.50'), 123450); assert.equal(parseMoneyMinor(''), null); assert.equal(formatMinor(142700), '1427.00'); assert.equal(formatMinor(null), '');
  for (const value of ['1.005', '1e3', '1,23', 'NaN', '90071992547410']) assert.throws(() => parseMoneyMinor(value));
});
test('negative, fractional quantities and unsafe quantities are blocked', () => {
  for (const qty of ['0', '-1', '1.5', '9007199254740992']) { const rows = oneRows(); rows[0]['產品數量'] = qty; assert.ok(codes(parse(rows)).includes('INVALID_QUANTITY')); }
});
test('negative money and line discrepancies cannot silently become shipping items', () => {
  const rows = oneRows(); rows[0]['小計'] = '-129'; assert.ok(codes(parse(rows)).includes('NEGATIVE_MONEY')); assert.equal(buildEcountRows(parse(rows), settings()).ok, false);
  rows[0]['小計'] = '128.99'; assert.ok(codes(parse(rows)).includes('LINE_AMOUNT_MISMATCH'));
});
test('order and item financial mismatches independently block output', () => {
  const a = oneRows(); a[0]['總計金額'] = '527.99'; assert.ok(codes(parse(a)).includes('ORDER_TOTAL_MISMATCH'));
  const b = oneRows(); b[0]['訂單金額(不含金/物流手續費)'] = '427'; assert.ok(codes(parse(b)).includes('ITEM_SUBTOTAL_MISMATCH'));
});
test('missing price on ordinary product is never filled down or assumed free', () => {
  const rows = oneRows(); rows[1]['單價'] = ''; rows[1]['小計'] = ''; assert.ok(codes(parse(rows)).includes('MISSING_LINE_MONEY'));
  rows[1]['數量(單品/組合/任選)'] = ''; assert.ok(codes(parse(rows)).includes('AMBIGUOUS_BUNDLE'));
});
test('bundle requires explicit financial confirmation even when known amounts reconcile', () => {
  const s = settings(); s.bundleZeroConfirmed = false;
  assert.ok(codes(validateMarketplaceExport(parse(), s)).includes('BUNDLE_ALLOCATION_REQUIRED')); assert.equal(buildEcountRows(parse(), s).rows.length, 0);
});
test('a bundle title with multiple anchors fails instead of guessing an allocation', () => {
  const rows = oneRows(); rows.push({ ...rows[2], '產品SKU': 'SAMPLE-D', '產品': '另一合成主商品' }); assert.ok(codes(parse(rows)).includes('AMBIGUOUS_BUNDLE'));
});
test('ECOUNT five detailed rows use H11 and V inclusive prices; ERP owns tax calculation', () => {
  const result = buildEcountRows(parse(), settings()); assert.equal(result.ok, true); assert.equal(result.headers.length, 27); assert.deepEqual(result.headers, ECOUNT_HEADERS);
  assert.equal(result.rows.length, 5); assert.ok(result.rows.every((row) => row.length === 27 && row[0] === '20260102' && row[1] === 1 && row[7] === '11'));
  assert.deepEqual(result.rows.map((row) => row[21]), [129, 299, 100, 899, 0]);
  for (const row of result.rows) for (const col of [8, 9, 17, 20, 22, 23, 24, 26]) assert.equal(row[col], '');
  assert.equal(result.summary.ecountTotalMinor, 142700); assert.equal(result.summary.physicalQuantity, 4); assert.equal(result.summary.ecountRowCount, 5);
  assert.deepEqual(result.rows.map((row) => row[12]), ['TEST-A', 'TEST-A', 'TEST-A', 'TEST-B', 'TEST-B']);
  assert.ok(result.rows.every((row) => row[13] === '1Shop' && row[14] === '合成店鋪'));
});
test('order financial report contains Total once and does not claim collected cash', () => {
  const out = buildEcountRows(parse(), settings()); assert.equal(out.reportRows.length, 2); const totalCol = out.reportHeaders.indexOf('訂單總額（非實收）');
  assert.deepEqual(out.reportRows.map((r) => r[totalCol]), [528, 899]); assert.ok(out.reportRows.every((r) => r[3] === '等待付款')); assert.doesNotMatch(JSON.stringify(out), /DO-NOT-RETURN/);
});
test('unknown ERP SKU and unconfirmed ERP mappings block both operational exports', () => {
  for (const change of [(s) => { delete s.skuMappings['SAMPLE-B']; }, (s) => { s.skuMappings['SAMPLE-B'].erpSku = ''; }, (s) => { s.skuMappings['SAMPLE-B'].confirmed = false; }]) {
    const s = settings(); change(s); assert.equal(buildEcountRows(parse(), s).ok, false); assert.equal(buildPrepickRows(parse(), s).ok, false);
  }
});
test('unknown barcode warns but does not block confirmed ERP item export; operational prepick remains blocked', () => {
  const s = settings(); s.skuMappings['SAMPLE-B'].barcode = ''; const out = buildEcountRows(parse(), s);
  assert.equal(out.ok, true); assert.equal(out.rows.length, 5); assert.ok(codes(out).includes('BARCODE_UNCONFIRMED')); assert.equal(buildPrepickRows(parse(), s).ok, false);
});
test('readonly audit and quantity preview need no ERP settings, payment acknowledgement or barcode', () => {
  const p = parse(); const financial = buildMarketplaceAuditRows(p); const quantities = buildPrepickRows(p, { preview: true });
  assert.equal(financial.ok, true); assert.equal(financial.rows.length, 2); assert.equal(financial.rows[0][14], 528); assert.match(financial.rows[0].at(-1), /待核對.*不是實收/);
  assert.equal(quantities.ok, true); assert.equal(quantities.summary.physicalQuantity, 4); assert.ok(quantities.rows.every((row) => row[3] === '' && /條碼未確認/.test(row[9]))); assert.match(quantities.headers[3], /確認後顯示/);
});
test('readonly previews do not bypass fatal source parse errors', () => {
  const rows = oneRows(); rows[0]['總計金額'] = '527'; const p = parse(rows);
  assert.equal(buildMarketplaceAuditRows(p).ok, false); assert.equal(buildPrepickRows(p, { preview: true }).ok, false);
});
test('explicitly unconfirmed barcode is never marked verified by ERP-only confirmation', () => {
  const s = settings(); s.skuMappings['SAMPLE-B'].barcodeConfirmed = false;
  const p = buildPrepickRows(parse(), { ...s, preview: true }); assert.equal(p.rows.find((r) => r[1] === 'SAMPLE-B')[3], ''); assert.equal(buildEcountRows(parse(), s).ok, true);
});
test('shipping requires verified non-stock ERP item and never contributes prepick quantity', () => {
  const s = settings(); s.shippingSku.nonStock = false; assert.ok(codes(validateMarketplaceExport(parse(), s)).includes('SHIPPING_MAPPING_REQUIRED'));
  const p = buildPrepickRows(parse(), settings()); assert.equal(p.ok, true); assert.equal(p.rows.length, 3); assert.equal(p.summary.physicalQuantity, 4); assert.equal(p.rows.find((r) => r[1] === '0001-02')[5], 2); assert.doesNotMatch(JSON.stringify(p.rows), /FREIGHT-TEST/);
});
test('prepick groups by SKU+verified barcode, retains source orders, category and bundle names', () => {
  const p = buildPrepickRows(parse(), settings()); const common = p.rows.find((r) => r[1] === '0001-02'); assert.equal(common[0], '合成分類'); assert.equal(common[6], 2); assert.match(common[7], /TEST-A.*TEST-B/); assert.match(common[8], /合成組合商品/);
});
test('pending acknowledgement is required and never changes source payment state', () => {
  const s = settings(); s.pendingTestAcknowledged = false; const p = parse(); assert.ok(codes(validateMarketplaceExport(p, s)).includes('PENDING_TEST_ACK_REQUIRED')); assert.equal(buildPrepickRows(p, s).ok, false); assert.ok(p.orders.every((o) => o.paymentStatus === 'pending'));
});
test('cancelled, fulfilled and unknown payment orders are not eligible', () => {
  for (const extra of [{ '訂單狀態': '已取消' }, { '物流狀態': '已出貨' }, { '金流狀態': '處理中' }]) { const rows = oneRows().map((r) => ({ ...r, ...extra })); assert.ok(codes(validateMarketplaceExport(parse(rows), settings())).includes('ORDER_NOT_ELIGIBLE')); }
});
test('required settings cannot be replaced by placeholder currency/tax defaults', () => {
  for (const key of ['store', 'customerCode', 'warehouseCode', 'batchSequence', 'batchNumber', 'date', 'currency', 'taxType', 'taxMode', 'taxConfirmed']) { const s = settings(); delete s[key]; assert.equal(buildEcountRows(parse(), s).ok, false, key); }
  const s = settings(); s.date = '2026-02-30'; assert.ok(codes(validateMarketplaceExport(parse(), s)).includes('DATE_REQUIRED'));
  s.erpCurrencyCode = 'TWD'; assert.ok(codes(validateMarketplaceExport(parse(), s)).includes('ERP_CURRENCY_REQUIRED'));
});
test('batch sequence must be positive integer; TEST tracking number is bounded and preserved', () => {
  for (const sequence of ['0', '-1', '1.5', '10000', 'abc', '9007199254740992']) { const s = settings(); s.batchSequence = sequence; assert.ok(codes(validateMarketplaceExport(parse(), s)).includes('INVALID_BATCH_SEQUENCE')); }
  for (const number of ['', 'REAL-20260101', 'TEST-1234567890123456']) { const s = settings(); s.batchNumber = number; assert.ok(codes(validateMarketplaceExport(parse(), s)).includes('BATCH_NUMBER_REQUIRED')); }
  assert.ok(buildEcountRows(parse(), settings()).rows.every((r) => r[10] === 'TEST-20260102-ABCD'));
});
test('two-decimal source amounts remain numeric Excel cells and roundtrip to exact cents', () => {
  const rows = oneRows(); rows[0]['單價'] = '129.29'; rows[0]['小計'] = '129.29'; rows[0]['訂單金額(不含金/物流手續費)'] = '428.29'; rows[0]['總計金額'] = '528.29';
  const out = buildEcountRows(parse(rows), settings()); assert.equal(out.ok, true); assert.equal(out.rows[0][21], 129.29); assert.equal(parseMoneyMinor(out.rows[0][21]), 12929); assert.equal(out.reportRows[0][14], 528.29); assert.equal(out.summary.ecountTotalMinor, 142729);
});
test('nonzero source payment fee blocks export until separate accounting mapping exists', () => {
  const rows = oneRows(); rows[0]['訂單金流手續費'] = '10'; rows[0]['總計金額'] = '538'; assert.ok(codes(validateMarketplaceExport(parse(rows), settings())).includes('FEE_MAPPING_REQUIRED'));
});
test('nondivisible two-decimal unit prices fail rather than introducing rounding drift', () => {
  const p = parse(); p.items[0].quantity = 2; p.items[0].lineSubtotalMinor = 12901; assert.ok(codes(validateMarketplaceExport(p, settings())).includes('UNIT_PRICE_PRECISION'));
});
test('builder independently checks source-to-ECOUNT money roundtrip', () => {
  const p = parse(); p.orders[0].financial.totalMinor += 1; const result = buildEcountRows(p, settings()); assert.equal(result.ok, false); assert.equal(result.rows.length, 0); assert.ok(codes(result).includes('ECOUNT_ROUNDTRIP_MISMATCH'));
});
test('Shopify metadata continuation rows keep order money once and expose no contact data', () => {
  const p = parseShop(); assert.equal(p.summary.orderCount, 1); assert.equal(p.summary.itemCount, 2); assert.equal(p.summary.totalMinor, 52800); assert.equal(p.orders[0].financial.outstandingMinor, 52800); assert.doesNotMatch(JSON.stringify(p), /DO-NOT-RETURN/); assert.equal(p.issues.filter((i) => i.severity === 'error').length, 0);
});
test('Shopify accepts blank Name continuation only after a known parent', () => {
  const rows = shopRows(); rows[1].Name = ''; assert.equal(parseShop(rows).items.length, 2); rows[0].Name = ''; assert.ok(codes(parseShop(rows)).includes('MISSING_ORDER_NUMBER'));
});
test('Shopify shipping discount reconciles total but prevents guessed allocation', () => {
  const rows = shopRows().slice(0, 1); Object.assign(rows[0], { Subtotal: '675', Shipping: '80', Total: '675', 'Discount Amount': '695', 'Lineitem price': '1290' });
  const p = parseShop(rows); assert.ok(!codes(p).includes('ORDER_TOTAL_MISMATCH')); assert.ok(codes(p).includes('SHIPPING_DISCOUNT_ALLOCATION_REQUIRED')); assert.ok(codes(p).includes('DISCOUNT_ALLOCATION_REQUIRED')); assert.equal(buildEcountRows(p, settings()).ok, false);
});
test('Shopify line discount is applied once per line, not per unit', () => {
  const rows = shopRows().slice(0, 1); Object.assign(rows[0], { Subtotal: '158', Shipping: '0', Total: '158', 'Discount Amount': '100', 'Lineitem quantity': '2', 'Lineitem price': '129', 'Lineitem discount': '100' });
  const p = parseShop(rows); assert.equal(p.items[0].lineSubtotalMinor, 15800); assert.ok(!codes(p).includes('DISCOUNT_ALLOCATION_REQUIRED')); assert.ok(!codes(p).includes('ORDER_TOTAL_MISMATCH'));
});
test('Shopify refund and currency mismatch cannot be mistaken for eligible paid sales', () => {
  const rows = shopRows(); rows[0]['Financial Status'] = 'refunded'; rows[0]['Refunded Amount'] = '528'; rows[0].Currency = 'USD';
  const validation = validateMarketplaceExport(parseShop(rows), settings()); assert.ok(codes(validation).includes('ORDER_NOT_ELIGIBLE')); assert.ok(codes(validation).includes('CURRENCY_MISMATCH'));
});
