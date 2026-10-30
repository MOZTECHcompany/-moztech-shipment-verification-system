import React, { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../ui';
import apiClient from '@/api/api.js';
import { API_ORIGIN } from '../../api/origin';
import { getNativeRuntime } from '../../workspace/nativeRuntime.js';
import { downloadNativeMarketplaceFile } from '../../workspace/downloads.js';
import { comparisonOrders, completeComparison, liveDifferences, orderDifferences, orderReviewState, reviewDecisions, reviewEditGroups, uncoveredReviewCancellations, uniqueBlockedReasons } from '../../utils/marketplaceDraftDiff.mjs';

const endpoint = '/api/marketplace-intakes/draft-overwrite';
const scopeMode = 'uploaded-file-v2';
const amount = value => value == null ? '未提供' : (Number(value) / 100).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
const list = value => Array.isArray(value) ? value : [];
const numberOf = order => String(order.orderNumber);
const validCount = value => Number.isSafeInteger(value) && value >= 0;
const reasonText = value => {
  const message = typeof value === 'string' ? value : value?.message || '';
  const number = typeof value?.orderNumber === 'string' ? value.orderNumber.trim() : '';
  return number && number.length <= 100 && !message.includes(number) ? `${number}：${message}` : message;
};
const errorText = (failure, fallback) => reasonText(failure.response?.data) || failure.message || fallback;
const validBatch = batch => batch && /^[1-9]\d{0,9}$/.test(String(batch.id)) && typeof batch.batchNumber === 'string' && validCount(batch.activeOrderCount) && batch.activeOrderCount > 0;
const validPreview = data => {
  if (data?.scopeMode !== scopeMode || typeof data.previewFingerprint !== 'string' || !data.previewFingerprint || !Array.isArray(data.affectedBatches) || !Array.isArray(data.newOrders) || !Array.isArray(data.blockedReasons) || typeof data.canConfirm !== 'boolean' || !data.summary) return false;
  const { totalOrderCount, newOrderCount, changedOrderCount, unchangedOrderCount, quantity, totalMinor } = data.summary;
  const uploaded = data.affectedBatches.flatMap(batch => list(batch.uploadedOrders));
  return [totalOrderCount, newOrderCount, changedOrderCount, unchangedOrderCount, quantity, totalMinor].every(validCount)
    && totalOrderCount > 0 && totalOrderCount === newOrderCount + changedOrderCount + unchangedOrderCount
    && data.newOrders.length === newOrderCount && uploaded.length === changedOrderCount + unchangedOrderCount;
};
const validBarcodePrerequisites = value => value?.required === true
  && value.code === 'MARKETPLACE_BARCODE_REVIEW_REQUIRED'
  && Number.isSafeInteger(value.count) && value.count > 0 && value.count <= 5000
  && Array.isArray(value.sourceSkus) && value.sourceSkus.length === value.count
  && value.sourceSkus.every(sku => typeof sku === 'string' && sku.trim() === sku && sku.length > 0 && sku.length <= 100 && !/[\u0000-\u001f\u007f]/.test(sku))
  && new Set(value.sourceSkus).size === value.count;

const itemName = item => item?.name || item?.productName || item?.sku || '未命名商品';
const itemLabel = item => `${itemName(item)}${item?.sku ? `（${item.sku}）` : ''}`;
const valueText = value => value == null ? '未提供' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const fieldLabels = { name: '名稱', quantity: '數量', unitMinor: '單價', lineSubtotalMinor: '金額' };
const fieldText = (field, value) => ['unitMinor', 'lineSubtotalMinor'].includes(field) ? `NT$ ${amount(value)}` : valueText(value);
const itemText = item => `${itemName(item)}・${valueText(item?.quantity)} 件${item?.unitMinor != null ? `・單價 NT$ ${amount(item.unitMinor)}` : ''}${item?.lineSubtotalMinor != null ? `・金額 NT$ ${amount(item.lineSubtotalMinor)}` : ''}`;

const originalValue = 'max-w-full break-words rounded-md bg-slate-100 px-2 py-0.5 text-slate-600';
const updatedValue = 'max-w-full break-words rounded-md bg-blue-50 px-2 py-0.5 font-semibold text-blue-900';

function ChangedValue({ before, after }) {
  return <span className="inline-flex max-w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><span className={originalValue}><span className="mr-1 text-sm">原</span>{before}</span><span className="text-slate-400" aria-hidden="true">→</span><span className={updatedValue}><span className="mr-1 text-sm font-normal">改為</span>{after}</span></span>;
}

function ReplacementItems({ group }) {
  return <div className="min-w-0 space-y-2">
    <p className="break-words text-base font-medium text-slate-800">{group.productLabel}</p>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <div className="min-w-0 rounded-lg bg-slate-50 p-3 sm:p-4" aria-label="取消品項">
        <p className="text-sm font-medium text-slate-500">取消品項</p>
        <div className="mt-2 flex min-w-0 items-baseline justify-between gap-3">
          <strong className="min-w-0 break-words text-xl font-medium leading-7 text-slate-600" data-review-value="before">{group.beforeLabel}</strong>
          <span className="shrink-0 whitespace-nowrap text-xl font-semibold tabular-nums text-slate-600">{group.removed[0].quantity} 件</span>
        </div>
      </div>
      <div className="min-w-0 rounded-lg border border-blue-200 bg-blue-50 p-3 sm:p-4" aria-label="改為出貨">
        <p className="text-sm font-medium text-blue-700">改為出貨</p>
        <div className="mt-2 flex min-w-0 items-baseline justify-between gap-3">
          <strong className="min-w-0 break-words text-xl font-semibold leading-7 text-blue-900" data-review-value="after">{group.afterLabel}</strong>
          <span className="shrink-0 whitespace-nowrap text-xl font-semibold tabular-nums text-blue-900">{group.added[0].quantity} 件</span>
        </div>
      </div>
    </div>
  </div>;
}

function LiveAmounts({ order, showExport = false }) {
  return <p className="mt-2 text-sm leading-6 text-slate-600">商城目前成交 NT$ {amount(order.live.totalMinor)}{order.live.receivedMinor != null ? `／已收款 NT$ ${amount(order.live.receivedMinor)}` : ''}{order.live.outstandingMinor != null ? `／未收款 NT$ ${amount(order.live.outstandingMinor)}` : ''}{showExport ? `；本次出貨銷貨 NT$ ${amount(order.after?.totalMinor)}` : ''}；不會修改商城收款。</p>;
}

function ItemDifference({ change }) {
  if (change.kind === 'group') return <li className="space-y-2"><p className="text-base font-medium">同品號多筆明細異動</p><div className="grid gap-x-4 gap-y-2 sm:grid-cols-2"><div className="min-w-0"><span className="text-sm text-slate-500">原有</span><ul className="text-slate-600">{change.before.map((item, index) => <li key={index} className="break-words">{itemText(item)}</li>)}</ul></div><div className="min-w-0"><span className="text-sm text-blue-900">改為</span><ul className="font-semibold text-blue-900">{change.after.map((item, index) => <li key={index} className="break-words">{itemText(item)}</li>)}</ul></div></div></li>;
  if (change.kind !== 'changed') { const item = change.before || change.after; return <li className="break-words"><span className={change.kind === 'removed' ? originalValue : updatedValue}>{change.kind === 'removed' ? '移除' : '新增'} {itemName(item)} ×{valueText(item.quantity)}</span>{item.lineSubtotalMinor != null ? <span className="ml-2 text-base text-slate-600">NT$ {amount(item.lineSubtotalMinor)}</span> : null}</li>; }
  return <li className="space-y-1 break-words"><p className="text-base font-medium">{itemName(change.before)}</p>{change.fields.map(change => <p key={change.field} className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><span className="text-base text-slate-600">{fieldLabels[change.field]}</span><ChangedValue before={fieldText(change.field, change.before)} after={fieldText(change.field, change.after)} /></p>)}</li>;
}

function OrderReviewFacts({ review }) {
  const groups = reviewEditGroups(review);
  return <ul className="mt-3 space-y-3 text-lg leading-7" aria-label="取消與退款核對">
    {groups.map(group => <li key={group.agreementId} className="min-w-0" aria-label="商城修改">{group.paired ? <ReplacementItems group={group} /> : <ul className="space-y-2">{group.removed.map(item => <li key={item.saleId} className="break-words"><span className={originalValue}>已移除 {item.name} ×{item.quantity}</span></li>)}{group.added.map(item => <li key={item.saleId} className="break-words"><span className={updatedValue}>已加入 {item.name} ×{item.quantity}</span></li>)}</ul>}</li>)}
    {uncoveredReviewCancellations(review).map(item => <li key={item.id} className="break-words"><span className={originalValue}>取消 {item.name} ×{item.quantity}</span><span className="ml-2 text-base text-slate-600">本次不出貨</span></li>)}
    {review.decisionRequired && <li className="space-y-1"><p className="text-base text-slate-600">商城 NT$ {amount(review.live.totalMinor)}</p><p className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><span className={updatedValue}>本次銷貨 NT$ {amount(review.proposal.salesTotalMinor)}</span><span className="font-semibold text-blue-900">額外折讓 NT$ {amount(review.proposal.allowanceMinor)}</span></p></li>}
  </ul>;
}

function OrderReviewDetails({ review }) {
  return <><p className="mt-2">{review.summary}</p><p>本次出貨 {review.remainingItems.reduce((sum, item) => sum + item.quantity, 0)} 件{!review.decisionRequired && `・本次銷貨 NT$ ${amount(review.live.totalMinor)}`}</p><p>原退款 NT$ {amount(review.live.refundedMinor)}／退款後實收 NT$ {amount(review.live.netPaymentMinor)}</p>
    <ul>{[...review.cancelledItems, ...review.remainingItems].map(item => <li key={item.id} className="break-words">{item.name} ×{item.quantity}・{item.sku}{item.reason ? `・${item.reason}` : ''}</li>)}</ul>
    {reviewEditGroups(review).map(group => <div key={group.agreementId} className="mt-1"><p>商城修改時間：{group.happenedAt}</p><ul>{[...group.removed, ...group.added].map(item => <li key={item.saleId}>{item.name} ×{item.quantity}・{item.sku}</li>)}</ul></div>)}
    <p>不會修改商城收款。</p>
  </>;
}

function OrderComparison({ order, review }) {
  const diff = orderDifferences(order);
  const officialAdditions = reviewEditGroups(review).flatMap(group => group.added);
  const usedAdditions = new Set();
  const usedCancellations = new Set();
  const itemChanges = diff.items.filter(change => {
    if (review && change.kind === 'added') {
      const item = change.after;
      const matches = officialAdditions.filter(added => !usedAdditions.has(added.saleId) && item.quantity === added.quantity && (item.id ? item.id === added.id : item.sku === added.sku && itemName(item) === added.name && diff.items.filter(value => value.kind === 'added' && value.after.sku === item.sku).length === 1 && officialAdditions.filter(value => value.sku === item.sku).length === 1));
      if (matches.length === 1) { usedAdditions.add(matches[0].saleId); return false; }
    }
    if (!review || change.kind !== 'removed') return true;
    const item = change.before;
    if (!item.id && review.remainingItems.some(remaining => remaining.sku === item.sku)) return true;
    const matches = review.cancelledItems.filter(cancelled => {
      if (usedCancellations.has(cancelled.id) || item.quantity !== cancelled.quantity) return false;
      if (item.id) return item.id === cancelled.id;
      if (item.sku !== cancelled.sku) return false;
      return itemName(item) === cancelled.name || diff.items.filter(value => value.kind === 'removed' && value.before.sku === item.sku).length === 1 && review.cancelledItems.filter(value => value.sku === item.sku).length === 1;
    });
    if (matches.length !== 1) return true;
    usedCancellations.add(matches[0].id); return false;
  });
  const changedItems = diff.items.flatMap(change => change.kind === 'group' ? [...change.before, ...change.after] : [change.before || change.after]);
  const skus = [...new Set(changedItems.map(item => item.sku).filter(Boolean))];
  const liveDifference = diff.liveMoneyChanged || diff.liveQuantityChanged;
  const hasReplacement = reviewEditGroups(review).some(group => group.paired);
  return <li className="min-w-0 py-4 first:pt-0 last:pb-0" aria-label={`訂單異動 ${order.orderNumber}`}><p className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1"><strong className="break-all text-lg font-semibold">{order.orderNumber}</strong>{hasReplacement ? <span className="text-sm font-medium text-blue-700">商品更換</span> : !order.changed && !order.restoring && <span className="text-sm text-slate-500">需核對商城現況</span>}</p>
    {review && <OrderReviewFacts review={review} />}
    <ul className="mt-3 space-y-3 text-lg leading-7" aria-label="實質異動">
      {diff.restoring && <li>恢復出貨，使用本次檔案的內容。</li>}
      {itemChanges.map(change => <ItemDifference key={change.key} change={change} />)}
      {diff.quantityChanged && !diff.items.length && <li>商品件數 <ChangedValue before={valueText(order.before?.quantity)} after={valueText(order.after?.quantity)} /></li>}
      {!review?.decisionRequired && diff.totalChanged && <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><span className="text-base text-slate-600">出貨金額</span><ChangedValue before={`NT$ ${amount(order.before?.totalMinor)}`} after={`NT$ ${amount(order.after?.totalMinor)}`} />{diff.liveMoneyChanged && <span className="text-base text-slate-600">商城仍 NT$ {amount(order.live.totalMinor)}</span>}</li>}
      {!review?.decisionRequired && !diff.totalChanged && diff.liveMoneyChanged && <li><span className={updatedValue}>出貨金額 NT$ {amount(order.after.totalMinor)}</span><span className="ml-2 text-base text-slate-600">／商城 NT$ {amount(order.live.totalMinor)}</span></li>}
      {diff.liveQuantityChanged && <li><span className={updatedValue}>本次出貨 {order.after.quantity} 件</span><span className="ml-2 text-base text-slate-600">／商城現況 {order.live.quantity} 件</span></li>}
      {diff.shipping.map(change => <li key={change.field} className="space-y-1 break-words"><p className="text-base text-slate-600">{change.label}</p><ChangedValue before={valueText(change.before) || '未提供'} after={change.after == null || change.after === '' ? '清空' : valueText(change.after)} /></li>)}
      {diff.otherChanged && <li>其他內容有異動，將使用本次檔案。</li>}
    </ul>
    {(review || skus.length > 0 || diff.showLiveAmounts || liveDifference) && <details className="mt-3 text-sm leading-6 text-slate-500"><summary className="cursor-pointer">查看明細</summary>
      {review && <OrderReviewDetails review={review} />}
      {skus.length > 0 && <p className="mt-1 break-all">商品品號：{skus.join('、')}</p>}
      {diff.items.some(change => change.kind === 'group') && <p className="mt-1">同品號多筆明細以整組列出，未指定逐筆對應。</p>}
      {!review && diff.showLiveAmounts && <LiveAmounts order={order} />}
      {!review && liveDifference && !diff.showLiveAmounts && <p>不會修改商城收款。</p>}
    </details>}
  </li>;
}

function NewOrder({ order, review }) {
  const { money: moneyDiffers, quantity: quantityDiffers } = liveDifferences(order);
  return <li className="py-2 first:pt-0 last:pb-0" aria-label={`新增訂單 ${order.orderNumber}`}><p className="text-base"><strong className="break-all font-semibold">{order.orderNumber}</strong>・{order.after.quantity} 件・NT$ {amount(order.after.totalMinor)}</p><ul className="mt-1 text-sm leading-6 text-slate-600">{list(order.after.items).map((item, index) => <li key={index} className="break-words">{itemLabel(item)} × {valueText(item.quantity)}</li>)}</ul>{!review && moneyDiffers && <LiveAmounts order={order} />}{quantityDiffers && <p className="mt-1 text-sm text-slate-600">商城現況 {order.live.quantity} 件／本次出貨 {order.after.quantity} 件。</p>}</li>;
}

function NewOrderReview({ order, review }) {
  const live = liveDifferences(order);
  return <li className="min-w-0 py-4 first:pt-0 last:pb-0" aria-label={`新增訂單需核對 ${order.orderNumber}`}><p className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1"><strong className="break-all text-lg font-semibold">{order.orderNumber}</strong><span className="text-sm text-slate-500">新訂單</span></p>
    {review && <OrderReviewFacts review={review} />}
    <ul className="mt-3 space-y-3 text-lg leading-7" aria-label="實質異動">
      {!review && live.money && <li><span className={updatedValue}>出貨金額 NT$ {amount(order.after.totalMinor)}</span><span className="ml-2 text-base text-slate-600">／商城 NT$ {amount(order.live.totalMinor)}</span></li>}
      {live.quantity && <li><span className={updatedValue}>本次出貨 {order.after.quantity} 件</span><span className="ml-2 text-base text-slate-600">／商城現況 {order.live.quantity} 件</span></li>}
    </ul>
    {(review || live.money || live.quantity) && <details className="mt-3 text-sm leading-6 text-slate-500"><summary className="cursor-pointer">查看明細</summary>{review ? <OrderReviewDetails review={review} /> : live.money ? <LiveAmounts order={order} /> : <p>不會修改商城收款。</p>}</details>}
  </li>;
}

export default function MarketplaceDraftOverwrite({ rows, settings, profileId, isCurrent, onClose, onComplete, onBusyChange, onBarcodeReview }) {
  // Parent refreshes cannot replace the source or identity during confirmation.
  const scope = useRef({ rows, settings, profileId, isCurrent, onComplete, onBusyChange, onBarcodeReview });
  const mounted = useRef(false), inFlight = useRef(false), sequence = useRef(0), command = useRef(null), receipt = useRef(null), activePreview = useRef(null);
  const handedOff = useRef(false);
  const [preview, setPreview] = useState(null), [busy, setBusy] = useState(false);
  const confirmationId = useId();
  const [error, setError] = useState(''), [unknown, setUnknown] = useState(false), [result, setResult] = useState(null), [fileDelivered, setFileDelivered] = useState(false);
  const current = () => mounted.current && scope.current.isCurrent();
  const sourceBody = () => ({ scopeMode, rows: scope.current.rows, settings: scope.current.settings, ...(scope.current.profileId ? { profileId: scope.current.profileId } : {}) });
  const markBusy = value => { setBusy(value); scope.current.onBusyChange?.(value); };

  const compare = async (notice = '') => {
    if (!current() || inFlight.current || command.current || receipt.current) return;
    inFlight.current = true; const request = ++sequence.current;
    markBusy(true); setError(notice); setPreview(null); setResult(null); setFileDelivered(false); setUnknown(false); command.current = null; receipt.current = null;
    try {
      const response = await apiClient.post(`${endpoint}/preview`, sourceBody(), { timeout: 75000 });
      if (!current() || request !== sequence.current) return;
      if (!validPreview(response.data)) throw Error('整份檔案比對未完成，請重新比對。');
      setPreview(response.data);
    } catch (failure) {
      if (current() && request === sequence.current) setError(errorText(failure, '無法比對，請重試。'));
    } finally {
      inFlight.current = false;
      if (mounted.current && request === sequence.current) markBusy(false);
    }
  };

  useEffect(() => {
    mounted.current = true;
    compare();
    return () => { mounted.current = false; sequence.current++; scope.current.onBusyChange?.(false); };
  }, []);

  const batches = list(preview?.affectedBatches), newOrders = list(preview?.newOrders);
  const retainedCount = validCount(preview?.retainedOrderCount) ? preview.retainedOrderCount : batches.reduce((sum, batch) => sum + (validCount(batch.retainedOrderCount) ? batch.retainedOrderCount : list(batch.omittedOrders).length), 0);
  const comparisonComplete = completeComparison(preview);
  const { needsReview: changedOrders, unchanged } = comparisonOrders(preview);
  const reviews = orderReviewState(preview), byNumber = new Map(reviews.reviews.map(review => [review.orderNumber, review]));
  const newReviews = newOrders.filter(order => byNumber.has(order.orderNumber) || liveDifferences(order).money || liveDifferences(order).quantity);
  const hasAllowance = reviews.reviews.some(review => review.decisionRequired);
  const reasons = uniqueBlockedReasons([...list(preview?.blockedReasons), ...reviews.reasons]);
  const blocked = !comparisonComplete || !reviews.valid || preview?.canConfirm !== true || list(preview?.blockedReasons).length > 0 || reviews.reviews.some(review => !review.canConfirm || review.blockedReasons.length > 0) || reasons.length > 0;
  const canConfirm = !!preview && !blocked && !busy && !unknown && !result;
  const barcodePrerequisites = blocked && validBarcodePrerequisites(preview?.barcodePrerequisites) && typeof scope.current.onBarcodeReview === 'function' ? preview.barcodePrerequisites : null;
  activePreview.current = preview;

  const returnToBarcodeReview = async () => {
    // Only an unsubmitted comparison can be discarded. Unknown commands keep
    // their original UUID and receipt recovery path, even through old handlers.
    if (!current() || inFlight.current || handedOff.current || command.current || receipt.current || unknown || result || activePreview.current !== preview || !barcodePrerequisites) return;
    handedOff.current = true; inFlight.current = true; markBusy(true);
    try {
      if (await scope.current.onBarcodeReview() === false && current()) {
        handedOff.current = false; setError('尚未取得最新商品資料，請重新核對。');
      }
    } catch { if (current()) { handedOff.current = false; setError('尚未取得最新商品資料，請重新核對。'); } }
    finally { inFlight.current = false; if (mounted.current) markBusy(false); }
  };

  const deliverFile = async batch => {
    if (!current()) return false;
    if (getNativeRuntime()) return downloadNativeMarketplaceFile({ id: batch.id, kind: 'ecount' }, { isCurrent: current });
    const response = await apiClient.post(`/api/marketplace-intakes/${batch.id}/download-link`, { kind: 'ecount' }, { withCredentials: true });
    if (!current()) return false;
    const anchor = document.createElement('a'); anchor.href = `${API_ORIGIN}${response.data.url}`; anchor.download = '';
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    return true;
  };

  const confirm = async () => {
    if (!current() || inFlight.current || receipt.current || (!command.current && (!canConfirm || activePreview.current !== preview))) return;
    if (!command.current) command.current = {
      ...sourceBody(), confirmed: true, notImportedConfirmed: true,
      commandId: crypto.randomUUID(), previewFingerprint: preview.previewFingerprint,
      ...(reviews.reviews.length ? { reviewDecisions: reviewDecisions(preview) } : {}),
    };
    inFlight.current = true; const request = ++sequence.current;
    markBusy(true); setError('');
    let stale = false;
    try {
      // An uncertain response must reuse this exact body and operation UUID.
      const response = await apiClient.post(`${endpoint}/confirm`, command.current, { timeout: 75000 });
      if (!current() || request !== sequence.current) return;
      if (response.data?.applied !== true || response.data.scopeMode !== scopeMode || !validBatch(response.data.exportBatch)) throw Error('尚未收到完整產檔結果。');
      receipt.current = response.data;
      setResult(response.data); setUnknown(false);
      try {
        const delivered = await deliverFile(response.data.exportBatch);
        if (current() && request === sequence.current) setFileDelivered(delivered === true);
      } catch (failure) {
        if (current() && request === sequence.current) setError(`整份銷貨檔已準備完成；${errorText(failure, '下載未完成，可重試下載。')}`);
      }
      if (!current() || request !== sequence.current) return;
      try { await scope.current.onComplete?.(response.data); } catch {
        if (current()) setError('整份銷貨檔已準備完成；批次清單尚未更新，可稍後重新載入。');
      }
    } catch (failure) {
      if (!current() || request !== sequence.current) return;
      const status = failure.response?.status;
      if (status === 409) { stale = true; command.current = null; }
      else if (status >= 400 && status < 500) {
        command.current = null; setUnknown(false); setError(errorText(failure, '本次尚未修正，請重新比對。')); setPreview(null);
      } else {
        setUnknown(true);
        setError('尚未確認伺服器是否完成。請核對同一筆操作的結果，期間不要重新上傳或重複產檔。');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current && request === sequence.current) markBusy(false);
    }
    if (stale && current()) await compare('訂單或比對內容已更新，已重新比對，請重新核對並確認。');
  };

  const download = async () => {
    if (!current() || inFlight.current || !validBatch(result?.exportBatch)) return;
    inFlight.current = true; markBusy(true); setError('');
    try { const delivered = await deliverFile(result.exportBatch); if (current()) setFileDelivered(delivered === true); }
    catch (failure) { if (current()) setError(errorText(failure, '下載未完成，可重試下載。')); }
    finally { inFlight.current = false; if (current()) markBusy(false); }
  };

  return <section className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-4 text-slate-900 sm:p-5" aria-label="整份訂單比對助理" aria-busy={busy}>
    <div className="flex min-w-0 items-start justify-between gap-3"><h3 className="min-w-0 text-xl font-semibold leading-7">{preview && !result && comparisonComplete && !blocked ? changedOrders.length + newReviews.length > 0 ? `需核對 ${changedOrders.length + newReviews.length} 筆訂單` : '檔案已核對，可直接轉檔' : '訂單比對'}</h3><Button variant="ghost" className="shrink-0" disabled={busy || unknown || Boolean(command.current && !receipt.current)} onClick={() => { if (mounted.current && !busy && !unknown && !inFlight.current && (!command.current || receipt.current)) onClose(); }}>{result ? '完成' : '取消'}</Button></div>
    {busy && <p role="status" className="text-sm text-slate-700">{command.current ? '正在核對並準備整份銷貨檔…' : '正在比對整份檔案與已保存的訂單…'}</p>}
    {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{error}</p>}
    {!preview && !busy && !unknown && !result && <Button onClick={() => compare()}>重新核對</Button>}
    {preview && !result && <>
      {comparisonComplete && !blocked ? <>
        <p className="text-sm text-slate-500">整份 {preview.summary.totalOrderCount} 筆・{preview.summary.quantity} 件・NT$ {amount(preview.summary.totalMinor)}</p>
        {(changedOrders.length > 0 || newReviews.length > 0) && <ul className="min-w-0 divide-y divide-slate-200" aria-label="需核對訂單">{changedOrders.map(order => <OrderComparison key={numberOf(order)} order={order} review={byNumber.get(order.orderNumber)} />)}{newReviews.map(order => <NewOrderReview key={numberOf(order)} order={order} review={byNumber.get(order.orderNumber)} />)}</ul>}
        {(unchanged.length > 0 || newOrders.length > 0 || retainedCount > 0) && <details className="text-sm leading-6 text-slate-500" aria-label="完整檔案摘要"><summary className="cursor-pointer">整份轉檔內容</summary><div className="mt-3 space-y-3">
          {unchanged.length > 0 && <details aria-label="相同訂單單號"><summary className="cursor-pointer">相同 {unchanged.length} 筆，一併轉檔・查看單號</summary><p className="mt-2 break-words">{unchanged.map(numberOf).join('、')}</p></details>}
          {newOrders.length > 0 && <details><summary className="cursor-pointer">新訂單 {newOrders.length} 筆，一併轉檔・查看明細</summary><ul className="mt-3 divide-y divide-slate-100">{newOrders.map(order => <NewOrder key={numberOf(order)} order={order} review={byNumber.get(order.orderNumber)} />)}</ul></details>}
          {retainedCount > 0 && <p>另有 {retainedCount} 筆舊單未上傳，保留原狀，不列入本次銷貨檔。</p>}
        </div></details>}

      </> : <p className="text-sm font-medium">尚無法完成比對</p>}
      {barcodePrerequisites && <p role="status" className="text-base leading-6 text-slate-700">{barcodePrerequisites.count} 項商品需核對條碼。完成後會重新比對這份訂單。</p>}
      {reasons.length > 0 && <ul role="alert" className="list-disc space-y-1 rounded-lg bg-amber-50 py-2 pl-7 pr-3 text-sm text-amber-950">{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      {blocked && reasons.length === 0 && <p role="alert" className="text-sm text-amber-950">訂單資料尚未完成核對，請重新核對。</p>}
      {!unknown && <div className="flex min-w-0 flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
        {blocked ? barcodePrerequisites ? <Button disabled={busy || handedOff.current || Boolean(command.current) || Boolean(receipt.current)} onClick={returnToBarcodeReview}>返回商品條碼核對</Button> : <Button disabled={busy} onClick={() => compare()}>重新核對</Button> : <><p id={confirmationId} className="min-w-0 max-w-2xl text-sm leading-6 text-slate-600">{hasAllowance ? '確認此批尚未匯入 ECOUNT，依上述取消品項、實收與額外折讓轉檔，新檔取代舊檔。' : '確認此批尚未匯入 ECOUNT，新檔取代舊檔。'}</p><Button className="w-full shrink-0 sm:w-auto" disabled={!canConfirm} aria-describedby={confirmationId} onClick={confirm}>{hasAllowance ? '確認實收與折讓並轉檔' : '確認未匯入並轉檔'}</Button></>}
      </div>}
    </>}
    {unknown && <Button disabled={busy} onClick={confirm}>核對同一筆操作結果</Button>}
    {result && <div className="space-y-3 rounded-lg bg-white p-4" role="status"><p className="font-medium text-emerald-800">整份銷貨檔已準備完成，請只使用這份檔案。</p><p className="text-sm text-slate-700">上一版檔案請停止使用。後續請使用下列批次回匯 ECOUNT 理貨單。</p>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"><div className="min-w-0 text-sm"><strong className="break-all">{result.exportBatch.batchNumber}</strong><p>{result.exportBatch.activeOrderCount} 筆訂單・{result.exportBatch.quantity ?? '—'} 件商品・NT$ {amount(result.exportBatch.totalMinor)}</p></div><Button disabled={busy} onClick={download}>{fileDelivered ? '重新下載整份銷貨檔' : '下載整份銷貨檔'}</Button></div>
    </div>}
  </section>;
}
