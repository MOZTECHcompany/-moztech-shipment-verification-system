const { verifyShopifyRows } = require('../services/shopifyOrderVerification');

const shop = 'www-omfuture.myshopify.com';
const token = 'shipping-regression-test-token';
const sku = '4711299273094';
const bag = amount => ({ shopMoney: { amount: String(amount), currencyCode: 'TWD' } });
const table = records => {
  const headers = [...new Set(records.flatMap(Object.keys))];
  return [headers, ...records.map(record => headers.map(header => record[header] ?? ''))];
};
const objects = rows => rows.slice(1).map(row => Object.fromEntries(rows[0].map((header, index) => [header, row[index]])));
const shippingLine = (overrides = {}) => ({
  id: 'gid://shopify/ShippingLine/701', title: '超商取貨付款', isRemoved: false,
  originalPriceSet: bag('80.00'), currentDiscountedPriceSet: bag('0.00'), ...overrides,
});
const item = (overrides = {}) => ({
  id: 'gid://shopify/LineItem/801', name: '折扣核對商品', sku,
  quantity: 2, currentQuantity: 2, unfulfilledQuantity: 2, requiresShipping: true, taxable: true,
  originalUnitPriceSet: bag('690.00'), priceAfterAllDiscountsBeforeTaxesSet: bag('1369.00'),
  variant: { id: 'gid://shopify/ProductVariant/901', barcode: sku }, ...overrides,
});
// Monetary shape reported for #154328: merchandise 1380 -> 1369, shipping 80 -> 0.
const order = (overrides = {}) => ({
  id: 'gid://shopify/Order/7624215101596', name: '#154328',
  updatedAt: '2026-10-05T06:00:00Z', createdAt: '2026-10-05T03:00:00Z', edited: false, cancelledAt: null,
  currencyCode: 'TWD', presentmentCurrencyCode: 'TWD', taxesIncluded: false,
  displayFinancialStatus: 'PENDING', displayFulfillmentStatus: 'IN_PROGRESS',
  paymentGatewayNames: ['manual'], discountCodes: ['ORDER-DISCOUNT', 'FREE-SHIPPING'],
  currentSubtotalLineItemsQuantity: 2, currentSubtotalPriceSet: bag('1369.00'),
  currentShippingPriceSet: bag('0.00'), currentTotalDiscountsSet: bag('91.00'),
  currentTotalTaxSet: bag('0.00'), currentTotalPriceSet: bag('1369.00'),
  totalOutstandingSet: bag('1369.00'), totalReceivedSet: bag('0.00'), totalRefundedSet: bag('0.00'),
  currentTotalAdditionalFeesSet: null, currentTotalDutiesSet: null, totalTipReceivedSet: bag('0.00'),
  shippingAddress: null,
  shippingLines: { nodes: [shippingLine()], pageInfo: { hasNextPage: false } },
  lineItems: { nodes: [item()], pageInfo: { hasNextPage: false } }, ...overrides,
});
const source = (current = order()) => ({
  Name: current.name, Id: current.id.split('/').pop(),
  'Financial Status': 'pending', 'Fulfillment Status': 'unfulfilled', Currency: 'TWD',
  Subtotal: '1369.00', Shipping: '80.00', Taxes: '0.00', Total: '1369.00',
  'Discount Amount': '91.00', 'Refunded Amount': '0.00', 'Outstanding Balance': '1369.00',
  'Payment Method': 'custom', 'Shipping Method': '超商取貨付款',
  'Lineitem sku': sku, 'Lineitem name': 'CSV 商品', 'Lineitem quantity': 2,
  'Lineitem price': '690.00', 'Lineitem discount': '11.00',
});
const response = current => ({
  ok: true, status: 200, headers: { get: () => null },
  text: async () => JSON.stringify({ data: { shop: { myshopifyDomain: shop }, order: current } }),
});
const run = (current = order(), options = {}) => verifyShopifyRows(table([source(current)]), {
  shop, token, fetchImpl: jest.fn(async () => response(current)), ...options,
});
const exportSettings = {
  store: '墨子科技 官網', customerCode: '00063', customerName: '墨子科技 官網',
  warehouseCode: '003', date: '2026-10-05', batchSequence: '1', batchNumber: 'TEST-SHIP-DISCOUNT',
  currency: 'TWD', taxMode: 'erp_inclusive', taxType: '11', taxConfirmed: true,
  salesExportMode: 'product-200-v1',
  skuMappings: { [sku]: { erpSku: sku, erpName: 'ERP 商品', barcode: sku, confirmed: true, barcodeConfirmed: true } },
  shippingSku: { erpSku: '00001', name: '運費', confirmed: true, nonStock: true },
};

test('#154328 keeps product discount 11 and free shipping 80 separate without applying either twice', async () => {
  const fetchImpl = jest.fn(async () => response(order()));
  const result = await run(order(), { fetchImpl });
  expect(objects(result.rows)).toEqual([expect.objectContaining({
    Name: '#154328', 'Lineitem quantity': 2, 'Lineitem price': '690.00', 'Lineitem discount': '11.00',
    Subtotal: '1369.00', Shipping: '0.00', 'Discount Amount': '11.00', Total: '1369.00',
    'Outstanding Balance': '1369.00', 'Financial Status': 'pending', 'Fulfillment Status': 'unfulfilled',
  })]);
  expect(result.verification.orders[0]).toMatchObject({
    subtotalMinor: 136900, shippingMinor: 0, totalMinor: 136900, discountMinor: 9100,
    productDiscountMinor: 1100, shippingGrossMinor: 8000, shippingDiscountMinor: 8000,
    currentQuantity: 2, remainingQuantity: 2,
    shippingLines: [{ id: 'gid://shopify/ShippingLine/701', removed: false, title: '超商取貨付款', originalMinor: 8000, currentMinor: 0 }],
  });
  const query = JSON.parse(fetchImpl.mock.calls[0][1].body).query;
  expect(query).toMatch(/shippingLines\s*\([^)]*\)\s*\{\s*nodes\s*\{/);
  expect(query).toMatch(/isRemoved/);
  expect(query).toMatch(/originalPriceSet/);
  expect(query).toMatch(/currentDiscountedPriceSet/);
  expect(JSON.stringify(result.verification)).not.toContain(token);

  const { parseUnifiedMarketplace, prepareUnifiedMarketplace } = await import('../services/unifiedMarketplace.mjs');
  const { buildEcountUploadTable } = await import('../services/marketplaceIntake.mjs');
  const prepared = prepareUnifiedMarketplace(parseUnifiedMarketplace(result.rows).parsed, exportSettings);
  expect(prepared.output.ok).toBe(true);
  expect(prepared.parsed.issues.filter(issue => issue.severity === 'error')).toEqual([]);
  expect(prepared.parsed.items[0]).toMatchObject({ quantity: 2, lineSubtotalMinor: 136900 });
  expect(prepared.output.summary).toMatchObject({ physicalQuantity: 2, ecountTotalMinor: 136900 });
  expect(prepared.output.salesLayout.lines).toEqual([expect.objectContaining({ productCode: sku, physical: true, quantity: 2, grossMinor: 136900 })]);
  const uploaded = buildEcountUploadTable({ ...prepared.output, settings: exportSettings, items: prepared.parsed.items, orders: prepared.parsed.orders });
  const row = Object.fromEntries(uploaded.headers.map((header, index) => [header, uploaded.rows[0][index]]));
  expect(uploaded.rows).toHaveLength(1);
  expect(row).toMatchObject({ 品項編碼: sku, 數量: 2, '單價(含稅)': 684.5, 稅前價格: 1304, 營業稅: 65 });
  expect(uploaded.financials.grossMinor).toBe(136900);
});

test('shipping-only discount preserves full merchandise price and only records the discounted shipping receipt', async () => {
  const current = order({ currentSubtotalPriceSet: bag('1380.00'), currentTotalDiscountsSet: bag('80.00'),
    currentTotalPriceSet: bag('1380.00'), totalOutstandingSet: bag('1380.00'),
    lineItems: { nodes: [item({ priceAfterAllDiscountsBeforeTaxesSet: bag('1380.00') })], pageInfo: { hasNextPage: false } } });
  const result = await run(current);
  expect(objects(result.rows)[0]).toMatchObject({ 'Lineitem discount': '0.00', 'Discount Amount': '0.00', Shipping: '0.00', Subtotal: '1380.00', Total: '1380.00' });
  expect(result.verification.orders[0]).toMatchObject({ discountMinor: 8000, productDiscountMinor: 0, shippingGrossMinor: 8000, shippingDiscountMinor: 8000 });
});

test('partial shipping discount exports net shipping and reconciles the unchanged complete receipt', async () => {
  const current = order({ currentShippingPriceSet: bag('30.00'), currentTotalDiscountsSet: bag('61.00'),
    currentTotalPriceSet: bag('1399.00'), totalOutstandingSet: bag('1399.00'),
    shippingLines: { nodes: [shippingLine({ currentDiscountedPriceSet: bag('30.00') })], pageInfo: { hasNextPage: false } } });
  const result = await run(current);
  expect(objects(result.rows)[0]).toMatchObject({ Shipping: '30.00', 'Discount Amount': '11.00', Total: '1399.00' });
  expect(result.verification.orders[0]).toMatchObject({ shippingMinor: 3000, shippingGrossMinor: 8000, shippingDiscountMinor: 5000, productDiscountMinor: 1100, discountMinor: 6100 });
  const { parseUnifiedMarketplace, prepareUnifiedMarketplace } = await import('../services/unifiedMarketplace.mjs');
  const prepared = prepareUnifiedMarketplace(parseUnifiedMarketplace(result.rows).parsed, exportSettings);
  expect(prepared.output.ok).toBe(true);
  expect(prepared.output.summary).toMatchObject({ physicalQuantity: 2, ecountTotalMinor: 139900 });
  expect(prepared.output.salesLayout.lines).toHaveLength(2);
  expect(prepared.output.salesLayout.lines.find(line => !line.physical)).toMatchObject({ productCode: '00001', quantity: 1, grossMinor: 3000 });
  expect(prepared.output.salesLayout.lines.reduce((sum, line) => sum + line.netMinor + line.taxMinor, 0)).toBe(139900);
});

test('removed shipping lines stay visible in evidence but never increase current shipping or its discounts', async () => {
  const current = order({ shippingLines: { nodes: [
    shippingLine({ id: 'gid://shopify/ShippingLine/700', isRemoved: true, originalPriceSet: bag('100.00'), currentDiscountedPriceSet: bag('100.00') }),
    shippingLine(),
  ], pageInfo: { hasNextPage: false } } });
  const result = await run(current);
  expect(result.verification.orders[0]).toMatchObject({ shippingMinor: 0, shippingGrossMinor: 8000, shippingDiscountMinor: 8000, discountMinor: 9100 });
  expect(result.verification.orders[0].shippingLines).toHaveLength(2);
  expect(result.verification.orders[0].shippingLines.find(line => line.id.endsWith('/700'))).toMatchObject({ removed: true, originalMinor: 10000, currentMinor: 10000 });
});

test('multiple active shipping lines reconcile their own original and current prices exactly', async () => {
  const current = order({ currentShippingPriceSet: bag('30.00'), currentTotalDiscountsSet: bag('61.00'),
    currentTotalPriceSet: bag('1399.00'), totalOutstandingSet: bag('1399.00'),
    shippingLines: { nodes: [
      shippingLine({ originalPriceSet: bag('40.00'), currentDiscountedPriceSet: bag('20.00') }),
      shippingLine({ id: 'gid://shopify/ShippingLine/702', originalPriceSet: bag('40.00'), currentDiscountedPriceSet: bag('10.00') }),
    ], pageInfo: { hasNextPage: false } } });
  const result = await run(current);
  expect(result.verification.orders[0]).toMatchObject({ shippingMinor: 3000, shippingGrossMinor: 8000, shippingDiscountMinor: 5000, discountMinor: 6100 });
});

test('fractional discounts are checked in exact hundredths and whole-TWD ERP allocation preserves the receipt', async () => {
  const current = order({ currentSubtotalPriceSet: bag('1369.25'), currentShippingPriceSet: bag('30.75'),
    currentTotalDiscountsSet: bag('60.75'), currentTotalPriceSet: bag('1400.00'), totalOutstandingSet: bag('1400.00'),
    lineItems: { nodes: [item({ priceAfterAllDiscountsBeforeTaxesSet: bag('1369.25') })], pageInfo: { hasNextPage: false } },
    shippingLines: { nodes: [shippingLine({ originalPriceSet: bag('80.75'), currentDiscountedPriceSet: bag('30.75') })], pageInfo: { hasNextPage: false } } });
  const result = await run(current);
  expect(objects(result.rows)[0]).toMatchObject({ Subtotal: '1369.25', Shipping: '30.75', 'Lineitem discount': '10.75', 'Discount Amount': '10.75', Total: '1400.00' });
  expect(result.verification.orders[0]).toMatchObject({ productDiscountMinor: 1075, shippingGrossMinor: 8075, shippingDiscountMinor: 5000, discountMinor: 6075 });
  const { parseUnifiedMarketplace, prepareUnifiedMarketplace } = await import('../services/unifiedMarketplace.mjs');
  const prepared = prepareUnifiedMarketplace(parseUnifiedMarketplace(result.rows).parsed, exportSettings);
  expect(prepared.output.ok).toBe(true);
  expect(prepared.output.summary.ecountTotalMinor).toBe(140000);
  expect(prepared.output.salesLayout.lines.find(line => line.physical).grossMinor).toBe(136900);
  expect(prepared.output.salesLayout.lines.find(line => !line.physical).grossMinor).toBe(3100);
  expect(prepared.output.salesLayout.lines.every(line => line.netMinor % 100 === 0 && line.taxMinor % 100 === 0)).toBe(true);
});

test('edited-away merchandise is excluded from discounts and shipment quantity while current shipping is retained', async () => {
  const current = order({ edited: true, lineItems: { nodes: [
    item({ id: 'gid://shopify/LineItem/800', quantity: 1, currentQuantity: 0, unfulfilledQuantity: 0, originalUnitPriceSet: bag('999.00'), priceAfterAllDiscountsBeforeTaxesSet: bag('0.00') }),
    item({ quantity: 3 }),
  ], pageInfo: { hasNextPage: false } } });
  const result = await run(current);
  expect(objects(result.rows)).toHaveLength(1);
  expect(objects(result.rows)[0]).toMatchObject({ 'Lineitem quantity': 2, 'Lineitem discount': '11.00', Total: '1369.00' });
  expect(result.verification.orders[0]).toMatchObject({ currentQuantity: 2, discountMinor: 9100, removedLineIds: ['gid://shopify/LineItem/800'] });
});

test.each([
  ['shipping total disagrees with active shipping lines', current => ({ ...current, shippingLines: { nodes: [shippingLine({ currentDiscountedPriceSet: bag('1.00') })], pageInfo: { hasNextPage: false } } })],
  ['shipping net exceeds its original price', current => ({ ...current, shippingLines: { nodes: [shippingLine({ originalPriceSet: bag('0.00'), currentDiscountedPriceSet: bag('1.00') })], pageInfo: { hasNextPage: false } } })],
  ['aggregate discount is one cent larger than evidenced discounts', current => ({ ...current, currentTotalDiscountsSet: bag('91.01') })],
  ['shipping pages are incomplete', current => ({ ...current, shippingLines: { ...current.shippingLines, pageInfo: { hasNextPage: true } } })],
  ['shipping nodes are missing', current => ({ ...current, shippingLines: { pageInfo: { hasNextPage: false } } })],
  ['shipping page completeness is missing', current => ({ ...current, shippingLines: { nodes: current.shippingLines.nodes } })],
  ['shipping line identity is invalid', current => ({ ...current, shippingLines: { nodes: [shippingLine({ id: 'gid://shopify/LineItem/701' })], pageInfo: { hasNextPage: false } } })],
  ['shipping removal state is unknown', current => ({ ...current, shippingLines: { nodes: [shippingLine({ isRemoved: undefined })], pageInfo: { hasNextPage: false } } })],
  ['duplicate shipping identities', current => ({ ...current, shippingLines: { nodes: [shippingLine(), shippingLine()], pageInfo: { hasNextPage: false } } })],
])('%s is blocked rather than falling back to historical CSV totals', async (label, mutate) => {
  await expect(run(mutate(order()))).rejects.toBeInstanceOf(Error);
});

test('changing shipping evidence between line-item pages is rejected even when order totals and updatedAt match', async () => {
  const current = order();
  const page1 = { ...current, lineItems: { nodes: current.lineItems.nodes, pageInfo: { hasNextPage: true, endCursor: 'ITEM-CURSOR' } } };
  const page2 = { ...current,
    shippingLines: { nodes: [shippingLine({ originalPriceSet: bag('90.00') })], pageInfo: { hasNextPage: false } },
    lineItems: { nodes: [], pageInfo: { hasNextPage: false } },
  };
  const fetchImpl = jest.fn().mockResolvedValueOnce(response(page1)).mockResolvedValueOnce(response(page2));
  await expect(run(current, { fetchImpl })).rejects.toMatchObject({ code: 'SHOPIFY_ORDER_CHANGED' });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

test('shipping evidence affects the saved fingerprint even when the current receipt is unchanged', async () => {
  const original = await run();
  const changed = await run(order({ currentTotalDiscountsSet: bag('101.00'),
    shippingLines: { nodes: [shippingLine({ originalPriceSet: bag('90.00') })], pageInfo: { hasNextPage: false } } }));
  expect(changed.verification.orders[0]).toMatchObject({ totalMinor: 136900, shippingGrossMinor: 9000, shippingDiscountMinor: 9000 });
  expect(changed.verification.fingerprint).not.toBe(original.verification.fingerprint);
});

const cancelledOrder = (overrides = {}) => order({
  id: 'gid://shopify/Order/7633826021532', name: '#154376', edited: false,
  updatedAt: '2026-10-05T05:27:23Z', cancelledAt: '2026-10-05T05:27:23Z',
  displayFinancialStatus: 'VOIDED', displayFulfillmentStatus: 'UNFULFILLED',
  currentSubtotalLineItemsQuantity: 0, currentSubtotalPriceSet: bag('0.0'), currentShippingPriceSet: bag('0.0'),
  currentTotalDiscountsSet: bag('0.0'), currentTotalPriceSet: bag('0.0'), totalOutstandingSet: bag('0.0'),
  totalReceivedSet: bag('0.0'), totalRefundedSet: bag('0.0'),
  shippingLines: { nodes: [shippingLine({ id: 'gid://shopify/ShippingLine/5814730260636',
    title: '超商取貨', isRemoved: false, originalPriceSet: bag('80.0'), currentDiscountedPriceSet: bag('0.0'),
  })], pageInfo: { hasNextPage: false } },
  lineItems: { nodes: [item({ id: 'gid://shopify/LineItem/16511107924124',
    name: 'MOZTECH® 萬能充MAX 多功能行動電源 - DNC 60W 二合一充電線(1C1L黑)', sku: '4711299274282',
    quantity: 1, currentQuantity: 0, unfulfilledQuantity: 0,
    originalUnitPriceSet: bag('299.0'), priceAfterAllDiscountsBeforeTaxesSet: bag('0.0'),
    variant: { id: 'gid://shopify/ProductVariant/45325805453468', barcode: '4711299274282' },
  })], pageInfo: { hasNextPage: false } }, ...overrides,
});

test('#154376 cancelled to zero records shipping cancellation rather than inventing an 80-dollar discount or reviving CSV merchandise', async () => {
  const current = cancelledOrder();
  const historicalRows = table([{ ...source(current),
    Subtotal: '299.00', Shipping: '80.00', Total: '379.00', 'Discount Amount': '0.00', 'Outstanding Balance': '379.00',
    'Lineitem sku': '4711299274282', 'Lineitem quantity': 1, 'Lineitem price': '299.00', 'Lineitem discount': '0.00',
  }]);
  const result = await verifyShopifyRows(historicalRows, { shop, token, fetchImpl: jest.fn(async () => response(current)) });
  expect(objects(result.rows)).toEqual([]);
  expect(result.verification.orders).toHaveLength(1);
  expect(result.verification.orders[0]).toMatchObject({
    number: '#154376', cancelled: true, paymentStatus: 'voided', currentQuantity: 0, remainingQuantity: 0,
    subtotalMinor: 0, shippingMinor: 0, totalMinor: 0, discountMinor: 0, productDiscountMinor: 0,
    shippingGrossMinor: 8000, shippingDiscountMinor: 0, shippingCancellationMinor: 8000,
    outstandingMinor: 0, receivedMinor: 0, items: [], removedLineIds: ['gid://shopify/LineItem/16511107924124'],
    shippingLines: [{ id: 'gid://shopify/ShippingLine/5814730260636', removed: false, originalMinor: 8000, currentMinor: 0 }],
  });
  expect(result.verification.orders[0].shippingGrossMinor).toBe(
    result.verification.orders[0].shippingMinor + result.verification.orders[0].shippingDiscountMinor + result.verification.orders[0].shippingCancellationMinor,
  );
});

test('an uncancelled zero-value order cannot claim a shipping cancellation to bypass an unevidenced discount', async () => {
  await expect(run(cancelledOrder({ cancelledAt: null }))).rejects.toMatchObject({ code: 'SHOPIFY_DISCOUNT_REVIEW_REQUIRED' });
});

test('a cancelled order that retains merchandise still needs its actual shipping discount to reconcile', async () => {
  await expect(run(order({ cancelledAt: '2026-10-05T05:27:23Z', currentTotalDiscountsSet: bag('11.00') })))
    .rejects.toMatchObject({ code: 'SHOPIFY_DISCOUNT_REVIEW_REQUIRED' });
});

test('#154333 custom product text and a historical CSV SKU cannot replace a missing current Shopify SKU', async () => {
  const current = order({ name: '#154333',
    lineItems: { nodes: [item({ sku: null, variant: null,
      name: `訂單修改商品 ${sku}：文字中的貨號不是 Shopify 商品設定`,
    })], pageInfo: { hasNextPage: false } },
  });
  const fetchImpl = jest.fn(async () => response(current));
  await expect(run(current, { fetchImpl })).rejects.toMatchObject({ code: 'SHOPIFY_SKU_INVALID', orderNumber: '#154333' });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
