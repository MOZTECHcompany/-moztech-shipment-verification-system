// frontend/src/components/admin/ScanErrors.jsx
// 刷錯條碼分析頁面

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import {
    ArrowLeft, AlertTriangle, User, Package, Calendar,
    TrendingUp, Download, Search
} from 'lucide-react';
import {
    PageHeader,
    Card, CardHeader, CardTitle, CardDescription, CardContent,
    Button,
    Badge,
    EmptyState,
    Skeleton,
    Table, THead, TH, TBody, TR, TD,
    Input
} from '../../ui';

export function ScanErrors() {
    const [loading, setLoading] = useState(true);
    const [errors, setErrors] = useState([]);
    const [dateRange, setDateRange] = useState('7days');
    const [searchTerm, setSearchTerm] = useState('');
    const [stats, setStats] = useState({
        totalErrors: 0,
        topUsers: [],
        topBarcodes: [],
        hourlyDistribution: []
    });

    useEffect(() => {
        fetchScanErrors();
    }, [dateRange]);

    const fetchScanErrors = async () => {
        setLoading(true);
        try {
            // 計算日期範圍
            const days = dateRange === '7days' ? 7 : dateRange === '30days' ? 30 : 90;
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const response = await apiClient.get('/api/scan-errors', {
                params: {
                    startDate: startDate.toISOString(),
                    endDate: endDate.toISOString(),
                    limit: 1000
                }
            });

            setErrors(response.data.errors || []);
            calculateStats(response.data.errors || []);
        } catch (error) {
            toast.error('載入刷錯記錄失敗', { 
                description: error.response?.data?.message || '請稍後再試' 
            });
        } finally {
            setLoading(false);
        }
    };

    const calculateStats = (errorData) => {
        // 總錯誤數
        const totalErrors = errorData.length;

        // 統計每個用戶的錯誤次數
        const userErrorCount = {};
        const barcodeErrorCount = {};
        const hourlyCount = Array(24).fill(0);

        errorData.forEach(error => {
            // 用戶統計
            const userName = error.user_name || '未知';
            userErrorCount[userName] = (userErrorCount[userName] || 0) + 1;

            // 條碼統計
            const barcode = error.details?.scanValue || '未知';
            barcodeErrorCount[barcode] = (barcodeErrorCount[barcode] || 0) + 1;

            // 時段統計
            const hour = new Date(error.created_at).getHours();
            hourlyCount[hour]++;
        });

        // 排序並取前10
        const topUsers = Object.entries(userErrorCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([name, count]) => ({ name, count }));

        const topBarcodes = Object.entries(barcodeErrorCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([barcode, count]) => ({ barcode, count }));

        setStats({
            totalErrors,
            topUsers,
            topBarcodes,
            hourlyDistribution: hourlyCount
        });
    };

    const exportToCSV = () => {
        const headers = ['時間', '操作員', '角色', '訂單號', '客戶名稱', '刷錯條碼', '錯誤原因'];
        const rows = filteredErrors.map(error => [
            new Date(error.created_at).toLocaleString('zh-TW'),
            error.user_name,
            error.user_role,
            error.voucher_number || '-',
            error.customer_name || '-',
            error.details?.scanValue || '-',
            error.details?.reason || '-'
        ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `刷錯記錄_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();

        toast.success('已匯出 CSV 檔案');
    };

    const filteredErrors = errors.filter(error => {
        if (!searchTerm) return true;
        const search = searchTerm.toLowerCase();
        return (
            error.user_name?.toLowerCase().includes(search) ||
            error.voucher_number?.toLowerCase().includes(search) ||
            error.customer_name?.toLowerCase().includes(search) ||
            error.details?.scanValue?.toLowerCase().includes(search)
        );
    });

        return (
            <div className="p-6 md:p-8 max-w-7xl mx-auto min-h-screen">
                <PageHeader
                    title="刷錯條碼分析"
                    description="分析掃描錯誤，找出問題根源"
                    actions={
                        <div className="flex gap-3 items-center">
                            <Link to="/admin">
                                <Button variant="secondary" size="sm" className="gap-1">
                                    <ArrowLeft className="h-4 w-4" /> 返回
                                </Button>
                            </Link>
                            <select
                                value={dateRange}
                                onChange={(e) => setDateRange(e.target.value)}
                                className="px-3 py-2 rounded-xl border-2 border-gray-200 bg-white text-sm font-medium focus:border-apple-blue focus:outline-none"
                            >
                                <option value="7days">近 7 天</option>
                                <option value="30days">近 30 天</option>
                                <option value="90days">近 90 天</option>
                            </select>
                            <Button variant="primary" size="sm" className="gap-1" onClick={exportToCSV}>
                                <Download className="h-4 w-4" /> 匯出 CSV
                            </Button>
                        </div>
                    }
                />

                {/* 統計卡片 */}
                {loading ? (
                    <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <Card key={i} className="p-4">
                                <Skeleton className="h-5 w-24 mb-3" />
                                <Skeleton className="h-10 w-20" />
                                <Skeleton className="h-3 w-28 mt-2" />
                            </Card>
                        ))}
                    </div>
                ) : (
                    <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <Card>
                            <CardContent className="p-5">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-xs font-semibold text-gray-600 mb-1">總錯誤次數</p>
                                        <p className="text-3xl font-bold text-apple-orange">{stats.totalErrors}</p>
                                    </div>
                                    <div className="w-12 h-12 rounded-xl bg-apple-orange/10 flex items-center justify-center">
                                        <AlertTriangle className="text-apple-orange" size={22} />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="p-5">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-xs font-semibold text-gray-600 mb-1">最常刷錯的人</p>
                                        <p className="font-bold text-gray-800 text-lg">{stats.topUsers[0]?.name || '-'}</p>
                                        <p className="text-[11px] text-gray-500 mt-1">{stats.topUsers[0]?.count || 0} 次</p>
                                    </div>
                                    <div className="w-12 h-12 rounded-xl bg-apple-blue/10 flex items-center justify-center">
                                        <User className="text-apple-blue" size={22} />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="p-5">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-xs font-semibold text-gray-600 mb-1">最常刷錯的條碼</p>
                                        <p className="font-mono text-xs font-bold text-gray-800 truncate max-w-[110px]">{stats.topBarcodes[0]?.barcode || '-'}</p>
                                        <p className="text-[11px] text-gray-500 mt-1">{stats.topBarcodes[0]?.count || 0} 次</p>
                                    </div>
                                    <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center">
                                        <Package className="text-amber-600" size={22} />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="p-5">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-xs font-semibold text-gray-600 mb-1">平均每天錯誤</p>
                                        <p className="text-3xl font-bold text-apple-indigo">{Math.round(stats.totalErrors / parseInt(dateRange.replace('days', '')) || 0)}</p>
                                        <p className="text-[11px] text-gray-500 mt-1">次錯誤</p>
                                    </div>
                                    <div className="w-12 h-12 rounded-xl bg-apple-indigo/10 flex items-center justify-center">
                                        <TrendingUp className="text-apple-indigo" size={22} />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* 排行榜 */}
                <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card>
                        <CardHeader className="flex items-center gap-2">
                            <User className="h-5 w-5 text-orange-600" />
                            <CardTitle className="text-lg">員工錯誤排行 TOP 10</CardTitle>
                            <CardDescription>錯誤次數最多的操作員</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            {stats.topUsers.map((user, index) => (
                                <div
                                    key={index}
                                    className="flex items-center justify-between p-3 rounded-lg bg-gray-50"
                                >
                                    <div className="flex items-center gap-3">
                                        <span
                                            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                                                index === 0
                                                    ? 'bg-yellow-500 text-white'
                                                    : index === 1
                                                    ? 'bg-gray-400 text-white'
                                                    : index === 2
                                                    ? 'bg-orange-500 text-white'
                                                    : 'bg-gray-200 text-gray-600'
                                            }`}
                                        >
                                            {index + 1}
                                        </span>
                                        <span className="font-medium text-sm">{user.name}</span>
                                    </div>
                                    <span className="text-red-600 font-bold text-sm">{user.count} 次</span>
                                </div>
                            ))}
                            {stats.topUsers.length === 0 && (
                                <EmptyState title="暫無數據" description="尚未有錯誤紀錄" />
                            )}
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex items-center gap-2">
                            <Package className="h-5 w-5 text-yellow-600" />
                            <CardTitle className="text-lg">條碼錯誤排行 TOP 10</CardTitle>
                            <CardDescription>最常發生錯誤的條碼</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            {stats.topBarcodes.map((item, index) => (
                                <div
                                    key={index}
                                    className="flex items-center justify-between p-3 rounded-lg bg-gray-50"
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <span
                                            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                                                index === 0
                                                    ? 'bg-yellow-500 text-white'
                                                    : index === 1
                                                    ? 'bg-gray-400 text-white'
                                                    : index === 2
                                                    ? 'bg-orange-500 text-white'
                                                    : 'bg-gray-200 text-gray-600'
                                            }`}
                                        >
                                            {index + 1}
                                        </span>
                                        <span className="font-mono text-xs truncate">{item.barcode}</span>
                                    </div>
                                    <span className="text-red-600 font-bold text-sm">{item.count} 次</span>
                                </div>
                            ))}
                            {stats.topBarcodes.length === 0 && (
                                <EmptyState title="暫無數據" description="尚未有條碼錯誤紀錄" />
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* 搜尋 */}
                <Card className="mt-8">
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-red-600" /> 錯誤記錄搜尋
                        </CardTitle>
                        <CardDescription>搜尋操作員、訂單號、客戶或條碼</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 h-5 w-5" />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="輸入關鍵字..."
                                className="input-apple pl-12 w-full"
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* 錯誤列表 */}
                <Card className="mt-8">
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-red-600" /> 刷錯記錄明細 ({filteredErrors.length})
                        </CardTitle>
                        <CardDescription>近期錯誤掃描詳細列表</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <THead>
                                <TH>時間</TH>
                                <TH>操作員</TH>
                                <TH>訂單號</TH>
                                <TH>刷錯條碼</TH>
                                <TH>錯誤原因</TH>
                            </THead>
                            <TBody>
                                {loading ? (
                                    <>
                                        {Array.from({ length: 5 }).map((_, i) => (
                                            <TR key={i}>
                                                <TD><Skeleton className="h-4 w-28" /></TD>
                                                <TD>
                                                    <div className="flex items-center gap-2">
                                                        <Skeleton className="h-4 w-24" />
                                                        <Skeleton className="h-4 w-12 rounded-full" />
                                                    </div>
                                                </TD>
                                                <TD><Skeleton className="h-4 w-24" /></TD>
                                                <TD><Skeleton className="h-6 w-36 rounded" /></TD>
                                                <TD><Skeleton className="h-4 w-40" /></TD>
                                            </TR>
                                        ))}
                                    </>
                                ) : filteredErrors.length === 0 ? (
                                    <TR>
                                        <TD colSpan={5} className="py-12">
                                            <EmptyState
                                                title={searchTerm ? '找不到符合的記錄' : '這段期間沒有刷錯記錄 🎉'}
                                                description={searchTerm ? '嘗試修改搜尋條件' : '流程品質表現良好'}
                                            />
                                        </TD>
                                    </TR>
                                ) : (
                                    filteredErrors.map((error) => (
                                        <TR key={error.id}>
                                            <TD className="text-xs whitespace-nowrap">{new Date(error.created_at).toLocaleString('zh-TW')}</TD>
                                            <TD>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium text-sm">{error.user_name}</span>
                                                    <Badge variant="info" className="text-[10px] px-2 py-0.5">{error.user_role}</Badge>
                                                </div>
                                            </TD>
                                            <TD>
                                                <div>
                                                    <p className="font-medium text-sm">{error.voucher_number || '-'}</p>
                                                    <p className="text-[10px] text-gray-500">{error.customer_name || '-'}</p>
                                                </div>
                                            </TD>
                                            <TD>
                                                <code className="bg-red-50 text-red-700 px-2 py-1 rounded text-xs font-mono">{error.details?.scanValue || '-'}</code>
                                            </TD>
                                            <TD className="text-xs text-gray-600">{error.details?.reason || '-'}</TD>
                                        </TR>
                                    ))
                                )}
                            </TBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
        );
}
