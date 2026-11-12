const { buildMarketplaceReadyScope, projectMarketplaceReadyRows } = require('../services/marketplaceReadyScope');
const { createMarketplacePreparation } = require('../services/marketplacePreparation');

const regularSku = '4711299274572';
const accessorySku = '4711299273070';
const lineId = value => `gid://shopify/LineItem/${value}`;
const variant = value => `gid://shopify/ProductVariant/${value}`;
const product = { erp_sku: regularSku, active: true, barcode: regularSku };
const mapped = sku => ({ erpSku: sku, erpName: '品項', barcode: sku, confirmed: true, barcodeConfirmed: true });

function fixture() {
 const sourceRows = [
  ['Name', 'Id', 'Lineitem id', 'Lineitem sku', 'Lineitem quantity', 'Lineitem price'],
  ['#ready', '11', '101', regularSku, '1', '200'],
  ['', '', '102', accessorySku, '2', '200'],
  ['#hold', '12', '103', regularSku, '1', '200'],
  ['', '', '104', accessorySku, '1', '200'],
  ['#fulfilled', '13', '105', regularSku, '1', '200'],
 ];
 const live = (number, id, items, fulfillmentStatus = 'unfulfilled') => {
  const currentQuantity = items.reduce((sum, line) => sum + line.quantity, 0);
  return { number, id, items, fulfillmentStatus, cancelled: false, cancelledAt: null, currentQuantity,
   remainingQuantity: fulfillmentStatus === 'fulfilled' ? 0 : currentQuantity };
 };
 const current = (id, sku, quantity = 1) => ({ id: lineId(id), sku, quantity, variantId: variant(id), barcode: sku });
 const orders = [
  live('#ready', '11', [current(101, regularSku), current(102, accessorySku, 2)]),
  live('#hold', '12', [{ id: lineId(103), sku: regularSku, quantity: 1 }, current(104, accessorySku)]),
  live('#fulfilled', '13', [current(105, regularSku)], 'fulfilled'),
 ];
 const parsedOrders = orders.map(order => ({
  sourceOrderNumber: order.number, sourcePlatform: 'Shopify', paymentStatus: 'paid', cancelled: false,
  fulfillmentStatus: order.fulfillmentStatus,
  financial: { currency: 'TWD', subtotalMinor: order.currentQuantity * 20000, totalMinor: order.currentQuantity * 20000,
   shippingMinor: 0, feeMinor: 0, taxMinor: 0, refundedMinor: 0 },
 }));
 const items = orders.flatMap(order => order.items.map(line => ({
  sourceOrderNumber: order.number, sourceLineId: line.id, sku: line.sku, quantity: line.quantity,
  lineSubtotalMinor: line.quantity * 20000, unitPriceMinor: 20000,
 })));
 const conflict = {
  sourceSku: regularSku, sourceBarcode: regularSku, selectedErpSku: regularSku, reviewReason: 'SOURCE_VARIANT_MISSING',
  targetOptions: [{ erpSku: regularSku, erpBarcode: regularSku }],
  relatedOrders: orders.slice(0, 2).map(order => {
   const line = order.items[0];
   return { orderNumber: order.number, orderId: order.id, sourceLineId: line.id, quantity: line.quantity,
    barcode: line.barcode || '', barcodeMissing: !line.barcode, variantId: line.variantId || '', sourceVerified: true };
  }),
 };
 const issue = { code: 'BARCODE_MISMATCH', severity: 'error', sku: regularSku, message: '條碼待核對' };
 return {
  source: { platform: 'Shopify', rows: sourceRows },
  raw: { platform: 'Shopify', orders: parsedOrders, items, issues: [] },
  parsed: { orders: parsedOrders.slice(0, 2) },
  choices: parsedOrders.map(order => ({ number: order.sourceOrderNumber, eligible: order.fulfillmentStatus !== 'fulfilled' })),
  reimports: [],
  barcodeConflicts: [conflict],
  catalog: { products: { [regularSku]: { status: 'matched', matches: [{ ...product }] } } },
  output: { ok: false, issues: [issue] },
  prepick: { ok: false, issues: [issue] },
  verification: { version: 'shopify-current-v2', mode: 'api', platform: 'Shopify',
   currentFingerprint: 'a'.repeat(64), shop: 'test.myshopify.com', orders },
  profileId: '2',
  sourceClassification: { fingerprint: 'b'.repeat(64) },
  settings: { store: '測試店', customerCode: '00001', warehouseCode: '003', batchSequence: '1', batchNumber: 'TEST-01',
   date: '2026-11-12', currency: 'TWD', taxConfirmed: true, taxMode: 'erp_inclusive', taxType: '11',
   skuMappings: { [regularSku]: mapped(regularSku), [accessorySku]: mapped(accessorySku) } },
 };
}

test('an active regular variant stays eligible beside an orphan SKU sibling and retains its whole CSV order', async () => {
 const conversion = fixture();
 const plan = await buildMarketplaceReadyScope(conversion);
 expect(plan).toEqual({ fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/), candidateNumbers: ['#ready'],
  heldOrders: [{ orderNumber: '#hold', reasons: [expect.stringContaining(regularSku)] }], excludedFulfilled: ['#fulfilled'] });
 const projected = await projectMarketplaceReadyRows(conversion, plan.fingerprint);
 expect(projected).toEqual({ rows: conversion.source.rows.slice(0, 3), readyScope: plan });
 expect(projected.rows[2]).not.toBe(conversion.source.rows[2]);
});

test.each([
 ['a mismatched live barcode', conversion => { conversion.verification.orders[0].items[0].barcode = 'other'; }],
 ['an unverified related line', conversion => { conversion.barcodeConflicts[0].relatedOrders[0].sourceVerified = false; }],
 ['a different live quantity', conversion => { conversion.verification.orders[0].items[0].quantity = 2; }],
 ['a duplicate related identity', conversion => { conversion.barcodeConflicts[0].relatedOrders.push(conversion.barcodeConflicts[0].relatedOrders[0]); }],
 ['an inactive catalog target', conversion => { conversion.catalog.products[regularSku].matches[0].active = false; }],
 ['an ambiguous catalog target', conversion => { conversion.catalog.products[regularSku].status = 'ambiguous'; }],
 ['a nonhistorical mapping conflict', conversion => { conversion.barcodeConflicts[0].reviewReason = 'BARCODE_MISMATCH'; }],
 ['a changed CSV identity', conversion => { conversion.source.rows[2][1] = '99'; }],
 ['an unknown global error', conversion => { conversion.output.issues.push({ severity: 'error', code: 'SETTING_REQUIRED', message: '缺少設定' }); }],
 ['a financial blocker on the otherwise eligible order', conversion => { conversion.output.issues.push({ severity: 'error', code: 'ORDER_TOTAL_MISMATCH', orderNumber: '#ready', message: '金額待核對' }); }],
])('never offers an order with %s', async (_name, change) => {
 const conversion = fixture();
 change(conversion);
 await expect(buildMarketplaceReadyScope(conversion)).resolves.toBeNull();
});

test('reuses canonical eligibility for an existing unworked draft while keeping already fulfilled orders out', async () => {
 const conversion = fixture();
 conversion.reimports = [{ orderNumber: '#ready', state: 'pending', intakeId: 4, workOrderId: null }];
 conversion.choices[0] = { number: '#ready', existing: true, eligible: false };
 conversion.parsed.orders.shift();
 await expect(buildMarketplaceReadyScope(conversion)).resolves.toMatchObject({ candidateNumbers: ['#ready'] });
 conversion.reimports[0].workOrderId = 16;
 await expect(buildMarketplaceReadyScope(conversion)).resolves.toBeNull();
});

test('an attested historical line is no longer held and the plan disappears when all remaining orders are eligible', async () => {
 const conversion = fixture();
 conversion.barcodeConflicts[0].relatedOrders[1].historicalLineConfirmed = true;
 await expect(buildMarketplaceReadyScope(conversion)).resolves.toBeNull();
});

test('an attested historical line in a saved draft stays in the original-batch review path', async () => {
 const conversion = fixture();
 conversion.barcodeConflicts = [];
 conversion.output.issues = [];
 conversion.prepick.issues = [];
 conversion.reimports.push({ orderNumber: '#hold', state: 'pending', intakeId: 2, workOrderId: null });
 const plan = await buildMarketplaceReadyScope(conversion);
 expect(plan).toMatchObject({ candidateNumbers: ['#ready'], heldOrders: [{
  orderNumber: '#hold', reasons: ['原訂單有缺少商城規格的品項，請開啟原批次核對'],
 }] });
});

test('the plan is invalidated by edits to the uploaded rows, live evidence or ownership', async () => {
 const before = await buildMarketplaceReadyScope(fixture());
 for (const change of [
  conversion => { conversion.source.rows[2][5] = '210'; },
  conversion => { conversion.verification.currentFingerprint = 'c'.repeat(64); },
  conversion => { conversion.sourceClassification.fingerprint = 'd'.repeat(64); },
 ]) {
  const conversion = fixture();
  change(conversion);
  await expect(projectMarketplaceReadyRows(conversion, before.fingerprint)).rejects.toMatchObject({ status: 409, code: 'MARKETPLACE_READY_SCOPE_CHANGED' });
 }
});

test('the regular order passes independent normal preparation from the projected CSV', async () => {
 const { source, settings, verification } = fixture();
 const profile = { id: 2, platform: 'Shopify', store: settings.store, settings };
 const pool = { query: jest.fn(async sql => ({ rows: sql.includes('marketplace_store_profiles') ? [profile] : [] })) };
 const verifyShopify = jest.fn(async rows => {
  const orders = verification.orders.filter(order => rows.slice(1).some(row => row[0] === order.number)).map(order => ({
   ...order, items: order.items.map(line => ({ ...line, name: '商品', unfulfilledQuantity: order.remainingQuantity ? line.quantity : 0 })),
  }));
  const records = orders.flatMap(order => order.items.map(line => ({
   Name: order.number, Id: order.id, 'Financial Status': 'paid', 'Fulfillment Status': order.fulfillmentStatus,
   Currency: 'TWD', Subtotal: String(order.currentQuantity * 200), Total: String(order.currentQuantity * 200),
   Shipping: '0', Taxes: '0', 'Discount Amount': '0', 'Refunded Amount': '0', 'Outstanding Balance': '0',
   'Lineitem id': line.id, 'Lineitem sku': line.sku, 'Lineitem name': '商品', 'Lineitem quantity': String(line.quantity),
   'Lineitem price': '200', 'Lineitem discount': '0',
  })));
  const headers = Object.keys(records[0]);
  return { verification: { ...verification, orders }, rows: [headers, ...records.map(record => headers.map(name => record[name]))] };
 });
 const prepare = createMarketplacePreparation({ pool, verifyShopify,
  classifyReimports: async () => ({ reimports: [], fingerprint: 'b'.repeat(64) }),
  resolveProducts: async skus => ({ sync: { product_count: skus.length }, products: Object.fromEntries(skus.map(sku => [sku, {
   status: 'matched', matches: [{ erp_sku: sku, barcode: sku, product_name: '商品', active: true }],
  }])) }),
 });
 const whole = await prepare({ rows: source.rows });
 expect(whole.output.ok).toBe(false);
 expect(whole.barcodeConflicts).toHaveLength(1);
 expect(whole.barcodeConflicts[0]).toMatchObject({ reviewReason: 'SOURCE_VARIANT_MISSING', requiresHistoricalLineAttestation: true });
 const scope = await buildMarketplaceReadyScope(whole);
 expect(scope).toMatchObject({ candidateNumbers: ['#ready'], excludedFulfilled: ['#fulfilled'] });
 const refreshed = await prepare({ rows: source.rows, profileId: whole.profileId, settings: whole.settings }, { refresh: true });
 expect(await buildMarketplaceReadyScope(refreshed)).toEqual(scope);
 const selected = await projectMarketplaceReadyRows(refreshed, scope.fingerprint);
 const subset = await prepare({ rows: selected.rows, profileId: whole.profileId, settings: whole.settings }, { refresh: true });
 expect(subset.output.ok).toBe(true);
 expect(subset.barcodeConflicts).toEqual([]);
 expect(subset.parsed.items.map(item => [item.sku, item.quantity])).toEqual([[regularSku, 1], [accessorySku, 2]]);
});
