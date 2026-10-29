import React, { useEffect, useRef, useState } from 'react';
import { Button } from '../../ui';
import apiClient from '@/api/api.js';
import { API_ORIGIN } from '../../api/origin';
import { getNativeRuntime } from '../../workspace/nativeRuntime.js';
import { downloadNativeMarketplaceFile } from '../../workspace/downloads.js';

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

function OrderSnapshot({ title, value }) {
  return <div className="min-w-0 rounded-lg bg-slate-50 p-3"><h5 className="font-medium">{title}</h5>
    <p className="mt-1 text-sm text-slate-600">{value?.quantity ?? '—'} 件・NT$ {amount(value?.totalMinor)}</p>
    <ul className="mt-2 space-y-2 text-sm">{list(value?.items).map((item, index) => <li key={`${item.sku}:${index}`} className="break-words">
      <p>{item.name || item.productName || item.sku}</p><p className="text-slate-600">{item.sku}・{item.quantity} 件・單價 NT$ {amount(item.unitMinor)}・小計 NT$ {amount(item.lineSubtotalMinor)}</p>
    </li>)}</ul>
    {value?.shipping && <dl className="mt-3 space-y-1 border-t border-slate-200 pt-2 text-sm">{Object.entries({ recipient: '收件人', phone: '電話', address: '地址', postalCode: '郵遞區號', method: '配送方式', storeName: '門市名稱', storeCode: '門市代號', trackingNumber: '物流單號', note: '備註' }).filter(([key]) => value.shipping[key]).map(([key, label]) => <div key={key} className="break-words"><dt className="inline text-slate-600">{label}：</dt><dd className="inline">{value.shipping[key]}</dd></div>)}</dl>}
  </div>;
}

function LiveAmounts({ order }) {
  return order.live && <div className="mt-3 rounded-lg bg-blue-50 p-3 text-sm leading-6"><p>商城目前成交 NT$ {amount(order.live.totalMinor)}{order.live.receivedMinor != null ? `／已收款 NT$ ${amount(order.live.receivedMinor)}` : ''}{order.live.outstandingMinor != null ? `／未收款 NT$ ${amount(order.live.outstandingMinor)}` : ''}</p><p>本次出貨銷貨 NT$ {amount(order.after?.totalMinor)}</p><p className="mt-1 text-slate-600">本次只修正出貨銷貨內容，不會修改商城收款。</p></div>;
}

function OrderComparison({ order }) {
  return <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm"><strong className="break-all">{order.orderNumber}</strong>・{order.restoring ? '將依本次檔案恢復出貨' : order.changed ? '內容有異動，將使用新版修正' : '內容相同，仍列入整份銷貨檔'}・查看前後明細</summary>
    <LiveAmounts order={order} />
    <div className="mt-3 grid gap-3 sm:grid-cols-2"><OrderSnapshot title="原訂單" value={order.before} /><OrderSnapshot title="新版訂單" value={order.after} /></div>
  </details>;
}

export default function MarketplaceDraftOverwrite({ rows, settings, profileId, isCurrent, onClose, onComplete, onBusyChange }) {
  // Parent refreshes cannot replace the source or identity during confirmation.
  const scope = useRef({ rows, settings, profileId, isCurrent, onComplete, onBusyChange });
  const mounted = useRef(false), inFlight = useRef(false), sequence = useRef(0), command = useRef(null), receipt = useRef(null);
  const [preview, setPreview] = useState(null), [notImported, setNotImported] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [unknown, setUnknown] = useState(false), [result, setResult] = useState(null), [fileDelivered, setFileDelivered] = useState(false);
  const current = () => mounted.current && scope.current.isCurrent();
  const sourceBody = () => ({ scopeMode, rows: scope.current.rows, settings: scope.current.settings, ...(scope.current.profileId ? { profileId: scope.current.profileId } : {}) });
  const markBusy = value => { setBusy(value); scope.current.onBusyChange?.(value); };

  const compare = async (notice = '') => {
    if (!current() || inFlight.current || command.current || receipt.current) return;
    inFlight.current = true; const request = ++sequence.current;
    markBusy(true); setError(notice); setPreview(null); setNotImported(false); setResult(null); setFileDelivered(false); setUnknown(false); command.current = null; receipt.current = null;
    try {
      const response = await apiClient.post(`${endpoint}/preview`, sourceBody(), { timeout: 75000 });
      if (!current() || request !== sequence.current) return;
      if (!validPreview(response.data)) throw Error('整份檔案比對未完成，請重新比對。');
      setPreview(response.data);
    } catch (failure) {
      if (current() && request === sequence.current) setError(errorText(failure, '無法比對，請重試。'));
    } finally {
      inFlight.current = false;
      if (current() && request === sequence.current) markBusy(false);
    }
  };

  useEffect(() => {
    mounted.current = true;
    compare();
    return () => { mounted.current = false; sequence.current++; scope.current.onBusyChange?.(false); };
  }, []);

  const batches = list(preview?.affectedBatches), newOrders = list(preview?.newOrders);
  const retainedCount = validCount(preview?.retainedOrderCount) ? preview.retainedOrderCount : batches.reduce((sum, batch) => sum + (validCount(batch.retainedOrderCount) ? batch.retainedOrderCount : list(batch.omittedOrders).length), 0);
  const blocked = preview?.canConfirm !== true || list(preview?.blockedReasons).length > 0;
  const canConfirm = !!preview && !blocked && notImported && !busy && !unknown && !result;

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
    if (!current() || inFlight.current || receipt.current || (!command.current && !canConfirm)) return;
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
        command.current = null; setUnknown(false); setError(errorText(failure, '本次尚未修正，請重新比對。')); setPreview(null); setNotImported(false);
      } else {
        setUnknown(true);
        setError('尚未確認伺服器是否完成。請核對同一筆操作的結果，期間不要重新上傳或重複產檔。');
      }
    } finally {
      inFlight.current = false;
      if (current() && request === sequence.current) markBusy(false);
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

  return <section className="mt-5 space-y-4 rounded-xl border border-blue-200 bg-blue-50/40 p-4 text-slate-900 sm:p-5" aria-label="整份訂單比對助理" aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">整份訂單比對助理</h3><Button variant="secondary" disabled={busy || unknown} onClick={() => { if (current() && !inFlight.current && (!command.current || receipt.current)) onClose(); }}>{result ? '完成' : '取消'}</Button></div>
    {busy && <p role="status" className="text-sm text-slate-700">{command.current ? '正在核對並準備整份銷貨檔…' : '正在比對整份檔案與已保存的訂單…'}</p>}
    {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{error}</p>}
    {!preview && !busy && !unknown && !result && <Button variant="secondary" onClick={() => compare()}>重新比對</Button>}
    {preview && !result && <>
      <div className="rounded-lg bg-white p-4 text-sm leading-6"><p>本次整份檔案 {preview.summary.totalOrderCount} 筆：新單 {preview.summary.newOrderCount} 筆、異動 {preview.summary.changedOrderCount} 筆、相同 {preview.summary.unchangedOrderCount} 筆。</p><p>{preview.summary.quantity} 件商品・本次銷貨 NT$ {amount(preview.summary.totalMinor)}</p><p className="mt-1">請核對以下內容，確認後將所有本次訂單一起產生一份銷貨檔。相同的訂單也會列入。</p></div>
      {list(preview.blockedReasons).length > 0 && <ul role="alert" className="list-disc space-y-1 rounded-lg bg-amber-50 py-3 pl-8 pr-3 text-sm text-amber-950">{preview.blockedReasons.map((reason, index) => <li key={index}>{reasonText(reason)}</li>)}</ul>}
      {newOrders.length > 0 && <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"><h4 className="font-medium">本次新增 {newOrders.length} 筆</h4>{newOrders.map(order => <details key={numberOf(order)} className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm"><strong className="break-all">{order.orderNumber}</strong>・新單・查看明細</summary><LiveAmounts order={order} /><div className="mt-3"><OrderSnapshot title="本次訂單" value={order.after} /></div></details>)}</div>}
      {batches.map(batch => <div key={batch.id} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4"><h4 className="break-words font-medium">已保存訂單・原批次 {batch.batchNumber}</h4>
        {list(batch.uploadedOrders).filter(order => order.changed).map(order => <OrderComparison key={numberOf(order)} order={order} />)}
        {list(batch.uploadedOrders).some(order => !order.changed) && <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm">{list(batch.uploadedOrders).filter(order => !order.changed).length} 筆內容相同・查看明細</summary><div className="mt-3 space-y-3">{list(batch.uploadedOrders).filter(order => !order.changed).map(order => <OrderComparison key={numberOf(order)} order={order} />)}</div></details>}
      </div>)}
      {retainedCount > 0 && <p className="rounded-lg bg-white p-4 text-sm leading-6">另有 {retainedCount} 筆已保存訂單未在本次檔案中，會保留原狀，也不會列入本次銷貨檔。</p>}
      {!unknown && <div className="space-y-3 rounded-lg bg-white p-4"><p className="text-sm font-medium">是否依本次檔案修正訂單，並重新提供整份銷貨檔？</p>
        <label className="flex min-h-11 items-start gap-3 py-2 text-sm leading-6"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={notImported} disabled={busy || blocked} onChange={event => setNotImported(event.target.checked)} /><span>我已核對整份內容，尚未匯入 ECOUNT；若有舊版銷貨檔將停止使用</span></label>
        <Button disabled={!canConfirm} onClick={confirm}>確認覆蓋並下載整份銷貨檔</Button>
      </div>}
    </>}
    {unknown && <Button disabled={busy} onClick={confirm}>核對同一筆操作結果</Button>}
    {result && <div className="space-y-3 rounded-lg bg-white p-4" role="status"><p className="font-medium text-emerald-800">整份銷貨檔已準備完成，請只使用這份檔案。</p><p className="text-sm text-slate-700">上一版檔案請停止使用。後續請使用下列批次回匯 ECOUNT 理貨單。</p>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"><div className="min-w-0 text-sm"><strong className="break-all">{result.exportBatch.batchNumber}</strong><p>{result.exportBatch.activeOrderCount} 筆訂單・{result.exportBatch.quantity ?? '—'} 件商品・NT$ {amount(result.exportBatch.totalMinor)}</p></div><Button disabled={busy} onClick={download}>{fileDelivered ? '重新下載整份銷貨檔' : '下載整份銷貨檔'}</Button></div>
    </div>}
  </section>;
}
