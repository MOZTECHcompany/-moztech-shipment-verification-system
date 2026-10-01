const { createHash } = require('node:crypto');

const VERSION = 'shopify-current-v1';
const MAX_SOURCE_ROWS = 1000;
const MAX_ORDERS = 250;
const MAX_ORDER_LINES = 1000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MONEY_FIELDS = ['currentSubtotalPriceSet', 'currentShippingPriceSet', 'currentTotalDiscountsSet', 'currentTotalTaxSet', 'currentTotalPriceSet', 'totalOutstandingSet', 'totalReceivedSet', 'totalRefundedSet'];
const MONEY_SELECTION = '{ shopMoney { amount currencyCode } }';
const QUERY = `query WmsCurrentOrder($id: ID!, $after: String) {
  shop { myshopifyDomain }
  order(id: $id) {
    id name updatedAt createdAt edited cancelledAt currencyCode presentmentCurrencyCode taxesIncluded
    displayFinancialStatus displayFulfillmentStatus paymentGatewayNames discountCodes
    currentSubtotalLineItemsQuantity
    shippingAddress { name phone address1 address2 city zip province provinceCode country countryCodeV2 company }
    shippingLines(first: 50) { nodes { title } pageInfo { hasNextPage } }
    ${MONEY_FIELDS.map(name => `${name} ${MONEY_SELECTION}`).join('\n')}
    currentTotalAdditionalFeesSet ${MONEY_SELECTION}
    currentTotalDutiesSet ${MONEY_SELECTION}
    totalTipReceivedSet ${MONEY_SELECTION}
    lineItems(first: 100, after: $after) {
      nodes {
        id name sku quantity currentQuantity unfulfilledQuantity requiresShipping taxable
        originalUnitPriceSet ${MONEY_SELECTION}
        priceAfterAllDiscountsBeforeTaxesSet ${MONEY_SELECTION}
        variant { barcode }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
const text = value => value == null ? '' : String(value).trim();
const fail = (code, message, orderNumber, status = 400) => { throw Object.assign(new Error(message), { code, status, ...(orderNumber ? { orderNumber } : {}) }); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function domain(value) {
  const normalized = text(value).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized)) fail('SHOPIFY_CONFIG_INVALID', 'Shopify 店鋪連線設定無效', undefined, 503);
  return normalized;
}

function money(bag, currency, field, orderNumber, optional = false) {
  if (optional && bag == null) return 0;
  const value = bag?.shopMoney;
  if (!value || value.currencyCode !== currency || typeof value.amount !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value.amount)) fail('SHOPIFY_MONEY_INVALID', `Shopify「${field}」金額或幣別無法核對`, orderNumber);
  const [whole, cents = ''] = value.amount.split('.');
  const amount = BigInt(whole) * 100n + BigInt(cents.padEnd(2, '0'));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) fail('SHOPIFY_MONEY_INVALID', 'Shopify 金額超出可安全處理範圍', orderNumber);
  return Number(amount);
}
const formatMoney = minor => `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
const quantity = (value, orderNumber) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 50000) fail('SHOPIFY_QUANTITY_INVALID', 'Shopify 商品數量無法核對', orderNumber);
  return value;
};

function sourceOrders(rows) {
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > MAX_SOURCE_ROWS + 1 || rows.some(row => !Array.isArray(row) || row.length > 200)) fail('SHOPIFY_SOURCE_INVALID', 'Shopify 原始訂單檔最多 1,000 商品列、200 欄');
  if (rows.some(row => row.some(value => !['string', 'number', 'boolean'].includes(typeof value) && value != null || String(value ?? '').length > 5000))) fail('SHOPIFY_SOURCE_INVALID', 'Shopify 原始訂單儲存格格式無效');
  const headers = rows[0].map(text);
  if (new Set(headers).size !== headers.length || !['Name', 'Id', 'Lineitem sku', 'Lineitem quantity', 'Lineitem price'].every(name => headers.includes(name))) fail('SHOPIFY_SOURCE_INVALID', 'Shopify 原始檔缺少訂單 ID 或商品欄位');
  const orders = new Map(), ids = new Set();
  let previous = '';
  for (const row of rows.slice(1)) {
    if (!row.some(value => text(value))) continue;
    const record = Object.fromEntries(headers.map((key, i) => [key, row[i] ?? '']));
    const name = text(record.Name) || previous;
    if (!name || name.length > 100) fail('SHOPIFY_SOURCE_INVALID', 'Shopify 商品列缺少訂單編號');
    previous = name;
    let order = orders.get(name);
    if (!order) { order = { name, id: '', records: [] }; orders.set(name, order); }
    const id = text(record.Id);
    if (id) {
      if (!/^\d{1,25}$/.test(id) || order.id && order.id !== id || !order.id && ids.has(id)) fail('SHOPIFY_SOURCE_ID_INVALID', 'Shopify 訂單 ID 重複或不一致', name);
      order.id = id; ids.add(id);
    }
    order.records.push(record);
  }
  if (!orders.size || orders.size > MAX_ORDERS) fail('SHOPIFY_SOURCE_INVALID', 'Shopify 即時核對每批最多 250 筆訂單');
  for (const order of orders.values()) if (!order.id) fail('SHOPIFY_SOURCE_ID_REQUIRED', 'Shopify 原始檔缺少訂單 ID，請重新匯出', order.name);
  return { headers, orders: [...orders.values()] };
}

async function requestOrder(options, id, after, deadline) {
  const controller = new AbortController();
  let timer;
  const remaining = Math.min(options.timeoutMs, deadline - Date.now());
  if (remaining <= 0) fail('SHOPIFY_TIMEOUT', 'Shopify 核對逾時，請重試；未使用舊資料', undefined, 503);
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error('Shopify 核對逾時，請重試；未使用舊資料'), { status: 503, code: 'SHOPIFY_TIMEOUT' })); }, remaining);
  });
  try {
    return await Promise.race([timeout, (async () => {
      let response;
      try {
        response = await options.fetchImpl(`https://${options.shop}/admin/api/${options.apiVersion}/graphql.json`, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': options.token },
          body: JSON.stringify({ query: QUERY, variables: { id: `gid://shopify/Order/${id}`, after } }),
        });
      } catch { fail('SHOPIFY_UNAVAILABLE', 'Shopify 連線失敗，請重試；未使用舊資料', undefined, 503); }
      if (!response.ok) fail(response.status === 401 || response.status === 403 ? 'SHOPIFY_ACCESS_DENIED' : 'SHOPIFY_UNAVAILABLE', response.status === 401 || response.status === 403 ? 'Shopify 訂單讀取權限不足，請檢查連線授權' : 'Shopify 暫時無法核對，請稍後重試', undefined, 503);
      if (Number(response.headers?.get?.('content-length')) > MAX_RESPONSE_BYTES) fail('SHOPIFY_RESPONSE_INVALID', 'Shopify 核對回應超出大小限制', undefined, 503);
      let payload;
      try {
        const raw = await response.text();
        if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) fail('SHOPIFY_RESPONSE_INVALID', 'Shopify 核對回應超出大小限制', undefined, 503);
        payload = JSON.parse(raw);
      } catch (error) {
        if (error.code === 'SHOPIFY_RESPONSE_INVALID') throw error;
        fail('SHOPIFY_RESPONSE_INVALID', 'Shopify 核對回應無效，請重試', undefined, 503);
      }
      if (payload.errors?.length || !payload.data || typeof payload.data !== 'object') {
        const denied = payload.errors?.some(error => error.extensions?.code === 'ACCESS_DENIED');
        fail(denied ? 'SHOPIFY_ACCESS_DENIED' : 'SHOPIFY_QUERY_FAILED', denied ? 'Shopify 訂單讀取權限不足，請檢查連線授權' : 'Shopify 未完整回傳訂單，請重試；未使用舊資料', undefined, 503);
      }
      if (text(payload.data.shop?.myshopifyDomain).toLowerCase() !== options.shop) fail('SHOPIFY_SHOP_MISMATCH', 'Shopify 回應店鋪與設定不一致', undefined, 503);
      return payload.data.order;
    })()]);
  } finally { clearTimeout(timer); }
}

async function readOrder(source, options, deadline) {
  const items = [], seenIds = new Set(), seenCursors = new Set();
  let after = null, first;
  for (let page = 0; page < MAX_ORDER_LINES / 100 + 1; page++) {
    const current = await requestOrder(options, source.id, after, deadline);
    if (!current) fail('SHOPIFY_ORDER_MISSING', 'Shopify 找不到此訂單，請核對店鋪及訂單權限', source.name);
    if (current.id !== `gid://shopify/Order/${source.id}` || current.name !== source.name) fail('SHOPIFY_ORDER_MISMATCH', 'Shopify 訂單 ID 或編號與原始檔不一致', source.name);
    if (!current.updatedAt || Number.isNaN(Date.parse(current.updatedAt))) fail('SHOPIFY_RESPONSE_INVALID', 'Shopify 缺少訂單更新時間', source.name);
    if (!first) first = current;
    else if (current.updatedAt !== first.updatedAt || hash(Object.fromEntries(MONEY_FIELDS.map(field => [field, current[field]]))) !== hash(Object.fromEntries(MONEY_FIELDS.map(field => [field, first[field]])))) fail('SHOPIFY_ORDER_CHANGED', 'Shopify 訂單在核對期間已修改，請重試', source.name);
    const connection = current.lineItems;
    if (!Array.isArray(connection?.nodes) || typeof connection?.pageInfo?.hasNextPage !== 'boolean') fail('SHOPIFY_RESPONSE_INVALID', 'Shopify 商品明細未完整回傳', source.name);
    for (const item of connection.nodes) {
      if (!/^gid:\/\/shopify\/LineItem\/\d+$/.test(item?.id) || seenIds.has(item.id)) fail('SHOPIFY_LINE_ID_INVALID', 'Shopify 商品明細 ID 重複或無效', source.name);
      seenIds.add(item.id); items.push(item);
    }
    if (items.length > MAX_ORDER_LINES) fail('SHOPIFY_LIMIT_EXCEEDED', '單筆 Shopify 訂單超過 1,000 商品明細，請分批處理', source.name);
    if (!connection.pageInfo.hasNextPage) return { ...first, items };
    after = connection.pageInfo.endCursor;
    if (!after || seenCursors.has(after)) fail('SHOPIFY_PAGINATION_INVALID', 'Shopify 商品分頁未完整讀取，請重試', source.name);
    seenCursors.add(after);
  }
  fail('SHOPIFY_LIMIT_EXCEEDED', 'Shopify 商品分頁超出核對上限', source.name);
}

function normalizeOrder(source, order) {
  const name = source.name, currency = order.currencyCode;
  if (currency !== 'TWD' || order.presentmentCurrencyCode !== 'TWD') fail('SHOPIFY_CURRENCY_UNSUPPORTED', 'Shopify 店鋪與顧客付款幣別均須為 TWD', name);
  const amounts = Object.fromEntries(MONEY_FIELDS.map(field => [field, money(order[field], currency, field, name)]));
  if (amounts.totalRefundedSet > 0 || ['PARTIALLY_REFUNDED', 'REFUNDED'].includes(order.displayFinancialStatus)) fail('SHOPIFY_REFUND_REVIEW_REQUIRED', 'Shopify 訂單有退款，須核對退款及待出貨明細', name);
  if (amounts.currentTotalTaxSet > 0 || ['currentTotalAdditionalFeesSet', 'currentTotalDutiesSet', 'totalTipReceivedSet'].some(field => money(order[field], currency, field, name, true) !== 0)) fail('SHOPIFY_FINANCIAL_REVIEW_REQUIRED', 'Shopify 訂單另有稅額、附加費或小費，須先核對計價', name);
  if (!['PAID', 'PENDING', 'AUTHORIZED', 'PARTIALLY_PAID', 'EXPIRED', 'VOIDED'].includes(order.displayFinancialStatus)) fail('SHOPIFY_PAYMENT_REVIEW_REQUIRED', 'Shopify 付款狀態無法核對', name);
  if (order.displayFinancialStatus === 'PARTIALLY_PAID' || order.displayFinancialStatus === 'PAID' && amounts.totalOutstandingSet !== 0 || order.displayFinancialStatus === 'PENDING' && amounts.totalReceivedSet > 0) fail('SHOPIFY_PAYMENT_REVIEW_REQUIRED', 'Shopify 付款狀態與待收款不一致，須先核對', name);
  const items = order.items.map(item => {
    const originalQuantity = quantity(item.quantity, name), currentQuantity = quantity(item.currentQuantity, name), unfulfilledQuantity = quantity(item.unfulfilledQuantity, name);
    if (currentQuantity > originalQuantity || unfulfilledQuantity > currentQuantity) fail('SHOPIFY_QUANTITY_INVALID', 'Shopify 有效數量與待出貨數量不一致', name);
    if (typeof item.requiresShipping !== 'boolean' || typeof item.taxable !== 'boolean') fail('SHOPIFY_RESPONSE_INVALID', 'Shopify 商品出貨或稅別資料無效', name);
    return { ...item, originalQuantity, currentQuantity, unfulfilledQuantity };
  });
  const active = items.filter(item => item.currentQuantity > 0);
  if (active.some(item => !item.requiresShipping)) fail('SHOPIFY_NONSHIPPING_REVIEW_REQUIRED', '訂單含非出貨品項，請確認 ECOUNT 非庫存品項對照', name);
  const currentQuantity = active.reduce((sum, item) => sum + item.currentQuantity, 0), remainingQuantity = active.reduce((sum, item) => sum + item.unfulfilledQuantity, 0);
  if (quantity(order.currentSubtotalLineItemsQuantity, name) !== currentQuantity) fail('SHOPIFY_QUANTITY_INVALID', 'Shopify 商品有效數量與訂單總數不一致', name);
  const fulfillment = text(order.displayFulfillmentStatus).toLowerCase();
  if (!order.cancelledAt && (remainingQuantity > 0 && remainingQuantity !== currentQuantity || fulfillment === 'fulfilled' && remainingQuantity !== 0 || fulfillment === 'unfulfilled' && remainingQuantity !== currentQuantity || !['fulfilled', 'unfulfilled'].includes(fulfillment))) fail('SHOPIFY_FULFILLMENT_REVIEW_REQUIRED', 'Shopify 訂單部分出貨或出貨狀態待核對，不可重新銷整單', name);
  const lineValues = active.map(item => {
    const sku = text(item.sku);
    if (!sku || sku.length > 100 || /^[+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?\d+$/.test(sku) || /[\u0000-\u001f\u007f]/.test(sku)) fail('SHOPIFY_SKU_INVALID', 'Shopify 商品缺少完整貨號，請核對商品設定', name);
    if (!text(item.name) || text(item.name).length > 5000) fail('SHOPIFY_RESPONSE_INVALID', 'Shopify 商品名稱無法核對', name);
    const unitMinor = money(item.originalUnitPriceSet, currency, '商品原始單價', name);
    const netMinor = money(item.priceAfterAllDiscountsBeforeTaxesSet, currency, '商品目前成交金額', name);
    const grossMinor = unitMinor * item.currentQuantity;
    if (!Number.isSafeInteger(grossMinor) || netMinor > grossMinor) fail('SHOPIFY_LINE_MONEY_INVALID', 'Shopify 商品成交金額與有效數量不一致', name);
    const barcode = text(item.variant?.barcode);
    return { item, sku, unitMinor, netMinor, grossMinor, barcode: barcode && barcode.length <= 100 && !/[\u0000-\u001f\u007f]/.test(barcode) && !/^[+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?\d+$/.test(barcode) ? barcode : '' };
  });
  const subtotal = lineValues.reduce((sum, item) => sum + item.netMinor, 0), gross = lineValues.reduce((sum, item) => sum + item.grossMinor, 0);
  if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(gross) || subtotal !== amounts.currentSubtotalPriceSet || subtotal + amounts.currentShippingPriceSet !== amounts.currentTotalPriceSet) fail('SHOPIFY_TOTAL_MISMATCH', 'Shopify 有效商品、運費與目前總額不一致，須先核對', name);
  if (gross - subtotal !== amounts.currentTotalDiscountsSet) fail('SHOPIFY_DISCOUNT_REVIEW_REQUIRED', 'Shopify 商品與運費折扣尚無法完整核對', name);
  const sourceBase = Object.assign({}, ...source.records.slice().reverse());
  const shared = Object.fromEntries(Object.entries(sourceBase).filter(([key]) => !key.startsWith('Lineitem ')));
  // Blank continuation fields must not overwrite order-level delivery data.
  for (const row of source.records) for (const [key, value] of Object.entries(row)) if (!key.startsWith('Lineitem ') && text(value) && !text(shared[key])) shared[key] = value;
  if (order.shippingAddress) {
    const address = order.shippingAddress;
    const addressFields = { 'Shipping Name': address.name, 'Shipping Phone': address.phone, 'Shipping Address1': address.address1, 'Shipping Address2': address.address2, 'Shipping City': address.city, 'Shipping Zip': address.zip, 'Shipping Province': address.provinceCode || address.province, 'Shipping Country': address.countryCodeV2 || address.country, 'Shipping Company': address.company };
    for (const [key, value] of Object.entries(addressFields)) {
      if (value != null && typeof value !== 'string') fail('SHOPIFY_RESPONSE_INVALID', 'Shopify 收件資料格式無效', name);
      shared[key] = value ?? '';
    }
    shared['Shipping Street'] = [address.address1, address.address2].filter(Boolean).join(' ');
  }
  if (order.shippingLines?.pageInfo?.hasNextPage === true) fail('SHOPIFY_SHIPPING_REVIEW_REQUIRED', 'Shopify 配送方式超出核對上限', name);
  const shippingTitles = Array.isArray(order.shippingLines?.nodes) ? [...new Set(order.shippingLines.nodes.map(line => text(line.title)).filter(Boolean))] : [];
  if (shippingTitles.length) shared['Shipping Method'] = shippingTitles.join(' / ');
  const gateways = Array.isArray(order.paymentGatewayNames) ? order.paymentGatewayNames.map(text).filter(Boolean) : [];
  let paymentMethod = gateways.join(' / ');
  if (text(sourceBase['Payment Method']).toLowerCase() === 'custom' && gateways.length && gateways.every(gateway => /^(?:custom|manual)$/i.test(gateway))) paymentMethod = 'custom';
  const records = lineValues.map(({ item, sku, unitMinor, grossMinor, netMinor }) => {
    const exactId = source.records.filter(row => text(row['Lineitem id']) === item.id || text(row['Lineitem id']) === item.id.split('/').pop());
    const sameSku = source.records.filter(row => text(row['Lineitem sku']) === sku);
    const original = exactId.length === 1 ? exactId[0] : sameSku.length === 1 ? sameSku[0] : {};
    return { ...original, ...shared,
      Name: name, Id: source.id, 'Created at': order.createdAt, 'Financial Status': order.displayFinancialStatus.toLowerCase(), 'Fulfillment Status': fulfillment,
      Currency: currency, Subtotal: formatMoney(subtotal), Shipping: formatMoney(amounts.currentShippingPriceSet), Taxes: formatMoney(amounts.currentTotalTaxSet), Total: formatMoney(amounts.currentTotalPriceSet),
      'Discount Code': Array.isArray(order.discountCodes) ? order.discountCodes.join(' / ') : '', 'Discount Amount': formatMoney(amounts.currentTotalDiscountsSet),
      'Refunded Amount': formatMoney(amounts.totalRefundedSet), 'Outstanding Balance': formatMoney(amounts.totalOutstandingSet), 'Payment Method': paymentMethod, 'Cancelled at': order.cancelledAt || '',
      'Lineitem id': item.id, 'Lineitem sku': sku, 'Lineitem name': text(item.name), 'Lineitem quantity': item.currentQuantity, 'Lineitem price': formatMoney(unitMinor),
      'Lineitem discount': formatMoney(grossMinor - netMinor), 'Lineitem requires shipping': item.requiresShipping, 'Lineitem taxable': item.taxable,
      'Lineitem fulfillment status': item.unfulfilledQuantity === 0 ? 'fulfilled' : 'pending',
    };
  });
  const evidence = { number: name, id: source.id, updatedAt: order.updatedAt, edited: order.edited === true, currency, fulfillmentStatus: fulfillment, paymentStatus: order.displayFinancialStatus.toLowerCase(), currentQuantity, remainingQuantity,
    subtotalMinor: subtotal, shippingMinor: amounts.currentShippingPriceSet, discountMinor: amounts.currentTotalDiscountsSet, totalMinor: amounts.currentTotalPriceSet, outstandingMinor: amounts.totalOutstandingSet, receivedMinor: amounts.totalReceivedSet,
    removedLineIds: items.filter(item => item.currentQuantity === 0).map(item => item.id),
    items: lineValues.map(({ item, sku, barcode, netMinor }) => ({ id: item.id, sku, quantity: item.currentQuantity, unfulfilledQuantity: item.unfulfilledQuantity, netMinor, ...(barcode ? { barcode, barcodeSource: 'shopify-variant' } : {}) })),
  };
  // Cover current delivery data without exposing addresses in evidence or logs.
  evidence.shippingSource = order.shippingAddress ? 'shopify-current' : 'source-csv';
  evidence.fingerprint = hash({ evidence, records });
  return { records, evidence };
}

async function verifyShopifyRows(rows, { shop, token, apiVersion = '2026-07', fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  shop = domain(shop);
  if (!text(token) || typeof token !== 'string' || typeof fetchImpl !== 'function' || !/^20\d{2}-(?:01|04|07|10)$/.test(apiVersion) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) fail('SHOPIFY_CONFIG_INVALID', 'Shopify 訂單即時核對尚未設定完成', undefined, 503);
  const source = sourceOrders(rows), deadline = Date.now() + 60000, normalized = [], evidence = [];
  for (const order of source.orders) {
    const current = await readOrder(order, { shop, token, apiVersion, fetchImpl, timeoutMs }, deadline);
    const result = normalizeOrder(order, current); normalized.push(...result.records); evidence.push(result.evidence);
    if (normalized.length > 5000) fail('SHOPIFY_LIMIT_EXCEEDED', 'Shopify 修改後商品超過 5,000 列，請分批轉檔');
  }
  const headers = [...new Set([...source.headers, ...normalized.flatMap(Object.keys)])];
  const verification = { version: VERSION, shop, apiVersion, checkedAt: new Date().toISOString(), sourceFingerprint: hash(rows), orders: evidence };
  verification.fingerprint = hash({ version: VERSION, shop, sourceFingerprint: verification.sourceFingerprint, orders: evidence.map(order => order.fingerprint) });
  return { rows: [headers, ...normalized.map(row => headers.map(header => row[header] ?? ''))], verification };
}

function createShopifyOrderVerifier({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return rows => verifyShopifyRows(rows, { shop: env.WMS_SHOPIFY_SHOP, token: env.WMS_SHOPIFY_ACCESS_TOKEN, apiVersion: env.WMS_SHOPIFY_API_VERSION || '2026-07', fetchImpl });
}

module.exports = { verifyShopifyRows, createShopifyOrderVerifier };
