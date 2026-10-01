const { createHash } = require('node:crypto');

const VERSION = 'shopline-exact-current-v1';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const clean = value => String(value ?? '').trim();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code, message, orderNumber, status = 400) => { throw Object.assign(new Error(message), { code, status, ...(orderNumber ? { orderNumber } : {}) }); };
const orderNumber = value => clean(value).replace(/^#/, '');
const id = value => /^[a-f0-9]{24}$/.test(clean(value));
function decimalMinor(value, number) {
  const str = typeof value === 'number' || typeof value === 'string' ? String(value) : '';
  if (!/^\d+(?:\.\d{1,2})?$/.test(str)) fail('SHOPLINE_MONEY_INVALID', 'SHOPLINE 金額無法核對', number);
  const [whole, fraction = ''] = str.split('.');
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) fail('SHOPLINE_MONEY_INVALID', 'SHOPLINE 金額超出可處理範圍', number);
  return Number(result);
}
function money(value, number, optional = false) {
  if (optional && value == null) return 0;
  if (!value || value.currency_iso !== 'TWD' || value.cents == null) fail('SHOPLINE_MONEY_INVALID', 'SHOPLINE 金額或幣別無法核對', number);
  // SHOPLINE's documented TWD Money.cents are dollars, unlike HKD/USD cents.
  const result = decimalMinor(value.cents, number);
  if (value.dollars != null && decimalMinor(value.dollars, number) !== result) fail('SHOPLINE_MONEY_INVALID', 'SHOPLINE 金額欄位彼此不一致', number);
  return result;
}
function allocation(item, field, number) {
  const values = [item[field], item.item_data?.[field]].filter(value => value != null).map(value => money(value, number));
  if (values.length === 2 && values[0] !== values[1]) fail('SHOPLINE_DISCOUNT_REVIEW_REQUIRED', 'SHOPLINE 商品折扣欄位彼此不一致', number);
  return values[0] ?? 0;
}
function checkedString(value, number) {
  if (value != null && (typeof value !== 'string' || value.length > 1000 || /[\u0000-\u001f\u007f]/.test(value))) fail('SHOPLINE_RESPONSE_INVALID', 'SHOPLINE 訂單資料格式無效', number);
  return clean(value);
}
function aggregate(items, number) {
  const result = new Map();
  for (const item of items) {
    const previous = result.get(item.sku) || { quantity: 0, grossMinor: 0, netMinor: 0 };
    const current = { quantity: previous.quantity + item.quantity, grossMinor: previous.grossMinor + item.grossMinor, netMinor: previous.netMinor + item.netMinor };
    if (!Object.values(current).every(Number.isSafeInteger)) fail('SHOPLINE_RESPONSE_INVALID', 'SHOPLINE 商品加總超出可處理範圍', number);
    result.set(item.sku, current);
  }
  return [...result].sort(([a], [b]) => a.localeCompare(b));
}

async function request(path, params, options, deadline) {
  const remaining = Math.min(options.timeoutMs, deadline - Date.now());
  if (remaining <= 0) fail('SHOPLINE_TIMEOUT', 'SHOPLINE 核對逾時，請分批重試', undefined, 503);
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error('SHOPLINE 核對逾時，請重試'), { code: 'SHOPLINE_TIMEOUT', status: 503 })); }, remaining); });
  try {
    return await Promise.race([timeout, (async () => {
      const url = new URL(`https://open.shopline.io/v1/${path}`);
      for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, String(value));
      let response;
      try { response = await options.fetchImpl(url.toString(), { method: 'GET', redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json', Authorization: `Bearer ${options.token}` } }); }
      catch { fail('SHOPLINE_UNAVAILABLE', 'SHOPLINE 連線失敗，請重試', undefined, 503); }
      if (Number(response.headers?.get?.('content-length')) > MAX_RESPONSE_BYTES) fail('SHOPLINE_RESPONSE_INVALID', 'SHOPLINE 核對回應超出大小限制', undefined, 503);
      let payload;
      try { const body = await response.text(); if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) fail('SHOPLINE_RESPONSE_INVALID', 'SHOPLINE 核對回應超出大小限制', undefined, 503); payload = JSON.parse(body); }
      catch (error) { if (error.code === 'SHOPLINE_RESPONSE_INVALID') throw error; fail('SHOPLINE_RESPONSE_INVALID', 'SHOPLINE 核對回應無效', undefined, 503); }
      const vendorError = [payload?.message, payload?.error, payload?.reason].filter(value => typeof value === 'string').join(' ');
      if (/white.?list|白名單|IP Address/i.test(vendorError)) fail('SHOPLINE_IP_NOT_ALLOWED', 'SHOPLINE 尚未允許此連線 IP，請確認 API 白名單', undefined, 503);
      if (response.status === 429) fail('SHOPLINE_RATE_LIMITED', 'SHOPLINE 查詢次數已達上限，請稍後重試', undefined, 503);
      if (response.status === 404 || response.status === 410 || payload?.reason === 'order_removed') fail('SHOPLINE_ORDER_MISSING', 'SHOPLINE 訂單不存在、已移除或已封存，請先核對');
      if (!response.ok) fail(response.status === 401 || response.status === 403 ? 'SHOPLINE_ACCESS_DENIED' : 'SHOPLINE_QUERY_FAILED', 'SHOPLINE 未完整回傳訂單，請確認讀取授權；未使用舊資料', undefined, 503);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.error && (typeof payload.error === 'string' || Object.values(payload.error).some(value => Array.isArray(value) ? value.length : Boolean(value)))) fail('SHOPLINE_QUERY_FAILED', 'SHOPLINE 訂單查詢未完成，請重新核對', undefined, 503);
      return payload;
    })()]);
  } finally { clearTimeout(timer); }
}

function createdDay(value, number) {
  const str = clean(value);
  let epoch;
  if (/^\d+(?:\.\d+)?$/.test(str)) {
    const serial = Number(str);
    if (serial < 40000 || serial > 100000) fail('SHOPLINE_SOURCE_DATE_INVALID', 'SHOPLINE 訂單日期無法核對', number);
    epoch = Math.round((serial - 25569) * 86400000) - 8 * 3600000;
  } else if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.test(str)) epoch = Date.parse(str.replaceAll('/', '-').replace(' ', 'T') + (str.includes(':') ? '+08:00' : 'T00:00:00+08:00'));
  else if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(str)) epoch = Date.parse(str);
  if (!Number.isFinite(epoch)) fail('SHOPLINE_SOURCE_DATE_INVALID', 'SHOPLINE 訂單日期缺漏或無法核對', number);
  return Math.floor((epoch + 8 * 3600000) / 86400000) * 86400000 - 8 * 3600000;
}

async function locateOrders(sources, options, deadline) {
  const days = sources.map(source => createdDay(source.createdAt, source.sourceOrderNumber));
  const start = Math.min(...days), end = Math.max(...days) + 86400000;
  if (end - start > 7 * 86400000) fail('SHOPLINE_SOURCE_RANGE_INVALID', 'SHOPLINE 即時核對每批最多七天訂單，請分批上傳');
  const wanted = new Set(sources.map(source => orderNumber(source.sourceOrderNumber))), result = new Map(), seenIds = new Set();
  let totalPages;
  for (let page = 1; page <= 20; page++) {
    const data = await request('orders', { created_after: new Date(start).toISOString(), created_before: new Date(end - 1).toISOString(), per_page: 50, page, sort_by: 'asc' }, options, deadline);
    if (!Array.isArray(data.items) || data.items.length > 50 || !data.pagination || data.pagination.current_page !== page || !Number.isSafeInteger(data.pagination.total_pages) || data.pagination.total_pages < 0 || data.pagination.total_pages > 20) fail('SHOPLINE_PAGINATION_INVALID', 'SHOPLINE 訂單分頁未完整回傳，請分批重試', undefined, 503);
    if (totalPages != null && totalPages !== data.pagination.total_pages) fail('SHOPLINE_ORDER_CHANGED', 'SHOPLINE 訂單列表在核對期間已變更，請重試');
    totalPages = data.pagination.total_pages;
    if (!data.items.length && totalPages > page) fail('SHOPLINE_PAGINATION_INVALID', 'SHOPLINE 訂單分頁中斷，請重試', undefined, 503);
    for (const order of data.items) {
      if (!id(order.id) || seenIds.has(order.id) || !clean(order.order_number)) fail('SHOPLINE_PAGINATION_INVALID', 'SHOPLINE 訂單 ID 重複或格式無效', undefined, 503);
      seenIds.add(order.id);
      const number = orderNumber(order.order_number);
      if (wanted.has(number)) {
        if (result.has(number)) fail('SHOPLINE_ORDER_AMBIGUOUS', 'SHOPLINE 同一訂單編號對應多筆資料，請核對');
        result.set(number, order.id);
      }
    }
    if (page >= totalPages) break;
    if (page === 20) fail('SHOPLINE_LIMIT_EXCEEDED', 'SHOPLINE 日期範圍超過 1,000 筆訂單，請分批核對');
  }
  for (const source of sources) if (!result.has(orderNumber(source.sourceOrderNumber))) fail('SHOPLINE_ORDER_MISSING', 'SHOPLINE 找不到此訂單，請核對店鋪及重新匯出', source.sourceOrderNumber);
  return result;
}

function verifyOrder(source, sourceItems, order, expectedId) {
  const number = source.sourceOrderNumber;
  if (order.id !== expectedId || orderNumber(order.order_number) !== orderNumber(number)) fail('SHOPLINE_ORDER_MISMATCH', 'SHOPLINE 訂單 ID 或編號與原始檔不一致', number);
  if (order.currency_iso !== 'TWD') fail('SHOPLINE_CURRENCY_UNSUPPORTED', 'SHOPLINE 訂單幣別須為 TWD', number);
  if (!Number.isFinite(Date.parse(order.updated_at))) fail('SHOPLINE_RESPONSE_INVALID', 'SHOPLINE 缺少訂單更新時間', number);
  if (order.parent_order_id || order.split_at || order.child_order_ids?.length || order.combined_to_order_id || order.combined_from_order_ids?.length || order.return_from_order_id || ['exchange', 'return'].includes(order.type)) fail('SHOPLINE_SPLIT_REVIEW_REQUIRED', 'SHOPLINE 訂單有拆單、合單或退換貨，請先核對來源明細', number);
  const payment = order.order_payment, delivery = order.order_delivery;
  if (!payment || !delivery || ['refunding', 'refunded', 'partially_refunded'].includes(payment.status) || (source.financial.refundedMinor ?? 0) > 0) fail('SHOPLINE_REFUND_REVIEW_REQUIRED', 'SHOPLINE 訂單有退款或付款資料不完整，請先核對', number);
  const paymentStatus = { temp: '未付款', pending: '未付款', failed: '付款失敗', expired: '付款已逾期', completed: '已付款' }[payment.status];
  const fulfillmentStatus = { pending: '備貨中', shipping: '已出貨', shipped: '已出貨', arrived: '已出貨', collected: '已出貨' }[delivery.status];
  const state = { pending: '處理中', confirmed: '已確認', completed: '已完成', cancelled: '已取消' }[order.status];
  if (!paymentStatus || !fulfillmentStatus || !state || order.status === 'completed' && delivery.status === 'pending' || ['failed', 'expired', 'returning', 'returned', 'store_closed', 'returning_store_closed'].includes(delivery.delivery_status)) fail('SHOPLINE_STATUS_REVIEW_REQUIRED', 'SHOPLINE 付款或配送狀態待核對', number);
  if (!Array.isArray(order.subtotal_items) || !order.subtotal_items.length || order.subtotal_items.length > 1000) fail('SHOPLINE_RESPONSE_INVALID', 'SHOPLINE 商品明細未完整回傳', number);
  const lineIds = new Set();
  const items = order.subtotal_items.map(item => {
    if (!id(item.id) || lineIds.has(item.id)) fail('SHOPLINE_LINE_ID_INVALID', 'SHOPLINE 商品明細 ID 重複或無效', number);
    lineIds.add(item.id);
    if (!['Product', 'AddonProduct', 'Gift', 'CustomProduct'].includes(item.item_type)) fail('SHOPLINE_BUNDLE_REVIEW_REQUIRED', 'SHOPLINE 組合商品需核對子商品及價格分攤', number);
    const itemSku = clean(item.sku);
    if (!itemSku || itemSku.length > 100 || /[\u0000-\u001f\u007f]/.test(itemSku) || /^[+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?\d+$/.test(itemSku)) fail('SHOPLINE_SKU_INVALID', 'SHOPLINE 商品缺少完整貨號，請核對商品設定', number);
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.quantity > 50000) fail('SHOPLINE_QUANTITY_INVALID', 'SHOPLINE 商品數量無法核對', number);
    const unitMinor = money(item.item_price, number), grossMinor = money(item.total, number);
    if (!Number.isSafeInteger(unitMinor * item.quantity) || unitMinor * item.quantity !== grossMinor) fail('SHOPLINE_LINE_MONEY_INVALID', 'SHOPLINE 商品單價、數量與金額不一致', number);
    const discounts = Object.fromEntries(['discounted_price', 'order_discounted_price', 'custom_discounted_amount', 'user_credit_ratio_amount', 'member_point_redeem_to_cash_ratio_amount'].map(field => [field, allocation(item, field, number)]));
    const discountMinor = Object.values(discounts).reduce((sum, value) => sum + value, 0), netMinor = grossMinor - discountMinor;
    if (!Number.isSafeInteger(discountMinor) || netMinor < 0) fail('SHOPLINE_DISCOUNT_REVIEW_REQUIRED', 'SHOPLINE 商品折扣分攤超過成交金額', number);
    return { id: item.id, sku: itemSku, quantity: item.quantity, grossMinor, netMinor, discounts };
  });
  const subtotalMinor = money(order.subtotal, number), totalMinor = money(order.total, number), shippingMinor = money(delivery.total, number), feeMinor = money(payment.payment_fee, number), taxMinor = money(order.total_tax_fee, number);
  const discountMinor = money(order.order_discount, number), creditMinor = money(order.user_credit, number), pointsMinor = money(order.order_points_to_cash, number, true);
  const sum = field => items.reduce((total, item) => total + (field in item ? item[field] : item.discounts[field]), 0);
  const customMinor = sum('custom_discounted_amount'), netMinor = sum('netMinor');
  if (subtotalMinor !== sum('grossMinor') || sum('discounted_price') + sum('order_discounted_price') !== discountMinor || sum('user_credit_ratio_amount') !== creditMinor || sum('member_point_redeem_to_cash_ratio_amount') !== pointsMinor || netMinor + shippingMinor + feeMinor + taxMinor !== totalMinor || money(payment.total, number) !== totalMinor) fail('SHOPLINE_TOTAL_MISMATCH', 'SHOPLINE 商品、折扣、運費與總額尚無法完整核對', number);
  if (feeMinor || taxMinor) fail('SHOPLINE_FINANCIAL_REVIEW_REQUIRED', 'SHOPLINE 另有附加費或稅費，請先確認 ECOUNT 計價及品項對照', number);
  const fileItems = sourceItems.map(item => ({ sku: item.sku, quantity: item.quantity, grossMinor: item.unitPriceMinor * item.quantity, netMinor: item.lineSubtotalMinor }));
  if (fileItems.some(item => !Number.isSafeInteger(item.grossMinor) || !Number.isSafeInteger(item.netMinor)) || hash(aggregate(fileItems, number)) !== hash(aggregate(items, number))) fail('SHOPLINE_ORDER_CHANGED', 'SHOPLINE 商品、數量或金額已變更，請重新匯出此訂單', number);
  const sourceMoney = source.financial;
  if (sourceMoney.totalMinor !== totalMinor || sourceMoney.shippingMinor !== shippingMinor || (sourceMoney.nativeNetSubtotalMinor ?? sourceMoney.subtotalMinor) !== netMinor || (sourceMoney.discountMinor ?? 0) !== discountMinor || (sourceMoney.customDiscountMinor ?? 0) !== customMinor || (sourceMoney.creditMinor ?? 0) !== creditMinor || (sourceMoney.pointsMinor ?? 0) !== pointsMinor) fail('SHOPLINE_ORDER_CHANGED', 'SHOPLINE 折扣、運費或訂單金額已變更，請重新匯出此訂單', number);
  const cod = ['cash_on_delivery', 'customtw_711_b2c_pay', 'tw_711_pay', 'sl_logistics_ninjavan_cod', 'sl_logistics_kerry_th_cod', 'sl_logistics_ghtk_cod', 'sl_logistics_janio_cod', 'sl_logistics_poslaju_cod'].includes(payment.payment_type);
  const paymentMethod = cod ? '貨到付款' : checkedString(payment.name_translations?.['zh-hant'] || payment.name_translations?.en || payment.payment_type, number);
  if (!paymentMethod) fail('SHOPLINE_PAYMENT_REVIEW_REQUIRED', 'SHOPLINE 付款方式無法核對', number);
  const shipping = order.delivery_address, logistics = order.delivery_data;
  const values = { 訂單狀態: state, 付款狀態: paymentStatus, 送貨狀態: fulfillmentStatus, 付款方式: paymentMethod };
  const exclusionReason = order.status === 'cancelled' ? '已取消訂單' : payment.status === 'failed' ? '付款失敗' : payment.status === 'expired' ? '付款期限已過' : '';
  for (const value of [payment.updated_at, delivery.updated_at]) if (value != null && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))) fail('SHOPLINE_RESPONSE_INVALID', 'SHOPLINE 付款或物流更新時間格式無效', number);
  const finish = shippingSource => {
    const evidence = { number, id: order.id, updatedAt: order.updated_at, paymentUpdatedAt: payment.updated_at || null, deliveryUpdatedAt: delivery.updated_at || null, cancelled: order.status === 'cancelled', paymentStatus: { completed: 'paid', failed: 'failed', expired: 'expired' }[payment.status] || 'pending', fulfillmentStatus: delivery.status === 'pending' ? 'unfulfilled' : 'fulfilled', currency: 'TWD', subtotalMinor: netMinor, shippingMinor, totalMinor, discountMinor: subtotalMinor - netMinor, items: items.map(({ id: lineId, sku: itemSku, quantity: count, netMinor: amount }) => ({ id: lineId, sku: itemSku, quantity: count, netMinor: amount })), shippingSource, ...(exclusionReason ? { excluded: true, exclusionReason } : {}) };
    evidence.fingerprint = hash({ ...evidence, values });
    return { evidence, values };
  };
  // Identity, status and all money checks above still apply. A proven excluded
  // order needs no current shipping address because it cannot create warehouse work.
  if (exclusionReason) return finish('excluded-current-order');
  let shippingSource = 'source-file';
  if (!shipping || typeof shipping !== 'object' || Array.isArray(shipping)) fail('SHOPLINE_SHIPPING_REVIEW_REQUIRED', 'SHOPLINE 收件資料未完整回傳，請先核對', number);
  if (shipping && typeof shipping === 'object' && !Array.isArray(shipping)) {
    for (const field of ['recipient_name', 'recipient_phone', 'country_code', 'city', 'state', 'district', 'address_1', 'address_2', 'postcode']) checkedString(shipping[field], number);
    Object.assign(values, { 收件人: clean(shipping.recipient_name), 收件人電話號碼: clean(shipping.recipient_phone), '郵政編號（如適用)': clean(shipping.postcode), 完整地址: [...new Set(['state', 'city', 'district', 'address_2', 'address_1'].map(field => clean(shipping[field])).filter(Boolean))].join(' ') });
    shippingSource = 'shopline-order';
  }
  if (logistics && typeof logistics === 'object' && !Array.isArray(logistics)) {
    for (const field of ['location_name', 'location_code', 'store_address', 'tracking_number']) checkedString(logistics[field], number);
    if (logistics.location_name != null) values.門市名稱 = clean(logistics.location_name);
    if (logistics.location_code != null) values['全家服務編號 / 7-11 店號'] = clean(logistics.location_code);
    if (logistics.tracking_number != null) values.送貨編號 = clean(logistics.tracking_number);
    if (['pickup', 'store_pickup'].includes(delivery.delivery_type) && clean(logistics.store_address)) values.完整地址 = clean(logistics.store_address);
  }
  const method = checkedString(delivery.name_translations?.['zh-hant'] || delivery.name_translations?.en, number);
  if (method) values.送貨方式 = method;
  if (delivery.remark != null) values.出貨備註 = checkedString(delivery.remark, number);
  if (!values.收件人 || !values.收件人電話號碼 || !values.完整地址 && delivery.delivery_type !== 'store_pickup') fail('SHOPLINE_SHIPPING_REVIEW_REQUIRED', 'SHOPLINE 收件人、電話或地址未完整回傳，請先核對', number);
  return finish(shippingSource);
}

async function verifyShoplineRows(rows, options = {}) {
  const token = clean(options.token), merchantId = clean(options.merchantId), handle = clean(options.handle);
  if (!token || token.length > 4000 || /[\r\n]/.test(token) || !id(merchantId) || handle && !/^[a-z0-9][a-z0-9-]{0,100}$/i.test(handle)) fail('SHOPLINE_CONFIG_INVALID', 'SHOPLINE 連線需設定讀取憑證及已確認的商店 ID', undefined, 503);
  const resolved = { ...options, token, merchantId, handle, fetchImpl: options.fetchImpl || globalThis.fetch, timeoutMs: options.timeoutMs || 15000 };
  if (!Number.isFinite(resolved.timeoutMs) || resolved.timeoutMs < 1 || resolved.timeoutMs > 60000 || typeof resolved.fetchImpl !== 'function') fail('SHOPLINE_CONFIG_INVALID', 'SHOPLINE 查詢設定無效', undefined, 503);
  const { parseUnifiedMarketplace } = await import('./unifiedMarketplace.mjs');
  const { source, parsed } = parseUnifiedMarketplace(rows);
  if (source.platform !== 'SHOPLINE' || source.rows.length > 1001 || !parsed.orders.length || parsed.orders.length > 50 || parsed.issues.some(issue => issue.severity === 'error')) fail('SHOPLINE_SOURCE_INVALID', 'SHOPLINE 即時核對需完整原始檔，每批最多 50 筆訂單、1,000 商品列');
  const numbers = parsed.orders.map(order => orderNumber(order.sourceOrderNumber));
  if (new Set(numbers).size !== numbers.length || numbers.some(number => !number || number.length > 100 || /[\u0000-\u001f\u007f]/.test(number))) fail('SHOPLINE_SOURCE_INVALID', 'SHOPLINE 原始檔訂單編號重複或格式無效');
  const deadline = Date.now() + 60000, info = await request('token/info', {}, resolved, deadline);
  if (info.merchant?._id !== merchantId || handle && info.merchant?.handle !== handle) fail('SHOPLINE_SHOP_MISMATCH', 'SHOPLINE 讀取憑證與所選商店不一致', undefined, 503);
  const ids = await locateOrders(parsed.orders, resolved, deadline), results = new Map();
  for (const order of parsed.orders) {
    const expectedId = ids.get(orderNumber(order.sourceOrderNumber));
    const current = await request(`orders/${expectedId}`, {}, resolved, deadline);
    results.set(order.sourceOrderNumber, verifyOrder(order, parsed.items.filter(item => item.sourceOrderNumber === order.sourceOrderNumber), current, expectedId));
  }
  const headers = [...source.rows[0]], numberColumn = headers.indexOf('訂單號碼');
  for (const result of results.values()) for (const field of Object.keys(result.values)) if (!headers.includes(field)) headers.push(field);
  let previous = '';
  const outputRows = [headers, ...source.rows.slice(1).map(row => {
    const number = clean(row[numberColumn]) || previous; previous = number;
    const values = results.get(number)?.values;
    return headers.map((field, index) => values && Object.hasOwn(values, field) ? values[field] : row[index] ?? '');
  })];
  const orders = [...results.values()].map(result => result.evidence);
  const verification = { version: VERSION, platform: 'SHOPLINE', shop: merchantId, merchantId, handle: clean(info.merchant?.handle), connectionId: clean(options.connectionId), checkedAt: new Date().toISOString(), sourceFingerprint: hash(source.rows), orders };
  verification.fingerprint = hash([verification.version, verification.shop, verification.connectionId, orders.map(order => order.fingerprint)]);
  return { rows: outputRows, verification };
}

function createShoplineOrderVerifier(options = {}) {
  const env = options.env || process.env;
  return async (rows, context = {}) => {
    const connectionId = clean(context.apiConnectionId ?? options.connectionId);
    if (!connectionId) return { rows, verification: null };
    const configuredId = clean(options.connectionId || env.WMS_SHOPLINE_CONNECTION_ID);
    if (!configuredId || configuredId !== connectionId) fail('SHOPLINE_CONNECTION_INVALID', 'SHOPLINE 店鋪連線不存在或未綁定', undefined, 503);
    return verifyShoplineRows(rows, { ...options, connectionId, token: options.token || env.WMS_SHOPLINE_ACCESS_TOKEN, merchantId: options.merchantId || env.WMS_SHOPLINE_MERCHANT_ID, handle: options.handle || env.WMS_SHOPLINE_HANDLE });
  };
}

module.exports = { verifyShoplineRows, createShoplineOrderVerifier };
