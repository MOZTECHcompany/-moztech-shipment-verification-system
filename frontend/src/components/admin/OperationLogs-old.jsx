// frontend/src/components/admin/OperationLogs.jsx
// 操作日誌查詢與顯示頁面

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { socket } from '@/api/socket.js';
import { 
    FileText, Search, Filter, Download, RefreshCw, 
    User, Package, Calendar, Activity, TrendingUp 
} from 'lucide-react';

// 操作類型的中文對照和顏色
const actionTypeMap = {
    import: { label: '匯入訂單', color: 'bg-blue-100 text-blue-800', icon: '📥' },
    claim: { label: '認領任務', color: 'bg-green-100 text-green-800', icon: '✋' },
    pick: { label: '揀貨操作', color: 'bg-yellow-100 text-yellow-800', icon: '📦' },
    pack: { label: '裝箱操作', color: 'bg-purple-100 text-purple-800', icon: '📮' },
    void: { label: '作廢訂單', color: 'bg-red-100 text-red-800', icon: '❌' },
    complete: { label: '完成訂單', color: 'bg-emerald-100 text-emerald-800', icon: '✅' }
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
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
            <div className="max-w-7xl mx-auto">
                {/* 標題 */}
                <div className="mb-6 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <FileText className="w-8 h-8 text-indigo-600" />
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900">操作日誌查詢</h1>
                            <p className="text-sm text-gray-500 mt-1">追蹤系統中所有操作記錄</p>
                        </div>
                    </div>
                    <button
                        onClick={fetchLogs}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        重新整理
                    </button>
                </div>

                {/* 統計卡片 */}
                {stats && (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                        <div className="bg-white rounded-lg shadow p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-gray-500">總操作數</p>
                                    <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                                </div>
                                <Activity className="w-8 h-8 text-blue-500" />
                            </div>
                        </div>
                        {stats.byActionType.slice(0, 3).map((item, index) => (
                            <div key={index} className="bg-white rounded-lg shadow p-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm text-gray-500">{actionTypeMap[item.action_type]?.label || item.action_type}</p>
                                        <p className="text-2xl font-bold text-gray-900">{item.count}</p>
                                        <p className="text-xs text-gray-400">{item.unique_users} 位使用者</p>
                                    </div>
                                    <TrendingUp className="w-8 h-8 text-green-500" />
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* 篩選區域 */}
                <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                    <div className="flex items-center gap-2 mb-4">
                        <Filter className="w-5 h-5 text-gray-600" />
                        <h2 className="text-lg font-semibold text-gray-900">篩選條件</h2>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
                        <input
                            type="text"
                            placeholder="訂單 ID"
                            value={filters.orderId}
                            onChange={(e) => handleFilterChange('orderId', e.target.value)}
                            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        />
                        
                        <input
                            type="text"
                            placeholder="使用者 ID"
                            value={filters.userId}
                            onChange={(e) => handleFilterChange('userId', e.target.value)}
                            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        />
                        
                        <select
                            value={filters.actionType}
                            onChange={(e) => handleFilterChange('actionType', e.target.value)}
                            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
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
                            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        />
                        
                        <input
                            type="date"
                            value={filters.endDate}
                            onChange={(e) => handleFilterChange('endDate', e.target.value)}
                            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        />
                        
                        <select
                            value={filters.limit}
                            onChange={(e) => handleFilterChange('limit', e.target.value)}
                            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        >
                            <option value="50">50 筆</option>
                            <option value="100">100 筆</option>
                            <option value="200">200 筆</option>
                            <option value="500">500 筆</option>
                        </select>
                    </div>
                    
                    <div className="flex gap-3 mt-4">
                        <button
                            onClick={handleSearch}
                            className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                        >
                            <Search className="w-4 h-4" />
                            搜尋
                        </button>
                        
                        <button
                            onClick={handleReset}
                            className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                        >
                            重置
                        </button>
                        
                        <button
                            onClick={handleExport}
                            disabled={logs.length === 0}
                            className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
                        >
                            <Download className="w-4 h-4" />
                            匯出 CSV
                        </button>
                    </div>
                </div>

                {/* 日誌列表 */}
                <div className="bg-white rounded-lg shadow-md overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">時間</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">訂單資訊</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作類型</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作人員</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">詳細資訊</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {loading ? (
                                    <tr>
                                        <td colSpan="5" className="px-6 py-12 text-center">
                                            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-gray-400 mb-2" />
                                            <p className="text-gray-500">載入中...</p>
                                        </td>
                                    </tr>
                                ) : logs.length === 0 ? (
                                    <tr>
                                        <td colSpan="5" className="px-6 py-12 text-center text-gray-500">
                                            沒有找到操作記錄
                                        </td>
                                    </tr>
                                ) : (
                                    logs.map((log) => (
                                        <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="flex items-center gap-2 text-sm text-gray-900">
                                                    <Calendar className="w-4 h-4 text-gray-400" />
                                                    {new Date(log.created_at).toLocaleString('zh-TW')}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <Package className="w-4 h-4 text-gray-400" />
                                                    <div>
                                                        <div className="text-sm font-medium text-gray-900">
                                                            {log.voucher_number || '-'}
                                                        </div>
                                                        <div className="text-xs text-gray-500">
                                                            {log.customer_name || '-'}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${actionTypeMap[log.action_type]?.color || 'bg-gray-100 text-gray-800'}`}>
                                                    {actionTypeMap[log.action_type]?.icon} {actionTypeMap[log.action_type]?.label || log.action_type}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <User className="w-4 h-4 text-gray-400" />
                                                    <div>
                                                        <div className="text-sm font-medium text-gray-900">
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
