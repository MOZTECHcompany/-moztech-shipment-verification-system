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
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50/30 p-4 md:p-8">
            <div className="max-w-7xl mx-auto">
                {/* 標題 */}
                <div className="mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-fade-in">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl shadow-apple-lg">
                            <FileText className="w-8 h-8 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                                操作日誌查詢
                            </h1>
                            <p className="text-sm text-gray-600 mt-1">追蹤系統中所有操作記錄</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <Link to="/admin" 
                            className="btn-apple bg-gradient-to-r from-gray-500 to-gray-600 hover:from-gray-600 hover:to-gray-700 text-white flex items-center gap-2 shadow-apple-lg">
                            <ArrowLeft size={18} />
                            返回
                        </Link>
                        <button
                            onClick={fetchLogs}
                            disabled={loading}
                            className="btn-apple bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white flex items-center gap-2 shadow-apple-lg disabled:opacity-50"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                            重新整理
                        </button>
                    </div>
                </div>

                {/* 統計卡片 */}
                {stats && (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                        <div className="glass-card p-6 animate-scale-in hover:shadow-apple-lg transition-all duration-300" style={{ animationDelay: '100ms' }}>
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-gray-600 font-medium mb-1">總操作數</p>
                                    <p className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">{stats.total}</p>
                                </div>
                                <div className="p-3 bg-gradient-to-br from-blue-100 to-blue-200 rounded-xl">
                                    <Activity className="w-6 h-6 text-blue-600" />
                                </div>
                            </div>
                        </div>
                        {stats.byActionType.slice(0, 3).map((item, index) => (
                            <div key={index} className="glass-card p-6 animate-scale-in hover:shadow-apple-lg transition-all duration-300" style={{ animationDelay: `${(index + 2) * 100}ms` }}>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm text-gray-600 font-medium mb-1">{actionTypeMap[item.action_type]?.label || item.action_type}</p>
                                        <p className="text-3xl font-bold text-gray-900">{item.count}</p>
                                        <p className="text-xs text-gray-500 mt-1">{item.unique_users} 位使用者</p>
                                    </div>
                                    <div className="p-3 bg-gradient-to-br from-green-100 to-green-200 rounded-xl">
                                        <TrendingUp className="w-6 h-6 text-green-600" />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* 篩選區域 */}
                <div className="glass-card p-6 mb-8 animate-scale-in" style={{ animationDelay: '200ms' }}>
                    <div className="flex items-center gap-2 mb-6">
                        <div className="p-2 bg-gradient-to-br from-purple-100 to-purple-200 rounded-xl">
                            <Filter className="w-5 h-5 text-purple-600" />
                        </div>
                        <h2 className="text-xl font-bold text-gray-900">篩選條件</h2>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
                        <input
                            type="text"
                            placeholder="訂單編號 (如: 20250807-33)"
                            value={filters.orderId}
                            onChange={(e) => handleFilterChange('orderId', e.target.value)}
                            className="input-apple"
                        />
                        
                        <input
                            type="text"
                            placeholder="使用者 ID"
                            value={filters.userId}
                            onChange={(e) => handleFilterChange('userId', e.target.value)}
                            className="input-apple"
                        />
                        
                        <select
                            value={filters.actionType}
                            onChange={(e) => handleFilterChange('actionType', e.target.value)}
                            className="input-apple"
                        >
                            <option value="">所有操作類型</option>
                            {Object.entries(actionTypeMap).map(([key, value]) => (
                                <option key={key} value={key}>{value.label}</option>
                            ))}
                        </select>
                        
                        <input
                            type="date"
                            value={filters.startDate}
                            onChange={(e) => handleFilterChange('startDate', e.target.value)}
                            className="input-apple"
                        />
                        
                        <input
                            type="date"
                            value={filters.endDate}
                            onChange={(e) => handleFilterChange('endDate', e.target.value)}
                            className="input-apple"
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
                    
                    <div className="flex flex-wrap gap-3 mt-6">
                        <button
                            onClick={handleSearch}
                            className="btn-apple bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white flex items-center gap-2 shadow-apple-lg"
                        >
                            <Search className="w-4 h-4" />
                            搜尋
                        </button>
                        
                        <button
                            onClick={handleReset}
                            className="btn-apple bg-gradient-to-r from-gray-400 to-gray-500 hover:from-gray-500 hover:to-gray-600 text-white shadow-apple-lg"
                        >
                            重置
                        </button>
                        
                        <button
                            onClick={handleExport}
                            disabled={logs.length === 0}
                            className="btn-apple bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white flex items-center gap-2 shadow-apple-lg disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
                        >
                            <Download className="w-4 h-4" />
                            匯出 CSV
                        </button>
                    </div>
                </div>

                {/* 日誌列表 */}
                <div className="glass-card overflow-hidden animate-scale-in shadow-apple-lg" style={{ animationDelay: '300ms' }}>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gradient-to-r from-gray-50 to-blue-50 border-b border-gray-200">
                                <tr>
                                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">時間</th>
                                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">訂單資訊</th>
                                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">操作類型</th>
                                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">操作人員</th>
                                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">詳細資訊</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {loading ? (
                                    <tr>
                                        <td colSpan="5" className="px-6 py-12 text-center">
                                            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-500 mb-2" />
                                            <p className="text-gray-600 font-medium">載入中...</p>
                                        </td>
                                    </tr>
                                ) : logs.length === 0 ? (
                                    <tr>
                                        <td colSpan="5" className="px-6 py-12 text-center text-gray-500">
                                            沒有找到操作記錄
                                        </td>
                                    </tr>
                                ) : (
                                    logs.map((log, index) => (
                                        <tr key={log.id} className="hover:bg-blue-50/50 transition-all duration-200 animate-slide-up" style={{ animationDelay: `${index * 20}ms` }}>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="flex items-center gap-2 text-sm text-gray-900">
                                                    <Calendar className="w-4 h-4 text-gray-400" />
                                                    {new Date(log.created_at).toLocaleString('zh-TW')}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <Package className="w-4 h-4 text-blue-500" />
                                                    <div>
                                                        <div className="text-sm font-semibold text-gray-900">
                                                            {log.voucher_number || '-'}
                                                        </div>
                                                        <div className="text-xs text-gray-500">
                                                            {log.customer_name || '-'}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className={`px-3 py-1.5 inline-flex items-center gap-1 text-xs font-semibold rounded-xl border ${actionTypeMap[log.action_type]?.color || 'bg-gray-100 text-gray-800 border-gray-200'} shadow-sm`}>
                                                    <span>{actionTypeMap[log.action_type]?.icon}</span>
                                                    <span>{actionTypeMap[log.action_type]?.label || log.action_type}</span>
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="p-2 bg-gradient-to-br from-purple-100 to-purple-200 rounded-lg">
                                                        <User className="w-3 h-3 text-purple-600" />
                                                    </div>
                                                    <div>
                                                        <div className="text-sm font-semibold text-gray-900">
                                                            {log.user_name || '-'}
                                                        </div>
                                                        <div className="text-xs text-gray-500">
                                                            {log.user_role || '-'}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="text-sm text-gray-600 max-w-xs">
                                                    {formatDetails(log.details)}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
