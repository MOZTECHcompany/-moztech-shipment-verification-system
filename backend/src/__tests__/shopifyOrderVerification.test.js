const { verifyShopifyRows, createShopifyOrderVerifier } = require('../services/shopifyOrderVerification');

const shop = 'www-omfuture.myshopify.com';
const token = 'test-secret-never-in-evidence';
const bag = amount => ({ shopMoney: { amount: String(amount), currencyCode: 'TWD' } });
const table = records => {
  const headers = [...new Set(records.flatMap(Object.keys))];
  return [headers, ...records.map(record => headers.map(key => record[key] ?? ''))];
};
const objects = rows => rows.slice(1).map(row => Object.fromEntries(rows[0].map((key, i) => [key, row[i]])));
const source = (overrides = {}) => ({ Name: '#154230', Id: '7624215101596', 'Financial Status': 'pending', 'Fulfillment Status': 'unfulfilled', Currency: 'TWD', Subtotal: '1880.00', Shipping: '0.00', Taxes: '0.00', Total: '1880.00', 'Discount Amount': '0.00', 'Refunded Amount': '0.00', 'Outstanding Balance': '1880.00', 'Payment Method': 'custom', 'Shipping Method': '超商取貨', 'Shipping Name': 'CSV receiver', 'Shipping Phone': 'CSV phone', 'Shipping Address1': 'CSV address', 'Shipping Address2': 'CSV address 2', 'Lineitem sku': '4711299274749', 'Lineitem name': 'Removed product', 'Lineitem quantity': 1, 'Lineitem price': '990.00', 'Lineitem discount': '0.00', ...overrides });
const editedRows = () => table([source(), source({ Id: '', 'Outstanding Balance': '', 'Lineitem sku': '4711299272493', 'Lineitem name': 'Current product', 'Lineitem price': '890.00' })]);
const item = (overrides = {}) => ({ id: 'gid://shopify/LineItem/16493014253724', name: 'Current product', sku: '4711299272493', quantity: 1, currentQuantity: 1, unfulfilledQuantity: 1, requiresShipping: true, taxable: true, originalUnitPriceSet: bag('890.00'), priceAfterAllDiscountsBeforeTaxesSet: bag('890.00'), variant: { id: 'gid://shopify/ProductVariant/123', barcode: '4711299272493' }, ...overrides });
const order = (overrides = {}) => ({ id: 'gid://shopify/Order/7624215101596', name: '#154230', updatedAt: '2026-10-01T09:00:00Z', createdAt: '2026-09-30T02:00:00Z', edited: true, cancelledAt: null, currencyCode: 'TWD', presentmentCurrencyCode: 'TWD', taxesIncluded: false, displayFinancialStatus: 'PENDING', displayFulfillmentStatus: 'UNFULFILLED', paymentGatewayNames: ['manual'], discountCodes: [], currentSubtotalLineItemsQuantity: 1, currentSubtotalPriceSet: bag('890.00'), currentShippingPriceSet: bag('0.00'), currentTotalDiscountsSet: bag('0.00'), currentTotalTaxSet: bag('0.00'), currentTotalPriceSet: bag('890.00'), totalOutstandingSet: bag('890.00'), totalReceivedSet: bag('0.00'), totalRefundedSet: bag('0.00'), currentTotalAdditionalFeesSet: null, currentTotalDutiesSet: null, totalTipReceivedSet: bag('0.00'), shippingAddress: null, shippingLines: { nodes: [{ title: '超商取貨' }], pageInfo: { hasNextPage: false } }, lineItems: { nodes: [item({ id: 'gid://shopify/LineItem/16493009993884', sku: '4711299274749', name: 'Removed product', currentQuantity: 0, unfulfilledQuantity: 0, originalUnitPriceSet: bag('990.00'), priceAfterAllDiscountsBeforeTaxesSet: bag('0.00') }), item()], pageInfo: { hasNextPage: false, endCursor: 'END' } }, ...overrides });
const response = (current, responseShop = shop) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: { shop: { myshopifyDomain: responseShop }, order: current } }) });
const run = (rows = editedRows(), current = order(), options = {}) => verifyShopifyRows(rows, { shop, token, fetchImpl: jest.fn(async () => response(current)), ...options });

test('currentQuantity removes edited-away product; current money and exact platform line ID replace historical CSV', async () => {
  const original = editedRows(), before = JSON.stringify(original), fetchImpl = jest.fn(async () => response(order()));
  const result = await run(original, order(), { fetchImpl });
  expect(objects(result.rows)).toHaveLength(1);
  expect(objects(result.rows)[0]).toMatchObject({ Name: '#154230', 'Lineitem sku': '4711299272493', 'Lineitem quantity': 1, Total: '890.00', Subtotal: '890.00', 'Outstanding Balance': '890.00', 'Payment Method': 'custom', 'Lineitem id': 'gid://shopify/LineItem/16493014253724', 'Shipping Name': 'CSV receiver', 'Shipping Phone': 'CSV phone', 'Shipping Address1': 'CSV address' });
  expect(result.verification.orders[0]).toMatchObject({ edited: true, currentQuantity: 1, remainingQuantity: 1, totalMinor: 89000, outstandingMinor: 89000, receivedMinor: 0, removedLineIds: ['gid://shopify/LineItem/16493009993884'] });
  expect(JSON.stringify(result.verification)).not.toMatch(/CSV receiver|CSV phone|CSV address|test-secret/);
  expect(JSON.stringify(original)).toBe(before);
  const [url, request] = fetchImpl.mock.calls[0];
  expect(url).toBe(`https://${shop}/admin/api/2026-07/graphql.json`);
  expect(request).toMatchObject({ method: 'POST', redirect: 'error', headers: { 'X-Shopify-Access-Token': token } });
  expect(JSON.parse(request.body).variables).toEqual({ id: 'gid://shopify/Order/7624215101596', after: null });
  expect(JSON.parse(request.body).query).toMatch(/^query WmsCurrentOrder/);
  expect(JSON.parse(request.body).query).toMatch(/variant\s*\{\s*id\s+barcode\s*\}/);
  expect(result.verification.orders[0].items[0]).toMatchObject({variantId:'gid://shopify/ProductVariant/123',barcode:'4711299272493',barcodeSource:'shopify-variant'});
  expect(JSON.parse(request.body).query).not.toMatch(/mutation|discountedTotalSet|discountAllocations/);
});

test('blank continuation balance never chooses last row; two current duplicate SKUs keep two distinct line IDs', async () => {
  const current = order({ edited: false, currentSubtotalLineItemsQuantity: 2, currentSubtotalPriceSet: bag('1380.00'), currentTotalDiscountsSet: bag('200.00'), currentTotalPriceSet: bag('1380.00'), totalOutstandingSet: bag('1380.00'), displayFulfillmentStatus: 'FULFILLED', lineItems: { nodes: [item({ id: 'gid://shopify/LineItem/11', sku: '4711299274640', originalUnitPriceSet: bag('790.00'), priceAfterAllDiscountsBeforeTaxesSet: bag('690.00'), unfulfilledQuantity: 0 }), item({ id: 'gid://shopify/LineItem/12', sku: '4711299274640', originalUnitPriceSet: bag('790.00'), priceAfterAllDiscountsBeforeTaxesSet: bag('690.00'), unfulfilledQuantity: 0 })], pageInfo: { hasNextPage: false } } });
  const rows = table([source({ 'Lineitem sku': '4711299274640' }), source({ Id: '', 'Outstanding Balance': '', 'Lineitem sku': '4711299274640' })]);
  const result = await run(rows, current);
  expect(objects(result.rows)).toHaveLength(2);
  expect(objects(result.rows).map(row => row['Lineitem id'])).toEqual(['gid://shopify/LineItem/11', 'gid://shopify/LineItem/12']);
  expect(objects(result.rows).every(row => row['Fulfillment Status'] === 'fulfilled' && row['Lineitem fulfillment status'] === 'fulfilled' && row.Total === '1380.00' && row['Outstanding Balance'] === '1380.00')).toBe(true);
  expect(result.verification.orders[0].remainingQuantity).toBe(0);
});

test('paid fulfilled edited order stays fulfilled, with actual received and outstanding stored separately', async () => {
  const current = order({ displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED', totalOutstandingSet: bag('0.00'), totalReceivedSet: bag('890.00'), lineItems: { nodes: [item({ currentQuantity: 0, unfulfilledQuantity: 0, id: 'gid://shopify/LineItem/1', sku: '4711299274725' }), item({ unfulfilledQuantity: 0, sku: '4711299274718' })], pageInfo: { hasNextPage: false } } });
  const result = await run(editedRows(), current);
  expect(objects(result.rows)[0]).toMatchObject({ 'Lineitem sku': '4711299274718', 'Fulfillment Status': 'fulfilled', 'Financial Status': 'paid', 'Outstanding Balance': '0.00', Total: '890.00' });
  expect(result.verification.orders[0]).toMatchObject({ remainingQuantity: 0, receivedMinor: 89000, outstandingMinor: 0 });
});

test.each(['IN_PROGRESS', 'OPEN', 'PENDING_FULFILLMENT'])('%s with every item unfulfilled remains eligible without restoring edited quantity or changing money', async sourceFulfillmentStatus => {
  const current = order({ displayFinancialStatus: 'PAID', displayFulfillmentStatus: sourceFulfillmentStatus,
    currentSubtotalLineItemsQuantity: 2, currentSubtotalPriceSet: bag('1780.00'), currentTotalPriceSet: bag('1780.00'), totalOutstandingSet: bag('0.00'), totalReceivedSet: bag('1780.00'),
    lineItems: { nodes: [item({ id: 'gid://shopify/LineItem/1', currentQuantity: 0, unfulfilledQuantity: 0, originalUnitPriceSet: bag('990.00'), priceAfterAllDiscountsBeforeTaxesSet: bag('0.00') }), item({ quantity: 3, currentQuantity: 2, unfulfilledQuantity: 2, priceAfterAllDiscountsBeforeTaxesSet: bag('1780.00') })], pageInfo: { hasNextPage: false } } });
  const result = await run(editedRows(), current);
  expect(objects(result.rows)).toHaveLength(1);
  expect(objects(result.rows)[0]).toMatchObject({ 'Fulfillment Status': 'unfulfilled', 'Financial Status': 'paid', 'Lineitem quantity': 2, 'Lineitem fulfillment status': 'pending', Subtotal: '1780.00', Total: '1780.00', 'Outstanding Balance': '0.00' });
  expect(result.verification.orders[0]).toMatchObject({ sourceFulfillmentStatus, fulfillmentStatus: 'unfulfilled', currentQuantity: 2, remainingQuantity: 2, totalMinor: 178000, receivedMinor: 178000, outstandingMinor: 0, removedLineIds: ['gid://shopify/LineItem/1'] });
  const { parseUnifiedMarketplace, prepareUnifiedMarketplace } = await import('../services/unifiedMarketplace.mjs');
  expect(prepareUnifiedMarketplace(parseUnifiedMarketplace(result.rows).parsed).choices).toEqual([{ number: '#154230', eligible: true, reason: '已付款／未出貨' }]);
});

test.each(['IN_PROGRESS', 'OPEN', 'PENDING_FULFILLMENT'])('%s cannot export a whole order after any quantity has been fulfilled', async displayFulfillmentStatus => {
  await expect(run(editedRows(), order({ displayFulfillmentStatus, currentSubtotalLineItemsQuantity: 2,
    lineItems: { nodes: [item({ quantity: 2, currentQuantity: 2, unfulfilledQuantity: 1 })], pageInfo: { hasNextPage: false } } }))).rejects.toMatchObject({ code: 'SHOPIFY_FULFILLMENT_REVIEW_REQUIRED' });
  await expect(run(editedRows(), order({ displayFulfillmentStatus,
    lineItems: { nodes: [item({ unfulfilledQuantity: 0 })], pageInfo: { hasNextPage: false } } }))).rejects.toMatchObject({ code: 'SHOPIFY_FULFILLMENT_REVIEW_REQUIRED' });
});

test('processing status keeps COD pending separate from unpaid bank transfer eligibility', async () => {
  const { parseUnifiedMarketplace, prepareUnifiedMarketplace } = await import('../services/unifiedMarketplace.mjs');
  const current = order({ displayFulfillmentStatus: 'IN_PROGRESS' });
  const cod = await run(editedRows(), current);
  expect(objects(cod.rows)[0]).toMatchObject({ 'Financial Status': 'pending', 'Payment Method': 'custom', 'Outstanding Balance': '890.00' });
  expect(cod.verification.orders[0]).toMatchObject({ paymentStatus: 'pending', outstandingMinor: 89000, receivedMinor: 0 });
  expect(prepareUnifiedMarketplace(parseUnifiedMarketplace(cod.rows).parsed).choices[0]).toMatchObject({ eligible: true, reason: '貨到付款／未出貨' });
  const bank = await run(table([source({ 'Payment Method': 'Bank Transfer' })]), { ...current, paymentGatewayNames: ['Bank Transfer'] });
  expect(prepareUnifiedMarketplace(parseUnifiedMarketplace(bank.rows).parsed).choices[0]).toMatchObject({ eligible: false, reason: '未付款，且不是已辨識的貨到付款' });
});

test.each(['ON_HOLD', 'SCHEDULED', 'REQUEST_DECLINED', 'PARTIALLY_FULFILLED'])('%s is not released by the processing-status normalization', async displayFulfillmentStatus => {
  await expect(run(editedRows(), order({ displayFulfillmentStatus }))).rejects.toMatchObject({ code: 'SHOPIFY_FULFILLMENT_REVIEW_REQUIRED' });
});

test('cancelled order with zero current quantities retains exclusion evidence without restoring CSV products or money', async () => {
  const current = order({ cancelledAt: '2026-10-01T10:18:37Z', updatedAt: '2026-10-01T10:18:37Z', displayFinancialStatus: 'VOIDED', currentSubtotalLineItemsQuantity: 0, currentSubtotalPriceSet: bag('0.00'), currentTotalPriceSet: bag('0.00'), totalOutstandingSet: bag('0.00') });
  for (const line of current.lineItems.nodes) { line.currentQuantity = 0; line.unfulfilledQuantity = 0; line.priceAfterAllDiscountsBeforeTaxesSet = bag('0.00'); }
  const result = await run(editedRows(), current);
  expect(objects(result.rows)).toEqual([]);
  expect(result.verification.orders).toHaveLength(1);
  expect(result.verification.orders[0]).toMatchObject({ number: '#154230', cancelled: true, cancelledAt: '2026-10-01T10:18:37Z', paymentStatus: 'voided', fulfillmentStatus: 'unfulfilled', currentQuantity: 0, remainingQuantity: 0, subtotalMinor: 0, shippingMinor: 0, totalMinor: 0, outstandingMinor: 0, receivedMinor: 0, items: [] });
  expect(result.verification.orders[0].removedLineIds).toHaveLength(2);
  const second = await run(editedRows(), current);
  expect(second.verification.fingerprint).toBe(result.verification.fingerprint);
  expect(JSON.stringify(result.verification)).not.toMatch(/CSV receiver|CSV phone|CSV address|test-secret/);
});

test('current shipping recipient/address replaces historical CSV, including cleared second address; evidence contains no PII', async () => {
  const current = order({ shippingAddress: { name: 'API receiver', phone: 'API phone', address1: 'API address', address2: '', city: 'API city', zip: '00123', province: 'API province', provinceCode: 'API-P', country: 'Taiwan', countryCodeV2: 'TW', company: null }, shippingLines: { nodes: [{ title: '宅配(新竹物流)' }], pageInfo: { hasNextPage: false } } });
  const result = await run(editedRows(), current);
  expect(objects(result.rows)[0]).toMatchObject({ 'Shipping Name': 'API receiver', 'Shipping Phone': 'API phone', 'Shipping Address1': 'API address', 'Shipping Address2': '', 'Shipping City': 'API city', 'Shipping Zip': '00123', 'Shipping Province': 'API-P', 'Shipping Country': 'TW', 'Shipping Street': 'API address', 'Shipping Method': '宅配(新竹物流)' });
  expect(JSON.stringify(result.verification)).not.toMatch(/API receiver|API phone|API address|API city/);
  expect(result.verification.orders[0].shippingSource).toBe('shopify-current');
  const changed = await run(editedRows(), { ...current, shippingAddress: { ...current.shippingAddress, address1: 'Changed address' } });
  expect(changed.verification.fingerprint).not.toBe(result.verification.fingerprint);
});

test('current item price and quantity reductions reconcile exact product discount and preserve leading zero SKU', async () => {
  const current = order({ currentSubtotalPriceSet: bag('160.01'), currentTotalDiscountsSet: bag('39.99'), currentTotalPriceSet: bag('160.01'), totalOutstandingSet: bag('160.01'), currentSubtotalLineItemsQuantity: 2, lineItems: { nodes: [item({ sku: 'NEW0001232', quantity: 3, currentQuantity: 2, unfulfilledQuantity: 2, originalUnitPriceSet: bag('100.00'), priceAfterAllDiscountsBeforeTaxesSet: bag('160.01'), variant: null })], pageInfo: { hasNextPage: false } } });
  const result = await run(editedRows(), current);
  expect(objects(result.rows)[0]).toMatchObject({ 'Lineitem sku': 'NEW0001232', 'Lineitem quantity': 2, 'Lineitem price': '100.00', 'Lineitem discount': '39.99', 'Discount Amount': '39.99', Total: '160.01' });
  expect(result.verification.orders[0].items[0]).not.toHaveProperty('barcode');
  expect(result.verification.orders[0].items[0]).not.toHaveProperty('variantId');
});

test('current variant evidence preserves the full NEW barcode and variant identity', async () => {
  const current = order({ lineItems:{nodes:[item({sku:'4711299270086',name:'無貼膜神器',variant:{id:'gid://shopify/ProductVariant/999',barcode:'NEW4711299270086'}})],pageInfo:{hasNextPage:false}} });
  const result = await run(editedRows(),current);
  expect(objects(result.rows)[0]['Lineitem sku']).toBe('4711299270086');
  expect(result.verification.orders[0].items[0]).toMatchObject({sku:'4711299270086',variantId:'gid://shopify/ProductVariant/999',barcode:'NEW4711299270086'});
  const changed = await run(editedRows(),{...current,lineItems:{nodes:[{...current.lineItems.nodes[0],variant:{id:'gid://shopify/ProductVariant/1000',barcode:'NEW4711299270086'}}],pageInfo:{hasNextPage:false}}});
  expect(changed.verification.fingerprint).not.toBe(result.verification.fingerprint);
});

test('a removed non-shippable item does not block a current physical shipment', async () => {
  const current = order();
  current.lineItems.nodes[0].requiresShipping = false;
  const result = await run(editedRows(), current);
  expect(objects(result.rows)).toHaveLength(1);
  expect(objects(result.rows)[0]).toMatchObject({ 'Lineitem sku': '4711299272493', 'Lineitem requires shipping': true, Total: '890.00' });
});

test('paginated line items are fully read and a changed order or repeated cursor never returns a partial result', async () => {
  const current = order(), page1 = { ...current, lineItems: { nodes: current.lineItems.nodes.slice(0, 1), pageInfo: { hasNextPage: true, endCursor: 'CURSOR-A' } } }, page2 = { ...current, lineItems: { nodes: current.lineItems.nodes.slice(1), pageInfo: { hasNextPage: false, endCursor: 'CURSOR-B' } } };
  const fetchImpl = jest.fn().mockResolvedValueOnce(response(page1)).mockResolvedValueOnce(response(page2));
  const result = await run(editedRows(), current, { fetchImpl });
  expect(objects(result.rows)).toHaveLength(1);
  expect(JSON.parse(fetchImpl.mock.calls[1][1].body).variables.after).toBe('CURSOR-A');
  const changed = jest.fn().mockResolvedValueOnce(response(page1)).mockResolvedValueOnce(response({ ...page2, updatedAt: '2026-10-01T10:00:00Z' }));
  await expect(run(editedRows(), current, { fetchImpl: changed })).rejects.toMatchObject({ code: 'SHOPIFY_ORDER_CHANGED' });
  const repeated = jest.fn().mockResolvedValueOnce(response(page1)).mockResolvedValueOnce(response({ ...page2, lineItems: { ...page2.lineItems, pageInfo: { hasNextPage: true, endCursor: 'CURSOR-A' } } }));
  await expect(run(editedRows(), current, { fetchImpl: repeated })).rejects.toMatchObject({ code: 'SHOPIFY_PAGINATION_INVALID' });
});

test.each([
  ['wrong shop', 'SHOPIFY_SHOP_MISMATCH', current => current, 'other.myshopify.com'],
  ['missing order', 'SHOPIFY_ORDER_MISSING', () => null],
  ['wrong name', 'SHOPIFY_ORDER_MISMATCH', current => ({ ...current, name: '#OTHER' })],
  ['wrong ID', 'SHOPIFY_ORDER_MISMATCH', current => ({ ...current, id: 'gid://shopify/Order/1' })],
  ['partial fulfillment', 'SHOPIFY_FULFILLMENT_REVIEW_REQUIRED', current => ({ ...current, lineItems: { nodes: [item({ currentQuantity: 2, quantity: 2, unfulfilledQuantity: 1 })], pageInfo: { hasNextPage: false } }, currentSubtotalLineItemsQuantity: 2 })],
  ['non-shippable active product', 'SHOPIFY_NONSHIPPING_REVIEW_REQUIRED', current => ({ ...current, lineItems: { nodes: [item({ requiresShipping: false, unfulfilledQuantity: 0 })], pageInfo: { hasNextPage: false } } })],
  ['refund', 'SHOPIFY_REFUND_REVIEW_REQUIRED', current => ({ ...current, totalRefundedSet: bag('1.00') })],
  ['paid but outstanding', 'SHOPIFY_PAYMENT_REVIEW_REQUIRED', current => ({ ...current, displayFinancialStatus: 'PAID' })],
  ['pending but partly collected', 'SHOPIFY_PAYMENT_REVIEW_REQUIRED', current => ({ ...current, totalReceivedSet: bag('10.00') })],
  ['quantity count mismatch', 'SHOPIFY_QUANTITY_INVALID', current => ({ ...current, currentSubtotalLineItemsQuantity: 2 })],
  ['current subtotal mismatch', 'SHOPIFY_TOTAL_MISMATCH', current => ({ ...current, currentSubtotalPriceSet: bag('1000.00') })],
  ['discount mismatch', 'SHOPIFY_DISCOUNT_REVIEW_REQUIRED', current => ({ ...current, currentTotalDiscountsSet: bag('10.00') })],
  ['separate source tax', 'SHOPIFY_FINANCIAL_REVIEW_REQUIRED', current => ({ ...current, currentTotalTaxSet: bag('5.00') })],
  ['non TWD', 'SHOPIFY_CURRENCY_UNSUPPORTED', current => ({ ...current, currencyCode: 'USD' })],
  ['foreign customer currency', 'SHOPIFY_CURRENCY_UNSUPPORTED', current => ({ ...current, presentmentCurrencyCode: 'USD' })],
  ['money bag currency mismatch', 'SHOPIFY_MONEY_INVALID', current => ({ ...current, currentTotalPriceSet: { shopMoney: { amount: '890.00', currencyCode: 'USD' } } })],
  ['scientific SKU', 'SHOPIFY_SKU_INVALID', current => ({ ...current, lineItems: { nodes: [item({ sku: '4.71E+12' })], pageInfo: { hasNextPage: false } } })],
  ['invalid variant ID', 'SHOPIFY_RESPONSE_INVALID', current => ({ ...current, lineItems: { nodes: [item({ variant:{id:'gid://shopify/Product/123',barcode:'4711299272493'} })], pageInfo: { hasNextPage: false } } })],
  ['duplicate platform line ID', 'SHOPIFY_LINE_ID_INVALID', current => ({ ...current, lineItems: { nodes: [item(), item()], pageInfo: { hasNextPage: false } } })],
])('%s is blocked with an actionable code and no CSV fallback', async (...args) => {
  const [label, code, mutate, responseShop] = args;
  const fetchImpl = jest.fn(async () => response(mutate(order()), responseShop));
  await expect(run(editedRows(), order(), { fetchImpl })).rejects.toMatchObject({ code });
});

test('credentials, network failures, HTTP and GraphQL errors never expose secrets or server response bodies', async () => {
  const failures = [jest.fn(async () => { throw Error(token); }), jest.fn(async () => ({ ok: false, status: 401, text: async () => token })), jest.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ errors: [{ message: token, extensions: { code: 'ACCESS_DENIED' } }] }) }))];
  for (const fetchImpl of failures) {
    let error; try { await run(editedRows(), order(), { fetchImpl }); } catch (value) { error = value; }
    expect(error).toBeInstanceOf(Error); expect(error.status).toBe(503); expect(error.message).not.toContain(token);
  }
  const fetchImpl = jest.fn();
  await expect(run(editedRows(), order(), { token: '', fetchImpl })).rejects.toMatchObject({ code: 'SHOPIFY_CONFIG_INVALID' });
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('request timeout is bounded even when fetch never settles', async () => {
  await expect(run(editedRows(), order(), { timeoutMs: 5, fetchImpl: () => new Promise(() => {}) })).rejects.toMatchObject({ code: 'SHOPIFY_TIMEOUT', status: 503 });
});

test('source ID conflicts, missing IDs and oversized files are rejected before any network call', async () => {
  const fetchImpl = jest.fn();
  for (const rows of [table([source({ Id: '' })]), table([source(), source({ Id: '123' })]), [editedRows()[0], ...Array.from({ length: 1001 }, () => editedRows()[1])]]) {
    await expect(run(rows, order(), { fetchImpl })).rejects.toHaveProperty('code');
  }
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('env wrapper uses only WMS Shopify settings and neither copies nor returns credentials', async () => {
  const fetchImpl = jest.fn(async () => response(order()));
  const verify = createShopifyOrderVerifier({ env: { WMS_SHOPIFY_SHOP: shop, WMS_SHOPIFY_ACCESS_TOKEN: token, WMS_SHOPIFY_API_VERSION: '2026-07', SHOPIFY_TOKEN: 'unrelated-secret' }, fetchImpl });
  const result = await verify(editedRows());
  expect(JSON.stringify(result)).not.toMatch(/test-secret|unrelated-secret/);
  expect(fetchImpl.mock.calls[0][1].headers['X-Shopify-Access-Token']).toBe(token);
});
