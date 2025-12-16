import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Swal from 'sweetalert2';
import withReactContent from 'sweetalert2-react-content';
import { toast } from 'sonner';
import { AlertTriangle, Search, ArrowRight } from 'lucide-react';

import apiClient from '@/api/api';
import { PageHeader, Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Badge, Input, Table, THead, TH, TBody, TR, TD } from '@/ui';

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
  const map = { open: 'Open', ack: 'Ack', resolved: 'Resolved' };
  return map[status] || status;
};

const statusVariant = (status) => {
  if (status === 'open') return 'warning';
  if (status === 'ack') return 'info';
  if (status === 'resolved') return 'success';
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

export function Exceptions() {
  const MySwal = withReactContent(Swal);

  const [tab, setTab] = useState('open');
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [slaMinutes, setSlaMinutes] = useState(30);

  const overdueCount = useMemo(() => (items || []).filter((x) => x?.is_overdue).length, [items]);

  const [prevOverdueCount, setPrevOverdueCount] = useState(0);

  const fetchList = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/api/admin/exceptions', {
        params: {
          status: tab,
          q: q || undefined,
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
  }, [tab, q]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

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

  const handleAck = async (row) => {
    const { value: note } = await MySwal.fire({
      title: '主管核可',
      input: 'textarea',
      inputLabel: '核可備註（可選）',
      inputPlaceholder: '例如：已確認缺貨，允許少出；或已確認破損，需換貨…',
      showCancelButton: true,
      confirmButtonText: '核可',
      cancelButtonText: '取消',
    });

    try {
      await apiClient.patch(`/api/orders/${row.order_id}/exceptions/${row.id}/ack`, { note: note || null });
      toast.success('已核可');
      fetchList();
    } catch (err) {
      toast.error('核可失敗', { description: err.response?.data?.message || err.message });
    }
  };

  const handleResolve = async (row) => {
    const { value } = await MySwal.fire({
      title: '結案',
      html: `
        <div style="text-align:left">
          <label style="display:block;font-size:12px;margin-bottom:6px;color:#6b7280">處置類型（必填）</label>
          <select id="resolution-action" class="swal2-input" style="margin:0 0 12px 0;width:100%">
            <option value="short_ship">少出</option>
            <option value="restock">補貨</option>
            <option value="exchange">換貨</option>
            <option value="void">作廢</option>
            <option value="other">其他</option>
          </select>

          <label style="display:block;font-size:12px;margin-bottom:6px;color:#6b7280">結案備註（可選）</label>
          <textarea id="resolution-note" class="swal2-textarea" placeholder="例如：已補貨完成；已更換新品；已調整數量…" style="margin:0;width:100%"></textarea>
        </div>
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: '結案',
      cancelButtonText: '取消',
      preConfirm: () => {
        const resolutionAction = document.getElementById('resolution-action')?.value;
        const note = document.getElementById('resolution-note')?.value;
        if (!resolutionAction) {
          MySwal.showValidationMessage('請選擇處置類型');
          return null;
        }
        return { resolutionAction, note: note ? String(note).trim() : '' };
      },
    });

    if (!value) return;

    try {
      await apiClient.patch(`/api/orders/${row.order_id}/exceptions/${row.id}/resolve`, {
        resolutionAction: value.resolutionAction,
        note: value.note || null,
      });
      toast.success('已結案');
      fetchList();
    } catch (err) {
      toast.error('結案失敗', { description: err.response?.data?.message || err.message });
    }
  };

  return (
    <div className="min-h-screen bg-transparent pb-20">
      <div className="p-6 md:p-8 lg:p-10 max-w-[1600px] mx-auto">
        <PageHeader
          title="例外總覽"
          description={`SLA：Open 超過 ${slaMinutes} 分鐘未核可需處理${tab === 'open' ? `（目前逾時 ${overdueCount} 筆）` : ''}`}
          actions={
            <Button variant="secondary" onClick={fetchList} disabled={loading}>
              重新整理
            </Button>
          }
        />

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4">
            <Card className="border-0 glass-panel">
              <CardHeader>
                <CardTitle className="text-base">狀態</CardTitle>
                <CardDescription>依 open / ack / resolved 分頁</CardDescription>
              </CardHeader>
              <CardContent className="flex gap-2 flex-wrap">
                <Button variant={tab === 'open' ? 'primary' : 'secondary'} onClick={() => setTab('open')}>Open</Button>
                <Button variant={tab === 'ack' ? 'primary' : 'secondary'} onClick={() => setTab('ack')}>Ack</Button>
                <Button variant={tab === 'resolved' ? 'primary' : 'secondary'} onClick={() => setTab('resolved')}>Resolved</Button>
              </CardContent>
            </Card>

            <Card className="border-0 glass-panel mt-6">
              <CardHeader>
                <CardTitle className="text-base">搜尋</CardTitle>
                <CardDescription>支援訂單號（voucher）或訂單 ID</CardDescription>
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
                            {row.status === 'open' && (
                              <Button size="sm" onClick={() => handleAck(row)} disabled={loading}>
                                核可
                              </Button>
                            )}
                            {row.status === 'ack' && (
                              <Button size="sm" onClick={() => handleResolve(row)} disabled={loading}>
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
    </div>
  );
}

export default Exceptions;
