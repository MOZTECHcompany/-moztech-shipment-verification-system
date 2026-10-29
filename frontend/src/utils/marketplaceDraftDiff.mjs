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

export function comparisonOrders(preview) {
  const uploaded = list(preview?.affectedBatches).flatMap(batch => list(batch.uploadedOrders));
  const reviews = new Set(list(preview?.orderReviews).map(review => review.orderNumber));
  const needsReview = [], unchanged = [];
  for (const order of uploaded) {
    const live = liveDifferences(order);
    (order.changed || order.restoring || live.money || live.quantity || reviews.has(order.orderNumber) ? needsReview : unchanged).push(order);
  }
  return { uploaded, needsReview, unchanged };
}

export function reviewEditGroups(review) {
  return list(review?.editChanges).map(group => {
    const removed = list(group.removedItems), added = list(group.addedItems);
    const before = removed[0], after = added[0];
    let beforeLabel = '', afterLabel = '';
    if (removed.length === 1 && added.length === 1) {
      const oldOptions = list(before.selectedOptions), newOptions = list(after.selectedOptions);
      const oldByName = new Map(oldOptions.map(option => [option.name, option.value])), newByName = new Map(newOptions.map(option => [option.name, option.value]));
      if (oldOptions.length && oldByName.size === oldOptions.length && newByName.size === newOptions.length && oldByName.size === newByName.size && [...oldByName.keys()].every(name => newByName.has(name))) {
        const changed = [...oldByName.keys()].filter(name => oldByName.get(name) !== newByName.get(name));
        beforeLabel = changed.map(name => oldByName.get(name)).join('／'); afterLabel = changed.map(name => newByName.get(name)).join('／');
      }
      if (!beforeLabel && before.variantTitle && after.variantTitle && before.variantTitle !== after.variantTitle) { beforeLabel = before.variantTitle; afterLabel = after.variantTitle; }
    }
    const paired = group.canPair === true && removed.length === 1 && added.length === 1 && before.quantity === after.quantity && before.productId && before.productId === after.productId && before.variantId && after.variantId && before.variantId !== after.variantId && beforeLabel && afterLabel && (after.productTitle || before.productTitle);
    return { ...group, removed, added, paired: Boolean(paired), productLabel: paired ? after.productTitle || before.productTitle : '', beforeLabel, afterLabel };
  });
}

export function uncoveredReviewCancellations(review) {
  const removed = reviewEditGroups(review).flatMap(group => group.removed);
  return list(review?.cancelledItems).filter(item => removed.filter(line => line.id === item.id && line.sku === item.sku).reduce((sum, line) => sum + line.quantity, 0) !== item.quantity);
}

function validEditChanges(review) {
  if (review.editChanges == null) return true;
  const item = value => value && typeof value.id === 'string' && value.id && typeof value.saleId === 'string' && value.saleId && typeof value.sku === 'string' && value.sku && typeof value.name === 'string' && value.name && Number.isSafeInteger(value.quantity) && value.quantity > 0
    && ['productId', 'productTitle', 'variantId', 'variantTitle'].every(key => value[key] == null || typeof value[key] === 'string')
    && (value.selectedOptions == null || Array.isArray(value.selectedOptions) && value.selectedOptions.every(option => option && typeof option.name === 'string' && option.name && typeof option.value === 'string' && option.value));
  return Array.isArray(review.editChanges) && new Set(review.editChanges.map(group => group?.agreementId)).size === review.editChanges.length && review.editChanges.every(group => group && typeof group.agreementId === 'string' && group.agreementId && typeof group.happenedAt === 'string' && Number.isFinite(Date.parse(group.happenedAt)) && /^[a-f0-9]{64}$/.test(group.evidenceFingerprint || '') && typeof group.canPair === 'boolean' && Array.isArray(group.removedItems) && Array.isArray(group.addedItems) && group.removedItems.length + group.addedItems.length > 0 && group.removedItems.every(item) && group.addedItems.every(item));
}

// Server proposals are displayed verbatim. This validates their shape and
// consistency; it never selects a refunded SKU or calculates a sales proposal.
export function orderReviewState(preview) {
  if (preview?.reviewRequired == null && preview?.orderReviews == null) return { valid: true, reviews: [], reasons: [] };
  const invalid = number => `${number ? `${number}：` : ''}取消與退款核對資料未完整回傳，請重新核對商城訂單。`;
  if (typeof preview?.reviewRequired !== 'boolean' || !Array.isArray(preview?.orderReviews) || preview.reviewRequired !== (preview.orderReviews.length > 0)) return { valid: false, reviews: [], reasons: [invalid()] };
  const known = value => Number.isSafeInteger(value) && value >= 0;
  const item = row => row && typeof row.id === 'string' && row.id && typeof row.name === 'string' && row.name && typeof row.sku === 'string' && row.sku && Number.isSafeInteger(row.quantity) && row.quantity > 0;
  const numbers = new Set(), selectedOrders = [...list(preview.newOrders), ...list(preview.affectedBatches).flatMap(batch => list(batch.uploadedOrders))], selected = new Map(selectedOrders.map(order => [order.orderNumber, order]));
  for (const review of preview.orderReviews) {
    const number = typeof review?.orderNumber === 'string' && review.orderNumber.length <= 100 ? review.orderNumber : '';
    const proposal = review?.proposal;
    if (!number || numbers.has(number) || selected.size > 0 && !selected.has(number)
      || !['partial_refund', 'removed_items'].includes(review.type) || typeof review.summary !== 'string'
      || !Array.isArray(review.cancelledItems) || !review.cancelledItems.every(row => item(row) && typeof row.reason === 'string')
      || !Array.isArray(review.remainingItems) || !review.remainingItems.length || !review.remainingItems.every(item)
      || !validEditChanges(review)
      || ![review.live?.totalMinor, review.live?.refundedMinor, review.live?.netPaymentMinor].every(known)
      || typeof review.decisionRequired !== 'boolean' || typeof review.canConfirm !== 'boolean' || !Array.isArray(review.blockedReasons)
      || !review.blockedReasons.every(reason => typeof reason === 'string' || reason && typeof reason.message === 'string')
      || review.decisionRequired && (review.type !== 'partial_refund' || proposal?.decision !== 'net-payment-with-allowance-v1' || !/^[a-f0-9]{64}$/.test(proposal?.fingerprint || '')
        || ![proposal.salesTotalMinor, proposal.allowanceMinor].every(known) || proposal.salesTotalMinor !== review.live.netPaymentMinor || proposal.salesTotalMinor + proposal.allowanceMinor !== review.live.totalMinor)
      || !review.decisionRequired && proposal != null
      || selected.has(number) && (selected.get(number).after?.quantity !== review.remainingItems.reduce((sum, item) => sum + item.quantity, 0) || selected.get(number).after?.totalMinor !== (review.decisionRequired ? proposal.salesTotalMinor : review.live.totalMinor))) return { valid: false, reviews: [], reasons: [invalid(number)] };
    numbers.add(number);
  }
  const reasons = preview.orderReviews.flatMap(review => review.blockedReasons.length ? review.blockedReasons.map(reason => typeof reason === 'string' ? { orderNumber: review.orderNumber, message: reason } : { ...reason, orderNumber: reason.orderNumber || review.orderNumber }) : review.canConfirm ? [] : [{ orderNumber: review.orderNumber, message: '取消或退款資料尚未核對完成，請重新取得商城訂單。' }]);
  return { valid: true, reviews: preview.orderReviews, reasons: uniqueBlockedReasons(reasons) };
}

export function reviewDecisions(preview) {
  const state = orderReviewState(preview);
  if (!state.valid || state.reasons.length || state.reviews.some(review => !review.canConfirm || review.blockedReasons.length > 0)) return null;
  return state.reviews.filter(review => review.decisionRequired).map(review => ({ orderNumber: review.orderNumber, decision: review.proposal.decision, fingerprint: review.proposal.fingerprint }));
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
