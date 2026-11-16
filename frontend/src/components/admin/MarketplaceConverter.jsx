import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Loader2, UploadCloud } from 'lucide-react';
import { Button } from '../../ui';
import apiClient from '@/api/api.js';
import { API_ORIGIN } from '../../api/origin';
import { getNativeRuntime, handleWorkspaceAnchor } from '../../workspace/nativeRuntime.js';
import { downloadNativeMarketplaceFile } from '../../workspace/downloads.js';
import MarketplaceBatchManager from './MarketplaceBatchManager';
import MarketplaceDraftOverwrite, { MarketplaceFulfilledExclusions } from './MarketplaceDraftOverwrite';
import { batchSessionMatches } from '../../utils/importBatches';
import { marketplacePreviewError } from '../../utils/marketplacePreviewError.mjs';
import { readFulfilledExclusions } from '../../utils/marketplaceDraftDiff.mjs';
import { formatMinor, ECOUNT_GROUPED_MODE } from '../../utils/marketplaceIntake.mjs';
import { MARKETPLACE_ROLES, TEST_ORDER_NUMBERS, parseUnifiedMarketplace } from '../../utils/unifiedMarketplace.mjs';
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
const storeSelectionFrom = error => {
  const data = error.response?.data, selection = data?.storeSelection;
  if (error.response?.status !== 409 || data?.code !== 'MARKETPLACE_STORE_SELECTION_REQUIRED' || selection?.platform !== 'Shopify' ||
    !['ambiguous', 'not_found', 'connection_unavailable', 'mixed_stores', 'not_configured'].includes(selection.reason) ||
    !Array.isArray(selection.choices) || selection.choices.length > 100) return null;
  const seen = new Set(), choices = [];
  for (const choice of selection.choices) {
    if (choice?.platform !== 'Shopify' || typeof choice.id !== 'string' || !choice.id.trim() || choice.id.length > 128 ||
      typeof choice.store !== 'string' || !choice.store.trim() || choice.store.length > 200 ||
      /[\u0000-\u001f\u007f]/.test(choice.id + choice.store) || typeof choice.connectionReady !== 'boolean' || seen.has(choice.id)) return null;
    seen.add(choice.id); choices.push({ id: choice.id, store: choice.store, connectionReady: choice.connectionReady });
  }
  return { reason: selection.reason, choices, selectedId: '' };
};
const originalOrderLink = data => {
  if (data?.code !== 'MARKETPLACE_SOURCE_EXISTS' || typeof data.orderNumber !== 'string') return null;
  const number = data.orderNumber.trim();
  if (!number || number.length > 100 || /[\u0000-\u001f\u007f]/.test(number)) return null;
  const validId = value => /^[1-9]\d{0,9}$/.test(String(value)) && Number(value) <= 2147483647;
  if (validId(data.intakeId)) return `?batch=${data.intakeId}&order=${encodeURIComponent(number)}#batch-detail`;
  return validId(data.workOrderId) ? `/order/${data.workOrderId}` : null;
};
const reimportLink = order => {
  const link = originalOrderLink({ ...order, code: 'MARKETPLACE_SOURCE_EXISTS' });
  const resume = link?.startsWith('?batch=') && order.state === 'pending';
  return { link: resume ? link.replace('#batch-detail', '&view=resume#batch-detail') : link, resume };
};
const reimportStates = { pending: '待出貨', completed: '已出貨', warehouse_completed: '裝箱完成', partial: '部分出貨', cancelled: '已取消', voided: '已作廢', in_progress: '作業中', needs_review: '待核對', excluded: '本次不出貨' };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const batchNumber = () => `WMS-${today().replaceAll('-', '')}-${Array.from(crypto.getRandomValues(new Uint8Array(2)), value => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
const barcodeConflictKey = conflict => conflict.fingerprint;
const needsHistoricalAttestation = conflict => conflict.requiresHistoricalLineAttestation === true;
const changedScopeMessage = '可轉檔的訂單核對結果已變更，請重新核對原檔。';
const readyOrderScope = value => Array.isArray(value?.candidateNumbers) && value.candidateNumbers.length > 0 &&
  Array.isArray(value.heldOrders) && value.heldOrders.length > 0 && /^[a-f0-9]{64}$/.test(value.fingerprint) ? value : null;
const matchesReadyOrders = (orders, numbers) => {
  if (!Array.isArray(orders) || orders.length !== numbers.length) return false;
  const expected = new Set(numbers);
  return expected.size === numbers.length && orders.every(order => expected.delete(order.sourceOrderNumber));
};
const preparedReadyScopeMatches = (preview, plan, profileId) => {
  if (!matchesReadyOrders(preview?.raw?.orders, plan.candidateNumbers) || String(preview.profileId) !== profileId ||
      !preview.verification?.currentFingerprint || preview.barcodeConflicts?.length || readyOrderScope(preview.readyScope) ||
      (Array.isArray(preview.excludedFulfilled) && preview.excludedFulfilled.length)) return false;
  const newOrders = preview.parsed?.orders || [];
  const savedOrders = (preview.reimports || []).filter(order => ['pending', 'excluded'].includes(order.state))
    .map(order => ({ sourceOrderNumber: order.orderNumber }));
  return matchesReadyOrders([...newOrders, ...savedOrders], plan.candidateNumbers) &&
    (preview.output?.ok || (!newOrders.length && savedOrders.length > 0));
};
const shopifyOrderUrl = (conflict, order) => {
  if (conflict.platform !== 'Shopify') return null;
  const shop = String(conflict.shop || '').trim().toLowerCase();
  const id = String(order.orderId || '').match(/^(?:gid:\/\/shopify\/Order\/)?([0-9]{1,30})$/)?.[1];
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(shop) && id ? `https://${shop}/admin/orders/${id}` : null;
};
const initialSettings = () => ({
  salesExportMode: ECOUNT_GROUPED_MODE, store: '', customerCode: '', customerName: '', warehouseCode: '003',
  date: today(), batchSequence: '1', batchNumber: batchNumber(), projectOwner: '', salesOwner: '',
  erpStaffCode: '', erpProjectCode: '', erpResponsibilityConfirmed: false, summaryNote: '',
  currency: 'TWD', taxMode: 'erp_inclusive', taxType: '11', taxConfirmed: false,
  includeTestOrders: false, bundleZeroConfirmed: false, discountAllocationConfirmed: false,
  skuMappings: {}, shippingSku: { erpSku: '00001', name: '運費', confirmed: false, nonStock: false },
});
const storeProfileFields = ['apiConnectionId', 'shopifyShop', 'projectOwner', 'salesOwner', 'erpStaffCode', 'erpProjectCode', 'erpResponsibilityConfirmed', 'store', 'customerCode', 'customerName', 'warehouseCode', 'currency', 'taxMode', 'taxType', 'taxConfirmed', 'erpCurrencyCode', 'erpCurrencyConfirmed', 'shippingSku'];
const persistentStoreSettings = settings => Object.fromEntries(storeProfileFields.filter(key => settings?.[key] !== undefined).map(key => [key, settings[key]]));
const blankStoreDraft = () => ({ profileId: '', expectedUpdatedAt: '', originalSettings: {}, store: '', connectionId: '', customerCode: '', customerName: '', warehouseCode: '', currency: '', tax: '', confirmed: false });
const stableValue = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
function Field({ label, children, ...props }) {
  return <label className="block min-w-0 text-sm font-medium text-slate-800">{label}{children || <input className={inputClass} {...props} />}</label>;
}
function Check({ children, checked, onChange, disabled = false }) {
  return <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6 text-slate-800"><input type="checkbox" checked={!!checked} disabled={disabled} onChange={event => { if (!disabled) onChange(event.target.checked); }} className="mt-1 h-4 w-4 shrink-0" /><span>{children}</span></label>;
}
function ReadyOrderReview({ plan, scoped, scopeChanged, disabled, onPreview, onReturn }) {
  const fulfilledCount = plan.excludedFulfilled?.length || 0;
  const scopedSummary = `另有 ${plan.heldOrders.length} 筆待核對${fulfilledCount ? `、${fulfilledCount} 筆已出貨` : ''}。原檔已保留。`;
  return <section className={`${sectionClass} border-blue-200`} aria-label="本次轉檔範圍">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">{scopeChanged ? '轉檔範圍已變更' : scoped ? `本次只轉檔 ${plan.candidateNumbers.length} 筆` : `${plan.heldOrders.length} 筆待核對`}</h2>
        <p className="mt-1 text-sm text-slate-600">{scopeChanged ? '請返回原檔重新核對可轉檔的訂單。' : scoped ? scopedSummary : `可先預覽其餘 ${plan.candidateNumbers.length} 筆，待核對的訂單整筆保留在原檔。`}</p>
      </div>
      {scoped ? <Button variant="secondary" disabled={disabled} onClick={onReturn}>返回原檔核對</Button>
        : <Button disabled={disabled} onClick={onPreview}>只預覽可轉檔的 {plan.candidateNumbers.length} 筆</Button>}
    </div>
    <details className="mt-3" open={!scoped}>
      <summary className="cursor-pointer py-2 text-sm font-medium text-slate-700">待核對訂單</summary>
      <ul className="divide-y divide-slate-100 text-sm" aria-label="待核對訂單及原因">
        {plan.heldOrders.map(order => <li key={order.orderNumber} className="grid gap-1 py-2 sm:grid-cols-[minmax(5rem,8rem)_1fr] sm:gap-3">
          <strong className="break-all">{order.orderNumber}</strong><span className="break-words text-slate-700">{order.reasons.join('；')}</span>
        </li>)}
      </ul>
    </details>
  </section>;
}
export function MarketplaceConverter({ user }) {
  if (!MARKETPLACE_ROLES.includes(user?.role)) return <Navigate to="/tasks" replace />;
  return <ConverterPage user={user} />;
}
function ConverterPage({ user }) {
  const [params, setParams] = useSearchParams();
  const originalOrderFlow = !!params.get('batch') && !!params.get('order') && (params.get('view') === 'resume' || params.get('shipping') === 'refresh');
  const routeContextKey = JSON.stringify([params.get('batch'), params.get('order'), params.get('view'), params.get('shipping')]);
  const routeContext = useRef(routeContextKey), routeRevision = useRef(0);
  if (routeContext.current !== routeContextKey) routeRevision.current++;
  routeContext.current = routeContextKey;
  const currentRouteRevision = routeRevision.current;
  const [input, setInput] = useState(null), [settings, setSettings] = useState(initialSettings), [name, setName] = useState('');
  const [readySelection, setReadySelection] = useState(null);
  const [prepared, setPrepared] = useState(null), [previewDirty, setPreviewDirty] = useState(false);
  const [busy, setBusy] = useState(false), [access, setAccess] = useState('loading');
  const [checkingPreview, setCheckingPreview] = useState(false);
  const [message, setMessage] = useState(''), [messageKind, setMessageKind] = useState('status');
  const [existingOrderLink, setExistingOrderLink] = useState(null);
  const [records, setRecords] = useState([]), [saved, setSaved] = useState(null);
  const [profiles, setProfiles] = useState([]), [profileId, setProfileId] = useState(''), [choosingStore, setChoosingStore] = useState(false), [storeSetupOpen, setStoreSetupOpen] = useState(false);
  const [storeSelection, setStoreSelection] = useState(null);
  const [storeDraft, setStoreDraft] = useState(null), [storeConnections, setStoreConnections] = useState([]), [storeSetupProfiles, setStoreSetupProfiles] = useState([]), [storeSetupLoading, setStoreSetupLoading] = useState(false), [storeSetupMessage, setStoreSetupMessage] = useState('');
  const storeDraftRef = useRef(null), storeSetupRequest = useRef(0), storeSetupInFlight = useRef(false);
  const replaceStoreDraft = value => { storeDraftRef.current = value; setStoreDraft(value); };
  const clearStoreDraft = () => { storeSetupRequest.current++; replaceStoreDraft(null); setStoreConnections([]); setStoreSetupProfiles([]); setStoreSetupLoading(false); setStoreSetupMessage(''); };
  const [dragging, setDragging] = useState(false), [catalog, setCatalog] = useState(null);
  const [workbook, setWorkbook] = useState(null), [selectedSheet, setSelectedSheet] = useState('');
  const [barcodeChecks, setBarcodeChecks] = useState({});
  const [draftOverwriteOpen, setDraftOverwriteOpen] = useState(false);
  const draftInstance = useRef(0);
  const openDraftOverwrite = () => { draftInstance.current++; setDraftOverwriteOpen(true); };
  const closeDraftOverwrite = () => { draftInstance.current++; setDraftOverwriteOpen(false); };
  const currentDraftInstance = draftInstance.current;
  const fileRef = useRef(null), request = useRef(0), mounted = useRef(true), token = useRef(null);
  const previewController = useRef(null), previewRetry = useRef(null);
  const currentPreviewSequence = request.current;
  const actor = useRef({ id: user.id, role: user.role }), inFlight = useRef(false), targetSelectionInFlight = useRef(false);
  const storeSelectionInFlight = useRef(false), sourceRevision = useRef(0);
  const currentSourceRevision = sourceRevision.current;
  const showMessage = (value, kind = 'status') => { setMessage(value); setMessageKind(kind); setExistingOrderLink(null); };
  const currentSession = () => batchSessionMatches(sessionStorage, actor.current, token.current);
  const currentPreviewContext = () => mounted.current && currentSession() && sourceRevision.current === currentSourceRevision && routeRevision.current === currentRouteRevision;
  // Retained controls must never save, export or reopen a comparison for a
  // previous source or store, even before the disabled UI has rendered.
  const currentPreview = (allowStoreSelection = false) => currentPreviewContext() && currentPreviewSequence === request.current && !storeDraftRef.current && (allowStoreSelection || !storeSelectionInFlight.current);
  const clearReimportFocus = () => {
    if (params.get('shipping') !== 'refresh' && params.get('view') !== 'resume') return;
    setParams(current => { for (const key of ['batch', 'order', 'view', 'shipping']) current.delete(key); return current; }, { replace: true });
  };
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
      sourceRevision.current++;
      previewController.current?.abort();
      previewRetry.current = null;
      setCheckingPreview(false); setBusy(false);
      setInput(null); setReadySelection(null); setPrepared(null); setName(''); setSaved(null); setWorkbook(null); setSelectedSheet('');
      setRecords([]); setProfiles([]); setProfileId(''); setCatalog(null); setSettings(initialSettings());
      setBarcodeChecks({});
      setStoreSelection(null); setChoosingStore(false); setStoreSetupOpen(false);
      clearStoreDraft();
      closeDraftOverwrite();
      setAccess('denied'); showMessage('登入人員已變更，請重新登入。', 'error');
    };
    window.addEventListener('storage', check);
    return () => { mounted.current = false; request.current++; previewController.current?.abort(); window.removeEventListener('storage', check); };
  }, []);
  useEffect(() => { closeDraftOverwrite(); setStoreSelection(null); clearStoreDraft(); }, [routeContextKey]);
  const locked = busy || access !== 'ready' || draftOverwriteOpen || !!storeDraft;
  const readyPlan = readyOrderScope(prepared?.readyScope);
  const readySelectionChanged = !!readySelection && !preparedReadyScopeMatches(prepared, readySelection.plan, readySelection.profileId);
  // The ERP marketplace entry supplies a dispatcher station role even to administrators.
  const canAttestHistoricalLine = ['admin', 'superadmin'].includes(user.role) || (
    user.role === 'dispatcher' && typeof user.erpSubject === 'string' && !!user.erpSubject &&
    Array.isArray(user.permissions) && user.permissions.includes('wms_admin')
  );
  const barcodeConflicts = prepared?.barcodeConflicts || [];
  const barcodeBlocked = barcodeConflicts.length > 0;
  const products = useMemo(() => [...new Map((prepared?.parsed?.items || []).map(item => [item.sku, item])).values()], [prepared]);
  const matchingProfiles = profiles.filter(profile => profile.platform === input?.parsed.platform);
  const excludedFulfilled = readFulfilledExclusions(prepared?.excludedFulfilled) || [];
  const fulfilledNumbers = new Set(excludedFulfilled);
  const allFulfilled = excludedFulfilled.length > 0 && excludedFulfilled.length === prepared.raw?.orders.length;
  const reimports = (prepared?.reimports || []).filter(order => !fulfilledNumbers.has(order.orderNumber));
  const reviewRequired = prepared?.reviewRequired === true;
  const reimportNumbers = new Set(reimports.map(order => order.orderNumber));
  const onlyReimports = reimports.length > 0 && prepared.parsed.summary.orderCount === 0;
  const emptyExclusions = prepared?.parsed?.summary?.orderCount === 0 ? (prepared.choices || []).filter(choice => !choice.eligible && choice.reason && !reimportNumbers.has(choice.number) && !fulfilledNumbers.has(choice.number)) : [];
  const catalogMappingIssues = (catalog?.mappingIssues || []).filter(issue => issue.severity === 'error');
  const catalogMappingIssueSkus = new Set(catalogMappingIssues.map(issue => issue.sku));
  const issueGroups = useMemo(() => {
    const groups = new Map();
    for (const issue of prepared?.output?.issues || []) {
      if (issue.severity === 'warning' || (issue.code === 'EMPTY_INTAKE' && (emptyExclusions.length || reimports.length || allFulfilled))) continue;
      if (issue.code === 'BARCODE_MISMATCH' && barcodeBlocked) continue;
      if (issue.code === 'PRODUCT_MAPPING_REQUIRED' && catalogMappingIssueSkus.has(issue.sku)) continue;
      if (catalogMappingIssues.some(value => value.code === issue.code && value.sku === issue.sku)) continue;
      const key = `${issue.code}:${issue.field || ''}`;
      if (!groups.has(key)) groups.set(key, { key, items: [] });
      groups.get(key).items.push(issue);
    }
    return [...groups.values()].map(group => ({ ...group, title: group.items[0].code === 'PRODUCT_MAPPING_REQUIRED' ? `${group.items.length} 項商品需對照` : group.items[0].message }));
  }, [prepared, catalog]);
  const catalogIssues = products.flatMap(item => {
    if (catalogMappingIssueSkus.has(item.sku)) return [];
    const result = catalog?.products?.[item.sku];
    return result?.status === 'inactive' ? [`${item.sku}：ECOUNT 已中止使用。`]
      : result?.status === 'ambiguous' ? [`${item.sku}：ECOUNT 有多個對應品項。`] : [];
  });
  const catalogBlocked = catalogIssues.length > 0 || catalogMappingIssues.length > 0;
  const barcodeReviewSkus = new Set(barcodeConflicts.map(conflict => conflict.sourceSku));
  const unresolvedProducts = products.filter(item => catalogMappingIssueSkus.has(item.sku) || !barcodeReviewSkus.has(item.sku) && (!settings.skuMappings?.[item.sku]?.confirmed || ['inactive', 'ambiguous'].includes(catalog?.products?.[item.sku]?.status)));
  const raw = prepared?.raw || input?.parsed;
  const warnings = prepared?.output?.issues?.filter(issue => issue.severity === 'warning') || [];
  const applyPreview = data => {
    if (!data?.output || !data.parsed) throw Error('訂單核對尚未完成，請重新核對。');
    const nextSettings = { ...initialSettings(), ...(data.effectiveSettings || data.settings) };
    setPrepared(data); setSettings(nextSettings); setStoreSetupOpen(!nextSettings.store || !nextSettings.customerCode);
    setProfileId(data.profileId == null ? '' : String(data.profileId));
    if (data.profiles) setProfiles(data.profiles);
    setCatalog(data.catalog || null); setPreviewDirty(false);
    setBarcodeChecks({}); setStoreSelection(null);
  };
  const fetchPreview = async (rows, nextSettings, nextProfile, sequence, openComparison = false) => {
    const requestRoute = routeRevision.current;
    const isCurrent = () => mounted.current && sequence === request.current && currentSession() && routeRevision.current === requestRoute;
    const controller = new AbortController();
    previewController.current?.abort();
    previewController.current = controller;
    previewRetry.current = { settings: nextSettings, profileId: nextProfile, openComparison };
    setCheckingPreview(true);
    try {
      const response = await apiClient.post('/api/marketplace-intakes/preview', { rows, settings: nextSettings, ...(nextProfile ? { profileId: nextProfile } : {}) }, { timeout: 75000, signal: controller.signal });
      if (!isCurrent()) return false;
      applyPreview(response.data);
      previewRetry.current = null;
      const excluded = new Set(readFulfilledExclusions(response.data.excludedFulfilled) || []);
      const allExcluded = excluded.size > 0 && excluded.size === response.data.raw?.orders.length;
      const savedEligible = response.data.reimports?.some(order => !excluded.has(order.orderNumber));
      if (response.data.barcodeConflicts?.length > 0 || readyOrderScope(response.data.readyScope) ||
          (readySelection && !preparedReadyScopeMatches(response.data, readySelection.plan, readySelection.profileId))) closeDraftOverwrite();
      else if (openComparison && !allExcluded && (response.data.reviewRequired === true || savedEligible)) openDraftOverwrite();
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      const selection = storeSelectionFrom(error);
      if (!selection) throw error;
      previewRetry.current = null;
      closeDraftOverwrite(); setPrepared(null); setSaved(null); setCatalog(null); setProfileId('');
      setSettings(initialSettings()); setBarcodeChecks({}); setChoosingStore(false); setStoreSetupOpen(false);
      setPreviewDirty(true); setStoreSelection(selection); showMessage('');
      return false;
    } finally {
      if (previewController.current === controller) {
        previewController.current = null;
        if (mounted.current) setCheckingPreview(false);
      }
    }
  };
  const refreshPreview = async (nextSettings = settings, nextProfile = profileId, openComparison = false) => {
    if (locked || inFlight.current || !input || !currentPreview(true)) return;
    clearReimportFocus();
    const sequence = ++request.current;
    setBusy(true); setPreviewDirty(true); setSaved(null); showMessage('');
    try { await fetchPreview(input.source.rows, nextSettings, nextProfile, sequence, openComparison); }
    catch (error) {
      if (mounted.current && sequence === request.current && currentSession()) showMessage(orderMessage(error, marketplacePreviewError(error) || error.response?.data?.message || '訂單核對失敗，請重試。'), 'error');
    } finally { if (mounted.current && sequence === request.current) setBusy(false); }
  };
  const retryPreview = (nextSettings = settings, nextProfile = profileId, openComparison = false) => {
    const pending = previewRetry.current;
    return pending ? refreshPreview(pending.settings, pending.profileId, pending.openComparison)
      : refreshPreview(nextSettings, nextProfile, openComparison);
  };
  const cancelPreview = () => {
    if (!currentPreviewContext() || currentPreviewSequence !== request.current || !previewController.current || inFlight.current || storeSetupInFlight.current) return;
    request.current++;
    previewController.current.abort();
    previewController.current = null;
    setCheckingPreview(false); setBusy(false);
    showMessage('已停止等待核對。檔案已保留，可重新核對。');
  };
  const previewReadyOrders = async () => {
    if (locked || inFlight.current || previewDirty || readySelection || !input || !readyPlan || !profileId || !currentPreview()) return;
    const sequence = ++request.current;
    const isCurrent = () => currentPreviewContext() && sequence === request.current;
    const controller = new AbortController();
    previewController.current?.abort();
    previewController.current = controller;
    setBusy(true); setCheckingPreview(true); setPreviewDirty(true); setSaved(null); showMessage('');
    try {
      const { data } = await apiClient.post('/api/marketplace-intakes/ready-preview', {
        rows: input.source.rows, settings, profileId, readyScopeFingerprint: readyPlan.fingerprint,
      }, { timeout: 75000, signal: controller.signal });
      if (!isCurrent()) return;
      if (!Array.isArray(data?.rows)) throw Error(changedScopeMessage);
      const scoped = parseUnifiedMarketplace(data.rows);
      const preview = data.preview;
      if (data.readyScope?.fingerprint !== readyPlan.fingerprint || scoped.parsed.platform !== 'Shopify' ||
          !matchesReadyOrders(scoped.parsed.orders, readyPlan.candidateNumbers) || !preparedReadyScopeMatches(preview, readyPlan, profileId)) {
        throw Error(changedScopeMessage);
      }
      applyPreview(preview);
      sourceRevision.current++;
      setInput(scoped); setReadySelection({ input, settings, profileId, plan: readyPlan });
      setChoosingStore(false); previewRetry.current = null;
    } catch (error) {
      if (isCurrent()) showMessage(orderMessage(error, marketplacePreviewError(error) || error.response?.data?.message ||
        (error.message === changedScopeMessage ? changedScopeMessage : '可轉檔訂單核對失敗，請重新核對原檔。')), 'error');
    } finally {
      if (previewController.current === controller) {
        previewController.current = null;
        if (mounted.current) setCheckingPreview(false);
      }
      if (mounted.current && sequence === request.current) setBusy(false);
    }
  };
  const returnToOriginal = async () => {
    if (locked || inFlight.current || !readySelection || !currentPreview()) return;
    const original = readySelection;
    const sequence = ++request.current;
    sourceRevision.current++;
    setReadySelection(null); setInput(original.input); setPrepared(null); setCatalog(null);
    setSettings(original.settings); setProfileId(original.profileId); setBarcodeChecks({});
    setBusy(true); setPreviewDirty(true); setSaved(null); showMessage('');
    try { await fetchPreview(original.input.source.rows, original.settings, original.profileId, sequence); }
    catch (error) {
      if (mounted.current && sequence === request.current && currentSession()) showMessage(orderMessage(error, marketplacePreviewError(error) || error.response?.data?.message || '原檔核對失敗，請重試。'), 'error');
    } finally { if (mounted.current && sequence === request.current) setBusy(false); }
  };
  const returnToBarcodeReview = async instance => {
    if (instance !== draftInstance.current || !draftOverwriteOpen || !currentPreview() || access !== 'ready' || inFlight.current || !input || originalOrderFlow) return false;
    // Destroy the frozen comparison before changing mappings. The next review
    // is obtained from the server, never from a child's candidates or settings.
    closeDraftOverwrite(); setBarcodeChecks({});
    const sequence = ++request.current;
    setBusy(true); setPreviewDirty(true); setSaved(null); showMessage('');
    try {
      if (await fetchPreview(input.source.rows, settings, profileId, sequence)) showMessage('請先完成商品條碼核對，保存後會重新比對訂單。');
    } catch (error) {
      if (mounted.current && sequence === request.current && currentSession()) showMessage(orderMessage(error, error.response?.data?.message || '商品資料更新失敗，請重新核對。'), 'error');
    } finally { if (mounted.current && sequence === request.current) setBusy(false); }
    return true;
  };
  const selectBarcodeTarget = async (conflict, erpSku) => {
    if (locked || inFlight.current || targetSelectionInFlight.current || previewDirty || !input || !profileId || !currentPreview()) return;
    if (erpSku && !conflict.targetOptions?.some(option => option.erpSku === erpSku)) return;
    const nextSettings = { ...settings, skuMappings: { ...settings.skuMappings, [conflict.sourceSku]: {
      ...settings.skuMappings?.[conflict.sourceSku], erpSku, confirmed: false, barcodeConfirmed: false,
    } } };
    targetSelectionInFlight.current = true;
    setBarcodeChecks({});
    try { await refreshPreview(nextSettings, profileId); }
    finally { targetSelectionInFlight.current = false; }
  };
  const confirmBarcode = async conflict => {
    if (locked || inFlight.current || targetSelectionInFlight.current || previewDirty || readySelectionChanged || !input || !profileId || conflict.canConfirm !== true || !barcodeChecks[barcodeConflictKey(conflict)] || !currentPreview()) return;
    if (needsHistoricalAttestation(conflict) && (!canAttestHistoricalLine || !conflict.historicalAffectedOrders?.length)) return;
    clearReimportFocus();
    const sequence = ++request.current;
    inFlight.current = true; setBusy(true); setPreviewDirty(true); setSaved(null); showMessage('');
    try {
      const response = await apiClient.post('/api/marketplace-intakes/barcode-confirmations', {
        rows: input.source.rows, profileId, settings,
        verificationFingerprint: prepared.verification?.currentFingerprint,
        confirmation: { fingerprint: conflict.fingerprint, confirmed: true, ...(needsHistoricalAttestation(conflict) ? { historicalLineAttested: true } : {}) },
      }, { timeout: 75000 });
      if (!currentPreviewContext() || sequence !== request.current) return;
      if (response.data?.confirmed !== true) throw Error('商品對照未保存');
      if (await fetchPreview(input.source.rows, settings, profileId, sequence, true)) showMessage('商品對照已保存');
    } catch (error) {
      if (mounted.current && sequence === request.current && currentSession()) showMessage(error.response?.data?.message || '商品對照未保存，請重新核對。', 'error');
    } finally {
      inFlight.current = false;
      if (mounted.current && sequence === request.current) setBusy(false);
    }
  };
  const checkPhysicalBarcode = async (conflict, value) => {
    if (locked || inFlight.current || !input || !profileId || !currentPreview()) return;
    if (needsHistoricalAttestation(conflict) && !canAttestHistoricalLine) return;
    const physicalBarcode = String(value || '').trim();
    const nextSettings = { ...settings, skuMappings: { ...settings.skuMappings, [conflict.sourceSku]: {
      ...settings.skuMappings?.[conflict.sourceSku], physicalBarcode,
    } } };
    setBarcodeChecks({});
    await refreshPreview(nextSettings, profileId);
  };
  const chooseScanCodeType = async (conflict, scanCodeType) => {
    if(locked||inFlight.current||!input||!profileId||!currentPreview())return;
    const nextSettings={...settings,skuMappings:{...settings.skuMappings,[conflict.sourceSku]:{...settings.skuMappings?.[conflict.sourceSku],scanCodeType,barcode:'',barcodeConfirmed:false,internalScanConfirmed:false}}};
    setBarcodeChecks({});await refreshPreview(nextSettings,profileId);
  };
  const checkInternalScanCode = async (conflict, value) => {
    if(locked||inFlight.current||!input||!profileId||!currentPreview())return;
    const nextSettings={...settings,skuMappings:{...settings.skuMappings,[conflict.sourceSku]:{...settings.skuMappings?.[conflict.sourceSku],scanCodeType:'internal',internalScanCode:String(value||'').trim(),internalScanConfirmed:false,barcode:'',barcodeConfirmed:false}}};
    setBarcodeChecks({});await refreshPreview(nextSettings,profileId);
  };
  const update = (key, value) => {
    if (locked || inFlight.current || !currentPreview()) return;
    clearReimportFocus();
    request.current++; previewRetry.current = null; setSaved(null); setPreviewDirty(true);
    setSettings(current => ({ ...current, [key]: value, ...(['erpStaffCode', 'erpProjectCode'].includes(key) ? { erpResponsibilityConfirmed: false } : {}) }));
  };
  const mapping = (sku, key, value) => {
    if (locked || inFlight.current || !currentPreview()) return;
    clearReimportFocus();
    request.current++; previewRetry.current = null; setSaved(null); setPreviewDirty(true);
    setSettings(current => ({ ...current, skuMappings: { ...current.skuMappings, [sku]: {
      ...current.skuMappings[sku], [key]: value,
      ...(['erpSku', 'erpName'].includes(key) ? { confirmed: false } : {}),
      ...(key === 'barcode' ? { barcodeConfirmed: false } : {}),
      ...(['internalScanCode','scanCodeType','erpSku'].includes(key)?{internalScanConfirmed:false}:{}),
    } } }));
  };
  const useProfile = async id => {
    if (locked || inFlight.current || !currentPreview()) return;
    const profile = (storeSelection?.choices || matchingProfiles).find(value => String(value.id) === id);
    if (!profile) return;
    if (storeSelection) {
      setStoreSelection({ ...storeSelection, selectedId: id });
      if (!profile.connectionReady) return;
    }
    storeSelectionInFlight.current = true;
    closeDraftOverwrite(); setPrepared(null); setSaved(null); setCatalog(null); setProfileId('');
    setSettings(initialSettings()); setBarcodeChecks({}); setChoosingStore(false); setStoreSetupOpen(false);
    try { await refreshPreview({ skuMappings: {} }, String(profile.id), true); }
    finally { storeSelectionInFlight.current = false; }
  };
  const resetSource = () => {
    sourceRevision.current++;
    previewRetry.current = null;
    clearStoreDraft();
    clearReimportFocus();
    showMessage(''); setInput(null); setReadySelection(null); setPrepared(null); setPreviewDirty(false); setSaved(null); setName('');
    setProfileId(''); setChoosingStore(false); setStoreSetupOpen(false); setCatalog(null); setSettings(initialSettings());
    setBarcodeChecks({}); setStoreSelection(null);
    closeDraftOverwrite();
  };
  const loadWorksheet = async (XLSX, book, sheetName, fileName, sequence) => {
    const result = parseMarketplaceWorksheet(XLSX, book, sheetName);
    if (!mounted.current || sequence !== request.current || !currentSession()) return;
    setInput(result); setName(fileName); setSelectedSheet(sheetName); setPreviewDirty(true);
    await fetchPreview(result.source.rows, initialSettings(), '', sequence, true);
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
      if (mounted.current && sequence === request.current && currentSession()) showMessage(orderMessage(error, marketplacePreviewError(error) || error.response?.data?.message || error.message || '無法讀取來源檔。'), 'error');
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
      if (mounted.current && sequence === request.current && currentSession()) showMessage(orderMessage(error, marketplacePreviewError(error) || error.response?.data?.message || error.message || '無法讀取訂單工作表。'), 'error');
    } finally { if (mounted.current && sequence === request.current) setBusy(false); }
  };
  const openStoreSetup = async () => {
    if (locked || inFlight.current || storeSetupInFlight.current || !currentPreview() || originalOrderFlow) return;
    const sequence = ++storeSetupRequest.current;
    request.current++;
    closeDraftOverwrite(); setPrepared(null); setSaved(null); setCatalog(null); setProfileId(''); setSettings(initialSettings()); setBarcodeChecks({}); setPreviewDirty(!!input);
    replaceStoreDraft(blankStoreDraft()); setStoreSetupLoading(true); setStoreSetupMessage('');
    const current = () => currentPreviewContext() && sequence === storeSetupRequest.current;
    try {
      const [profileResponse, connectionResponse] = await Promise.all([apiClient.get('/api/marketplace-intakes/store-profiles'), apiClient.get('/api/marketplace-intakes/store-connections')]);
      if (!current()) return;
      const connections = connectionResponse.data?.connections;
      if (!Array.isArray(profileResponse.data?.profiles) || !Array.isArray(connections) || new Set(connections.map(connection => connection.id)).size !== connections.length || connections.some(connection => connection.platform !== 'Shopify' || typeof connection.id !== 'string' || !connection.id || connection.id.length > 100 || /[\u0000-\u001f\u007f]/.test(connection.id) || typeof connection.connectionReady !== 'boolean' || !['static_token', 'client_credentials'].includes(connection.authKind) || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(connection.shop))) throw Error('店鋪連線資料不完整，請重新載入。');
      setProfiles(profileResponse.data.profiles); setStoreSetupProfiles(profileResponse.data.profiles); setStoreConnections(connections);
    } catch (error) { if (current()) setStoreSetupMessage(error.response?.data?.message || error.message || '無法讀取店鋪設定，請確認權限後重新載入。'); }
    finally { if (current()) setStoreSetupLoading(false); }
  };
  const currentStoreDraft = () => currentPreviewContext() && access === 'ready' && !originalOrderFlow && !!storeDraft && storeDraftRef.current === storeDraft && !storeSetupInFlight.current && !busy && !inFlight.current;
  const editStoreDraft = (key, value) => {
    if (!currentStoreDraft() || storeSetupLoading) return;
    replaceStoreDraft({ ...storeDraft, [key]: value, ...(key === 'confirmed' ? {} : { confirmed: false }) }); setStoreSetupMessage('');
  };
  const chooseStoreDraft = id => {
    if (!currentStoreDraft() || storeSetupLoading) return;
    if (!id) { replaceStoreDraft(blankStoreDraft()); setStoreSetupMessage(''); return; }
    const profile = storeSetupProfiles.find(value => value.platform === 'Shopify' && String(value.id) === id);
    if (!profile?.settings || profile.settings.store !== profile.store || typeof profile.updated_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(profile.updated_at)) { setStoreSetupMessage('店鋪版本資料不完整，請關閉後重新載入。'); return; }
    const value = profile.settings;
    replaceStoreDraft({ profileId: id, expectedUpdatedAt: profile.updated_at, originalSettings: persistentStoreSettings(value), store: profile.store,
      connectionId: value.apiConnectionId || '', customerCode: value.customerCode || '', customerName: value.customerName || '', warehouseCode: value.warehouseCode || '', currency: value.currency || '', tax: value.taxMode === 'erp_inclusive' && value.taxType === '11' ? 'erp_inclusive:11' : '', confirmed: false });
    setStoreSetupMessage('');
  };
  const setupConnection = storeConnections.find(connection => connection.id === storeDraft?.connectionId);
  const storeDraftValid = !!storeDraft && ['store', 'customerCode', 'customerName', 'warehouseCode'].every(key => typeof storeDraft[key] === 'string' && !!storeDraft[key].trim() && storeDraft[key].length <= (['customerCode', 'warehouseCode'].includes(key) ? 30 : 100) && !/[\u0000-\u001f\u007f]/.test(storeDraft[key])) && setupConnection?.connectionReady === true && storeDraft.currency === 'TWD' && storeDraft.tax === 'erp_inclusive:11' && storeDraft.confirmed === true;
  const saveStoreDraft = async () => {
    if (!currentStoreDraft() || storeSetupLoading || !storeDraftValid) return;
    const draft = storeDraft, sequence = ++storeSetupRequest.current;
    const next = { ...draft.originalSettings, apiConnectionId: setupConnection.id, shopifyShop: setupConnection.shop, store: draft.store.trim(), customerCode: draft.customerCode.trim(), customerName: draft.customerName.trim(), warehouseCode: draft.warehouseCode.trim(), currency: 'TWD', taxMode: 'erp_inclusive', taxType: '11', taxConfirmed: true };
    storeSetupInFlight.current = true; setStoreSetupLoading(true); setStoreSetupMessage('');
    const current = () => currentPreviewContext() && storeDraftRef.current === draft && sequence === storeSetupRequest.current;
    try {
      const response = await apiClient.post('/api/marketplace-intakes/store-profiles', { platform: 'Shopify', settings: next, ...(draft.profileId ? { profileId: draft.profileId, expectedUpdatedAt: draft.expectedUpdatedAt } : { createOnly: true }) });
      if (!current()) return;
      const readback = await apiClient.get('/api/marketplace-intakes/store-profiles');
      if (!current()) return;
      const savedProfile = readback.data?.profiles?.find(profile => String(profile.id) === String(response.data?.id));
      if (!savedProfile || savedProfile.platform !== 'Shopify' || savedProfile.store !== next.store || !savedProfile.updated_at || savedProfile.updated_at !== response.data.updated_at || stableValue(persistentStoreSettings(savedProfile.settings)) !== stableValue(next)) throw Error('設定已保存，但重新讀取的內容不一致；請重新載入後核對。');
      setProfiles(readback.data.profiles); clearStoreDraft(); storeSetupInFlight.current = false;
      showMessage('店鋪設定已保存並核實。讀單權限會在訂單預覽時確認。');
      if (input?.parsed.platform === 'Shopify') {
        const previewSequence = ++request.current; setBusy(true);
        try { await fetchPreview(input.source.rows, { skuMappings: {} }, String(savedProfile.id), previewSequence, true); }
        catch (error) { if (mounted.current && currentSession() && previewSequence === request.current) showMessage(error.response?.data?.message || '設定已保存，訂單仍需重新核對。', 'error'); }
        finally { if (mounted.current && previewSequence === request.current) setBusy(false); }
      }
    } catch (error) { if (current()) { replaceStoreDraft({ ...draft, confirmed: false }); setStoreSetupMessage(error.response?.data?.message || error.message || '店鋪設定未保存，請重新載入後重試。'); } }
    finally { storeSetupInFlight.current = false; if (mounted.current && sequence === storeSetupRequest.current) setStoreSetupLoading(false); }
  };
  const writeAudit = async () => {
    const XLSX = await import('xlsx');
    if (!currentPreview()) throw Error('目前作業已變更，未下載資料。');
    const book = XLSX.utils.book_new();
    const add = (title, rows) => {
      const sheet = XLSX.utils.aoa_to_sheet(rows); sheet['!cols'] = (rows[0] || []).map(() => ({ wch: 24 }));
      XLSX.utils.book_append_sheet(book, sheet, title);
    };
    add('承辦人', [['狀態', '未保存核對草稿'], ['承辦人', user.name || user.username || ''], ['承辦人帳號', user.username || '']]);
    add('預揀總表', [prepared.prepick.headers, ...prepared.prepick.rows]);
    add('訂單金額核對', [prepared.audit.headers, ...prepared.audit.rows]);
    add('來源商品對照', [['平台', '商城訂單', '來源明細號', '來源SKU', '商品名稱', '原始數量', '原始單價', '原始商品小計', '來源組合名稱', '來源SKU條碼', '來源團組名稱', '來源團次', '來源SKU格式'], ...raw.items.map(item => [raw.platform, item.sourceOrderNumber, item.sourceLineId, item.sku, item.productName, item.quantity, item.unitPriceMinor == null ? '原檔未分價' : prepared.output.rounding ? formatMinor(item.unitPriceMinor) : item.unitPriceMinor / 100, (item.sourceLineSubtotalMinor ?? item.lineSubtotalMinor) == null ? '原檔未分價' : prepared.output.rounding ? formatMinor(item.sourceLineSubtotalMinor ?? item.lineSubtotalMinor) : (item.sourceLineSubtotalMinor ?? item.lineSubtotalMinor) / 100, item.groupName, item.sourceBarcode || '', item.campaignGroupName || '', item.campaignRound || '', item.sourceSkuFormat || ''])]);
    add('本批納入與排除', [['商城訂單', '納入本批', '原因'], ...prepared.choices.map(choice => [choice.number, choice.eligible ? '是' : '否', choice.reason])]);
    add('ECOUNT成交核對', [['商城訂單', '來源明細號', 'SKU', '數量', '商品淨額', '另分攤訂單折扣'], ...prepared.parsed.items.map(item => [item.sourceOrderNumber, item.sourceLineId, item.sku, item.quantity, item.lineSubtotalMinor == null ? '待確認' : prepared.output.rounding ? formatMinor(item.lineSubtotalMinor) : item.lineSubtotalMinor / 100, prepared.output.rounding ? formatMinor(item.allocatedDiscountMinor || 0) : (item.allocatedDiscountMinor || 0) / 100])]);
    if (prepared.output.rounding) add('整元尾差對照', [['商城訂單', '來源明細號', '來源成交金額', 'ECOUNT含稅金額', '整元尾差'], ...prepared.output.rounding.orders.flatMap(order => order.lines.map(line => [order.identity[1], line.sourceLineId, formatMinor(line.sourceGrossMinor), formatMinor(line.ecountGrossMinor), formatMinor(line.roundingDeltaMinor)]))]);
    XLSX.writeFile(book, `預揀與金額核對_${settings.batchNumber}.xlsx`);
  };
  const download = async kind => {
    if (locked || inFlight.current || !input || !prepared || previewDirty || readySelectionChanged || !currentPreview() || originalOrderFlow) return;
    if (kind === 'ecount' && readyPlan) return;
    if (kind === 'ecount' && allFulfilled) return;
    if (kind === 'ecount' && barcodeBlocked) { showMessage('請先完成商品條碼核對，再比對訂單。'); return; }
    // A file containing saved orders is confirmed and exported as one file.
    // The new-order-only save route remains for files with no saved orders.
    if (kind === 'ecount' && (reimports.length > 0 || reviewRequired)) { openDraftOverwrite(); return; }
    if (kind === 'ecount' && (!prepared.parsed.orders.length || !prepared.output.ok || catalogBlocked || barcodeBlocked)) return;
    if (kind === 'audit' && (!prepared.audit.ok || !prepared.prepick.ok)) return;
    inFlight.current = true; setBusy(true); showMessage('');
    try {
      if (kind === 'ecount') {
        const response = await apiClient.post('/api/marketplace-intakes', {
          rows: input.source.rows, settings, ...(profileId ? { profileId } : {}),
          ...(prepared.verification?.currentFingerprint ? { previewFingerprint: prepared.verification.currentFingerprint } : {}),
        }, { timeout: 75000 });
        if (!currentPreview()) return;
        if (response.data?.salesDownloadAllowed === false || response.data?.newOrderCount === 0) {
          setSaved(null);
          const sequence = ++request.current;
          setPreviewDirty(true);
          if (await fetchPreview(input.source.rows, settings, profileId, sequence)) showMessage('訂單已保存，請查看原訂單。');
          return;
        }
        setSaved(response.data);
        if (getNativeRuntime()) {
          if (!await downloadNativeMarketplaceFile({ id: response.data.id, kind: 'ecount' }, { isCurrent: () => currentPreview() })) return;
        } else {
          const link = await apiClient.post(`/api/marketplace-intakes/${response.data.id}/download-link`, { kind: 'ecount' }, { withCredentials: true });
          if (!currentPreview()) return;
          const anchor = document.createElement('a'); anchor.href = `${API_ORIGIN}${link.data.url}`; anchor.download = '';
          document.body.appendChild(anchor); anchor.click(); anchor.remove();
        }
        if (!await loadRecords() || !currentPreview()) return;
        showMessage('已保存・待 ECOUNT 匯入');
        // Reuse validated customer/warehouse settings on the next file. Profile
        // persistence is secondary to the already-saved immutable sales batch.
        try {
          const stored = await apiClient.post('/api/marketplace-intakes/store-profiles', { platform: prepared.parsed.platform, settings });
          if (currentPreview()) {
            setProfiles(current => [...current.filter(value => value.id !== stored.data.id), stored.data]); setProfileId(String(stored.data.id));
          }
        } catch {
          if (currentPreview()) showMessage('已保存・待 ECOUNT 匯入；店鋪設定未保存，下次請重新選擇。');
        }
      } else { await writeAudit(); if (currentPreview()) showMessage('核對表已下載'); }
    } catch (error) {
      if (currentPreview()) {
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
        setExistingOrderLink(originalOrderLink(error.response?.data));
      }
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const settingsField = (label, key, extra = {}) => <Field label={label} value={settings[key] || ''} onChange={event => update(key, event.target.value)} onBlur={() => { if (previewDirty) return refreshPreview(); }} {...extra} />;
  const needsStore = !settings.store || !settings.customerCode;
  return <main className="mx-auto w-full min-w-0 max-w-6xl space-y-4 pb-6 text-slate-900" data-testid="marketplace-converter">
    <header className="min-w-0 space-y-1">
      <Link to="/admin" className="inline-flex min-h-8 items-center gap-2 text-sm font-medium text-blue-700"><ArrowLeft size={16} />返回出貨管理</Link>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2"><h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight">{originalOrderFlow ? '原訂單出貨' : '商城訂單轉檔'}</h1>{originalOrderFlow ? <Button variant="secondary" disabled={locked} onClick={clearReimportFocus}>返回訂單轉檔</Button> : !draftOverwriteOpen && <a href="#saved-batches" onClick={event => handleWorkspaceAnchor(event, 'saved-batches')} className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700">已保存批次</a>}</div>
    </header>
    {message && (!originalOrderFlow || access === 'denied') && <div role={messageKind === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${messageKind === 'error' ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-slate-200 bg-white text-slate-800'}`}><p>{message}</p>{existingOrderLink && <Button as={Link} to={existingOrderLink} variant="secondary" className="mt-3" disabled={locked} onClick={event => { if (locked || !currentSession()) event.preventDefault(); }}>查看原訂單</Button>}</div>}
    {!originalOrderFlow && <>{draftOverwriteOpen ? <p className="break-words text-sm text-slate-500" aria-label="本次檔案">{name}{settings.store && ` · ${settings.store}`}</p> : <section className={`${sectionClass} border-2 border-dashed transition-colors ${dragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300'}`} onDragOver={event => { event.preventDefault(); if (!locked) setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); selectFiles(Array.from(event.dataTransfer.files || [])); }} aria-label="商城訂單檔案區">
      <div className="flex flex-col items-center py-3 text-center"><UploadCloud size={32} className="mb-3 text-blue-600" /><h2 className="text-lg font-semibold">{dragging ? '放開檔案，開始核對' : '拖曳商城訂單到這裡'}</h2><p className="mt-2 text-sm text-slate-600">Shopify、1Shop、SHOPLINE · Excel／CSV</p>
        {checkingPreview ? <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <p role="status" className="flex items-center gap-2 text-sm text-slate-700"><Loader2 className="animate-spin" size={18} />正在核對商城訂單…</p>
          {!inFlight.current && !storeSetupInFlight.current && <Button type="button" variant="secondary" onClick={cancelPreview}>停止等待</Button>}
        </div> : <Button type="button" variant="secondary" className="mt-4" disabled={locked} onClick={() => fileRef.current?.click()}>{busy ? <Loader2 className="mr-2 animate-spin" size={18} /> : <FileSpreadsheet className="mr-2" size={18} />}{busy ? (name ? '處理中…' : '正在讀取訂單檔…') : name ? '更換訂單檔' : '選擇訂單檔'}</Button>}
      </div>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={locked} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; return selectFiles(files); }} aria-label="商城原始訂單檔" />
      {workbook && <div className="mt-3 max-w-xl"><p className="mb-2 text-sm text-slate-600">{workbook.fileName}</p><Field label="訂單工作表"><select className={inputClass} disabled={locked} value={selectedSheet} onChange={event => chooseSheet(event.target.value)}><option value="">請選擇工作表</option>{workbook.sheets.map(sheet => <option key={sheet} value={sheet}>{sheet}</option>)}</select></Field></div>}
      {name && <p className="mt-3 break-words text-sm text-slate-600"><strong className="text-slate-900">{input?.parsed.platform}</strong> · {name} · {selectedSheet}</p>}
      {!name && <details className="mt-3 text-sm text-slate-600"><summary className="cursor-pointer">匯出格式</summary><ul className="mt-2 list-disc space-y-1 pl-5"><li>Shopify：訂單 CSV</li><li>1Shop：訂單 Excel</li><li>SHOPLINE：包含貨號、商品明細與金額的訂單報表</li></ul></details>}
    </section>}
    {!storeSelection && !storeDraft && !draftOverwriteOpen && <Button variant="secondary" disabled={locked} onClick={openStoreSetup}>店鋪設定</Button>}
    {storeDraft && <details open className={sectionClass} aria-label="獨立店鋪設定"><summary className="text-lg font-semibold">店鋪設定</summary>
      <p className="mt-2 text-sm text-slate-600">只保存店鋪與 ECOUNT 對照；連線設定完成後，仍須以訂單預覽確認讀單權限。</p>
      {storeSetupMessage && <p role="status" className="mt-3 text-sm text-amber-950">{storeSetupMessage}</p>}
      <fieldset disabled={storeSetupLoading || busy || access !== 'ready'} className="mt-4 space-y-4">
        <Field label="設定方式"><select className={inputClass} value={storeDraft.profileId} onChange={event => chooseStoreDraft(event.target.value)}><option value="">新增店鋪</option>{storeSetupProfiles.filter(profile => profile.platform === 'Shopify').map(profile => <option key={profile.id} value={String(profile.id)}>{profile.store}</option>)}</select></Field>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="店鋪名稱" value={storeDraft.store} maxLength={100} disabled={!!storeDraft.profileId} onChange={event => editStoreDraft('store', event.target.value)} />
          <Field label="Shopify 連線"><select className={inputClass} value={storeDraft.connectionId} onChange={event => editStoreDraft('connectionId', event.target.value)}><option value="">選擇店鋪連線</option>{storeConnections.map(connection => <option key={connection.id} value={connection.id}>{connection.shop}{connection.connectionReady ? '（已設定）' : '（待串接）'}</option>)}</select></Field>
          <Field label="ECOUNT 客戶編碼" value={storeDraft.customerCode} maxLength={30} onChange={event => editStoreDraft('customerCode', event.target.value)} /><Field label="ECOUNT 客戶名稱" value={storeDraft.customerName} maxLength={100} onChange={event => editStoreDraft('customerName', event.target.value)} />
          <Field label="ECOUNT 倉庫編碼" value={storeDraft.warehouseCode} maxLength={30} onChange={event => editStoreDraft('warehouseCode', event.target.value)} />
          <Field label="幣別"><select className={inputClass} value={storeDraft.currency} onChange={event => editStoreDraft('currency', event.target.value)}><option value="">請核對幣別</option><option value="TWD">TWD 新台幣</option></select></Field>
          <Field label="稅別"><select className={inputClass} value={storeDraft.tax} onChange={event => editStoreDraft('tax', event.target.value)}><option value="">請核對稅別</option><option value="erp_inclusive:11">含稅 5%（ECOUNT 11）</option></select></Field>
        </div>
        {setupConnection && !setupConnection.connectionReady && <p className="text-sm text-amber-950">此店鋪連線尚未完成，請聯絡管理員。</p>}
        {!storeConnections.length && !storeSetupLoading && <p className="text-sm text-amber-950">尚無可用的 Shopify 店鋪連線，請聯絡管理員。</p>}
        <Check checked={storeDraft.confirmed} onChange={value => editStoreDraft('confirmed', value)}>我已核對店鋪連線與 ECOUNT 客戶、倉庫及幣稅設定</Check>
        <div className="flex flex-wrap gap-3"><Button disabled={storeSetupLoading || busy || !storeDraftValid} onClick={saveStoreDraft}>{storeSetupLoading ? '處理中…' : '保存店鋪設定'}</Button><Button variant="secondary" disabled={storeSetupLoading || busy} onClick={() => { if (currentStoreDraft()) clearStoreDraft(); }}>取消設定</Button></div>
      </fieldset>
    </details>}
    {input && storeSelection && <section className={`${sectionClass} space-y-3`} aria-label="店鋪確認">
      <div><h2 className="text-lg font-semibold">{storeSelection.choices.length ? '確認店鋪' : '店鋪尚未設定'}</h2><p className="mt-1 text-sm text-slate-600">{!storeSelection.choices.length ? '請聯絡管理員完成店鋪設定，再重新核對。' : storeSelection.reason === 'mixed_stores' ? '這份檔案含不同店鋪的訂單，請分別提供各店鋪的訂單檔。' : '尚無法確認訂單所屬店鋪，請選擇匯出訂單的店鋪。'}</p></div>
      {storeSelection.choices.length > 0 && <div className="max-w-md"><Field label="店鋪"><select className={inputClass} disabled={locked} value={storeSelection.selectedId} onChange={event => useProfile(event.target.value)}><option value="">選擇店鋪</option>{storeSelection.choices.map(choice => <option key={choice.id} value={choice.id}>{choice.store}{!choice.connectionReady ? '（待串接）' : ''}</option>)}</select></Field></div>}
      {storeSelection.choices.length > 0 && (storeSelection.choices.every(choice => !choice.connectionReady) || storeSelection.choices.some(choice => choice.id === storeSelection.selectedId && !choice.connectionReady)) && <p className="text-sm text-amber-950">此店鋪連線尚未完成，請聯絡管理員</p>}
      <Button variant="secondary" disabled={locked} onClick={() => retryPreview({ skuMappings: {} }, '', true)}>重新核對</Button>
      {!storeDraft && <Button variant="secondary" disabled={locked} onClick={openStoreSetup}>店鋪設定</Button>}
    </section>}
    {input && !prepared && !storeSelection && !busy && <div className={sectionClass}><Button variant="secondary" disabled={locked} onClick={() => retryPreview()}>重新核對訂單</Button></div>}
    {(readySelection || readyPlan) && <ReadyOrderReview plan={readySelection?.plan || readyPlan} scoped={!!readySelection} scopeChanged={readySelectionChanged}
      disabled={locked || (!readySelection && (previewDirty || !profileId))} onPreview={previewReadyOrders} onReturn={returnToOriginal} />}
    {input && prepared && <>
      {!draftOverwriteOpen && <section className={`${sectionClass} border-blue-200`} aria-label="轉檔與下載">
        {(!readySelection && (choosingStore || !profileId && matchingProfiles.length > 1)) ? <div className="mb-5 max-w-xl"><Field label="店鋪"><select className={inputClass} disabled={locked} value={profileId} onChange={event => useProfile(event.target.value)}><option value="">選擇店鋪</option>{matchingProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.store}</option>)}</select></Field></div>
          : settings.store && <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"><strong>{settings.store}</strong><span className="text-slate-600">{settings.customerCode} {settings.customerName}</span>{!readySelection && matchingProfiles.length > 1 && <button type="button" className="min-h-10 font-medium text-blue-700" disabled={locked} onClick={() => setChoosingStore(true)}>更換店鋪</button>}</div>}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="text-lg font-semibold">{allFulfilled ? '本次沒有可轉檔的訂單' : reimports.length ? `本次檔案 ${raw.orders.length} 筆 · 已保存 ${reimports.length} 筆 · 新單 ${raw.orders.length - reimports.length - excludedFulfilled.length} 筆` : reviewRequired ? `本次檔案 ${raw.orders.length} 筆・取消與退款待核對` : emptyExclusions.length ? `已讀取 ${raw.orders.length} 筆・可銷貨 0 筆` : `${prepared.parsed.summary.orderCount} 筆訂單 · ${prepared.parsed.summary.totalQuantity} 件商品`}</h2>{!allFulfilled && (reviewRequired ? <p className="mt-2 text-sm text-slate-700">核對取消品項與剩餘出貨內容後，產生銷貨檔。</p> : reimports.length ? <p className="mt-2 text-sm text-slate-700">比對檔案的新增與異動，確認後下載銷貨檔。</p> : !onlyReimports && <p className="mt-2 text-sm text-slate-700">含稅 {settings.currency} {money(prepared.parsed.summary.totalMinor)}</p>)}
            {!reimports.length && prepared.output.ok && <p className="mt-1 text-sm text-slate-600">稅前 {money(prepared.output.summary.ecountNetMinor)} · 營業稅 {money(prepared.output.summary.ecountTaxMinor)} · 銷貨 {prepared.output.summary.ecountRowCount} 列</p>}
            {!reimports.length && prepared.output.ok && !!prepared.output.summary.roundingDeltaMinor && <p className="mt-1 text-sm text-slate-600">ERP 含稅 {money(prepared.output.summary.ecountTotalMinor)} · 整元尾差 {money(prepared.output.summary.roundingDeltaMinor)}</p>}
          </div>
          {!readyPlan && !readySelectionChanged && !allFulfilled && (reimports.length > 0 || reviewRequired ? <Button disabled={locked || previewDirty || originalOrderFlow || barcodeBlocked} onClick={() => download('ecount')}><Download size={16} className="mr-2" />{reviewRequired ? '核對取消與退款' : excludedFulfilled.length || readySelection ? '比對並確認本次轉檔' : '比對並產生整份銷貨檔'}</Button> : !onlyReimports && <Button disabled={locked || previewDirty || !prepared.output.ok || catalogBlocked || barcodeBlocked} onClick={() => download('ecount')}><Download size={16} className="mr-2" />下載銷貨檔</Button>)}
        </div>
        {!previewDirty && excludedFulfilled.length > 0 && <div className="mt-4"><MarketplaceFulfilledExclusions orderNumbers={excludedFulfilled} /></div>}
        {!readyPlan && barcodeBlocked && (reimports.length > 0 || reviewRequired) && <p className="mt-3 text-sm text-amber-950">請先完成下方商品條碼核對，保存後會接續訂單比對。</p>}
        {busy ? null
          : previewDirty ? <div className="mt-4"><Button variant="secondary" disabled={locked} onClick={() => retryPreview()}>重新核對</Button></div>
          : !readyPlan && !readySelectionChanged && !reviewRequired && prepared.output.ok && !catalogBlocked && !barcodeBlocked && <p className="mt-4 flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 size={16} />{prepared.verification?.mode === 'api' ? `${prepared.verification.platform || 'Shopify'} API 已核對` : '檔案核對通過'}・下載後上傳 ECOUNT</p>}
        {!previewDirty && (issueGroups.length > 0 || catalogBlocked || emptyExclusions.length > 0) && <div className="mt-4 rounded-lg bg-amber-50 p-4" role="region" aria-label="待處理問題"><p className="text-sm font-semibold text-amber-950">{issueGroups.length || catalogBlocked ? '待處理' : '本批無可銷貨訂單'}</p><ul className="mt-2 space-y-2 text-sm text-amber-950" aria-label="轉檔檢查結果">
          {emptyExclusions.map(choice => <li key={choice.number}>{choice.number}：{choice.reason}</li>)}
          {catalogIssues.map(value => <li key={value}>{value}</li>)}
          {catalogMappingIssues.length > 0 && <li><a href="#product-mapping" onClick={event => handleWorkspaceAnchor(event, 'product-mapping')} className="font-medium underline">{catalogMappingIssueSkus.size} 項商品需核對 ECOUNT 品號</a></li>}
          {issueGroups.map(group => <li key={group.key}>{group.items.length > 1 ? <details><summary className="cursor-pointer">{group.title}{group.items[0].code !== 'PRODUCT_MAPPING_REQUIRED' ? `（${group.items.length} 筆）` : ''}</summary><ul className="mt-2 space-y-1 pl-4">{group.items.map((issue, index) => <li key={index}>{issue.orderNumber ? `${issue.orderNumber}：` : ''}{issue.sourceRow ? `第 ${issue.sourceRow} 列：` : ''}{issue.message}</li>)}</ul></details> : <>{group.items[0].orderNumber ? `${group.items[0].orderNumber}：` : ''}{group.items[0].sourceRow ? `第 ${group.items[0].sourceRow} 列：` : ''}{group.title}</>}</li>)}
        </ul></div>}
        {saved && <Link className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-blue-700 underline" to={`?batch=${saved.id}&view=return#batch-detail`}>匯回 ECOUNT 理貨單</Link>}
      </section>}
      {draftOverwriteOpen && !originalOrderFlow && <MarketplaceDraftOverwrite rows={input.source.rows} settings={settings} profileId={profileId}
        isCurrent={() => currentPreview() && currentDraftInstance === draftInstance.current}
        onBusyChange={value => { if (mounted.current && currentDraftInstance === draftInstance.current) setBusy(value); }}
        onClose={() => { if (currentDraftInstance === draftInstance.current) closeDraftOverwrite(); }}
        onBarcodeReview={() => returnToBarcodeReview(currentDraftInstance)}
        onComplete={async () => {
          const current = () => currentPreview() && currentDraftInstance === draftInstance.current;
          if (!current() || !await loadRecords() || !current()) return;
          const sequence = ++request.current;
          try { await fetchPreview(input.source.rows, settings, profileId, sequence); }
          finally { if (mounted.current && sequence === request.current) setBusy(false); }
        }} />}
      {!draftOverwriteOpen && reimports.length > 0 && !previewDirty && <section className={sectionClass} aria-label="已保存訂單"><h2 className="font-semibold">已保存訂單（{reimports.length} 筆）</h2><p className="mt-2 text-sm text-slate-600">{reviewRequired ? '使用上方「核對取消與退款」，一次確認本批剩餘出貨內容。' : '使用上方「比對並產生整份銷貨檔」，一併核對本次檔案的新單與已保存訂單。'}</p><div className="mt-3 divide-y divide-slate-100">{reimports.map(order => {
        const { link, resume } = reimportLink(order);
        return <div key={order.orderNumber} className="flex flex-wrap items-center justify-between gap-3 py-3" aria-label={`已保存訂單 ${order.orderNumber}`}><div className="min-w-0"><p className="flex flex-wrap gap-x-3 gap-y-1 text-sm"><strong className="break-all">{order.orderNumber}</strong><span className="text-slate-600">{reimportStates[order.state] || '已保存'}</span></p>{order.message && (!resume || !order.canUpdateShipping) && <p className="mt-1 break-words text-sm text-slate-600">{order.message}</p>}</div>{link && <Button as={Link} to={link} variant="secondary" disabled={locked} onClick={event => { if (locked || !currentSession() || routeContext.current !== routeContextKey) event.preventDefault(); }}>{resume ? '接續原銷貨單' : '查看原訂單'}</Button>}</div>;
      })}</div></section>}
      <details open={!draftOverwriteOpen} className={draftOverwriteOpen ? "min-w-0 border-t border-slate-200 py-2" : "contents"}><summary className={draftOverwriteOpen ? "min-h-10 cursor-pointer py-2 text-sm font-medium text-slate-600" : "hidden"}>其他資料</summary>
      {!readySelectionChanged && barcodeBlocked && <section className={`${sectionClass} border-amber-200`} aria-label="商品條碼核對"><h2 className="font-semibold">商品條碼待核對（{barcodeConflicts.length} 項）</h2><div className="mt-4 space-y-4">{barcodeConflicts.map(conflict => {
        const key = barcodeConflictKey(conflict);
        const historical = needsHistoricalAttestation(conflict);
        const evidenceOrders = (historical ? conflict.historicalAffectedOrders : conflict.relatedOrders) || [];
        const canConfirm = conflict.canConfirm === true && (!historical || canAttestHistoricalLine && evidenceOrders.length > 0);
        const chooseTarget = !historical && conflict.targetOptions?.length > 1;
        const sourceBarcodeMissing = conflict.platform === 'Shopify' && conflict.reviewReason === 'SOURCE_BARCODE_MISSING';
        const canScanPhysicalBarcode = conflict.canEnterPhysicalBarcode === true && (!historical || canAttestHistoricalLine);
        const internal = !historical && conflict.requiresInternalScanCode === true;
        return <div key={key} className="rounded-lg border border-slate-200 p-4">
          <p className="font-medium">{conflict.sourceName || products.find(item => item.sku === conflict.sourceSku)?.productName || conflict.erpName}</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div><h3 className="text-sm font-medium">{conflict.platform} 商品</h3><dl className="mt-2 space-y-1 text-sm">
              <div><dt className="inline text-slate-600">品號：</dt><dd className="inline break-all font-medium">{conflict.sourceSku}</dd></div>
              <div><dt className="inline text-slate-600">條碼：</dt><dd className="inline break-all font-medium">{conflict.sourceBarcode || '未填條碼'}</dd></div>
            </dl></div>
            <div>{chooseTarget ? <Field label="ECOUNT 品項"><select className={inputClass} disabled={locked || previewDirty || !profileId} value={conflict.selectedErpSku || ''} onChange={event => selectBarcodeTarget(conflict, event.target.value)}><option value="">選擇品項</option>{conflict.targetOptions.map(option => <option key={option.erpSku} value={option.erpSku}>{option.erpSku} · {option.erpName}{option.spec ? ` · ${option.spec}` : ''}</option>)}</select></Field> : <h3 className="text-sm font-medium">ECOUNT 商品</h3>}<dl className="mt-2 space-y-1 text-sm">
              <div><dt className="inline text-slate-600">品號：</dt><dd className="inline break-all font-medium">{conflict.erpSku || '尚未選擇'}</dd></div>
              <div><dt className="inline text-slate-600">條碼：</dt><dd className="inline break-all font-medium">{conflict.erpSku ? conflict.erpBarcode || '尚未登錄條碼' : '—'}</dd></div>
              {conflict.erpName && <div><dt className="inline text-slate-600">品名：</dt><dd className="inline">{conflict.erpName}</dd></div>}
              {conflict.spec && <div><dt className="inline text-slate-600">規格：</dt><dd className="inline">{conflict.spec}</dd></div>}
            </dl></div>
          </div>
          {historical && <p className="mt-3 text-sm leading-6 text-slate-700">Shopify 缺少原促銷商品的規格。{canAttestHistoricalLine ? '請核對下列訂單原始商品，再輸入包裝上的實物條碼。' : '請由管理員核對原訂單及包裝條碼。'}</p>}
          {evidenceOrders.length > 0 && <details className="mt-3" open={historical || undefined}><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-slate-800">{`${historical ? '原促銷明細' : '相關訂單'}（${new Set(evidenceOrders.map(order => order.orderNumber)).size} 筆）`}</summary><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className={cell}>訂單</th><th className={cell}>商品</th><th className={cell}>條碼</th><th className={cell}>數量</th></tr></thead><tbody>{evidenceOrders.map((order, index) => {
            const url = shopifyOrderUrl(conflict, order);
            return <tr key={`${order.orderNumber}:${order.sourceLineId || index}`} className="border-t border-slate-100"><td className={`${cell} whitespace-nowrap`}>{url ? <a href={url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 underline">{order.orderNumber}</a> : order.orderNumber}</td><td className={cell}>{order.productName}</td><td className={`${cell} whitespace-nowrap`}>{order.barcode || '未填條碼'}</td><td className={`${cell} whitespace-nowrap`}>{order.quantity}</td></tr>;
          })}</tbody></table></div></details>}
          {!historical && conflict.canEnterInternalScanCode && <div className="mt-3 max-w-md"><Field label="商品識別方式"><select className={inputClass} disabled={locked||!profileId} value={internal?'internal':'international'} onChange={event=>chooseScanCodeType(conflict,event.target.value)}><option value="international">掃描實物條碼</option><option value="internal">無國條：自建內部掃描碼</option></select></Field></div>}
          {internal && <div className="mt-3 max-w-md"><Field label="內部掃描碼" value={settings.skuMappings?.[conflict.sourceSku]?.internalScanCode || conflict.internalScanCode || ''} maxLength={100} disabled={locked||!profileId} placeholder="ITM- 開頭的自建商品識別碼" onChange={event=>{setBarcodeChecks({});mapping(conflict.sourceSku,'internalScanCode',event.target.value);}} onBlur={event=>{if(previewDirty)return checkInternalScanCode(conflict,event.target.value);}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();return checkInternalScanCode(conflict,event.currentTarget.value);}}}/><p className="mt-2 text-sm text-slate-600">確認此商品沒有國際條碼，將此內碼印在商品標籤；同一內碼只對應一個 ECOUNT 品項。</p></div>}
          {canScanPhysicalBarcode && <div className="mt-3 max-w-md"><Field label="實物條碼" value={settings.skuMappings?.[conflict.sourceSku]?.physicalBarcode || conflict.physicalBarcode || ''} maxLength={100} disabled={locked || !profileId} placeholder="掃描商品包裝條碼" onChange={event => { setBarcodeChecks({}); mapping(conflict.sourceSku, 'physicalBarcode', event.target.value); }} onBlur={event => { if (previewDirty) return checkPhysicalBarcode(conflict, event.target.value); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); return checkPhysicalBarcode(conflict, event.currentTarget.value); } }} /></div>}
          {canConfirm && conflict.reviewReason === 'ERP_BARCODE_MISSING' && !canScanPhysicalBarcode && !internal && <p className="mt-3 text-sm leading-6 text-slate-700">商城已提供條碼。請核對上方兩邊是否為同一商品，確認後勾選並保存對照。</p>}
          {(!historical || canAttestHistoricalLine) && <fieldset disabled={locked || previewDirty || !profileId || !canConfirm}>
            <Check checked={barcodeChecks[key]} disabled={historical && (!canConfirm || locked || previewDirty || !profileId)} onChange={value => { if (!locked && !previewDirty && currentPreview()) setBarcodeChecks(current => ({ ...current, [key]: value })); }}>{historical ? '我已核對上列每筆原促銷商品，確認和包裝實物及此 ECOUNT 品項一致' : '已核對實物與 ERP，此商城商品對應此 ECOUNT 品項'}</Check>
            <Button variant="secondary" disabled={!barcodeChecks[key] || !conflict.fingerprint || locked || previewDirty || !profileId || !canConfirm} onClick={() => confirmBarcode(conflict)}>保存商品對照</Button>
          </fieldset>}
          {!canConfirm && profileId && (!historical || canAttestHistoricalLine) && <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2"><p className="text-sm text-amber-950">{conflict.reviewReason === 'SOURCE_LINE_ID_COLLISION' ? '商城商品明細識別重複，請重新匯出原始訂單檔。' : historical && canScanPhysicalBarcode && conflict.physicalBarcode ? '包裝條碼須與上方 ECOUNT 條碼相同' : internal ? '請填寫並核對內部掃描碼' : canScanPhysicalBarcode ? '請掃描實物條碼' : sourceBarcodeMissing ? 'Shopify 商品條碼未填，請補上後重新核對' : chooseTarget && !conflict.selectedErpSku ? '請選擇 ECOUNT 品項' : '商品版本或條碼資料不完整，請核對商城商品設定'}</p>{!canScanPhysicalBarcode && <Button variant="secondary" disabled={locked} onClick={() => refreshPreview()}>重新核對</Button>}</div>}
          {!profileId && <p className="mt-2 text-sm text-amber-950">請先選擇店鋪</p>}
        </div>;
      })}</div></section>}
      {!onlyReimports && (needsStore || storeSetupOpen || choosingStore) && <section className={sectionClass} aria-label="店鋪設定"><h2 className="font-semibold">{matchingProfiles.length ? '確認銷貨店鋪' : '首次店鋪設定'}</h2><fieldset disabled={locked}><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{settingsField('商城店鋪', 'store')}{settingsField('ECOUNT 銷貨客戶編碼', 'customerCode')}{settingsField('ECOUNT 客戶名稱', 'customerName')}</div></fieldset></section>}
      {unresolvedProducts.length > 0 && <details id="product-mapping" className={sectionClass} open><summary className="cursor-pointer font-semibold">待對照商品（{unresolvedProducts.length} 項）</summary>{catalog?.sync?.created_at && <p className="mt-2 text-sm text-slate-600">ECOUNT 主檔更新：{new Date(catalog.sync.created_at).toLocaleString('zh-TW')}</p>}<fieldset disabled={locked}><div className="mt-4 space-y-3">{unresolvedProducts.map(item => {
        const mapped = settings.skuMappings?.[item.sku] || {};
        const issues = catalogMappingIssues.filter(issue => issue.sku === item.sku);
        const sourceMatch = catalog?.products?.[item.sku];
        const masterMatched = sourceMatch?.status === 'matched' && !issues.length;
        const targetCode = String(mapped.erpSku || item.sku).trim();
        const exactActiveTarget = Object.values(catalog?.products || {}).some(result => result.matches?.some(product => product.erp_sku === targetCode && product.active === true));
        const canConfirm = !catalog?.sync || exactActiveTarget && !['inactive', 'ambiguous'].includes(sourceMatch?.status);
        return <div key={item.sku} className="rounded-lg border border-slate-200 p-4"><p className="font-medium">{item.productName} <span className="text-sm text-slate-500">{item.sku}</span></p>{issues.map(issue => <p key={issue.code} className="mt-2 text-sm text-amber-950">{issue.message}</p>)}<div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="ECOUNT 品項編碼" readOnly={masterMatched} value={mapped.erpSku || item.sku} onChange={event => mapping(item.sku, 'erpSku', event.target.value)} /><Field label="ECOUNT 品項名稱" readOnly={masterMatched} value={mapped.erpName || item.productName} onChange={event => mapping(item.sku, 'erpName', event.target.value)} /></div>{!masterMatched && <Check checked={mapped.confirmed && canConfirm} disabled={!canConfirm} onChange={value => mapping(item.sku, 'confirmed', value)}>確認 ECOUNT 品項</Check>}</div>;
      })}</div></fieldset>{previewDirty && <Button className="mt-3" variant="secondary" disabled={locked} onClick={() => refreshPreview()}>核對商品</Button>}</details>}
      <details className={sectionClass}><summary className="cursor-pointer font-semibold">訂單明細{raw.orders.length - reimports.length > prepared.parsed.summary.orderCount ? `・排除 ${raw.orders.length - reimports.length - prepared.parsed.summary.orderCount} 筆` : ''}</summary>
        <div className="mt-4 overflow-x-auto"><table className="min-w-[880px] w-full text-sm" aria-label="來源訂單與金額"><thead className="bg-slate-50"><tr>{['商城訂單', '付款／出貨狀態', '商品金額', '運費', '訂單總額', '本批處理'].map(value => <th key={value} className={`${cell} whitespace-nowrap`}>{value}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{raw.orders.map(order => {
          const choice = prepared.choices.find(value => value.number === order.sourceOrderNumber);
          const reimport = reimports.find(value => value.orderNumber === order.sourceOrderNumber);
          return <tr key={order.sourceOrderNumber}><td className={`${cell} font-medium`}>{order.sourceOrderNumber}</td><td className={`${cell} whitespace-nowrap`}>{statusLabel(order.rawPaymentStatus, order.paymentStatus, paymentLabels)}／{order.cancelled ? '已取消' : statusLabel(order.rawFulfillmentStatus, order.fulfillmentStatus, fulfillmentLabels)}</td><td className={cell}>{money(order.financial.subtotalMinor)}</td><td className={cell}>{money(order.financial.shippingMinor)}</td><td className={cell}>{money(order.financial.totalMinor)}</td><td className={cell}>{reimport ? `已保存 · ${reimportStates[reimport.state] || '待核對'}` : `${choice?.eligible ? '納入' : '排除'} · ${choice?.reason || ''}`}</td></tr>;
        })}</tbody></table></div>
      </details>
      {!onlyReimports && <details className={sectionClass}><summary className="cursor-pointer font-semibold">進階設定與核對表</summary><fieldset disabled={locked}>
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
          return <div key={item.sku} className="rounded-lg border border-slate-200 p-4"><p className="font-medium">{item.productName}</p><p className="mt-1 text-sm text-slate-600">ECOUNT {mapped.erpSku || item.sku}</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label={mapped.scanCodeType==='internal'?'內部掃描碼':'商品掃描條碼'}>{(barcodeTrusted||mapped.scanCodeType==='internal'&&mapped.internalScanConfirmed) ? <span className="mt-1 flex min-h-11 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-950">{mapped.scanCodeType==='internal'?mapped.internalScanCode:mapped.barcode}</span> : <input className={inputClass} value={mapped.barcode || ''} placeholder="待核對" onChange={event => mapping(item.sku, 'barcode', event.target.value)} />}</Field><Field label="商品分類" value={mapped.category || ''} onChange={event => mapping(item.sku, 'category', event.target.value)} /></div>{mapped.scanCodeType!=='internal' && mapped.barcode && !barcodeTrusted && <Check checked={mapped.barcodeConfirmed} onChange={value => mapping(item.sku, 'barcodeConfirmed', value)}>確認實物條碼</Check>}</div>;
        })}</div></details>
      </fieldset><div className="mt-4 flex flex-wrap gap-3">{previewDirty && <Button variant="secondary" disabled={locked} onClick={() => refreshPreview()}>套用設定</Button>}<Button variant="secondary" disabled={locked || previewDirty || readySelectionChanged || !prepared.audit.ok || !prepared.prepick.ok} onClick={() => download('audit')}>下載金額核對表</Button></div>
        {warnings.length > 0 && <details className="mt-4 text-sm text-slate-600"><summary className="cursor-pointer">提醒（{warnings.length}）</summary><ul className="mt-2 space-y-1">{warnings.map((issue, index) => <li key={index}>{issue.orderNumber ? `${issue.orderNumber}：` : ''}{issue.message}</li>)}</ul></details>}
        {catalog?.sync && !unresolvedProducts.length && <p className="mt-4 text-xs text-slate-500">商品對照更新：{new Date(catalog.sync.created_at).toLocaleString('zh-TW')}</p>}
      </details>}
      </details>
    </>}</>}
    <details open={!draftOverwriteOpen} className={draftOverwriteOpen ? 'min-w-0 border-t border-slate-200 py-2' : 'contents'} aria-label="批次歷史區"><summary className={draftOverwriteOpen ? 'min-h-10 cursor-pointer py-2 text-sm font-medium text-slate-600' : 'hidden'}>已保存批次</summary><MarketplaceBatchManager user={user} enabled={access === 'ready'} currentSession={currentSession} refreshKey={records} /></details>
  </main>;
}
