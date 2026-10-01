const { createHash } = require('node:crypto');

const VERSION = '1shop-exact-current-v1';
const MAX_ORDERS = 50;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const clean = value => String(value ?? '').trim();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code, message, orderNumber, status = 400) => { throw Object.assign(new Error(message), { code, status, ...(orderNumber ? { orderNumber } : {}) }); };
const quantity = (value, number) => {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 50000) fail('ONESHOP_QUANTITY_INVALID', '1Shop 商品數量無法核對', number);
  return value;
};
const sku = (value, number) => {
  const result = clean(value);
  if (!result || result.length > 100 || /[\u0000-\u001f\u007f]/.test(result) || /^[+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?\d+$/.test(result)) fail('ONESHOP_SKU_INVALID', '1Shop 商品缺少完整貨號，請核對商品設定', number);
  return result;
};
function money(value, number) {
  const str = typeof value === 'number' || typeof value === 'string' ? String(value) : '';
  if (!/^\d+(?:\.\d{1,2})?$/.test(str)) fail('ONESHOP_MONEY_INVALID', '1Shop 金額無法核對', number);
  const [whole, fraction = ''] = str.split('.');
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) fail('ONESHOP_MONEY_INVALID', '1Shop 金額超出可處理範圍', number);
  return Number(result);
}
function shopUrl(value) {
  const raw = clean(value);
  let url;
  try { url = new URL(raw); } catch { fail('ONESHOP_CONFIG_INVALID', '1Shop 連線缺少已確認的商店網址', undefined, 503); }
  // order.shop_url is the sales-page URL, including on a merchant's custom
  // domain. Bind its confirmed HTTPS origin to the exact app account. This URL
  // is an identity check only; all requests still go to api.1shop.tw.
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || /[\u0000-\u001f\u007f]/.test(raw) || /^https:\/\/[^/]*:\d+(?:\/|$)/i.test(raw) || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(url.hostname)) fail('ONESHOP_CONFIG_INVALID', '1Shop 商店網址設定無效', undefined, 503);
  return url.origin.toLowerCase();
}
function checkedString(value, number) {
  if (value != null && (typeof value !== 'string' || value.length > 1000 || /[\u0000-\u001f\u007f]/.test(value))) fail('ONESHOP_RESPONSE_INVALID', '1Shop 訂單資料格式無效', number);
  return clean(value);
}
function aggregate(items, number) {
  const result = new Map();
  for (const item of items) {
    const previous = result.get(item.sku) || { quantity: 0, netMinor: 0 };
    const current = { quantity: previous.quantity + item.quantity, netMinor: previous.netMinor + item.netMinor };
    if (!Number.isSafeInteger(current.quantity) || !Number.isSafeInteger(current.netMinor)) fail('ONESHOP_RESPONSE_INVALID', '1Shop 商品加總超出可處理範圍', number);
    result.set(item.sku, current);
  }
  return [...result].sort(([a], [b]) => a.localeCompare(b));
}

async function readOrder(number, options, deadline) {
  const remaining = Math.min(options.timeoutMs, deadline - Date.now());
  if (remaining <= 0) fail('ONESHOP_TIMEOUT', '1Shop 核對逾時，請重試', number, 503);
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error('1Shop 核對逾時，請重試'), { code: 'ONESHOP_TIMEOUT', status: 503, orderNumber: number })); }, remaining); });
  try {
    return await Promise.race([timeout, (async () => {
      // This vendor requires credentials in the URL. Never include that URL or
      // the vendor/network exception in logs, errors, or verification evidence.
      const url = new URL(`https://api.1shop.tw/v1/order/${encodeURIComponent(number)}`);
      url.searchParams.set('appid', options.appId); url.searchParams.set('secret', options.secret);
      let response;
      try { response = await options.fetchImpl(url.toString(), { method: 'GET', redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json' } }); }
      catch { fail('ONESHOP_UNAVAILABLE', '1Shop 連線失敗，請重試', number, 503); }
      if (Number(response.headers?.get?.('content-length')) > MAX_RESPONSE_BYTES) fail('ONESHOP_RESPONSE_INVALID', '1Shop 核對回應超出大小限制', number, 503);
      let payload;
      try { const body = await response.text(); if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) fail('ONESHOP_RESPONSE_INVALID', '1Shop 核對回應超出大小限制', number, 503); payload = JSON.parse(body); }
      catch (error) { if (error.code === 'ONESHOP_RESPONSE_INVALID') throw error; fail('ONESHOP_RESPONSE_INVALID', '1Shop 核對回應無效', number, 503); }
      if (response.status === 429) fail('ONESHOP_RATE_LIMITED', '1Shop 查詢次數已達上限，請稍後重試', number, 503);
      if (/白名單|whitelist|\bIP\b/i.test(clean(payload?.msg))) fail('ONESHOP_IP_NOT_ALLOWED', '1Shop 尚未允許此連線 IP，請確認 API 白名單', number, 503);
      if (!response.ok || payload?.success !== 0) fail(response.status === 401 || response.status === 403 || payload?.success === -1 ? 'ONESHOP_ACCESS_DENIED' : 'ONESHOP_QUERY_FAILED', '1Shop 未完整回傳訂單，請確認讀取授權；未使用舊資料', number, 503);
      if (!payload.data || !payload.data.order || !payload.data.cart) fail('ONESHOP_RESPONSE_INVALID', '1Shop 未完整回傳訂單與商品明細', number, 503);
      return payload.data;
    })()]);
  } finally { clearTimeout(timer); }
}

function verifyOrder(source, sourceItems, data, options) {
  const number = source.sourceOrderNumber, order = data.order, cart = data.cart;
  if (checkedString(order.order_number, number) !== number) fail('ONESHOP_ORDER_MISMATCH', '1Shop 訂單編號與原始檔不一致', number);
  if (shopUrl(order.shop_url) !== options.shopUrl) fail('ONESHOP_SHOP_MISMATCH', '1Shop 訂單商店與所選連線不一致', number, 503);
  if (cart.refund == null || money(cart.refund, number) > 0 || order.payment_status === 'refunded') fail('ONESHOP_REFUND_REVIEW_REQUIRED', '1Shop 訂單有退款或退款資料不完整，請先核對', number);
  if (order.logistic === 'virtual') fail('ONESHOP_NONSHIPPING_REVIEW_REQUIRED', '訂單含非出貨品項，請確認 ECOUNT 非庫存品項對照', number);
  const payment = { pending: '等待付款', need_confirm: '等待確認付款', paid: '已付款', cod: '等待付款' }[order.payment_status];
  const fulfillment = { pending: '等待出貨', prepare: '等待出貨', send: '已出貨', shipped: '已出貨', delivered: '已出貨', received: '已出貨' }[order.logistic_status];
  const state = { pending: '等待確認', confirming: '確認中', confirmed: '已確認', processing: '處理中', completed: '已完成', cancelled: '已取消' }[order.progress_status];
  if (!payment || !fulfillment || !state || order.progress_status === 'completed' && ['pending', 'prepare'].includes(order.logistic_status)) fail('ONESHOP_STATUS_REVIEW_REQUIRED', '1Shop 付款或出貨狀態待核對', number);
  const paymentMethod = order.payment === 'cod' ? '貨到付款' : order.payment === 'c2c' ? '超商取貨付款' : checkedString(order.payment, number);
  if (!paymentMethod || order.payment_status === 'cod' && !['cod', 'c2c'].includes(order.payment)) fail('ONESHOP_PAYMENT_REVIEW_REQUIRED', '1Shop 貨到付款狀態與付款方式不一致', number);
  if (!Array.isArray(cart.products) || !cart.products.length || cart.products.length > 1000) fail('ONESHOP_RESPONSE_INVALID', '1Shop 商品明細未完整回傳', number);
  const apiItems = cart.products.map(product => {
    // The official v1 contract provides no bundle SKU/line ID or documented
    // edited/removed-line semantics. Do not invent Shopify currentQuantity or
    // identify bundle components by product names.
    if (product.product_type === 'bundle') fail('ONESHOP_BUNDLE_REVIEW_REQUIRED', '1Shop 組合商品需核對組合明細，不能推測子商品數量', number);
    if (product.product_type !== 'single') fail('ONESHOP_NONSTOCK_REVIEW_REQUIRED', '1Shop 訂單含費用品項，請確認 ECOUNT 非庫存品項對照', number);
    const count = quantity(product.quantity, number), unitMinor = money(product.per_cost, number), netMinor = money(product.line_total, number);
    if (!Number.isSafeInteger(unitMinor * count) || unitMinor * count !== netMinor) fail('ONESHOP_LINE_MONEY_INVALID', '1Shop 商品單價、數量與金額不一致', number);
    return { sku: sku(product.sku, number), quantity: count, netMinor };
  });
  if (sourceItems.some(item => item.kind !== 'single' || item.lineSubtotalMinor == null)) fail('ONESHOP_BUNDLE_REVIEW_REQUIRED', '1Shop 原始檔有組合或未定價商品，請核對完整組合明細', number);
  const originalItems = sourceItems.map(item => ({ sku: sku(item.sku, number), quantity: quantity(item.quantity, number), netMinor: item.lineSubtotalMinor }));
  if (hash(aggregate(originalItems, number)) !== hash(aggregate(apiItems, number))) fail('ONESHOP_ORDER_CHANGED', '1Shop 商品、數量或金額已變更，請重新匯出此訂單', number);
  const subtotalMinor = money(cart.sub_total, number), shippingMinor = money(cart.logistic_fee, number), feeMinor = money(cart.payment_fee, number), totalMinor = money(cart.total_price, number);
  if (money(order.total_price, number) !== totalMinor || apiItems.reduce((sum, item) => sum + item.netMinor, 0) !== subtotalMinor || subtotalMinor + shippingMinor + feeMinor !== totalMinor) fail('ONESHOP_TOTAL_MISMATCH', '1Shop 商品、運費、手續費與總額無法完整核對', number);
  if (source.financial.subtotalMinor !== subtotalMinor || source.financial.shippingMinor !== shippingMinor || source.financial.feeMinor !== feeMinor || source.financial.totalMinor !== totalMinor) fail('ONESHOP_ORDER_CHANGED', '1Shop 訂單金額或運費已變更，請重新匯出此訂單', number);
  const logistics = Object.fromEntries(['logistic', 'name', 'phone', 'country', 'zip_code', 'county_and_city', 'area', 'address', 'address_oversea', 'cvs_store_id', 'cvs_store_name', 'cvs_store_address', 'logistics_shipping_no'].map(key => [key, checkedString(order[key], number)]));
  const pickup = ['uni', 'uni_freeze', 'fami', 'fami_freeze', 'hilife', 'hilife_freeze', 'ezship'].includes(order.logistic);
  const address = pickup ? logistics.cvs_store_address : [logistics.county_and_city, logistics.area, logistics.address || logistics.address_oversea].filter(Boolean).join(' ');
  if (!logistics.name || !logistics.phone || (!address && order.logistic !== 'local_pickup') || pickup && (!logistics.cvs_store_id || !logistics.cvs_store_name)) fail('ONESHOP_SHIPPING_REVIEW_REQUIRED', '1Shop 收件資料或超商門市未完整回傳，請先核對', number);
  const methods = { home: '宅配', home_refrige: '宅配（冷藏）', home_freeze: '宅配（冷凍）', mailing: '郵寄', uni: '7-11 超商取貨', uni_freeze: '7-11 超商取貨（冷凍）', fami: '全家超商取貨', fami_freeze: '全家超商取貨（冷凍）', hilife: '萊爾富超商取貨', hilife_freeze: '萊爾富超商取貨（冷凍）', ezship: 'ezship 超商取貨', local_pickup: '門市自取', island: '宅配（台灣離島）', island_refrige: '宅配（台灣離島冷藏）', island_freeze: '宅配（台灣離島冷凍）', oversea: '宅配（海外）', oversea_other: '其他（海外）' };
  if (!methods[order.logistic]) fail('ONESHOP_SHIPPING_REVIEW_REQUIRED', '1Shop 運送方式無法核對', number);
  const values = { 訂單狀態: state, 金流狀態: payment, 物流狀態: fulfillment, 金流: paymentMethod, 顧客: logistics.name, 顧客電話: logistics.phone, 電話國碼: '', 運送地址: address, 物流: methods[order.logistic], 運送超商: pickup ? methods[order.logistic] : '', 超商代號: pickup ? logistics.cvs_store_id : '', 門市名稱: pickup ? logistics.cvs_store_name : '' };
  if (Object.hasOwn(order, 'logistics_shipping_no')) values.託運單號 = logistics.logistics_shipping_no;
  const evidence = { number, id: number, paymentStatus: order.payment_status === 'paid' ? 'paid' : 'pending', fulfillmentStatus: fulfillment === '已出貨' ? 'fulfilled' : 'unfulfilled', cancelled: order.progress_status === 'cancelled', currency: 'TWD', subtotalMinor, shippingMinor, feeMinor, totalMinor, items: aggregate(apiItems, number).map(([itemSku, value]) => ({ sku: itemSku, ...value })), shippingSource: '1shop-order', shippingFingerprint: hash(logistics) };
  evidence.fingerprint = hash({ ...evidence, paymentMethod, progressStatus: order.progress_status, logisticStatus: order.logistic_status });
  return { evidence, values };
}

async function verifyOneShopRows(rows, options = {}) {
  const appId = clean(options.appId), secret = clean(options.secret);
  if (!appId || !secret || appId.length > 500 || secret.length > 2000 || /[\r\n]/.test(appId + secret)) fail('ONESHOP_CONFIG_INVALID', '1Shop 連線設定不完整', undefined, 503);
  const resolved = { ...options, appId, secret, shopUrl: shopUrl(options.shopUrl), fetchImpl: options.fetchImpl || globalThis.fetch, timeoutMs: options.timeoutMs || 15000 };
  if (!Number.isFinite(resolved.timeoutMs) || resolved.timeoutMs < 1 || resolved.timeoutMs > 60000 || typeof resolved.fetchImpl !== 'function') fail('ONESHOP_CONFIG_INVALID', '1Shop 查詢設定無效', undefined, 503);
  const { parseUnifiedMarketplace } = await import('./unifiedMarketplace.mjs');
  const { source, parsed } = parseUnifiedMarketplace(rows);
  if (source.platform !== '1Shop' || source.rows.length > 1001 || !parsed.orders.length || parsed.orders.length > MAX_ORDERS || parsed.issues.some(issue => issue.severity === 'error')) fail('ONESHOP_SOURCE_INVALID', '1Shop 即時核對需完整原始檔，每批最多 50 筆訂單、1,000 商品列');
  const deadline = Date.now() + 60000, results = new Map(), requestTimes = [];
  for (const order of parsed.orders) {
    const number = order.sourceOrderNumber;
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(number)) fail('ONESHOP_SOURCE_INVALID', '1Shop 原始檔的訂單編號格式無效');
    const now = Date.now(); while (requestTimes.length && requestTimes[0] <= now - 10000) requestTimes.shift();
    if (requestTimes.length >= 10) {
      const delay = Math.max(1, requestTimes[0] + 10000 - now);
      if (now + delay >= deadline) fail('ONESHOP_TIMEOUT', '1Shop 核對逾時，請分批重試', number, 503);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    requestTimes.push(Date.now());
    const data = await readOrder(number, resolved, deadline);
    results.set(number, verifyOrder(order, parsed.items.filter(item => item.sourceOrderNumber === number), data, resolved));
  }
  const headers = [...source.rows[0]], orderColumn = headers.indexOf('訂單編號');
  for (const result of results.values()) for (const field of Object.keys(result.values)) if (!headers.includes(field)) headers.push(field);
  const outputRows = [headers, ...source.rows.slice(1).map(row => {
    const values = results.get(clean(row[orderColumn]))?.values;
    return headers.map((field, index) => values && Object.hasOwn(values, field) ? values[field] : row[index] ?? '');
  })];
  const orders = [...results.values()].map(result => result.evidence);
  const verification = { version: VERSION, platform: '1Shop', shop: resolved.shopUrl, connectionId: clean(options.connectionId), checkedAt: new Date().toISOString(), sourceFingerprint: hash(source.rows), orders };
  verification.fingerprint = hash([verification.version, verification.shop, verification.connectionId, orders.map(order => order.fingerprint)]);
  return { rows: outputRows, verification };
}

function createOneShopOrderVerifier(options = {}) {
  const env = options.env || process.env;
  return async (rows, context = {}) => {
    const connectionId = clean(context.apiConnectionId ?? options.connectionId);
    // Connecting a store is an explicit profile choice. Merely installing an
    // environment secret must not disable valid file-based conversions.
    if (!connectionId) return { rows, verification: null };
    let stores;
    if (options.stores) stores = options.stores;
    else if (clean(env.WMS_1SHOP_STORES_JSON)) {
      try { stores = JSON.parse(env.WMS_1SHOP_STORES_JSON); } catch { fail('ONESHOP_CONFIG_INVALID', '1Shop 多店連線設定格式無效', undefined, 503); }
    } else if (options.appId || options.secret || env.WMS_1SHOP_APP_ID || env.WMS_1SHOP_SECRET) stores = [{ account: options.connectionId || env.WMS_1SHOP_CONNECTION_ID, appId: options.appId || env.WMS_1SHOP_APP_ID, secret: options.secret || env.WMS_1SHOP_SECRET, shopUrl: options.shopUrl || env.WMS_1SHOP_SHOP_URL }];
    else fail('ONESHOP_CONFIG_MISSING', '此店鋪尚未設定 1Shop 訂單查核連線', undefined, 503);
    if (!Array.isArray(stores) || stores.length > 50 || stores.some(store => !store || typeof store !== 'object' || Array.isArray(store))) fail('ONESHOP_CONFIG_INVALID', '1Shop 多店連線設定格式無效', undefined, 503);
    const matches = stores.filter(store => clean(store.account) === connectionId);
    if (matches.length !== 1) fail('ONESHOP_CONNECTION_INVALID', '1Shop 店鋪連線不存在或重複', undefined, 503);
    const store = matches[0];
    let shopUrls = options.shopUrls;
    if (shopUrls == null && clean(env.WMS_1SHOP_SHOP_URLS_JSON)) {
      try { shopUrls = JSON.parse(env.WMS_1SHOP_SHOP_URLS_JSON); } catch { fail('ONESHOP_CONFIG_INVALID', '1Shop 商店網址綁定格式無效', undefined, 503); }
    }
    if (shopUrls != null && (typeof shopUrls !== 'object' || Array.isArray(shopUrls) || Object.keys(shopUrls).length > 50 || Object.entries(shopUrls).some(([key, value]) => !key || key.length > 100 || typeof value !== 'string' || value.length > 1000))) fail('ONESHOP_CONFIG_INVALID', '1Shop 商店網址綁定格式無效', undefined, 503);
    return verifyOneShopRows(rows, { ...options, ...store, connectionId, shopUrl: store.shopUrl || shopUrls?.[connectionId] });
  };
}

module.exports = { verifyOneShopRows, createOneShopOrderVerifier };
