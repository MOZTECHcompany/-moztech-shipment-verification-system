import {isDeletionRequest} from '@/utils/orderChangePresentation';
import {isWarehouseAdmin} from '@/utils/managementScope';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, Search, ArrowRight, SlidersHorizontal, ChevronDown } from 'lucide-react';

import apiClient from '@/api/api';
import { socket } from '@/api/socket';
import { PageHeader, Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Badge, Input, Table, THead, TH, TBody, TR, TD, Modal } from '@/ui';

const typeLabel = (type) => {
  const map = {
    stockout: '缺貨',
    damage: '破損',
    over_scan: '多掃',
    under_scan: '少掃',
    sn_replace: 'SN更換',
    other: '其他',
    order_change: '訂單異動',
    order_delete: '刪除申請',
  };
  return map[type] || type;
};

const statusLabel = (status) => {
  const map = { open: '待核可', ack: '已核可', resolved: '已結案', rejected: '已駁回' };
  return map[status] || status;
};

const orderStatusLabels = {
  pending: '待揀貨', picking: '揀貨中', picked: '待裝箱',
  packing: '裝箱中', completed: '已完成', voided: '已作廢',
};
const emptyFilters = { q: '', orderStatus: '', type: '', createdBy: '', ackBy: '', resolvedBy: '', overdueOnly: false };
const pageSize = 100;

function FilterSelect({ id, label, value, onChange, children }) {
  return <div className="min-w-0">
    <label htmlFor={id} className="block text-sm font-semibold text-gray-700 mb-2.5">{label}</label>
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-4 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500">
      <option value="">全部</option>
      {children}
    </select>
  </div>;
}

const statusVariant = (status) => {
  if (status === 'open') return 'warning';
  if (status === 'ack') return 'info';
  if (status === 'resolved') return 'success';
  if (status === 'rejected') return 'danger';
  return 'neutral';
};

function formatTs(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  } catch {
    return String(ts);
  }
}

function toMultilineSnText(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.filter(Boolean).map(String).join('\n');
  return String(value);
}

function renderSnBlock(label, snText) {
  const text = toMultilineSnText(snText).trim();
  if (!text) return null;
  const count = text.split(/\r?\n/).filter((x) => x.trim().length > 0).length;
  return (
    <div className="text-sm text-gray-700 mt-2">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-gray-800">{label}（共 {count}）</div>
        <Button
          size="xs"
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              toast.success('已複製');
            } catch (e) {
              toast.error('複製失敗');
            }
          }}
        >
          複製
        </Button>
      </div>
      <div className="mt-1 rounded-lg border border-gray-200 bg-white/70 p-2 whitespace-pre-wrap break-words max-h-48 overflow-auto">
        {text}
      </div>
    </div>
  );
}

export function Exceptions({user}) {
  const canReview=isWarehouseAdmin(user);
  const [tab, setTab] = useState('open');
  const [filters, setFilters] = useState(() => ({ ...emptyFilters, type: new URLSearchParams(window.location.search).get('type') || '' }));
  const [draft, setDraft] = useState(filters);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [listError, setListError] = useState('');
  const requestSequence = useRef(0);
  const setFilter = (key, value) => setDraft((previous) => ({ ...previous, [key]: value }));
  const hasUnappliedFilters = JSON.stringify(draft) !== JSON.stringify(filters);
  const hasFilters = Object.entries(filters).some(([key, value]) => value && (key !== 'overdueOnly' || tab === 'open'));
  const applyFilters = (event) => {
    event.preventDefault();
    setPage(1);
    setFilters({ ...draft, q: draft.q.trim() });
    setDraft((previous) => ({ ...previous, q: previous.q.trim() }));
  };
  const clearFilters = () => {
    setDraft({ ...emptyFilters });
    setFilters({ ...emptyFilters });
    setPage(1);
  };
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [slaMinutes, setSlaMinutes] = useState(30);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRow, setDetailRow] = useState(null);
  const [detailAttachmentsLoading, setDetailAttachmentsLoading] = useState(false);
  const [detailAttachments, setDetailAttachments] = useState([]);

  const [ackNote, setAckNote] = useState('');
  const [resolveAction, setResolveAction] = useState('short_ship');
  const [resolveNote, setResolveNote] = useState('');

  const [attachmentPreviewOpen, setAttachmentPreviewOpen] = useState(false);
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState('');
  const [attachmentPreviewName, setAttachmentPreviewName] = useState('');
  const [attachmentPreviewMime, setAttachmentPreviewMime] = useState('');

  const [users, setUsers] = useState([]);
  const overdueCount = useMemo(() => (items || []).filter((x) => x?.is_overdue).length, [items]);

  const [prevOverdueCount, setPrevOverdueCount] = useState(0);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await apiClient.get('/api/users/basic');
        setUsers(res.data || []);
      } catch (err) {
        setUsers([]);
      }
    };
    fetchUsers();
  }, []);

  const fetchList = useCallback(async () => {
    const requestId = ++requestSequence.current;
    try {
      setLoading(true);
      setListError('');
      const res = await apiClient.get('/api/admin/exceptions', {
        params: {
          status: tab,
          q: filters.q || undefined,
          createdBy: filters.createdBy || undefined,
          ackBy: filters.ackBy || undefined,
          resolvedBy: filters.resolvedBy || undefined,
          type: filters.type || undefined,
          orderStatus: filters.orderStatus || undefined,
          overdue: tab === 'open' && filters.overdueOnly ? 1 : undefined,
          page,
          limit: pageSize,
        },
      });
      if (requestId !== requestSequence.current) return;
      setItems(res.data?.items || []);
      setSlaMinutes(res.data?.meta?.slaMinutes || 30);
    } catch (err) {
      if (requestId !== requestSequence.current) return;
      setListError('無法載入案件，請重新整理或稍後重試。');
      setItems([]);
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [tab, filters, page]);

  useEffect(() => {
    fetchList();
    return () => { requestSequence.current += 1; };
  }, [fetchList]);

  // 即時提醒：有新例外建立/狀態變更時，自動刷新清單
  useEffect(() => {
    const handleChanged = (data) => {
      // 避免把所有事件都 toast（只在 open 分頁提示新建）
      if (tab === 'open' && String(data?.action) === 'created') {
        const voucher = data?.voucherNumber ? String(data.voucherNumber) : null;
        const orderText = voucher ? `訂單 ${voucher}` : (data?.orderId ? `訂單 #${data.orderId}` : '');
        const isOrderChange = String(data?.type) === 'order_change';
        toast.info(isOrderChange ? '有新的訂單異動待核可' : '有新的例外待核可', {
          description: orderText || undefined,
          duration: 4000,
        });
      }

      // 無論在哪個分頁，都更新資料（避免同頁不同狀態切換後仍顯示舊資料）
      fetchList();
    };

    socket.on('order_exception_changed', handleChanged);
    return () => {
      socket.off('order_exception_changed', handleChanged);
    };
  }, [fetchList, tab]);

  useEffect(() => {
    if (tab !== 'open') return;
    const id = setInterval(() => {
      fetchList();
    }, 60000);
    return () => clearInterval(id);
  }, [tab, fetchList]);

  useEffect(() => {
    if (tab !== 'open') return;
    if (overdueCount > prevOverdueCount) {
      toast.warning('有案件等待審核過久', {
        description: `本頁有 ${overdueCount} 筆已等待超過 ${slaMinutes} 分鐘`,
        duration: 4000,
      });
    }
    setPrevOverdueCount(overdueCount);
  }, [tab, overdueCount, prevOverdueCount, slaMinutes]);

  const openDetail = useCallback(async (row) => {
    setDetailRow(row);
    setDetailOpen(true);
    setAckNote('');
    setResolveAction('short_ship');
    setResolveNote('');
    setDetailAttachments([]);

    if (!row?.order_id || !row?.id) return;
    try {
      setDetailAttachmentsLoading(true);
      const res = await apiClient.get(`/api/orders/${row.order_id}/exceptions/${row.id}/attachments`);
      setDetailAttachments(res.data?.items || []);
    } catch (err) {
      setDetailAttachments([]);
      toast.error('載入附件失敗', { description: err.response?.data?.message || err.message });
    } finally {
      setDetailAttachmentsLoading(false);
    }
  }, []);

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setDetailRow(null);
    setDetailAttachments([]);
    setAckNote('');
    setResolveNote('');
  }, []);

  const downloadAttachment = useCallback(async (row, att) => {
    if (!row?.order_id || !row?.id || !att?.id) return;
    try {
      const res = await apiClient.get(
        `/api/orders/${row.order_id}/exceptions/${row.id}/attachments/${att.id}/download`,
        { responseType: 'blob' }
      );
      const blob = new Blob([res.data], { type: att.mime_type || 'application/octet-stream' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = att.original_name || `attachment-${att.id}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      toast.error('下載附件失敗', { description: err.response?.data?.message || err.message });
    }
  }, []);

  const previewAttachment = useCallback(async (row, att) => {
    if (!row?.order_id || !row?.id || !att?.id) return;
    try {
      const res = await apiClient.get(
        `/api/orders/${row.order_id}/exceptions/${row.id}/attachments/${att.id}/download?inline=1`,
        { responseType: 'blob' }
      );
      const blob = new Blob([res.data], { type: att.mime_type || 'application/octet-stream' });
      const url = window.URL.createObjectURL(blob);
      setAttachmentPreviewUrl(url);
      setAttachmentPreviewMime(att.mime_type || '');
      setAttachmentPreviewName(att.original_name || `attachment-${att.id}`);
      setAttachmentPreviewOpen(true);
    } catch (err) {
      toast.error('預覽附件失敗', { description: err.response?.data?.message || err.message });
    }
  }, []);

  const submitAck = useCallback(async () => {
    if (!detailRow?.order_id || !detailRow?.id) return;
    try {
      await apiClient.patch(`/api/orders/${detailRow.order_id}/exceptions/${detailRow.id}/ack`, {
        note: ackNote ? String(ackNote).trim() : null,
      });
      toast.success('已核可');
      closeDetail();
      fetchList();
    } catch (err) {
      toast.error('核可失敗', { description: err.response?.data?.message || err.message });
    }
  }, [ackNote, closeDetail, detailRow?.id, detailRow?.order_id, fetchList]);

  const submitReject = async () => {
    if(!ackNote.trim()){toast.error('請填寫駁回原因');return;}
    try{await apiClient.patch(`/api/orders/${detailRow.order_id}/exceptions/${detailRow.id}/reject`,{note:ackNote.trim()});toast.success('已駁回');closeDetail();fetchList();}
    catch(error){toast.error(error.response?.data?.message || '駁回失敗');}
  };

  const submitResolve = useCallback(async () => {
    if (!detailRow?.order_id || !detailRow?.id) return;
    try {
      await apiClient.patch(`/api/orders/${detailRow.order_id}/exceptions/${detailRow.id}/resolve`, {
        resolutionAction: resolveAction,
        note: resolveNote ? String(resolveNote).trim() : null,
      });
      toast.success('已結案');
      closeDetail();
      fetchList();
    } catch (err) {
      toast.error('結案失敗', { description: err.response?.data?.message || err.message });
    }
  }, [closeDetail, detailRow?.id, detailRow?.order_id, fetchList, resolveAction, resolveNote]);

  return (
    <div className="min-h-screen bg-transparent pb-20">
      <div className="p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto">
        <PageHeader
          title="例外總覽"
          description={canReview ? '查看異動與異常申請，確認內容後核可、駁回或結案。' : '查看異動與異常申請，追蹤主管的審核結果。'}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button as={Link} to="/admin" variant="secondary">
                返回管理中心
              </Button>
              <Button variant="secondary" onClick={fetchList} disabled={loading}>
                重新整理
              </Button>
            </div>
          }
        />

        <div className="mt-6 space-y-5">
          <Card>
            <CardContent>
              <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 pb-4">
                <span className="text-sm font-semibold text-gray-700">審核進度</span>
                <div className="flex flex-wrap gap-2" role="group" aria-label="審核進度">
                  {['open', 'ack', 'rejected', 'resolved'].map((status) => (
                    <Button key={status} size="sm" aria-pressed={tab === status}
                      variant={tab === status ? 'primary' : 'secondary'}
                      onClick={() => { setTab(status); setPage(1); }}>
                      {statusLabel(status)}
                    </Button>
                  ))}
                </div>
              </div>
              <form onSubmit={applyFilters} aria-label="查詢案件" className="pt-4 space-y-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="text-base font-semibold text-gray-900">查詢條件</h2>
                  <p className="text-xs text-gray-500">只篩選清單，不會修改訂單。</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4">
                  <Input label="訂單號碼或 ID" name="exception-search" value={draft.q}
                    onChange={(event) => setFilter('q', event.target.value)}
                    placeholder="輸入訂單號碼或 ID" icon={Search} />
                  <FilterSelect id="exception-order-status" label="訂單作業進度" value={draft.orderStatus} onChange={(value) => setFilter('orderStatus', value)}>
                    {Object.entries(orderStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </FilterSelect>
                  <FilterSelect id="exception-type" label="申請類型" value={draft.type} onChange={(value) => setFilter('type', value)}>
                    {['order_change', 'order_delete', 'stockout', 'damage', 'over_scan', 'under_scan', 'sn_replace', 'other'].map((value) => <option key={value} value={value}>{typeLabel(value)}</option>)}
                  </FilterSelect>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-4">
                    <Button type="button" size="sm" variant="ghost" leadingIcon={SlidersHorizontal} trailingIcon={ChevronDown}
                      aria-expanded={peopleOpen} aria-controls="exception-people-filters" onClick={() => setPeopleOpen((open) => !open)}>
                      人員篩選{[draft.createdBy, draft.ackBy, draft.resolvedBy].filter(Boolean).length > 0 ? `（${[draft.createdBy, draft.ackBy, draft.resolvedBy].filter(Boolean).length}）` : ''}
                    </Button>
                    {tab === 'open' && <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={draft.overdueOnly} onChange={(event) => setFilter('overdueOnly', event.target.checked)} className="w-4 h-4 rounded border-gray-300" />
                      只看等待超過 {slaMinutes} 分鐘
                    </label>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {hasUnappliedFilters && <span className="text-xs text-amber-700" role="status">條件已變更，請按查詢</span>}
                    <Button type="button" size="sm" variant="secondary" onClick={clearFilters}>清除條件</Button>
                    <Button type="submit" size="sm" leadingIcon={Search}>查詢</Button>
                  </div>
                </div>
                {peopleOpen && <div id="exception-people-filters" className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-gray-100 pt-4">
                  {[['createdBy', '申請人'], ['ackBy', '核可人'], ['resolvedBy', '結案人']].map(([key, label]) => (
                    <FilterSelect key={key} id={`exception-${key}`} label={label} value={draft[key]} onChange={(value) => setFilter(key, value)}>
                      {users.map((person) => <option key={person.id} value={person.id}>{person.name || person.username || person.id}</option>)}
                    </FilterSelect>
                  ))}
                </div>}
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle size={18} className="text-orange-600" />
                  {statusLabel(tab)}案件
                </CardTitle>
                <span className="text-xs text-gray-500" role="status">{loading ? '查詢中…' : listError ? '載入失敗' : `第 ${page} 頁 · 本頁 ${items.length} 筆`}</span>
              </div>
              <CardDescription>{tab === 'open' ? (canReview ? '點選「查看並審核」，確認申請內容後再決定。' : '點選「查看詳情」追蹤申請；由倉儲主管審核。') : tab === 'ack' ? '確認處理完成後，可開啟案件結案。' : '查看申請內容與處理紀錄。'}</CardDescription>
              {hasFilters && <div className="flex flex-wrap gap-2 pt-2 text-xs text-gray-600" aria-label="已套用條件">
                {filters.q && <Badge variant="neutral">訂單：{filters.q}</Badge>}
                {filters.orderStatus && <Badge variant="neutral">{orderStatusLabels[filters.orderStatus] || '其他作業進度'}</Badge>}
                {filters.type && <Badge variant="neutral">{typeLabel(filters.type)}</Badge>}
                {[['createdBy', '申請人'], ['ackBy', '核可人'], ['resolvedBy', '結案人']].map(([key, label]) => filters[key] && <Badge key={key} variant="neutral">{label}：{users.find((person) => String(person.id) === String(filters[key]))?.name || filters[key]}</Badge>)}
                {tab === 'open' && filters.overdueOnly && <Badge variant="warning">等待超過 {slaMinutes} 分鐘</Badge>}
              </div>}
            </CardHeader>
            <CardContent>
              <div aria-busy={loading}>
                {!loading && !listError && items.length > 0 && <>
                <div className="space-y-3 md:hidden">
                  {items.map((row) => <article key={row.id} className="rounded-xl border border-gray-200 p-4 space-y-3">
                    <div className="flex flex-wrap justify-between gap-2">
                      <Link to={`/order/${row.order_id}`} className="font-bold text-blue-700 break-words">{row.voucher_number || `#${row.order_id}`}</Link>
                      <Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>
                    </div>
                    <p className="text-sm text-gray-600">{row.customer_name} · {orderStatusLabels[row.order_status] || '其他作業進度'}</p>
                    <p className="text-sm font-semibold">{isDeletionRequest(row) ? '刪除訂單' : typeLabel(row.type)}{row.is_overdue && row.status === 'open' ? ' · 等待超時' : ''}</p>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap break-words line-clamp-3">{row.reason_text}</p>
                    <p className="text-xs text-gray-500">{row.created_by_name || '-'} · {formatTs(row.created_at)} · 附件 {row.attachment_count || 0}</p>
                    <Button size="sm" className="w-full" onClick={() => openDetail(row)}>
                      {canReview && row.status === 'open' ? '查看並審核' : canReview && row.status === 'ack' ? '查看並結案' : '查看詳情'}
                    </Button>
                  </article>)}
                </div>
                <div className="hidden md:block">
                <Table>
                  <THead>
                    <TH>訂單</TH>
                    <TH>申請類型／時間</TH>
                    <TH>審核進度</TH>
                    <TH>申請原因</TH>
                    <TH>申請人</TH>
                    <TH>附件</TH>
                    <TH className="text-right">操作</TH>
                  </THead>
                  <TBody>
                    {(!loading && !listError ? items : []).map((row) => (
                      <TR key={row.id} className={row.is_overdue ? 'bg-amber-50/40' : ''}>
                        <TD>
                          <div className="font-bold text-gray-900">{row.voucher_number || `#${row.order_id}`}</div>
                          <div className="text-xs text-gray-500">{row.customer_name || ''}</div>
                          <div className="mt-1 text-xs text-gray-500">{orderStatusLabels[row.order_status] || '其他作業進度'}</div>
                          <div className="mt-1">
                            <Link to={`/order/${row.order_id}`} className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline">
                              開啟訂單 <ArrowRight size={12} />
                            </Link>
                          </div>
                        </TD>
                        <TD>
                          <div className="font-bold">{isDeletionRequest(row) ? '刪除訂單' : typeLabel(row.type)}</div>
                          <div className="text-xs text-gray-500">{formatTs(row.created_at)}</div>
                        </TD>
                        <TD>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>
                            {row.is_overdue && row.status === 'open' && (
                              <Badge variant="warning">等待超時</Badge>
                            )}
                          </div>
                        </TD>
                        <TD className="max-w-[420px]">
                          <div className="text-sm text-gray-800 line-clamp-2">{row.reason_text}</div>
                        </TD>
                        <TD>
                          <div className="text-sm">{row.created_by_name || row.created_by || '-'}</div>
                        </TD>
                        <TD>
                          <Badge variant="neutral">{row.attachment_count || 0}</Badge>
                        </TD>
                        <TD className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant={canReview && ['open', 'ack'].includes(row.status) ? 'primary' : 'secondary'} className="whitespace-nowrap" onClick={() => openDetail(row)} disabled={loading}>
                              {canReview && row.status === 'open' ? '查看並審核' : canReview && row.status === 'ack' ? '查看並結案' : '查看詳情'}
                            </Button>
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                </div>
                </>}
                {!loading && !listError && items.length === 0 && <div className="text-center text-gray-500 px-4 py-10">
                  <p className="font-semibold text-gray-800">{hasFilters ? '沒有符合條件的案件' : `目前沒有${statusLabel(tab)}案件`}</p>
                  <p className="text-sm mt-1">{hasFilters ? '請調整查詢條件，或清除條件查看全部。' : page > 1 ? '請返回上一頁查看案件。' : '可切換上方審核進度，查看其他案件。'}</p>
                  {hasFilters && <Button size="sm" variant="secondary" className="mt-4" onClick={clearFilters}>清除條件，查看全部</Button>}
                </div>}
                {listError && <div className="px-4 py-10 text-center">
                  <p role="alert" className="text-sm text-red-700">{listError}</p>
                  <Button size="sm" variant="secondary" className="mt-3" onClick={fetchList}>重試</Button>
                </div>}
                {loading && <div className="text-center text-gray-500 py-10">正在查詢案件…</div>}
              </div>
              {(page > 1 || items.length === pageSize) && <div className="mt-4 flex flex-wrap justify-end items-center gap-3">
                <Button size="sm" variant="secondary" disabled={loading || page === 1} onClick={() => setPage((current) => current - 1)}>上一頁</Button>
                <span className="text-sm text-gray-600">第 {page} 頁</span>
                <Button size="sm" variant="secondary" disabled={loading || !!listError || items.length < pageSize} onClick={() => setPage((current) => current + 1)}>下一頁</Button>
              </div>}
            </CardContent>
          </Card>
        </div>
      </div>

      <Modal
        open={detailOpen}
        onClose={closeDetail}
        title="申請詳情"
        footer={
          <>
            <Button variant="secondary" onClick={closeDetail}>關閉</Button>
            {canReview && detailRow?.status === 'open' && (
              <>
              <Button variant="danger" onClick={submitReject}>駁回</Button>
              <Button onClick={submitAck}>{isDeletionRequest(detailRow) ? '核准刪除並作廢' : '核可'}</Button>
              </>
            )}
            {canReview && detailRow?.status === 'ack' && (
              <Button onClick={submitResolve}>
                結案
              </Button>
            )}
          </>
        }
      >
        {!detailRow ? (
          <div className="text-sm text-gray-500">尚未選取資料</div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 bg-white/60 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold text-gray-900">{detailRow.voucher_number || `#${detailRow.order_id}`}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{detailRow.customer_name || ''}</div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <Badge variant={statusVariant(detailRow.status)}>{statusLabel(detailRow.status)}</Badge>
                    <Badge variant="neutral">{isDeletionRequest(detailRow) ? '刪除訂單' : typeLabel(detailRow.type)}</Badge>
                    <Badge variant="neutral">附件 {detailRow.attachment_count || 0}</Badge>
                  </div>
                </div>
                <div className="flex-shrink-0">
                  <Link to={`/order/${detailRow.order_id}`} className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline">
                    開啟訂單 <ArrowRight size={12} />
                  </Link>
                </div>
              </div>

              <div className="text-sm text-gray-800 mt-3 whitespace-pre-wrap break-words">{detailRow.reason_text}</div>
            </div>

            {detailRow.status !== 'open' && <div className="rounded-xl bg-gray-50 p-3 text-sm text-gray-700 space-y-1">
              {detailRow.ack_at && <p>核可：{detailRow.ack_by_name || '主管'} · {formatTs(detailRow.ack_at)}{detailRow.ack_note ? ` · ${detailRow.ack_note}` : ''}</p>}
              {detailRow.rejected_at && <p>駁回：{detailRow.rejected_by_name || '主管'} · {formatTs(detailRow.rejected_at)}{detailRow.rejected_note ? ` · ${detailRow.rejected_note}` : ''}</p>}
              {detailRow.resolved_at && <p>結案：{detailRow.resolved_by_name || '主管'} · {formatTs(detailRow.resolved_at)}{detailRow.resolution_note ? ` · ${detailRow.resolution_note}` : ''}</p>}
            </div>}
            {isDeletionRequest(detailRow) && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">核准後訂單將作廢並停止出貨，品項、SN、留言與異動紀錄全部保留。</div>}
            {!isDeletionRequest(detailRow) && detailRow?.snapshot?.proposal && (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="text-sm font-bold text-gray-900">異動內容（{detailRow.status==='open'?'待審核':detailRow.status==='rejected'?'已駁回':'已核可'}）</div>
                {String(detailRow?.type) === 'order_change' && Array.isArray(detailRow.snapshot.proposal?.items) ? (
                  <>
                    <div className="text-sm text-gray-700 mt-2 whitespace-pre-wrap break-words">異動原因：{detailRow.snapshot.proposal?.note || '-'}</div>

                    <div className="mt-3 space-y-3">
                      {(detailRow.snapshot.proposal.items || []).map((it, idx) => {
                        const qty = Number(it?.quantityChange);
                        const hasSn = !it?.noSn;
                        const title = `${it?.productName || '-'}（${it?.barcode || '-'}）`;
                        return (
                          <div key={`${it?.barcode || 'item'}-${idx}`} className="rounded-xl border border-gray-200 bg-white/60 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-bold text-gray-900 break-words">{title}</div>
                                <div className="text-xs text-gray-600 mt-1">
                                  數量異動：<span className="font-semibold">{Number.isFinite(qty) ? (qty > 0 ? `+${qty}` : String(qty)) : '-'}</span>
                                  {hasSn ? <span className="ml-2">（有 SN）</span> : <span className="ml-2">（無 SN）</span>}
                                </div>
                              </div>
                            </div>

                            {hasSn && qty > 0 && renderSnBlock('新增 SN 清單', it?.snList)}
                            {hasSn && qty < 0 && renderSnBlock('移除 SN 清單', it?.removedSnList)}
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-sm text-gray-700 mt-2">處理方式：{detailRow.snapshot.proposal?.resolutionAction || '-'}</div>
                    {detailRow.snapshot.proposal?.newSn && (
                      <div className="text-sm text-gray-700 whitespace-pre-wrap break-words">異動 SN：{toMultilineSnText(detailRow.snapshot.proposal.newSn)}</div>
                    )}
                    {detailRow.snapshot.proposal?.correctBarcode && (
                      <div className="text-sm text-gray-700">正確條碼：{detailRow.snapshot.proposal.correctBarcode}</div>
                    )}
                    {detailRow.snapshot.proposal?.note && (
                      <div className="text-sm text-gray-700 whitespace-pre-wrap break-words">備註：{detailRow.snapshot.proposal.note}</div>
                    )}
                  </>
                )}
              </div>
            )}

            {canReview && detailRow?.status === 'open' && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">審核備註（駁回時必填）</label>
                <textarea
                  value={ackNote}
                  onChange={(e) => setAckNote(e.target.value)}
                  placeholder="例如：已確認缺貨，允許少出；或已確認破損，需換貨…"
                  className="w-full min-h-[96px] rounded-xl bg-white/70 border border-gray-200 px-4 py-3 text-gray-900 outline-none"
                />
              </div>
            )}

            {canReview && detailRow?.status === 'ack' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">處置類型（必填）</label>
                  <select
                    value={resolveAction}
                    onChange={(e) => setResolveAction(e.target.value)}
                    className="w-full font-medium outline-none transition-all duration-200 bg-white/50 backdrop-blur-sm border border-gray-200/60 rounded-xl px-4 py-3.5 text-gray-900"
                  >
                    <option value="short_ship">少出</option>
                    <option value="restock">補貨</option>
                    <option value="exchange">換貨</option>
                    <option value="void">作廢</option>
                    <option value="other">其他</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">結案備註（可選）</label>
                  <textarea
                    value={resolveNote}
                    onChange={(e) => setResolveNote(e.target.value)}
                    placeholder="例如：已補貨完成；已更換新品；已調整數量…"
                    className="w-full min-h-[96px] rounded-xl bg-white/70 border border-gray-200 px-4 py-3 text-gray-900 outline-none"
                  />
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between">
                <div className="text-sm font-bold text-gray-900">附件</div>
                {detailAttachmentsLoading && <div className="text-xs text-gray-500">載入中…</div>}
              </div>
              {(detailAttachments || []).length === 0 && !detailAttachmentsLoading && (
                <div className="text-sm text-gray-500 mt-2">無附件</div>
              )}
              {(detailAttachments || []).length > 0 && (
                <div className="mt-2 space-y-2">
                  {(detailAttachments || []).map((att) => (
                    <div key={att.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white/60 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm text-gray-900 truncate">{att.original_name || `attachment-${att.id}`}</div>
                        <div className="text-xs text-gray-500">{att.mime_type || ''}</div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Button size="sm" variant="secondary" onClick={() => previewAttachment(detailRow, att)}>
                          預覽
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => downloadAttachment(detailRow, att)}>
                          下載
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={attachmentPreviewOpen}
        onClose={() => {
          if (attachmentPreviewUrl) {
            try { window.URL.revokeObjectURL(attachmentPreviewUrl); } catch { /* ignore */ }
          }
          setAttachmentPreviewOpen(false);
          setAttachmentPreviewUrl('');
          setAttachmentPreviewName('');
          setAttachmentPreviewMime('');
        }}
        title={attachmentPreviewName ? `附件預覽：${attachmentPreviewName}` : '附件預覽'}
        footer={<Button variant="secondary" onClick={() => {
          if (attachmentPreviewUrl) {
            try { window.URL.revokeObjectURL(attachmentPreviewUrl); } catch { /* ignore */ }
          }
          setAttachmentPreviewOpen(false);
          setAttachmentPreviewUrl('');
          setAttachmentPreviewName('');
          setAttachmentPreviewMime('');
        }}>關閉</Button>}
      >
        {!attachmentPreviewUrl ? (
          <div className="text-sm text-gray-500">尚未載入預覽內容</div>
        ) : (
          <div className="w-full">
            {String(attachmentPreviewMime || '').startsWith('image/') && (
              <img
                src={attachmentPreviewUrl}
                alt={attachmentPreviewName || 'attachment'}
                className="w-full max-h-[70vh] object-contain rounded-xl border border-gray-200"
              />
            )}
            {String(attachmentPreviewMime || '').toLowerCase() === 'application/pdf' && (
              <iframe
                title={attachmentPreviewName || 'pdf'}
                src={attachmentPreviewUrl}
                className="w-full h-[70vh] rounded-xl border border-gray-200"
              />
            )}
            {!String(attachmentPreviewMime || '').startsWith('image/') && String(attachmentPreviewMime || '').toLowerCase() !== 'application/pdf' && (
              <div className="text-sm text-gray-600">此附件格式不支援內嵌預覽（{attachmentPreviewMime || 'unknown'}），請改用下載。</div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

export default Exceptions;
