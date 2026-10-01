const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyOneShopRows, createOneShopOrderVerifier } = require('../src/services/oneShopOrderVerification');

function rows() {
  return [['訂單編號', '建立日期', '訂單狀態', '名稱', '產品SKU', '產品', '產品數量', '數量(單品/組合/任選)', '單價', '小計', '訂單金額(不含金/物流手續費)', '訂單金流手續費', '訂單運費', '總計金額', '金流', '金流狀態', '物流狀態', '顧客', '顧客電話', '運送地址'], ['TST000001', '2026-09-15 15:05:22', '等待確認', '', 'NEW47112992713422', '完整品號商品', 2, 2, 890, 1780, 1780, 0, 80, 1860, '信用卡', '已付款', '等待出貨', '私人收件姓名', '0900000000', '私人地址']];
}
function payload() {
  return { success: 0, data: { order: { order_number: 'TST000001', total_price: 1860, shop_url: 'https://company.1shop.tw/', payment: 'credit', payment_status: 'paid', logistic: 'home', logistic_status: 'pending', progress_status: 'confirmed', name: '私人收件姓名', phone: '0900000000', country: 'TW', address: '私人地址' }, cart: { sub_total: 1780, logistic_fee: 80, payment_fee: 0, refund: 0, total_price: 1860, products: [{ product_type: 'single', quantity: 2, per_cost: 890, line_total: 1780, sku: 'NEW47112992713422' }] } }, msg: 'success' };
}
function response(data, status = 200) { return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(data) }; }
function options(data = payload(), extra = {}) { return { appId: 'private-app', secret: 'private-secret', shopUrl: 'https://company.1shop.tw', connectionId: 'account-1', fetchImpl: async () => response(data), ...extra }; }
const fails = (promise, code) => assert.rejects(promise, error => error.code === code && !error.message.includes('private-secret'));

test('exact current match preserves full SKU, file line IDs and recipient data without guessing a barcode', async () => {
  const source = rows(), result = await verifyOneShopRows(source, options());
  assert.deepEqual(result.verification.orders[0].items, [{ sku: 'NEW47112992713422', quantity: 2, netMinor: 178000 }]);
  assert.equal(result.verification.orders[0].totalMinor, 186000);
  assert.equal(result.rows[1][result.rows[0].indexOf('產品SKU')], 'NEW47112992713422');
  assert.equal(result.rows[1][result.rows[0].indexOf('運送地址')], '私人地址');
  assert.equal(result.rows[1][result.rows[0].indexOf('訂單狀態')], '已確認');
  assert.equal(Object.hasOwn(result.verification.orders[0], 'currentQuantity'), false);
  const evidence = JSON.stringify(result.verification);
  for (const value of ['private-secret', 'private-app', '私人收件姓名', '0900000000', '私人地址']) assert.equal(evidence.includes(value), false);
  assert.deepEqual(source, rows());
});
test('all requests are GETs to the official host, with redirect disabled', async () => {
  let seen;
  await verifyOneShopRows(rows(), options(payload(), { fetchImpl: async (url, init) => { seen = { url: new URL(url), init }; return response(payload()); } }));
  assert.equal(seen.url.hostname, 'api.1shop.tw'); assert.equal(seen.url.pathname, '/v1/order/TST000001');
  assert.equal(seen.init.method, 'GET'); assert.equal(seen.init.redirect, 'error');
});
test('COD remains unpaid and becomes recognizable by downstream shipment eligibility', async () => {
  const current = payload(); Object.assign(current.data.order, { payment: 'c2c', payment_status: 'cod' });
  const result = await verifyOneShopRows(rows(), options(current));
  assert.equal(result.verification.orders[0].paymentStatus, 'pending');
  assert.equal(result.rows[1][result.rows[0].indexOf('金流')], '超商取貨付款');
  assert.equal(result.rows[1][result.rows[0].indexOf('金流狀態')], '等待付款');
});
test('currently shipped or cancelled orders never normalize back to pending shipment', async () => {
  for (const state of [{ logistic_status: 'send' }, { progress_status: 'cancelled' }]) {
    const current = payload(); Object.assign(current.data.order, state);
    const result = await verifyOneShopRows(rows(), options(current));
    assert.equal(result.verification.orders[0].fulfillmentStatus === 'fulfilled' || result.verification.orders[0].cancelled, true);
  }
});
test('mixed paid and cancelled orders keep a clear exclusion without requiring cancelled delivery details', async () => {
  const { parseUnifiedMarketplace, prepareUnifiedMarketplace } = await import('../src/services/unifiedMarketplace.mjs');
  const source = rows(), cancelled = payload();
  Object.assign(cancelled.data.order, { order_number: 'TST000002', progress_status: 'cancelled', name: '', phone: '', address: '' });
  const line = [...source[1]]; line[0] = 'TST000002'; source.push(line);
  const result = await verifyOneShopRows(source, options(payload(), { fetchImpl: async url => response(new URL(url).pathname.endsWith('/TST000002') ? cancelled : payload()) }));
  assert.equal(result.verification.orders[1].excluded, true); assert.equal(result.verification.orders[1].exclusionReason, '已取消訂單');
  const prepared = prepareUnifiedMarketplace(parseUnifiedMarketplace(result.rows).parsed, {});
  assert.equal(prepared.parsed.orders.length, 1); assert.equal(prepared.parsed.summary.totalQuantity, 2); assert.equal(prepared.parsed.summary.totalMinor, 186000);
  assert.deepEqual(prepared.choices[1], { eligible: false, reason: '已取消訂單', number: 'TST000002' });
});
test('cancelled orders still verify exact identity and money; undocumented payment states are rejected', async () => {
  const missing = payload(); missing.data.order.progress_status = 'cancelled'; missing.data.cart.total_price = null;
  await fails(verifyOneShopRows(rows(), options(missing)), 'ONESHOP_MONEY_INVALID');
  const wrong = payload(); wrong.data.order.progress_status = 'cancelled'; wrong.data.order.shop_url = 'https://other.1shop.tw';
  await fails(verifyOneShopRows(rows(), options(wrong)), 'ONESHOP_SHOP_MISMATCH');
  for (const status of ['failed', 'expired', 'unknown-vendor-status']) {
    const current = payload(); current.data.order.progress_status = 'cancelled'; current.data.order.payment_status = status;
    await fails(verifyOneShopRows(rows(), options(current)), 'ONESHOP_STATUS_REVIEW_REQUIRED');
  }
});
test('edited products, quantities and line prices require a fresh export', async () => {
  for (const mutate of [p => { p.data.cart.products[0].sku = '4711299271342'; }, p => { p.data.cart.products[0].quantity = 1; p.data.cart.products[0].line_total = 890; }, p => { p.data.cart.products[0].per_cost = 900; p.data.cart.products[0].line_total = 1800; }]) {
    const current = payload(); mutate(current); await fails(verifyOneShopRows(rows(), options(current)), 'ONESHOP_ORDER_CHANGED');
  }
});
test('different prices for the same SKU are compared as quantity and money, not as a last-row selector', async () => {
  const source = rows(); source[1][6] = source[1][7] = 1; source[1][8] = source[1][9] = 890;
  source.push([...source[1]]); source[1][8] = source[1][9] = 880; source[2][8] = source[2][9] = 900;
  const current = payload(); current.data.cart.products = [{ product_type: 'single', quantity: 1, per_cost: 880, line_total: 880, sku: 'NEW47112992713422' }, { product_type: 'single', quantity: 1, per_cost: 900, line_total: 900, sku: 'NEW47112992713422' }];
  const result = await verifyOneShopRows(source, options(current));
  assert.equal(result.verification.orders[0].items[0].quantity, 2); assert.equal(result.rows.length, 3);
});
test('changed shipping charge and inconsistent API order/cart totals are blocked', async () => {
  const changed = payload(); changed.data.cart.logistic_fee = 90; changed.data.cart.total_price = changed.data.order.total_price = 1870;
  await fails(verifyOneShopRows(rows(), options(changed)), 'ONESHOP_ORDER_CHANGED');
  const inconsistent = payload(); inconsistent.data.order.total_price = 40;
  await fails(verifyOneShopRows(rows(), options(inconsistent)), 'ONESHOP_TOTAL_MISMATCH');
});
test('refund, bundle and charge semantics are not guessed', async () => {
  const refund = payload(); refund.data.cart.refund = 1; await fails(verifyOneShopRows(rows(), options(refund)), 'ONESHOP_REFUND_REVIEW_REQUIRED');
  const bundle = payload(); bundle.data.cart.products[0].product_type = 'bundle'; await fails(verifyOneShopRows(rows(), options(bundle)), 'ONESHOP_BUNDLE_REVIEW_REQUIRED');
  const fee = payload(); fee.data.cart.products[0].product_type = 'charge'; await fails(verifyOneShopRows(rows(), options(fee)), 'ONESHOP_NONSTOCK_REVIEW_REQUIRED');
});
test('wrong order or shop is rejected without leaking credentials', async () => {
  const wrongOrder = payload(); wrongOrder.data.order.order_number = 'TST000002'; await fails(verifyOneShopRows(rows(), options(wrongOrder)), 'ONESHOP_ORDER_MISMATCH');
  const wrongShop = payload(); wrongShop.data.order.shop_url = 'https://other.1shop.tw'; await fails(verifyOneShopRows(rows(), options(wrongShop)), 'ONESHOP_SHOP_MISMATCH');
});
test('unknown statuses and virtual-only orders require review', async () => {
  const status = payload(); status.data.order.logistic_status = 'returned'; await fails(verifyOneShopRows(rows(), options(status)), 'ONESHOP_STATUS_REVIEW_REQUIRED');
  const virtual = payload(); virtual.data.order.logistic = 'virtual'; await fails(verifyOneShopRows(rows(), options(virtual)), 'ONESHOP_NONSHIPPING_REVIEW_REQUIRED');
});
test('IP restriction, vendor failure, rate limit and transport failure do not fall back to stale file data', async () => {
  await fails(verifyOneShopRows(rows(), options({ success: -1, msg: 'IP未加入白名單' })), 'ONESHOP_IP_NOT_ALLOWED');
  await fails(verifyOneShopRows(rows(), options({ success: -1, msg: 'invalid private-secret' })), 'ONESHOP_ACCESS_DENIED');
  await fails(verifyOneShopRows(rows(), options(payload(), { fetchImpl: async () => response({}, 429) })), 'ONESHOP_RATE_LIMITED');
  await fails(verifyOneShopRows(rows(), options(payload(), { fetchImpl: async () => { throw new Error('private-secret in URL'); } })), 'ONESHOP_UNAVAILABLE');
});
test('bounded timeout rejects a hung API and does not expose the URL', async () => {
  await fails(verifyOneShopRows(rows(), options(payload(), { timeoutMs: 10, fetchImpl: () => new Promise(() => {}) })), 'ONESHOP_TIMEOUT');
});
test('invalid or oversized response fails closed', async () => {
  await fails(verifyOneShopRows(rows(), options(payload(), { fetchImpl: async () => ({ ok: true, status: 200, text: async () => 'not JSON' }) })), 'ONESHOP_RESPONSE_INVALID');
  await fails(verifyOneShopRows(rows(), options(payload(), { fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => '999999999' }, text: async () => '' }) })), 'ONESHOP_RESPONSE_INVALID');
});
test('fingerprint detects API shipping changes without storing personal data', async () => {
  const first = await verifyOneShopRows(rows(), options()); const changed = payload(); changed.data.order.address = '另一私人地址';
  const second = await verifyOneShopRows(rows(), options(changed));
  assert.notEqual(first.verification.fingerprint, second.verification.fingerprint);
  assert.equal(JSON.stringify(second.verification).includes('另一私人地址'), false);
});
test('installed secrets do not enable verification unless a profile explicitly selects a connection', async () => {
  const verify = createOneShopOrderVerifier({ env: { WMS_1SHOP_STORES_JSON: 'bad JSON' }, fetchImpl: () => assert.fail('must not fetch') });
  assert.deepEqual(await verify(rows()), { rows: rows(), verification: null });
  await fails(verify(rows(), { apiConnectionId: 'account-1' }), 'ONESHOP_CONFIG_INVALID');
});
test('multiple store accounts require exact selection and a separately confirmed shop URL', async () => {
  const env = { WMS_1SHOP_STORES_JSON: JSON.stringify([{ account: 'account-1', appId: 'a', secret: 's' }, { account: 'account-2', appId: 'b', secret: 't', shopUrl: 'https://other.1shop.tw' }]) };
  const verify = createOneShopOrderVerifier({ env, shopUrls: { 'account-1': 'https://company.1shop.tw' }, fetchImpl: async () => response(payload()) });
  const result = await verify(rows(), { apiConnectionId: 'account-1' }); assert.equal(result.verification.connectionId, 'account-1');
  await fails(verify(rows(), { apiConnectionId: 'missing' }), 'ONESHOP_CONNECTION_INVALID');
  const unbound = createOneShopOrderVerifier({ env, fetchImpl: () => assert.fail('must not fetch') });
  await fails(unbound(rows(), { apiConnectionId: 'account-1' }), 'ONESHOP_CONFIG_INVALID');
});
test('confirmed custom domains and my1shop domains bind by origin across different sales pages', async () => {
  for (const origin of ['https://www.omfuture.tw', 'https://properstudio.my1shop.com']) {
    const current = payload(); current.data.order.shop_url = origin + '/another-sales-page';
    const result = await verifyOneShopRows(rows(), options(current, { shopUrl: origin + '/original-sales-page' }));
    assert.equal(result.verification.shop, origin);
  }
  const current = payload(); current.data.order.shop_url = 'https://other.omfuture.tw/page';
  await fails(verifyOneShopRows(rows(), options(current, { shopUrl: 'https://www.omfuture.tw' })), 'ONESHOP_SHOP_MISMATCH');
});
test('origin bindings prohibit credentials, query strings, fragments and explicit ports', async () => {
  for (const shopUrl of ['http://www.omfuture.tw', 'https://secret@www.omfuture.tw', 'https://www.omfuture.tw/page?token=secret', 'https://www.omfuture.tw/#secret', 'https://www.omfuture.tw:443/page', 'https://www.omfuture.tw:8443/page']) {
    await fails(verifyOneShopRows(rows(), options(payload(), { shopUrl })), 'ONESHOP_CONFIG_INVALID');
  }
});
test('separate non-secret origin JSON binds by exact account, regardless of duplicate display store names', async () => {
  const current = payload(); current.data.order.shop_url = 'https://www.omfuture.tw/new-page';
  const env = { WMS_1SHOP_STORES_JSON: JSON.stringify([{ account: '0938970369', storeName: 'same display name', appId: 'private-app', secret: 'private-secret' }, { account: '0978072278', storeName: 'same display name', appId: 'other-app', secret: 'other-secret' }]), WMS_1SHOP_SHOP_URLS_JSON: JSON.stringify({ '0938970369': 'https://www.omfuture.tw', '0978072278': 'https://properstudio.my1shop.com' }) };
  const verify = createOneShopOrderVerifier({ env, fetchImpl: async url => { assert.equal(new URL(url).searchParams.get('appid'), 'private-app'); return response(current); } });
  const result = await verify(rows(), { apiConnectionId: '0938970369' }); assert.equal(result.verification.shop, 'https://www.omfuture.tw');
  await fails(verify(rows(), { apiConnectionId: 'same display name' }), 'ONESHOP_CONNECTION_INVALID');
  for (const invalid of ['bad JSON', '[]', '{"0938970369":123}', 'null']) {
    const invalidVerify = createOneShopOrderVerifier({ env: { ...env, WMS_1SHOP_SHOP_URLS_JSON: invalid }, fetchImpl: () => assert.fail('must not fetch') });
    await fails(invalidVerify(rows(), { apiConnectionId: '0938970369' }), 'ONESHOP_CONFIG_INVALID');
  }
});
test('current pickup store replaces old home address and incomplete store data blocks conversion', async () => {
  const current = payload(); Object.assign(current.data.order, { logistic: 'uni', cvs_store_id: '123456', cvs_store_name: '新門市', cvs_store_address: '新門市地址' });
  const result = await verifyOneShopRows(rows(), options(current));
  assert.equal(result.rows[1][result.rows[0].indexOf('運送地址')], '新門市地址');
  assert.equal(result.rows[1][result.rows[0].indexOf('門市名稱')], '新門市');
  current.data.order.cvs_store_id = ''; await fails(verifyOneShopRows(rows(), options(current)), 'ONESHOP_SHIPPING_REVIEW_REQUIRED');
});
