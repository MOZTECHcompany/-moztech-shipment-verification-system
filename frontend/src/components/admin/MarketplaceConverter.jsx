import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Loader2, UploadCloud } from 'lucide-react';
import { Button, PageHeader } from '../../ui';
import apiClient from '@/api/api.js';
import { API_ORIGIN } from '../../api/origin';
import MarketplaceBatchManager from './MarketplaceBatchManager';
import { batchSessionMatches } from '../../utils/importBatches';
import { formatMinor, ECOUNT_GROUPED_MODE } from '../../utils/marketplaceIntake.mjs';
import { MARKETPLACE_ROLES, TEST_ORDER_NUMBERS } from '../../utils/unifiedMarketplace.mjs';
import { marketplaceOrderSheets, parseMarketplaceWorksheet } from '../../utils/marketplaceWorkbook.mjs';

const inputClass = 'mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 disabled:bg-slate-100';
const sectionClass = 'rounded-xl border border-slate-200 bg-white p-4 sm:p-6';
const cell = 'px-3 py-3 text-left align-top';
const paymentLabels = { paid: '已付款', pending: '待付款', refunded: '已退款', partially_refunded: '部分退款', partially_paid: '部分付款', authorized: '已授權', voided: '已作廢', expired: '已過期', unknown: '待核對' };
const fulfillmentLabels = { unfulfilled: '未出貨', fulfilled: '已出貨', partial: '部分出貨', partially_fulfilled: '部分出貨', cancelled: '已取消', unknown: '待核對' };
const statusLabel = (raw, normalized, labels) => {
  const value = String(raw || normalized || '').trim();
  return labels[value.toLowerCase()] || value || '待核對';
};
const money = value => value == null ? '未提供' : value % 100 === 0 ? (value / 100).toLocaleString('zh-TW') : formatMinor(value);
const orderMessage = (error, message) => {
  const orderNumber = String(error.response?.data?.orderNumber || '').trim();
  return orderNumber && !message.includes(orderNumber) ? `${orderNumber}：${message}` : message;
};
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const batchNumber = () => `WMS-${today().replaceAll('-', '')}-${Array.from(crypto.getRandomValues(new Uint8Array(2)), value => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
const barcodeConflictKey = conflict => conflict.fingerprint;
const initialSettings = () => ({
  salesExportMode: ECOUNT_GROUPED_MODE, store: '', customerCode: '', customerName: '', warehouseCode: '003',
  date: today(), batchSequence: '1', batchNumber: batchNumber(), projectOwner: '', salesOwner: '',
  erpStaffCode: '', erpProjectCode: '', erpResponsibilityConfirmed: false, summaryNote: '',
  currency: 'TWD', taxMode: 'erp_inclusive', taxType: '11', taxConfirmed: false,
  includeTestOrders: false, bundleZeroConfirmed: false, discountAllocationConfirmed: false,
  skuMappings: {}, shippingSku: { erpSku: '00001', name: '運費', confirmed: false, nonStock: false },
});
function Field({ label, children, ...props }) {
  return <label className="block min-w-0 text-sm font-medium text-slate-800">{label}{children || <input className={inputClass} {...props} />}</label>;
}
function Check({ children, checked, onChange }) {
  return <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6 text-slate-800"><input type="checkbox" checked={!!checked} onChange={event => onChange(event.target.checked)} className="mt-1 h-4 w-4 shrink-0" /><span>{children}</span></label>;
}
export function MarketplaceConverter({ user }) {
  if (!MARKETPLACE_ROLES.includes(user?.role)) return <Navigate to="/tasks" replace />;
  return <ConverterPage user={user} />;
}
function ConverterPage({ user }) {
  const [input, setInput] = useState(null), [settings, setSettings] = useState(initialSettings), [name, setName] = useState('');
  const [prepared, setPrepared] = useState(null), [previewDirty, setPreviewDirty] = useState(false);
  const [busy, setBusy] = useState(false), [access, setAccess] = useState('loading');
  const [message, setMessage] = useState(''), [messageKind, setMessageKind] = useState('status');
  const [records, setRecords] = useState([]), [saved, setSaved] = useState(null);
  const [profiles, setProfiles] = useState([]), [profileId, setProfileId] = useState(''), [choosingStore, setChoosingStore] = useState(false), [storeSetupOpen, setStoreSetupOpen] = useState(false);
  const [dragging, setDragging] = useState(false), [catalog, setCatalog] = useState(null);
  const [workbook, setWorkbook] = useState(null), [selectedSheet, setSelectedSheet] = useState('');
  const [barcodeChecks, setBarcodeChecks] = useState({});
  const fileRef = useRef(null), request = useRef(0), mounted = useRef(true), token = useRef(null);
  const actor = useRef({ id: user.id, role: user.role }), inFlight = useRef(false);
  const showMessage = (value, kind = 'status') => { setMessage(value); setMessageKind(kind); };
  const currentSession = () => batchSessionMatches(sessionStorage, actor.current, token.current);
  const loadRecords = async () => {
    const response = await apiClient.get('/api/marketplace-intakes');
    if (!mounted.current || !currentSession()) return false;
    setRecords(response.data.intakes || []); setAccess('ready'); return true;
  };
  useEffect(() => {
    mounted.current = true;
    try { token.current = JSON.parse(sessionStorage.getItem('wms_token')); } catch { token.current = null; }
    apiClient.get('/api/marketplace-intakes/store-profiles').then(response => {
      if (mounted.current && currentSession()) setProfiles(response.data.profiles || []);
    }).catch(() => {});
    loadRecords().catch(() => {
      if (mounted.current) { setAccess('denied'); showMessage('無法確認轉檔權限，請重新登入。', 'error'); }
    });
    const check = () => {
      if (currentSession()) return;
      request.current++;
      setInput(null); setPrepared(null); setName(''); setSaved(null); setWorkbook(null); setSelectedSheet('');
      setRecords([]); setProfiles([]); setProfileId(''); setCatalog(null); setSettings(initialSettings());
      setBarcodeChecks({});
      setAccess('denied'); showMessage('登入人員已變更，請重新登入。', 'error');
    };
    window.addEventListener('storage', check);
    return () => { mounted.current = false; request.current++; window.removeEventListener('storage', check); };
  }, []);
  const locked = busy || access !== 'ready';
  const barcodeConflicts = prepared?.barcodeConflicts || [];
  const barcodeBlocked = barcodeConflicts.length > 0;
  const products = useMemo(() => [...new Map((prepared?.parsed?.items || []).map(item => [item.sku, item])).values()], [prepared]);
  const matchingProfiles = profiles.filter(profile => profile.platform === input?.parsed.platform);
  const emptyExclusions = prepared?.parsed?.summary?.orderCount === 0 ? (prepared.choices || []).filter(choice => !choice.eligible && choice.reason) : [];
  const issueGroups = useMemo(() => {
    const groups = new Map();
    for (const issue of prepared?.output?.issues || []) {
      if (issue.severity === 'warning' || (issue.code === 'EMPTY_INTAKE' && emptyExclusions.length)) continue;
      if (issue.code === 'BARCODE_MISMATCH' && barcodeBlocked) continue;
      const key = `${issue.code}:${issue.field || ''}`;
      if (!groups.has(key)) groups.set(key, { key, items: [] });
      groups.get(key).items.push(issue);
    }
    return [...groups.values()].map(group => ({ ...group, title: group.items[0].code === 'PRODUCT_MAPPING_REQUIRED' ? `${group.items.length} 項商品需對照` : group.items[0].message }));
  }, [prepared]);
  const catalogIssues = products.flatMap(item => {
    const result = catalog?.products?.[item.sku];
    return result?.status === 'inactive' ? [`${item.sku}：ECOUNT 已中止使用。`]
      : result?.status === 'ambiguous' ? [`${item.sku}：ECOUNT 有多個對應品項。`] : [];
  });
  const catalogBlocked = catalogIssues.length > 0;
  const unresolvedProducts = products.filter(item => !settings.skuMappings?.[item.sku]?.confirmed || ['inactive', 'ambiguous'].includes(catalog?.products?.[item.sku]?.status));
  const raw = prepared?.raw || input?.parsed;
  const warnings = prepared?.output?.issues?.filter(issue => issue.severity === 'warning') || [];
  const applyPreview = data => {
    if (!data?.output || !data.parsed) throw Error('訂單核對尚未完成，請重新核對。');
    const nextSettings = { ...initialSettings(), ...(data.effectiveSettings || data.settings) };
    setPrepared(data); setSettings(nextSettings); setStoreSetupOpen(!nextSettings.store || !nextSettings.customerCode);
    setProfileId(data.profileId == null ? '' : String(data.profileId));
    if (data.profiles) setProfiles(data.profiles);
    setCatalog(data.catalog || null); setPreviewDirty(false);
    setBarcodeChecks({});
  };
  const fetchPreview = async (rows, nextSettings, nextProfile, sequence) => {
    const response = await apiClient.post('/api/marketplace-intakes/preview', { rows, settings: nextSettings, ...(nextProfile ? { profileId: nextProfile } : {}) }, { timeout: 75000 });
    if (!mounted.current || sequence !== request.current || !currentSession()) return false;
    applyPreview(response.data); return true;
  };
  const refreshPreview = async (nextSettings = settings, nextProfile = profileId) => {
    if (locked || inFlight.current || !input || !currentSession()) return;
    const sequence = ++request.current;
    setBusy(true); setPreviewDirty(true); setSaved(null); showMessage('');
    try { await fetchPreview(input.source.rows, nextSettings, nextProfile, sequence); }
    catch (error) {
      if (mounted.current && sequence === request.current && currentSession()) showMessage(orderMessage(error, error.response?.data?.message || '訂單核對失敗，請重試。'), 'error');
    } finally { if (mounted.current && sequence === request.current) setBusy(false); }
  };
  const confirmBarcode = async conflict => {
    if (locked || inFlight.current || previewDirty || !input || !profileId || conflict.canConfirm !== true || !barcodeChecks[barcodeConflictKey(conflict)] || !currentSession()) return;
    const sequence = ++request.current;
    inFlight.current = true; setBusy(true); setPreviewDirty(true); setSaved(null); showMessage('');
    try {
      const response = await apiClient.post('/api/marketplace-intakes/barcode-confirmations', {
        rows: input.source.rows, profileId, settings,
        verificationFingerprint: prepared.verification?.currentFingerprint,
        confirmation: { fingerprint: conflict.fingerprint, confirmed: true },
      }, { timeout: 75000 });
      if (!mounted.current || sequence !== request.current || !currentSession()) return;
      if (response.data?.confirmed !== true) throw Error('商品對照未保存');
      if (await fetchPreview(input.source.rows, settings, profileId, sequence)) showMessage('商品對照已保存');
    } catch (error) {
      if (mounted.current && sequence === request.current && currentSession()) showMessage(error.response?.data?.message || '商品對照未保存，請重新核對。', 'error');
    } finally {
      inFlight.current = false;
      if (mounted.current && sequence === request.current) setBusy(false);
    }
  };
  const update = (key, value) => {
    request.current++; setSaved(null); setPreviewDirty(true);
    setSettings(current => ({ ...current, [key]: value, ...(['erpStaffCode', 'erpProjectCode'].includes(key) ? { erpResponsibilityConfirmed: false } : {}) }));
  };
  const mapping = (sku, key, value) => {
    request.current++; setSaved(null); setPreviewDirty(true);
    setSettings(current => ({ ...current, skuMappings: { ...current.skuMappings, [sku]: {
      ...current.skuMappings[sku], [key]: value,
      ...(['erpSku', 'erpName'].includes(key) ? { confirmed: false } : {}),
      ...(key === 'barcode' ? { barcodeConfirmed: false } : {}),
    } } }));
  };
  const useProfile = async id => {
    if (locked || !currentSession()) return;
    const profile = matchingProfiles.find(value => String(value.id) === id);
    if (!profile) return;
    const next = { ...settings, ...profile.settings, skuMappings: settings.skuMappings };
    setChoosingStore(false); await refreshPreview(next, String(profile.id));
  };
  const resetSource = () => {
    showMessage(''); setInput(null); setPrepared(null); setPreviewDirty(false); setSaved(null); setName('');
    setProfileId(''); setChoosingStore(false); setStoreSetupOpen(false); setCatalog(null); setSettings(initialSettings());
    setBarcodeChecks({});
  };
  const loadWorksheet = async (XLSX, book, sheetName, fileName, sequence) => {
    const result = parseMarketplaceWorksheet(XLSX, book, sheetName);
    if (!mounted.current || sequence !== request.current || !currentSession()) return;
    setInput(result); setName(fileName); setSelectedSheet(sheetName); setPreviewDirty(true);
    await fetchPreview(result.source.rows, initialSettings(), '', sequence);
  };
  const selectFiles = async files => {
    if (locked || !files?.length) return;
    resetSource(); setWorkbook(null); setSelectedSheet('');
    if (!currentSession()) { setAccess('denied'); return; }
    const file = files[0];
    if (files.length !== 1 || !/\.(xlsx|xls|csv)$/i.test(file.name) || !file.size || file.size > 10 * 1024 * 1024) {
      showMessage('請選擇一個非空白的 Excel 或 CSV，檔案上限 10 MiB。', 'error'); return;
    }
    const sequence = ++request.current; setBusy(true);
    try {
      const XLSX = await import('xlsx'), buffer = await file.arrayBuffer(); let source = buffer;
      if (/\.csv$/i.test(file.name)) {
        try { source = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
        catch { throw Error('CSV 請使用 UTF-8 編碼重新匯出，或改選 Excel 原始檔。'); }
      }
      const book = XLSX.read(source, { type: typeof source === 'string' ? 'string' : 'array', raw: true, cellFormula: false, cellHTML: false, sheetRows: 5001 });
      if (!mounted.current || sequence !== request.current || !currentSession()) return;
      const sheets = marketplaceOrderSheets(XLSX, book);
      if (sheets.length > 1) { setWorkbook({ book, fileName: file.name, sheets }); return; }
      if (!sheets.length && book.SheetNames.length !== 1) throw Error('找不到商城訂單工作表，請選擇平台原始訂單檔。');
      await loadWorksheet(XLSX, book, sheets[0] || book.SheetNames[0], file.name, sequence);
    } catch (error) {
      if (mounted.current && sequence === request.current && currentSession()) showMessage(orderMessage(error, error.response?.data?.message || error.message || '無法讀取來源檔。'), 'error');
    } finally { if (mounted.current && sequence === request.current) setBusy(false); }
  };
  const chooseSheet = async sheetName => {
    if (locked || !workbook || !currentSession()) return;
    resetSource(); setSelectedSheet(sheetName);
    const sequence = ++request.current;
    if (!sheetName) return;
    setBusy(true);
    try { await loadWorksheet(await import('xlsx'), workbook.book, sheetName, workbook.fileName, sequence); }
    catch (error) {
      if (mounted.current && sequence === request.current && currentSession()) showMessage(orderMessage(error, error.response?.data?.message || error.message || '無法讀取訂單工作表。'), 'error');
    } finally { if (mounted.current && sequence === request.current) setBusy(false); }
  };
  const writeAudit = async () => {
    const XLSX = await import('xlsx');
    if (!mounted.current || !currentSession()) throw Error('登入已變更，未下載資料。');
    const book = XLSX.utils.book_new();
    const add = (title, rows) => {
      const sheet = XLSX.utils.aoa_to_sheet(rows); sheet['!cols'] = (rows[0] || []).map(() => ({ wch: 24 }));
      XLSX.utils.book_append_sheet(book, sheet, title);
    };
    add('承辦人', [['狀態', '未保存核對草稿'], ['承辦人', user.name || user.username || ''], ['承辦人帳號', user.username || '']]);
    add('預揀總表', [prepared.prepick.headers, ...prepared.prepick.rows]);
    add('訂單金額核對', [prepared.audit.headers, ...prepared.audit.rows]);
    add('來源商品對照', [['平台', '商城訂單', '來源明細號', '來源SKU', '商品名稱', '原始數量', '原始單價', '原始商品小計', '來源組合名稱'], ...raw.items.map(item => [raw.platform, item.sourceOrderNumber, item.sourceLineId, item.sku, item.productName, item.quantity, item.unitPriceMinor == null ? '原檔未分價' : item.unitPriceMinor / 100, (item.sourceLineSubtotalMinor ?? item.lineSubtotalMinor) == null ? '原檔未分價' : (item.sourceLineSubtotalMinor ?? item.lineSubtotalMinor) / 100, item.groupName])]);
    add('本批納入與排除', [['商城訂單', '納入本批', '原因'], ...prepared.choices.map(choice => [choice.number, choice.eligible ? '是' : '否', choice.reason])]);
    add('ECOUNT成交核對', [['商城訂單', '來源明細號', 'SKU', '數量', '商品淨額', '另分攤訂單折扣'], ...prepared.parsed.items.map(item => [item.sourceOrderNumber, item.sourceLineId, item.sku, item.quantity, item.lineSubtotalMinor == null ? '待確認' : item.lineSubtotalMinor / 100, (item.allocatedDiscountMinor || 0) / 100])]);
    XLSX.writeFile(book, `預揀與金額核對_${settings.batchNumber}.xlsx`);
  };
  const download = async kind => {
    if (locked || inFlight.current || !input || !prepared || previewDirty || !currentSession()) return;
    if (kind === 'ecount' && (!prepared.output.ok || catalogBlocked || barcodeBlocked)) return;
    if (kind === 'audit' && (!prepared.audit.ok || !prepared.prepick.ok)) return;
    inFlight.current = true; setBusy(true); showMessage('');
    try {
      if (kind === 'ecount') {
        const response = await apiClient.post('/api/marketplace-intakes', {
          rows: input.source.rows, settings, ...(profileId ? { profileId } : {}),
          ...(prepared.verification?.currentFingerprint ? { previewFingerprint: prepared.verification.currentFingerprint } : {}),
        }, { timeout: 75000 });
        if (!mounted.current || !currentSession()) return;
        setSaved(response.data);
        const link = await apiClient.post(`/api/marketplace-intakes/${response.data.id}/download-link`, { kind: 'ecount' }, { withCredentials: true });
        if (!mounted.current || !currentSession()) return;
        const anchor = document.createElement('a'); anchor.href = `${API_ORIGIN}${link.data.url}`; anchor.download = '';
        document.body.appendChild(anchor); anchor.click(); anchor.remove();
        if (!await loadRecords()) return;
        showMessage('已保存・待 ECOUNT 匯入');
        // Reuse validated customer/warehouse settings on the next file. Profile
        // persistence is secondary to the already-saved immutable sales batch.
        try {
          const stored = await apiClient.post('/api/marketplace-intakes/store-profiles', { platform: prepared.parsed.platform, settings });
          if (mounted.current && currentSession()) {
            setProfiles(current => [...current.filter(value => value.id !== stored.data.id), stored.data]); setProfileId(String(stored.data.id));
          }
        } catch {
          if (mounted.current && currentSession()) showMessage('已保存・待 ECOUNT 匯入；店鋪設定未保存，下次請重新選擇。');
        }
      } else { await writeAudit(); if (mounted.current && currentSession()) showMessage('核對表已下載'); }
    } catch (error) {
      if (mounted.current && currentSession()) {
        if (error.response?.data?.code === 'SHOPIFY_PREVIEW_CHANGED') {
          const sequence = ++request.current;
          setPreviewDirty(true); setSaved(null);
          try {
            if (await fetchPreview(input.source.rows, settings, profileId, sequence)) showMessage(orderMessage(error, '訂單已變更，已更新核對結果，請確認後重新下載。'), 'error');
          } catch (refreshError) {
            if (mounted.current && sequence === request.current && currentSession()) showMessage(orderMessage(refreshError, refreshError.response?.data?.message || '訂單已變更，重新核對未完成。'), 'error');
          }
          return;
        }
        showMessage(orderMessage(error, error.response?.data?.message || '保存或下載未完成，請查看已保存批次後重試。'), 'error');
      }
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const settingsField = (label, key, extra = {}) => <Field label={label} value={settings[key] || ''} onChange={event => update(key, event.target.value)} onBlur={() => { if (previewDirty) return refreshPreview(); }} {...extra} />;
  const needsStore = !settings.store || !settings.customerCode;
  return <main className="mx-auto max-w-7xl space-y-5 pb-8 text-slate-900" data-testid="marketplace-converter">
    <Link to="/admin" className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-blue-700"><ArrowLeft size={16} />返回出貨管理</Link>
    <div className="flex flex-wrap items-center justify-between gap-3"><PageHeader title="商城訂單轉檔" /><a href="#saved-batches" className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700">已保存批次</a></div>
    {message && <p role={messageKind === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${messageKind === 'error' ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-slate-200 bg-white text-slate-800'}`}>{message}</p>}
    <section className={`${sectionClass} border-2 border-dashed transition-colors ${dragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300'}`} onDragOver={event => { event.preventDefault(); if (!locked) setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); selectFiles(Array.from(event.dataTransfer.files || [])); }} aria-label="商城訂單檔案區">
      <div className="flex flex-col items-center py-3 text-center"><UploadCloud size={32} className="mb-3 text-blue-600" /><h2 className="text-lg font-semibold">{dragging ? '放開檔案，開始核對' : '拖曳商城訂單到這裡'}</h2><p className="mt-2 text-sm text-slate-600">Shopify、1Shop、SHOPLINE · Excel／CSV</p>
        <Button type="button" variant="secondary" className="mt-4" disabled={locked} onClick={() => fileRef.current?.click()}>{busy ? <Loader2 className="mr-2 animate-spin" size={18} /> : <FileSpreadsheet className="mr-2" size={18} />}{busy ? '核對中…' : name ? '更換訂單檔' : '選擇訂單檔'}</Button>
      </div>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={locked} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; return selectFiles(files); }} aria-label="商城原始訂單檔" />
      {workbook && <div className="mt-3 max-w-xl"><p className="mb-2 text-sm text-slate-600">{workbook.fileName}</p><Field label="訂單工作表"><select className={inputClass} disabled={locked} value={selectedSheet} onChange={event => chooseSheet(event.target.value)}><option value="">請選擇工作表</option>{workbook.sheets.map(sheet => <option key={sheet} value={sheet}>{sheet}</option>)}</select></Field></div>}
      {name && <p className="mt-3 break-words text-sm text-slate-600"><strong className="text-slate-900">{input?.parsed.platform}</strong> · {name} · {selectedSheet}</p>}
      {!name && <details className="mt-3 text-sm text-slate-600"><summary className="cursor-pointer">匯出格式</summary><ul className="mt-2 list-disc space-y-1 pl-5"><li>Shopify：訂單 CSV</li><li>1Shop：訂單 Excel</li><li>SHOPLINE：包含貨號、商品明細與金額的訂單報表</li></ul></details>}
    </section>
    {input && !prepared && !busy && <div className={sectionClass}><Button variant="secondary" disabled={locked} onClick={() => refreshPreview()}>重新核對訂單</Button></div>}
    {input && prepared && <>
      <section className={`${sectionClass} border-blue-200`} aria-label="轉檔與下載">
        {(choosingStore || !profileId && matchingProfiles.length > 1) ? <div className="mb-5 max-w-xl"><Field label="店鋪"><select className={inputClass} disabled={locked} value={profileId} onChange={event => useProfile(event.target.value)}><option value="">選擇店鋪</option>{matchingProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.store} · {profile.settings.customerCode}</option>)}</select></Field></div>
          : settings.store && <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"><strong>{settings.store}</strong><span className="text-slate-600">{settings.customerCode} {settings.customerName}</span>{matchingProfiles.length > 1 && <button type="button" className="min-h-10 font-medium text-blue-700" disabled={locked} onClick={() => setChoosingStore(true)}>更換店鋪</button>}</div>}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="text-lg font-semibold">{emptyExclusions.length ? `已讀取 ${raw.orders.length} 筆・可銷貨 0 筆` : `${prepared.parsed.summary.orderCount} 筆訂單 · ${prepared.parsed.summary.totalQuantity} 件商品`}</h2><p className="mt-2 text-sm text-slate-700">含稅 {settings.currency} {money(prepared.parsed.summary.totalMinor)}</p>
            {prepared.output.ok && <p className="mt-1 text-sm text-slate-600">稅前 {money(prepared.output.summary.ecountNetMinor)} · 營業稅 {money(prepared.output.summary.ecountTaxMinor)} · 銷貨 {prepared.output.summary.ecountRowCount} 列</p>}
          </div>
          <Button disabled={locked || previewDirty || !prepared.output.ok || catalogBlocked || barcodeBlocked} onClick={() => download('ecount')}><Download size={16} className="mr-2" />下載銷貨檔</Button>
        </div>
        {busy ? <p role="status" className="mt-4 flex items-center gap-2 text-sm text-slate-600"><Loader2 size={16} className="animate-spin" />核對中…</p>
          : previewDirty ? <div className="mt-4"><Button variant="secondary" disabled={locked} onClick={() => refreshPreview()}>重新核對</Button></div>
          : prepared.output.ok && !catalogBlocked && !barcodeBlocked && <p className="mt-4 flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 size={16} />{prepared.verification?.mode === 'api' ? `${prepared.verification.platform || 'Shopify'} API 已核對` : '檔案核對通過'}・下載後上傳 ECOUNT</p>}
        {!previewDirty && (issueGroups.length > 0 || catalogBlocked || emptyExclusions.length > 0) && <div className="mt-4 rounded-lg bg-amber-50 p-4" role="region" aria-label="待處理問題"><p className="text-sm font-semibold text-amber-950">{issueGroups.length || catalogBlocked ? '待處理' : '本批無可銷貨訂單'}</p><ul className="mt-2 space-y-2 text-sm text-amber-950" aria-label="轉檔檢查結果">
          {emptyExclusions.map(choice => <li key={choice.number}>{choice.number}：{choice.reason}</li>)}
          {catalogIssues.map(value => <li key={value}>{value}</li>)}
          {issueGroups.map(group => <li key={group.key}>{group.items.length > 1 ? <details><summary className="cursor-pointer">{group.title}{group.items[0].code !== 'PRODUCT_MAPPING_REQUIRED' ? `（${group.items.length} 筆）` : ''}</summary><ul className="mt-2 space-y-1 pl-4">{group.items.map((issue, index) => <li key={index}>{issue.orderNumber ? `${issue.orderNumber}：` : ''}{issue.sourceRow ? `第 ${issue.sourceRow} 列：` : ''}{issue.message}</li>)}</ul></details> : <>{group.items[0].orderNumber ? `${group.items[0].orderNumber}：` : ''}{group.items[0].sourceRow ? `第 ${group.items[0].sourceRow} 列：` : ''}{group.title}</>}</li>)}
        </ul></div>}
        {saved && <Link className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-blue-700 underline" to={`?batch=${saved.id}&view=return#batch-detail`}>匯回 ECOUNT 理貨單</Link>}
      </section>
      {barcodeBlocked && <section className={`${sectionClass} border-amber-200`} aria-label="商品條碼核對"><h2 className="font-semibold">商品條碼待核對（{barcodeConflicts.length} 項）</h2><div className="mt-4 space-y-4">{barcodeConflicts.map(conflict => {
        const key = barcodeConflictKey(conflict);
        const canConfirm = conflict.canConfirm === true;
        return <div key={key} className="rounded-lg border border-slate-200 p-4">
          <p className="font-medium">{conflict.sourceName || products.find(item => item.sku === conflict.sourceSku)?.productName || conflict.erpName}</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div><h3 className="text-sm font-medium">{conflict.platform} 商品</h3><dl className="mt-2 space-y-1 text-sm">
              <div><dt className="inline text-slate-600">品號：</dt><dd className="inline break-all font-medium">{conflict.sourceSku}</dd></div>
              <div><dt className="inline text-slate-600">條碼：</dt><dd className="inline break-all font-medium">{conflict.sourceBarcode}</dd></div>
            </dl></div>
            <div><h3 className="text-sm font-medium">ECOUNT 商品</h3><dl className="mt-2 space-y-1 text-sm">
              <div><dt className="inline text-slate-600">品號：</dt><dd className="inline break-all font-medium">{conflict.erpSku}</dd></div>
              <div><dt className="inline text-slate-600">條碼：</dt><dd className="inline break-all font-medium">{conflict.erpBarcode}</dd></div>
              <div><dt className="inline text-slate-600">品名：</dt><dd className="inline">{conflict.erpName}</dd></div>
              {conflict.spec && <div><dt className="inline text-slate-600">規格：</dt><dd className="inline">{conflict.spec}</dd></div>}
            </dl></div>
          </div>
          <fieldset disabled={locked || previewDirty || !profileId || !canConfirm}>
            <Check checked={barcodeChecks[key]} onChange={value => setBarcodeChecks(current => ({ ...current, [key]: value }))}>已核對實物與 ERP，此商城商品對應此 ECOUNT 品項</Check>
            <Button variant="secondary" disabled={!barcodeChecks[key] || !conflict.fingerprint || locked || previewDirty || !profileId || !canConfirm} onClick={() => confirmBarcode(conflict)}>保存商品對照</Button>
          </fieldset>
          {!canConfirm && profileId && <p className="mt-2 text-sm text-amber-950">{conflict.variantIds?.length > 1 ? '同貨號有多個版本，請核對商城商品設定' : '商品版本或條碼資料不完整，請核對商城商品設定'}</p>}
          {!profileId && <p className="mt-2 text-sm text-amber-950">請先選擇店鋪</p>}
        </div>;
      })}</div></section>}
      {(needsStore || storeSetupOpen || choosingStore) && <section className={sectionClass} aria-label="店鋪設定"><h2 className="font-semibold">{matchingProfiles.length ? '確認銷貨店鋪' : '首次店鋪設定'}</h2><fieldset disabled={locked}><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{settingsField('商城店鋪', 'store')}{settingsField('ECOUNT 銷貨客戶編碼', 'customerCode')}{settingsField('ECOUNT 客戶名稱', 'customerName')}</div></fieldset></section>}
      {unresolvedProducts.length > 0 && <details className={sectionClass} open><summary className="cursor-pointer font-semibold">待對照商品（{unresolvedProducts.length} 項）</summary><fieldset disabled={locked}><div className="mt-4 space-y-3">{unresolvedProducts.map(item => {
        const mapped = settings.skuMappings?.[item.sku] || {};
        const masterMatched = catalog?.products?.[item.sku]?.status === 'matched';
        return <div key={item.sku} className="rounded-lg border border-slate-200 p-4"><p className="font-medium">{item.productName} <span className="text-sm text-slate-500">{item.sku}</span></p><div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="ECOUNT 品項編碼" readOnly={masterMatched} value={mapped.erpSku || item.sku} onChange={event => mapping(item.sku, 'erpSku', event.target.value)} /><Field label="ECOUNT 品項名稱" readOnly={masterMatched} value={mapped.erpName || item.productName} onChange={event => mapping(item.sku, 'erpName', event.target.value)} /></div>{!masterMatched && <Check checked={mapped.confirmed} onChange={value => mapping(item.sku, 'confirmed', value)}>確認 ECOUNT 品項</Check>}</div>;
      })}</div></fieldset>{previewDirty && <Button className="mt-3" variant="secondary" disabled={locked} onClick={() => refreshPreview()}>核對商品</Button>}</details>}
      <details className={sectionClass}><summary className="cursor-pointer font-semibold">訂單明細{raw.orders.length > prepared.parsed.summary.orderCount ? `・排除 ${raw.orders.length - prepared.parsed.summary.orderCount} 筆` : ''}</summary>
        <div className="mt-4 overflow-x-auto"><table className="min-w-[880px] w-full text-sm" aria-label="來源訂單與金額"><thead className="bg-slate-50"><tr>{['商城訂單', '付款／出貨狀態', '商品金額', '運費', '訂單總額', '本批處理'].map(value => <th key={value} className={`${cell} whitespace-nowrap`}>{value}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{raw.orders.map(order => {
          const choice = prepared.choices.find(value => value.number === order.sourceOrderNumber);
          return <tr key={order.sourceOrderNumber}><td className={`${cell} font-medium`}>{order.sourceOrderNumber}</td><td className={`${cell} whitespace-nowrap`}>{statusLabel(order.rawPaymentStatus, order.paymentStatus, paymentLabels)}／{order.cancelled ? '已取消' : statusLabel(order.rawFulfillmentStatus, order.fulfillmentStatus, fulfillmentLabels)}</td><td className={cell}>{money(order.financial.subtotalMinor)}</td><td className={cell}>{money(order.financial.shippingMinor)}</td><td className={cell}>{money(order.financial.totalMinor)}</td><td className={cell}>{choice?.eligible ? '納入' : '排除'} · {choice?.reason}</td></tr>;
        })}</tbody></table></div>
      </details>
      <details className={sectionClass}><summary className="cursor-pointer font-semibold">進階設定與核對表</summary><fieldset disabled={locked}>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{!needsStore && !storeSetupOpen && !choosingStore && <>{settingsField('商城店鋪', 'store')}{settingsField('ECOUNT 銷貨客戶編碼', 'customerCode')}{settingsField('ECOUNT 客戶名稱', 'customerName')}</>}{settingsField('發貨倉庫編碼', 'warehouseCode')}{settingsField('銷貨日期', 'date', { type: 'date' })}{settingsField('批次追蹤號', 'batchNumber', { maxLength: 20 })}{settingsField('專案負責人', 'projectOwner')}{settingsField('業務負責人', 'salesOwner')}{settingsField('ECOUNT 承辦人編碼', 'erpStaffCode')}{settingsField('ECOUNT 專案編碼', 'erpProjectCode')}{settingsField('本批摘要', 'summaryNote', { maxLength: 255 })}</div>
        {(settings.erpStaffCode || settings.erpProjectCode) && <Check checked={settings.erpResponsibilityConfirmed} onChange={value => update('erpResponsibilityConfirmed', value)}>確認承辦人及專案編碼</Check>}
        {prepared.parsed.summary.bundleComponentCount > 0 && <Check checked={settings.bundleZeroConfirmed} onChange={value => update('bundleZeroConfirmed', value)}>確認組合元件無分價，以 0 元銷貨</Check>}
        {input.parsed.platform === '1Shop' && input.parsed.orders.some(order => TEST_ORDER_NUMBERS.includes(order.sourceOrderNumber)) && <Check checked={settings.includeTestOrders} onChange={value => update('includeTestOrders', value)}>納入指定 TEST 未付款訂單</Check>}
        {prepared.parsed.summary.shippingMinor > 0 && !(settings.shippingSku?.confirmed && settings.shippingSku?.nonStock) && <div className="mt-4 rounded-lg bg-slate-50 p-4"><div className="grid gap-3 sm:grid-cols-2"><Field label="ECOUNT 運費品項編碼" value={settings.shippingSku?.erpSku || ''} onChange={event => update('shippingSku', { ...settings.shippingSku, erpSku: event.target.value, confirmed: false, nonStock: false })} /><Field label="運費品項名稱" value={settings.shippingSku?.name || ''} onChange={event => update('shippingSku', { ...settings.shippingSku, name: event.target.value, confirmed: false, nonStock: false })} /></div><Check checked={settings.shippingSku?.confirmed && settings.shippingSku?.nonStock} onChange={value => update('shippingSku', { ...settings.shippingSku, confirmed: value, nonStock: value })}>運費品項為無形商品／數量管理除外</Check></div>}
        <details className="mt-4"><summary className="min-h-11 cursor-pointer text-sm font-medium">商品條碼與分類（{products.length} 項）</summary><div className="space-y-3">{products.map(item => {
          const mapped = settings.skuMappings?.[item.sku] || {};
          const catalogProduct = catalog?.products?.[item.sku];
          const masterBarcode = catalogProduct?.status === 'matched' ? catalogProduct.matches?.[0]?.barcode : '';
          const apiBarcodeVerified = prepared.verification?.orders?.some(order => order.items?.some(product => product.sku === item.sku && product.barcode === mapped.barcode));
          const barcodeTrusted = !!mapped.barcode && (masterBarcode === mapped.barcode || apiBarcodeVerified);
          return <div key={item.sku} className="rounded-lg border border-slate-200 p-4"><p className="font-medium">{item.productName}</p><p className="mt-1 text-sm text-slate-600">ECOUNT {mapped.erpSku || item.sku}</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="商品掃描條碼">{barcodeTrusted ? <span className="mt-1 flex min-h-11 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-950">{mapped.barcode}</span> : <input className={inputClass} value={mapped.barcode || ''} placeholder="待核對" onChange={event => mapping(item.sku, 'barcode', event.target.value)} />}</Field><Field label="商品分類" value={mapped.category || ''} onChange={event => mapping(item.sku, 'category', event.target.value)} /></div>{mapped.barcode && !barcodeTrusted && <Check checked={mapped.barcodeConfirmed} onChange={value => mapping(item.sku, 'barcodeConfirmed', value)}>確認實物條碼</Check>}</div>;
        })}</div></details>
      </fieldset><div className="mt-4 flex flex-wrap gap-3">{previewDirty && <Button variant="secondary" disabled={locked} onClick={() => refreshPreview()}>套用設定</Button>}<Button variant="secondary" disabled={locked || previewDirty || !prepared.audit.ok || !prepared.prepick.ok} onClick={() => download('audit')}>下載金額核對表</Button></div>
        {warnings.length > 0 && <details className="mt-4 text-sm text-slate-600"><summary className="cursor-pointer">提醒（{warnings.length}）</summary><ul className="mt-2 space-y-1">{warnings.map((issue, index) => <li key={index}>{issue.orderNumber ? `${issue.orderNumber}：` : ''}{issue.message}</li>)}</ul></details>}
        {catalog?.sync && <p className="mt-4 text-xs text-slate-500">商品對照更新：{new Date(catalog.sync.created_at).toLocaleString('zh-TW')}</p>}
      </details>
    </>}
    <MarketplaceBatchManager user={user} enabled={access === 'ready'} currentSession={currentSession} refreshKey={records} />
  </main>;
}
