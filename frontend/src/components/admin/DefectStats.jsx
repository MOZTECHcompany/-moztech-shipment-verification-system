import React, { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '@/api/api';
import { PageHeader, Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Table, THead, TH, TBody, TR, TD, EmptyState, Skeleton } from '@/ui';
import { ArrowLeft, AlertTriangle, Download } from 'lucide-react';
import { toast } from 'sonner';
import { defectRows, defectCsv } from '../../utils/defectReport';

export function DefectStats() {
    const [stats, setStats] = useState([]);
    const [loading, setLoading] = useState(true);

    const [error, setError] = useState(false);
    const [page, setPage] = useState(1);
    const rows = useMemo(() => defectRows(stats), [stats]);
    const pageSize = 50;
    const visibleRows = rows.slice((page - 1) * pageSize, page * pageSize);

    useEffect(() => {
        fetchStats();
    }, []);

    const fetchStats = async () => {
        setLoading(true); setError(false);
        try {
            const res = await apiClient.get('/api/admin/defects/stats');
            setStats(res.data); setPage(1);
        } catch (error) {
            setError(true);
            toast.error('無法載入新品不良統計');
        } finally {
            setLoading(false);
        }
    };

    const handleExport = () => {
        const csvContent = defectCsv(rows);

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `defect_report_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="p-6 md:p-8 max-w-7xl mx-auto min-h-screen">
            <PageHeader
                title="新品不良異動"
                description="追蹤產品瑕疵與更換記錄"
                actions={
                    <div className="flex gap-3">
                        <Link to="/admin">
                            <Button variant="secondary" size="sm" className="gap-1">
                                <ArrowLeft className="h-4 w-4" /> 返回
                            </Button>
                        </Link>
                        <Button disabled={loading || error || !rows.length} onClick={handleExport} variant="primary" size="sm" className="gap-1">
                            <Download className="h-4 w-4" /> 匯出報告
                        </Button>
                    </div>
                }
            />

            {loading ? (
                <Card className="mt-8">
                    <CardHeader>
                        <CardTitle>載入新品不良記錄中...</CardTitle>
                        <CardDescription>請稍候，正在取得資料</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <Skeleton key={i} className="h-10 w-full" />
                        ))}
                    </CardContent>
                </Card>
            ) : error ? (
                <div role="alert" className="mt-8 rounded-xl border border-red-200 bg-red-50 p-5"><p>新品不良紀錄載入失敗</p><Button onClick={fetchStats} className="mt-3">重試</Button></div>
            ) : (
                <Card className="mt-8">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-apple-orange" /> 新品不良記錄 ({rows.length})
                        </CardTitle>
                        <CardDescription>所有 SN 更換與原因</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {rows.length === 0 ? (
                            <EmptyState
                                title="目前沒有新品不良記錄"
                                description="當你在任務中提交新品不良更換後，會在這裡看到紀錄。"
                            />
                        ) : (
                            <Table>
                                <THead>
                                    <TH>時間</TH>
                                    <TH>訂單</TH>
                                    <TH>產品</TH>
                                    <TH>條碼</TH>
                                    <TH>原 SN</TH>
                                    <TH>新 SN</TH>
                                    <TH>原因</TH>
                                    <TH>處理人員</TH>
                                </THead>
                                <TBody>
                                    {visibleRows.map((r, idx) => (
                                        <TR key={`${r.product_barcode}-${r.original_sn}-${r.new_sn}-${r.created_at}-${idx}`}>
                                            <TD className="text-xs text-gray-600">{new Date(r.created_at).toLocaleString('zh-TW')}</TD>
                                            <TD>{r.order_id ? <Link className="text-blue-600 underline" to={`/order/${r.order_id}`}>{r.voucher_number || r.order_id}</Link> : '—'}</TD>
                                            <TD className="font-semibold text-gray-900">{r.product_name}</TD>
                                            <TD className="font-mono text-xs text-gray-600">{r.product_barcode}</TD>
                                            <TD className="font-mono text-xs text-red-600">{r.original_sn}</TD>
                                            <TD className="font-mono text-xs text-green-600">{r.new_sn}</TD>
                                            <TD className="max-w-[420px] truncate" title={r.reason}>{r.reason}</TD>
                                            <TD className="text-gray-700">{r.reporter}</TD>
                                        </TR>
                                    ))}
                                </TBody>
                            </Table>
                        )}
                        {rows.length > pageSize && <nav aria-label="新品不良分頁" className="mt-4 flex items-center justify-end gap-4"><Button disabled={page === 1} onClick={() => setPage(p => p - 1)}>上一頁</Button><span>{page} / {Math.ceil(rows.length / pageSize)}</span><Button disabled={page * pageSize >= rows.length} onClick={() => setPage(p => p + 1)}>下一頁</Button></nav>}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
