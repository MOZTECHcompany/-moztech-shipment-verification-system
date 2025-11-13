// frontend/src/components/admin/Analytics.jsx
// 數據分析儀表板

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import apiClient from '@/api/api.js';
import { 
    ArrowLeft, TrendingUp, Users, Package, Clock, 
    Award, Target, BarChart3, Activity, Calendar
} from 'lucide-react';

export function Analytics() {
    const [loading, setLoading] = useState(true);
    const [dateRange, setDateRange] = useState('7days'); // 7days, 30days, 90days
    const [analytics, setAnalytics] = useState({
        overview: {
            totalOrders: 0,
            completedOrders: 0,
            avgPickingTime: 0,
            avgPackingTime: 0,
            errorRate: 0
        },
        userPerformance: [],
        orderTrends: [],
        topProducts: [],
        hourlyDistribution: []
    });

    useEffect(() => {
        fetchAnalytics();
    }, [dateRange]);

    const fetchAnalytics = async () => {
        setLoading(true);
        try {
            const response = await apiClient.get(`/api/analytics?range=${dateRange}`);
            setAnalytics(response.data);
        } catch (error) {
            toast.error('載入分析數據失敗', { 
                description: error.response?.data?.message || '請稍後再試' 
            });
        } finally {
            setLoading(false);
        }
    };

    const formatTime = (minutes) => {
        if (minutes < 60) return `${Math.round(minutes)} 分鐘`;
        const hours = Math.floor(minutes / 60);
        const mins = Math.round(minutes % 60);
        return `${hours} 小時 ${mins} 分鐘`;
    };

    const formatPercentage = (value) => `${(value * 100).toFixed(1)}%`;

    if (loading) {
        return (
            <div className="flex flex-col justify-center items-center h-screen bg-gradient-to-br from-gray-50 to-blue-50/30">
                <Activity className="animate-spin text-blue-500 mb-4" size={48} />
                <p className="text-gray-600 font-medium">載入分析數據中...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-purple-50/30 p-4 md:p-8">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 animate-fade-in">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-apple-purple/10 to-apple-pink/10 flex items-center justify-center">
                            <BarChart3 className="w-7 h-7 text-apple-purple" />
                        </div>
                        <div>
                            <h1 className="text-4xl font-semibold tracking-tight text-gray-900">
                                📊 數據分析儀表板
                            </h1>
                            <p className="text-gray-500 mt-1 font-medium">全面掌握倉儲營運數據</p>
                        </div>
                    </div>
                    <div className="flex gap-3">
                        <select 
                            value={dateRange}
                            onChange={(e) => setDateRange(e.target.value)}
                            className="px-4 py-2.5 rounded-xl border-2 border-gray-200 bg-white/90 backdrop-blur-xl font-semibold text-gray-700 focus:outline-none focus:border-apple-blue transition-all shadow-apple-sm hover:shadow-apple"
                        >
                            <option value="7days">最近 7 天</option>
                            <option value="30days">最近 30 天</option>
                            <option value="90days">最近 90 天</option>
                        </select>
                        <Link to="/admin" 
                            className="btn-apple bg-white/90 backdrop-blur-xl border-2 border-gray-200 hover:border-gray-300 text-gray-700 hover:bg-white flex items-center gap-2 shadow-apple">
                            <ArrowLeft size={18} />
                            返回
                        </Link>
                    </div>
                </header>

                {/* Overview Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
                    <div className="glass-card p-6 animate-scale-in hover:shadow-apple-lg transition-all duration-300" style={{ animationDelay: '100ms' }}>
                        <div className="flex items-center justify-between mb-3">
                            <p className="text-sm text-gray-600 font-semibold">總訂單數</p>
                            <div className="w-10 h-10 rounded-xl bg-apple-blue/10 flex items-center justify-center">
                                <Package className="text-apple-blue" size={20} />
                            </div>
                        </div>
                        <p className="text-3xl font-bold text-gray-900">{analytics.overview.totalOrders}</p>
                        <p className="text-xs text-gray-500 mt-2 font-medium">
                            完成率: {formatPercentage(analytics.overview.completedOrders / analytics.overview.totalOrders || 0)}
                        </p>
                    </div>

                    <div className="glass-card p-6 animate-scale-in hover:shadow-apple-lg transition-all duration-300" style={{ animationDelay: '200ms' }}>
                        <div className="flex items-center justify-between mb-3">
                            <p className="text-sm text-gray-600 font-medium">平均揀貨時間</p>
                            <Clock className="text-cyan-500" size={20} />
                        </div>
                        <p className="text-2xl font-bold text-gray-900">{formatTime(analytics.overview.avgPickingTime)}</p>
                    </div>

                    <div className="glass-card p-6 animate-scale-in hover:shadow-apple-lg transition-all duration-300" style={{ animationDelay: '300ms' }}>
                        <div className="flex items-center justify-between mb-3">
                            <p className="text-sm text-gray-600 font-medium">平均裝箱時間</p>
                            <Clock className="text-green-500" size={20} />
                        </div>
                        <p className="text-2xl font-bold text-gray-900">{formatTime(analytics.overview.avgPackingTime)}</p>
                    </div>

                    <div className="glass-card p-6 animate-scale-in hover:shadow-apple-lg transition-all duration-300" style={{ animationDelay: '400ms' }}>
                        <div className="flex items-center justify-between mb-3">
                            <p className="text-sm text-gray-600 font-medium">準確率</p>
                            <Target className="text-purple-500" size={20} />
                        </div>
                        <p className="text-3xl font-bold text-gray-900">
                            {formatPercentage(1 - analytics.overview.errorRate)}
                        </p>
                        <p className="text-xs text-red-500 mt-2">
                            錯誤率: {formatPercentage(analytics.overview.errorRate)}
                        </p>
                    </div>

                    <div className="glass-card p-6 animate-scale-in hover:shadow-apple-lg transition-all duration-300" style={{ animationDelay: '500ms' }}>
                        <div className="flex items-center justify-between mb-3">
                            <p className="text-sm text-gray-600 font-medium">活躍人數</p>
                            <Users className="text-indigo-500" size={20} />
                        </div>
                        <p className="text-3xl font-bold text-gray-900">{analytics.userPerformance.length}</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* User Performance Ranking */}
                    <div className="glass-card p-6 animate-scale-in hover:shadow-apple-lg transition-all duration-300" style={{ animationDelay: '600ms' }}>
                        <div className="flex items-center gap-3 mb-6">
                            <Award className="text-yellow-500" size={24} />
                            <h2 className="text-xl font-bold text-gray-900">員工績效排行</h2>
                        </div>
                        <div className="space-y-3">
                            {analytics.userPerformance.slice(0, 10).map((user, index) => (
                                <div key={user.user_id} 
                                    className="flex items-center gap-4 p-4 rounded-xl bg-gradient-to-r from-gray-50 to-blue-50 hover:from-blue-50 hover:to-purple-50 transition-all duration-200">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                                        index === 0 ? 'bg-gradient-to-br from-yellow-400 to-yellow-600 text-white' :
                                        index === 1 ? 'bg-gradient-to-br from-gray-300 to-gray-500 text-white' :
                                        index === 2 ? 'bg-gradient-to-br from-orange-400 to-orange-600 text-white' :
                                        'bg-gray-200 text-gray-700'
                                    }`}>
                                        {index + 1}
                                    </div>
                                    <div className="flex-1">
                                        <p className="font-semibold text-gray-900">{user.user_name}</p>
                                        <p className="text-xs text-gray-500">{user.role === 'picker' ? '揀貨員' : '裝箱員'}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-bold text-lg text-blue-600">{user.completed_orders}</p>
                                        <p className="text-xs text-gray-500">完成訂單</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Top Products */}
                    <div className="glass-card p-6 animate-scale-in hover:shadow-apple-lg transition-all duration-300" style={{ animationDelay: '700ms' }}>
                        <div className="flex items-center gap-3 mb-6">
                            <TrendingUp className="text-green-500" size={24} />
                            <h2 className="text-xl font-bold text-gray-900">熱門商品 TOP 10</h2>
                        </div>
                        <div className="space-y-3">
                            {analytics.topProducts.slice(0, 10).map((product, index) => (
                                <div key={index} 
                                    className="flex items-center gap-4 p-4 rounded-xl bg-gradient-to-r from-gray-50 to-green-50 hover:from-green-50 hover:to-emerald-50 transition-all duration-200">
                                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-400 to-emerald-600 text-white flex items-center justify-center font-bold text-sm">
                                        {index + 1}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-gray-900 truncate">{product.product_name}</p>
                                        <p className="text-xs text-gray-500 font-mono">{product.barcode}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-bold text-lg text-green-600">{product.total_quantity}</p>
                                        <p className="text-xs text-gray-500">出貨數</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
