import React, { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../ui';
import apiClient from '@/api/api.js';
import { API_ORIGIN } from '../../api/origin';
import { getNativeRuntime } from '../../workspace/nativeRuntime.js';
import { downloadNativeMarketplaceFile } from '../../workspace/downloads.js';
import { comparisonOrders, completeComparison, liveDifferences, orderDifferences, uniqueBlockedReasons } from '../../utils/marketplaceDraftDiff.mjs';

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

const itemName = item => item?.name || item?.productName || item?.sku || '未命名商品';
const itemLabel = item => `${itemName(item)}${item?.sku ? `（${item.sku}）` : ''}`;
const valueText = value => value == null ? '未提供' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const fieldLabels = { name: '名稱', quantity: '數量', unitMinor: '單價', lineSubtotalMinor: '金額' };
const fieldText = (field, value) => ['unitMinor', 'lineSubtotalMinor'].includes(field) ? `NT$ ${amount(value)}` : valueText(value);
const itemText = item => `${itemName(item)}・${valueText(item?.quantity)} 件${item?.unitMinor != null ? `・單價 NT$ ${amount(item.unitMinor)}` : ''}${item?.lineSubtotalMinor != null ? `・金額 NT$ ${amount(item.lineSubtotalMinor)}` : ''}`;

function LiveAmounts({ order, showExport = false }) {
  return <p className="mt-2 text-xs leading-5 text-slate-600">商城目前成交 NT$ {amount(order.live.totalMinor)}{order.live.receivedMinor != null ? `／已收款 NT$ ${amount(order.live.receivedMinor)}` : ''}{order.live.outstandingMinor != null ? `／未收款 NT$ ${amount(order.live.outstandingMinor)}` : ''}{showExport ? `；本次出貨銷貨 NT$ ${amount(order.after?.totalMinor)}` : ''}；不會修改商城收款。</p>;
}

function ItemDifference({ change }) {
  if (change.kind === 'group') return <li className="space-y-1"><p className="font-medium">同品號多筆明細異動</p><div className="grid gap-x-4 gap-y-1 sm:grid-cols-2"><div className="min-w-0"><span className="text-xs text-slate-500">原有</span><ul>{change.before.map((item, index) => <li key={index} className="break-words">{itemText(item)}</li>)}</ul></div><div className="min-w-0"><span className="text-xs text-slate-500">改為</span><ul>{change.after.map((item, index) => <li key={index} className="break-words">{itemText(item)}</li>)}</ul></div></div></li>;
  if (change.kind !== 'changed') { const item = change.before || change.after; return <li className="break-words">{change.kind === 'removed' ? '移除' : '新增'} {itemName(item)} ×{valueText(item.quantity)}{item.lineSubtotalMinor != null ? `・NT$ ${amount(item.lineSubtotalMinor)}` : ''}</li>; }
  return <li className="break-words"><span className="font-medium">{itemName(change.before)}</span>：{change.fields.map((change, index) => <React.Fragment key={change.field}>{index > 0 && '；'}{fieldLabels[change.field]} {fieldText(change.field, change.before)} → {fieldText(change.field, change.after)}</React.Fragment>)}</li>;
}

function OrderComparison({ order }) {
  const diff = orderDifferences(order);
  const changedItems = diff.items.flatMap(change => change.kind === 'group' ? [...change.before, ...change.after] : [change.before || change.after]);
  const skus = [...new Set(changedItems.map(item => item.sku).filter(Boolean))];
  const liveDifference = diff.liveMoneyChanged || diff.liveQuantityChanged;
  return <li className="py-4 first:pt-0 last:pb-0" aria-label={`訂單異動 ${order.orderNumber}`}><p className="text-sm"><strong className="break-all">{order.orderNumber}</strong><span className="ml-2 text-slate-600">重複／{order.changed || order.restoring ? '有異動' : '需核對商城現況'}</span></p>
    <ul className="mt-1 space-y-1 text-sm leading-6" aria-label="實質異動">
      {diff.restoring && <li>恢復出貨，使用本次檔案的內容。</li>}
      {diff.items.map(change => <ItemDifference key={change.key} change={change} />)}
      {diff.quantityChanged && !diff.items.length && <li>商品件數 {valueText(order.before?.quantity)} → {valueText(order.after?.quantity)}</li>}
      {diff.totalChanged && <li>出貨金額 NT$ {amount(order.before?.totalMinor)} → NT$ {amount(order.after?.totalMinor)}{diff.liveMoneyChanged && `；商城仍 NT$ ${amount(order.live.totalMinor)}`}</li>}
      {!diff.totalChanged && diff.liveMoneyChanged && <li>出貨金額 NT$ {amount(order.after.totalMinor)}／商城 NT$ {amount(order.live.totalMinor)}</li>}
      {diff.liveQuantityChanged && <li>本次出貨 {order.after.quantity} 件／商城現況 {order.live.quantity} 件</li>}
      {diff.shipping.map(change => <li key={change.field} className="break-words">{change.label}：{valueText(change.before) || '未提供'} → {change.after == null || change.after === '' ? '清空' : valueText(change.after)}</li>)}
      {diff.otherChanged && <li>其他內容有異動，將使用本次檔案。</li>}
    </ul>
    {liveDifference && <p className="mt-1 text-xs text-slate-500">不會修改商城收款。</p>}
    {(skus.length > 0 || diff.showLiveAmounts) && <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">查看明細</summary>
      {skus.length > 0 && <p className="mt-1 break-all">商品品號：{skus.join('、')}</p>}
      {diff.items.some(change => change.kind === 'group') && <p className="mt-1">同品號多筆明細以整組列出，未指定逐筆對應。</p>}
      {diff.showLiveAmounts && <LiveAmounts order={order} />}
    </details>}
  </li>;
}

function NewOrder({ order }) {
  const { money: moneyDiffers, quantity: quantityDiffers } = liveDifferences(order);
  return <li className="py-2 first:pt-0 last:pb-0" aria-label={`新增訂單 ${order.orderNumber}`}><p className="text-sm"><strong className="break-all">{order.orderNumber}</strong>・{order.after.quantity} 件・NT$ {amount(order.after.totalMinor)}</p><ul className="mt-1 text-xs leading-5 text-slate-600">{list(order.after.items).map((item, index) => <li key={index} className="break-words">{itemLabel(item)} × {valueText(item.quantity)}</li>)}</ul>{moneyDiffers && <LiveAmounts order={order} />}{quantityDiffers && <p className="mt-1 text-xs text-slate-600">商城現況 {order.live.quantity} 件／本次出貨 {order.after.quantity} 件。</p>}</li>;
}

function NewOrderReview({ order }) {
  const live = liveDifferences(order);
  return <li className="py-4 first:pt-0 last:pb-0" aria-label={`新增訂單需核對 ${order.orderNumber}`}><p className="text-sm"><strong>{order.orderNumber}</strong><span className="ml-2 text-slate-600">新增／需核對商城現況</span></p>
    <ul className="mt-1 text-sm leading-6" aria-label="實質異動">
      {live.money && <li>出貨金額 NT$ {amount(order.after.totalMinor)}／商城 NT$ {amount(order.live.totalMinor)}</li>}
      {live.quantity && <li>本次出貨 {order.after.quantity} 件／商城現況 {order.live.quantity} 件</li>}
    </ul><p className="mt-1 text-xs text-slate-500">不會修改商城收款。</p>
  </li>;
}

export default function MarketplaceDraftOverwrite({ rows, settings, profileId, isCurrent, onClose, onComplete, onBusyChange }) {
  // Parent refreshes cannot replace the source or identity during confirmation.
  const scope = useRef({ rows, settings, profileId, isCurrent, onComplete, onBusyChange });
  const mounted = useRef(false), inFlight = useRef(false), sequence = useRef(0), command = useRef(null), receipt = useRef(null), activePreview = useRef(null);
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
  const { uploaded, needsReview: changedOrders, unchanged } = comparisonOrders(preview);
  const newReviews = newOrders.filter(order => liveDifferences(order).money || liveDifferences(order).quantity);
  const reasons = uniqueBlockedReasons(preview?.blockedReasons);
  const blocked = !comparisonComplete || preview?.canConfirm !== true || list(preview?.blockedReasons).length > 0;
  const canConfirm = !!preview && !blocked && !busy && !unknown && !result;
  activePreview.current = preview;

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

  return <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 text-slate-900 sm:p-5" aria-label="整份訂單比對助理" aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">訂單比對</h3><Button variant="secondary" disabled={busy || unknown || Boolean(command.current && !receipt.current)} onClick={() => { if (mounted.current && !busy && !unknown && !inFlight.current && (!command.current || receipt.current)) onClose(); }}>{result ? '完成' : '取消'}</Button></div>
    {busy && <p role="status" className="text-sm text-slate-700">{command.current ? '正在核對並準備整份銷貨檔…' : '正在比對整份檔案與已保存的訂單…'}</p>}
    {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{error}</p>}
    {!preview && !busy && !unknown && !result && <Button onClick={() => compare()}>重新核對</Button>}
    {preview && !result && <>
      {comparisonComplete && !blocked ? <>
        <div className="text-sm leading-6"><p className="font-medium">重複 {uploaded.length} 筆・需核對 {changedOrders.length + newReviews.length} 筆・新增 {newOrders.length} 筆</p><p className="text-xs text-slate-500">整份 {preview.summary.totalOrderCount} 筆・{preview.summary.quantity} 件・NT$ {amount(preview.summary.totalMinor)}</p></div>
        {(changedOrders.length > 0 || newReviews.length > 0) && <ul className="divide-y divide-slate-200" aria-label="需核對訂單">{changedOrders.map(order => <OrderComparison key={numberOf(order)} order={order} />)}{newReviews.map(order => <NewOrderReview key={numberOf(order)} order={order} />)}</ul>}
        {unchanged.length > 0 && <details className="text-sm text-slate-600" aria-label="相同訂單單號"><summary className="cursor-pointer">相同 {unchanged.length} 筆，一併轉檔・查看單號</summary><p className="mt-2 break-words text-xs leading-6">{unchanged.map(numberOf).join('、')}</p></details>}
        {newOrders.length > 0 && <details className="text-sm text-slate-600"><summary className="cursor-pointer">新增 {newOrders.length} 筆，一併轉檔・查看明細</summary><ul className="mt-3 divide-y divide-slate-100">{newOrders.map(order => <NewOrder key={numberOf(order)} order={order} />)}</ul></details>}
        {retainedCount > 0 && <p className="text-xs leading-5 text-slate-600">另有 {retainedCount} 筆舊單未上傳，保留原狀，不列入本次銷貨檔。</p>}
      </> : <p className="text-sm font-medium">尚無法完成比對</p>}
      {reasons.length > 0 && <ul role="alert" className="list-disc space-y-1 rounded-lg bg-amber-50 py-2 pl-7 pr-3 text-sm text-amber-950">{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      {blocked && reasons.length === 0 && <p role="alert" className="text-sm text-amber-950">訂單資料尚未完成核對，請重新核對。</p>}
      {!unknown && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-200 pt-4">
        {blocked ? <Button disabled={busy} onClick={() => compare()}>重新核對</Button> : <><p id={confirmationId} className="text-xs leading-5 text-slate-600">確認此批尚未匯入 ECOUNT，新檔取代舊檔。</p><Button disabled={!canConfirm} aria-describedby={confirmationId} onClick={confirm}>確認未匯入並轉檔</Button></>}
      </div>}
    </>}
    {unknown && <Button disabled={busy} onClick={confirm}>核對同一筆操作結果</Button>}
    {result && <div className="space-y-3 rounded-lg bg-white p-4" role="status"><p className="font-medium text-emerald-800">整份銷貨檔已準備完成，請只使用這份檔案。</p><p className="text-sm text-slate-700">上一版檔案請停止使用。後續請使用下列批次回匯 ECOUNT 理貨單。</p>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"><div className="min-w-0 text-sm"><strong className="break-all">{result.exportBatch.batchNumber}</strong><p>{result.exportBatch.activeOrderCount} 筆訂單・{result.exportBatch.quantity ?? '—'} 件商品・NT$ {amount(result.exportBatch.totalMinor)}</p></div><Button disabled={busy} onClick={download}>{fileDelivered ? '重新下載整份銷貨檔' : '下載整份銷貨檔'}</Button></div>
    </div>}
  </section>;
}
