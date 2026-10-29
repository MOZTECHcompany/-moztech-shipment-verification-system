const { createHash } = require('node:crypto');

const VERSION = 'shopify-current-v2';
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
    shippingLines(first: 50, includeRemovals: true) {
      nodes { id title isRemoved originalPriceSet ${MONEY_SELECTION} currentDiscountedPriceSet ${MONEY_SELECTION} }
      pageInfo { hasNextPage }
    }
    ${MONEY_FIELDS.map(name => `${name} ${MONEY_SELECTION}`).join('\n')}
    currentTotalAdditionalFeesSet ${MONEY_SELECTION}
    currentTotalDutiesSet ${MONEY_SELECTION}
    totalTipReceivedSet ${MONEY_SELECTION}
    netPaymentSet ${MONEY_SELECTION}
    refunds {
      id createdAt updatedAt totalRefundedSet ${MONEY_SELECTION}
      refundLineItems(first: 25) {
        nodes { id quantity restockType subtotalSet ${MONEY_SELECTION} totalTaxSet ${MONEY_SELECTION} lineItem { id sku } }
        pageInfo { hasNextPage endCursor }
      }
      transactions(first: 25) {
        nodes { id kind status processedAt amountSet ${MONEY_SELECTION} }
        pageInfo { hasNextPage endCursor }
      }
    }
    lineItems(first: 100, after: $after) {
      nodes {
        id name sku quantity currentQuantity unfulfilledQuantity requiresShipping taxable
        originalUnitPriceSet ${MONEY_SELECTION}
        priceAfterAllDiscountsBeforeTaxesSet ${MONEY_SELECTION}
        variant { id barcode }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
const REFUND_QUERY = `query WmsRefundPage($id: ID!, $lineAfter: String, $transactionAfter: String) {
  shop { myshopifyDomain }
  refund(id: $id) {
    id updatedAt totalRefundedSet ${MONEY_SELECTION} order { id updatedAt }
    refundLineItems(first: 100, after: $lineAfter) {
      nodes { id quantity restockType subtotalSet ${MONEY_SELECTION} totalTaxSet ${MONEY_SELECTION} lineItem { id sku } }
      pageInfo { hasNextPage endCursor }
    }
    transactions(first: 100, after: $transactionAfter) {
      nodes { id kind status processedAt amountSet ${MONEY_SELECTION} }
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

async function requestOrder(options, id, after, deadline, document) {
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
          body: JSON.stringify(document ? {query:REFUND_QUERY,variables:document.variables} : { query: QUERY, variables: { id: `gid://shopify/Order/${id}`, after } }),
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
      return document ? payload.data.refund : payload.data.order;
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
    else if (current.updatedAt !== first.updatedAt || hash([MONEY_FIELDS.map(field => current[field]),current.netPaymentSet,current.refunds,current.shippingLines]) !== hash([MONEY_FIELDS.map(field => first[field]),first.netPaymentSet,first.refunds,first.shippingLines])) fail('SHOPIFY_ORDER_CHANGED', 'Shopify 訂單在核對期間已修改，請重試', source.name);
    const connection = current.lineItems;
    if (!Array.isArray(connection?.nodes) || typeof connection?.pageInfo?.hasNextPage !== 'boolean') fail('SHOPIFY_RESPONSE_INVALID', 'Shopify 商品明細未完整回傳', source.name);
    for (const item of connection.nodes) {
      if (!/^gid:\/\/shopify\/LineItem\/\d+$/.test(item?.id) || seenIds.has(item.id)) fail('SHOPIFY_LINE_ID_INVALID', 'Shopify 商品明細 ID 重複或無效', source.name);
      seenIds.add(item.id); items.push(item);
    }
    if (items.length > MAX_ORDER_LINES) fail('SHOPIFY_LIMIT_EXCEEDED', '單筆 Shopify 訂單超過 1,000 商品明細，請分批處理', source.name);
    if (!connection.pageInfo.hasNextPage) return { ...first, items,refunds:await readRefundPages(first,options,deadline,source.name) };
    after = connection.pageInfo.endCursor;
    if (!after || seenCursors.has(after)) fail('SHOPIFY_PAGINATION_INVALID', 'Shopify 商品分頁未完整讀取，請重試', source.name);
    seenCursors.add(after);
  }
  fail('SHOPIFY_LIMIT_EXCEEDED', 'Shopify 商品分頁超出核對上限', source.name);
}

async function readRefundPages(order,options,deadline,name){
  if(order.refunds==null)return order.refunds;
  if(!Array.isArray(order.refunds)||order.refunds.length>250)fail('SHOPIFY_REFUND_REVIEW_REQUIRED','Shopify 退款清單無法完整核對',name);
  const result=[];
  for(const refund of order.refunds){
    const connections={};
    for(const key of ['refundLineItems','transactions']){
      let current=refund[key],nodes=[],ids=new Set(),cursors=new Set();
      for(let page=0;page<=10;page++){
        if(!Array.isArray(current?.nodes)||typeof current?.pageInfo?.hasNextPage!=='boolean')fail('SHOPIFY_REFUND_REVIEW_REQUIRED','Shopify 退款明細未完整回傳',name);
        for(const node of current.nodes){if(!node?.id||ids.has(node.id))fail('SHOPIFY_REFUND_REVIEW_REQUIRED','Shopify 退款明細重複或無效',name);ids.add(node.id);nodes.push(node);}
        if(nodes.length>1000)fail('SHOPIFY_LIMIT_EXCEEDED','Shopify 單筆退款明細超過核對上限',name);
        if(!current.pageInfo.hasNextPage){connections[key]={nodes,pageInfo:{hasNextPage:false}};break;}
        const cursor=current.pageInfo.endCursor;
        if(!cursor||cursors.has(cursor))fail('SHOPIFY_REFUND_REVIEW_REQUIRED','Shopify 退款分頁未完整讀取',name);cursors.add(cursor);
        const next=await requestOrder(options,null,null,deadline,{variables:{id:refund.id,lineAfter:key==='refundLineItems'?cursor:null,transactionAfter:key==='transactions'?cursor:null}});
        if(!next||next.id!==refund.id||next.updatedAt!==refund.updatedAt||hash(next.totalRefundedSet)!==hash(refund.totalRefundedSet)||next.order?.id!==order.id||next.order?.updatedAt!==order.updatedAt)fail('SHOPIFY_ORDER_CHANGED','Shopify 退款或訂單在核對期間已更新，請重試',name);
        current=next[key];
      }
      if(!connections[key])fail('SHOPIFY_LIMIT_EXCEEDED','Shopify 退款分頁超過核對上限',name);
    }
    result.push({...refund,...connections});
  }
  return result;
}

function refundEvidence(order,items,amounts,currency,name){
  const partial=order.displayFinancialStatus==='PARTIALLY_REFUNDED',refunded=amounts.totalRefundedSet;
  // Fully canceled unpaid orders remain visible as excluded orders. A zero
  // cash cancellation ledger is not a reason to revive or block that order.
  if(!partial&&refunded===0&&(order.cancelledAt||items.every(item=>item.currentQuantity===0)))return null;
  if(!partial&&refunded===0&&!(Array.isArray(order.refunds)&&order.refunds.length))return null;
  if(partial&&refunded<=0||!partial&&refunded>0||order.cancelledAt||text(order.displayFulfillmentStatus).toLowerCase()!=='unfulfilled'||!Array.isArray(order.refunds)||!order.refunds.length)fail('SHOPIFY_REFUND_REVIEW_REQUIRED','Shopify 退款尚未取得完整的未出貨取消明細',name);
  if(!items.some(item=>item.currentQuantity>0)||items.some(item=>item.currentQuantity!==item.unfulfilledQuantity))fail('SHOPIFY_REFUND_REVIEW_REQUIRED','部分退款訂單已有履行數量，不能重新轉整筆銷貨',name);
  let total=0;const refunds=[],refundIds=new Set(),lineIds=new Set(),transactionIds=new Set(),cancelled=new Map();
  for(const refund of order.refunds){
    if(!/^gid:\/\/shopify\/Refund\/\d+$/.test(refund.id)||refundIds.has(refund.id)||!refund.updatedAt||!Number.isFinite(Date.parse(refund.updatedAt)))fail('SHOPIFY_REFUND_REVIEW_REQUIRED','Shopify 退款身分或更新時間無法核對',name);refundIds.add(refund.id);
    const refundMinor=money(refund.totalRefundedSet,currency,'退款總額',name),lines=[],transactions=[];let success=0;
    for(const entry of refund.refundLineItems.nodes){
      const item=items.find(item=>item.id===entry.lineItem?.id),count=quantity(entry.quantity,name);
      if(!/^gid:\/\/shopify\/RefundLineItem\/\d+$/.test(entry.id)||lineIds.has(entry.id)||!count||!item||text(entry.lineItem.sku)!==text(item.sku)||entry.restockType!=='CANCEL')fail('SHOPIFY_REFUND_REVIEW_REQUIRED','退款商品未能唯一對應未出貨取消品項',name);lineIds.add(entry.id);
      cancelled.set(item.id,(cancelled.get(item.id)||0)+count);
      lines.push({id:entry.id,lineId:item.id,sku:text(item.sku),quantity:count,restockType:'CANCEL',subtotalMinor:money(entry.subtotalSet,currency,'退款商品小計',name),taxMinor:money(entry.totalTaxSet,currency,'退款商品稅額',name)});
      if(lines[lines.length-1].taxMinor!==0)fail('SHOPIFY_REFUND_REVIEW_REQUIRED','退款另含稅額，須先核對計價',name);
    }
    for(const entry of refund.transactions.nodes){
      if(!/^gid:\/\/shopify\/OrderTransaction\/\d+$/.test(entry.id)||transactionIds.has(entry.id)||entry.kind!=='REFUND'||entry.status!=='SUCCESS'||!entry.processedAt||!Number.isFinite(Date.parse(entry.processedAt)))fail('SHOPIFY_REFUND_REVIEW_REQUIRED','退款交易尚未全部成功，不能確認實收金額',name);transactionIds.add(entry.id);
      const amountMinor=money(entry.amountSet,currency,'成功退款交易',name);success+=amountMinor;transactions.push({id:entry.id,kind:entry.kind,status:entry.status,processedAt:entry.processedAt,amountMinor});
    }
    if(success!==refundMinor||!Number.isSafeInteger(success)||refundMinor>0&&!lines.length)fail('SHOPIFY_REFUND_REVIEW_REQUIRED','成功退款交易與退款總額或取消品項不一致',name);
    total+=success;refunds.push({id:refund.id,updatedAt:refund.updatedAt,refundMinor,lines,transactions});
  }
  if(!Number.isSafeInteger(total)||total!==refunded||items.some(item=>(cancelled.get(item.id)||0)!==item.originalQuantity-item.currentQuantity))fail('SHOPIFY_REFUND_REVIEW_REQUIRED','退款取消數量與目前有效商品無法完整核對',name);
  const netPaymentMinor=money(order.netPaymentSet,currency,'退款後實收金額',name);
  if(amounts.totalReceivedSet-refunded!==netPaymentMinor||partial&&(amounts.totalOutstandingSet!==0||netPaymentMinor<=0||netPaymentMinor>amounts.currentTotalPriceSet))fail('SHOPIFY_REFUND_REVIEW_REQUIRED','Shopify 退款後實收、已收與退款金額無法核對',name);
  const proof={version:partial?'shopify-refund-remainder-v1':'shopify-removed-items-v1',status:'verified-unfulfilled-remainder',orderId:order.id,updatedAt:order.updatedAt,currency,refundedMinor:refunded,receivedMinor:amounts.totalReceivedSet,netPaymentMinor,apiTotalMinor:amounts.currentTotalPriceSet,apiSubtotalMinor:amounts.currentSubtotalPriceSet,shippingMinor:amounts.currentShippingPriceSet,refunds};
  proof.fingerprint=hash(proof);return proof;
}

function normalizeOrder(source, order) {
  const name = source.name, currency = order.currencyCode;
  if (currency !== 'TWD' || order.presentmentCurrencyCode !== 'TWD') fail('SHOPIFY_CURRENCY_UNSUPPORTED', 'Shopify 店鋪與顧客付款幣別均須為 TWD', name);
  const amounts = Object.fromEntries(MONEY_FIELDS.map(field => [field, money(order[field], currency, field, name)]));
  if (order.displayFinancialStatus==='REFUNDED'||amounts.totalRefundedSet>0&&order.displayFinancialStatus!=='PARTIALLY_REFUNDED') fail('SHOPIFY_REFUND_REVIEW_REQUIRED', 'Shopify 訂單有退款，須核對退款及待出貨明細', name);
  if (amounts.currentTotalTaxSet > 0 || ['currentTotalAdditionalFeesSet', 'currentTotalDutiesSet', 'totalTipReceivedSet'].some(field => money(order[field], currency, field, name, true) !== 0)) fail('SHOPIFY_FINANCIAL_REVIEW_REQUIRED', 'Shopify 訂單另有稅額、附加費或小費，須先核對計價', name);
  if (!['PAID', 'PENDING', 'AUTHORIZED', 'PARTIALLY_PAID', 'EXPIRED', 'VOIDED','PARTIALLY_REFUNDED'].includes(order.displayFinancialStatus)) fail('SHOPIFY_PAYMENT_REVIEW_REQUIRED', 'Shopify 付款狀態無法核對', name);
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
  const sourceFulfillmentStatus = text(order.displayFulfillmentStatus);
  const rawFulfillment = sourceFulfillmentStatus.toLowerCase();
  const processing = ['in_progress', 'open', 'pending_fulfillment'].includes(rawFulfillment);
  const whollyUnfulfilled = currentQuantity > 0 && active.every(item => item.unfulfilledQuantity === item.currentQuantity);
  const fulfillment = processing && whollyUnfulfilled ? 'unfulfilled' : rawFulfillment;
  // A consistent explicit partial state can be displayed and excluded from
  // new sales. Unknown or contradictory quantities still stop verification.
  const partial = fulfillment === 'partially_fulfilled' && remainingQuantity > 0 && remainingQuantity < currentQuantity;
  if (!order.cancelledAt && !partial && (remainingQuantity > 0 && remainingQuantity !== currentQuantity || fulfillment === 'fulfilled' && remainingQuantity !== 0 || fulfillment === 'unfulfilled' && remainingQuantity !== currentQuantity || !['fulfilled', 'unfulfilled'].includes(fulfillment))) fail('SHOPIFY_FULFILLMENT_REVIEW_REQUIRED', 'Shopify 訂單部分出貨或出貨狀態待核對，不可重新銷整單', name);
  const lineValues = active.map(item => {
    const sku = text(item.sku);
    if (!sku) fail('SHOPIFY_SKU_INVALID', item.variant ? 'Shopify 目前商品未填貨號，請補上商品貨號後重新核對' : 'Shopify 自訂商品未填貨號，請改用正式商品後重新核對', name);
    if (sku.length > 100 || /^[+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?\d+$/.test(sku) || /[\u0000-\u001f\u007f]/.test(sku)) fail('SHOPIFY_SKU_INVALID', 'Shopify 商品缺少完整貨號，請核對商品設定', name);
    if (!text(item.name) || text(item.name).length > 5000) fail('SHOPIFY_RESPONSE_INVALID', 'Shopify 商品名稱無法核對', name);
    const unitMinor = money(item.originalUnitPriceSet, currency, '商品原始單價', name);
    const netMinor = money(item.priceAfterAllDiscountsBeforeTaxesSet, currency, '商品目前成交金額', name);
    const grossMinor = unitMinor * item.currentQuantity;
    if (!Number.isSafeInteger(grossMinor) || netMinor > grossMinor) fail('SHOPIFY_LINE_MONEY_INVALID', 'Shopify 商品成交金額與有效數量不一致', name);
    const rawBarcode = item.variant?.barcode;
    const barcode = text(rawBarcode), variantId = text(item.variant?.id);
    // Malformed present values must never masquerade as a blank API field and
    // become eligible for a physical-scan supplement.
    if (rawBarcode != null && (typeof rawBarcode !== 'string' || rawBarcode.length > 100 || /[\u0000-\u001f\u007f]/.test(rawBarcode) || /^[+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?\d+$/.test(barcode))) fail('SHOPIFY_BARCODE_INVALID', 'Shopify 商品條碼格式無效，請核對商品設定', name);
    if (variantId && !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(variantId)) fail('SHOPIFY_RESPONSE_INVALID', 'Shopify 商品版本無法核對', name);
    return { item, sku, unitMinor, netMinor, grossMinor, variantId, barcode };
  });
  const subtotal = lineValues.reduce((sum, item) => sum + item.netMinor, 0), gross = lineValues.reduce((sum, item) => sum + item.grossMinor, 0);
  if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(gross) || subtotal !== amounts.currentSubtotalPriceSet || subtotal + amounts.currentShippingPriceSet !== amounts.currentTotalPriceSet) fail('SHOPIFY_TOTAL_MISMATCH', 'Shopify 有效商品、運費與目前總額不一致，須先核對', name);
  const shippingConnection = order.shippingLines;
  if (!Array.isArray(shippingConnection?.nodes) || typeof shippingConnection?.pageInfo?.hasNextPage !== 'boolean' || shippingConnection.pageInfo.hasNextPage || shippingConnection.nodes.length > 50) fail('SHOPIFY_SHIPPING_REVIEW_REQUIRED', 'Shopify 運費明細未完整回傳，請重新核對', name);
  const shippingIds = new Set();
  const shippingLines = shippingConnection.nodes.map(line => {
    if (!/^gid:\/\/shopify\/ShippingLine\/\d+$/.test(line?.id) || shippingIds.has(line.id) || typeof line.isRemoved !== 'boolean' || typeof line.title !== 'string') fail('SHOPIFY_SHIPPING_REVIEW_REQUIRED', 'Shopify 運費明細無法核對，請重新核對', name);
    shippingIds.add(line.id);
    const originalMinor = money(line.originalPriceSet, currency, '運費原價', name);
    const currentMinor = money(line.currentDiscountedPriceSet, currency, '目前運費', name);
    if (currentMinor > originalMinor) fail('SHOPIFY_SHIPPING_REVIEW_REQUIRED', 'Shopify 運費折扣與原價不一致，請重新核對', name);
    return { id: line.id, title: text(line.title), removed: line.isRemoved, originalMinor, currentMinor };
  });
  const activeShippingLines = shippingLines.filter(line => !line.removed);
  const shippingGrossMinor = activeShippingLines.reduce((sum, line) => sum + line.originalMinor, 0);
  const shippingNetMinor = activeShippingLines.reduce((sum, line) => sum + line.currentMinor, 0);
  if (!Number.isSafeInteger(shippingGrossMinor) || !Number.isSafeInteger(shippingNetMinor) || shippingNetMinor !== amounts.currentShippingPriceSet) fail('SHOPIFY_SHIPPING_REVIEW_REQUIRED', 'Shopify 運費明細與目前運費不一致，請重新核對', name);
  // A fully cancelled order can keep an original shipping charge with a zero
  // current price. Its voided charge is not a discount or a sale to export.
  const cancelledZero = Boolean(order.cancelledAt) && currentQuantity === 0 && subtotal === 0 && shippingNetMinor === 0 && amounts.currentTotalPriceSet === 0 && amounts.currentTotalDiscountsSet === 0;
  const shippingCancellationMinor = cancelledZero ? shippingGrossMinor : 0;
  const productDiscountMinor = gross - subtotal, shippingDiscountMinor = shippingGrossMinor - shippingNetMinor - shippingCancellationMinor;
  if (!Number.isSafeInteger(productDiscountMinor + shippingDiscountMinor) || productDiscountMinor + shippingDiscountMinor !== amounts.currentTotalDiscountsSet) fail('SHOPIFY_DISCOUNT_REVIEW_REQUIRED', 'Shopify 商品與運費折扣尚無法完整核對', name);
  const refund=refundEvidence(order,items,amounts,currency,name);
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
  const shippingTitles = [...new Set(activeShippingLines.map(line => line.title).filter(Boolean))];
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
      // Shipping is already net of shipping discounts; only product discounts
      // belong in the parser's discount field. Keep the full split in evidence.
      'Discount Code': Array.isArray(order.discountCodes) ? order.discountCodes.join(' / ') : '', 'Discount Amount': formatMoney(productDiscountMinor),
      'Refunded Amount': formatMoney(amounts.totalRefundedSet), 'Outstanding Balance': formatMoney(amounts.totalOutstandingSet), 'Payment Method': paymentMethod, 'Cancelled at': order.cancelledAt || '',
      'Lineitem id': item.id, 'Lineitem sku': sku, 'Lineitem name': text(item.name), 'Lineitem quantity': item.currentQuantity, 'Lineitem price': formatMoney(unitMinor),
      'Lineitem discount': formatMoney(grossMinor - netMinor), 'Lineitem requires shipping': item.requiresShipping, 'Lineitem taxable': item.taxable,
      'Lineitem fulfillment status': item.unfulfilledQuantity === 0 ? 'fulfilled' : 'pending',
    };
  });
  const evidence = { number: name, id: source.id, updatedAt: order.updatedAt, edited: order.edited === true, cancelled: Boolean(order.cancelledAt), cancelledAt: order.cancelledAt || null, currency, fulfillmentStatus: fulfillment, sourceFulfillmentStatus, paymentStatus: order.displayFinancialStatus.toLowerCase(), currentQuantity, remainingQuantity,
    subtotalMinor: subtotal, shippingMinor: amounts.currentShippingPriceSet, discountMinor: amounts.currentTotalDiscountsSet, productDiscountMinor, shippingGrossMinor, shippingDiscountMinor, shippingCancellationMinor, shippingLines, totalMinor: amounts.currentTotalPriceSet, outstandingMinor: amounts.totalOutstandingSet, receivedMinor: amounts.totalReceivedSet,
    removedLineIds: items.filter(item => item.currentQuantity === 0).map(item => item.id),
    allItems:items.map(item=>({id:item.id,sku:text(item.sku),name:text(item.name),originalQuantity:item.originalQuantity,currentQuantity:item.currentQuantity,unfulfilledQuantity:item.unfulfilledQuantity})),
    items: lineValues.map(({ item, sku, barcode, variantId, netMinor }) => ({ id: item.id, sku,name:text(item.name), quantity: item.currentQuantity, unfulfilledQuantity: item.unfulfilledQuantity, netMinor, ...(variantId ? { variantId } : {}), ...(barcode ? { barcode, barcodeSource: 'shopify-variant' } : {}) })),
    refundedMinor:amounts.totalRefundedSet,netPaymentMinor:order.netPaymentSet==null?null:money(order.netPaymentSet,currency,'實收金額',name),...(refund?{refundEvidence:refund}:{}),
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
