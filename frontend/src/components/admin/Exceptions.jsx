import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, Search, ArrowRight } from 'lucide-react';

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
  };
  return map[type] || type;
};

const statusLabel = (status) => {
  const map = { open: '待核可', ack: '已核可', resolved: '已結案', rejected: '已駁回' };
  return map[status] || status;
};

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

export function Exceptions() {
  const [tab, setTab] = useState('open');
  const [q, setQ] = useState('');
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
  const [createdBy, setCreatedBy] = useState('');
  const [ackBy, setAckBy] = useState('');
  const [resolvedBy, setResolvedBy] = useState('');
  const [type, setType] = useState('');
  const [orderStatus, setOrderStatus] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);

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
    try {
      setLoading(true);
      const res = await apiClient.get('/api/admin/exceptions', {
        params: {
          status: tab,
          q: q || undefined,
          createdBy: createdBy || undefined,
          ackBy: ackBy || undefined,
          resolvedBy: resolvedBy || undefined,
          type: type || undefined,
          orderStatus: orderStatus || undefined,
          overdue: tab === 'open' && overdueOnly ? 1 : undefined,
          page: 1,
          limit: 100,
        },
      });
      setItems(res.data?.items || []);
      setSlaMinutes(res.data?.meta?.slaMinutes || 30);
    } catch (err) {
      toast.error('載入例外總覽失敗', { description: err.response?.data?.message || err.message });
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [tab, q, createdBy, ackBy, resolvedBy, type, orderStatus, overdueOnly]);

  useEffect(() => {
    fetchList();
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
      toast.warning('有例外逾時未核可', {
        description: `目前逾時 ${overdueCount} 筆（SLA ${slaMinutes} 分鐘）`,
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
      <div className="p-6 md:p-8 lg:p-10 max-w-[1600px] mx-auto">
        <PageHeader
          title="例外總覽"
          description={`SLA（時限）：待核可 超過 ${slaMinutes} 分鐘未核可需處理${tab === 'open' ? `（目前逾時 ${overdueCount} 筆）` : ''}`}
          actions={
            <div className="flex items-center gap-2">
              <Button as={Link} to="/admin" variant="secondary">
                返回管理中心
              </Button>
              <Button variant="secondary" onClick={fetchList} disabled={loading}>
                重新整理
              </Button>
            </div>
          }
        />

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4">
            <Card className="border-0 glass-panel">
              <CardHeader>
                <CardTitle className="text-base">狀態</CardTitle>
                <CardDescription>依狀態分頁</CardDescription>
              </CardHeader>
              <CardContent className="flex gap-2 flex-wrap">
                <Button variant={tab === 'open' ? 'primary' : 'secondary'} onClick={() => setTab('open')}>待核可</Button>
                <Button variant={tab === 'ack' ? 'primary' : 'secondary'} onClick={() => setTab('ack')}>已核可</Button>
                <Button variant={tab === 'resolved' ? 'primary' : 'secondary'} onClick={() => setTab('resolved')}>已結案</Button>
              </CardContent>
            </Card>

            <Card className="border-0 glass-panel mt-6">
              <CardHeader>
                <CardTitle className="text-base">搜尋</CardTitle>
                <CardDescription>支援訂單號或訂單 ID</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  label={null}
                  name="q"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="例如：A12345 或 1001"
                  icon={Search}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') fetchList();
                  }}
                />
                <Button variant="primary" className="w-full" onClick={fetchList} disabled={loading}>
                  搜尋
                </Button>
              </CardContent>
            </Card>

            <Card className="border-0 glass-panel mt-6">
              <CardHeader>
                <CardTitle className="text-base">篩選</CardTitle>
                <CardDescription>依任務狀態 / 類型 / 人員</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2.5">任務狀態（訂單狀態）</label>
                  <select
                    value={orderStatus}
                    onChange={(e) => setOrderStatus(e.target.value)}
                    className="w-full font-medium outline-none transition-all duration-200 bg-white/50 backdrop-blur-sm border border-gray-200/60 rounded-xl px-4 py-3.5 text-gray-900"
                  >
                    <option value="">全部</option>
                    <option value="pending">pending</option>
                    <option value="picking">picking</option>
                    <option value="picked">picked</option>
                    <option value="packing">packing</option>
                    <option value="completed">completed</option>
                    <option value="voided">voided</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2.5">例外類型</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="w-full font-medium outline-none transition-all duration-200 bg-white/50 backdrop-blur-sm border border-gray-200/60 rounded-xl px-4 py-3.5 text-gray-900"
                  >
                    <option value="">全部</option>
                    <option value="stockout">缺貨</option>
                    <option value="damage">破損</option>
                    <option value="over_scan">多掃</option>
                    <option value="under_scan">少掃</option>
                    <option value="sn_replace">SN更換</option>
                    <option value="other">其他</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2.5">建立者</label>
                  <select
                    value={createdBy}
                    onChange={(e) => setCreatedBy(e.target.value)}
                    className="w-full font-medium outline-none transition-all duration-200 bg-white/50 backdrop-blur-sm border border-gray-200/60 rounded-xl px-4 py-3.5 text-gray-900"
                  >
                    <option value="">全部</option>
                    {(users || []).map((u) => (
                      <option key={u.id} value={u.id}>{u.name || u.username || u.id}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2.5">核可者</label>
                  <select
                    value={ackBy}
                    onChange={(e) => setAckBy(e.target.value)}
                    className="w-full font-medium outline-none transition-all duration-200 bg-white/50 backdrop-blur-sm border border-gray-200/60 rounded-xl px-4 py-3.5 text-gray-900"
                  >
                    <option value="">全部</option>
                    {(users || []).map((u) => (
                      <option key={u.id} value={u.id}>{u.name || u.username || u.id}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2.5">結案者</label>
                  <select
                    value={resolvedBy}
                    onChange={(e) => setResolvedBy(e.target.value)}
                    className="w-full font-medium outline-none transition-all duration-200 bg-white/50 backdrop-blur-sm border border-gray-200/60 rounded-xl px-4 py-3.5 text-gray-900"
                  >
                    <option value="">全部</option>
                    {(users || []).map((u) => (
                      <option key={u.id} value={u.id}>{u.name || u.username || u.id}</option>
                    ))}
                  </select>
                </div>

                {tab === 'open' && (
                  <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <input
                      type="checkbox"
                      checked={overdueOnly}
                      onChange={(e) => setOverdueOnly(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                    只看逾時
                  </label>
                )}

                <div className="flex gap-2">
                  <Button variant="secondary" className="flex-1" onClick={() => {
                    setCreatedBy('');
                    setAckBy('');
                    setResolvedBy('');
                    setType('');
                    setOrderStatus('');
                    setOverdueOnly(false);
                  }} disabled={loading}>
                    清除
                  </Button>
                  <Button variant="primary" className="flex-1" onClick={fetchList} disabled={loading}>
                    套用
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-8">
            <Card className="border-0 glass-panel">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle size={18} className="text-orange-600" />
                  清單
                </CardTitle>
                <CardDescription>可快速核可 / 結案</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <THead>
                    <TH>訂單</TH>
                    <TH>例外</TH>
                    <TH>狀態</TH>
                    <TH>原因</TH>
                    <TH>建立</TH>
                    <TH>附件</TH>
                    <TH className="text-right">操作</TH>
                  </THead>
                  <TBody>
                    {(items || []).map((row) => (
                      <TR key={row.id} className={row.is_overdue ? 'bg-amber-50/40' : ''}>
                        <TD>
                          <div className="font-bold text-gray-900">{row.voucher_number || `#${row.order_id}`}</div>
                          <div className="text-xs text-gray-500">{row.customer_name || ''}</div>
                          <div className="mt-1">
                            <Link to={`/order/${row.order_id}`} className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline">
                              開啟訂單 <ArrowRight size={12} />
                            </Link>
                          </div>
                        </TD>
                        <TD>
                          <div className="font-bold">{typeLabel(row.type)}</div>
                          <div className="text-xs text-gray-500">{formatTs(row.created_at)}</div>
                        </TD>
                        <TD>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>
                            {row.is_overdue && row.status === 'open' && (
                              <Badge variant="warning">逾時</Badge>
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
                            <Button size="sm" variant="secondary" onClick={() => openDetail(row)} disabled={loading}>
                              查看
                            </Button>
                            {row.status === 'open' && (
                              <Button size="sm" onClick={() => openDetail(row)} disabled={loading}>
                                核可
                              </Button>
                            )}
                            {row.status === 'ack' && (
                              <Button size="sm" onClick={() => openDetail(row)} disabled={loading}>
                                結案
                              </Button>
                            )}
                          </div>
                        </TD>
                      </TR>
                    ))}
                    {!loading && (items || []).length === 0 && (
                      <TR>
                        <TD colSpan={7} className="text-center text-gray-500 py-10">
                          目前沒有資料
                        </TD>
                      </TR>
                    )}
                    {loading && (
                      <TR>
                        <TD colSpan={7} className="text-center text-gray-500 py-10">
                          載入中...
                        </TD>
                      </TR>
                    )}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Modal
        open={detailOpen}
        onClose={closeDetail}
        title="例外詳情"
        footer={
          <>
            <Button variant="secondary" onClick={closeDetail}>關閉</Button>
            {detailRow?.status === 'open' && (
              <Button onClick={submitAck}>
                核可
              </Button>
            )}
            {detailRow?.status === 'ack' && (
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
                    <Badge variant="neutral">{typeLabel(detailRow.type)}</Badge>
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

            {detailRow?.snapshot?.proposal && (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <div className="text-sm font-bold text-gray-900">拋單員處理內容（待審核）</div>
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

            {detailRow?.status === 'open' && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">核可備註（可選）</label>
                <textarea
                  value={ackNote}
                  onChange={(e) => setAckNote(e.target.value)}
                  placeholder="例如：已確認缺貨，允許少出；或已確認破損，需換貨…"
                  className="w-full min-h-[96px] rounded-xl bg-white/70 border border-gray-200 px-4 py-3 text-gray-900 outline-none"
                />
              </div>
            )}

            {detailRow?.status === 'ack' && (
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
