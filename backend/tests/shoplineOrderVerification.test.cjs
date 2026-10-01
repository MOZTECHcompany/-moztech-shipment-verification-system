const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyShoplineRows, createShoplineOrderVerifier } = require('../src/services/shoplineOrderVerification');

const MERCHANT = '5e0738e792f5c90009548b54', ORDER = '608faafe3985d70013d89319', LINE = '608faafe3985d70013d8931c';
const NUMBER = '20260915040456194';
const m = amount => ({ cents: amount, dollars: amount, currency_iso: 'TWD' });
function rows() {
  const headers = ['訂單號碼', '商品貨號', '商品名稱', '數量', '付款狀態', '送貨狀態', '付款方式', '訂單狀態', '訂單小計', '運費', '優惠折扣', '訂單合計', '稅費', '貨幣', '商品折扣金額', '訂單日期', '商品類型', '商品結帳價', '已退款金額', '全單折扣金額', '折抵購物金分攤', '點數折現分攤', '自訂折扣合計', '折抵購物金', '點數折現', '附加費', '收件人', '收件人電話號碼', '完整地址'];
  return [headers, ['#' + NUMBER, 'NEW47112992713422', '完整品號商品', 2, '已付款', '備貨中', '信用卡', '處理中', 1780, 80, 100, 1700, 0, 'TWD', 20, 46280.50342592593, '商品', 890, 0, 110, 10, 20, 30, 10, 20, 0, '舊姓名', '0911111111', '舊地址']];
}
function order() {
  return { id: ORDER, order_number: NUMBER, currency_iso: 'TWD', status: 'confirmed', updated_at: '2026-10-01T01:00:00Z', created_at: '2026-09-15T04:04:56Z', subtotal: m(1780), order_discount: m(100), user_credit: m(10), order_points_to_cash: m(20), total_tax_fee: m(0), total: m(1700),
    order_payment: { status: 'completed', payment_type: 'credit_card', name_translations: { 'zh-hant': '信用卡' }, payment_fee: m(0), total: m(1700), updated_at: '2026-10-01T01:00:00Z' },
    order_delivery: { status: 'pending', delivery_status: 'pending', total: m(80), delivery_type: 'post', name_translations: { 'zh-hant': '宅配' }, updated_at: '2026-10-01T01:00:00Z' },
    delivery_address: { country_code: 'TW', city: '台北市', address_2: '中山區', address_1: '新地址', postcode: '104', recipient_name: '新姓名', recipient_phone: '0900000000' },
    delivery_data: { tracking_number: '' }, subtotal_items: [{ id: LINE, item_type: 'Product', sku: 'NEW47112992713422', quantity: 2, item_price: m(890), total: m(1780), discounted_price: m(20), order_discounted_price: null, item_data: { order_discounted_price: m(80), custom_discounted_amount: m(30), user_credit_ratio_amount: m(10), member_point_redeem_to_cash_ratio_amount: m(20) } }] };
}
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(data) });
const list = (items = [{ id: ORDER, order_number: NUMBER }], current = 1, total = 1) => ({ items, pagination: { current_page: current, total_pages: total, per_page: 50 } });
function options(current = order(), extra = {}) {
  return { token: 'private-token', merchantId: MERCHANT, handle: 'onemorefuture', connectionId: 'onemorefuture', fetchImpl: async url => {
    const path = new URL(url).pathname;
    return response(path === '/v1/token/info' ? { merchant: { _id: MERCHANT, handle: 'onemorefuture' }, staff: { email: 'private-email', merchant_ids: [MERCHANT, 'another'] } } : path === '/v1/orders' ? list() : current);
  }, ...extra };
}
const fails = (promise, code) => assert.rejects(promise, error => error.code === code && !error.message.includes('private-token'));

test('native TWD discounts, credits and points reconcile without treating cents as one hundredth of a dollar', async () => {
  const result = await verifyShoplineRows(rows(), options());
  const evidence = result.verification.orders[0];
  assert.equal(evidence.totalMinor, 170000); assert.equal(evidence.subtotalMinor, 162000); assert.equal(evidence.discountMinor, 16000);
  assert.deepEqual(evidence.items, [{ id: LINE, sku: 'NEW47112992713422', quantity: 2, netMinor: 162000 }]);
  assert.equal(result.verification.merchantId, MERCHANT);
  assert.equal(result.rows[1][result.rows[0].indexOf('商品貨號')], 'NEW47112992713422');
});
test('latest API recipient and delivery replace stale file fields without exposing PII in evidence', async () => {
  const result = await verifyShoplineRows(rows(), options());
  for (const [field, value] of [['收件人', '新姓名'], ['收件人電話號碼', '0900000000'], ['完整地址', '台北市 中山區 新地址'], ['送貨方式', '宅配']]) assert.equal(result.rows[1][result.rows[0].indexOf(field)], value);
  const evidence = JSON.stringify(result.verification);
  for (const value of ['private-token', 'private-email', '新姓名', '新地址', '0900000000']) assert.equal(evidence.includes(value), false);
});
test('store token is verified before reading orders, and date lookup uses the actual UTC bounds of Excel Taiwan dates', async () => {
  const calls = [];
  const base = options();
  await verifyShoplineRows(rows(), options(order(), { fetchImpl: async (url, init) => { calls.push({ url: new URL(url), init }); return base.fetchImpl(url, init); } }));
  assert.equal(calls[0].url.pathname, '/v1/token/info'); assert.equal(calls[1].url.searchParams.get('created_after'), '2026-09-14T16:00:00.000Z');
  assert.equal(calls[1].url.searchParams.get('created_before'), '2026-09-15T15:59:59.999Z');
  assert.equal(calls[2].url.pathname, '/v1/orders/' + ORDER);
  assert.equal(calls.every(call => call.url.hostname === 'open.shopline.io' && call.init.method === 'GET' && call.init.redirect === 'error'), true);
  assert.equal(calls.some(call => call.url.searchParams.has('order_number')), false);
});
test('wrong merchant or handle prevents even the order-list request', async () => {
  let count = 0;
  await fails(verifyShoplineRows(rows(), options(order(), { fetchImpl: async () => { count++; return response({ merchant: { _id: '608faafe3985d70013d8931c', handle: 'onemorefuture' } }); } })), 'SHOPLINE_SHOP_MISMATCH');
  assert.equal(count, 1);
});
test('blank fields in continuation rows are not selectors for the latest item', async () => {
  const source = rows(); source[1][3] = 1; source[1][14] = 10; source[1][19] = 55; source[1][20] = 5; source[1][21] = 10;
  source.push([...source[1]]); source[2][0] = ''; source[2][1] = '4711299274749'; source[2][2] = '第二商品';
  const current = order(); current.subtotal_items[0].quantity = 1; current.subtotal_items[0].total = m(890); current.subtotal_items[0].discounted_price = m(10);
  current.subtotal_items[0].item_data = { order_discounted_price: m(40), custom_discounted_amount: m(15), user_credit_ratio_amount: m(5), member_point_redeem_to_cash_ratio_amount: m(10) };
  current.subtotal_items.push({ ...structuredClone(current.subtotal_items[0]), id: '608faafe3985d70013d8931d', sku: '4711299274749' });
  const result = await verifyShoplineRows(source, options(current));
  assert.equal(result.verification.orders[0].items.length, 2); assert.equal(result.rows.length, 3);
});
test('COD stays unpaid while current shipped and cancelled statuses remain excluded', async () => {
  const current = order(); current.order_payment.status = 'pending'; current.order_payment.payment_type = 'cash_on_delivery';
  const cod = await verifyShoplineRows(rows(), options(current));
  assert.equal(cod.verification.orders[0].paymentStatus, 'pending'); assert.equal(cod.rows[1][cod.rows[0].indexOf('付款方式')], '貨到付款');
  current.order_delivery.status = 'shipped'; const shipped = await verifyShoplineRows(rows(), options(current)); assert.equal(shipped.verification.orders[0].fulfillmentStatus, 'fulfilled');
  current.status = 'cancelled'; const cancelled = await verifyShoplineRows(rows(), options(current)); assert.equal(cancelled.verification.orders[0].cancelled, true);
});
test('edited SKU or quantity blocks re-export instead of using historical rows', async () => {
  const current = order(); current.subtotal_items[0].sku = '4711299271342';
  await fails(verifyShoplineRows(rows(), options(current)), 'SHOPLINE_ORDER_CHANGED');
});
test('TWD cents/dollars disagreement and missing allocation cannot manufacture a discount', async () => {
  const badMoney = order(); badMoney.total.dollars = 17;
  await fails(verifyShoplineRows(rows(), options(badMoney)), 'SHOPLINE_MONEY_INVALID');
  const missing = order(); delete missing.subtotal_items[0].item_data.user_credit_ratio_amount;
  await fails(verifyShoplineRows(rows(), options(missing)), 'SHOPLINE_TOTAL_MISMATCH');
  const conflicting = order(); conflicting.subtotal_items[0].order_discounted_price = m(81);
  await fails(verifyShoplineRows(rows(), options(conflicting)), 'SHOPLINE_DISCOUNT_REVIEW_REQUIRED');
});
test('refunds, product sets and split/merged orders require explicit review', async () => {
  const refunded = order(); refunded.order_payment.status = 'partially_refunded'; await fails(verifyShoplineRows(rows(), options(refunded)), 'SHOPLINE_REFUND_REVIEW_REQUIRED');
  const bundle = order(); bundle.subtotal_items[0].item_type = 'ProductSet'; await fails(verifyShoplineRows(rows(), options(bundle)), 'SHOPLINE_BUNDLE_REVIEW_REQUIRED');
  const split = order(); split.parent_order_id = ORDER; await fails(verifyShoplineRows(rows(), options(split)), 'SHOPLINE_SPLIT_REVIEW_REQUIRED');
});
test('duplicate line IDs and ambiguous order numbers fail closed', async () => {
  const duplicate = order(); duplicate.subtotal_items.push(structuredClone(duplicate.subtotal_items[0])); await fails(verifyShoplineRows(rows(), options(duplicate)), 'SHOPLINE_LINE_ID_INVALID');
  await fails(verifyShoplineRows(rows(), options(order(), { fetchImpl: async url => response(new URL(url).pathname === '/v1/token/info' ? { merchant: { _id: MERCHANT, handle: 'onemorefuture' } } : list([{ id: ORDER, order_number: NUMBER }, { id: LINE, order_number: NUMBER }])) })), 'SHOPLINE_ORDER_AMBIGUOUS');
});
test('order lookup reads every documented page and fetches the matching actual ID', async () => {
  const pages = [];
  const result = await verifyShoplineRows(rows(), options(order(), { fetchImpl: async url => {
    const target = new URL(url);
    if (target.pathname === '/v1/token/info') return response({ merchant: { _id: MERCHANT, handle: 'onemorefuture' } });
    if (target.pathname !== '/v1/orders') return response(order());
    const page = Number(target.searchParams.get('page')); pages.push(page);
    return response(page === 1 ? list([{ id: LINE, order_number: 'another' }], 1, 2) : list([{ id: ORDER, order_number: NUMBER }], 2, 2));
  } }));
  assert.deepEqual(pages, [1, 2]); assert.equal(result.verification.orders[0].id, ORDER);
});
test('empty, interrupted and repeated pages never become an approved zero-order result', async () => {
  for (const [data, code] of [[list([], 1, 0), 'SHOPLINE_ORDER_MISSING'], [list([], 1, 2), 'SHOPLINE_PAGINATION_INVALID'], [list([{ id: ORDER, order_number: NUMBER }], 2, 2), 'SHOPLINE_PAGINATION_INVALID']]) {
    await fails(verifyShoplineRows(rows(), options(order(), { fetchImpl: async url => response(new URL(url).pathname === '/v1/token/info' ? { merchant: { _id: MERCHANT, handle: 'onemorefuture' } } : data) })), code);
  }
});
test('missing or archived detail blocks verification', async () => {
  const base = options();
  for (const status of [404, 410]) await fails(verifyShoplineRows(rows(), options(order(), { fetchImpl: async url => new URL(url).pathname === '/v1/orders/' + ORDER ? response({ error: 'Not found' }, status) : base.fetchImpl(url) })), 'SHOPLINE_ORDER_MISSING');
});
test('IP restrictions, authorization failures, rate limits and transport errors are redacted and never use stale file data', async () => {
  for (const [data, status, code] of [[{ error: 'Your IP Address is not whitelisted' }, 401, 'SHOPLINE_IP_NOT_ALLOWED'], [{ error: 'private-token invalid' }, 403, 'SHOPLINE_ACCESS_DENIED'], [{ error: 'throttled' }, 429, 'SHOPLINE_RATE_LIMITED']]) await fails(verifyShoplineRows(rows(), options(order(), { fetchImpl: async () => response(data, status) })), code);
  await fails(verifyShoplineRows(rows(), options(order(), { fetchImpl: async () => { throw new Error('private-token'); } })), 'SHOPLINE_UNAVAILABLE');
});
test('hung API is bounded and invalid response does not leak the response content', async () => {
  await fails(verifyShoplineRows(rows(), options(order(), { timeoutMs: 10, fetchImpl: () => new Promise(() => {}) })), 'SHOPLINE_TIMEOUT');
  await fails(verifyShoplineRows(rows(), options(order(), { fetchImpl: async () => ({ ok: true, status: 200, text: async () => 'private-token invalid JSON' }) })), 'SHOPLINE_RESPONSE_INVALID');
});
test('shipping-only and delivery-only API updates alter the fingerprint', async () => {
  const first = await verifyShoplineRows(rows(), options()); const current = order(); current.delivery_address.address_1 = '另一新地址'; current.order_delivery.updated_at = '2026-10-01T01:00:01Z';
  const changed = await verifyShoplineRows(rows(), options(current)); assert.notEqual(first.verification.fingerprint, changed.verification.fingerprint);
});
test('invalid source dates and ranges are rejected without inferring a date from the order number', async () => {
  const source = rows(); source[1][15] = '';
  await fails(verifyShoplineRows(source, options()), 'SHOPLINE_SOURCE_DATE_INVALID');
});
test('file mode remains available until a profile explicitly selects the bound API connection', async () => {
  const verify = createShoplineOrderVerifier({ env: { WMS_SHOPLINE_ACCESS_TOKEN: 'private-token', WMS_SHOPLINE_CONNECTION_ID: 'onemorefuture', WMS_SHOPLINE_MERCHANT_ID: MERCHANT, WMS_SHOPLINE_HANDLE: 'onemorefuture' }, fetchImpl: options().fetchImpl });
  assert.deepEqual(await verify(rows()), { rows: rows(), verification: null });
  await fails(verify(rows(), { apiConnectionId: 'another' }), 'SHOPLINE_CONNECTION_INVALID');
  const result = await verify(rows(), { apiConnectionId: 'onemorefuture' }); assert.equal(result.verification.connectionId, 'onemorefuture');
});
test('failed or expired COD payment cannot become eligible pending payment', async () => {
  for (const status of ['failed', 'expired']) {
    const current = order(); current.order_payment.status = status; current.order_payment.payment_type = 'cash_on_delivery';
    await fails(verifyShoplineRows(rows(), options(current)), 'SHOPLINE_PAYMENT_REVIEW_REQUIRED');
  }
});
test('missing current delivery cannot silently retain stale recipient details', async () => {
  for (const change of [p => { p.delivery_address = null; }, p => { p.delivery_address.recipient_phone = ''; }, p => { delete p.delivery_address.address_1; delete p.delivery_address.address_2; delete p.delivery_address.city; }]) {
    const current = order(); change(current); await fails(verifyShoplineRows(rows(), options(current)), 'SHOPLINE_SHIPPING_REVIEW_REQUIRED');
  }
});
