// frontend/src/components/admin/OperationLogs.jsx
// 操作日誌查詢與顯示頁面 - Apple 風格現代化版本

import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { socket } from '@/api/socket.js';
import {
    FileText, Search, Filter, Download, RefreshCw,
    User, Package, Calendar, Activity, TrendingUp, ArrowLeft
} from 'lucide-react';
import {
    PageHeader,
    Card, CardHeader, CardTitle, CardDescription, CardContent,
    Button,
    Table, THead, TH, TBody, TR, TD,
    EmptyState,
    Skeleton,
    Badge,
} from '../../ui';

// 操作類型的中文對照和顏色
const actionTypeMap = {
    import: { label: '匯入訂單', color: 'bg-gradient-to-br from-blue-50 to-blue-100 text-blue-800 border-blue-200', icon: '📥' },
    claim: { label: '認領任務', color: 'bg-gradient-to-br from-green-50 to-green-100 text-green-800 border-green-200', icon: '✋' },
    pick: { label: '揀貨操作', color: 'bg-gradient-to-br from-yellow-50 to-yellow-100 text-yellow-800 border-yellow-200', icon: '📦' },
    pack: { label: '裝箱操作', color: 'bg-gradient-to-br from-purple-50 to-purple-100 text-purple-800 border-purple-200', icon: '📮' },
    void: { label: '作廢訂單', color: 'bg-gradient-to-br from-red-50 to-red-100 text-red-800 border-red-200', icon: '❌' },
    complete: { label: '完成訂單', color: 'bg-gradient-to-br from-emerald-50 to-emerald-100 text-emerald-800 border-emerald-200', icon: '✅' }
};

export function OperationLogs() {
    const [searchParams, setSearchParams] = useSearchParams();
    const [logs, setLogs] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(false);
    const [filters, setFilters] = useState({
        orderId: searchParams.get('orderId') || '',
        userId: searchParams.get('userId') || '',
        actionType: searchParams.get('actionType') || '',
        startDate: searchParams.get('startDate') || '',
        endDate: searchParams.get('endDate') || '',
        limit: searchParams.get('limit') || '100'
    });

    // 載入操作日誌
    const fetchLogs = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            Object.entries(filters).forEach(([key, value]) => {
                if (value) params.append(key, value);
            });

            const response = await apiClient.get(`/api/operation-logs?${params.toString()}`);
            setLogs(response.data.logs);
            toast.success(`載入了 ${response.data.total} 筆操作記錄`);
        } catch (error) {
            console.error('載入操作日誌失敗:', error);
            toast.error('載入操作日誌失敗');
        } finally {
            setLoading(false);
        }
    };

    // 載入統計資料
    const fetchStats = async () => {
        try {
            const params = new URLSearchParams();
            if (filters.startDate) params.append('startDate', filters.startDate);
            if (filters.endDate) params.append('endDate', filters.endDate);

            const response = await apiClient.get(`/api/operation-logs/stats?${params.toString()}`);
            setStats(response.data);
        } catch (error) {
            console.error('載入統計資料失敗:', error);
        }
    };

    // 初始載入
    useEffect(() => {
        fetchLogs();
        fetchStats();
    }, []);

    // 監聽即時更新
    useEffect(() => {
        const handleNewLog = (newLog) => {
            setLogs(prevLogs => [newLog, ...prevLogs].slice(0, parseInt(filters.limit)));
            toast.info(`新操作：${actionTypeMap[newLog.action_type]?.label || newLog.action_type}`);
            // 更新統計資料
            fetchStats();
        };

        socket.on('new_operation_log', handleNewLog);

        return () => {
            socket.off('new_operation_log', handleNewLog);
        };
    }, [filters.limit]);

    // 處理篩選變更
    const handleFilterChange = (key, value) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    // 執行搜尋
    const handleSearch = () => {
        // 更新 URL 參數
        const params = new URLSearchParams();
        Object.entries(filters).forEach(([key, value]) => {
            if (value) params.set(key, value);
        });
        setSearchParams(params);
        
        fetchLogs();
        fetchStats();
    };

    // 重置篩選
    const handleReset = () => {
        setFilters({
            orderId: '',
            userId: '',
            actionType: '',
            startDate: '',
            endDate: '',
            limit: '100'
        });
        setSearchParams({});
        setTimeout(() => {
            fetchLogs();
            fetchStats();
        }, 100);
    };

    // 匯出 CSV
    const handleExport = () => {
        const csv = convertToCSV(logs);
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `操作日誌_${new Date().toISOString().split('T')[0]}.csv`);
        link.click();
    };

    // 轉換為 CSV 格式
    const convertToCSV = (data) => {
        const headers = ['時間', '訂單編號', '客戶名稱', '操作類型', '操作人員', '角色', '詳細資訊'];
        const rows = data.map(log => [
            new Date(log.created_at).toLocaleString('zh-TW'),
            log.voucher_number || '-',
            log.customer_name || '-',
            actionTypeMap[log.action_type]?.label || log.action_type,
            log.user_name || '-',
            log.user_role || '-',
            JSON.stringify(log.details)
        ]);
        
        return [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    };

    // 格式化詳細資訊
    const formatDetails = (details) => {
        if (!details) return '-';
        if (typeof details === 'string') {
            try {
                details = JSON.parse(details);
            } catch (e) {
                return details;
            }
        }
        
        return Object.entries(details).map(([key, value]) => (
            <div key={key} className="text-xs">
                <span className="font-medium">{key}:</span> {JSON.stringify(value)}
            </div>
        ));
    };

        return (
            <div className="p-6 md:p-8 max-w-7xl mx-auto min-h-screen">
                <PageHeader
                    title="操作日誌查詢"
                    description="追蹤系統中所有操作記錄"
                    actions={
                        <div className="flex gap-3">
                            <Link to="/settings">
                                <Button variant="secondary" size="sm" className="gap-1">
                                    <ArrowLeft className="h-4 w-4" /> 返回設定
                                </Button>
                            </Link>
                            <Button onClick={fetchLogs} disabled={loading} variant="primary" size="sm" className="gap-1">
                                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 重新整理
                            </Button>
                        </div>
                    }
                />

                {stats && (
                    <div className="mt-8 grid grid-cols-1 md:grid-cols-4 gap-4">
                        <Card>
                            <CardContent className="p-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-xs text-gray-600 font-medium mb-1">總操作數</p>
                                        <p className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">{stats.total}</p>
                                    </div>
                                    <div className="p-3 bg-gradient-to-br from-blue-100 to-blue-200 rounded-xl">
                                        <Activity className="w-6 h-6 text-blue-600" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                        {stats.byActionType.slice(0, 3).map((item, index) => (
                            <Card key={index}>
                                <CardContent className="p-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-xs text-gray-600 font-medium mb-1">{actionTypeMap[item.action_type]?.label || item.action_type}</p>
                                            <p className="text-2xl font-bold text-gray-900">{item.count}</p>
                                            <p className="text-[10px] text-gray-500 mt-1">{item.unique_users} 位使用者</p>
                                        </div>
                                        <div className="p-3 bg-gradient-to-br from-green-100 to-green-200 rounded-xl">
                                            <TrendingUp className="w-5 h-5 text-green-600" />
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}

                <Card className="mt-8">
                    <CardHeader className="flex items-center gap-2">
                        <Filter className="h-5 w-5 text-purple-600" />
                        <CardTitle className="text-lg">篩選條件</CardTitle>
                        <CardDescription>設定條件以縮小結果</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
                            <input
                                type="text"
                                placeholder="訂單編號"
                                value={filters.orderId}
                                onChange={(e) => handleFilterChange('orderId', e.target.value)}
                                className="w-full py-3 px-4 rounded-xl bg-white border-2 border-gray-200 focus:border-apple-blue focus:ring-4 focus:ring-apple-blue/10 outline-none transition-all text-gray-900 font-medium"
                            />
                            <input
                                type="text"
                                placeholder="使用者 ID"
                                value={filters.userId}
                                onChange={(e) => handleFilterChange('userId', e.target.value)}
                                className="w-full py-3 px-4 rounded-xl bg-white border-2 border-gray-200 focus:border-apple-blue focus:ring-4 focus:ring-apple-blue/10 outline-none transition-all text-gray-900 font-medium"
                            />
                            <select
                                value={filters.actionType}
                                onChange={(e) => handleFilterChange('actionType', e.target.value)}
                                className="w-full py-3 px-4 rounded-xl bg-white border-2 border-gray-200 focus:border-apple-blue focus:ring-4 focus:ring-apple-blue/10 outline-none transition-all text-gray-900 font-medium"
                            >
                                <option value="">所有類型</option>
                                {Object.entries(actionTypeMap).map(([key, value]) => (
                                    <option key={key} value={key}>{value.label}</option>
                                ))}
                            </select>
                            <input
                                type="date"
                                value={filters.startDate}
                                onChange={(e) => handleFilterChange('startDate', e.target.value)}
                                className="w-full py-3 px-4 rounded-xl bg-white border-2 border-gray-200 focus:border-apple-blue focus:ring-4 focus:ring-apple-blue/10 outline-none transition-all text-gray-900 font-medium"
                            />
                            <input
                                type="date"
                                value={filters.endDate}
                                onChange={(e) => handleFilterChange('endDate', e.target.value)}
                                className="w-full py-3 px-4 rounded-xl bg-white border-2 border-gray-200 focus:border-apple-blue focus:ring-4 focus:ring-apple-blue/10 outline-none transition-all text-gray-900 font-medium"
                            />
                            <select
                                value={filters.limit}
                                onChange={(e) => handleFilterChange('limit', e.target.value)}
                                className="input-apple"
                            >
                                <option value="50">50 筆</option>
                                <option value="100">100 筆</option>
                                <option value="200">200 筆</option>
                                <option value="500">500 筆</option>
                            </select>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button variant="primary" size="sm" className="gap-1" onClick={handleSearch}>
                                <Search className="h-4 w-4" /> 搜尋
                            </Button>
                            <Button variant="secondary" size="sm" onClick={handleReset}>重置</Button>
                            <Button
                                variant="success"
                                size="sm"
                                className="gap-1 ml-auto"
                                onClick={handleExport}
                                disabled={logs.length === 0}
                            >
                                <Download className="h-4 w-4" /> 匯出 CSV
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                <Card className="mt-8">
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                            <FileText className="h-5 w-5 text-apple-blue" /> 操作記錄 ({logs.length})
                        </CardTitle>
                        <CardDescription>最新操作事件列表</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <THead>
                                <TH>時間</TH>
                                <TH>訂單資訊</TH>
                                <TH>操作類型</TH>
                                <TH>操作人員</TH>
                                <TH>詳細資訊</TH>
                            </THead>
                            <TBody>
                                {loading ? (
                                    <>
                                        {Array.from({ length: 5 }).map((_, i) => (
                                            <TR key={i}>
                                                <TD><Skeleton className="h-4 w-28" /></TD>
                                                <TD>
                                                    <div className="flex items-center gap-2">
                                                        <Skeleton className="h-4 w-4 rounded" />
                                                        <div className="space-y-1">
                                                            <Skeleton className="h-4 w-32" />
                                                            <Skeleton className="h-3 w-24" />
                                                        </div>
                                                    </div>
                                                </TD>
                                                <TD><Skeleton className="h-5 w-24 rounded-full" /></TD>
                                                <TD>
                                                    <div className="flex items-center gap-2">
                                                        <Skeleton className="h-5 w-5 rounded-lg" />
                                                        <div className="space-y-1">
                                                            <Skeleton className="h-4 w-24" />
                                                            <Skeleton className="h-3 w-16" />
                                                        </div>
                                                    </div>
                                                </TD>
                                                <TD><Skeleton className="h-4 w-40" /></TD>
                                            </TR>
                                        ))}
                                    </>
                                ) : logs.length === 0 ? (
                                    <TR>
                                        <TD colSpan={5} className="py-10">
                                            <EmptyState title="沒有找到操作記錄" description="嘗試調整篩選條件" />
                                        </TD>
                                    </TR>
                                ) : (
                                    logs.map((log) => (
                                        <TR key={log.id}>
                                            <TD className="whitespace-nowrap text-xs">
                                                <div className="flex items-center gap-1">
                                                    <Calendar className="h-3.5 w-3.5 text-gray-400" />
                                                    {new Date(log.created_at).toLocaleString('zh-TW')}
                                                </div>
                                            </TD>
                                            <TD>
                                                <div className="flex items-center gap-2">
                                                    <Package className="h-4 w-4 text-blue-500" />
                                                    <div>
                                                        <div className="text-sm font-semibold text-gray-900">{log.voucher_number || '-'}</div>
                                                        <div className="text-[10px] text-gray-500">{log.customer_name || '-'}</div>
                                                    </div>
                                                </div>
                                            </TD>
                                            <TD className="whitespace-nowrap">
                                                <Badge variant="info" className="gap-1 text-xs">
                                                    {actionTypeMap[log.action_type]?.icon}
                                                    {actionTypeMap[log.action_type]?.label || log.action_type}
                                                </Badge>
                                            </TD>
                                            <TD>
                                                <div className="flex items-center gap-2">
                                                    <div className="p-1.5 bg-gradient-to-br from-purple-100 to-purple-200 rounded-lg">
                                                        <User className="h-3.5 w-3.5 text-purple-600" />
                                                    </div>
                                                    <div>
                                                        <div className="text-sm font-semibold text-gray-900">{log.user_name || '-'}</div>
                                                        <div className="text-[10px] text-gray-500">{log.user_role || '-'}</div>
                                                    </div>
                                                </div>
                                            </TD>
                                            <TD className="max-w-xs">
                                                <div className="text-xs text-gray-600 space-y-0.5">{formatDetails(log.details)}</div>
                                            </TD>
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
