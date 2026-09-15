// Local-only conversion. Amounts are integer hundredths; no payment or inventory writes.
export const ECOUNT_HEADERS = ['日期', '序號', '客戶/供應商編碼', '客戶/供應商名稱', '承辦人', '專案', '發貨倉庫', '交易類型', '貨幣', '匯率', '銷貨單單號', '品項編碼', '商城訂單編號', '平台', '店鋪', '來源明細號', '品項名稱', '序號/批號', '規格', '數量', '單價', '單價(含稅)', '外幣金額', '稅前價格', '營業稅', '摘要', '產生生產入庫'];

// Online uploader verified on 2026-09-15: standard columns first, custom
// marketplace columns in X:AA. Stored snapshots retain the canonical layout.
export const ECOUNT_UPLOAD_HEADERS = [...ECOUNT_HEADERS.slice(0,12),...ECOUNT_HEADERS.slice(16),...ECOUNT_HEADERS.slice(12,16)];
export function buildEcountUploadTable(record){
  if(!Array.isArray(record?.headers)||record.headers.length!==27||new Set(record.headers).size!==27||!Array.isArray(record.rows))throw Error('ECOUNT 保存批次欄位格式無效');
  const indexes=ECOUNT_UPLOAD_HEADERS.map(h=>record.headers.indexOf(h));
  if(indexes.some(i=>i<0)||record.rows.some(r=>!Array.isArray(r)||r.length!==27))throw Error('ECOUNT 保存批次欄位不完整，未產生下載檔');
  return {headers:[...ECOUNT_UPLOAD_HEADERS],rows:record.rows.map(r=>indexes.map(i=>r[i]))};
}

const text = (value) => value == null ? '' : String(value).trim();
const blank = (value) => text(value) === '';
const sum = (values) => values.reduce((a, b) => Number.isSafeInteger(a + b) ? a + b : NaN, 0);
const issue = (code, message, extra = {}, severity = 'error') => ({ code, severity, message, ...extra });
const REQUIRED = {
  '1Shop': ['訂單編號', '名稱', '產品SKU', '產品', '產品數量', '單價', '小計', '訂單金額(不含金/物流手續費)', '訂單金流手續費', '訂單運費', '總計金額', '金流狀態', '物流狀態'],
  Shopify: ['Name', 'Financial Status', 'Fulfillment Status', 'Currency', 'Subtotal', 'Shipping', 'Taxes', 'Total', 'Discount Amount', 'Refunded Amount', 'Lineitem quantity', 'Lineitem name', 'Lineitem price', 'Lineitem sku'],
};

export function parseMoneyMinor(value) {
  if (blank(value)) return null;
  const source = text(value);
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(source)) throw new Error('金額必須是最多兩位小數的數值');
  const negative = source.startsWith('-');
  const [whole, fraction = ''] = source.replace(/^-/, '').replaceAll(',', '').split('.');
  const result = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) * (negative ? -1n : 1n);
  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('金額超出可安全處理範圍');
  return Number(result);
}

export function formatMinor(value) {
  if (value == null) return '';
  if (!Number.isSafeInteger(value)) throw new Error('金額不是安全整數');
  const amount = BigInt(value);
  const positive = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}${positive / 100n}.${String(positive % 100n).padStart(2, '0')}`;
}

function stableId(parts) {
  // A generated reference is stable across row reordering, not a platform line ID.
  let hash = 144066263297769815596495629667062367629n;
  for (const char of JSON.stringify(parts.map(text))) {
    hash ^= BigInt(char.codePointAt(0));
    hash = BigInt.asUintN(128, hash * 309485009821345068724781371n);
  }
  return `L${hash.toString(16).padStart(32, '0')}`;
}

function tableRows(rows, issues) {
  if (!Array.isArray(rows) || !rows.length) return { headers: [], data: [] };
  if (Array.isArray(rows[0])) {
    const headers = rows[0].map(text);
    if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) issues.push(issue('DUPLICATE_HEADERS', '來源檔含重複欄名，無法安全辨識欄位'));
    return { headers, data: rows.slice(1).map((row, index) => ({ sourceRow: index + 2, data: Object.fromEntries(headers.map((key, i) => [key, row?.[i] ?? ''])) })) };
  }
  return { headers: Object.keys(rows[0] || {}), data: rows.map((row, index) => ({ sourceRow: index + 2, data: row })) };
}

function status(value, platform, fulfillment = false) {
  const raw = text(value).toLowerCase();
  if (platform === 'Shopify') return raw || 'unknown';
  if (fulfillment) {
    if (/取消/.test(raw)) return 'cancelled';
    if (/等待|尚未|未出貨/.test(raw)) return 'unfulfilled';
    if (/已出貨|已送達|已完成/.test(raw)) return 'fulfilled';
    return 'unknown';
  }
  if (/退款/.test(raw)) return 'refunded';
  if (/等待|尚未|未付款|付款失敗|過期|逾期/.test(raw)) return 'pending';
  if (/已付款|付款完成|付款成功|已收款/.test(raw)) return 'paid';
  return 'unknown';
}

export function parseMarketplaceRows(rows, { platform, allowedOrderNumbers, allowAllOrders = false } = {}) {
  const issues = [];
  const result = { platform, orders: [], items: [], summary: {}, issues };
  const finish = () => {
    const orders = result.orders;
    const safeTotal = (values) => { const value = sum(values); if (!Number.isSafeInteger(value)) { issues.push(issue('SUMMARY_OVERFLOW', '合計超出可安全處理範圍')); return null; } return value; };
    const total = (key) => orders.every((o) => o.financial[key] != null) ? safeTotal(orders.map((o) => o.financial[key])) : null;
    result.summary = { orderCount: orders.length, itemCount: result.items.length, totalQuantity: safeTotal(result.items.map((i) => i.quantity || 0)), totalMinor: total('totalMinor'), subtotalMinor: total('subtotalMinor'), shippingMinor: total('shippingMinor'), feeMinor: total('feeMinor'), refundedMinor: total('refundedMinor'), excludedOrderCount: 0, excludedRowCount: 0, bundleComponentCount: result.items.filter((i) => i.kind === 'bundle_component').length, pendingOrderCount: orders.filter((o) => o.paymentStatus === 'pending').length, currencies: [...new Set(orders.map((o) => o.financial.currency).filter(Boolean))], ...result.summary };
    return result;
  };
  if (!REQUIRED[platform]) { issues.push(issue('UNSUPPORTED_PLATFORM', '請明確選擇 1Shop 或 Shopify')); return finish(); }
  if (!allowAllOrders && (!Array.isArray(allowedOrderNumbers) || !allowedOrderNumbers.length || allowedOrderNumbers.some((n) => !text(n)))) {
    issues.push(issue('ALLOWLIST_REQUIRED', '必須指定本次授權處理的訂單編號')); return finish();
  }
  const allowed = new Set((allowedOrderNumbers || []).map(text));
  const { headers, data } = tableRows(rows, issues);
  const missing = REQUIRED[platform].filter((key) => !headers.includes(key));
  if (missing.length) issues.push(issue('MISSING_HEADERS', `缺少來源欄位：${missing.join('、')}`));
  if (issues.length) return finish();
  const grouped = new Map();
  const allOrderNumbers = new Set();
  const excluded = new Set();
  let excludedRows = 0;
  let lastOrder = '';
  let footer = null;
  const nonempty = data.filter(({ data: row }) => Object.values(row).some((value) => !blank(value)));
  for (let index = 0; index < nonempty.length; index++) {
    const entry = nonempty[index];
    const row = entry.data;
    let number = text(row[platform === '1Shop' ? '訂單編號' : 'Name']);
    if (platform === '1Shop' && /^總計\s*\d+張訂單$/.test(number)) {
      if (index !== nonempty.length - 1 || ['產品SKU', '產品數量', '單價', '小計'].some((key) => !blank(row[key]))) issues.push(issue('INVALID_FOOTER', '總計列必須位於檔案最後且不得包含商品資料', { sourceRow: entry.sourceRow }));
      else footer = { ...entry, count: Number(number.match(/(\d+)張訂單/)[1]) };
      continue;
    }
    if (platform === 'Shopify' && !number) number = lastOrder;
    if (!number) { issues.push(issue('MISSING_ORDER_NUMBER', '商品列缺少來源訂單編號', { sourceRow: entry.sourceRow })); continue; }
    lastOrder = number;
    allOrderNumbers.add(number);
    if (!allowAllOrders && !allowed.has(number)) { excluded.add(number); excludedRows++; continue; }
    if (!grouped.has(number)) grouped.set(number, []);
    grouped.get(number).push(entry);
  }
  result.summary = { excludedOrderCount: excluded.size, excludedRowCount: excludedRows };
  if (excluded.size) issues.push(issue('ORDERS_EXCLUDED', `已排除 ${excluded.size} 筆未在授權清單的訂單`, {}, 'warning'));
  for (const number of allowed) if (!grouped.has(number)) issues.push(issue('ALLOWED_ORDER_MISSING', '來源檔缺少本次指定訂單', { orderNumber: number }));
  if (footer && footer.count !== allOrderNumbers.size) issues.push(issue('FOOTER_COUNT_MISMATCH', '總計訂單數與來源商品明細不符', { sourceRow: footer.sourceRow }));

  for (const [number, entries] of grouped) {
    const context = { orderNumber: number };
    const get = (key, required = false) => {
      const values = [...new Set(entries.map(({ data: row }) => text(row[key])).filter(Boolean))];
      if (values.length > 1) issues.push(issue('ORDER_FIELD_CONFLICT', `同一訂單的「${key}」不一致`, context));
      if (required && !values.length) issues.push(issue('MISSING_ORDER_VALUE', `訂單缺少「${key}」`, context));
      return values[0] || '';
    };
    const money = (value, field, extra = context, required = false) => {
      try {
        const amount = parseMoneyMinor(value);
        if (amount == null && required) issues.push(issue('MISSING_MONEY', `缺少「${field}」金額`, extra));
        if (amount != null && amount < 0) issues.push(issue('NEGATIVE_MONEY', `「${field}」不可用負數當待出貨商品`, extra));
        return amount;
      } catch { issues.push(issue('INVALID_MONEY', `「${field}」金額格式或精度無效`, extra)); return null; }
    };
    const orderMoney = (key, required = false) => money(get(key), key, context, required);
    const isOne = platform === '1Shop';
    const rawPaymentStatus = get(isOne ? '金流狀態' : 'Financial Status', true);
    const rawFulfillmentStatus = get(isOne ? '物流狀態' : 'Fulfillment Status', true);
    const order = {
      sourceOrderNumber: number, sourcePlatform: platform, sourceOrderId: isOne ? number : get('Id'), createdAt: get(isOne ? '建立日期' : 'Created at'),
      paymentStatus: status(rawPaymentStatus, platform), rawPaymentStatus, paymentMethod: get(isOne ? '金流' : 'Payment Method'),
      paymentNote: isOne && /過期|逾期|逾時|期限已過|超過.*期限/.test(get('金流備註')) ? '付款期限已過' : '',
      fulfillmentStatus: status(rawFulfillmentStatus, platform, true), rawFulfillmentStatus, orderStatus: isOne ? get('訂單狀態') : '',
      cancelled: isOne ? /取消/.test(get('訂單狀態')) : Boolean(get('Cancelled at')),
      salesPageName: isOne ? get('銷售頁名稱') : '', salesPagePrefix: isOne ? get('銷售頁編號前綴') : '',
      financial: isOne ? { subtotalMinor: orderMoney('訂單金額(不含金/物流手續費)', true), totalMinor: orderMoney('總計金額', true), shippingMinor: orderMoney('訂單運費', true), feeMinor: orderMoney('訂單金流手續費', true), taxMinor: null, discountMinor: null, refundedMinor: null, outstandingMinor: null, currency: null } : { subtotalMinor: orderMoney('Subtotal', true), totalMinor: orderMoney('Total', true), shippingMinor: orderMoney('Shipping', true), feeMinor: null, taxMinor: orderMoney('Taxes', true), discountMinor: orderMoney('Discount Amount', true), refundedMinor: orderMoney('Refunded Amount', true), outstandingMinor: orderMoney('Outstanding Balance'), currency: get('Currency', true) },
      itemIds: [],
    };
    result.orders.push(order);
    const seenIds = new Map();
    for (const { data: row, sourceRow } of entries) {
      const extra = { orderNumber: number, sourceRow };
      const qtyText = text(row[isOne ? '產品數量' : 'Lineitem quantity']);
      const quantity = /^\d+$/.test(qtyText) && Number.isSafeInteger(Number(qtyText)) && Number(qtyText) > 0 ? Number(qtyText) : null;
      if (quantity == null) issues.push(issue('INVALID_QUANTITY', '商品數量必須為正整數', extra));
      const sku = text(row[isOne ? '產品SKU' : 'Lineitem sku']);
      const productName = text(row[isOne ? '產品' : 'Lineitem name']);
      if (!sku || !productName) issues.push(issue('MISSING_PRODUCT', '商品列缺少 SKU 或產品名稱', extra));
      const unitPriceMinor = money(row[isOne ? '單價' : 'Lineitem price'], '商品單價', extra, !isOne);
      const gross = quantity != null && unitPriceMinor != null ? quantity * unitPriceMinor : null;
      if (gross != null && !Number.isSafeInteger(gross)) issues.push(issue('MONEY_OVERFLOW', '商品總額超出可安全處理範圍', extra));
      const lineDiscountMinor = isOne ? null : money(row['Lineitem discount'], 'Lineitem discount', extra);
      const lineSubtotalMinor = isOne ? money(row['小計'], '商品小計', extra) : gross == null ? null : gross - (lineDiscountMinor ?? 0);
      const groupName = isOne ? text(row['名稱']) : '';
      const kind = isOne && unitPriceMinor == null && lineSubtotalMinor == null && blank(row['數量(單品/組合/任選)']) ? 'bundle_component' : 'single';
      const explicitLineId = text(row['來源明細號'] ?? row['Lineitem id'] ?? row['Lineitem ID']);
      const identity = [platform, number, sku, productName, groupName, quantity, unitPriceMinor, lineDiscountMinor, lineSubtotalMinor];
      const canonical = JSON.stringify(identity);
      const sourceLineId = explicitLineId || stableId(identity);
      if (seenIds.has(sourceLineId)) issues.push(issue(seenIds.get(sourceLineId) === canonical ? 'AMBIGUOUS_SOURCE_LINE' : 'SOURCE_LINE_ID_COLLISION', '來源明細識別重複或衝突；請提供唯一平台商品明細 ID，不要以重新排序列號代替', extra));
      seenIds.set(sourceLineId, canonical);
      const item = { id: stableId([platform, number, sourceLineId]), sourceLineId, sourceOrderNumber: number, sourceRow, sku, productName, groupName, groupId: groupName ? stableId([platform, number, groupName]) : '', kind, quantity, unitPriceMinor, lineSubtotalMinor, lineDiscountMinor, category: '', sourceLineIdOrigin: explicitLineId ? 'platform' : 'content' };
      if (isOne && kind !== 'bundle_component' && (unitPriceMinor == null || lineSubtotalMinor == null)) issues.push(issue('MISSING_LINE_MONEY', '商品列缺少單價或小計，不能從相鄰列補價格', extra));
      if (isOne && gross != null && lineSubtotalMinor != null && gross !== lineSubtotalMinor) issues.push(issue('LINE_AMOUNT_MISMATCH', '數量乘單價與商品小計不符；請確認折扣及組合數量', extra));
      result.items.push(item); order.itemIds.push(item.id);
    }
    const items = result.items.filter((item) => item.sourceOrderNumber === number);
    for (const component of items.filter((item) => item.kind === 'bundle_component')) {
      const anchors = items.filter((item) => item.groupId === component.groupId && item.unitPriceMinor != null && item.lineSubtotalMinor != null);
      if (!component.groupName || component.groupName === '一般品' || anchors.length !== 1) issues.push(issue('AMBIGUOUS_BUNDLE', '空白價格商品無法唯一對應組合主商品，不能假設為零元', { ...context, sourceRow: component.sourceRow }));
      else { anchors[0].kind = 'bundle_anchor'; issues.push(issue('BUNDLE_ALLOCATION_REQUIRED', '組合元件價格空白；須確認由主商品承擔金額、此元件以零元入帳且照數量出貨', { ...context, sourceRow: component.sourceRow }, 'confirmation')); }
    }
    const f = order.financial;
    if (isOne) {
      if ([f.subtotalMinor, f.shippingMinor, f.feeMinor, f.totalMinor].every((n) => n != null) && f.subtotalMinor + f.shippingMinor + f.feeMinor !== f.totalMinor) issues.push(issue('ORDER_TOTAL_MISMATCH', '商品訂單金額＋運費＋金流手續費與總計不符', context));
      const knownLines = sum(items.map((i) => i.lineSubtotalMinor ?? 0));
      if (f.subtotalMinor != null && knownLines !== f.subtotalMinor) issues.push(issue('ITEM_SUBTOTAL_MISMATCH', '已知商品小計無法對應訂單商品金額；不可用訂單總額倒推單價', context));
    } else {
      const gross = sum(items.map((i) => (i.unitPriceMinor ?? 0) * (i.quantity ?? 0)));
      if ([f.shippingMinor, f.taxMinor, f.discountMinor, f.totalMinor].every((n) => n != null) && gross + f.shippingMinor + f.taxMinor - f.discountMinor !== f.totalMinor) issues.push(issue('ORDER_TOTAL_MISMATCH', '商品原額＋運費＋稅－整單折扣與總計不符，須核對原平台金額', context));
      if (f.subtotalMinor != null && sum(items.map((i) => i.lineSubtotalMinor ?? 0)) !== f.subtotalMinor) issues.push(issue('DISCOUNT_ALLOCATION_REQUIRED', '整單折扣尚未完整分攤至商品，不能自行平均或重複扣折扣', context, 'confirmation'));
      if (f.subtotalMinor != null && f.shippingMinor != null && f.taxMinor != null && f.totalMinor != null && f.subtotalMinor + f.shippingMinor + f.taxMinor !== f.totalMinor) issues.push(issue('SHIPPING_DISCOUNT_ALLOCATION_REQUIRED', '運費可能含折抵，須先取得運費折扣分攤再輸出 ECOUNT', context, 'confirmation'));
    }
    if (order.paymentStatus !== 'paid') issues.push(issue('UNPAID_ORDER', '付款狀態未證實已付；測試轉檔不會變更付款或允許正式出貨', context, 'warning'));
  }
  if (footer && !excluded.size) {
    for (const [column, field] of [['訂單金額(不含金/物流手續費)', 'subtotalMinor'], ['訂單運費', 'shippingMinor'], ['總計金額', 'totalMinor']]) {
      try {
        const value = parseMoneyMinor(footer.data[column]);
        if (value != null && result.orders.every((o) => o.financial[field] != null) && value !== sum(result.orders.map((o) => o.financial[field]))) issues.push(issue('FOOTER_AMOUNT_MISMATCH', `總計列「${column}」與訂單合計不符`, { sourceRow: footer.sourceRow }));
      } catch { issues.push(issue('INVALID_FOOTER_MONEY', '總計列金額格式無效', { sourceRow: footer.sourceRow })); }
    }
  }
  return finish();
}

function mappingIssues(parsed, settings, requireBarcode = true) {
  const issues = [];
  for (const sku of new Set(parsed.items.map((item) => item.sku))) {
    const m = settings.skuMappings?.[sku];
    if (!(m?.erpConfirmed === true || m?.confirmed === true) || !text(m?.erpSku)) issues.push(issue('PRODUCT_MAPPING_REQUIRED', `SKU ${sku} 必須確認 ERP 品項編碼`, { sku }));
    if (requireBarcode && (!text(m?.barcode) || !(m?.barcodeConfirmed === true || (m?.confirmed === true && m?.barcodeConfirmed !== false)))) issues.push(issue('BARCODE_MAPPING_REQUIRED', `SKU ${sku} 的實物條碼尚未確認，不可用 SKU 自行代替`, { sku }));
  }
  return issues;
}

export function validateMarketplaceExport(parsed, settings = {}) {
  const issues = [...(parsed.issues || []).filter((i) => i.severity === 'error'), ...mappingIssues(parsed, settings, false)];
  if (!parsed.items?.length) issues.push(issue('EMPTY_INTAKE', '沒有可轉換的商品明細'));
  for (const [key, label] of [['store', '店鋪'], ['customerCode', 'ECOUNT 客戶碼'], ['warehouseCode', '發貨倉庫'], ['batchSequence', '銷貨分組序號']]) if (!text(settings[key])) issues.push(issue('SETTING_REQUIRED', `請填寫並確認${label}`, { field: key }));
  if (!/^\d{1,4}$/.test(text(settings.batchSequence)) || !Number.isSafeInteger(Number(settings.batchSequence)) || Number(settings.batchSequence) <= 0) issues.push(issue('INVALID_BATCH_SEQUENCE', '銷貨分組序號必須是 1 至 9999 的正整數'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(settings.date)) || Number.isNaN(Date.parse(`${settings.date}T00:00:00Z`)) || new Date(`${settings.date}T00:00:00Z`).toISOString().slice(0, 10) !== settings.date) issues.push(issue('DATE_REQUIRED', '請指定有效的銷貨日期'));
  if (settings.currency !== 'TWD') issues.push(issue('CURRENCY_REQUIRED', '本次 ECOUNT 轉檔僅支援明確確認的 TWD'));
  if (!/^TEST-[A-Za-z0-9-]{1,15}$/.test(text(settings.batchNumber))) issues.push(issue('BATCH_NUMBER_REQUIRED', '請填寫 TEST- 開頭、最長 20 字的本次唯一測試追蹤號；仍須在 ERP 確認未重複使用'));
  if (!settings.taxConfirmed || settings.taxMode !== 'erp_inclusive' || text(settings.taxType) !== '11') issues.push(issue('TAX_SETTING_REQUIRED', '請確認 ECOUNT 營業稅交易類型 11，以含稅單價交由 ERP 依既有設定計稅'));
  if (text(settings.erpCurrencyCode) && settings.erpCurrencyConfirmed !== true) issues.push(issue('ERP_CURRENCY_REQUIRED', 'ECOUNT 貨幣代碼須另行確認；來源 TWD 不代表 ERP 主檔代碼'));
  for (const i of (parsed.issues || []).filter((i) => i.severity === 'confirmation')) {
    if (i.code !== 'BUNDLE_ALLOCATION_REQUIRED' || settings.bundleZeroConfirmed !== true) issues.push({ ...i, severity: 'error' });
  }
  for (const order of parsed.orders || []) {
    const context = { orderNumber: order.sourceOrderNumber };
    if (order.cancelled || !['unfulfilled'].includes(order.fulfillmentStatus) || !['paid', 'pending'].includes(order.paymentStatus) || (order.financial.refundedMinor ?? 0) > 0) issues.push(issue('ORDER_NOT_ELIGIBLE', '取消、退款、已履行或狀態不明訂單不能由此測試轉檔出貨', context));
    if (order.paymentStatus !== 'paid' && settings.pendingTestAcknowledged !== true) issues.push(issue('PENDING_TEST_ACK_REQUIRED', '請確認這是未付款訂單的限定測試，不代表已收款或正式放行', context));
    if (order.financial.currency && order.financial.currency !== settings.currency) issues.push(issue('CURRENCY_MISMATCH', '來源幣別與匯出設定不符', context));
    if ((order.financial.feeMinor ?? 0) !== 0) issues.push(issue('FEE_MAPPING_REQUIRED', '本次尚未設定金流手續費專用品項，不能漏列或併入商品', context));
    if ((order.financial.shippingMinor ?? 0) > 0 && (!settings.shippingSku?.confirmed || !settings.shippingSku?.nonStock || !text(settings.shippingSku?.erpSku))) issues.push(issue('SHIPPING_MAPPING_REQUIRED', '有運費時，須確認 ECOUNT 運費品項為非庫存／數量管理除外', context));
    for (const item of parsed.items.filter((i) => i.sourceOrderNumber === order.sourceOrderNumber)) {
      const amount = item.kind === 'bundle_component' && settings.bundleZeroConfirmed ? 0 : item.lineSubtotalMinor;
      if (amount == null) issues.push(issue('UNRESOLVED_LINE_MONEY', '商品金額仍未確認', { ...context, sourceRow: item.sourceRow }));
      else if (item.quantity && amount % item.quantity !== 0) issues.push(issue('UNIT_PRICE_PRECISION', '商品淨額無法以兩位小數單價精確分配；須先確認 ECOUNT 精度及分攤方式', { ...context, sourceRow: item.sourceRow }));
    }
  }
  for (const sku of new Set(parsed.items.map((item) => item.sku))) {
    const m = settings.skuMappings?.[sku];
    if (!text(m?.barcode) || !(m?.barcodeConfirmed === true || (m?.confirmed === true && m?.barcodeConfirmed !== false))) issues.push(issue('BARCODE_UNCONFIRMED', `SKU ${sku} 條碼待確認；ECOUNT 銷貨檔不含條碼，之後 WMS 作業前仍須核對`, { sku }, 'warning'));
  }
  return { ok: !issues.some((i) => i.severity === 'error'), issues };
}

const REPORT_HEADERS = ['平台', '店鋪', '商城訂單編號', '付款狀態', '付款方式', '付款期限提示', '履行狀態', '商品列數', '商品件數', '商品金額', '運費', '金流手續費', '稅額（來源）', '折扣（來源）', '訂單總額（非實收）', '退款（來源）', '未收餘額（來源）', '來源銷售頁', '來源銷售頁前綴', '購物金折抵（來源）', '點數折現（來源）', '自訂折扣（來源）', '附加費（來源）'];

function financialReportRow(parsed, order, settings) {
  const items = parsed.items.filter((item) => item.sourceOrderNumber === order.sourceOrderNumber);
  const f = order.financial;
  const moneyCell = (value) => value == null ? '' : value / 100;
  return [order.sourcePlatform, text(settings.store), order.sourceOrderNumber, order.rawPaymentStatus, order.paymentMethod, order.paymentNote, order.rawFulfillmentStatus, items.length, sum(items.map((i) => i.quantity)), moneyCell(f.subtotalMinor), moneyCell(f.shippingMinor), moneyCell(f.feeMinor), moneyCell(f.taxMinor), moneyCell(f.discountMinor), moneyCell(f.totalMinor), moneyCell(f.refundedMinor), moneyCell(f.outstandingMinor), order.salesPageName, order.salesPagePrefix, moneyCell(f.creditMinor), moneyCell(f.pointsMinor), moneyCell(f.customDiscountMinor), moneyCell(f.surchargeMinor)];
}

export function buildMarketplaceAuditRows(parsed, settings = {}) {
  const issues = [...(parsed.issues || []).filter((i) => i.severity === 'error')];
  return { ok: issues.length === 0, issues, headers: [...REPORT_HEADERS, '核對狀態'], rows: issues.length ? [] : parsed.orders.map((order) => [...financialReportRow(parsed, order, settings), '待核對；訂單總額不是實收，不是出貨授權或 ERP／WMS 匯入檔']), summary: { ...parsed.summary } };
}

export function buildEcountRows(parsed, settings = {}) {
  const validation = validateMarketplaceExport(parsed, settings);
  const result = { ...validation, headers: [...ECOUNT_HEADERS], rows: [], reportHeaders: [...REPORT_HEADERS], reportRows: [], summary: { ...parsed.summary } };
  if (!validation.ok) return result;
  const emitted = new Map();
  const rowFor = (order, item, mapping, amount, shipping = false) => {
    emitted.set(order.sourceOrderNumber, (emitted.get(order.sourceOrderNumber) || 0) + amount);
    const row = Array(27).fill('');
    const put = { 0: settings.date.replaceAll('-', ''), 1: Number(settings.batchSequence), 2: text(settings.customerCode), 3: text(settings.customerName), 6: text(settings.warehouseCode), 7: text(settings.taxType), 8: text(settings.erpCurrencyCode), 10: text(settings.batchNumber), 11: text(mapping.erpSku), 12: order.sourceOrderNumber, 13: order.sourcePlatform, 14: text(settings.store), 15: item.sourceLineId, 16: text(mapping.erpName || mapping.name || item.productName), 18: text(mapping.spec), 19: item.quantity, 21: (amount / item.quantity) / 100, 25: shipping ? '運費；非實體商品，預揀表不計件' : `來源商品：${item.sku}；付款：${order.rawPaymentStatus}${item.kind === 'bundle_component' ? '；已確認組合元件零元，仍出貨' : ''}` };
    for (const [index, value] of Object.entries(put)) row[Number(index)] = value;
    return row;
  };
  for (const order of parsed.orders) {
    const items = parsed.items.filter((i) => i.sourceOrderNumber === order.sourceOrderNumber);
    for (const item of items) result.rows.push(rowFor(order, item, settings.skuMappings[item.sku], item.kind === 'bundle_component' ? 0 : item.lineSubtotalMinor));
    if (order.financial.shippingMinor > 0) result.rows.push(rowFor(order, { quantity: 1, sourceLineId: stableId([order.sourcePlatform, order.sourceOrderNumber, 'shipping']), productName: '運費（非庫存）' }, settings.shippingSku, order.financial.shippingMinor, true));
    const f = order.financial;
    result.reportRows.push(financialReportRow(parsed, order, settings));
    if (emitted.get(order.sourceOrderNumber) !== f.totalMinor) result.issues.push(issue('ECOUNT_ROUNDTRIP_MISMATCH', 'ECOUNT 商品／運費及稅額合計與來源訂單總額不符，請調整經確認的稅制或分攤', { orderNumber: order.sourceOrderNumber }));
  }
  result.ok = !result.issues.some((i) => i.severity === 'error');
  if (!result.ok) { result.rows = []; result.reportRows = []; }
  else result.summary = { ...result.summary, ecountRowCount: result.rows.length, ecountTotalMinor: sum([...emitted.values()]), physicalItemCount: parsed.items.length, physicalQuantity: sum(parsed.items.map((i) => i.quantity)) };
  return result;
}

export function buildPrepickRows(parsed, settings = {}) {
  const preview = settings.preview === true;
  const issues = [...(parsed.issues || []).filter((i) => i.severity === 'error'), ...(preview ? [] : mappingIssues(parsed, settings))];
  if (!preview && parsed.orders.some((o) => o.paymentStatus !== 'paid') && settings.pendingTestAcknowledged !== true) issues.push(issue('PENDING_TEST_ACK_REQUIRED', '未付款訂單預揀表僅供明確確認的限定測試'));
  if (!preview && parsed.orders.some((o) => o.cancelled || o.fulfillmentStatus !== 'unfulfilled' || !['paid', 'pending'].includes(o.paymentStatus) || (o.financial.refundedMinor ?? 0) > 0)) issues.push(issue('ORDER_NOT_ELIGIBLE', '此檔包含不能出貨的訂單狀態'));
  const result = { ok: issues.length === 0, issues, headers: ['分類（對照設定）', '來源SKU', 'ECOUNT品項編碼', preview ? '商品條碼（確認後顯示）' : '已確認國際條碼', '商品名稱', '實體數量', '商城訂單數', '來源商城訂單', '來源組合／分組', '用途'], rows: [], summary: { ...parsed.summary } };
  if (!result.ok) return result;
  const groups = new Map();
  for (const item of parsed.items) {
    const m = settings.skuMappings?.[item.sku] || {};
    const key = JSON.stringify([item.sku, m.erpSku, m.barcode]);
    if (!groups.has(key)) groups.set(key, { item, mapping: m, quantity: 0, orders: new Set(), groups: new Set() });
    const group = groups.get(key);
    group.quantity += item.quantity; group.orders.add(item.sourceOrderNumber);
    if (item.groupName) group.groups.add(item.groupName);
  }
  result.rows = [...groups.values()].map(({ item, mapping: m, quantity, orders, groups: sourceGroups }) => {
    const barcodeConfirmed = m.barcodeConfirmed === true || (m.confirmed === true && m.barcodeConfirmed !== false);
    return [text(m.category) || '未分類', item.sku, text(m.erpSku), barcodeConfirmed ? text(m.barcode) : '', text(m.erpName || item.productName), quantity, orders.size, [...orders].sort().join(' / '), [...sourceGroups].join(' / '), preview ? `待核對${!text(m.barcode) || !barcodeConfirmed ? '；條碼未確認' : ''}；不是出貨授權或 ERP／WMS 匯入檔` : '測試預揀；不是 ECOUNT／WMS 匯入檔'];
  });
  result.summary = { ...result.summary, skuCount: result.rows.length, physicalQuantity: sum(result.rows.map((r) => r[5])) };
  return result;
}
