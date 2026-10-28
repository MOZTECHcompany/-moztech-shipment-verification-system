import React, { useEffect, useRef, useState } from 'react';
import { Button } from '../../ui';
import apiClient from '@/api/api.js';
import { API_ORIGIN } from '../../api/origin';
import { getNativeRuntime } from '../../workspace/nativeRuntime.js';
import { downloadNativeMarketplaceFile } from '../../workspace/downloads.js';

const endpoint = '/api/marketplace-intakes/draft-overwrite';
const amount = value => value == null ? '未提供' : (Number(value) / 100).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
const list = value => Array.isArray(value) ? value : [];
const numberOf = order => String(order.orderNumber);

function OrderSnapshot({ title, value }) {
  return <div className="min-w-0 rounded-lg bg-slate-50 p-3"><h5 className="font-medium">{title}</h5>
    <p className="mt-1 text-sm text-slate-600">{value?.quantity ?? '—'} 件・NT$ {amount(value?.totalMinor)}</p>
    <ul className="mt-2 space-y-2 text-sm">{list(value?.items).map((item, index) => <li key={`${item.sku}:${index}`} className="break-words">
      <p>{item.name || item.productName || item.sku}</p><p className="text-slate-600">{item.sku}・{item.quantity} 件・NT$ {amount(item.lineSubtotalMinor)}</p>
    </li>)}</ul>
    {value?.shipping && <dl className="mt-3 space-y-1 border-t border-slate-200 pt-2 text-sm">{Object.entries({ recipient: '收件人', phone: '電話', address: '地址', postalCode: '郵遞區號', method: '配送方式', storeName: '門市名稱', storeCode: '門市代號', trackingNumber: '物流單號', note: '備註' }).filter(([key]) => value.shipping[key]).map(([key, label]) => <div key={key} className="break-words"><dt className="inline text-slate-600">{label}：</dt><dd className="inline">{value.shipping[key]}</dd></div>)}</dl>}
  </div>;
}

function OrderComparison({ order }) {
  return <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm"><strong className="break-all">{order.orderNumber}</strong>・{order.restoring ? '先前暫不出貨，將依新版恢復出貨' : order.changed ? '內容有異動，將使用新版修正' : '內容相同，可重新產檔'}・查看前後明細</summary>
    {order.live && <div className="mt-3 rounded-lg bg-blue-50 p-3 text-sm leading-6"><p>商城目前成交 NT$ {amount(order.live.totalMinor)}{order.live.receivedMinor != null ? `／已收款 NT$ ${amount(order.live.receivedMinor)}` : ''}{order.live.outstandingMinor != null ? `／未收款 NT$ ${amount(order.live.outstandingMinor)}` : ''}</p><p>新版出貨銷貨 NT$ {amount(order.after?.totalMinor)}</p><p className="mt-1 text-slate-600">本次覆蓋只修正出貨銷貨內容，不會修改商城收款。</p></div>}
    <div className="mt-3 grid gap-3 sm:grid-cols-2"><OrderSnapshot title="原訂單" value={order.before} /><OrderSnapshot title="新版訂單" value={order.after} /></div>
  </details>;
}

export default function MarketplaceDraftOverwrite({ rows, settings, profileId, isCurrent, onClose, onComplete, onBusyChange }) {
  // Hold the exact source and operation boundary until this conversation ends.
  // Refreshes in the parent must not silently replace an unanswered comparison.
  const scope = useRef({ rows, settings, profileId, isCurrent, onComplete, onBusyChange });
  const mounted = useRef(false), inFlight = useRef(false), sequence = useRef(0), command = useRef(null);
  const [preview, setPreview] = useState(null), [answers, setAnswers] = useState({});
  const [notImported, setNotImported] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [unknown, setUnknown] = useState(false), [result, setResult] = useState(null);
  const current = () => mounted.current && scope.current.isCurrent();
  const sourceBody = () => ({ rows: scope.current.rows, settings: scope.current.settings, ...(scope.current.profileId ? { profileId: scope.current.profileId } : {}) });
  const markBusy = value => { setBusy(value); scope.current.onBusyChange?.(value); };

  const compare = async (notice = '') => {
    if (!current() || inFlight.current) return;
    inFlight.current = true; const request = ++sequence.current;
    markBusy(true); setError(notice); setPreview(null); setAnswers({}); setNotImported(false); setResult(null); setUnknown(false); command.current = null;
    try {
      const response = await apiClient.post(`${endpoint}/preview`, sourceBody(), { timeout: 75000 });
      if (!current() || request !== sequence.current) return;
      if (!response.data?.previewFingerprint || !Array.isArray(response.data.affectedBatches)) throw Error('比對未完成，請重新比對。');
      setPreview(response.data);
    } catch (failure) {
      if (current() && request === sequence.current) setError(failure.response?.data?.message || failure.message || '無法比對，請重試。');
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

  const batches = list(preview?.affectedBatches);
  const uploaded = batches.flatMap(batch => list(batch.uploadedOrders));
  const omitted = batches.flatMap(batch => list(batch.omittedOrders));
  const changedCount = uploaded.filter(order => order.changed).length;
  const unanswered = omitted.filter(order => !['exclude', 'keep'].includes(answers[numberOf(order)]) || answers[numberOf(order)] === 'keep' && order.canKeep === false);
  const blocked = batches.some(batch => batch.canOverwrite !== true);
  const canConfirm = !!preview && batches.length > 0 && !blocked && !unanswered.length && notImported && !busy && !unknown && !result;

  const confirm = async () => {
    if (!current() || inFlight.current || result || (!command.current && !canConfirm)) return;
    if (!command.current) command.current = {
      ...sourceBody(), confirmed: true, notImportedConfirmed: true,
      commandId: crypto.randomUUID(), previewFingerprint: preview.previewFingerprint, decisions: { ...answers },
    };
    inFlight.current = true; const request = ++sequence.current;
    markBusy(true); setError('');
    let stale = false;
    try {
      // Retrying an uncertain response reuses the exact command, including UUID.
      const response = await apiClient.post(`${endpoint}/confirm`, command.current, { timeout: 75000 });
      if (!current() || request !== sequence.current) return;
      if (response.data?.applied !== true || !Array.isArray(response.data.batches)) throw Error('尚未收到完成結果。');
      setResult(response.data); setUnknown(false);
      try { await scope.current.onComplete?.(response.data); } catch {
        if (current()) setError('修正已完成；批次清單尚未更新，可稍後重新載入。');
      }
    } catch (failure) {
      if (!current() || request !== sequence.current) return;
      const status = failure.response?.status;
      if (status === 409) {
        stale = true; command.current = null;
      } else if (status >= 400 && status < 500) {
        command.current = null; setUnknown(false);
        setError(failure.response?.data?.message || '本次尚未修正，請重新比對。');
        setPreview(null); setAnswers({}); setNotImported(false);
      } else {
        setUnknown(true);
        setError('尚未確認伺服器是否完成。請核對同一筆操作的結果，期間不要重新上傳或重複產檔。');
      }
    } finally {
      inFlight.current = false;
      if (current() && request === sequence.current) markBusy(false);
    }
    if (stale && current()) await compare('訂單或比對內容已更新，已重新比對，請重新回答並確認。');
  };

  const download = async batch => {
    if (!current() || inFlight.current || !result || batch.activeOrderCount === 0) return;
    inFlight.current = true; markBusy(true); setError('');
    try {
      if (getNativeRuntime()) await downloadNativeMarketplaceFile({ id: batch.id, kind: 'ecount' }, { isCurrent: current });
      else {
        const response = await apiClient.post(`/api/marketplace-intakes/${batch.id}/download-link`, { kind: 'ecount' }, { withCredentials: true });
        if (!current()) return;
        const anchor = document.createElement('a'); anchor.href = `${API_ORIGIN}${response.data.url}`; anchor.download = '';
        document.body.appendChild(anchor); anchor.click(); anchor.remove();
      }
    } catch (failure) {
      if (current()) setError(failure.response?.data?.message || failure.message || '下載未完成，可重試下載。');
    } finally { inFlight.current = false; if (current()) markBusy(false); }
  };

  return <section className="mt-5 space-y-4 rounded-xl border border-blue-200 bg-blue-50/40 p-4 text-slate-900 sm:p-5" aria-label="新版訂單比對助理" aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">新版訂單比對助理</h3><Button variant="secondary" disabled={busy || unknown} onClick={() => { if (current() && !inFlight.current && !unknown) onClose(); }}>{result ? '完成' : '取消'}</Button></div>
    {busy && <p role="status" className="text-sm text-slate-700">{command.current ? '正在核對並產生最新版…' : '正在比對新版與已保存的訂單…'}</p>}
    {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{error}</p>}
    {!preview && !busy && !unknown && !result && <Button variant="secondary" onClick={() => compare()}>重新比對</Button>}
    {preview && !result && <>
      <div className="rounded-lg bg-white p-4 text-sm leading-6"><p>已完成比對：{uploaded.length - changedCount} 筆相同、{changedCount} 筆內容有異動、{omitted.length} 筆未在新版檔案中。</p><p className="mt-1">請核對以下差異，再決定是否依新版修正。相同的訂單也可以重新取得銷貨檔。</p></div>
      {batches.map(batch => <div key={batch.id} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h4 className="break-words font-medium">原批次 {batch.batchNumber}</h4>
        {list(batch.blockedReasons).length > 0 && <ul role="alert" className="list-disc space-y-1 pl-5 text-sm text-amber-950">{batch.blockedReasons.map((reason, index) => <li key={index}>{typeof reason === 'string' ? reason : reason.message}</li>)}</ul>}
        {list(batch.uploadedOrders).filter(order => order.changed).map(order => <OrderComparison key={numberOf(order)} order={order} />)}
        {list(batch.omittedOrders).map(order => <div key={numberOf(order)} className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-4" aria-label={`新版未含 ${order.orderNumber}`}>
          <p className="text-sm leading-6"><strong className="break-all">{order.orderNumber}</strong> 整筆訂單未在新版中（{order.before?.quantity ?? '—'} 件・NT$ {amount(order.before?.totalMinor)}），並非只移除其中一項商品。是否依新版暫停本次出貨？</p>
          <details className="text-sm"><summary className="cursor-pointer">查看原訂單商品</summary><div className="mt-2"><OrderSnapshot title="原訂單" value={order.before} /></div></details>
          <div className="flex flex-wrap gap-2" role="group" aria-label={`${order.orderNumber} 本次處理方式`}>
            <Button variant={answers[numberOf(order)] === 'exclude' ? 'primary' : 'secondary'} aria-pressed={answers[numberOf(order)] === 'exclude'} disabled={busy || unknown || blocked} onClick={() => setAnswers(value => ({ ...value, [numberOf(order)]: 'exclude' }))}>依新版暫不出貨</Button>
            <Button variant={answers[numberOf(order)] === 'keep' ? 'primary' : 'secondary'} aria-pressed={answers[numberOf(order)] === 'keep'} disabled={busy || unknown || blocked || order.canKeep === false} onClick={() => { if (order.canKeep !== false) setAnswers(value => ({ ...value, [numberOf(order)]: 'keep' })); }}>保留原訂單</Button>
          </div>{order.canKeep === false && <p className="text-sm text-amber-950">{order.keepBlockedReason || '此筆目前不能保留在本次銷貨檔，請先核對商城訂單狀態。'}</p>}{answers[numberOf(order)] && <p className="text-sm text-slate-700">已選擇：{answers[numberOf(order)] === 'exclude' ? '本次銷貨檔不含此筆，保留原訂單紀錄。' : '本次銷貨檔保留原訂單內容。'}</p>}
        </div>)}
        {list(batch.uploadedOrders).some(order => !order.changed) && <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm">{list(batch.uploadedOrders).filter(order => !order.changed).length} 筆內容相同・查看明細</summary><div className="mt-3 space-y-3">{list(batch.uploadedOrders).filter(order => !order.changed).map(order => <OrderComparison key={numberOf(order)} order={order} />)}</div></details>}
      </div>)}
      {batches.length === 0 && <p className="text-sm text-slate-700">沒有可修正的已保存訂單，請回到轉檔畫面確認檔案及店鋪。</p>}
      {!unknown && batches.length > 0 && <div className="space-y-3 rounded-lg bg-white p-4"><p className="text-sm font-medium">{changedCount ? '是否使用新版修正這些訂單，並重新產生銷貨檔？' : '是否依本次核對結果，重新提供銷貨檔？'}</p>
        <label className="flex min-h-11 items-start gap-3 py-2 text-sm leading-6"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={notImported} disabled={busy || blocked} onChange={event => setNotImported(event.target.checked)} /><span>這批尚未匯入 ECOUNT，上一版銷貨檔停止使用</span></label>
        {unanswered.length > 0 && <p className="text-sm text-amber-950">請先回答 {unanswered.length} 筆新版未含訂單的處理方式。</p>}
        <Button disabled={!canConfirm} onClick={confirm}>確認覆蓋並產檔</Button>
      </div>}
    </>}
    {unknown && <Button disabled={busy} onClick={confirm}>核對同一筆操作結果</Button>}
    {result && <div className="space-y-3 rounded-lg bg-white p-4" role="status"><p className="font-medium text-emerald-800">最新版已準備完成，請只使用以下銷貨檔。</p><p className="text-sm text-slate-700">上一版檔案請停止使用。{result.batches.length > 1 ? '原訂單屬於不同批次，請分批下載、匯入及回匯理貨單。' : '後續請沿用原批次回匯 ECOUNT 理貨單。'}</p>
      {result.batches.map(batch => <div key={batch.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"><div className="min-w-0 text-sm"><strong className="break-all">{batch.batchNumber}</strong><p>{batch.activeOrderCount} 筆訂單・修訂 {batch.draftRevision}</p>{list(batch.excludedOrderNumbers).length > 0 && <p className="break-words text-slate-600">本次暫不出貨：{batch.excludedOrderNumbers.join('、')}</p>}</div><Button disabled={busy || batch.activeOrderCount === 0} onClick={() => download(batch)}>下載最新版銷貨檔</Button></div>)}
    </div>}
  </section>;
}
