import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '@/api/api';
import { PageHeader, Card, CardHeader, CardTitle, CardContent, Button } from '@/ui';
import { ArrowLeft, AlertTriangle, Download } from 'lucide-react';
import { toast } from 'sonner';

export function DefectStats() {
    const [stats, setStats] = useState([]);
    const [loading, setLoading] = useState(true);

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
        <div className="min-h-screen bg-gray-50/50 pb-20">
            <div className="p-6 md:p-8 lg:p-10 max-w-[1600px] mx-auto">
                <PageHeader
                    title="新品不良統計"
                    description="追蹤產品瑕疵與更換記錄"
                    backButton={
                        <Link to="/admin">
                            <Button variant="ghost" size="sm" className="gap-2">
                                <ArrowLeft size={16} /> 返回管理中心
                            </Button>
                        </Link>
                    }
                    actions={
                        <Button onClick={handleExport} variant="outline" className="gap-2">
                            <Download size={16} /> 匯出報告
                        </Button>
                    }
                />

                <div className="mt-8 grid gap-6">
                    {stats.map((item) => (
                        <Card key={item.product_barcode} className="overflow-hidden">
                            <CardHeader className="bg-red-50/50 border-b border-red-100">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-red-100 text-red-600 rounded-lg">
                                            <AlertTriangle size={20} />
                                        </div>
                                        <div>
                                            <CardTitle className="text-lg">{item.product_name}</CardTitle>
                                            <p className="text-sm text-gray-500 font-mono">{item.product_barcode}</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm text-gray-500">不良總數</p>
                                        <p className="text-2xl font-bold text-red-600">{item.defect_count}</p>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm text-left">
                                        <thead className="bg-gray-50 text-gray-500 font-medium border-b">
                                            <tr>
                                                <th className="px-6 py-3">時間</th>
                                                <th className="px-6 py-3">原 SN</th>
                                                <th className="px-6 py-3">新 SN</th>
                                                <th className="px-6 py-3">原因</th>
                                                <th className="px-6 py-3">處理人員</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {item.details.map((detail, idx) => (
                                                <tr key={idx} className="hover:bg-gray-50/50">
                                                    <td className="px-6 py-3 text-gray-500">
                                                        {new Date(detail.created_at).toLocaleString()}
                                                    </td>
                                                    <td className="px-6 py-3 font-mono text-red-600">{detail.original_sn}</td>
                                                    <td className="px-6 py-3 font-mono text-green-600">{detail.new_sn}</td>
                                                    <td className="px-6 py-3 max-w-md truncate" title={detail.reason}>
                                                        {detail.reason}
                                                    </td>
                                                    <td className="px-6 py-3">
                                                        <span className="inline-flex items-center px-2 py-1 rounded-full bg-gray-100 text-xs font-medium text-gray-600">
                                                            {detail.reporter}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                    
                    {stats.length === 0 && !loading && (
                        <div className="text-center py-12 text-gray-500">
                            目前沒有新品不良記錄
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
