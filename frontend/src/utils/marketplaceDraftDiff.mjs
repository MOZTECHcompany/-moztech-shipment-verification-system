// Presentation only: never infer fees, stock changes or line identity from totals/SKU.
const list = value => Array.isArray(value) ? value : [];
const text = value => value == null ? '' : String(value);
const name = item => item?.name ?? item?.productName ?? '';
const sku = item => text(item?.sku);
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
};
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const fields = item => ({ name: name(item), quantity: item?.quantity, unitMinor: item?.unitMinor, lineSubtotalMinor: item?.lineSubtotalMinor });
const itemEqual = (a, b) => sku(a) === sku(b) && equal(fields(a), fields(b));
const shippingLabels = { recipient: '收件人', phone: '電話', address: '地址', postalCode: '郵遞區號', method: '配送方式', storeName: '門市名稱', storeCode: '門市代號', trackingNumber: '物流單號', note: '備註' };

export function itemDifferences(before, after) {
  const old = list(before).map((item, index) => ({ item, index }));
  const next = list(after).map((item, index) => ({ item, index }));
  const used = new Set(), remaining = [];
  // Consume identical rows one at a time. A Map keyed only by SKU would lose
  // duplicates, and a position-based match would invent changes after reordering.
  for (const row of old) {
    const match = next.findIndex((other, index) => !used.has(index) && itemEqual(row.item, other.item));
    if (match >= 0) used.add(match); else remaining.push(row);
  }
  const incoming = next.filter((_, index) => !used.has(index));
  const keys = [...new Set([...remaining, ...incoming].map(row => sku(row.item)))];
  return keys.flatMap(key => {
    const previous = remaining.filter(row => sku(row.item) === key), current = incoming.filter(row => sku(row.item) === key);
    const base = { sku: key, name: name(current[0]?.item) || name(previous[0]?.item) || key || '未命名商品' };
    if (!previous.length) return current.map(row => ({ ...base, name: name(row.item) || key || '未命名商品', key: `added:${row.index}`, kind: 'added', after: row.item }));
    if (!current.length) return previous.map(row => ({ ...base, name: name(row.item) || key || '未命名商品', key: `removed:${row.index}`, kind: 'removed', before: row.item }));
    if (previous.length === 1 && current.length === 1) {
      const before = previous[0].item, after = current[0].item;
      return [{ ...base, key: `changed:${previous[0].index}:${current[0].index}`, kind: 'changed', before, after,
        fields: Object.keys(fields(before)).filter(field => !equal(fields(before)[field], fields(after)[field])).map(field => ({ field, before: fields(before)[field], after: fields(after)[field] })) }];
    }
    // Summary DTO has no sourceLineId or variantId. Several residual rows of
    // one SKU have no provable pairing, so preserve the complete residual group.
    return [{ ...base, key: `group:${key}`, kind: 'group', before: previous.map(row => row.item), after: current.map(row => row.item) }];
  });
}

export function liveDifferences(order) {
  const known = value => Number.isSafeInteger(value) && value >= 0;
  return { money: known(order?.live?.totalMinor) && known(order?.after?.totalMinor) && order.live.totalMinor !== order.after.totalMinor,
    quantity: known(order?.live?.quantity) && known(order?.after?.quantity) && order.live.quantity !== order.after.quantity };
}

export function orderDifferences(order) {
  const before = order?.before || {}, after = order?.after || {};
  const items = itemDifferences(before.items, after.items);
  const shipping = [...new Set([...Object.keys(before.shipping || {}), ...Object.keys(after.shipping || {})])]
    .filter(field => !equal(before.shipping?.[field], after.shipping?.[field]))
    .map(field => ({ field, label: shippingLabels[field] || '其他配送資料', before: before.shipping?.[field], after: after.shipping?.[field] }));
  const totalChanged = !equal(before.totalMinor, after.totalMinor);
  const quantityChanged = !equal(before.quantity, after.quantity);
  const live = liveDifferences(order);
  const liveMoneyKnown = Number.isSafeInteger(order?.live?.totalMinor) && Number.isSafeInteger(after.totalMinor);
  return { items, shipping, totalChanged, quantityChanged, liveMoneyChanged: live.money, liveQuantityChanged: live.quantity, restoring: order?.restoring === true,
    showLiveAmounts: Boolean(liveMoneyKnown && (totalChanged || live.money || items.some(item => item.kind !== 'changed' || item.fields.some(field => ['unitMinor', 'lineSubtotalMinor'].includes(field.field))))),
    otherChanged: order?.changed === true && !order?.restoring && !items.length && !shipping.length && !totalChanged && !quantityChanged };
}

export function completeComparison(preview) {
  const selected = [...list(preview?.newOrders), ...list(preview?.affectedBatches).flatMap(batch => list(batch.uploadedOrders))];
  const valid = value => Number.isSafeInteger(value) && value >= 0;
  return selected.length === preview?.summary?.totalOrderCount && selected.length > 0
    && selected.every(order => list(order.after?.items).length > 0 && valid(order.after.quantity) && order.after.quantity > 0 && valid(order.after.totalMinor)
      && order.after.items.every(item => item && valid(item.quantity) && item.quantity > 0)
      && order.after.items.reduce((sum, item) => sum + item.quantity, 0) === order.after.quantity)
    && selected.reduce((sum, order) => sum + order.after.quantity, 0) === preview.summary.quantity
    && selected.reduce((sum, order) => sum + order.after.totalMinor, 0) === preview.summary.totalMinor;
}

export function uniqueBlockedReasons(reasons) {
  const result = [];
  for (const reason of list(reasons)) {
    const message = text(typeof reason === 'string' ? reason : reason?.message).trim();
    const number = typeof reason?.orderNumber === 'string' ? reason.orderNumber.trim() : '';
    const value = number && number.length <= 100 && !message.includes(number) ? `${number}：${message}` : message;
    if (value && !result.includes(value)) result.push(value);
  }
  return result;
}
