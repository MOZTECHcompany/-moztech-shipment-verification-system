// frontend/src/components/admin/ScanErrors.jsx
// 刷錯條碼分析頁面

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { 
    ArrowLeft, AlertTriangle, User, Package, Calendar, 
    TrendingUp, BarChart3, Download, Filter, Search
} from 'lucide-react';

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

    if (loading) {
        return (
            <div className="flex justify-center items-center h-screen">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-gray-500">載入中...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-red-50/50 via-white to-orange-50/50 p-6 md:p-8 lg:p-12">
            <div className="max-w-7xl mx-auto">
                {/* 頂部導航 */}
                <div className="mb-8 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link 
                            to="/admin" 
                            className="btn-apple bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
                        >
                            <ArrowLeft size={20} />
                            返回
                        </Link>
                        <div>
                            <h1 className="text-4xl font-bold bg-gradient-to-r from-red-600 to-orange-600 bg-clip-text text-transparent">
                                刷錯條碼分析
                            </h1>
                            <p className="text-gray-500 mt-1">分析掃描錯誤,找出問題根源</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* 日期範圍選擇 */}
                        <select
                            value={dateRange}
                            onChange={(e) => setDateRange(e.target.value)}
                            className="px-4 py-3 rounded-xl bg-white border-2 border-gray-200 focus:border-apple-blue focus:ring-4 focus:ring-apple-blue/10 outline-none transition-all duration-200 text-gray-900 font-medium"
                        >
                            <option value="7days">近 7 天</option>
                            <option value="30days">近 30 天</option>
                            <option value="90days">近 90 天</option>
                        </select>

                        {/* 匯出按鈕 */}
                        <button
                            onClick={exportToCSV}
                            className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold bg-apple-green/90 text-white hover:bg-apple-green shadow-apple-sm hover:shadow-apple backdrop-blur-sm transition-all duration-200 active:scale-[0.98]"
                        >
                            <Download size={20} />
                            匯出 CSV
                        </button>
                    </div>
                </div>

                {/* 統計卡片 */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                    <div className="glass-card p-6 hover:shadow-apple-lg transition-all duration-300 animate-scale-in">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-500 mb-1 font-semibold">總錯誤次數</p>
                                <p className="text-3xl font-bold text-apple-orange">{stats.totalErrors}</p>
                            </div>
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-apple-orange/10 to-apple-orange/5 flex items-center justify-center">
                                <AlertTriangle className="text-apple-orange" size={24} />
                            </div>
                        </div>
                    </div>

                    <div className="glass-card p-6 hover:shadow-apple-lg transition-all duration-300 animate-scale-in" style={{ animationDelay: '100ms' }}>
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-500 mb-1 font-semibold">最常刷錯的人</p>
                                <p className="text-xl font-bold text-gray-800">
                                    {stats.topUsers[0]?.name || '-'}
                                </p>
                                <p className="text-xs text-gray-500 mt-1 font-medium">
                                    {stats.topUsers[0]?.count || 0} 次
                                </p>
                            </div>
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-apple-blue/10 to-apple-blue/5 flex items-center justify-center">
                                <User className="text-apple-blue" size={24} />
                            </div>
                        </div>
                    </div>

                    <div className="glass-card p-6 hover:shadow-apple-lg transition-all duration-300 animate-scale-in" style={{ animationDelay: '200ms' }}>
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-500 mb-1 font-semibold">最常刷錯的條碼</p>
                                <p className="text-sm font-bold text-gray-800 truncate max-w-[120px]">
                                    {stats.topBarcodes[0]?.barcode || '-'}
                                </p>
                                <p className="text-xs text-gray-500 font-medium">
                                    {stats.topBarcodes[0]?.count || 0} 次
                                </p>
                            </div>
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500/10 to-amber-500/5 flex items-center justify-center">
                                <Package className="text-amber-600" size={24} />
                            </div>
                        </div>
                    </div>

                    <div className="glass-card p-6 hover:shadow-apple-lg transition-all duration-300 animate-scale-in" style={{ animationDelay: '300ms' }}>
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-500 mb-1 font-semibold">平均每天</p>
                                <p className="text-3xl font-bold text-apple-indigo">
                                    {Math.round(stats.totalErrors / parseInt(dateRange.replace('days', '')) || 0)}
                                </p>
                                <p className="text-xs text-gray-500 mt-1 font-medium">次錯誤</p>
                            </div>
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-apple-indigo/10 to-apple-indigo/5 flex items-center justify-center">
                                <TrendingUp className="text-apple-indigo" size={24} />
                            </div>
                        </div>
                    </div>
                </div>

                {/* 排行榜 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                    {/* 員工錯誤排行 */}
                    <div className="glass-card p-6">
                        <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                            <User size={20} className="text-orange-600" />
                            員工錯誤排行 TOP 10
                        </h2>
                        <div className="space-y-2">
                            {stats.topUsers.map((user, index) => (
                                <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                                    <div className="flex items-center gap-3">
                                        <span className={`
                                            w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                                            ${index === 0 ? 'bg-yellow-500 text-white' : 
                                              index === 1 ? 'bg-gray-400 text-white' : 
                                              index === 2 ? 'bg-orange-500 text-white' : 
                                              'bg-gray-200 text-gray-600'}
                                        `}>
                                            {index + 1}
                                        </span>
                                        <span className="font-medium">{user.name}</span>
                                    </div>
                                    <span className="text-red-600 font-bold">{user.count} 次</span>
                                </div>
                            ))}
                            {stats.topUsers.length === 0 && (
                                <p className="text-center text-gray-400 py-8">暫無數據</p>
                            )}
                        </div>
                    </div>

                    {/* 條碼錯誤排行 */}
                    <div className="glass-card p-6">
                        <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                            <Package size={20} className="text-yellow-600" />
                            條碼錯誤排行 TOP 10
                        </h2>
                        <div className="space-y-2">
                            {stats.topBarcodes.map((item, index) => (
                                <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                        <span className={`
                                            w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
                                            ${index === 0 ? 'bg-yellow-500 text-white' : 
                                              index === 1 ? 'bg-gray-400 text-white' : 
                                              index === 2 ? 'bg-orange-500 text-white' : 
                                              'bg-gray-200 text-gray-600'}
                                        `}>
                                            {index + 1}
                                        </span>
                                        <span className="font-mono text-sm truncate">{item.barcode}</span>
                                    </div>
                                    <span className="text-red-600 font-bold flex-shrink-0 ml-2">{item.count} 次</span>
                                </div>
                            ))}
                            {stats.topBarcodes.length === 0 && (
                                <p className="text-center text-gray-400 py-8">暫無數據</p>
                            )}
                        </div>
                    </div>
                </div>

                {/* 搜尋框 */}
                <div className="glass-card p-6 mb-6">
                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                        <input
                            type="text"
                            placeholder="搜尋操作員、訂單號、客戶名稱或條碼..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="input-apple pl-12 w-full"
                        />
                    </div>
                </div>

                {/* 錯誤列表 */}
                <div className="glass-card p-6">
                    <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                        <AlertTriangle size={20} className="text-red-600" />
                        刷錯記錄明細 ({filteredErrors.length})
                    </h2>
                    
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b-2 border-gray-200">
                                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">時間</th>
                                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">操作員</th>
                                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">訂單號</th>
                                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">刷錯條碼</th>
                                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">錯誤原因</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredErrors.map((error, index) => (
                                    <tr key={error.id || index} className="border-b border-gray-100 hover:bg-gray-50">
                                        <td className="py-3 px-4 text-sm">
                                            {new Date(error.created_at).toLocaleString('zh-TW')}
                                        </td>
                                        <td className="py-3 px-4">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium">{error.user_name}</span>
                                                <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
                                                    {error.user_role}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="py-3 px-4 text-sm">
                                            <div>
                                                <p className="font-medium">{error.voucher_number || '-'}</p>
                                                <p className="text-xs text-gray-500">{error.customer_name || '-'}</p>
                                            </div>
                                        </td>
                                        <td className="py-3 px-4">
                                            <code className="bg-red-50 text-red-700 px-2 py-1 rounded text-sm font-mono">
                                                {error.details?.scanValue || '-'}
                                            </code>
                                        </td>
                                        <td className="py-3 px-4 text-sm text-gray-600">
                                            {error.details?.reason || '-'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        {filteredErrors.length === 0 && (
                            <div className="text-center py-12">
                                <AlertTriangle className="mx-auto text-gray-300 mb-4" size={48} />
                                <p className="text-gray-400 text-lg">
                                    {searchTerm ? '找不到符合的記錄' : '太棒了!這段期間沒有刷錯記錄 🎉'}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
