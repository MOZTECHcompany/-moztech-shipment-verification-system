import React, { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '@/api/api';
import { PageHeader, Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Table, THead, TH, TBody, TR, TD, EmptyState, Skeleton } from '@/ui';
import { ArrowLeft, AlertTriangle, Download } from 'lucide-react';
import { toast } from 'sonner';

export function DefectStats() {
    const [stats, setStats] = useState([]);
    const [loading, setLoading] = useState(true);

    const rows = useMemo(() => {
        const flattened = [];
        for (const item of stats || []) {
            for (const detail of item.details || []) {
                flattened.push({
                    product_name: item.product_name,
                    product_barcode: item.product_barcode,
                    defect_count: item.defect_count,
                    ...detail,
                });
            }
        }
        return flattened;
    }, [stats]);

    useEffect(() => {
        fetchStats();
    }, []);

    const fetchStats = async () => {
        try {
            const res = await apiClient.get('/api/admin/defects/stats');
            setStats(res.data);
        } catch (error) {
            toast.error('無法載入新品不良統計');
        } finally {
            setLoading(false);
        }
    };

    const handleExport = () => {
        // Simple CSV export
        const headers = ['產品名稱', '條碼', '不良次數', '訂單號', '原SN', '新SN', '原因', '更換人', '時間'];
        const rows = [];
        
        stats.forEach(item => {
            item.details.forEach(d => {
                rows.push([
                    item.product_name,
                    item.product_barcode,
                    1, // Count per row
                    d.order_id, // Should fetch voucher number ideally, but ID is here
                    d.original_sn,
                    d.new_sn,
                    d.reason,
                    d.reporter,
                    new Date(d.created_at).toLocaleString()
                ]);
            });
        });

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `defect_report_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="p-6 md:p-8 max-w-7xl mx-auto min-h-screen">
            <PageHeader
                title="新品不良統計"
                description="追蹤產品瑕疵與更換記錄"
                actions={
                    <div className="flex gap-3">
                        <Link to="/admin">
                            <Button variant="secondary" size="sm" className="gap-1">
                                <ArrowLeft className="h-4 w-4" /> 返回
                            </Button>
                        </Link>
                        <Button onClick={handleExport} variant="primary" size="sm" className="gap-1">
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
                                    <TH>產品</TH>
                                    <TH>條碼</TH>
                                    <TH>原 SN</TH>
                                    <TH>新 SN</TH>
                                    <TH>原因</TH>
                                    <TH>處理人員</TH>
                                </THead>
                                <TBody>
                                    {rows.map((r, idx) => (
                                        <TR key={`${r.product_barcode}-${r.original_sn}-${r.new_sn}-${r.created_at}-${idx}`}>
                                            <TD className="text-xs text-gray-600">{new Date(r.created_at).toLocaleString('zh-TW')}</TD>
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
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
